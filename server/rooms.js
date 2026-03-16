// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  FILE 3: server/rooms.js                                                ║
// ║  Room management, chat processing, AFK, sockets, cleanup                ║
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
  const totalUsers = getTotalUserCount();
  const currentLimit = calculateCurrentRoomLimit();
  const types = { public: 0, "semi-private": 0, private: 0 };
  let roomsWithUsers = 0;
  for (const [, room] of state.rooms) {
    if (types[room.type] !== undefined) types[room.type]++;
    if (room.users && room.users.length > 0) roomsWithUsers++;
  }
  return {
    totalRooms,
    totalUsers,
    currentLimit,
    roomsWithUsers,
    emptyRooms: totalRooms - roomsWithUsers,
    roomTypes: types,
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

// ── Room Save / Load ────────────────────────────────────────────────────────

async function saveRooms() {
  const now = Date.now();
  if (now - state.lastSaveTimestamp < state.SAVE_INTERVAL_MIN) return;
  try {
    // Serialize Sets as arrays for proper JSON round-trip
    const data = Array.from(state.rooms.entries()).map(([id, room]) => {
      return [
        id,
        { ...room, bannedUserIds: Array.from(room.bannedUserIds || []) },
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
          // Clear stale users from previous server process
          if (item[1].users && item[1].users.length > 0) {
            console.log(
              `Clearing ${item[1].users.length} stale user(s) from room: ${item[1].name || item[0]}`,
            );
          }
          item[1].users = [];
          item[1].lastActiveTime = Date.now();
          // Restore bannedUserIds as Set
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
    // Start deletion timers for all loaded empty rooms
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
    const publicRooms = Array.from(state.rooms.values())
      .filter((r) => r.type !== "private")
      .map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        isFull: r.users.length >= CONFIG.LIMITS.MAX_ROOM_CAPACITY,
        userCount: r.users.length,
        users: (r.users || []).map((u) => ({
          id: u.id,
          username: u.username,
          location: u.location,
        })),
      }));
    io().to("lobby").emit("lobby update", publicRooms);
  } catch (err) {
    console.error("updateLobby error:", err);
  }
}

function updateRoom(roomId) {
  if (!io()) return;
  const room = state.rooms.get(roomId);
  if (room) {
    io()
      .to(roomId)
      .emit("room update", {
        id: room.id,
        name: room.name,
        type: room.type,
        layout: room.layout,
        users: room.users || [],
        votes: room.votes || {},
      });
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

    // Strip RTL override and carriage returns
    msg = [...msg]
      .filter((c) => c.codePointAt(0) !== 8238)
      .join("")
      .replace(/\r/g, "");
    msg = enforceCharacterLimit(msg);
    state.userMessageBuffers.set(userId, msg);

    socket.to(socket.roomId).emit("chat update", {
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
    const room = state.rooms.get(roomId);
    if (room) {
      room.users = room.users.filter((u) => u.id !== userId);
      room.lastActiveTime = Date.now();
      if (room.votes) {
        delete room.votes[userId];
        for (const vid in room.votes) {
          if (room.votes[vid] === userId) delete room.votes[vid];
        }
        io().to(roomId).emit("update votes", room.votes);
      }
      socket.leave(roomId);
      io().to(roomId).emit("user left", userId);
      updateRoom(roomId);
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
    if (room.users.length >= CONFIG.LIMITS.MAX_ROOM_CAPACITY)
      return socket.emit(
        "room full",
        createErrorResponse(ERROR_CODES.ROOM_FULL, "Room is full."),
      );

    clearAFKTimers(userId);
    room.users = room.users.filter((u) => u.id !== userId);
    socket.join(roomId);
    room.users.push({ id: userId, username, location });
    room.lastActiveTime = Date.now();
    socket.roomId = roomId;
    setupAFKTimers(socket, userId);

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
  io().to(room.id).emit("user joined", {
    id: userId,
    username,
    location,
    roomName: room.name,
    roomType: room.type,
  });
  updateRoom(room.id);
  updateLobby();
  socket.emit("room joined", {
    roomId: room.id,
    userId,
    username,
    location,
    roomName: room.name,
    roomType: room.type,
    users: room.users,
    layout: room.layout,
    votes: room.votes,
    currentMessages: getCurrentMessages(room.users),
  });
  socket.leave("lobby");
  if (state.roomDeletionTimers.has(room.id)) {
    clearTimeout(state.roomDeletionTimers.get(room.id));
    state.roomDeletionTimers.delete(room.id);
  }
}

function handleTyping(socket, userId, username, isTyping) {
  if (!socket.roomId) return;
  setupAFKTimers(socket, userId);
  if (state.typingTimeouts.has(userId))
    clearTimeout(state.typingTimeouts.get(userId));
  if (isTyping) {
    socket
      .to(socket.roomId)
      .emit("user typing", { userId, username, isTyping: true });
    state.typingTimeouts.set(
      userId,
      setTimeout(() => {
        socket
          .to(socket.roomId)
          .emit("user typing", { userId, username, isTyping: false });
        state.typingTimeouts.delete(userId);
      }, CONFIG.TIMING.TYPING_TIMEOUT),
    );
  } else {
    socket
      .to(socket.roomId)
      .emit("user typing", { userId, username, isTyping: false });
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

    socket.onAny(() => {
      if (socket.roomId && socket.handshake.session?.userId)
        setupAFKTimers(socket, socket.handshake.session.userId);
    });

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
          socket.emit("signin status", {
            isSignedIn: true,
            username,
            location,
            userId,
            isIPBased: !!isIPBased,
            isBot: !!socket.isBot,
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
          });
        }
      }),
    );

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
        socket.join("lobby");
        updateLobby();
        socket.emit("signin status", {
          isSignedIn: true,
          username,
          location,
          userId,
          isIPBased: false,
          isBot: !!socket.isBot,
        });
      }),
    );

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

        const limit = calculateCurrentRoomLimit();
        if (state.rooms.size >= limit)
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.ROOM_LIMIT_REACHED,
              `Room limit reached (${limit}).`,
            ),
          );
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
          `Room created: ${roomId} (${roomName}) | ${stats.totalRooms}/${stats.currentLimit} rooms`,
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
        io().to(roomId).emit("update votes", room.votes);
        const votesAgainst = Object.values(room.votes).filter(
          (v) => v === data.targetUserId,
        ).length;
        if (
          room.users.length >= 3 &&
          votesAgainst > Math.floor(room.users.length / 2)
        ) {
          const target = [...io().sockets.sockets.values()].find(
            (s) =>
              s.handshake.session?.userId === data.targetUserId &&
              s.roomId === roomId,
          );
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

        setupAFKTimers(socket, userId);
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
        setupAFKTimers(socket, userId);
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
        const key = "socket_rooms";
        let data;
        const cached = state.apiCache.get(key);
        if (cached && Date.now() - cached.timestamp < state.API_CACHE_TTL) {
          data = cached.data;
        } else {
          data = Array.from(state.rooms.values())
            .filter((r) => r.type !== "private")
            .map((r) => ({
              id: r.id,
              name: r.name,
              type: r.type,
              isFull: r.users.length >= CONFIG.LIMITS.MAX_ROOM_CAPACITY,
              userCount: r.users.length,
              users: (r.users || []).map((u) => ({
                id: u.id,
                username: u.username,
                location: u.location,
              })),
            }));
          state.apiCache.set(key, { timestamp: Date.now(), data });
        }
        socket.emit("initial rooms", data);
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
        socket.emit("room state", {
          id: room.id,
          name: room.name,
          type: room.type,
          layout: room.layout,
          users: room.users,
          votes: room.votes,
          currentMessages: getCurrentMessages(room.users),
          isFull: room.users.length >= CONFIG.LIMITS.MAX_ROOM_CAPACITY,
        });
      }),
    );

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
          `Disconnected: "${username}" from "${location}" (${reason}) IP:${socket.clientIp}${socket.isBot ? " [BOT]" : ""}`,
        );
      }),
    );

    socket.on(
      "afk response",
      safe(async () => {
        const userId = socket.handshake.session?.userId;
        if (userId && socket.roomId) setupAFKTimers(socket, userId);
      }),
    );
  });
}

// ── Cleanup Intervals ───────────────────────────────────────────────────────

function startCleanupIntervals() {
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
      `[STATUS] Clients:${io().sockets.sockets.size} Rooms:${stats.totalRooms}/${stats.currentLimit} Users:${stats.totalUsers} Heap:${heapMB}MB Tokens:${state.botTokens.size}`,
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
      });
      room.users = [];
      room.votes = {};
      room.lastActiveTime = Date.now();
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
