/****************************
 * server.js
 * ==========================
 * Last updated: 2025
 ****************************/

require('dotenv').config(); // Loads environment vars from .env

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const sharedsession = require("express-socket.io-session");
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const xss = require('xss-clean');
const hpp = require('hpp');
const crypto = require('crypto');
const WordFilter = require('./public/js/word-filter.js');

const wordFilter = new WordFilter(
  path.join(__dirname, 'public', 'js', 'offensive_words.json')
);

const lastRoomCreationTimes = new Map();
const ROOM_CREATION_COOLDOWN = 30000; // 30 seconds cooldown

const app = express();
const server = http.createServer(app);

// Parse JSON bodies for the REST API
app.use(express.json());

// Security & limits
function sanitizeInput(input) {
  return input;
}

const MAX_USERNAME_LENGTH = 12;
const MAX_LOCATION_LENGTH = 12;
const MAX_ROOM_NAME_LENGTH = 20;
const MAX_MESSAGE_LENGTH = 5000;
const MAX_ROOM_CAPACITY = 5;

const ENABLE_WORD_FILTER = true;

// Allowed origins for CORS
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://classic.talkomatic.co'
  // Add other allowed frontends here, if needed.
];

// CORS config
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      return callback(
        new Error('The CORS policy does not allow access from this origin.'),
        false
      );
    }
    return callback(null, true);
  },
  methods: ['GET', 'POST'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
};

app.use(cors(corsOptions));
app.use(cookieParser());

// Setup a nonce for each request for CSP
app.use((req, res, next) => {
  res.locals.nonce = crypto.randomBytes(16).toString('base64');
  next();
});

// Helmet config for improved security
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "'unsafe-eval'",
          "https://cdnjs.cloudflare.com",
          (req, res) => `'nonce-${res.locals.nonce}'`
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://cdnjs.cloudflare.com",
          "https://fonts.googleapis.com"
        ],
        imgSrc: ["'self'", "data:", "https:", "blob:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
        styleSrcElem: [
          "'self'",
          "'unsafe-inline'",
          "https://cdnjs.cloudflare.com",
          "https://fonts.googleapis.com"
        ],
        scriptSrcElem: [
          "'self'",
          "https://cdnjs.cloudflare.com",
          "https://classic.talkomatic.co",
          (req, res) => `'nonce-${res.locals.nonce}'`
        ]
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: false
  })
);

app.use(xss());
app.use(hpp());

// Rate limit: 1000 requests per 15 minutes
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
});
app.use(limiter);

// Session config
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || '723698977cc31aaf8e84...',
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 14 * 24 * 60 * 60 * 1000,
  }
});
app.use(sessionMiddleware);

// Socket.io setup with shared session
const io = socketIo(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  }
});
io.use(sharedsession(sessionMiddleware, { autoSave: true }));

// Serve static files
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=31536000');
    }
    if (filePath.endsWith('.ttf')) {
      res.setHeader('Content-Type', 'font/ttf');
    }
  }
}));

// In-memory data
let rooms = new Map();
const users = new Map();
const roomDeletionTimers = new Map();
const typingTimeouts = new Map();
const userMessageBuffers = new Map();

/**
 * Convert strings to lower-case for consistent checks
 */
function normalize(str) {
  return (str || '').trim().toLowerCase();
}

/**
 * Count how many rooms a given session (by userId) is in
 */
function getUserRoomsCount(userId) {
  let count = 0;
  for (const [, room] of rooms) {
    if (room.users.some(u => u.id === userId)) {
      count++;
    }
  }
  return count;
}

/**
 * Count how many rooms have the same (username, location) *case-insensitive*
 */
function getUsernameLocationRoomsCount(username, location) {
  const userLower = normalize(username);
  const locLower = normalize(location);

  let count = 0;
  for (const [, room] of rooms) {
    for (const u of room.users) {
      if (normalize(u.username) === userLower && normalize(u.location) === locLower) {
        count++;
      }
    }
  }
  return count;
}

// Helper functions
function enforceCharacterLimit(message) {
  return typeof message === 'string' ? message.slice(0, MAX_MESSAGE_LENGTH) : message;
}
function enforceUsernameLimit(username) {
  return username.slice(0, MAX_USERNAME_LENGTH);
}
function enforceLocationLimit(location) {
  return location.slice(0, MAX_LOCATION_LENGTH);
}
function enforceRoomNameLimit(roomName) {
  return roomName.slice(0, MAX_ROOM_NAME_LENGTH);
}

async function saveRooms() {
  try {
    const roomsData = JSON.stringify(Array.from(rooms.entries()));
    await fs.writeFile(path.join(__dirname, 'rooms.json'), roomsData);
  } catch (error) {
    console.error('Error saving rooms:', error);
  }
}

async function loadRooms() {
  try {
    const roomsData = await fs.readFile(path.join(__dirname, 'rooms.json'), 'utf8');
    const loadedRooms = JSON.parse(roomsData);
    rooms = new Map(loadedRooms);
    // Clear all rooms on server restart
    rooms.clear();
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Error loading rooms:', error);
    }
  }
}
loadRooms();

function generateRoomId() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function startRoomDeletionTimer(roomId) {
  if (roomDeletionTimers.has(roomId)) {
    clearTimeout(roomDeletionTimers.get(roomId));
  }
  const timer = setTimeout(() => {
    rooms.delete(roomId);
    roomDeletionTimers.delete(roomId);
    updateLobby();
    saveRooms();
  }, 15000);
  roomDeletionTimers.set(roomId, timer);
}

function updateLobby() {
  const publicRooms = Array.from(rooms.values())
    .filter(room => room.type !== 'private')
    .map(room => ({
      ...room,
      accessCode: undefined, // Hide the access code
      isFull: room.users.length >= MAX_ROOM_CAPACITY
    }));
  io.to('lobby').emit('lobby update', publicRooms);
}

function updateRoom(roomId) {
  const room = rooms.get(roomId);
  if (room) {
    io.to(roomId).emit('room update', {
      id: room.id,
      name: room.name,
      type: room.type,
      layout: room.layout,
      users: room.users,
      votes: room.votes,
      accessCode: undefined // do not expose
    });
  }
}

function getCurrentMessages(users) {
  const messages = {};
  users.forEach(user => {
    messages[user.id] = userMessageBuffers.get(user.id) || '';
  });
  return messages;
}

async function leaveRoom(socket, userId) {
  if (socket.roomId) {
    const room = rooms.get(socket.roomId);
    if (room) {
      room.users = room.users.filter(user => user.id !== userId);
      room.lastActiveTime = Date.now();

      // Remove any votes from or for this user
      if (room.votes) {
        delete room.votes[userId];
        for (let voterId in room.votes) {
          if (room.votes[voterId] === userId) {
            delete room.votes[voterId];
          }
        }
        io.to(socket.roomId).emit('update votes', room.votes);
      }

      socket.leave(socket.roomId);
      io.to(socket.roomId).emit('user left', userId);
      updateRoom(socket.roomId);

      if (room.users.length === 0) {
        startRoomDeletionTimer(socket.roomId);
      }
    }

    // Clean up validated access codes when leaving a room
    if (socket.handshake.session.validatedRooms && 
        socket.handshake.session.validatedRooms[socket.roomId]) {
      delete socket.handshake.session.validatedRooms[socket.roomId];
    }

    socket.roomId = null;
    socket.handshake.session.currentRoom = null;
    await new Promise((resolve) => {
      socket.handshake.session.save(resolve);
    });
    socket.join('lobby');
  }
  updateLobby();
  await saveRooms();
}

/**
 * Join room logic:
 *  - If user is anonymous (case-insensitive 'anonymous'/'on the web'),
 *    skip the 2-room checks.
 *  - Otherwise, check userRoomsCount and sameNameLocCount.
 */
function joinRoom(socket, roomId, userId) {
  // Validate
  if (!roomId || typeof roomId !== 'string' || roomId.length !== 6) {
    socket.emit('room not found');
    return;
  }

  const room = rooms.get(roomId);
  if (!room) {
    socket.emit('room not found');
    return;
  }

  // Check if user is banned
  if (room.bannedUserIds && room.bannedUserIds.has(userId)) {
    socket.emit('error', 'You have been banned from rejoining this room.');
    return;
  }

  let { username, location } = socket.handshake.session;
  const userLower = normalize(username);
  const locLower = normalize(location);

  const isAnonymous =
    userLower === 'anonymous' && locLower === 'on the web';

  // Only enforce checks if not anonymous
  if (!isAnonymous) {
    // Check how many rooms this session is in
    const userRoomsCount = getUserRoomsCount(userId);
    if (userRoomsCount >= 2) {
      socket.emit('error', 'unable to join room at the moment please try again later');
      return;
    }

    // Check how many rooms exist with same (username, location)
    const sameNameLocCount = getUsernameLocationRoomsCount(username, location);
    if (sameNameLocCount >= 2) {
      socket.emit('error', 'unable to join room at the moment please try again later');
      return;
    }
  }

  if (!room.users) room.users = [];
  if (!room.votes) room.votes = {};

  if (room.users.length >= MAX_ROOM_CAPACITY) {
    socket.emit('room full');
    return;
  }

  // Remove if they're already in (avoid duplicates)
  room.users = room.users.filter(user => user.id !== userId);

  socket.join(roomId);
  room.users.push({
    id: userId,
    username,
    location,
  });
  room.lastActiveTime = Date.now();
  socket.roomId = roomId;
  socket.handshake.session.currentRoom = roomId;
  socket.handshake.session.save(() => {
    io.to(roomId).emit('user joined', {
      id: userId,
      username,
      location,
      roomName: room.name,
      roomType: room.type
    });
    
    updateRoom(roomId);
    updateLobby();

    const currentMessages = getCurrentMessages(room.users);
    socket.emit('room joined', {
      roomId: roomId,
      userId,
      username,
      location,
      roomName: room.name,
      roomType: room.type,
      users: room.users,
      layout: room.layout,
      votes: room.votes,
      currentMessages: currentMessages
    });
    socket.leave('lobby');

    if (roomDeletionTimers.has(roomId)) {
      clearTimeout(roomDeletionTimers.get(roomId));
      roomDeletionTimers.delete(roomId);
    }
  });
  saveRooms();
}

function handleTyping(socket, userId, username, isTyping) {
  if (typingTimeouts.has(userId)) {
    clearTimeout(typingTimeouts.get(userId));
  }
  if (isTyping) {
    socket.to(socket.roomId).emit('user typing', { userId, username, isTyping: true });
    typingTimeouts.set(userId, setTimeout(() => {
      socket.to(socket.roomId).emit('user typing', { userId, username, isTyping: false });
      typingTimeouts.delete(userId);
    }, 2000));
  } else {
    socket.to(socket.roomId).emit('user typing', { userId, username, isTyping: false });
    typingTimeouts.delete(userId);
  }
}

/***************************************
 * SOCKET.IO CONNECTION & EVENT HANDLERS
 ***************************************/
io.on('connection', (socket) => {
  socket.on('check signin status', () => {
    const { username, location, userId } = socket.handshake.session;
    if (username && location && userId) {
      socket.emit('signin status', {
        isSignedIn: true,
        username,
        location,
        userId
      });
      socket.join('lobby');
      users.set(userId, { id: userId, username, location });
      updateLobby();
    } else {
      socket.emit('signin status', { isSignedIn: false });
    }
  });

  socket.on('join lobby', (data) => {
    try {
      if (!data) {
        socket.emit('error', 'No data provided when joining lobby.');
        return;
      }
      // Normalize user inputs
      let username = enforceUsernameLimit(data.username || '');
      let location = enforceLocationLimit(data.location || 'On The Web');

      if (ENABLE_WORD_FILTER) {
        const usernameCheck = wordFilter.checkText(username);
        if (usernameCheck.hasOffensiveWord) {
          socket.emit('error', 'Your chosen name contains forbidden words. Please pick another.');
          return;
        }
        const locationCheck = wordFilter.checkText(location);
        if (locationCheck.hasOffensiveWord) {
          socket.emit('error', 'Your chosen location contains forbidden words. Please pick another.');
          return;
        }
      }

      const userId = socket.handshake.sessionID;
      socket.handshake.session.username = username;
      socket.handshake.session.location = location;
      socket.handshake.session.userId = userId;

      socket.handshake.session.save((err) => {
        if (!err) {
          users.set(userId, { id: userId, username, location });
          socket.join('lobby');
          updateLobby();
          socket.emit('signin status', {
            isSignedIn: true,
            username,
            location,
            userId
          });
        }
      });
    } catch (err) {
      console.error('Error in join lobby:', err);
      socket.emit('error', 'Internal server error while joining lobby.');
    }
  });

  socket.on('create room', (data) => {
    try {
      if (!data) {
        socket.emit('error', 'No data provided to create room.');
        return;
      }
      const userId = socket.handshake.session.userId;
      if (!userId) {
        socket.emit('error', 'You must be signed in to create a room.');
        return;
      }

      let { username, location } = socket.handshake.session;
      const userLower = normalize(username);
      const locLower = normalize(location);

      // 1) If user is anonymous -> cannot create rooms
      const isAnonymous =
        userLower === 'anonymous' && locLower === 'on the web';
      if (isAnonymous) {
        socket.emit('error', 'Anonymous users cannot create rooms.');
        return;
      }

      // 2) If the same user+location is already in >=2 rooms, do not allow creation
      const sameNameLocCount = getUsernameLocationRoomsCount(username, location);
      if (sameNameLocCount >= 2) {
        socket.emit('error', 'unable to create room at the moment please try again later');
        return;
      }

      // 3) If the session is already in >=2 rooms, do not allow creation
      const userRoomsCount = getUserRoomsCount(userId);
      if (userRoomsCount >= 2) {
        socket.emit('error', 'You are in too many rooms to create a new one right now.');
        return;
      }

      // 4) Rate-limiting creation
      const now = Date.now();
      const lastCreationTime = lastRoomCreationTimes.get(userId) || 0;
      if (now - lastCreationTime < ROOM_CREATION_COOLDOWN) {
        socket.emit('error', 'You are creating rooms too frequently. Please wait a bit.');
        return;
      }

      // 5) Validate provided data
      let roomName = enforceRoomNameLimit(data.name || 'Just Chatting');
      let roomType = data.type;
      let layout = data.layout;

      if (!roomType) {
        socket.emit('error', 'Room type is missing.');
        return;
      }
      if (!layout) {
        socket.emit('error', 'Room layout is missing.');
        return;
      }

      if (ENABLE_WORD_FILTER) {
        const roomNameCheck = wordFilter.checkText(roomName);
        if (roomNameCheck.hasOffensiveWord) {
          socket.emit('error', 'Your chosen room name contains forbidden words. Please pick another.');
          return;
        }
      }

      lastRoomCreationTimes.set(userId, now);

      let roomId;
      do {
        roomId = generateRoomId();
      } while (rooms.has(roomId));

      const newRoom = {
        id: roomId,
        name: roomName,
        type: roomType,
        layout: layout,
        users: [],
        accessCode: roomType === 'semi-private' ? data.accessCode : null,
        votes: {},
        bannedUserIds: new Set(),
        lastActiveTime: Date.now(),
      };
      rooms.set(roomId, newRoom);

      // If this is a semi-private room, store the access code in the session
      if (roomType === 'semi-private' && data.accessCode) {
        if (!socket.handshake.session.validatedRooms) {
          socket.handshake.session.validatedRooms = {};
        }
        socket.handshake.session.validatedRooms[roomId] = data.accessCode;
        socket.handshake.session.save();
      }

      socket.emit('room created', roomId);
      updateLobby();
      saveRooms();
    } catch (err) {
      console.error('Error in create room:', err);
      socket.emit('error', 'Internal server error while creating room.');
    }
  });

  socket.on('join room', (data) => {
    try {
      if (!data || !data.roomId) {
        socket.emit('error', 'Invalid or missing data when attempting to join room.');
        return;
      }
      const room = rooms.get(data.roomId);
      if (!room) {
        socket.emit('room not found');
        return;
      }

      // For semi-private
      if (room.type === 'semi-private') {
        // Check if this room has a validated access code in the session
        const validatedAccessCode = socket.handshake.session.validatedRooms && 
                                   socket.handshake.session.validatedRooms[data.roomId];
        
        if (validatedAccessCode) {
          // User already validated for this room, use the stored code
          data.accessCode = validatedAccessCode;
        } else if (!data.accessCode) {
          // No access code provided and no validation in session
          socket.emit('access code required');
          return;
        }
        
        // Server-side validation of access code
        if (typeof data.accessCode !== 'string' || 
            data.accessCode.length !== 6 || 
            !/^\d+$/.test(data.accessCode)) {
          socket.emit('error', 'Invalid access code format');
          return;
        }
        
        if (room.accessCode !== data.accessCode) {
          socket.emit('error', 'Incorrect access code');
          return;
        }
        
        // Store the valid access code in session for future use
        if (!socket.handshake.session.validatedRooms) {
          socket.handshake.session.validatedRooms = {};
        }
        socket.handshake.session.validatedRooms[data.roomId] = data.accessCode;
        socket.handshake.session.save();
      }

      let { username, location, userId } = socket.handshake.session;
      if (!username || !location || !userId) {
        // fallback if session is missing
        userId = socket.handshake.sessionID;
        username = "Anonymous";
        location = "On The Web";
        socket.handshake.session.username = username;
        socket.handshake.session.location = location;
        socket.handshake.session.userId = userId;
      }

      socket.handshake.session.save((err) => {
        if (!err) {
          joinRoom(socket, data.roomId, userId);
        }
      });
    } catch (err) {
      console.error('Error in join room:', err);
      socket.emit('error', 'Internal server error while joining room.');
    }
  });

  /************************
   * "vote" event
   ************************/
  socket.on('vote', (data) => {
    try {
      if (!data || typeof data !== 'object') {
        socket.emit('error', 'Invalid data for vote.');
        return;
      }
      const { targetUserId } = data;
      if (!targetUserId) {
        socket.emit('error', 'Missing target user ID for vote.');
        return;
      }

      const userId = socket.handshake.session.userId;
      const roomId = socket.roomId;
      if (!roomId) return;

      const room = rooms.get(roomId);
      if (!room) return;

      // Must be in the room
      if (!room.users.find(u => u.id === userId)) return;
      // Cannot vote against yourself
      if (userId === targetUserId) return;

      if (!room.votes) {
        room.votes = {};
      }

      // TOGGLE the vote
      if (room.votes[userId] === targetUserId) {
        // User is un-voting (removing their vote)
        delete room.votes[userId];
        io.to(roomId).emit('update votes', room.votes);
      } else {
        // Cast/change the vote
        room.votes[userId] = targetUserId;
        io.to(roomId).emit('update votes', room.votes);

        // Check for majority only after a new vote
        const votesAgainstTarget = Object.values(room.votes).filter(v => v === targetUserId).length;
        const totalUsers = room.users.length;
        // If votesAgainstTarget > half of total users => majority
        if (votesAgainstTarget > Math.floor(totalUsers / 2)) {
          // Kick target
          const targetSocket = [...io.sockets.sockets.values()]
            .find(s => s.handshake.session.userId === targetUserId);
          if (targetSocket) {
            targetSocket.emit('kicked');
            room.bannedUserIds.add(targetUserId);
            leaveRoom(targetSocket, targetUserId);
          }
        }
      }
    } catch (err) {
      console.error('Error in vote handler:', err);
      socket.emit('error', 'Internal server error during vote.');
    }
  });

  socket.on('leave room', async () => {
    try {
      const userId = socket.handshake.session.userId;
      await leaveRoom(socket, userId);
    } catch (err) {
      console.error('Error in leave room:', err);
      socket.emit('error', 'Internal server error while leaving room.');
    }
  });

  socket.on('chat update', (data) => {
    try {
      if (!socket.roomId) return;
      const userId = socket.handshake.session.userId;
      const username = socket.handshake.session.username;

      if (!userMessageBuffers.has(userId)) {
        userMessageBuffers.set(userId, '');
      }
      let userMessage = userMessageBuffers.get(userId);

      if (!data || typeof data !== 'object') {
        socket.emit('error', 'Invalid chat update data.');
        return;
      }
      let diff = data.diff;
      if (!diff) return;

      if (diff.text) {
        diff.text = enforceCharacterLimit(diff.text);
      }

      switch (diff.type) {
        case 'full-replace':
          userMessage = diff.text;
          break;
        case 'add':
          userMessage =
            userMessage.slice(0, diff.index) + diff.text + userMessage.slice(diff.index);
          break;
        case 'delete':
          userMessage =
            userMessage.slice(0, diff.index) + userMessage.slice(diff.index + diff.count);
          break;
        case 'replace':
          userMessage =
            userMessage.slice(0, diff.index) +
            diff.text +
            userMessage.slice(diff.index + diff.text.length);
          break;
        default:
          socket.emit('error', 'Unknown diff type.');
          return;
      }

      userMessageBuffers.set(userId, userMessage);

      if (ENABLE_WORD_FILTER) {
        const filterResult = wordFilter.checkText(userMessage);
        if (filterResult.hasOffensiveWord) {
          // Replace the text in their buffer
          userMessage = wordFilter.filterText(userMessage);
          userMessageBuffers.set(userId, userMessage);

          // Alert the room that we filtered it
          io.to(socket.roomId).emit('offensive word detected', {
            userId,
            filteredMessage: userMessage,
          });
        } else {
          // If no offensive words, just broadcast the diff
          socket.to(socket.roomId).emit('chat update', {
            userId,
            username,
            diff: diff,
          });
        }
      } else {
        // Word filter disabled, send the diff
        socket.to(socket.roomId).emit('chat update', {
          userId,
          username,
          diff: diff,
        });
      }
    } catch (err) {
      console.error('Error in chat update:', err);
      socket.emit('error', 'Internal server error during chat update.');
    }
  });

  socket.on('typing', (data) => {
    try {
      if (!socket.roomId) return;
      const userId = socket.handshake.session.userId;
      const username = socket.handshake.session.username;
      if (!data || typeof data.isTyping !== 'boolean') {
        return;
      }
      handleTyping(socket, userId, username, data.isTyping);
    } catch (err) {
      console.error('Error in typing handler:', err);
    }
  });

  socket.on('get rooms', () => {
    socket.emit('initial rooms', Array.from(rooms.values()));
  });

  socket.on('disconnect', async () => {
    try {
      const userId = socket.handshake.session.userId;
      await leaveRoom(socket, userId);
      userMessageBuffers.delete(userId);
      users.delete(userId);
    } catch (err) {
      console.error('Error on disconnect:', err);
    }
  });
});

// Periodic cleanup for empty rooms
setInterval(() => {
  for (const [roomId, room] of rooms.entries()) {
    if (room.users.length === 0) {
      const timeSinceLastActive = Date.now() - (room.lastActiveTime || 0);
      if (timeSinceLastActive > 15000) {
        rooms.delete(roomId);
        roomDeletionTimers.delete(roomId);
        updateLobby();
        saveRooms();
        console.log(`Periodic cleanup: removed empty room ${roomId}`);
      }
    }
  }
}, 10000);

/***************************************************
 * OPTIONAL: Additional REST API (with API key)
 ***************************************************/
function apiAuth(req, res, next) {
  const apiKey = req.header('x-api-key');
  const validApiKey = 'tK_public_key_4f8a9b2c7d6e3f1a5g8h9i0j4k5l6m7n8o9p';
  if (!apiKey || apiKey !== validApiKey) {
    return res.status(403).json({ error: 'Forbidden: invalid or missing x-api-key.' });
  }
  next();
}

// GET /api/v1/rooms - list non-private rooms
app.get('/api/v1/rooms', limiter, apiAuth, (req, res) => {
  const publicRooms = Array.from(rooms.values())
    .filter(room => room.type !== 'private')
    .map(room => ({
      id: room.id,
      name: room.name,
      type: room.type,
      users: room.users.map(u => ({
        id: u.id,
        username: u.username,
        location: u.location
      })),
      isFull: room.users.length >= MAX_ROOM_CAPACITY
    }));
  return res.json(publicRooms);
});

// GET /api/v1/rooms/:id - detail about a specific room
app.get('/api/v1/rooms/:id', limiter, apiAuth, (req, res) => {
  const roomId = req.params.id;
  const room = rooms.get(roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  // Hide access code
  return res.json({
    id: room.id,
    name: room.name,
    type: room.type,
    users: room.users.map(u => ({ id: u.id, username: u.username, location: u.location })),
    isFull: room.users.length >= MAX_ROOM_CAPACITY
  });
});

// POST /api/v1/rooms - create a new room (REST API version)
app.post('/api/v1/rooms', limiter, apiAuth, (req, res) => {
  try {
    const data = req.body;
    if (!data || !data.name || !data.type || !data.layout) {
      return res.status(400).json({
        error: 'Missing required fields: name, type, layout'
      });
    }

    let roomName = enforceRoomNameLimit(data.name);
    if (ENABLE_WORD_FILTER) {
      const roomNameCheck = wordFilter.checkText(roomName);
      if (roomNameCheck.hasOffensiveWord) {
        return res.status(400).json({ error: 'Room name contains forbidden words.' });
      }
    }

    let roomType = data.type;
    let layout = data.layout;

    let roomId;
    do {
      roomId = generateRoomId();
    } while (rooms.has(roomId));

    const newRoom = {
      id: roomId,
      name: roomName,
      type: roomType,
      layout: layout,
      users: [],
      accessCode: roomType === 'semi-private' ? data.accessCode : null,
      votes: {},
      bannedUserIds: new Set(),
      lastActiveTime: Date.now(),
    };
    rooms.set(roomId, newRoom);
    
    // If there's a session, store the validated access code
    if (req.session && roomType === 'semi-private' && data.accessCode) {
      if (!req.session.validatedRooms) {
        req.session.validatedRooms = {};
      }
      req.session.validatedRooms[roomId] = data.accessCode;
      req.session.save();
    }
    
    updateLobby();
    saveRooms();

    return res.json({ success: true, roomId });
  } catch (err) {
    console.error('Error in /api/v1/rooms POST:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/v1/rooms/:id/join - simple check for capacity & access code
app.post('/api/v1/rooms/:id/join', limiter, apiAuth, (req, res) => {
  try {
    const roomId = req.params.id;
    const room = rooms.get(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    if (room.users.length >= MAX_ROOM_CAPACITY) {
      return res.status(400).json({ error: 'Room is full' });
    }
    
    if (room.type === 'semi-private') {
      // Check if the access code is already validated in the session
      const validatedAccessCode = req.session && req.session.validatedRooms && 
                                 req.session.validatedRooms[roomId];
      
      if (validatedAccessCode) {
        // Already validated
      } else if (!req.body.accessCode) {
        return res.status(403).json({ error: 'Access code required' });
      } else {
        // Server-side validation of access code
        if (typeof req.body.accessCode !== 'string' || 
            req.body.accessCode.length !== 6 || 
            !/^\d+$/.test(req.body.accessCode)) {
          return res.status(400).json({ error: 'Invalid access code format' });
        }
        
        if (room.accessCode !== req.body.accessCode) {
          return res.status(403).json({ error: 'Incorrect access code' });
        }
        
        // Store validated code in session
        if (req.session) {
          if (!req.session.validatedRooms) {
            req.session.validatedRooms = {};
          }
          req.session.validatedRooms[roomId] = req.body.accessCode;
          req.session.save();
        }
      }
    }
    
    // If everything is okay, respond success
    return res.json({
      success: true,
      message: 'You can now connect via Socket.IO to join the room in real time.'
    });
  } catch (err) {
    console.error('Error in /api/v1/rooms/:id/join:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Example test route
app.get('/api/v1/protected/ping', limiter, apiAuth, (req, res) => {
  return res.json({ message: 'pong', time: Date.now() });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});