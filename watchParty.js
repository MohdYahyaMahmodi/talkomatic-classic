const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const helmet = require("helmet");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// XSS Protection - HTML escaping function
function escapeHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

// Input validation function
function validateAndSanitizeString(input, maxLength, fieldName) {
  if (typeof input !== "string") {
    throw new Error(`${fieldName} must be a string`);
  }
  // Remove excessive whitespace
  input = input.trim();
  // Check length
  if (input.length > maxLength) {
    throw new Error(`${fieldName} must be ${maxLength} characters or less`);
  }
  // Basic XSS protection - remove HTML tags
  input = input.replace(/<[^>]*>/g, "");
  // Remove control characters except newlines and tabs
  input = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  return input;
}

// YouTube Video ID validation
function validateYouTubeVideoId(videoId) {
  const regex = /^[a-zA-Z0-9_-]{11}$/;
  return regex.test(videoId);
}

// Middleware with FIXED CSP for YouTube support
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "default-src": ["'self'"],
        "script-src": [
          "'self'",
          "'unsafe-inline'",
          "'unsafe-eval'",
          "https://cdn.tailwindcss.com",
          "https://www.gstatic.com",
          "https://apis.google.com",
          "https://www.youtube.com", // Added for YouTube iframe API
          "https://youtube.com", // Added for YouTube iframe API
          "blob:",
        ],
        "script-src-attr": ["'unsafe-inline'"],
        "object-src": ["'none'"],
        "frame-src": [
          "'self'",
          "https://www.youtube.com", // Added for YouTube embeds
          "https://youtube.com", // Added for YouTube embeds
        ],
        "frame-ancestors": ["'self'"],
        "connect-src": [
          "'self'",
          "ws://localhost:3000",
          "wss://yourdomain.com",
          "https://www.googleapis.com",
          "https://www.google.com",
          "https://www.youtube.com", // Added for YouTube API
          "https://youtube.com", // Added for YouTube API
        ],
        "img-src": ["'self'", "data:", "https://i.ytimg.com"], // Added for YouTube thumbnails
        "media-src": ["'self'", "blob:"],
        "style-src": [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com",
          "https://cdn.tailwindcss.com",
        ],
        "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
        "worker-src": ["'self'", "blob:"],
        "child-src": ["'self'", "blob:"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// In-memory storage for rooms and users
const rooms = new Map();
const users = new Map();
const waitingUsers = [];
const roomCleanupTimeouts = new Map();

// Generate unique room ID
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Generate unique user ID
function generateUserId() {
  return Math.random().toString(36).substring(2, 12);
}

// Schedule room for cleanup after delay
function scheduleRoomCleanup(roomId, delay = 10000) {
  console.log(`📅 Scheduling cleanup for room ${roomId} in ${delay}ms`);
  if (roomCleanupTimeouts.has(roomId)) {
    clearTimeout(roomCleanupTimeouts.get(roomId));
  }
  const timeoutId = setTimeout(() => {
    const room = rooms.get(roomId);
    if (room && room.users.size === 0) {
      rooms.delete(roomId);
      roomCleanupTimeouts.delete(roomId);
      console.log(`🗑️ Deleted empty room: ${roomId}`);
      if (room.isPublic) {
        io.emit("rooms-list", getPublicRooms());
      }
    } else if (room) {
      console.log(`✋ Room ${roomId} has users, canceling cleanup.`);
      roomCleanupTimeouts.delete(roomId);
    }
  }, delay);
  roomCleanupTimeouts.set(roomId, timeoutId);
}

// Cancel room cleanup
function cancelRoomCleanup(roomId) {
  if (roomCleanupTimeouts.has(roomId)) {
    console.log(`❌ Canceling cleanup for room ${roomId}`);
    clearTimeout(roomCleanupTimeouts.get(roomId));
    roomCleanupTimeouts.delete(roomId);
  }
}

// Get public rooms list
function getPublicRooms() {
  const publicRooms = [];
  for (const [roomId, room] of rooms.entries()) {
    if (room.isPublic) {
      publicRooms.push({
        id: roomId,
        name: escapeHtml(room.name),
        type: room.type,
        category: room.category,
        users: room.users.size,
        maxUsers: 10,
      });
    }
  }
  console.log(`📋 Public rooms list: ${publicRooms.length} rooms`);
  return publicRooms;
}

// Get users in room
function getRoomUsers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return Array.from(room.users)
    .map((userId) => {
      for (const userObj of users.values()) {
        if (userObj.id === userId) {
          return {
            id: userObj.id,
            username: escapeHtml(userObj.username),
            location: escapeHtml(userObj.location || ""),
            socketId: userObj.socketId,
          };
        }
      }
      return null;
    })
    .filter(Boolean);
}

// Remove user from waiting list
function removeFromWaitingList(socketId) {
  const index = waitingUsers.findIndex((w) => w.socketId === socketId);
  if (index !== -1) {
    const removed = waitingUsers.splice(index, 1)[0];
    console.log(`❌ Removed ${removed.username} from waiting list`);
    return true;
  }
  return false;
}

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log(`🔌 User connected: ${socket.id}`);
  let currentUserId = null;

  // Handle user connection
  socket.on("user-connected", (userData) => {
    try {
      let username = userData.username || "";
      let location = userData.location || "";

      if (!username.trim()) {
        username = "Anonymous";
      }
      if (!location.trim()) {
        location = "Earth";
      }

      username = validateAndSanitizeString(username, 12, "Username");
      location = validateAndSanitizeString(location, 15, "Location");

      if (!username) {
        username = "Anonymous";
      }

      let user = users.get(socket.id);
      if (user) {
        user.username = username;
        user.location = location;
        console.log(
          `👤 User ${user.username} (ID: ${user.id}) re-confirmed connection.`
        );
      } else {
        const userId = generateUserId();
        currentUserId = userId;
        user = {
          id: userId,
          socketId: socket.id,
          username: username,
          location: location,
          connectedAt: new Date(),
          currentRoom: null,
        };
        users.set(socket.id, user);
        console.log(`👤 User ${user.username} registered (ID: ${userId}).`);
      }

      io.emit("online-count", users.size);
      socket.emit("rooms-list", getPublicRooms());
    } catch (error) {
      console.error(`❌ User connection error: ${error.message}`);
      socket.emit("error", error.message);
    }
  });

  // Handle room creation
  socket.on("create-room", (roomData) => {
    try {
      const user = users.get(socket.id);
      if (!user) {
        socket.emit("error", "User not found. Please save your profile first.");
        return;
      }

      const roomName = validateAndSanitizeString(
        roomData.name || "",
        20,
        "Room name"
      );
      const isPublic = Boolean(roomData.isPublic);

      if (!roomName) {
        socket.emit("error", "Room name is required and must not be empty");
        return;
      }

      const roomId = generateRoomId();
      const room = {
        id: roomId,
        name: roomName,
        type: "text",
        category: roomData.category || "general",
        isPublic: isPublic,
        host: user.id,
        hostSocketId: socket.id,
        users: new Set(),
        createdAt: new Date(),
        currentVideo: null,
        videoState: {
          isPlaying: false,
          currentTime: 0,
          lastUpdate: Date.now(),
        },
      };

      rooms.set(roomId, room);
      console.log(
        `🏗️ Room created: ${roomId} by ${user.username} (${roomName}) - Host: ${user.id}`
      );

      if (room.isPublic) {
        io.emit("rooms-list", getPublicRooms());
      }

      socket.emit("room-created", { id: roomId });
    } catch (error) {
      console.error(`❌ Room creation error: ${error.message}`);
      socket.emit("error", error.message);
    }
  });

  // Handle joining room
  socket.on("join-room", (roomId) => {
    try {
      roomId = validateAndSanitizeString(roomId || "", 10, "Room ID");
      const user = users.get(socket.id);
      const room = rooms.get(roomId);

      console.log(
        `🚪 Join room request: ${
          user?.username || `Socket ${socket.id}`
        } -> ${roomId}`
      );

      if (!user) {
        socket.emit("error", "User not found. Please save your profile first.");
        return;
      }

      if (!room) {
        socket.emit("error", "Room not found");
        return;
      }

      if (room.users.size >= 10 && !room.users.has(user.id)) {
        socket.emit("error", "Room is full");
        return;
      }

      cancelRoomCleanup(roomId);

      // If user was in another room, leave it first
      if (user.currentRoom && user.currentRoom !== roomId) {
        const oldRoom = rooms.get(user.currentRoom);
        if (oldRoom) {
          oldRoom.users.delete(user.id);
          socket.leave(user.currentRoom);
          io.to(user.currentRoom).emit("user-left", user.id);

          if (oldRoom.host === user.id && oldRoom.users.size > 0) {
            const remainingUsersInOldRoom = getRoomUsers(user.currentRoom);
            if (remainingUsersInOldRoom.length > 0) {
              oldRoom.host = remainingUsersInOldRoom[0].id;
              oldRoom.hostSocketId = remainingUsersInOldRoom[0].socketId;
              io.to(user.currentRoom).emit("host-changed", oldRoom.host);
            }
          }

          io.to(user.currentRoom).emit(
            "users-updated",
            getRoomUsers(user.currentRoom)
          );
          if (oldRoom.users.size === 0) scheduleRoomCleanup(user.currentRoom);
        }
      }

      socket.join(roomId);
      room.users.add(user.id);
      user.currentRoom = roomId;

      console.log(
        `✅ ${user.username} joined room ${roomId} (${room.users.size}/10 users)`
      );

      let hostAssignedOrReassigned = false;
      const hostUserObject = room.host
        ? Array.from(users.values()).find(
            (u) =>
              u.id === room.host &&
              u.currentRoom === roomId &&
              room.users.has(u.id)
          )
        : null;

      if (!room.host || !hostUserObject) {
        if (room.users.size > 0) {
          room.host = user.id;
          room.hostSocketId = user.socketId;
          hostAssignedOrReassigned = true;
          console.log(
            `👑 Room ${roomId} host assigned: ${user.username} (${user.id})`
          );
        }
      }

      const roomUsers = getRoomUsers(roomId);
      socket.emit("room-joined", {
        room: {
          id: room.id,
          name: escapeHtml(room.name),
          type: room.type,
          host: room.host,
          currentVideo: room.currentVideo,
        },
        users: roomUsers,
        yourUserId: user.id,
      });

      if (hostAssignedOrReassigned) {
        io.to(roomId).emit("host-changed", room.host);
      }

      socket.to(roomId).emit("user-joined", {
        id: user.id,
        username: escapeHtml(user.username),
        location: escapeHtml(user.location),
      });

      io.to(roomId).emit("users-updated", roomUsers);

      if (room.isPublic) {
        io.emit("rooms-list", getPublicRooms());
      }
    } catch (error) {
      console.error(`❌ Join room error: ${error.message}`);
      socket.emit("error", error.message);
    }
  });

  // Handle leaving room
  socket.on("leave-room", () => {
    const user = users.get(socket.id);
    if (user && user.currentRoom) {
      const roomId = user.currentRoom;
      const room = rooms.get(roomId);

      if (room) {
        room.users.delete(user.id);
        socket.leave(roomId);
        console.log(
          `🚪 ${user.username} left room ${roomId} (${room.users.size} users remaining)`
        );

        socket.to(roomId).emit("user-left", user.id);

        let hostChanged = false;
        if (room.host === user.id) {
          if (room.users.size > 0) {
            const remainingUsers = getRoomUsers(roomId);
            if (remainingUsers.length > 0) {
              room.host = remainingUsers[0].id;
              room.hostSocketId = remainingUsers[0].socketId;
              console.log(
                `👑 Host transferred in room ${roomId} to ${room.host}`
              );
              hostChanged = true;
            }
          } else {
            room.host = null;
            room.hostSocketId = null;
            console.log(`👻 Room ${roomId} is now empty, host cleared.`);
          }
        }

        const currentRoomUsers = getRoomUsers(roomId);
        io.to(roomId).emit("users-updated", currentRoomUsers);

        if (hostChanged) {
          io.to(roomId).emit("host-changed", room.host);
        }

        if (room.users.size === 0) {
          scheduleRoomCleanup(roomId);
        } else if (room.isPublic) {
          io.emit("rooms-list", getPublicRooms());
        }
      }
      user.currentRoom = null;
    }
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    const user = users.get(socket.id);
    if (user) {
      console.log(`🔌 User ${user.username} (ID: ${user.id}) disconnected`);

      removeFromWaitingList(socket.id);

      if (user.currentRoom) {
        const roomId = user.currentRoom;
        const room = rooms.get(roomId);

        if (room) {
          room.users.delete(user.id);
          console.log(
            `🚪 ${user.username} auto-left room ${roomId} on disconnect. Users left: ${room.users.size}`
          );

          socket.to(roomId).emit("user-left", user.id);

          let hostChanged = false;
          if (room.host === user.id) {
            if (room.users.size > 0) {
              const remainingUsers = getRoomUsers(roomId);
              if (remainingUsers.length > 0) {
                room.host = remainingUsers[0].id;
                room.hostSocketId = remainingUsers[0].socketId;
                console.log(
                  `👑 Host auto-transferred in ${roomId} to ${room.host}`
                );
                hostChanged = true;
              }
            } else {
              room.host = null;
              room.hostSocketId = null;
              console.log(`👻 Room ${roomId} became empty on host disconnect.`);
            }
          }

          const currentRoomUsers = getRoomUsers(roomId);
          io.to(roomId).emit("users-updated", currentRoomUsers);

          if (hostChanged) {
            io.to(roomId).emit("host-changed", room.host);
          }

          if (room.users.size === 0) {
            scheduleRoomCleanup(roomId);
          } else if (room.isPublic) {
            io.emit("rooms-list", getPublicRooms());
          }
        }
      }
      users.delete(socket.id);
    }

    io.emit("online-count", users.size);
    console.log(`👥 Online users: ${users.size}`);
  });

  // Handle getting rooms list
  socket.on("get-rooms", () => {
    socket.emit("rooms-list", getPublicRooms());
  });

  // Handle chat messages
  socket.on("chat-message", (data) => {
    try {
      const user = users.get(socket.id);
      if (!user || !user.currentRoom) {
        return;
      }

      const messageText = validateAndSanitizeString(
        data.text || "",
        500,
        "Message"
      );
      if (!messageText) {
        return;
      }

      const message = {
        id: Date.now().toString(),
        userId: user.id,
        username: escapeHtml(user.username),
        text: escapeHtml(messageText),
        timestamp: new Date(),
      };

      console.log(
        `💬 Chat in ${user.currentRoom}: ${user.username}: ${messageText}`
      );
      io.to(user.currentRoom).emit("chat-message", message);
    } catch (error) {
      console.error(`❌ Chat message error: ${error.message}`);
      socket.emit("error", "Invalid message format");
    }
  });

  // YouTube video sync events
  socket.on("video-change", (data) => {
    try {
      const user = users.get(socket.id);
      if (!user || !user.currentRoom) {
        console.log(`❌ Video change rejected: User not in room`);
        return;
      }

      const room = rooms.get(user.currentRoom);
      if (!room) {
        console.log(`❌ Video change rejected: Room not found`);
        return;
      }

      // Only host can change video
      if (room.host !== user.id) {
        console.log(`❌ Video change rejected: ${user.username} is not host`);
        socket.emit("error", "Only the host can change videos");
        return;
      }

      const videoId = data.videoId;
      if (!validateYouTubeVideoId(videoId)) {
        console.log(`❌ Invalid YouTube video ID: ${videoId}`);
        socket.emit("video-load-error", "Invalid YouTube video ID");
        return;
      }

      // Update room's current video
      room.currentVideo = videoId;
      room.videoState = {
        isPlaying: false,
        currentTime: 0,
        lastUpdate: Date.now(),
      };

      console.log(
        `🎬 Host ${user.username} changed video in room ${user.currentRoom} to: ${videoId}`
      );

      // Broadcast to all users in room (including host for confirmation)
      io.to(user.currentRoom).emit("video-change", { videoId: videoId });

      // Send success confirmation to host
      socket.emit("video-load-success", { videoId: videoId });
    } catch (error) {
      console.error(`❌ Video change error: ${error.message}`);
      socket.emit("video-load-error", "Failed to change video");
    }
  });

  socket.on("video-play", (data) => {
    try {
      const user = users.get(socket.id);
      if (!user || !user.currentRoom) return;

      const room = rooms.get(user.currentRoom);
      if (!room || room.host !== user.id) {
        console.log(`❌ Video play rejected: ${user.username} is not host`);
        return;
      }

      const currentTime = data.time || 0;
      room.videoState = {
        isPlaying: true,
        currentTime: currentTime,
        lastUpdate: Date.now(),
      };

      console.log(
        `▶️ Host ${user.username} played video at ${currentTime}s in room ${user.currentRoom}`
      );
      socket.to(user.currentRoom).emit("video-play", { time: currentTime });
    } catch (error) {
      console.error(`❌ Video play error: ${error.message}`);
    }
  });

  socket.on("video-pause", (data) => {
    try {
      const user = users.get(socket.id);
      if (!user || !user.currentRoom) return;

      const room = rooms.get(user.currentRoom);
      if (!room || room.host !== user.id) {
        console.log(`❌ Video pause rejected: ${user.username} is not host`);
        return;
      }

      const currentTime = data.time || 0;
      room.videoState = {
        isPlaying: false,
        currentTime: currentTime,
        lastUpdate: Date.now(),
      };

      console.log(
        `⏸️ Host ${user.username} paused video at ${currentTime}s in room ${user.currentRoom}`
      );
      socket.to(user.currentRoom).emit("video-pause", { time: currentTime });
    } catch (error) {
      console.error(`❌ Video pause error: ${error.message}`);
    }
  });

  socket.on("video-seek", (data) => {
    try {
      const user = users.get(socket.id);
      if (!user || !user.currentRoom) return;

      const room = rooms.get(user.currentRoom);
      if (!room || room.host !== user.id) {
        console.log(`❌ Video seek rejected: ${user.username} is not host`);
        return;
      }

      const currentTime = data.time || 0;
      room.videoState.currentTime = currentTime;
      room.videoState.lastUpdate = Date.now();

      console.log(
        `⏩ Host ${user.username} seeked video to ${currentTime}s in room ${user.currentRoom}`
      );
      socket.to(user.currentRoom).emit("video-seek", { time: currentTime });
    } catch (error) {
      console.error(`❌ Video seek error: ${error.message}`);
    }
  });

  // Random Match System
  socket.on("find-random-match", () => {
    const user = users.get(socket.id);
    if (!user) {
      socket.emit("error", "User not found. Please save profile.");
      return;
    }

    console.log(`🎲 ${user.username} looking for random match...`);

    const existingIndex = waitingUsers.findIndex(
      (w) => w.socketId === socket.id
    );
    if (existingIndex !== -1) {
      console.log(`⏳ User ${user.username} already waiting.`);
      socket.emit("waiting-for-match");
      return;
    }

    if (waitingUsers.length > 0) {
      let partnerIndex = -1;
      for (let i = 0; i < waitingUsers.length; i++) {
        if (waitingUsers[i].socketId !== socket.id) {
          partnerIndex = i;
          break;
        }
      }

      if (partnerIndex !== -1) {
        const partner = waitingUsers.splice(partnerIndex, 1)[0];
        const partnerSocket = io.sockets.sockets.get(partner.socketId);

        if (partnerSocket && partner.socketId !== socket.id) {
          try {
            const roomId = generateRoomId();
            const sanitizedUserName = escapeHtml(user.username);
            const sanitizedPartnerName = escapeHtml(partner.username);

            const room = {
              id: roomId,
              name: `Random Match: ${sanitizedUserName} & ${sanitizedPartnerName}`,
              type: "text",
              category: "random",
              isPublic: false,
              host: user.id,
              hostSocketId: socket.id,
              users: new Set(),
              createdAt: new Date(),
              currentVideo: null,
              videoState: {
                isPlaying: false,
                currentTime: 0,
                lastUpdate: Date.now(),
              },
            };

            rooms.set(roomId, room);

            socket.emit("match-found");
            partnerSocket.emit("match-found");

            setTimeout(() => {
              socket.emit("room-created", { id: roomId });
              partnerSocket.emit("room-created", { id: roomId });
              console.log(
                `💕 Random match room ${roomId} created for ${user.username} and ${partner.username}`
              );
            }, 1500);
            return;
          } catch (error) {
            console.error(`❌ Error creating match room: ${error.message}`);
            socket.emit("error", "Failed to create match room");
            partnerSocket.emit("error", "Failed to create match room");
            return;
          }
        }
      }
    }

    waitingUsers.push({
      socketId: socket.id,
      username: user.username,
      timestamp: Date.now(),
    });

    socket.emit("waiting-for-match");
    console.log(
      `⏳ ${user.username} added to waiting list. Total: ${waitingUsers.length}`
    );
  });

  socket.on("cancel-random-match", () => {
    console.log(`📨 Received cancel-random-match from ${socket.id}`);
    const user = users.get(socket.id);
    if (user) {
      const removed = removeFromWaitingList(socket.id);
      if (removed) {
        socket.emit("match-cancelled");
        console.log(
          `❌ ${user.username} cancelled random match search - removed from list`
        );
      } else {
        socket.emit("match-cancelled");
      }
    }
  });
});

// Routes
// WatchParty homepage
app.get("/watchparty", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "watchparty", "index.html"));
});

app.get("/watchparty/room/:roomId", (req, res) => {
  let roomId;
  try {
    roomId = validateAndSanitizeString(
      req.params.roomId.toUpperCase(),
      10,
      "Room ID"
    );
  } catch (error) {
    console.log(`❌ Invalid WatchParty room ID in URL: ${req.params.roomId}`);
    return res.redirect("/watchparty?error=invalidRoomId");
  }

  const room = rooms.get(roomId);
  if (!room) {
    console.log(
      `❌ Access to non-existent WatchParty room: ${roomId}. Redirecting.`
    );
    return res.redirect(
      "/watchparty?error=roomNotFound&room=" + encodeURIComponent(roomId)
    );
  }

  console.log(`🚪 Page access to WatchParty room ${roomId}: ${room.name}`);
  res.sendFile(path.join(__dirname, "public", "watchparty", "room.html"));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Express error:", err);
  res.status(500).send("Something went wrong!");
});

// Clean up waiting users periodically
setInterval(() => {
  const now = Date.now();
  const beforeCleanup = waitingUsers.length;
  for (let i = waitingUsers.length - 1; i >= 0; i--) {
    if (now - waitingUsers[i].timestamp > 60000) {
      const timedOutUserSocket = io.sockets.sockets.get(
        waitingUsers[i].socketId
      );
      if (timedOutUserSocket) {
        timedOutUserSocket.emit("match-timeout");
      }
      console.log(
        `⏳ Removed ${waitingUsers[i].username} from waiting list (timeout)`
      );
      waitingUsers.splice(i, 1);
    }
  }
  if (beforeCleanup > 0 && beforeCleanup !== waitingUsers.length) {
    console.log(
      `⏳ Waiting list cleanup done. Remaining: ${waitingUsers.length}`
    );
  }
}, 15000);

// Status logging
setInterval(() => {
  console.log(
    `📊 Status: ${users.size} users online, ${rooms.size} rooms active (${
      getPublicRooms().length
    } public), ${waitingUsers.length} waiting for match.`
  );
}, 60000);

const PORT = 3009;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Visit http://localhost:${PORT} to access the app`);
});
