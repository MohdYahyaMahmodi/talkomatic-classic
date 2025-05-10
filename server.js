/**********************************
 * Talkomatic Server
 * =========================
 * Enhanced with better support for custom frontends
 * Last updated: 2025
 **********************************/
require('dotenv').config(); // Loads environment vars from .env
// Core dependencies
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
// Add WebSocket flood protection dependencies
const { RateLimiterMemory } = require('rate-limiter-flexible');

/********************************* 
 * CONFIGURATION & CONSTANTS
 *********************************/
// System-wide constants - will be exposed via API
const CONFIG = {
  LIMITS: {
    MAX_USERNAME_LENGTH: 12,
    MAX_AFK_TIME:200000,
    MAX_LOCATION_LENGTH: 12,
    MAX_ROOM_NAME_LENGTH: 20,
    MAX_MESSAGE_LENGTH: 10000,
    MAX_ROOM_CAPACITY: 5,
    // WebSocket flood protection config
    MAX_CONNECTIONS_PER_IP: 15,
    SOCKET_MAX_REQUESTS_WINDOW: 1, // 1 second
    SOCKET_MAX_REQUESTS_PER_WINDOW: 50, // 50 requests per second
    CHAT_UPDATE_RATE_LIMIT: 20, // Max 20 updates per second
    TYPING_RATE_LIMIT: 10, // Max 10 typing events per second
    CONNECTION_DELAY: 1000 // 1000ms delay between connection attempts
  },
  FEATURES: {
    ENABLE_WORD_FILTER: true
  },
  TIMING: {
    ROOM_CREATION_COOLDOWN: 30000, // 30 seconds cooldown
    ROOM_DELETION_TIMEOUT: 15000,   // 15 seconds after empty
    TYPING_TIMEOUT: 2000            // 2 seconds
  },
  VERSIONS: {
    API: 'v1',
    SERVER: '1.1.0'
  }
};

// Error codes for standardized error handling
const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  SERVER_ERROR: 'SERVER_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  ROOM_FULL: 'ROOM_FULL',
  ACCESS_DENIED: 'ACCESS_DENIED',
  BAD_REQUEST: 'BAD_REQUEST',
  FORBIDDEN: 'FORBIDDEN'
};

// Load word filter
const wordFilter = new WordFilter(
  path.join(__dirname, 'public', 'js', 'offensive_words.json')
);

// State management
const lastRoomCreationTimes = new Map();
let rooms = new Map();
const users = new Map();
const roomDeletionTimers = new Map();
const typingTimeouts = new Map();
const userMessageBuffers = new Map();

// Connection and rate limiting trackers
const ipConnections = new Map();
const ipLastConnectionTime = new Map();
const socketRateLimiter = new RateLimiterMemory({
  points: CONFIG.LIMITS.SOCKET_MAX_REQUESTS_PER_WINDOW,
  duration: CONFIG.LIMITS.SOCKET_MAX_REQUESTS_WINDOW
});
const chatUpdateLimiter = new RateLimiterMemory({
  points: CONFIG.LIMITS.CHAT_UPDATE_RATE_LIMIT,
  duration: 1
});
const typingLimiter = new RateLimiterMemory({
  points: CONFIG.LIMITS.TYPING_RATE_LIMIT,
  duration: 1
});

// Create express app and server
const app = express();
const server = http.createServer(app);

/********************************* 
 * MIDDLEWARE & SECURITY SETUP
 *********************************/
// Allowed origins for CORS
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://classic.talkomatic.co'
];

// CORS config with support for all GitHub Pages domains
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, etc)
    if (!origin) return callback(null, true);
    
    // Allow explicitly listed domains
    if (allowedOrigins.indexOf(origin) !== -1) {
      return callback(null, true);
    }
    
    // Allow all GitHub Pages domains
    if (origin.endsWith('github.io')) {
      return callback(null, true);
    }
    
    // Reject all other origins
    return callback(
      new Error('The CORS policy does not allow access from this origin.'),
      false
    );
  },
  methods: ['GET', 'POST'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
};

// Parse JSON bodies for the REST API
app.use(express.json());
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
  standardHeaders: true,
  message: {
    error: {
      code: ERROR_CODES.RATE_LIMITED,
      message: 'Too many requests, please try again later.'
    }
  }
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

// Socket.io setup with shared session and flood protection
const io = socketIo(server, {
  cors: {
    origin: function(origin, callback) {
      // Allow requests with no origin
      if (!origin) return callback(null, true);
      
      // Allow explicitly listed domains
      if (allowedOrigins.indexOf(origin) !== -1) {
        return callback(null, true);
      }
      
      // Allow all GitHub Pages domains
      if (origin.endsWith('github.io')) {
        return callback(null, true);
      }
      
      // Reject all other origins
      return callback(
        new Error('Not allowed by CORS'),
        false
      );
    },
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Socket middleware for flood protection
io.use((socket, next) => {
  try {
    // Get client IP
    const clientIp = socket.handshake.headers['x-forwarded-for'] || 
                     socket.handshake.address;
    
    // Connection rate limiting - prevent rapid reconnection attempts
    const now = Date.now();
    const lastConnectionTime = ipLastConnectionTime.get(clientIp) || 0;
    if (now - lastConnectionTime < CONFIG.LIMITS.CONNECTION_DELAY) {
      return next(new Error('Rate limit exceeded: Too many connection attempts'));
    }
    ipLastConnectionTime.set(clientIp, now);
    
    // Connection count limiting - max connections per IP
    if (!ipConnections.has(clientIp)) {
      ipConnections.set(clientIp, 0);
    }
    
    const connectionsCount = ipConnections.get(clientIp);
    if (connectionsCount >= CONFIG.LIMITS.MAX_CONNECTIONS_PER_IP) {
      return next(new Error('Too many connections from this IP'));
    }
    
    // Increment connection count
    ipConnections.set(clientIp, connectionsCount + 1);
    
    // Store IP in socket for cleanup on disconnect
    socket.clientIp = clientIp;
    
    // Add global rate limiter for all socket events
    socket.use(async (packet, nextMiddleware) => {
      try {
        const eventName = packet[0];
        // Skip rate limiting for some internal events
        if (['error', 'connect', 'disconnect'].includes(eventName)) {
          return nextMiddleware();
        }
        
        await socketRateLimiter.consume(socket.id);
        nextMiddleware();
      } catch (err) {
        // Rate limit exceeded
        socket.emit('error', createErrorResponse(
          ERROR_CODES.RATE_LIMITED,
          'Rate limit exceeded: Too many requests'
        ));
      }
    });
    
    next();
  } catch (err) {
    console.error('Socket middleware error:', err);
    next(new Error('Internal server error'));
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

/********************************* 
 * UTILITY FUNCTIONS
 *********************************/
/**
 * Create a standardized error response
 */
function createErrorResponse(code, message, details = null, replaceDefaultText = false) {
  const response = {
    error: {
      code,
      message,
      replaceDefaultText
    }
  };
  
  if (details) {
    response.error.details = details;
  }
  
  return response;
}

/**
 * Send a standardized error response
 */
function sendErrorResponse(res, code, message, status = 400, details = null) {
  return res.status(status).json(createErrorResponse(code, message, details));
}

/**
 * Validation rules for various inputs
 */
const validationRules = {
  username: (value) => {
    if (!value || typeof value !== 'string') return 'Username is required';
    if (value.trim().length === 0) return 'Username cannot be empty';
    if (value.length > CONFIG.LIMITS.MAX_USERNAME_LENGTH) 
      return `Username must be at most ${CONFIG.LIMITS.MAX_USERNAME_LENGTH} characters`;
    return null;
  },
  location: (value) => {
    if (typeof value === 'string' && value.length > CONFIG.LIMITS.MAX_LOCATION_LENGTH) 
      return `Location must be at most ${CONFIG.LIMITS.MAX_LOCATION_LENGTH} characters`;
    return null;
  },
  roomName: (value) => {
    if (!value || typeof value !== 'string') return 'Room name is required';
    if (value.trim().length === 0) return 'Room name cannot be empty';
    if (value.length > CONFIG.LIMITS.MAX_ROOM_NAME_LENGTH) 
      return `Room name must be at most ${CONFIG.LIMITS.MAX_ROOM_NAME_LENGTH} characters`;
    return null;
  },
  roomType: (value) => {
    if (!value) return 'Room type is required';
    if (!['public', 'semi-private', 'private'].includes(value)) 
      return 'Room type must be public, semi-private, or private';
    return null;
  },
  layout: (value) => {
    if (!value) return 'Room layout is required';
    if (!['horizontal', 'vertical'].includes(value)) 
      return 'Room layout must be horizontal or vertical';
    return null;
  },
  accessCode: (value, roomType) => {
    if (roomType === 'semi-private') {
      if (!value) return 'Access code is required for semi-private rooms';
      if (typeof value !== 'string' || value.length !== 6 || !/^\d+$/.test(value)) 
        return 'Access code must be a 6-digit number';
    }
    return null;
  }
};

/**
 * Validate input against a specific rule
 */
function validate(field, value, context = {}) {
  if (validationRules[field]) {
    return validationRules[field](value, context);
  }
  return null;
}

/**
 * Validate a complete object against multiple validation rules
 */
function validateObject(obj, rules) {
  const errors = {};
  for (const [field, options] of Object.entries(rules)) {
    const value = obj[field];
    const context = options.context || {};
    const error = validate(options.rule || field, value, context);
    if (error) {
      errors[field] = error;
    }
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

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

/**
 * Enforce character limit on different input types
 */
function enforceCharacterLimit(message) {
  return typeof message === 'string' ? message.slice(0, CONFIG.LIMITS.MAX_MESSAGE_LENGTH) : message;
}

function enforceUsernameLimit(username) {
  return username.slice(0, CONFIG.LIMITS.MAX_USERNAME_LENGTH);
}

function enforceLocationLimit(location) {
  return location.slice(0, CONFIG.LIMITS.MAX_LOCATION_LENGTH);
}

function enforceRoomNameLimit(roomName) {
  return roomName.slice(0, CONFIG.LIMITS.MAX_ROOM_NAME_LENGTH);
}

/**
 * Save rooms to disk
 */
async function saveRooms() {
  try {
    const roomsData = JSON.stringify(Array.from(rooms.entries()));
    await fs.writeFile(path.join(__dirname, 'rooms.json'), roomsData);
    console.log('Rooms saved successfully');
  } catch (error) {
    console.error('Error saving rooms:', error);
  }
}

/**
 * Load rooms from disk
 */
async function loadRooms() {
  try {
    const roomsData = await fs.readFile(path.join(__dirname, 'rooms.json'), 'utf8');
    const loadedRooms = JSON.parse(roomsData);
    rooms = new Map(loadedRooms);
    console.log(`Loaded ${rooms.size} rooms from disk`);
    // Comment out to preserve rooms across restarts
    rooms.clear();
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Error loading rooms:', error);
    }
  }
}

/**
 * Generate a random room ID
 */
function generateRoomId() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Start a timer to delete a room after it's been empty for a while
 */
function startRoomDeletionTimer(roomId) {
  if (roomDeletionTimers.has(roomId)) {
    clearTimeout(roomDeletionTimers.get(roomId));
  }
  const timer = setTimeout(() => {
    rooms.delete(roomId);
    roomDeletionTimers.delete(roomId);
    updateLobby();
    saveRooms();
    console.log(`Room ${roomId} deleted due to inactivity`);
  }, CONFIG.TIMING.ROOM_DELETION_TIMEOUT);
  roomDeletionTimers.set(roomId, timer);
}

/**
 * Update all clients in the lobby with the latest room list
 */
function updateLobby() {
  const publicRooms = Array.from(rooms.values())
    .filter(room => room.type !== 'private')
    .map(room => ({
      ...room,
      accessCode: undefined, // Hide the access code
      isFull: room.users.length >= CONFIG.LIMITS.MAX_ROOM_CAPACITY
    }));
  io.to('lobby').emit('lobby update', publicRooms);
}

/**
 * Update all clients in a room with the latest room state
 */
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

/**
 * Get all the current message content for all users in a room
 */
function getCurrentMessages(users) {
  const messages = {};
  if (Array.isArray(users)) {
    users.forEach(user => {
      messages[user.id] = userMessageBuffers.get(user.id) || '';
    });
  }
  return messages;
}

/**
 * Handle a user leaving a room
 */
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
    socket.emit('error', createErrorResponse(ERROR_CODES.NOT_FOUND, 'Room not found'));
    return;
  }
  const room = rooms.get(roomId);
  if (!room) {
    socket.emit('error', createErrorResponse(ERROR_CODES.NOT_FOUND, 'Room not found'));
    return;
  }
  // Check if user is banned
  if (room.bannedUserIds && room.bannedUserIds.has(userId)) {
    socket.emit('error', createErrorResponse(ERROR_CODES.FORBIDDEN, 'You have been banned from rejoining this room.'));
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
      socket.emit('error', createErrorResponse(
        ERROR_CODES.FORBIDDEN, 
        'Unable to join room at the moment. You are already in the maximum number of rooms.'
      ));
      return;
    }
    // Check how many rooms exist with same (username, location)
    const sameNameLocCount = getUsernameLocationRoomsCount(username, location);
    if (sameNameLocCount >= 2) {
      socket.emit('error', createErrorResponse(
        ERROR_CODES.FORBIDDEN, 
        'Unable to join room at the moment. This username/location is already in the maximum number of rooms.'
      ));
      return;
    }
  }
  if (!room.users) room.users = [];
  if (!room.votes) room.votes = {};
  if (room.users.length >= CONFIG.LIMITS.MAX_ROOM_CAPACITY) {
    socket.emit('room full', createErrorResponse(ERROR_CODES.ROOM_FULL, 'This room is full'));
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

/**
 * Handle typing indicators
 */
function handleTyping(socket, userId, username, isTyping) {
  if (typingTimeouts.has(userId)) {
    clearTimeout(typingTimeouts.get(userId));
  }
  if (isTyping) {
    socket.to(socket.roomId).emit('user typing', { userId, username, isTyping: true });
    typingTimeouts.set(userId, setTimeout(() => {
      socket.to(socket.roomId).emit('user typing', { userId, username, isTyping: false });
      typingTimeouts.delete(userId);
    }, CONFIG.TIMING.TYPING_TIMEOUT));
  } else {
    socket.to(socket.roomId).emit('user typing', { userId, username, isTyping: false });
    typingTimeouts.delete(userId);
  }
}

// Initialize by loading rooms from disk
loadRooms();

/********************************* 
 * NEW REST API ENDPOINTS
 *********************************/
// GET /api/v1/config - Get server configuration
app.get(`/api/${CONFIG.VERSIONS.API}/config`, (req, res) => {
  res.json({
    limits: CONFIG.LIMITS,
    features: CONFIG.FEATURES,
    versions: CONFIG.VERSIONS
  });
});

// GET /api/v1/health - Health check endpoint
app.get(`/api/${CONFIG.VERSIONS.API}/health`, (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: Date.now(),
    version: CONFIG.VERSIONS.SERVER
  });
});

// GET /api/v1/me - Get current user session info
app.get(`/api/${CONFIG.VERSIONS.API}/me`, (req, res) => {
  const { username, location, userId } = req.session;
  
  if (username && location && userId) {
    res.json({
      isSignedIn: true,
      username,
      location,
      userId
    });
  } else {
    res.json({ isSignedIn: false });
  }
});

// Serve emojiList.json - Add this after your other static file serving middleware
app.get('/js/emojiList.json', async (req, res) => {
  try {
    const emojiListPath = path.join(__dirname, 'public', 'js', 'emojiList.json');
    const data = await fs.readFile(emojiListPath, 'utf8');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=86400'); 
    res.send(data);
  } catch (error) {
    console.error('Error serving emoji list:', error);
    res.status(404).json({ error: 'Emoji list not found' });
  }
});

// GET /api/v1/docs/rooms - Room documentation
app.get(`/api/${CONFIG.VERSIONS.API}/docs/rooms`, (req, res) => {
  res.json({
    roomTypes: {
      public: {
        description: 'Visible to all users and can be joined without restrictions',
        requiresAccessCode: false
      },
      'semi-private': {
        description: 'Visible in room list but requires an access code to join',
        requiresAccessCode: true
      },
      private: {
        description: 'Not visible in room list, requires direct link and access code',
        requiresAccessCode: true
      }
    },
    layouts: {
      horizontal: 'Chat windows arranged side by side',
      vertical: 'Chat windows stacked vertically'
    },
    limits: {
      maxUsers: CONFIG.LIMITS.MAX_ROOM_CAPACITY,
      maxRoomNameLength: CONFIG.LIMITS.MAX_ROOM_NAME_LENGTH
    }
  });
});

/********************************* 
 * EXISTING REST API ENDPOINTS
 *********************************/
function apiAuth(req, res, next) {
  const apiKey = req.header('x-api-key');
  const validApiKey = 'tK_public_key_4f8a9b2c7d6e3f1a5g8h9i0j4k5l6m7n8o9p';
  if (!apiKey || apiKey !== validApiKey) {
    return sendErrorResponse(
      res, 
      ERROR_CODES.UNAUTHORIZED, 
      'Forbidden: invalid or missing x-api-key.', 
      403
    );
  }
  next();
}

// GET /api/v1/rooms - list non-private rooms
app.get(`/api/${CONFIG.VERSIONS.API}/rooms`, limiter, apiAuth, (req, res) => {
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
      isFull: room.users.length >= CONFIG.LIMITS.MAX_ROOM_CAPACITY
    }));
  return res.json(publicRooms);
});

// GET /api/v1/rooms/:id - detail about a specific room
app.get(`/api/${CONFIG.VERSIONS.API}/rooms/:id`, limiter, apiAuth, (req, res) => {
  const roomId = req.params.id;
  const room = rooms.get(roomId);
  if (!room) {
    return sendErrorResponse(res, ERROR_CODES.NOT_FOUND, 'Room not found', 404);
  }
  // Hide access code
  return res.json({
    id: room.id,
    name: room.name,
    type: room.type,
    users: room.users.map(u => ({ id: u.id, username: u.username, location: u.location })),
    isFull: room.users.length >= CONFIG.LIMITS.MAX_ROOM_CAPACITY
  });
});

// POST /api/v1/rooms - create a new room (REST API version)
app.post(`/api/${CONFIG.VERSIONS.API}/rooms`, limiter, apiAuth, (req, res) => {
  try {
    const data = req.body;
    
    // Validate with improved validation system
    const validationErrors = validateObject(data, {
      name: { rule: 'roomName' },
      type: { rule: 'roomType' },
      layout: { rule: 'layout' },
      accessCode: { 
        rule: 'accessCode', 
        context: data.type 
      }
    });
    
    if (validationErrors) {
      return sendErrorResponse(
        res, 
        ERROR_CODES.VALIDATION_ERROR, 
        'Validation failed', 
        400, 
        validationErrors
      );
    }
    let roomName = enforceRoomNameLimit(data.name);
    if (CONFIG.FEATURES.ENABLE_WORD_FILTER) {
      const roomNameCheck = wordFilter.checkText(roomName);
      if (roomNameCheck.hasOffensiveWord) {
        return sendErrorResponse(
          res, 
          ERROR_CODES.VALIDATION_ERROR, 
          'Room name contains forbidden words.',
          400
        );
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
    return sendErrorResponse(
      res, 
      ERROR_CODES.SERVER_ERROR, 
      'Internal server error',
      500
    );
  }
});

// POST /api/v1/rooms/:id/join - simple check for capacity & access code
app.post(`/api/${CONFIG.VERSIONS.API}/rooms/:id/join`, limiter, apiAuth, (req, res) => {
  try {
    const roomId = req.params.id;
    const room = rooms.get(roomId);
    if (!room) {
      return sendErrorResponse(res, ERROR_CODES.NOT_FOUND, 'Room not found', 404);
    }
    if (room.users.length >= CONFIG.LIMITS.MAX_ROOM_CAPACITY) {
      return sendErrorResponse(res, ERROR_CODES.ROOM_FULL, 'Room is full', 400);
    }
    
    if (room.type === 'semi-private') {
      // Check if the access code is already validated in the session
      const validatedAccessCode = req.session && req.session.validatedRooms && 
                                 req.session.validatedRooms[roomId];
      
      if (validatedAccessCode) {
        // Already validated
      } else if (!req.body.accessCode) {
        return sendErrorResponse(res, ERROR_CODES.FORBIDDEN, 'Access code required', 403);
      } else {
        // Server-side validation of access code
        if (typeof req.body.accessCode !== 'string' || 
            req.body.accessCode.length !== 6 || 
            !/^\d+$/.test(req.body.accessCode)) {
          return sendErrorResponse(res, ERROR_CODES.VALIDATION_ERROR, 'Invalid access code format', 400);
        }
        
        if (room.accessCode !== req.body.accessCode) {
          return sendErrorResponse(res, ERROR_CODES.FORBIDDEN, 'Incorrect access code', 403);
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
    return sendErrorResponse(res, ERROR_CODES.SERVER_ERROR, 'Internal server error', 500);
  }
});

// Example test route
app.get(`/api/${CONFIG.VERSIONS.API}/protected/ping`, limiter, apiAuth, (req, res) => {
  return res.json({ message: 'pong', time: Date.now() });
});

/********************************* 
 * SOCKET.IO EVENT HANDLERS
 *********************************/
function onAFKTimeExceeded(socket) {
  console.log("Disconnected "+socket.id+" for inactivity")
  socket.emit("error",createErrorResponse(ERROR_CODES.ACCESS_DENIED,"Disconnected due to inactivity",null))
  socket.disconnect();
}

io.on('connection', (socket) => {
  let AFK_TIMEOUT = null;

  socket.onAny(() => {
    clearTimeout(AFK_TIMEOUT);
    if (socket.roomId) { // ensure the user is in a room and not in the lobby
      AFK_TIMEOUT = setTimeout(onAFKTimeExceeded,CONFIG.LIMITS.MAX_AFK_TIME,socket);
    }
  })

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
        socket.emit('error', createErrorResponse(
          ERROR_CODES.BAD_REQUEST,
          'No data provided when joining lobby.'
        ));
        return;
      }
      
      // Validate input
      const validationErrors = validateObject(data, {
        username: { rule: 'username' },
        location: { rule: 'location' }
      });
      
      if (validationErrors) {
        socket.emit('validation_error', validationErrors);
        return;
      }
      
      // Normalize user inputs
      let username = enforceUsernameLimit(data.username || '');
      let location = enforceLocationLimit(data.location || 'On The Web');
      if (CONFIG.FEATURES.ENABLE_WORD_FILTER) {
        const usernameCheck = wordFilter.checkText(username);
        if (usernameCheck.hasOffensiveWord) {
          socket.emit('error', createErrorResponse(
            ERROR_CODES.VALIDATION_ERROR,
            'Your chosen name contains forbidden words. Please pick another.'
          ));
          return;
        }
        const locationCheck = wordFilter.checkText(location);
        if (locationCheck.hasOffensiveWord) {
          socket.emit('error', createErrorResponse(
            ERROR_CODES.VALIDATION_ERROR,
            'Your chosen location contains forbidden words. Please pick another.'
          ));
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
      socket.emit('error', createErrorResponse(
        ERROR_CODES.SERVER_ERROR,
        'Internal server error while joining lobby.'
      ));
    }
  });

  socket.on('create room', (data) => {
    try {
      if (!data) {
        socket.emit('error', createErrorResponse(
          ERROR_CODES.BAD_REQUEST,
          'No data provided to create room.'
        ));
        return;
      }
      
      const userId = socket.handshake.session.userId;
      if (!userId) {
        socket.emit('error', createErrorResponse(
          ERROR_CODES.UNAUTHORIZED,
          'You must be signed in to create a room.'
        ));
        return;
      }
      // Validate input
      const validationErrors = validateObject(data, {
        name: { rule: 'roomName' },
        type: { rule: 'roomType' },
        layout: { rule: 'layout' },
        accessCode: { 
          rule: 'accessCode', 
          context: data.type 
        }
      });
      
      if (validationErrors) {
        socket.emit('validation_error', validationErrors);
        return;
      }
      let { username, location } = socket.handshake.session;
      const userLower = normalize(username);
      const locLower = normalize(location);
      // 1) If user is anonymous -> cannot create rooms
      const isAnonymous =
        userLower === 'anonymous' && locLower === 'on the web';
      if (isAnonymous) {
        socket.emit('error', createErrorResponse(
          ERROR_CODES.FORBIDDEN,
          'Anonymous users cannot create rooms.'
        ));
        return;
      }
      // 2) If the same user+location is already in >=2 rooms, do not allow creation
      const sameNameLocCount = getUsernameLocationRoomsCount(username, location);
      if (sameNameLocCount >= 2) {
        socket.emit('error', createErrorResponse(
          ERROR_CODES.FORBIDDEN,
          'Unable to create room. This username/location combination is already in the maximum number of rooms.'
        ));
        return;
      }
      // 3) If the session is already in >=2 rooms, do not allow creation
      const userRoomsCount = getUserRoomsCount(userId);
      if (userRoomsCount >= 2) {
        socket.emit('error', createErrorResponse(
          ERROR_CODES.FORBIDDEN,
          'You are in too many rooms to create a new one right now.'
        ));
        return;
      }
      // 4) Rate-limiting creation
      const now = Date.now();
      const lastCreationTime = lastRoomCreationTimes.get(userId) || 0;
      if (now - lastCreationTime < CONFIG.TIMING.ROOM_CREATION_COOLDOWN) {
        socket.emit('error', createErrorResponse(
          ERROR_CODES.RATE_LIMITED,
          'You are creating rooms too frequently. Please wait a bit.'
        ));
        return;
      }
      // 5) Validate provided data
      let roomName = enforceRoomNameLimit(data.name || 'Just Chatting');
      let roomType = data.type;
      let layout = data.layout;
      if (CONFIG.FEATURES.ENABLE_WORD_FILTER) {
        const roomNameCheck = wordFilter.checkText(roomName);
        if (roomNameCheck.hasOffensiveWord) {
          socket.emit('error', createErrorResponse(
            ERROR_CODES.VALIDATION_ERROR,
            'Your chosen room name contains forbidden words. Please pick another.'
          ));
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
      socket.emit('error', createErrorResponse(
        ERROR_CODES.SERVER_ERROR,
        'Internal server error while creating room.'
      ));
    }
  });

  socket.on('join room', (data) => {
    try {
      if (!data || !data.roomId) {
        socket.emit('error', createErrorResponse(
          ERROR_CODES.BAD_REQUEST,
          'Invalid or missing data when attempting to join room.'
        ));
        return;
      }
      const room = rooms.get(data.roomId);
      if (!room) {
        socket.emit('room not found', createErrorResponse(
          ERROR_CODES.NOT_FOUND,
          'Room not found'
        ));
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
          socket.emit('error', createErrorResponse(
            ERROR_CODES.VALIDATION_ERROR,
            'Invalid access code format'
          ));
          return;
        }
        
        if (room.accessCode !== data.accessCode) {
          socket.emit('error', createErrorResponse(
            ERROR_CODES.FORBIDDEN,
            'Incorrect access code'
          ));
          return;
        }
        
        // Store the valid access code in session for future use
        if (!socket.handshake.session.validatedRooms) {
          socket.handshake.session.validatedRooms = {};
        }
        socket.handshake.session.validatedRooms[data.roomId] = data.accessCode;
        
        // Make sure to save the session synchronously before proceeding
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
          AFK_TIMEOUT = setTimeout(onAFKTimeExceeded,CONFIG.LIMITS.MAX_AFK_TIME,socket);
        }
      });
    } catch (err) {
      console.error('Error in join room:', err);
      socket.emit('error', createErrorResponse(
        ERROR_CODES.SERVER_ERROR,
        'Internal server error while joining room.'
      ));
    }
  });

  socket.on('vote', async (data) => {
    try {
      if (!data || typeof data !== 'object') {
        socket.emit('error', createErrorResponse(
          ERROR_CODES.BAD_REQUEST,
          'Invalid data for vote.'
        ));
        return;
      }
      const { targetUserId } = data;
      if (!targetUserId) {
        socket.emit('error', createErrorResponse(
          ERROR_CODES.BAD_REQUEST,
          'Missing target user ID for vote.'
        ));
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
      socket.emit('error', createErrorResponse(
        ERROR_CODES.SERVER_ERROR,
        'Internal server error during vote.'
      ));
    }
  });

  socket.on('leave room', async () => {
    try {
      const userId = socket.handshake.session.userId;
      await leaveRoom(socket, userId);
      clearTimeout(AFK_TIMEOUT);
    } catch (err) {
      console.error('Error in leave room:', err);
      socket.emit('error', createErrorResponse(
        ERROR_CODES.SERVER_ERROR,
        'Internal server error while leaving room.'
      ));
    }
  });

  socket.on('chat update', async (data) => {
    try {
      if (!socket.roomId) return;
      const userId = socket.handshake.session.userId;
      const username = socket.handshake.session.username;
      
      // Rate limiting for chat updates
      try {
        await chatUpdateLimiter.consume(userId);
      } catch (err) {
        socket.emit('error', createErrorResponse(
          ERROR_CODES.RATE_LIMITED,
          'Rate limit exceeded: Too many chat updates'
        ));
        return;
      }
      
      if (!userMessageBuffers.has(userId)) {
        userMessageBuffers.set(userId, '');
      }
      let userMessage = userMessageBuffers.get(userId);
      if (!data || typeof data !== 'object') {
        socket.emit('error', createErrorResponse(
          ERROR_CODES.BAD_REQUEST,
          'Invalid chat update data.'
        ));
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
          socket.emit('error', createErrorResponse(
            ERROR_CODES.BAD_REQUEST,
            'Unknown diff type.'
          ));
          return;
      }
      userMessage = userMessage.replaceAll('\r', ''); // To prevent the carriage return filter bypass
      userMessageBuffers.set(userId, userMessage);
      if (CONFIG.FEATURES.ENABLE_WORD_FILTER) {
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
      socket.emit('error', createErrorResponse(
        ERROR_CODES.SERVER_ERROR,
        'Internal server error during chat update.'
      ));
    }
  });

  socket.on('typing', async (data) => {
    try {
      if (!socket.roomId) return;
      const userId = socket.handshake.session.userId;
      const username = socket.handshake.session.username;
      
      // Rate limiting for typing events
      try {
        await typingLimiter.consume(userId);
      } catch (err) {
        // Silently drop excessive typing events
        return;
      }
      
      if (!data || typeof data.isTyping !== 'boolean') {
        return;
      }
      handleTyping(socket, userId, username, data.isTyping);
    } catch (err) {
      console.error('Error in typing handler:', err);
    }
  });

  socket.on('get rooms', () => {
    socket.emit('initial rooms', Array.from(rooms.values())
      .filter(room => room.type !== 'private')
      .map(room => ({
        ...room,
        accessCode: undefined, // Hide the access code
        isFull: room.users.length >= CONFIG.LIMITS.MAX_ROOM_CAPACITY
      }))
    );
  });

  // NEW: Get room state
  socket.on('get room state', (roomId) => {
    if (!roomId) {
      socket.emit('error', createErrorResponse(
        ERROR_CODES.BAD_REQUEST,
        'Room ID is required'
      ));
      return;
    }
    
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('error', createErrorResponse(
        ERROR_CODES.NOT_FOUND,
        'Room not found'
      ));
      return;
    }
    
    socket.emit('room state', {
      id: room.id,
      name: room.name,
      type: room.type,
      layout: room.layout,
      users: room.users,
      votes: room.votes,
      currentMessages: getCurrentMessages(room.users),
      isFull: room.users.length >= CONFIG.LIMITS.MAX_ROOM_CAPACITY
    });
  });

  socket.on('disconnect', async () => {
    try {
      const userId = socket.handshake.session.userId;
      await leaveRoom(socket, userId);
      userMessageBuffers.delete(userId);
      users.delete(userId);
      
      // Clean up IP connection tracking
      if (socket.clientIp) {
        const currentCount = ipConnections.get(socket.clientIp) || 0;
        if (currentCount > 0) {
          ipConnections.set(socket.clientIp, currentCount - 1);
        } else {
          ipConnections.delete(socket.clientIp);
        }
      }
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
      if (timeSinceLastActive > CONFIG.TIMING.ROOM_DELETION_TIMEOUT) {
        rooms.delete(roomId);
        roomDeletionTimers.delete(roomId);
        updateLobby();
        saveRooms();
        console.log(`Periodic cleanup: removed empty room ${roomId}`);
      }
    }
  }
}, 10000);

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Talkomatic server is running on port ${PORT}`);
  console.log(`Server version: ${CONFIG.VERSIONS.SERVER}`);
});