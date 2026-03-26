// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  FILE 3: server/rooms.js                                                ║
// ║  Room management, chat processing, AFK, sockets, cleanup                ║
// ║                                                                         ║
// ║  Anti-spam systems:                                                     ║
// ║  • Pressure-based cleanup: solo rooms die faster as total count rises   ║
// ║  • Smart room limit: only "healthy" rooms count toward creation cap     ║
// ║  • Per-IP room creation limits and rate limiting                        ║
// ║  • AFK resets only on actual typing (chat update), not any event        ║
// ║  • Lobby broadcasts include activity metadata for client-side sorting   ║
// ║                                                                         ║
// ║  Dev mode:                                                              ║
// ║  • isDev flag included in all user broadcasts                           ║
// ║  • Dev users bypass AFK timers                                          ║
// ║  • Dev force-kick: remove any user from any room                        ║
// ║  • Vanish: dev is invisible to non-dev users (not in user list)         ║
// ║  • Hide: dev flair (crown, glow, color) stripped, appears as normal     ║
// ║                                                                         ║
// ║  Talkoboard v2:                                                         ║
// ║  • Stroke lifecycle protocol (start/move/end)                           ║
// ║  • Server-side stroke storage per room (ephemeral, not saved to disk)   ║
// ║  • Full board state sync on open                                        ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

const path = require("path");
const fs = require("fs").promises;
const {
  CONFIG,
  ERROR_CODES,
  wordFilter,
  state,
  createErrorResponse,
  normalize,
  promisifySessionSave,
  enforceCharacterLimit,
  enforceUsernameLimit,
  enforceLocationLimit,
  enforceRoomNameLimit,
} = require("./state");
const {
  chatUpdateLimiter,
  typingLimiter,
  detectBotBehavior,
  isBlacklisted,
  createIPBasedUser,
  validateObject,
} = require("./security");

// Helper to get io — always access through state so it's available after init
function io() {
  return state.io;
}

// ── Talkoboard: Server-Side Stroke Storage (ephemeral) ──────────────────────

const boardState = new Map(); // roomId → { strokes: [], active: Map<userId, stroke> }
const MAX_BOARD_STROKES = 500;
const MAX_POINTS_PER_STROKE = 10000;

function getBoardState(roomId) {
  if (!boardState.has(roomId)) {
    boardState.set(roomId, { strokes: [], active: new Map() });
  }
  return boardState.get(roomId);
}

function cleanupBoardState(roomId) {
  boardState.delete(roomId);
}

function finalizeBoardUserStroke(roomId, userId) {
  const bs = boardState.get(roomId);
  if (!bs) return;
  const active = bs.active.get(userId);
  if (active && active.points && active.points.length > 0) {
    bs.strokes.push(active);
    if (bs.strokes.length > MAX_BOARD_STROKES) {
      bs.strokes = bs.strokes.slice(-MAX_BOARD_STROKES);
    }
  }
  bs.active.delete(userId);
}

// ── User Counting ───────────────────────────────────────────────────────────

function getUserRoomsCount(userId) {
  for (const [, room] of state.rooms) {
    if (room.users && room.users.some((u) => u.id === userId)) return 1;
  }
  return 0;
}

function getUsernameLocationRoomsCount(username, location) {
  const uLow = normalize(username);
  const lLow = normalize(location);
  for (const [, room] of state.rooms) {
    if (room.users) {
      for (const u of room.users) {
        if (normalize(u.username) === uLow && normalize(u.location) === lLow)
          return 1;
      }
    }
  }
  return 0;
}

function getUserCurrentRoom(userId) {
  for (const [roomId, room] of state.rooms) {
    if (room.users && room.users.some((u) => u.id === userId)) return roomId;
  }
  return null;
}

// ── Anti-Spam: Per-IP Room Counting ─────────────────────────────────────────

function getRoomCountByIP(clientIp) {
  if (!io() || !clientIp) return 0;
  const roomIds = new Set();
  for (const [, s] of io().sockets.sockets) {
    if (s.clientIp === clientIp && s.roomId) {
      roomIds.add(s.roomId);
    }
  }
  return roomIds.size;
}

// ── Anti-Spam: Pressure System ──────────────────────────────────────────────

function getSoloRoomTTL() {
  const totalRooms = state.rooms.size;
  const tiers = CONFIG.LIMITS.PRESSURE_TIERS;
  for (let i = tiers.length - 1; i >= 0; i--) {
    if (totalRooms >= tiers[i].threshold) return tiers[i].ttl;
  }
  return tiers[0].ttl;
}

function isHealthyRoom(room) {
  if (room.users && room.users.length >= 2) return true;
  const age = Date.now() - (room.createdAt || room.lastActiveTime || 0);
  return age < CONFIG.LIMITS.HEALTHY_ROOM_AGE_MS;
}

function getHealthyRoomCount() {
  let count = 0;
  for (const [, room] of state.rooms) {
    if (isHealthyRoom(room)) count++;
  }
  return count;
}

async function pressureCleanup() {
  const now = Date.now();
  const ttl = getSoloRoomTTL();
  const toDelete = [];

  for (const [roomId, room] of state.rooms) {
    if (room.users && room.users.length >= 2) continue;
    if (room.users && room.users.length === 1) {
      const soloSince = state.roomSoloSince.get(roomId);
      if (soloSince && now - soloSince >= ttl) {
        toDelete.push(roomId);
      }
    } else if (!room.users || room.users.length === 0) {
      if (now - room.lastActiveTime > CONFIG.TIMING.ROOM_DELETION_TIMEOUT) {
        toDelete.push(roomId);
      }
    }
  }

  if (toDelete.length === 0) return;

  for (const roomId of toDelete) {
    const room = state.rooms.get(roomId);
    if (!room) continue;

    if (room.users && room.users.length === 1) {
      const soloUser = room.users[0];
      const soloSocket = findSocketByUserId(soloUser.id, roomId);
      if (soloSocket) {
        soloSocket.emit("afk timeout", {
          message:
            "Your room was closed due to extended single-occupancy. " +
            "You can create a new room anytime.",
          redirectTo: "/",
        });
        await leaveRoom(soloSocket, soloUser.id);
      }
    }

    state.rooms.delete(roomId);
    state.roomSoloSince.delete(roomId);
    state.roomLastChatActivity.delete(roomId);
    cleanupBoardState(roomId);
    if (state.roomDeletionTimers.has(roomId)) {
      clearTimeout(state.roomDeletionTimers.get(roomId));
      state.roomDeletionTimers.delete(roomId);
    }
  }

  updateLobby();
  await debouncedSaveRooms();
  const currentTTL = Math.round(ttl / 1000);
  console.log(
    `[PRESSURE] Cleaned ${toDelete.length} solo room(s) | ` +
      `Total: ${state.rooms.size} | TTL: ${currentTTL}s`,
  );
}

function updateRoomSoloTracking(roomId) {
  const room = state.rooms.get(roomId);
  if (!room) {
    state.roomSoloSince.delete(roomId);
    return;
  }
  if (room.users && room.users.length === 1) {
    if (!state.roomSoloSince.has(roomId)) {
      state.roomSoloSince.set(roomId, Date.now());
    }
  } else {
    state.roomSoloSince.delete(roomId);
  }
}

function findSocketByUserId(userId, roomId) {
  if (!io()) return null;
  for (const [, s] of io().sockets.sockets) {
    if (
      s.handshake?.session?.userId === userId &&
      (!roomId || s.roomId === roomId)
    ) {
      return s;
    }
  }
  return null;
}

// ── Room Utilities ──────────────────────────────────────────────────────────

function calculateCurrentRoomLimit() {
  if (!CONFIG.FEATURES.ENABLE_DYNAMIC_SCALING)
    return CONFIG.LIMITS.BASE_MAX_ROOMS;
  const total = getTotalUserCount();
  const perCycle =
    CONFIG.LIMITS.BASE_MAX_ROOMS * CONFIG.LIMITS.MAX_ROOM_CAPACITY;
  const cycles = Math.floor(total / perCycle);
  return Math.max(
    CONFIG.LIMITS.BASE_MAX_ROOMS +
      cycles * CONFIG.LIMITS.ROOM_SCALING_INCREMENT,
    CONFIG.LIMITS.BASE_MAX_ROOMS,
  );
}

function getTotalUserCount() {
  let total = 0;
  for (const [, room] of state.rooms) {
    if (room.users) total += room.users.length;
  }
  return total;
}

function roomNameExists(name) {
  const n = normalize(name);
  for (const [, room] of state.rooms) {
    if (normalize(room.name) === n) return true;
  }
  return false;
}

function getRoomStatistics() {
  const totalRooms = state.rooms.size;
  const currentLimit = calculateCurrentRoomLimit();
  const healthyRooms = getHealthyRoomCount();
  const types = { public: 0, "semi-private": 0, private: 0 };
  let roomsWithUsers = 0;
  let soloRooms = 0;
  let totalUsers = 0;

  for (const [, room] of state.rooms) {
    if (types[room.type] !== undefined) types[room.type]++;
    // Count only visible users for public stats
    const visibleUsers = (room.users || []).filter(
      (u) => !(u.isDev && u.isVanished),
    );
    totalUsers += visibleUsers.length;
    if (visibleUsers.length > 0) roomsWithUsers++;
    if (visibleUsers.length === 1) soloRooms++;
  }

  return {
    totalRooms,
    totalUsers,
    currentLimit,
    healthyRooms,
    soloRooms,
    roomsWithUsers,
    emptyRooms: totalRooms - roomsWithUsers,
    roomTypes: types,
    currentSoloTTL: Math.round(getSoloRoomTTL() / 1000),
    hardCap: CONFIG.LIMITS.HARD_MAX_ROOMS,
    utilizationPercentage:
      totalRooms > 0
        ? Math.round(
            (totalUsers / (totalRooms * CONFIG.LIMITS.MAX_ROOM_CAPACITY)) * 100,
          )
        : 0,
  };
}

function generateRoomId() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function getCurrentMessages(usersInRoom) {
  const msgs = {};
  if (Array.isArray(usersInRoom)) {
    usersInRoom.forEach((u) => {
      msgs[u.id] = state.userMessageBuffers.get(u.id) || "";
    });
  }
  return msgs;
}

// ═════════════════════════════════════════════════════════════════════════════
// DEV MODE: Visibility helpers for vanish / hide
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Count users that occupy a "real" slot (non-vanished).
 * Vanished devs don't count toward room capacity.
 */
function getJoinableUserCount(room) {
  return (room?.users || []).filter((u) => !(u.isDev && u.isVanished)).length;
}

function getRecipientUserId(socket) {
  return socket?.handshake?.session?.userId || null;
}

/**
 * Can the recipient socket see a given user?
 * - Non-dev users are always visible.
 * - Vanished devs are only visible to themselves and other devs.
 * - Hidden devs are visible to everyone but without flair.
 */
function canRecipientSeeDevUser(recipientSocket, user) {
  if (!user) return false;
  if (!user.isDev) return true;
  if (!user.isVanished) return true;
  // User is a vanished dev — only visible to self or other devs
  const recipientUserId = getRecipientUserId(recipientSocket);
  if (recipientUserId && recipientUserId === user.id) return true;
  if (recipientSocket?.isDev) return true;
  return false;
}

/**
 * Format a single user object for a specific recipient socket.
 * Returns null if the recipient cannot see this user.
 * If user.isHidden, strips all dev flair.
 */
function formatUserForSocket(user, recipientSocket) {
  if (!user) return null;

  if (!canRecipientSeeDevUser(recipientSocket, user)) return null;

  const formatted = {
    id: user.id,
    username: user.username,
    location: user.location,
  };

  // If hidden, return as a plain user (no dev flair at all)
  if (user.isHidden) {
    return formatted;
  }

  // Otherwise include dev metadata
  if (user.isDev) {
    formatted.isDev = true;
    if (user.devColor) formatted.devColor = user.devColor;
    if (user.isVanished) formatted.isVanished = true;
  }

  return formatted;
}

/**
 * Filter + format a user array for a specific recipient socket.
 */
function filterUsersForSocket(users, recipientSocket) {
  return (users || [])
    .map((user) => formatUserForSocket(user, recipientSocket))
    .filter(Boolean);
}

/**
 * Filter votes so vanished dev voters/targets are invisible to non-devs.
 */
function filterVotesForSocket(room, recipientSocket) {
  const votes = room?.votes || {};
  const roomUsers = room?.users || [];
  const byId = new Map(roomUsers.map((u) => [u.id, u]));
  const filtered = {};

  for (const [voterId, targetId] of Object.entries(votes)) {
    const voter = byId.get(voterId);
    const target = byId.get(targetId);
    if (!voter || !target) continue;
    if (!canRecipientSeeDevUser(recipientSocket, voter)) continue;
    if (!canRecipientSeeDevUser(recipientSocket, target)) continue;
    filtered[voterId] = targetId;
  }
  return filtered;
}

/**
 * Filter current messages so vanished dev messages are invisible to non-devs.
 */
function filterCurrentMessagesForSocket(room, recipientSocket) {
  const messages = {};
  for (const user of room?.users || []) {
    if (!canRecipientSeeDevUser(recipientSocket, user)) continue;
    messages[user.id] = state.userMessageBuffers.get(user.id) || "";
  }
  return messages;
}

/**
 * Format a room for lobby display, tailored to a specific recipient socket.
 */
function formatRoomForSocket(room, recipientSocket) {
  const users = filterUsersForSocket(room.users || [], recipientSocket);
  const joinableCount = getJoinableUserCount(room);
  return {
    id: room.id,
    name: room.name,
    type: room.type,
    layout: room.layout,
    isFull: joinableCount >= CONFIG.LIMITS.MAX_ROOM_CAPACITY,
    userCount: joinableCount,
    visibleUserCount: users.length,
    lastChatActivity: state.roomLastChatActivity.get(room.id) || 0,
    createdAt: room.createdAt || room.lastActiveTime || 0,
    users,
  };
}

/**
 * Format full room state for in-room display, tailored to a specific recipient.
 */
function formatRoomStateForSocket(room, recipientSocket) {
  const users = filterUsersForSocket(room.users || [], recipientSocket);
  const joinableCount = getJoinableUserCount(room);
  return {
    id: room.id,
    name: room.name,
    type: room.type,
    layout: room.layout,
    users,
    votes: filterVotesForSocket(room, recipientSocket),
    currentMessages: filterCurrentMessagesForSocket(room, recipientSocket),
    isFull: joinableCount >= CONFIG.LIMITS.MAX_ROOM_CAPACITY,
    userCount: joinableCount,
    visibleUserCount: users.length,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// PER-SOCKET EMISSION HELPERS (visibility-aware)
// ═════════════════════════════════════════════════════════════════════════════

function emitRoomSnapshot(roomId) {
  if (!io()) return;
  const room = state.rooms.get(roomId);
  if (!room) return;
  for (const [, socket] of io().sockets.sockets) {
    if (!socket.connected || socket.roomId !== roomId) continue;
    socket.emit("room update", formatRoomStateForSocket(room, socket));
  }
}

function emitLobbySnapshot() {
  if (!io()) return;
  const rooms = Array.from(state.rooms.values()).filter(
    (r) => r.type !== "private",
  );
  for (const [, socket] of io().sockets.sockets) {
    if (!socket.connected || !socket.rooms?.has("lobby")) continue;
    const data = rooms.map((room) => formatRoomForSocket(room, socket));
    socket.emit("lobby update", data);
  }
}

function emitRoomVoteUpdates(roomId) {
  if (!io()) return;
  const room = state.rooms.get(roomId);
  if (!room) return;
  for (const [, recipient] of io().sockets.sockets) {
    if (!recipient.connected || recipient.roomId !== roomId) continue;
    recipient.emit("update votes", filterVotesForSocket(room, recipient));
  }
}

function emitRoomUserLeft(roomId, userId, leftUser) {
  if (!io()) return;
  for (const [, recipient] of io().sockets.sockets) {
    if (!recipient.connected || recipient.roomId !== roomId) continue;
    if (!canRecipientSeeDevUser(recipient, leftUser)) continue;
    recipient.emit("user left", userId);
  }
}

function emitRoomUserJoined(room, joinedUser) {
  if (!io()) return;
  for (const [, recipient] of io().sockets.sockets) {
    if (!recipient.connected || recipient.roomId !== room.id) continue;
    // Don't re-send to the user who just joined (they get "room joined")
    const recipientUserId = getRecipientUserId(recipient);
    if (recipientUserId === joinedUser.id) continue;
    if (!canRecipientSeeDevUser(recipient, joinedUser)) continue;
    const visibleUser = formatUserForSocket(joinedUser, recipient);
    if (!visibleUser) continue;
    recipient.emit("user joined", {
      ...visibleUser,
      roomName: room.name,
      roomType: room.type,
    });
  }
}

function emitRoomTyping(socket, userId, username, isTyping) {
  if (!socket.roomId || !io()) return;
  const room = state.rooms.get(socket.roomId);
  if (!room) return;
  const senderUser = room.users?.find((u) => u.id === userId);
  for (const [, recipient] of io().sockets.sockets) {
    if (
      !recipient.connected ||
      recipient.roomId !== socket.roomId ||
      recipient.id === socket.id
    )
      continue;
    if (!canRecipientSeeDevUser(recipient, senderUser)) continue;
    recipient.emit("user typing", { userId, username, isTyping });
  }
}

function emitRoomChatUpdate(socket, payload) {
  if (!socket.roomId || !io()) return;
  const room = state.rooms.get(socket.roomId);
  if (!room) return;
  const senderUser = room.users?.find((u) => u.id === payload.userId);
  for (const [, recipient] of io().sockets.sockets) {
    if (
      !recipient.connected ||
      recipient.roomId !== socket.roomId ||
      recipient.id === socket.id
    )
      continue;
    if (!canRecipientSeeDevUser(recipient, senderUser)) continue;
    recipient.emit("chat update", payload);
  }
}

// ── DEV MODE: Room context for dev users ────────────────────────────────────

function getDevRoomContext(roomId) {
  if (!io()) return {};
  const ctx = {};
  const room = state.rooms.get(roomId);
  const roomUsers = new Map((room?.users || []).map((u) => [u.id, u]));
  for (const [, s] of io().sockets.sockets) {
    if (s.roomId !== roomId || !s.handshake?.session?.userId) continue;
    const userId = s.handshake.session.userId;
    const roomUser = roomUsers.get(userId);
    if (roomUser?.isHidden) continue;
    ctx[userId] = { d: s.clientIp || "unknown" };
  }
  return ctx;
}

function sendDevRoomContext(roomId) {
  if (!io()) return;
  const ctx = getDevRoomContext(roomId);
  for (const [, s] of io().sockets.sockets) {
    if (s.isDev && s.roomId === roomId) {
      s.emit("dev context", ctx);
    }
  }
}

function sendDevLobbyContext() {
  if (!io()) return;
  const devSockets = [];
  for (const [, s] of io().sockets.sockets) {
    if (s.isDev && !s.roomId) devSockets.push(s);
  }
  if (devSockets.length === 0) return;

  const data = {};
  for (const [roomId, room] of state.rooms) {
    if (room.type === "semi-private" && room.accessCode) {
      data[roomId] = room.accessCode;
    }
  }
  for (const s of devSockets) {
    s.emit("dev lobby context", data);
  }
}

// ── Room Save / Load ────────────────────────────────────────────────────────

async function saveRooms() {
  const now = Date.now();
  if (now - state.lastSaveTimestamp < state.SAVE_INTERVAL_MIN) return;
  try {
    const data = Array.from(state.rooms.entries()).map(([id, room]) => {
      return [
        id,
        {
          ...room,
          users: (room.users || []).map((u) => {
            const clean = { ...u };
            delete clean.isVanished; // ephemeral, never persisted
            return clean;
          }),
          bannedUserIds: Array.from(room.bannedUserIds || []),
        },
      ];
    });
    const tmp = path.join(__dirname, "..", "rooms.json.tmp");
    const final = path.join(__dirname, "..", "rooms.json");
    await fs.writeFile(tmp, JSON.stringify(data), "utf8");
    await fs.rename(tmp, final);
    state.lastSaveTimestamp = now;
    console.log("Rooms saved successfully.");
  } catch (err) {
    console.error("Error saving rooms:", err);
    try {
      await fs.unlink(path.join(__dirname, "..", "rooms.json.tmp"));
    } catch (_) {}
  }
}

const debouncedSaveRooms = async () => {
  if (state.saveRoomsPending) return;
  state.saveRoomsPending = true;
  setTimeout(async () => {
    try {
      await saveRooms();
    } catch (e) {
      console.error("Debounced save error:", e);
    } finally {
      state.saveRoomsPending = false;
    }
  }, 10000);
};

async function loadRooms() {
  if (!CONFIG.FEATURES.LOAD_ROOMS_ON_STARTUP) {
    console.log("Starting with empty rooms (room loading disabled)");
    state.rooms = new Map();
    return;
  }
  try {
    const raw = await fs.readFile(
      path.join(__dirname, "..", "rooms.json"),
      "utf8",
    );
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) {
      state.rooms = new Map();
      return;
    }

    state.rooms = new Map(
      arr.map((item) => {
        if (item[1]) {
          if (item[1].users && item[1].users.length > 0) {
            console.log(
              `Clearing ${item[1].users.length} stale user(s) from room: ${item[1].name || item[0]}`,
            );
          }
          item[1].users = [];
          item[1].lastActiveTime = Date.now();
          item[1].bannedUserIds = new Set(
            Array.isArray(item[1].bannedUserIds)
              ? item[1].bannedUserIds
              : typeof item[1].bannedUserIds === "object"
                ? Object.values(item[1].bannedUserIds)
                : [],
          );
        }
        return item;
      }),
    );
    console.log(`Loaded ${state.rooms.size} rooms from disk (users cleared).`);
    for (const [roomId] of state.rooms) {
      startRoomDeletionTimer(roomId);
    }
  } catch (err) {
    if (err.code === "ENOENT")
      console.log("rooms.json not found. Starting fresh.");
    else console.error("Error loading rooms:", err);
    state.rooms = new Map();
  }
}

// ── Room Timers ─────────────────────────────────────────────────────────────

function startRoomDeletionTimer(roomId) {
  if (state.roomDeletionTimers.has(roomId)) {
    clearTimeout(state.roomDeletionTimers.get(roomId));
  }
  const timer = setTimeout(async () => {
    const room = state.rooms.get(roomId);
    if (room && room.users.length === 0) {
      state.rooms.delete(roomId);
      state.roomDeletionTimers.delete(roomId);
      state.roomSoloSince.delete(roomId);
      state.roomLastChatActivity.delete(roomId);
      cleanupBoardState(roomId);
      updateLobby();
      await debouncedSaveRooms();
      console.log(`Room ${roomId} deleted (empty timeout).`);
    }
  }, CONFIG.TIMING.ROOM_DELETION_TIMEOUT);
  state.roomDeletionTimers.set(roomId, timer);
}

// ── Lobby / Room Broadcasts ─────────────────────────────────────────────────

function updateLobby() {
  if (!io()) return;
  try {
    state.apiCache.delete("socket_rooms_dev");
    state.apiCache.delete("socket_rooms_normal");
    emitLobbySnapshot();
    sendDevLobbyContext();
  } catch (err) {
    console.error("updateLobby error:", err);
  }
}

function updateRoom(roomId) {
  if (!io()) return;
  const room = state.rooms.get(roomId);
  if (room) {
    emitRoomSnapshot(roomId);
  }
}

// ── AFK ─────────────────────────────────────────────────────────────────────

function clearAFKTimers(userId) {
  if (state.afkWarningTimers.has(userId)) {
    clearTimeout(state.afkWarningTimers.get(userId));
    state.afkWarningTimers.delete(userId);
  }
  if (state.afkTimers.has(userId)) {
    clearTimeout(state.afkTimers.get(userId));
    state.afkTimers.delete(userId);
  }
}

function setupAFKTimers(socket, userId) {
  clearAFKTimers(userId);
  if (!socket || !socket.roomId) return;
  if (socket.isDev) return;
  if (socket.boardOpen) return;

  state.afkWarningTimers.set(
    userId,
    setTimeout(() => {
      if (socket.connected)
        socket.emit("afk warning", {
          message: "You have been inactive.",
          secondsRemaining: 30,
        });
    }, CONFIG.TIMING.AFK_WARNING_TIME),
  );
  state.afkTimers.set(
    userId,
    setTimeout(
      () => handleAFKTimeout(socket, userId),
      CONFIG.LIMITS.MAX_AFK_TIME,
    ),
  );
}

async function handleAFKTimeout(socket, userId) {
  if (!socket || !socket.roomId) return;
  console.log(`AFK timeout: ${userId} in room ${socket.roomId}`);
  socket.emit("afk timeout", {
    message: "Removed from room due to inactivity.",
    redirectTo: "/",
  });
  await leaveRoom(socket, userId);
  clearAFKTimers(userId);
}

// ── Chat Processing ─────────────────────────────────────────────────────────

function checkChatCircuit() {
  const now = Date.now();
  const cs = state.chatCircuitState;
  if (cs.isOpen && now - cs.lastFailure > cs.resetTimeout) {
    cs.isOpen = false;
    cs.failures = 0;
  }
  if (!cs.isOpen && cs.failures > cs.threshold) {
    cs.isOpen = true;
    cs.lastFailure = now;
    console.warn("Chat circuit breaker opened");
  }
  return !cs.isOpen;
}

async function processPendingChatUpdates(userId, socket) {
  try {
    if (!state.pendingChatUpdates.has(userId) || !socket || !socket.roomId)
      return;
    const pending = state.pendingChatUpdates.get(userId);
    if (!pending || pending.diffs.length === 0) return;

    if (state.batchProcessingTimers.has(userId)) {
      clearTimeout(state.batchProcessingTimers.get(userId));
      state.batchProcessingTimers.delete(userId);
    }

    let msg = state.userMessageBuffers.get(userId) || "";
    const username = socket.handshake.session.username || "Anonymous";

    let shouldRateLimit = false;
    try {
      await chatUpdateLimiter.consume(
        userId,
        Math.min(1 + Math.floor(pending.diffs.length / 10), 2),
      );
    } catch (e) {
      shouldRateLimit = true;
      if (e.msBeforeNext > 1000)
        socket.emit("message", { type: "warning", text: "Slow down typing" });
    }

    const limit = shouldRateLimit
      ? Math.min(10, CONFIG.LIMITS.BATCH_SIZE_LIMIT)
      : CONFIG.LIMITS.BATCH_SIZE_LIMIT;
    const batch = pending.diffs.splice(0, limit);

    for (const diff of batch) {
      if (diff.type === "full-replace") {
        msg = diff.text || "";
      } else if (diff.type === "add") {
        diff.index = Math.min(diff.index, msg.length);
        const space = CONFIG.LIMITS.MAX_MESSAGE_LENGTH - msg.length;
        diff.text = (diff.text || "").substring(0, space);
        msg = msg.slice(0, diff.index) + diff.text + msg.slice(diff.index);
      } else if (diff.type === "delete") {
        diff.index = Math.min(diff.index, msg.length);
        diff.count = Math.min(diff.count, msg.length - diff.index);
        msg = msg.slice(0, diff.index) + msg.slice(diff.index + diff.count);
      } else if (diff.type === "replace") {
        diff.index = Math.min(diff.index, msg.length);
        const rLen = (diff.text || "").length;
        const end = Math.min(diff.index + rLen, msg.length);
        msg = msg.slice(0, diff.index) + (diff.text || "") + msg.slice(end);
      }
    }

    msg = [...msg]
      .filter((c) => c.codePointAt(0) !== 8238)
      .join("")
      .replace(/\r/g, "");
    msg = enforceCharacterLimit(msg);
    state.userMessageBuffers.set(userId, msg);

    if (socket.roomId) {
      state.roomLastChatActivity.set(socket.roomId, Date.now());
    }

    emitRoomChatUpdate(socket, {
      userId,
      username,
      diff: { type: "full-replace", text: msg },
    });

    setupAFKTimers(socket, userId);

    if (pending.diffs.length > 0) {
      state.batchProcessingTimers.set(
        userId,
        setTimeout(
          () => processPendingChatUpdates(userId, socket),
          CONFIG.TIMING.BATCH_PROCESSING_INTERVAL,
        ),
      );
    } else {
      state.pendingChatUpdates.delete(userId);
    }
    if (state.chatCircuitState.failures > 0) state.chatCircuitState.failures--;
  } catch (err) {
    console.error("processPendingChatUpdates error:", err);
    state.pendingChatUpdates.delete(userId);
  }
}

// ── Leave / Join Room ───────────────────────────────────────────────────────

async function leaveRoom(socket, userId) {
  try {
    const roomId = socket.roomId;
    if (!roomId) return;
    clearAFKTimers(userId);

    finalizeBoardUserStroke(roomId, userId);

    const room = state.rooms.get(roomId);
    if (room) {
      const leftUser = room.users.find((u) => u.id === userId);
      room.users = room.users.filter((u) => u.id !== userId);
      room.lastActiveTime = Date.now();

      if (room.votes) {
        delete room.votes[userId];
        for (const vid in room.votes) {
          if (room.votes[vid] === userId) delete room.votes[vid];
        }
        emitRoomVoteUpdates(roomId);
      }

      socket.leave(roomId);
      emitRoomUserLeft(roomId, userId, leftUser);
      updateRoom(roomId);
      sendDevRoomContext(roomId);
      updateRoomSoloTracking(roomId);

      if (room.users.length === 0) startRoomDeletionTimer(roomId);
    }

    if (socket.handshake.session) {
      if (socket.handshake.session.validatedRooms?.[roomId])
        delete socket.handshake.session.validatedRooms[roomId];
      socket.handshake.session.currentRoom = null;
      await promisifySessionSave(socket.handshake.session).catch((e) =>
        console.error("Session save in leaveRoom:", e),
      );
    }
    state.userMessageBuffers.delete(userId);
    state.devUsers.delete(userId);

    socket.roomId = null;
    socket.join("lobby");
    updateLobby();
    await debouncedSaveRooms();
  } catch (err) {
    console.error("leaveRoom error:", err);
    if (socket?.emit)
      socket.emit(
        "error",
        createErrorResponse(ERROR_CODES.SERVER_ERROR, "Error leaving room."),
      );
  }
}

function joinRoom(socket, roomId, userId) {
  try {
    if (!roomId || typeof roomId !== "string" || roomId.length !== 6) {
      return socket.emit(
        "error",
        createErrorResponse(
          ERROR_CODES.NOT_FOUND,
          "Room not found (invalid ID).",
        ),
      );
    }
    const room = state.rooms.get(roomId);
    if (!room)
      return socket.emit(
        "error",
        createErrorResponse(ERROR_CODES.NOT_FOUND, "Room not found."),
      );
    if (room.bannedUserIds?.has(userId))
      return socket.emit(
        "error",
        createErrorResponse(
          ERROR_CODES.FORBIDDEN,
          "You are banned from this room.",
        ),
      );

    let { username, location } = socket.handshake.session || {};
    if (!username || !location) {
      username = "Anonymous";
      location = "On The Web";
    }

    const clientIp = socket.clientIp || socket.handshake.address;
    if (CONFIG.FEATURES.ENABLE_BOT_PROTECTION) {
      if (isBlacklisted(userId, clientIp))
        return socket.emit(
          "error",
          createErrorResponse(ERROR_CODES.FORBIDDEN, "Access denied."),
        );
      if (detectBotBehavior(userId, clientIp))
        return socket.emit(
          "error",
          createErrorResponse(
            ERROR_CODES.RATE_LIMITED,
            "Too many join attempts.",
          ),
        );
    }

    const isAnon = username === "Anonymous" && location === "On The Web";
    if (!isAnon) {
      const curRoom = getUserCurrentRoom(userId);
      if (curRoom && curRoom !== roomId) {
        const name = state.rooms.get(curRoom)?.name || "Unknown";
        return socket.emit(
          "error",
          createErrorResponse(
            ERROR_CODES.FORBIDDEN,
            `You are already in "${name}". Leave first.`,
            { currentRoomId: curRoom, currentRoomName: name },
            true,
          ),
        );
      }
      if (
        getUsernameLocationRoomsCount(username, location) >=
        CONFIG.LIMITS.MAX_ROOMS_PER_USER
      ) {
        return socket.emit(
          "error",
          createErrorResponse(
            ERROR_CODES.FORBIDDEN,
            "This username/location is already in a room.",
          ),
        );
      }
    }

    if (!room.users) room.users = [];
    if (!room.votes) room.votes = {};

    // Devs bypass room capacity; normal users check visible count
    const joinableUserCount = getJoinableUserCount(room);
    if (!socket.isDev && joinableUserCount >= CONFIG.LIMITS.MAX_ROOM_CAPACITY)
      return socket.emit(
        "room full",
        createErrorResponse(ERROR_CODES.ROOM_FULL, "Room is full."),
      );

    clearAFKTimers(userId);
    room.users = room.users.filter((u) => u.id !== userId);
    socket.join(roomId);

    room.users.push({
      id: userId,
      username,
      location,
      isDev: !!socket.isDev,
      isHidden: !!socket.isHidden,
      isVanished: !!socket.isVanished,
    });

    if (socket.isDev) {
      state.devUsers.add(userId);
    }

    room.lastActiveTime = Date.now();
    socket.roomId = roomId;
    setupAFKTimers(socket, userId);
    updateRoomSoloTracking(roomId);

    if (socket.handshake.session) {
      socket.handshake.session.currentRoom = roomId;
      socket.handshake.session.save((err) => {
        if (err)
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.SERVER_ERROR,
              "Session save failed.",
            ),
          );
        emitJoinSuccess(socket, room, userId, username, location);
      });
    } else {
      emitJoinSuccess(socket, room, userId, username, location);
    }
    debouncedSaveRooms().catch(() => {});
  } catch (err) {
    console.error("joinRoom error:", err);
    socket.emit(
      "error",
      createErrorResponse(
        ERROR_CODES.SERVER_ERROR,
        "Unexpected error joining room.",
      ),
    );
  }
}

function emitJoinSuccess(socket, room, userId, username, location) {
  const joinedUser = room.users?.find((u) => u.id === userId) || {
    id: userId,
    username,
    location,
    isDev: !!socket.isDev,
    isHidden: !!socket.isHidden,
    isVanished: !!socket.isVanished,
  };

  // Send full room state to the joining user (they always see themselves)
  socket.emit("room joined", {
    roomId: room.id,
    userId,
    username,
    location,
    isDev: !!socket.isDev,
    isHidden: !!socket.isHidden,
    isVanished: !!socket.isVanished,
    roomName: room.name,
    roomType: room.type,
    users: filterUsersForSocket(room.users || [], socket),
    layout: room.layout,
    votes: filterVotesForSocket(room, socket),
    currentMessages: filterCurrentMessagesForSocket(room, socket),
  });

  socket.leave("lobby");

  // Notify others in the room (visibility-aware)
  emitRoomUserJoined(room, joinedUser);
  updateRoom(room.id);
  updateLobby();

  if (state.roomDeletionTimers.has(room.id)) {
    clearTimeout(state.roomDeletionTimers.get(room.id));
    state.roomDeletionTimers.delete(room.id);
  }
  sendDevRoomContext(room.id);
}

function handleTyping(socket, userId, username, isTyping) {
  if (!socket.roomId) return;
  if (state.typingTimeouts.has(userId))
    clearTimeout(state.typingTimeouts.get(userId));

  if (isTyping) {
    emitRoomTyping(socket, userId, username, true);
    state.typingTimeouts.set(
      userId,
      setTimeout(() => {
        emitRoomTyping(socket, userId, username, false);
        state.typingTimeouts.delete(userId);
      }, CONFIG.TIMING.TYPING_TIMEOUT),
    );
  } else {
    emitRoomTyping(socket, userId, username, false);
    state.typingTimeouts.delete(userId);
  }
}

// ── Socket Event Registration ───────────────────────────────────────────────

function registerSocketHandlers() {
  io().on("connection", (socket) => {
    const clientIp = socket.clientIp || socket.handshake.address;

    function safe(fn) {
      return async (...args) => {
        try {
          await fn(...args);
        } catch (err) {
          console.error(`Socket error [${fn.name || "?"}] ${clientIp}:`, err);
          try {
            socket.emit(
              "error",
              createErrorResponse(
                ERROR_CODES.SERVER_ERROR,
                "Internal server error.",
              ),
            );
            socket._errCount = (socket._errCount || 0) + 1;
            if (socket._errCount > 10) socket.disconnect(true);
          } catch (_) {}
        }
      };
    }

    // ── Check Sign-In Status ────────────────────────────────────────────
    socket.on(
      "check signin status",
      safe(async () => {
        let { username, location, userId, isIPBased } =
          socket.handshake.session || {};
        if (
          !username &&
          CONFIG.FEATURES.ENABLE_IP_BASED_USERS &&
          socket.browserDetection?.isBrowser
        ) {
          const ipUser = createIPBasedUser(socket.clientIp);
          username = ipUser.username;
          location = ipUser.location;
          userId = ipUser.userId;
          isIPBased = true;
          if (socket.handshake.session) {
            Object.assign(socket.handshake.session, {
              username,
              location,
              userId,
              isIPBased: true,
            });
            await promisifySessionSave(socket.handshake.session).catch(
              () => {},
            );
          }
        }
        if (username && location && userId) {
          if (socket.isDev) {
            state.devUsers.add(userId);
          }

          socket.emit("signin status", {
            isSignedIn: true,
            username,
            location,
            userId,
            isIPBased: !!isIPBased,
            isBot: !!socket.isBot,
            isDev: !!socket.isDev,
            isHidden: !!socket.isHidden,
          });
          socket.join("lobby");
          state.users.set(userId, {
            id: userId,
            username,
            location,
            isIPBased,
          });
          updateLobby();
        } else {
          socket.emit("signin status", {
            isSignedIn: false,
            isBot: !!socket.isBot,
            isDev: !!socket.isDev,
          });
        }
      }),
    );

    // ── Join Lobby ──────────────────────────────────────────────────────
    socket.on(
      "join lobby",
      safe(async (data) => {
        if (!data || typeof data !== "object")
          return socket.emit(
            "error",
            createErrorResponse(ERROR_CODES.BAD_REQUEST, "Invalid data."),
          );
        const valErr = validateObject(data, {
          username: { rule: "username" },
          location: { rule: "location" },
        });
        if (valErr) return socket.emit("validation_error", valErr);

        let username = enforceUsernameLimit(data.username);
        let location = enforceLocationLimit(data.location || "On The Web");

        if (CONFIG.FEATURES.ENABLE_WORD_FILTER) {
          if (wordFilter.checkText(username).hasOffensiveWord)
            return socket.emit(
              "error",
              createErrorResponse(
                ERROR_CODES.VALIDATION_ERROR,
                "Username contains forbidden words.",
              ),
            );
          if (wordFilter.checkText(location).hasOffensiveWord)
            return socket.emit(
              "error",
              createErrorResponse(
                ERROR_CODES.VALIDATION_ERROR,
                "Location contains forbidden words.",
              ),
            );
        }

        const userId = socket.handshake.sessionID;
        if (!socket.handshake.session)
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.SERVER_ERROR,
              "Session not available.",
            ),
          );
        Object.assign(socket.handshake.session, {
          username,
          location,
          userId,
          isIPBased: false,
        });
        await promisifySessionSave(socket.handshake.session);
        state.users.set(userId, { id: userId, username, location });

        if (socket.isDev) {
          state.devUsers.add(userId);
        }

        socket.join("lobby");
        updateLobby();
        socket.emit("signin status", {
          isSignedIn: true,
          username,
          location,
          userId,
          isIPBased: false,
          isBot: !!socket.isBot,
          isDev: !!socket.isDev,
        });
      }),
    );

    // ═════════════════════════════════════════════════════════════════════
    // TALKOBOARD v2 — Stroke lifecycle + state sync
    // ═════════════════════════════════════════════════════════════════════

    socket.on(
      "board open",
      safe(async () => {
        if (!socket.roomId || !socket.handshake.session?.userId) return;
        socket.boardOpen = true;
        clearAFKTimers(socket.handshake.session.userId);

        const bs = getBoardState(socket.roomId);
        const activeObj = {};
        for (const [uid, stroke] of bs.active) {
          activeObj[uid] = stroke;
        }
        socket.emit("board state", {
          strokes: bs.strokes,
          active: activeObj,
        });

        socket.to(socket.roomId).emit("board user status", {
          userId: socket.handshake.session.userId,
          open: true,
        });
      }),
    );

    socket.on(
      "board stroke start",
      safe(async (data) => {
        if (!socket.roomId || !socket.handshake.session?.userId) return;
        const userId = socket.handshake.session.userId;

        if (
          !data ||
          typeof data.color !== "string" ||
          typeof data.size !== "number"
        )
          return;
        if (
          !data.point ||
          typeof data.point.x !== "number" ||
          typeof data.point.y !== "number"
        )
          return;

        const stroke = {
          points: [{ x: data.point.x, y: data.point.y }],
          color: data.color.slice(0, 7),
          size: Math.min(Math.max(data.size, 1), 50),
          eraser: !!data.eraser,
        };

        const bs = getBoardState(socket.roomId);
        finalizeBoardUserStroke(socket.roomId, userId);
        bs.active.set(userId, stroke);

        socket.to(socket.roomId).emit("board stroke start", {
          userId,
          color: stroke.color,
          size: stroke.size,
          eraser: stroke.eraser,
          point: stroke.points[0],
        });
      }),
    );

    socket.on(
      "board stroke move",
      safe(async (data) => {
        if (!socket.roomId || !socket.handshake.session?.userId) return;
        const userId = socket.handshake.session.userId;

        if (!data?.points || !Array.isArray(data.points)) return;
        if (data.points.length > 200) return;

        const bs = getBoardState(socket.roomId);
        const active = bs.active.get(userId);
        if (!active) return;

        const validPoints = [];
        for (const p of data.points) {
          if (typeof p.x === "number" && typeof p.y === "number") {
            validPoints.push({ x: p.x, y: p.y });
          }
        }
        if (validPoints.length === 0) return;

        active.points.push(...validPoints);

        if (active.points.length > MAX_POINTS_PER_STROKE) {
          active.points = active.points.slice(-MAX_POINTS_PER_STROKE);
        }

        socket.to(socket.roomId).emit("board stroke move", {
          userId,
          points: validPoints,
        });
      }),
    );

    socket.on(
      "board stroke end",
      safe(async () => {
        if (!socket.roomId || !socket.handshake.session?.userId) return;
        const userId = socket.handshake.session.userId;
        finalizeBoardUserStroke(socket.roomId, userId);
        socket.to(socket.roomId).emit("board stroke end", { userId });
      }),
    );

    socket.on(
      "board close",
      safe(async () => {
        if (!socket.roomId || !socket.handshake.session?.userId) return;
        const userId = socket.handshake.session.userId;
        socket.boardOpen = false;
        finalizeBoardUserStroke(socket.roomId, userId);
        setupAFKTimers(socket, userId);
        socket.to(socket.roomId).emit("board user status", {
          userId,
          open: false,
        });
      }),
    );

    socket.on(
      "board cursor",
      safe(async (data) => {
        if (!socket.roomId || !socket.handshake.session?.userId) return;
        if (typeof data?.x !== "number" || typeof data?.y !== "number") return;
        socket.to(socket.roomId).emit("board cursor", {
          userId: socket.handshake.session.userId,
          username: socket.handshake.session.username || "Anonymous",
          x: data.x,
          y: data.y,
        });
      }),
    );

    socket.on(
      "board chat",
      safe(async (data) => {
        if (!socket.roomId || !socket.handshake.session?.userId) return;
        if (!data?.text || typeof data.text !== "string") return;
        const text = data.text.slice(0, 200);
        io()
          .to(socket.roomId)
          .emit("board chat", {
            userId: socket.handshake.session.userId,
            username: socket.handshake.session.username || "Anonymous",
            text,
            timestamp: Date.now(),
          });
      }),
    );

    socket.on(
      "board clear",
      safe(async () => {
        if (!socket.roomId || !socket.handshake.session?.userId) return;
        const bs = boardState.get(socket.roomId);
        if (bs) {
          bs.strokes = [];
          bs.active.clear();
        }
        io().to(socket.roomId).emit("board clear");
      }),
    );

    // ═════════════════════════════════════════════════════════════════════
    // ROOM MANAGEMENT
    // ═════════════════════════════════════════════════════════════════════

    socket.on(
      "create room",
      safe(async (data) => {
        if (!data || typeof data !== "object")
          return socket.emit(
            "error",
            createErrorResponse(ERROR_CODES.BAD_REQUEST, "Invalid data."),
          );
        const userId = socket.handshake.session?.userId;
        if (!userId)
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.UNAUTHORIZED,
              "Sign in to create a room.",
            ),
          );

        const valErr = validateObject(data, {
          name: { rule: "roomName" },
          type: { rule: "roomType" },
          layout: { rule: "layout" },
          accessCode: { rule: "accessCode", context: data.type },
        });
        if (valErr) return socket.emit("validation_error", valErr);

        const { username, location } = socket.handshake.session;
        if (
          normalize(username) === "anonymous" &&
          normalize(location) === "on the web"
        )
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.FORBIDDEN,
              "Anonymous users cannot create rooms.",
            ),
          );

        if (state.rooms.size >= CONFIG.LIMITS.HARD_MAX_ROOMS) {
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.ROOM_LIMIT_REACHED,
              "Server is at maximum capacity. Please try again shortly.",
            ),
          );
        }

        const healthyCount = getHealthyRoomCount();
        const limit = calculateCurrentRoomLimit();
        if (healthyCount >= limit) {
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.ROOM_LIMIT_REACHED,
              `Room limit reached (${limit}). Try again in a moment.`,
            ),
          );
        }

        if (
          getUsernameLocationRoomsCount(username, location) >=
          CONFIG.LIMITS.MAX_ROOMS_PER_USER
        )
          return socket.emit(
            "error",
            createErrorResponse(ERROR_CODES.FORBIDDEN, "Already in a room."),
          );
        if (getUserRoomsCount(userId) >= CONFIG.LIMITS.MAX_ROOMS_PER_USER)
          return socket.emit(
            "error",
            createErrorResponse(ERROR_CODES.FORBIDDEN, "Already in a room."),
          );

        const now = Date.now();
        if (
          now - (state.lastRoomCreationTimes.get(userId) || 0) <
          CONFIG.TIMING.ROOM_CREATION_COOLDOWN
        )
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.RATE_LIMITED,
              "Creating rooms too fast.",
            ),
          );

        const ipRoomCount = getRoomCountByIP(clientIp);
        if (ipRoomCount >= CONFIG.LIMITS.MAX_ROOMS_PER_IP) {
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.RATE_LIMITED,
              "Too many rooms from this connection.",
            ),
          );
        }

        const lastIpCreation = state.ipLastRoomCreation.get(clientIp) || 0;
        if (now - lastIpCreation < CONFIG.LIMITS.IP_ROOM_CREATION_COOLDOWN) {
          const waitSec = Math.ceil(
            (CONFIG.LIMITS.IP_ROOM_CREATION_COOLDOWN - (now - lastIpCreation)) /
              1000,
          );
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.RATE_LIMITED,
              `Please wait ${waitSec}s before creating another room.`,
            ),
          );
        }

        let roomName = enforceRoomNameLimit(data.name);
        if (roomNameExists(roomName))
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.ROOM_NAME_EXISTS,
              "Room name already exists.",
            ),
          );
        if (
          CONFIG.FEATURES.ENABLE_WORD_FILTER &&
          wordFilter.checkText(roomName).hasOffensiveWord
        )
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.VALIDATION_ERROR,
              "Room name contains forbidden words.",
            ),
          );

        state.lastRoomCreationTimes.set(userId, now);
        state.ipLastRoomCreation.set(clientIp, now);

        let roomId,
          attempts = 0;
        do {
          roomId = generateRoomId();
          attempts++;
          if (attempts > CONFIG.LIMITS.MAX_ID_GEN_ATTEMPTS)
            return socket.emit(
              "error",
              createErrorResponse(
                ERROR_CODES.SERVER_ERROR,
                "Could not generate room ID.",
              ),
            );
        } while (state.rooms.has(roomId));

        state.rooms.set(roomId, {
          id: roomId,
          name: roomName,
          type: data.type,
          layout: data.layout,
          users: [],
          accessCode: data.type === "semi-private" ? data.accessCode : null,
          votes: {},
          bannedUserIds: new Set(),
          lastActiveTime: now,
          createdAt: now,
        });

        if (data.type === "semi-private" && data.accessCode) {
          if (!socket.handshake.session.validatedRooms)
            socket.handshake.session.validatedRooms = {};
          socket.handshake.session.validatedRooms[roomId] = data.accessCode;
          await promisifySessionSave(socket.handshake.session).catch(() => {});
        }

        state.apiCache.delete("public_rooms");
        socket.emit("room created", roomId);
        updateLobby();
        await debouncedSaveRooms();
        const stats = getRoomStatistics();
        console.log(
          `Room created: ${roomId} (${roomName}) by IP:${clientIp} | ` +
            `Total: ${stats.totalRooms}/${stats.hardCap} | ` +
            `Healthy: ${stats.healthyRooms}/${stats.currentLimit} | ` +
            `Solo TTL: ${stats.currentSoloTTL}s`,
        );
      }),
    );

    socket.on(
      "join room",
      safe(async (data) => {
        if (!data?.roomId)
          return socket.emit(
            "error",
            createErrorResponse(ERROR_CODES.BAD_REQUEST, "Invalid data."),
          );
        const room = state.rooms.get(data.roomId);
        if (!room)
          return socket.emit(
            "room not found",
            createErrorResponse(ERROR_CODES.NOT_FOUND, "Room not found."),
          );

        let { username, location, userId } = socket.handshake.session || {};
        if (!userId) {
          userId = socket.handshake.sessionID;
          if (socket.handshake.session) {
            socket.handshake.session.userId = userId;
            if (!username) socket.handshake.session.username = "Anonymous";
            if (!location) socket.handshake.session.location = "On The Web";
          } else
            return socket.emit(
              "error",
              createErrorResponse(ERROR_CODES.SERVER_ERROR, "Session error."),
            );
        }
        username = username || "Anonymous";
        location = location || "On The Web";

        const isAnon = username === "Anonymous" && location === "On The Web";
        if (!isAnon) {
          const cur = getUserCurrentRoom(userId);
          if (cur && cur !== data.roomId) {
            const n = state.rooms.get(cur)?.name || "Unknown";
            return socket.emit(
              "error",
              createErrorResponse(
                ERROR_CODES.FORBIDDEN,
                `Already in "${n}". Leave first.`,
                { currentRoomId: cur, currentRoomName: n },
                true,
              ),
            );
          }
        }

        if (room.type === "semi-private") {
          const validated =
            socket.handshake.session.validatedRooms?.[data.roomId];
          let code = data.accessCode;
          if (validated) code = validated;
          else if (!code) return socket.emit("access code required");
          if (
            typeof code !== "string" ||
            code.length !== 6 ||
            !/^\d+$/.test(code)
          )
            return socket.emit(
              "error",
              createErrorResponse(
                ERROR_CODES.VALIDATION_ERROR,
                "Invalid access code format.",
              ),
            );
          if (room.accessCode !== code)
            return socket.emit(
              "error",
              createErrorResponse(
                ERROR_CODES.FORBIDDEN,
                "Incorrect access code.",
              ),
            );
          if (!validated && socket.handshake.session) {
            if (!socket.handshake.session.validatedRooms)
              socket.handshake.session.validatedRooms = {};
            socket.handshake.session.validatedRooms[data.roomId] = code;
            await promisifySessionSave(socket.handshake.session).catch(
              () => {},
            );
          }
        }
        joinRoom(socket, data.roomId, userId);
      }),
    );

    socket.on(
      "vote",
      safe(async (data) => {
        if (!data?.targetUserId) return;
        const userId = socket.handshake.session?.userId;
        const roomId = socket.roomId;
        if (!roomId || !userId) return;
        const room = state.rooms.get(roomId);
        if (
          !room ||
          !room.users.find((u) => u.id === userId) ||
          userId === data.targetUserId
        )
          return;
        if (!room.votes) room.votes = {};
        if (room.votes[userId] === data.targetUserId) delete room.votes[userId];
        else room.votes[userId] = data.targetUserId;
        emitRoomVoteUpdates(roomId);
        const votesAgainst = Object.values(room.votes).filter(
          (v) => v === data.targetUserId,
        ).length;
        if (
          room.users.length >= 3 &&
          votesAgainst > Math.floor(room.users.length / 2)
        ) {
          const target = findSocketByUserId(data.targetUserId, roomId);
          if (target) {
            target.emit("kicked");
            if (!room.bannedUserIds) room.bannedUserIds = new Set();
            room.bannedUserIds.add(data.targetUserId);
            await leaveRoom(target, data.targetUserId);
          }
        }
      }),
    );

    socket.on(
      "leave room",
      safe(async () => {
        const userId = socket.handshake.session?.userId;
        if (userId) {
          clearAFKTimers(userId);
          await leaveRoom(socket, userId);
        }
      }),
    );

    socket.on(
      "chat update",
      safe(async (data) => {
        if (!checkChatCircuit())
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.CIRCUIT_OPEN,
              "System temporarily unavailable.",
            ),
          );
        if (!socket.roomId || !socket.handshake.session?.userId) return;
        const userId = socket.handshake.session.userId;
        if (!data?.diff || typeof data.diff !== "object")
          return socket.emit(
            "error",
            createErrorResponse(ERROR_CODES.BAD_REQUEST, "Invalid chat data."),
          );
        const { diff } = data;
        if (!["full-replace", "add", "delete", "replace"].includes(diff.type))
          return socket.emit(
            "error",
            createErrorResponse(ERROR_CODES.BAD_REQUEST, "Unknown diff type."),
          );
        if (
          (diff.type === "add" ||
            diff.type === "replace" ||
            diff.type === "full-replace") &&
          typeof diff.text !== "string"
        )
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.BAD_REQUEST,
              "Diff text must be string.",
            ),
          );
        if (diff.text) diff.text = enforceCharacterLimit(diff.text);
        if (
          diff.type !== "full-replace" &&
          (typeof diff.index !== "number" || diff.index < 0)
        )
          return socket.emit(
            "error",
            createErrorResponse(ERROR_CODES.BAD_REQUEST, "Invalid diff index."),
          );
        if (
          diff.type === "delete" &&
          (typeof diff.count !== "number" || diff.count < 0)
        )
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.BAD_REQUEST,
              "Invalid delete count.",
            ),
          );

        if (!state.pendingChatUpdates.has(userId))
          state.pendingChatUpdates.set(userId, { diffs: [] });
        state.pendingChatUpdates.get(userId).diffs.push(diff);
        if (!state.batchProcessingTimers.has(userId)) {
          state.batchProcessingTimers.set(
            userId,
            setTimeout(
              () => processPendingChatUpdates(userId, socket),
              CONFIG.TIMING.BATCH_PROCESSING_INTERVAL,
            ),
          );
        }
      }),
    );

    socket.on(
      "typing",
      safe(async (data) => {
        if (!socket.roomId || !socket.handshake.session?.userId) return;
        const userId = socket.handshake.session.userId;
        const username = socket.handshake.session.username || "Anonymous";
        if (data?.isTyping === false) {
          handleTyping(socket, userId, username, false);
          return;
        }
        await typingLimiter.consume(userId).catch(() => {});
        if (!data || typeof data.isTyping !== "boolean") return;
        handleTyping(socket, userId, username, data.isTyping);
      }),
    );

    socket.on(
      "get rooms",
      safe(async () => {
        const data = Array.from(state.rooms.values())
          .filter((r) => r.type !== "private")
          .map((r) => formatRoomForSocket(r, socket));

        socket.emit("initial rooms", data);

        if (socket.isDev) {
          const codes = {};
          for (const [roomId, room] of state.rooms) {
            if (room.type === "semi-private" && room.accessCode) {
              codes[roomId] = room.accessCode;
            }
          }
          socket.emit("dev lobby context", codes);
        }
      }),
    );

    socket.on(
      "get room state",
      safe(async (roomId) => {
        if (!roomId || typeof roomId !== "string")
          return socket.emit(
            "error",
            createErrorResponse(ERROR_CODES.BAD_REQUEST, "Room ID required."),
          );
        const room = state.rooms.get(roomId);
        if (!room)
          return socket.emit(
            "error",
            createErrorResponse(ERROR_CODES.NOT_FOUND, "Room not found."),
          );
        socket.emit("room state", formatRoomStateForSocket(room, socket));
      }),
    );

    // ── DEV MODE: Force-kick ────────────────────────────────────────────
    socket.on(
      "dev force kick",
      safe(async (data) => {
        if (!socket.isDev) {
          return socket.emit(
            "error",
            createErrorResponse(ERROR_CODES.FORBIDDEN, "Access denied."),
          );
        }

        if (!data?.targetUserId || typeof data.targetUserId !== "string") {
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.BAD_REQUEST,
              "targetUserId required.",
            ),
          );
        }

        const targetUserId = data.targetUserId;
        let targetRoomId = null;
        let targetRoom = null;
        for (const [roomId, room] of state.rooms) {
          if (room.users && room.users.some((u) => u.id === targetUserId)) {
            targetRoomId = roomId;
            targetRoom = room;
            break;
          }
        }

        if (!targetRoom) {
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.NOT_FOUND,
              "User not found in any room.",
            ),
          );
        }

        const targetSocket = findSocketByUserId(targetUserId, targetRoomId);
        if (!targetSocket) {
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.NOT_FOUND,
              "User socket not found.",
            ),
          );
        }

        const targetUser = targetRoom.users.find((u) => u.id === targetUserId);
        const targetName = targetUser?.username || "Unknown";
        const roomName = targetRoom.name || targetRoomId;

        targetSocket.emit("kicked");
        await leaveRoom(targetSocket, targetUserId);

        console.log(
          `[DEV] Force-kicked "${targetName}" from "${roomName}" by dev user`,
        );

        socket.emit("dev kick success", {
          targetUserId,
          targetUsername: targetName,
          roomId: targetRoomId,
          roomName,
        });
      }),
    );

    // ── DEV MODE: Set username color ────────────────────────────────────
    socket.on(
      "dev set color",
      safe(async (data) => {
        if (!socket.isDev) return;
        if (!data?.color || typeof data.color !== "string") return;
        if (!/^#[0-9a-fA-F]{6}$/.test(data.color)) return;

        const userId = socket.handshake.session?.userId;
        if (!userId || !socket.roomId) return;

        const room = state.rooms.get(socket.roomId);
        if (!room) return;

        const user = room.users.find((u) => u.id === userId);
        if (user) {
          user.devColor = data.color;
        }

        updateRoom(socket.roomId);
      }),
    );

    // ── DEV MODE: Vanish (invisible to non-devs) ───────────────────────
    socket.on(
      "dev set vanish",
      safe(async (data) => {
        if (!socket.isDev) return;
        const desired =
          typeof data?.isVanished === "boolean"
            ? data.isVanished
            : !socket.isVanished;

        socket.isVanished = desired;

        const userId = socket.handshake.session?.userId;
        if (userId && socket.roomId) {
          const room = state.rooms.get(socket.roomId);
          const user = room?.users?.find((u) => u.id === userId);
          if (user) user.isVanished = desired;
          updateRoom(socket.roomId);
          updateLobby();
          sendDevRoomContext(socket.roomId);
        }
        socket.emit("dev vanish status", { isVanished: desired });
      }),
    );

    // ── DEV MODE: Hide flair (appear as normal user) ────────────────────
    socket.on(
      "dev set hide",
      safe(async (data) => {
        if (!socket.isDev) return;
        const desired =
          typeof data?.isHidden === "boolean"
            ? data.isHidden
            : !socket.isHidden;

        socket.isHidden = desired;

        if (socket.handshake?.session) {
          socket.handshake.session.isDevHidden = desired;
          await promisifySessionSave(socket.handshake.session).catch(() => {});
        }

        const userId = socket.handshake.session?.userId;
        if (userId && socket.roomId) {
          const room = state.rooms.get(socket.roomId);
          const user = room?.users?.find((u) => u.id === userId);
          if (user) user.isHidden = desired;
          updateRoom(socket.roomId);
          updateLobby();
          sendDevRoomContext(socket.roomId);
        }
        socket.emit("dev hide status", { isHidden: desired });
      }),
    );

    // ── AFK Response ────────────────────────────────────────────────────
    socket.on(
      "afk response",
      safe(async () => {
        const userId = socket.handshake.session?.userId;
        if (userId && socket.roomId) setupAFKTimers(socket, userId);
      }),
    );

    // ── Disconnect ──────────────────────────────────────────────────────
    socket.on(
      "disconnect",
      safe(async (reason) => {
        const userId = socket.handshake.session?.userId;
        const username = socket.handshake.session?.username || "Unknown";
        const location = socket.handshake.session?.location || "Unknown";
        if (userId) {
          clearAFKTimers(userId);
          await leaveRoom(socket, userId);
          state.userMessageBuffers.delete(userId);
          state.devUsers.delete(userId);
          if (state.typingTimeouts.has(userId)) {
            clearTimeout(state.typingTimeouts.get(userId));
            state.typingTimeouts.delete(userId);
          }
          if (state.batchProcessingTimers.has(userId)) {
            clearTimeout(state.batchProcessingTimers.get(userId));
            state.batchProcessingTimers.delete(userId);
            state.pendingChatUpdates.delete(userId);
          }
          state.users.delete(userId);
        }
        if (socket.clientIp) {
          const c = state.ipConnections.get(socket.clientIp) || 0;
          if (c > 1) state.ipConnections.set(socket.clientIp, c - 1);
          else state.ipConnections.delete(socket.clientIp);
        }
        console.log(
          `Disconnected: "${username}" from "${location}" (${reason}) IP:${socket.clientIp}${socket.isBot ? " [BOT]" : ""}${socket.isDev ? " [DEV]" : ""}`,
        );
      }),
    );
  });
}

// ── Cleanup Intervals ───────────────────────────────────────────────────────

function startCleanupIntervals() {
  // Pressure cleanup (30s)
  setInterval(async () => {
    try {
      await pressureCleanup();
    } catch (err) {
      console.error("Pressure cleanup error:", err);
    }
  }, CONFIG.LIMITS.PRESSURE_CLEANUP_INTERVAL);

  // Bot detection cleanup (2 min)
  setInterval(() => {
    const now = Date.now();
    for (const [id, attempts] of state.userJoinAttempts.entries()) {
      const valid = attempts.filter(
        (t) => now - t < CONFIG.LIMITS.BOT_DETECTION_WINDOW,
      );
      if (valid.length === 0) state.userJoinAttempts.delete(id);
      else state.userJoinAttempts.set(id, valid);
    }
    for (const [ip, attempts] of state.ipJoinAttempts.entries()) {
      const valid = attempts.filter(
        (t) => now - t < CONFIG.LIMITS.BOT_DETECTION_WINDOW,
      );
      if (valid.length === 0) state.ipJoinAttempts.delete(ip);
      else state.ipJoinAttempts.set(ip, valid);
    }
    for (const [id, data] of state.suspiciousUsers.entries()) {
      if (now - data.firstDetection > CONFIG.TIMING.BOT_BLOCK_DURATION)
        state.suspiciousUsers.delete(id);
    }
  }, 120000);

  // Bot token cleanup (daily)
  setInterval(() => {
    const now = Date.now();
    let expired = 0;
    for (const [token, data] of state.botTokens.entries()) {
      if (now - data.createdAt > CONFIG.TIMING.BOT_TOKEN_EXPIRY) {
        state.botTokens.delete(token);
        expired++;
        const c = state.ipBotTokenCounts.get(data.ip) || 0;
        if (c > 1) state.ipBotTokenCounts.set(data.ip, c - 1);
        else state.ipBotTokenCounts.delete(data.ip);
      }
    }
    if (expired > 0) console.log(`Cleaned ${expired} expired bot tokens`);
  }, CONFIG.TIMING.BOT_TOKEN_CLEANUP_INTERVAL);

  // IP user cleanup (hourly)
  setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [ip, data] of state.ipBasedUsers.entries()) {
      if (now - data.lastSeen > CONFIG.LIMITS.IP_USER_CLEANUP_INTERVAL) {
        state.ipBasedUsers.delete(ip);
        cleaned++;
      }
    }
    if (cleaned > 0) console.log(`Cleaned ${cleaned} inactive IP users`);
  }, CONFIG.LIMITS.IP_USER_CLEANUP_INTERVAL);

  // Resource cleanup (5 min)
  setInterval(() => {
    const active = new Set();
    for (const [, room] of state.rooms) {
      if (room.users) room.users.forEach((u) => active.add(u.id));
    }
    for (const id of state.userMessageBuffers.keys()) {
      if (!active.has(id)) state.userMessageBuffers.delete(id);
    }
    for (const id of state.typingTimeouts.keys()) {
      if (!active.has(id)) {
        clearTimeout(state.typingTimeouts.get(id));
        state.typingTimeouts.delete(id);
      }
    }
    for (const id of state.afkTimers.keys()) {
      if (!active.has(id)) clearAFKTimers(id);
    }
  }, 300000);

  // Cache cleanup (3 min)
  setInterval(() => {
    const active = new Set();
    for (const [, room] of state.rooms) {
      if (room.users) room.users.forEach((u) => active.add(u.id));
    }
    for (const id of state.batchProcessingTimers.keys()) {
      if (!active.has(id)) {
        clearTimeout(state.batchProcessingTimers.get(id));
        state.batchProcessingTimers.delete(id);
        state.pendingChatUpdates.delete(id);
      }
    }
    if (state.normalizeCache.size > 1000) {
      Array.from(state.normalizeCache.keys())
        .slice(0, 200)
        .forEach((k) => state.normalizeCache.delete(k));
    }
    const now = Date.now();
    for (const [k, v] of state.apiCache.entries()) {
      if (now - v.timestamp > state.API_CACHE_TTL) state.apiCache.delete(k);
    }
    for (const [ip, ts] of state.ipLastRoomCreation.entries()) {
      if (now - ts > 300000) state.ipLastRoomCreation.delete(ip);
    }
    for (const roomId of state.roomSoloSince.keys()) {
      if (!state.rooms.has(roomId)) state.roomSoloSince.delete(roomId);
    }
    for (const roomId of state.roomLastChatActivity.keys()) {
      if (!state.rooms.has(roomId)) state.roomLastChatActivity.delete(roomId);
    }
    for (const roomId of boardState.keys()) {
      if (!state.rooms.has(roomId)) boardState.delete(roomId);
    }
  }, 180000);

  // Empty room cleanup (10 min)
  setInterval(async () => {
    const now = Date.now();
    const toDelete = [];
    for (const [id, room] of state.rooms) {
      if (
        (!room.users || room.users.length === 0) &&
        now - room.lastActiveTime > CONFIG.TIMING.ROOM_DELETION_TIMEOUT
      )
        toDelete.push(id);
    }
    for (const id of toDelete) {
      state.rooms.delete(id);
      state.roomSoloSince.delete(id);
      state.roomLastChatActivity.delete(id);
      cleanupBoardState(id);
      if (state.roomDeletionTimers.has(id)) {
        clearTimeout(state.roomDeletionTimers.get(id));
        state.roomDeletionTimers.delete(id);
      }
    }
    if (toDelete.length > 0) {
      updateLobby();
      await debouncedSaveRooms();
      console.log(`Cleaned ${toDelete.length} empty rooms`);
    }
  }, 600000);

  // Ghost user cleanup (1 min)
  setInterval(() => {
    const activeIds = new Set();
    for (const [, s] of io().sockets.sockets) {
      const uid = s.handshake?.session?.userId;
      if (uid) activeIds.add(uid);
    }
    let ghostCount = 0;
    const affectedRooms = [];
    for (const [roomId, room] of state.rooms) {
      if (!room.users || room.users.length === 0) continue;
      const before = room.users.length;
      room.users = room.users.filter((u) => {
        if (!activeIds.has(u.id)) {
          console.log(`Ghost removed: "${u.username}" from "${room.name}"`);
          state.userMessageBuffers.delete(u.id);
          clearAFKTimers(u.id);
          state.devUsers.delete(u.id);
          finalizeBoardUserStroke(roomId, u.id);
          if (state.typingTimeouts.has(u.id)) {
            clearTimeout(state.typingTimeouts.get(u.id));
            state.typingTimeouts.delete(u.id);
          }
          if (state.batchProcessingTimers.has(u.id)) {
            clearTimeout(state.batchProcessingTimers.get(u.id));
            state.batchProcessingTimers.delete(u.id);
            state.pendingChatUpdates.delete(u.id);
          }
          return false;
        }
        return true;
      });
      const removed = before - room.users.length;
      if (removed > 0) {
        ghostCount += removed;
        affectedRooms.push(roomId);
      }
    }
    for (const id of affectedRooms) {
      const r = state.rooms.get(id);
      if (r) {
        updateRoom(id);
        updateRoomSoloTracking(id);
        if (r.users.length === 0) startRoomDeletionTimer(id);
      }
    }
    if (ghostCount > 0) {
      console.log(`Ghost cleanup: removed ${ghostCount} ghost(s)`);
      updateLobby();
      debouncedSaveRooms().catch(() => {});
    }
  }, 60000);

  // Server monitor (2 min)
  setInterval(() => {
    const mem = process.memoryUsage();
    const stats = getRoomStatistics();
    const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
    console.log(
      `[STATUS] Clients:${io().sockets.sockets.size} ` +
        `Rooms:${stats.totalRooms}/${stats.hardCap} ` +
        `Healthy:${stats.healthyRooms}/${stats.currentLimit} ` +
        `Solo:${stats.soloRooms} TTL:${stats.currentSoloTTL}s ` +
        `Users:${stats.totalUsers} Heap:${heapMB}MB ` +
        `Tokens:${state.botTokens.size} ` +
        `Devs:${state.devUsers.size} ` +
        `Boards:${boardState.size}`,
    );
    if (heapMB > 400) {
      console.warn(`MEMORY WARNING: ${heapMB}MB heap`);
      if (heapMB > 500) {
        for (const [id, msg] of state.userMessageBuffers.entries()) {
          if (msg.length > 1000)
            state.userMessageBuffers.set(id, msg.substring(0, 1000));
        }
        state.normalizeCache.clear();
        state.apiCache.clear();
        if (global.gc) global.gc();
      }
    }
  }, 120000);
}

// ── Ghost Purge (Startup) ───────────────────────────────────────────────────

function purgeAllGhostUsers() {
  let total = 0;
  for (const [roomId, room] of state.rooms) {
    if (room.users && room.users.length > 0) {
      console.log(
        `Startup purge: ${room.users.length} ghost(s) from "${room.name}"`,
      );
      total += room.users.length;
      room.users.forEach((u) => {
        state.userMessageBuffers.delete(u.id);
        clearAFKTimers(u.id);
        state.devUsers.delete(u.id);
      });
      room.users = [];
      room.votes = {};
      room.lastActiveTime = Date.now();
      cleanupBoardState(roomId);
      startRoomDeletionTimer(roomId);
    }
  }
  if (total > 0) {
    console.log(`Startup purge: removed ${total} ghost(s)`);
    debouncedSaveRooms().catch(() => {});
  } else console.log("Startup purge: no ghosts found");
}

// ── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  loadRooms,
  saveRooms,
  debouncedSaveRooms,
  registerSocketHandlers,
  startCleanupIntervals,
  purgeAllGhostUsers,
  updateLobby,
  getRoomStatistics,
  calculateCurrentRoomLimit,
  roomNameExists,
  startRoomDeletionTimer,
  leaveRoom,
  joinRoom,
};
