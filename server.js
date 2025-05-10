require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs').promises;
const path = require('path');
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
const util = require('util');
const { RateLimiterMemory } = require('rate-limiter-flexible');

// Enhanced global error handlers with graceful recovery
process.on('unhandledRejection', (reason, promise) => {
  console.error('=== UNHANDLED PROMISE REJECTION ===');
  console.error('Reason:', reason);
  console.error('Stack:', reason instanceof Error ? reason.stack : 'No stack trace available');
  console.error('=====================================');
  // Don't crash the server, keep running
});

process.on('uncaughtException', (error) => {
  console.error('=== UNCAUGHT EXCEPTION ===');
  console.error('Error:', error.message);
  console.error('Stack:', error.stack);
  console.error('===========================');
  // Don't crash the server, keep running
});

// Configuration
const CONFIG = {
  LIMITS: {
    MAX_USERNAME_LENGTH: 12,
    MAX_AFK_TIME: 200000,
    MAX_LOCATION_LENGTH: 12,
    MAX_ROOM_NAME_LENGTH: 20,
    MAX_MESSAGE_LENGTH: 5000, // Reduced from 10000
    MAX_ROOM_CAPACITY: 5,
    MAX_CONNECTIONS_PER_IP: 10, 
    SOCKET_MAX_REQUESTS_WINDOW: 1,
    SOCKET_MAX_REQUESTS_PER_WINDOW: 30, // Reduced from 50
    CHAT_UPDATE_RATE_LIMIT: 20, 
    TYPING_RATE_LIMIT: 15,
    CONNECTION_DELAY: 2000, // Increased from 1000ms to 2000ms
    MAX_ID_GEN_ATTEMPTS: 100,
    BATCH_SIZE_LIMIT: 20 // Maximum number of diffs to process in a single batch
  },
  FEATURES: {
    ENABLE_WORD_FILTER: true
  },
  TIMING: {
    ROOM_CREATION_COOLDOWN: 30000,
    ROOM_DELETION_TIMEOUT: 15000,
    TYPING_TIMEOUT: 2000,
    BATCH_PROCESSING_INTERVAL: 50 // milliseconds between batch processing
  },
  VERSIONS: {
    API: 'v1',
    SERVER: '1.3.0' // Updated version with DoS protection
  },
  // New circuit breaker configuration
  CIRCUIT_BREAKER: {
    MAX_CONNECTIONS_PER_ROOM: 10,
    ROOM_COOLDOWN_PERIOD: 30000, // 30 seconds
    CONNECTION_THRESHOLD: 15,     // 15 connections in cooldown triggers circuit
    CIRCUIT_RESET_TIME: 60000     // 1 minute
  }
};

// Enhanced error codes
const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  SERVER_ERROR: 'SERVER_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  ROOM_FULL: 'ROOM_FULL',
  ACCESS_DENIED: 'ACCESS_DENIED',
  BAD_REQUEST: 'BAD_REQUEST',
  FORBIDDEN: 'FORBIDDEN',
  CIRCUIT_OPEN: 'CIRCUIT_OPEN',
  MAINTENANCE_MODE: 'MAINTENANCE_MODE' // New error code for high load situations
};

// Load word filter
let wordFilter;
try {
    wordFilter = new WordFilter(path.join(__dirname, 'public', 'js', 'offensive_words.json'));
} catch (err) {
    console.error("Failed to initialize WordFilter. Word filtering will be disabled.", err);
    wordFilter = {
        checkText: () => ({ hasOffensiveWord: false }),
        filterText: (text) => text
    };
    CONFIG.FEATURES.ENABLE_WORD_FILTER = false;
}

// State management
const lastRoomCreationTimes = new Map();
let rooms = new Map();
const users = new Map();
const roomDeletionTimers = new Map();
const typingTimeouts = new Map();
const userMessageBuffers = new Map();
const pendingChatUpdates = new Map();
const batchProcessingTimers = new Map();

// Circuit breaker state
const chatCircuitState = {
  failures: 0,
  lastFailure: 0,
  isOpen: false
};

// Room circuit breakers for DoS protection
const roomCircuitBreakers = new Map();

// Connection and rate limiting trackers
const ipConnections = new Map();
const ipLastConnectionTime = new Map();
const blockedIPs = new Map();

// New connection tracking
const connectionTimestamps = new Map();
const connectionCounts = new Map();

// System state monitoring
let systemState = {
  isHighLoad: false,
  highLoadSince: 0,
  memoryWarningLevel: 0, // 0=normal, 1=warning, 2=critical
  lastMemoryCheck: Date.now(),
  connectionsDropped: 0,
  lastReportTime: Date.now()
};

// Rate limiters
const socketRateLimiter = new RateLimiterMemory({
  points: CONFIG.LIMITS.SOCKET_MAX_REQUESTS_PER_WINDOW,
  duration: CONFIG.LIMITS.SOCKET_MAX_REQUESTS_WINDOW,
  blockDuration: 10 // Block for 10 seconds if exceeded
});

const chatUpdateLimiter = new RateLimiterMemory({
  points: CONFIG.LIMITS.CHAT_UPDATE_RATE_LIMIT,
  duration: 1,
  blockDuration: 5 // Block for 5 seconds if exceeded
});

const typingLimiter = new RateLimiterMemory({
  points: CONFIG.LIMITS.TYPING_RATE_LIMIT,
  duration: 1
});

// Enhanced IP rate limiter
const ipRateLimiter = new RateLimiterMemory({
  points: 3,             // Reduced from 5 to 3 connection attempts
  duration: 10,          // Per 10 seconds
  blockDuration: 300     // Block for 300 seconds (5 minutes) if exceeded
});

const app = express();
const server = http.createServer(app);

// Improved proxy trust setting for production
const trustProxyConfig = process.env.NODE_ENV === 'production' 
  ? (process.env.CLOUDFLARE_ENABLED === 'true' ? 2 : 1) // 2 if behind Cloudflare + Nginx, 1 if just Nginx
  : '127.0.0.1';
app.set('trust proxy', trustProxyConfig);

// CORS Configuration
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://classic.talkomatic.co'
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1 || origin.endsWith('github.io')) {
      return callback(null, true);
    }
    return callback(new Error('The CORS policy does not allow access from this origin.'), false);
  },
  methods: ['GET', 'POST'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
};

// Express middleware
app.use(express.json({ limit: '50kb' })); // Limit payload size
app.use(cors(corsOptions));
app.use(cookieParser());
app.use((req, res, next) => {
  res.locals.nonce = crypto.randomBytes(16).toString('base64');
  next();
});

// Security middleware
app.use(helmet({
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
}));

app.use(xss());
app.use(hpp());

// Global rate limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500, // Reduced from 1000
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: ERROR_CODES.RATE_LIMITED,
      message: 'Too many requests, please try again later.'
    }
  }
});

app.use(limiter);

// Session management
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 14 * 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  }
});

app.use(sessionMiddleware);

// Socket.IO setup with improved configuration
const io = socketIo(server, {
  cors: {
    origin: function(origin, callback) {
      if (!origin || allowedOrigins.indexOf(origin) !== -1 || origin.endsWith('github.io')) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by Socket.IO CORS'), false);
    },
    methods: ["GET", "POST"],
    credentials: true
  },
  proxy: true, // Trust X-Forwarded-For header
  pingTimeout: 60000,
  pingInterval: 25000,
  connectTimeout: 30000,
  maxHttpBufferSize: 1e6, // 1MB max buffer size
  transports: ["websocket", "polling"]
});

// New function to block IPs with progressive blocking
function blockIP(clientIp, duration) {
  const now = Date.now();
  const existingBlock = blockedIPs.get(clientIp);
  
  // If already blocked, double the duration (progressive penalty)
  const blockDuration = existingBlock ? Math.min(duration * 2, 3600000) : duration; // Max 1 hour
  
  blockedIPs.set(clientIp, {
    expiry: now + blockDuration,
    count: (existingBlock?.count || 0) + 1
  });
  
  console.warn(`Blocked IP ${clientIp} for ${blockDuration/1000} seconds`);
}

// New WebSocket pre-connection guard
io.engine.on('connection', (socket) => {
  const clientIp = socket.request.headers['x-forwarded-for']?.split(',')[0].trim() || 
                  socket.request.connection.remoteAddress;
  
  // High load protection
  if (systemState.memoryWarningLevel >= 2) {
    // During critical memory situations, only accept connections from users with existing sessions
    if (socket.request.session && !socket.request.session.userId) {
      socket.disconnect(true);
      systemState.connectionsDropped++;
      return;
    }
  }
  
  // Track connection timestamps
  const now = Date.now();
  if (!connectionTimestamps.has(clientIp)) {
    connectionTimestamps.set(clientIp, []);
  }
  
  const timestamps = connectionTimestamps.get(clientIp);
  timestamps.push(now);
  
  // Keep only last 10 timestamps for memory efficiency
  if (timestamps.length > 10) {
    timestamps.shift();
  }
  
  // Count connections in the last second
  const recentConnections = timestamps.filter(ts => now - ts < 1000).length;
  
  // Increment total connection counter
  connectionCounts.set(clientIp, (connectionCounts.get(clientIp) || 0) + 1);
  
  // If connecting too rapidly, drop the connection immediately
  if (recentConnections >= 8) { // 3+ connections in a second
    console.warn(`Rapid connections detected from IP: ${clientIp}, closing connection`);
    socket.disconnect(true);
    
    // Block for a longer period
    blockIP(clientIp, 600000); // 10 minutes
    
    // Clean up
    if (ipConnections.has(clientIp)) {
      ipConnections.set(clientIp, Math.max(0, ipConnections.get(clientIp) - 1));
    }
    
    return;
  }
  
  // Check for excessive total connections (potential attack pattern)
  if (connectionCounts.get(clientIp) > 20) {
    const countPercentile = connectionCounts.get(clientIp) % 10;
    // Only log occasionally to prevent log flooding
    if (countPercentile === 0) {
      console.warn(`Excessive connections from IP: ${clientIp}, count: ${connectionCounts.get(clientIp)}`);
    }
    
    // Every 50 connections, increase block duration
    if (connectionCounts.get(clientIp) % 50 === 0) {
      blockIP(clientIp, 3600000); // 1 hour
    }
  }
});

// Socket.IO middleware for connection control and rate limiting
io.use((socket, next) => {
  try {
    const clientIp = socket.handshake.headers['x-forwarded-for']?.split(',')[0].trim() ||
                     socket.handshake.address;
    
    // Check if IP is blocked
    if (blockedIPs.has(clientIp)) {
      const blockData = blockedIPs.get(clientIp);
      if (Date.now() < blockData.expiry) {
        console.warn(`Rejected connection from blocked IP: ${clientIp}`);
        return next(new Error('IP temporarily blocked due to abuse detection'));
      } else {
        blockedIPs.delete(clientIp);
      }
    }
    
    // High load protection
    if (systemState.isHighLoad) {
      // During high load, only accept connections from users with existing sessions
      const hasSession = socket.handshake.session && socket.handshake.session.userId;
      if (!hasSession) {
        return next(new Error('Server is experiencing high load. Please try again later.'));
      }
    }
    
    // IP rate limiting
    ipRateLimiter.consume(clientIp)
      .then(() => {
        const now = Date.now();
        const lastConnectionTime = ipLastConnectionTime.get(clientIp) || 0;
        
        if (now - lastConnectionTime < CONFIG.LIMITS.CONNECTION_DELAY) {
          console.warn(`Rate limit (connection delay): ${clientIp}`);
          return next(new Error('Rate limit exceeded: Too many connection attempts'));
        }
        
        ipLastConnectionTime.set(clientIp, now);
        const connectionsCount = ipConnections.get(clientIp) || 0;
        
        if (connectionsCount >= CONFIG.LIMITS.MAX_CONNECTIONS_PER_IP) {
          console.warn(`Rate limit (max connections): ${clientIp}`);
          return next(new Error('Too many connections from this IP'));
        }
        
        ipConnections.set(clientIp, connectionsCount + 1);
        socket.clientIp = clientIp;
        
        // Socket event rate limiting
        socket.use(async (packet, nextMiddleware) => {
          try {
            const eventName = packet[0];
            if (['error', 'connect', 'disconnect', 'disconnecting'].includes(eventName)) {
              return nextMiddleware();
            }
            
            await socketRateLimiter.consume(socket.id);
            nextMiddleware();
          } catch (rlRejected) {
            console.warn(`Socket rate limit exceeded for event ${packet[0]} from ${socket.id} (${clientIp})`);
            socket.emit('error', createErrorResponse(
              ERROR_CODES.RATE_LIMITED,
              'Rate limit exceeded: Too many requests per second.'
            ));
          }
        });
        
        next();
      })
      .catch(() => {
        console.warn(`IP rate limit exceeded for ${clientIp}`);
        return next(new Error('IP rate limit exceeded'));
      });
  } catch (err) {
    console.error('Socket connection middleware error:', err);
    next(new Error('Internal server error during connection setup'));
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

// Utility functions
function createErrorResponse(code, message, details = null, replaceDefaultText = false) {
  const response = { error: { code, message, replaceDefaultText } };
  if (details) response.error.details = details;
  return response;
}

function sendErrorResponse(res, code, message, status = 400, details = null) {
  return res.status(status).json(createErrorResponse(code, message, details));
}

const validationRules = {
  username: (value) => {
    if (!value || typeof value !== 'string') return 'Username is required and must be a string.';
    if (value.trim().length === 0) return 'Username cannot be empty.';
    if (value.length > CONFIG.LIMITS.MAX_USERNAME_LENGTH) 
      return `Username must be at most ${CONFIG.LIMITS.MAX_USERNAME_LENGTH} characters.`;
    return null;
  },
  location: (value) => {
    if (value && typeof value !== 'string') return 'Location must be a string.';
    if (typeof value === 'string' && value.length > CONFIG.LIMITS.MAX_LOCATION_LENGTH) 
      return `Location must be at most ${CONFIG.LIMITS.MAX_LOCATION_LENGTH} characters.`;
    return null;
  },
  roomName: (value) => {
    if (!value || typeof value !== 'string') return 'Room name is required and must be a string.';
    if (value.trim().length === 0) return 'Room name cannot be empty.';
    if (value.length > CONFIG.LIMITS.MAX_ROOM_NAME_LENGTH) 
      return `Room name must be at most ${CONFIG.LIMITS.MAX_ROOM_NAME_LENGTH} characters.`;
    return null;
  },
  roomType: (value) => {
    if (!value) return 'Room type is required.';
    if (!['public', 'semi-private', 'private'].includes(value)) 
      return 'Room type must be public, semi-private, or private.';
    return null;
  },
  layout: (value) => {
    if (!value) return 'Room layout is required.';
    if (!['horizontal', 'vertical'].includes(value)) 
      return 'Room layout must be horizontal or vertical.';
    return null;
  },
  accessCode: (value, roomType) => {
    if (roomType === 'semi-private') {
      if (!value) return 'Access code is required for semi-private rooms.';
      if (typeof value !== 'string' || value.length !== 6 || !/^\d+$/.test(value)) 
        return 'Access code must be a 6-digit number.';
    }
    return null;
  }
};

function validate(field, value, context = {}) {
  if (validationRules[field]) {
    return validationRules[field](value, context);
  }
  return `Unknown validation field: ${field}`;
}

function validateObject(obj, rules) {
  const errors = {};
  if (typeof obj !== 'object' || obj === null) {
      errors._general = "Invalid data object provided for validation.";
      return errors;
  }
  
  for (const [field, options] of Object.entries(rules)) {
    const value = obj[field];
    const context = options.context !== undefined ? options.context : (obj.type || obj.roomType);
    const error = validate(options.rule || field, value, context);
    if (error) {
      errors[field] = error;
    }
  }
  
  return Object.keys(errors).length > 0 ? errors : null;
}

function normalize(str) { return (str || '').trim().toLowerCase(); }

function getUserRoomsCount(userId) {
  let count = 0;
  for (const [, room] of rooms) {
    if (room.users.some(u => u.id === userId)) count++;
  }
  return count;
}

function getUsernameLocationRoomsCount(username, location) {
  const userLower = normalize(username);
  const locLower = normalize(location);
  let count = 0;
  
  for (const [, room] of rooms.entries()) {
    for (const u of room.users) {
      if (normalize(u.username) === userLower && normalize(u.location) === locLower) count++;
    }
  }
  
  return count;
}

function enforceCharacterLimit(message) {
  return typeof message === 'string' ? message.slice(0, CONFIG.LIMITS.MAX_MESSAGE_LENGTH) : '';
}

function enforceUsernameLimit(username) {
  return typeof username === 'string' ? username.slice(0, CONFIG.LIMITS.MAX_USERNAME_LENGTH) : '';
}

function enforceLocationLimit(location) {
  return typeof location === 'string' ? location.slice(0, CONFIG.LIMITS.MAX_LOCATION_LENGTH) : '';
}

function enforceRoomNameLimit(roomName) {
  return typeof roomName === 'string' ? roomName.slice(0, CONFIG.LIMITS.MAX_ROOM_NAME_LENGTH) : '';
}

// New function to check room circuit breaker
function checkRoomCircuit(roomId) {
  if (!roomId) return true; // No room to check
  
  const now = Date.now();
  if (!roomCircuitBreakers.has(roomId)) {
    roomCircuitBreakers.set(roomId, {
      connections: 1,
      lastReset: now,
      isOpen: false
    });
    return true;
  }
  
  const circuitData = roomCircuitBreakers.get(roomId);
  
  // Reset circuit after timeout
  if (circuitData.isOpen && now - circuitData.lastTrip > CONFIG.CIRCUIT_BREAKER.CIRCUIT_RESET_TIME) {
    circuitData.isOpen = false;
    circuitData.connections = 1;
    circuitData.lastReset = now;
    console.log(`Circuit breaker reset for room ${roomId}`);
    return true;
  }
  
  // If circuit is open, reject connections
  if (circuitData.isOpen) {
    return false;
  }
  
  // Reset counter after cooldown period
  if (now - circuitData.lastReset > CONFIG.CIRCUIT_BREAKER.ROOM_COOLDOWN_PERIOD) {
    circuitData.connections = 1;
    circuitData.lastReset = now;
    return true;
  }
  
  // Increment connection counter
  circuitData.connections++;
  
  // Trip circuit breaker if too many connections
  if (circuitData.connections > CONFIG.CIRCUIT_BREAKER.CONNECTION_THRESHOLD) {
    circuitData.isOpen = true;
    circuitData.lastTrip = now;
    console.warn(`Circuit breaker tripped for room ${roomId} - too many connections`);
    return false;
  }
  
  return true;
}

// Process pending chat updates with batching
async function processPendingChatUpdates(userId, socket) {
  try {
    if (!pendingChatUpdates.has(userId) || !socket || !socket.roomId) return;
    
    const pendingData = pendingChatUpdates.get(userId);
    if (!pendingData || pendingData.diffs.length === 0) return;
    
    // Clear the timer
    if (batchProcessingTimers.has(userId)) {
      clearTimeout(batchProcessingTimers.get(userId));
      batchProcessingTimers.delete(userId);
    }
    
    // Get current message state
    let userMessage = userMessageBuffers.get(userId) || '';
    const username = socket.handshake.session.username || "Anonymous";
    
    // Process rate limiting once for the batch
    try {
      // Adjust points based on batch size
      const pointsToConsume = Math.min(1 + Math.floor(pendingData.diffs.length / 5), 3);
      await chatUpdateLimiter.consume(userId, pointsToConsume);
    } catch (rateErr) {
      console.warn(`Rate limit exceeded for batch processing: ${userId}`);
      
      // Instead of dropping all updates, process a smaller batch and reschedule
      pendingData.diffs = pendingData.diffs.slice(0, 5); // Process just 5 diffs
      socket.emit('message', { type: 'warning', text: 'Slow down typing, some updates are being delayed' });
    }
    
    // Limit batch size for processing
    const batchToProcess = pendingData.diffs.slice(0, CONFIG.LIMITS.BATCH_SIZE_LIMIT);
    pendingData.diffs = pendingData.diffs.slice(CONFIG.LIMITS.BATCH_SIZE_LIMIT);
    
    // Create a consolidated diff for the entire batch
    let consolidatedMessage = userMessage;
    
    // Process each diff in the batch
    for (const diff of batchToProcess) {
      // Apply the same processing logic from your original 'chat update' handler
      if (diff.type === 'full-replace') {
        consolidatedMessage = diff.text || "";
      } else if (diff.type === 'add') {
        diff.index = Math.min(diff.index, consolidatedMessage.length);
        if ((consolidatedMessage.length + (diff.text || "").length) > CONFIG.LIMITS.MAX_MESSAGE_LENGTH) {
          diff.text = (diff.text || "").substring(0, CONFIG.LIMITS.MAX_MESSAGE_LENGTH - consolidatedMessage.length);
        }
        consolidatedMessage = consolidatedMessage.slice(0, diff.index) + (diff.text || "") + consolidatedMessage.slice(diff.index);
      } else if (diff.type === 'delete') {
        diff.index = Math.min(diff.index, consolidatedMessage.length);
        diff.count = Math.min(diff.count, consolidatedMessage.length - diff.index);
        consolidatedMessage = consolidatedMessage.slice(0, diff.index) + consolidatedMessage.slice(diff.index + diff.count);
      } else if (diff.type === 'replace') {
        diff.index = Math.min(diff.index, consolidatedMessage.length);
        const replaceTextLength = (diff.text || "").length;
        if (consolidatedMessage.length - Math.min(replaceTextLength, consolidatedMessage.length - diff.index) + replaceTextLength > CONFIG.LIMITS.MAX_MESSAGE_LENGTH) {
          diff.text = (diff.text || "").substring(0, CONFIG.LIMITS.MAX_MESSAGE_LENGTH - (consolidatedMessage.length - Math.min(replaceTextLength, consolidatedMessage.length - diff.index)));
        }
        const endReplaceIndex = Math.min(diff.index + replaceTextLength, consolidatedMessage.length);
        consolidatedMessage = consolidatedMessage.slice(0, diff.index) + (diff.text || "") + consolidatedMessage.slice(endReplaceIndex);
      }
    }
    
    // Clean up and store the final message
    consolidatedMessage = consolidatedMessage.replace(/\r/g, '');
    consolidatedMessage = enforceCharacterLimit(consolidatedMessage);
    userMessageBuffers.set(userId, consolidatedMessage);
    
    // Create a simplified full-replace diff to broadcast
    const broadcastDiff = {
      type: 'full-replace',
      text: consolidatedMessage
    };
    
    // Filter offensive words if enabled
    if (CONFIG.FEATURES.ENABLE_WORD_FILTER) {
      const filterResult = wordFilter.checkText(consolidatedMessage);
      if (filterResult.hasOffensiveWord) {
        consolidatedMessage = wordFilter.filterText(consolidatedMessage);
        userMessageBuffers.set(userId, consolidatedMessage);
        io.to(socket.roomId).emit('offensive word detected', { userId, filteredMessage: consolidatedMessage });
      } else {
        socket.to(socket.roomId).emit('chat update', { userId, username, diff: broadcastDiff });
      }
    } else {
      socket.to(socket.roomId).emit('chat update', { userId, username, diff: broadcastDiff });
    }
    
    // If there are remaining diffs, schedule another batch
    if (pendingData.diffs.length > 0) {
      batchProcessingTimers.set(userId, setTimeout(() => {
        processPendingChatUpdates(userId, socket);
      }, CONFIG.TIMING.BATCH_PROCESSING_INTERVAL));
    } else {
      pendingChatUpdates.delete(userId);
    }
    
    // Reset circuit breaker failures counter on successful updates
    if (chatCircuitState.failures > 0) {
      chatCircuitState.failures--;
    }
  } catch (error) {
    console.error('Error processing batched chat updates:', error);
    pendingChatUpdates.delete(userId);
  }
}

// Check circuit before processing chat updates
function checkChatCircuit() {
  const now = Date.now();
  
  // Reset after 30 seconds
  if (chatCircuitState.isOpen && now - chatCircuitState.lastFailure > 30000) {
    chatCircuitState.isOpen = false;
    chatCircuitState.failures = 0;
    console.log('Chat circuit breaker reset');
  }
  
  return !chatCircuitState.isOpen;
}

// Room state management with debouncing
let saveRoomsPending = false;

async function saveRooms() {
  try {
    // Skip save during high system load
    if (systemState.memoryWarningLevel >= 2) {
      console.log('Skipping room save due to high memory usage');
      return;
    }
    
    const roomsData = JSON.stringify(Array.from(rooms.entries()));
    const tempFilePath = path.join(__dirname, 'rooms.json.tmp');
    const finalFilePath = path.join(__dirname, 'rooms.json');
    
    await fs.writeFile(tempFilePath, roomsData, 'utf8');
    await fs.rename(tempFilePath, finalFilePath);
    console.log('Rooms saved successfully.');
  } catch (error) {
    console.error('Error saving rooms:', error);
    try { await fs.unlink(path.join(__dirname, 'rooms.json.tmp')); } catch (cleanupError) { /* ignore */ }
    throw error;
  }
}

const debouncedSaveRooms = async () => {
  if (saveRoomsPending) return; // Already scheduled
  saveRoomsPending = true;
  
  // Wait to coalesce multiple save requests
  setTimeout(async () => {
    try {
      await saveRooms();
    } catch (err) {
      console.error('Error in debounced room save:', err);
    } finally {
      saveRoomsPending = false;
    }
  }, 2000); // 2 second debounce
};

async function loadRooms() {
  try {
    const roomsData = await fs.readFile(path.join(__dirname, 'rooms.json'), 'utf8');
    const loadedRoomsArray = JSON.parse(roomsData);
    
    if (Array.isArray(loadedRoomsArray)) {
        rooms = new Map(loadedRoomsArray.map(item => {
            if (item[1] && item[1].bannedUserIds && !(item[1].bannedUserIds instanceof Set)) {
                item[1].bannedUserIds = new Set(item[1].bannedUserIds.values || item[1].bannedUserIds);
            } else if (item[1] && !item[1].bannedUserIds) {
                item[1].bannedUserIds = new Set();
            }
            return item;
        }));
        console.log(`Loaded ${rooms.size} rooms from disk.`);
    } else {
        console.warn('rooms.json was not in the expected format. Starting with empty rooms.');
        rooms = new Map();
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('rooms.json not found. Starting with empty rooms map.');
      rooms = new Map();
    } else {
      console.error('Error loading rooms:', error, '. Starting with empty rooms map.');
      rooms = new Map();
    }
  }
}

function generateRoomIdInternal() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function startRoomDeletionTimer(roomId) {
  if (roomDeletionTimers.has(roomId)) {
    clearTimeout(roomDeletionTimers.get(roomId));
  }
  
  const timer = setTimeout(async () => {
    try {
      if (rooms.has(roomId) && rooms.get(roomId).users.length === 0) {
        rooms.delete(roomId);
        roomDeletionTimers.delete(roomId);
        updateLobby();
        await debouncedSaveRooms();
        console.log(`Room ${roomId} deleted due to inactivity.`);
      }
    } catch (err) {
      console.error(`Error during timed room deletion for ${roomId}:`, err);
    }
  }, CONFIG.TIMING.ROOM_DELETION_TIMEOUT);
  
  roomDeletionTimers.set(roomId, timer);
}

function updateLobby() {
  try {
    const publicRooms = Array.from(rooms.values())
      .filter(room => room.type !== 'private')
      .map(room => ({
        ...room,
        accessCode: undefined,
        isFull: room.users.length >= CONFIG.LIMITS.MAX_ROOM_CAPACITY,
        users: Array.isArray(room.users) ? room.users.map(u => ({ id: u.id, username: u.username, location: u.location })) : []
      }));
    
    io.to('lobby').emit('lobby update', publicRooms);
  } catch (err) {
      console.error("Error in updateLobby:", err);
  }
}

function updateRoom(roomId) {
  try {
    const room = rooms.get(roomId);
    if (room) {
      io.to(roomId).emit('room update', {
        id: room.id,
        name: room.name,
        type: room.type,
        layout: room.layout,
        users: Array.isArray(room.users) ? room.users : [],
        votes: room.votes || {},
        accessCode: undefined
      });
    }
  } catch (err) {
      console.error(`Error in updateRoom for ${roomId}:`, err);
  }
}

function getCurrentMessages(usersInRoom) {
  const messages = {};
  if (Array.isArray(usersInRoom)) {
    usersInRoom.forEach(user => {
      messages[user.id] = userMessageBuffers.get(user.id) || '';
    });
  }
  return messages;
}

const promisifySessionSave = (sessionInstance) => {
    if (!sessionInstance || typeof sessionInstance.save !== 'function') {
        return Promise.resolve();
    }
    return util.promisify(sessionInstance.save).bind(sessionInstance)();
};

async function leaveRoom(socket, userId) {
  try {
    const currentRoomId = socket.roomId;
    if (currentRoomId) {
      const room = rooms.get(currentRoomId);
      if (room) {
        room.users = room.users.filter(user => user.id !== userId);
        room.lastActiveTime = Date.now();
        
        if (room.votes) {
          delete room.votes[userId];
          for (let voterId in room.votes) {
            if (room.votes[voterId] === userId) delete room.votes[voterId];
          }
          io.to(currentRoomId).emit('update votes', room.votes);
        }
        
        socket.leave(currentRoomId);
        io.to(currentRoomId).emit('user left', userId);
        updateRoom(currentRoomId);
        
        if (room.users.length === 0) {
          await startRoomDeletionTimer(currentRoomId);
        }
      }
      
      if (socket.handshake.session && socket.handshake.session.validatedRooms && 
          socket.handshake.session.validatedRooms[currentRoomId]) {
        delete socket.handshake.session.validatedRooms[currentRoomId];
      }
      
      socket.roomId = null;
      
      if (socket.handshake.session) {
        socket.handshake.session.currentRoom = null;
        await promisifySessionSave(socket.handshake.session).catch(err => console.error("Session save failed in leaveRoom:", err));
      }
      
      socket.join('lobby');
    }
    
    updateLobby();
    await debouncedSaveRooms();
  } catch (err) {
    console.error('Error in leaveRoom:', err);
    if (socket && typeof socket.emit === 'function') {
        socket.emit('error', createErrorResponse(ERROR_CODES.SERVER_ERROR, 'Error processing leave room.'));
    }
  }
}

function joinRoom(socket, roomId, userId) {
  try {
    // Check circuit breaker first
    if (!checkRoomCircuit(roomId)) {
      socket.emit('error', createErrorResponse(ERROR_CODES.CIRCUIT_OPEN, 
        'This room is temporarily unavailable due to unusual traffic. Please try again in a minute.'));
      return;
    }
    
    if (!roomId || typeof roomId !== 'string' || roomId.length !== 6) {
      socket.emit('error', createErrorResponse(ERROR_CODES.NOT_FOUND, 'Room not found (invalid ID format).'));
      return;
    }
    
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('error', createErrorResponse(ERROR_CODES.NOT_FOUND, 'Room not found.'));
      return;
    }
    
    if (room.bannedUserIds && room.bannedUserIds.has(userId)) {
      socket.emit('error', createErrorResponse(ERROR_CODES.FORBIDDEN, 'You have been banned from rejoining this room.'));
      return;
    }
    
    let { username, location } = socket.handshake.session || {};
    if (!username || !location) {
        username = "Anonymous";
        location = "On The Web";
        if (socket.handshake.session) {
            socket.handshake.session.username = username;
            socket.handshake.session.location = location;
            socket.handshake.session.userId = userId;
        }
    }
    
    const userLower = normalize(username);
    const locLower = normalize(location);
    const isAnonymous = userLower === 'anonymous' && locLower === 'on the web';
    
    if (!isAnonymous) {
      const userRoomsCount = getUserRoomsCount(userId);
      if (userRoomsCount >= 2) {
        socket.emit('error', createErrorResponse(ERROR_CODES.FORBIDDEN, 'You are already in the maximum number of rooms.'));
        return;
      }
      
      const sameNameLocCount = getUsernameLocationRoomsCount(username, location);
      if (sameNameLocCount >= 2) {
        socket.emit('error', createErrorResponse(ERROR_CODES.FORBIDDEN, 'This username/location is already in the maximum number of rooms.'));
        return;
      }
    }
    
    if (!room.users) room.users = [];
    if (!room.votes) room.votes = {};
    
    if (room.users.length >= CONFIG.LIMITS.MAX_ROOM_CAPACITY) {
      socket.emit('room full', createErrorResponse(ERROR_CODES.ROOM_FULL, 'This room is full.'));
      return;
    }
    
    room.users = room.users.filter(user => user.id !== userId);
    socket.join(roomId);
    room.users.push({ id: userId, username, location });
    room.lastActiveTime = Date.now();
    socket.roomId = roomId;
    
    if (socket.handshake.session) {
        socket.handshake.session.currentRoom = roomId;
        socket.handshake.session.save((err) => {
            if (err) {
                console.error("Session save error in joinRoom:", err);
                socket.emit('error', createErrorResponse(ERROR_CODES.SERVER_ERROR, 'Failed to save session on joining room.'));
                return;
            }
            emitJoinRoomSuccess(socket, room, userId, username, location);
        });
    } else {
        console.warn(`No session found for socket ${socket.id} during joinRoom.`);
        emitJoinRoomSuccess(socket, room, userId, username, location);
    }
    
    debouncedSaveRooms().catch(err => console.error("Failed to save rooms after join:", err));
  } catch (err) {
      console.error("Critical error in joinRoom logic:", err);
      socket.emit('error', createErrorResponse(ERROR_CODES.SERVER_ERROR, 'An unexpected error occurred while joining the room.'));
  }
}

function emitJoinRoomSuccess(socket, room, userId, username, location) {
    io.to(room.id).emit('user joined', { id: userId, username, location, roomName: room.name, roomType: room.type });
    updateRoom(room.id);
    updateLobby();
    
    const currentMessages = getCurrentMessages(room.users);
    socket.emit('room joined', {
      roomId: room.id, userId, username, location,
      roomName: room.name, roomType: room.type, users: room.users,
      layout: room.layout, votes: room.votes, currentMessages
    });
    
    socket.leave('lobby');
    
    if (roomDeletionTimers.has(room.id)) {
      clearTimeout(roomDeletionTimers.get(room.id));
      roomDeletionTimers.delete(room.id);
    }
}

function handleTyping(socket, userId, username, isTyping) {
  try {
    if (!socket.roomId) return;
    
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
  } catch(err) {
    console.error("Error in handleTyping:", err);
  }
}

function onAFKTimeExceeded(socket) {
  try {
    console.log(`Socket ${socket.id} AFK timeout.`);
    socket.emit("error", createErrorResponse(ERROR_CODES.ACCESS_DENIED, "Disconnected due to inactivity.", null, true));
    socket.disconnect(true);
  } catch (err) {
      console.error("Error in onAFKTimeExceeded for socket " + (socket ? socket.id : "unknown"), err);
  }
}

// Initialize
loadRooms().catch(err => {
    console.error("Failed to load rooms on startup:", err);
});

// API Endpoints
app.get(`/api/${CONFIG.VERSIONS.API}/config`, (req, res) => {
  res.json({ limits: CONFIG.LIMITS, features: CONFIG.FEATURES, versions: CONFIG.VERSIONS });
});

app.get(`/api/${CONFIG.VERSIONS.API}/health`, (req, res) => {
  const memUsage = process.memoryUsage();
  const heapUsage = Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100);
  const healthStatus = systemState.memoryWarningLevel > 0 ? 'degraded' : 'ok';
  
  res.json({ 
    status: healthStatus, 
    uptime: process.uptime(), 
    timestamp: Date.now(), 
    version: CONFIG.VERSIONS.SERVER,
    memory: {
      usage: heapUsage,
      allocated: Math.round(memUsage.heapTotal / 1024 / 1024),
      used: Math.round(memUsage.heapUsed / 1024 / 1024)
    },
    connections: io.sockets.sockets.size,
    highLoad: systemState.isHighLoad
  });
});

// Add a status page that people can refresh to see server status
app.get('/status', (req, res) => {
  const memUsage = process.memoryUsage();
  const heapUsage = Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100);
  const activeRooms = rooms.size;
  const activeConnections = io.sockets.sockets.size;
  
  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Talkomatic Server Status</title>
    <meta http-equiv="refresh" content="5">
    <style>
      body { font-family: Arial, sans-serif; margin: 20px; }
      .status { padding: 10px; border-radius: 5px; margin-bottom: 10px; }
      .ok { background-color: #d4edda; }
      .warning { background-color: #fff3cd; }
      .danger { background-color: #f8d7da; }
      table { border-collapse: collapse; width: 100%; margin-top: 20px; }
      th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
      th { background-color: #f2f2f2; }
      .meter { height: 20px; background: #e0e0e0; border-radius: 10px; padding: 0; position: relative; }
      .meter > span { display: block; height: 100%; border-radius: 10px; position: relative; overflow: hidden; }
      .meter > span.green { background-color: #4CAF50; }
      .meter > span.yellow { background-color: #FFC107; }
      .meter > span.red { background-color: #F44336; }
    </style>
  </head>
  <body>
    <h1>Talkomatic Server Status</h1>
    <div class="status ${systemState.memoryWarningLevel === 0 ? 'ok' : systemState.memoryWarningLevel === 1 ? 'warning' : 'danger'}">
      <h2>Server Status: ${systemState.memoryWarningLevel === 0 ? 'Normal' : systemState.memoryWarningLevel === 1 ? 'Warning' : 'High Load'}</h2>
      <p>The server is ${systemState.isHighLoad ? 'under high load' : 'operating normally'}.</p>
    </div>
    
    <h3>System Resource Usage</h3>
    <div>
      <p>Memory Usage: ${heapUsage}%</p>
      <div class="meter">
        <span class="${heapUsage < 70 ? 'green' : heapUsage < 85 ? 'yellow' : 'red'}" style="width: ${heapUsage}%"></span>
      </div>
      <p>Heap Memory: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB / ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB</p>
    </div>
    
    <table>
      <tr>
        <th>Metric</th>
        <th>Value</th>
      </tr>
      <tr>
        <td>Server Version</td>
        <td>${CONFIG.VERSIONS.SERVER}</td>
      </tr>
      <tr>
        <td>Uptime</td>
        <td>${Math.floor(process.uptime() / 60)} minutes</td>
      </tr>
      <tr>
        <td>Active Connections</td>
        <td>${activeConnections}</td>
      </tr>
      <tr>
        <td>Active Rooms</td>
        <td>${activeRooms}</td>
      </tr>
      <tr>
        <td>Connection Mode</td>
        <td>${systemState.isHighLoad ? 'Restricted (high load)' : 'Normal'}</td>
      </tr>
      <tr>
        <td>Memory Warning Level</td>
        <td>${systemState.memoryWarningLevel}</td>
      </tr>
      <tr>
        <td>Connections Dropped</td>
        <td>${systemState.connectionsDropped}</td>
      </tr>
    </table>
    
    <p><small>Last updated: ${new Date().toLocaleString()}</small></p>
  </body>
  </html>
  `;
  
  res.send(html);
});

app.get(`/api/${CONFIG.VERSIONS.API}/me`, (req, res) => {
  const { username, location, userId } = req.session;
  if (username && location && userId) {
    res.json({ isSignedIn: true, username, location, userId });
  } else {
    res.json({ isSignedIn: false });
  }
});

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

// API Auth middleware
function apiAuth(req, res, next) {
  const apiKey = req.header('x-api-key');
  const validApiKey = process.env.TALKOMATIC_API_KEY || 'tK_public_key_4f8a9b2c7d6e3f1a5g8h9i0j4k5l6m7n8o9p';
  
  if (!apiKey || apiKey !== validApiKey) {
    return sendErrorResponse(res, ERROR_CODES.UNAUTHORIZED, 'Forbidden: invalid or missing x-api-key.', 403);
  }
  
  next();
}

app.get(`/api/${CONFIG.VERSIONS.API}/rooms`, apiAuth, (req, res) => {
  try {
    const publicRooms = Array.from(rooms.values())
      .filter(room => room.type !== 'private')
      .map(room => ({
        id: room.id, name: room.name, type: room.type,
        users: Array.isArray(room.users) ? room.users.map(u => ({ id: u.id, username: u.username, location: u.location })) : [],
        isFull: (Array.isArray(room.users) ? room.users.length : 0) >= CONFIG.LIMITS.MAX_ROOM_CAPACITY
      }));
    
    return res.json(publicRooms);
  } catch (err) {
    console.error("Error in GET /api/v1/rooms:", err);
    return sendErrorResponse(res, ERROR_CODES.SERVER_ERROR, 'Internal server error', 500);
  }
});

app.get(`/api/${CONFIG.VERSIONS.API}/rooms/:id`, apiAuth, (req, res) => {
  try {
    const roomId = req.params.id;
    const room = rooms.get(roomId);
    
    if (!room) return sendErrorResponse(res, ERROR_CODES.NOT_FOUND, 'Room not found', 404);
    
    return res.json({
      id: room.id, name: room.name, type: room.type,
      users: Array.isArray(room.users) ? room.users.map(u => ({ id: u.id, username: u.username, location: u.location })) : [],
      isFull: (Array.isArray(room.users) ? room.users.length : 0) >= CONFIG.LIMITS.MAX_ROOM_CAPACITY
    });
  } catch (err) {
    console.error(`Error in GET /api/v1/rooms/${req.params.id}:`, err);
    return sendErrorResponse(res, ERROR_CODES.SERVER_ERROR, 'Internal server error', 500);
  }
});

app.post(`/api/${CONFIG.VERSIONS.API}/rooms`, apiAuth, async (req, res) => {
  try {
    // During high load, reject creating new rooms via API
    if (systemState.memoryWarningLevel >= 2) {
      return sendErrorResponse(res, ERROR_CODES.MAINTENANCE_MODE, 'Server is under high load. Please try again later.', 503);
    }
    
    const data = req.body;
    const validationErrors = validateObject(data, {
      name: { rule: 'roomName' }, type: { rule: 'roomType' }, layout: { rule: 'layout' },
      accessCode: { rule: 'accessCode', context: data.type }
    });
    
    if (validationErrors) {
      return sendErrorResponse(res, ERROR_CODES.VALIDATION_ERROR, 'Validation failed', 400, validationErrors);
    }
    
    let roomName = enforceRoomNameLimit(data.name);
    if (CONFIG.FEATURES.ENABLE_WORD_FILTER) {
      const roomNameCheck = wordFilter.checkText(roomName);
      if (roomNameCheck.hasOffensiveWord) {
        return sendErrorResponse(res, ERROR_CODES.VALIDATION_ERROR, 'Room name contains forbidden words.', 400);
      }
    }
    
    let roomId;
    let attempts = 0;
    do {
      roomId = generateRoomIdInternal();
      attempts++;
      if (attempts > CONFIG.LIMITS.MAX_ID_GEN_ATTEMPTS && rooms.has(roomId)) {
        console.error("API: Failed to generate unique room ID.");
        return sendErrorResponse(res, ERROR_CODES.SERVER_ERROR, 'Could not create room, server busy. Try again.', 500);
      }
    } while (rooms.has(roomId));
    
    const newRoom = {
      id: roomId, name: roomName, type: data.type, layout: data.layout, users: [],
      accessCode: data.type === 'semi-private' ? data.accessCode : null,
      votes: {}, bannedUserIds: new Set(), lastActiveTime: Date.now(),
    };
    
    rooms.set(roomId, newRoom);
    
    if (req.session && data.type === 'semi-private' && data.accessCode) {
      if (!req.session.validatedRooms) req.session.validatedRooms = {};
      req.session.validatedRooms[roomId] = data.accessCode;
      await promisifySessionSave(req.session).catch(err => console.error("API session save error:", err));
    }
    
    updateLobby();
    await debouncedSaveRooms();
    
    return res.status(201).json({ success: true, roomId });
  } catch (err) {
    console.error('Error in POST /api/v1/rooms:', err);
    return sendErrorResponse(res, ERROR_CODES.SERVER_ERROR, 'Internal server error', 500);
  }
});

app.post(`/api/${CONFIG.VERSIONS.API}/rooms/:id/join`, apiAuth, async (req, res) => {
  try {
    const roomId = req.params.id;
    const room = rooms.get(roomId);
    
    if (!room) return sendErrorResponse(res, ERROR_CODES.NOT_FOUND, 'Room not found', 404);
    
    // Check room circuit breaker
    if (!checkRoomCircuit(roomId)) {
      return sendErrorResponse(res, ERROR_CODES.CIRCUIT_OPEN, 
        'This room is temporarily unavailable due to unusual traffic.', 429);
    }
    
    if (room.users.length >= CONFIG.LIMITS.MAX_ROOM_CAPACITY) {
      return sendErrorResponse(res, ERROR_CODES.ROOM_FULL, 'Room is full', 400);
    }
    
    if (room.type === 'semi-private') {
      const validatedAccessCode = req.session && req.session.validatedRooms && req.session.validatedRooms[roomId];
      
      if (!validatedAccessCode) {
        if (!req.body.accessCode) return sendErrorResponse(res, ERROR_CODES.FORBIDDEN, 'Access code required', 403);
        
        if (typeof req.body.accessCode !== 'string' || req.body.accessCode.length !== 6 || !/^\d+$/.test(req.body.accessCode)) {
          return sendErrorResponse(res, ERROR_CODES.VALIDATION_ERROR, 'Invalid access code format', 400);
        }
        
        if (room.accessCode !== req.body.accessCode) {
          return sendErrorResponse(res, ERROR_CODES.FORBIDDEN, 'Incorrect access code', 403);
        }
        
        if (req.session) {
          if (!req.session.validatedRooms) req.session.validatedRooms = {};
          req.session.validatedRooms[roomId] = req.body.accessCode;
          await promisifySessionSave(req.session).catch(err => console.error("API join session save error:", err));
        }
      }
    }
    
    return res.json({ success: true, message: 'Access granted. Connect via Socket.IO to join.' });
  } catch (err) {
    console.error(`Error in POST /api/v1/rooms/${req.params.id}/join:`, err);
    return sendErrorResponse(res, ERROR_CODES.SERVER_ERROR, 'Internal server error', 500);
  }
});

// Socket.IO Event Handlers
io.on('connection', (socket) => {
  let AFK_TIMEOUT = null;
  const clientIp = socket.clientIp || socket.handshake.address;
  
  // Helper to wrap all socket handlers for safety
  function safe(fn) {
    return async (...args) => {
      try {
        await fn(...args);
      } catch (err) {
        console.error(`Socket handler error in ${fn.name || 'unnamed handler'} from ${clientIp}:`, err);
        try {
          socket.emit('error', createErrorResponse(
            ERROR_CODES.SERVER_ERROR,
            'Internal server error processing your request.'
          ));
          // Optional: disconnect persistent error sources
          if (socket._errorCount = (socket._errorCount || 0) + 1 > 5) {
            console.warn(`Disconnecting socket ${socket.id} after multiple errors`);
            socket.disconnect(true);
          }
        } catch (emitErr) {
          console.error('Failed to send error to client:', emitErr);
        }
      }
    };
  }
  
  socket.onAny(() => {
    try {
      clearTimeout(AFK_TIMEOUT);
      if (socket.roomId) {
        AFK_TIMEOUT = setTimeout(() => onAFKTimeExceeded(socket), CONFIG.LIMITS.MAX_AFK_TIME);
      }
    } catch (err) {
        console.error("Error in socket.onAny AFK reset:", err);
    }
  });
  
  socket.on('check signin status', safe(async () => {
    const { username, location, userId } = socket.handshake.session || {};
    
    if (username && location && userId) {
      socket.emit('signin status', { isSignedIn: true, username, location, userId });
      socket.join('lobby');
      users.set(userId, { id: userId, username, location });
      updateLobby();
    } else {
      socket.emit('signin status', { isSignedIn: false });
    }
  }));
  
  socket.on('join lobby', safe(async (data) => {
    if (!data || typeof data !== 'object') {
      socket.emit('error', createErrorResponse(ERROR_CODES.BAD_REQUEST, 'Invalid data for joining lobby.'));
      return;
    }
    
    const validationErrors = validateObject(data, { username: { rule: 'username' }, location: { rule: 'location' } });
    if (validationErrors) {
      socket.emit('validation_error', validationErrors);
      return;
    }
    
    let username = enforceUsernameLimit(data.username);
    let location = enforceLocationLimit(data.location || 'On The Web');
    
    if (CONFIG.FEATURES.ENABLE_WORD_FILTER) {
      if (wordFilter.checkText(username).hasOffensiveWord) {
        socket.emit('error', createErrorResponse(ERROR_CODES.VALIDATION_ERROR, 'Username contains forbidden words.'));
        return;
      }
      
      if (wordFilter.checkText(location).hasOffensiveWord) {
        socket.emit('error', createErrorResponse(ERROR_CODES.VALIDATION_ERROR, 'Location contains forbidden words.'));
        return;
      }
    }
    
    const userId = socket.handshake.sessionID;
    
    if (!socket.handshake.session) {
        socket.emit('error', createErrorResponse(ERROR_CODES.SERVER_ERROR, 'Session not available.'));
        return;
    }
    
    socket.handshake.session.username = username;
    socket.handshake.session.location = location;
    socket.handshake.session.userId = userId;
    
    await new Promise((resolve, reject) => {
      socket.handshake.session.save((err) => {
        if (err) {
          console.error('Session save error in join lobby:', err);
          socket.emit('error', createErrorResponse(ERROR_CODES.SERVER_ERROR, 'Failed to save session.'));
          reject(err);
          return;
        }
        resolve();
      });
    });
    
    users.set(userId, { id: userId, username, location });
    socket.join('lobby');
    updateLobby();
    socket.emit('signin status', { isSignedIn: true, username, location, userId });
  }));
  
  socket.on('create room', safe(async (data) => {
    if (!data || typeof data !== 'object') {
      socket.emit('error', createErrorResponse(ERROR_CODES.BAD_REQUEST, 'Invalid data for creating room.'));
      return;
    }
    
    // Reject new room creation during critical memory situations
    if (systemState.memoryWarningLevel >= 2) {
      socket.emit('error', createErrorResponse(ERROR_CODES.MAINTENANCE_MODE, 
        'Server is under high load. Creating new rooms temporarily disabled.'));
      return;
    }
    
    const userId = socket.handshake.session ? socket.handshake.session.userId : null;
    if (!userId) {
      socket.emit('error', createErrorResponse(ERROR_CODES.UNAUTHORIZED, 'You must be signed in to create a room.'));
      return;
    }
    
    const validationErrors = validateObject(data, {
      name: { rule: 'roomName' }, type: { rule: 'roomType' }, layout: { rule: 'layout' },
      accessCode: { rule: 'accessCode', context: data.type }
    });
    
    if (validationErrors) {
      socket.emit('validation_error', validationErrors);
      return;
    }
    
    const { username, location } = socket.handshake.session;
    const isAnonymous = normalize(username) === 'anonymous' && normalize(location) === 'on the web';
    
    if (isAnonymous) {
      socket.emit('error', createErrorResponse(ERROR_CODES.FORBIDDEN, 'Anonymous users cannot create rooms.'));
      return;
    }
    
    if (getUsernameLocationRoomsCount(username, location) >= 2) {
      socket.emit('error', createErrorResponse(ERROR_CODES.FORBIDDEN, 'This username/location is already in the maximum number of rooms.'));
      return;
    }
    
    if (getUserRoomsCount(userId) >= 2) {
      socket.emit('error', createErrorResponse(ERROR_CODES.FORBIDDEN, 'You are already in the maximum number of rooms.'));
      return;
    }
    
    const now = Date.now();
    if (now - (lastRoomCreationTimes.get(userId) || 0) < CONFIG.TIMING.ROOM_CREATION_COOLDOWN) {
      socket.emit('error', createErrorResponse(ERROR_CODES.RATE_LIMITED, 'Creating rooms too frequently.'));
      return;
    }
    
    let roomName = enforceRoomNameLimit(data.name);
    
    if (CONFIG.FEATURES.ENABLE_WORD_FILTER && wordFilter.checkText(roomName).hasOffensiveWord) {
      socket.emit('error', createErrorResponse(ERROR_CODES.VALIDATION_ERROR, 'Room name contains forbidden words.'));
      return;
    }
    
    lastRoomCreationTimes.set(userId, now);
    
    let roomId;
    let attempts = 0;
    
    do {
      roomId = generateRoomIdInternal();
      attempts++;
      
      if (attempts > CONFIG.LIMITS.MAX_ID_GEN_ATTEMPTS && rooms.has(roomId)) {
        console.error("Socket: Failed to generate unique room ID.");
        socket.emit('error', createErrorResponse(ERROR_CODES.SERVER_ERROR, 'Could not generate unique room ID. Try again.'));
        return;
      }
    } while (rooms.has(roomId));
    
    const newRoom = {
      id: roomId, name: roomName, type: data.type, layout: data.layout, users: [],
      accessCode: data.type === 'semi-private' ? data.accessCode : null,
      votes: {}, bannedUserIds: new Set(), lastActiveTime: now,
    };
    
    rooms.set(roomId, newRoom);
    
    if (data.type === 'semi-private' && data.accessCode) {
      if (!socket.handshake.session.validatedRooms) socket.handshake.session.validatedRooms = {};
      socket.handshake.session.validatedRooms[roomId] = data.accessCode;
      await new Promise((resolve) => {
        socket.handshake.session.save(err => { 
          if (err) console.error("Session save error (create room):", err);
          resolve();
        });
      });
    }
    
    socket.emit('room created', roomId);
    updateLobby();
    await debouncedSaveRooms();
  }));
  
  socket.on('join room', safe(async (data) => {
    if (!data || typeof data !== 'object' || !data.roomId) {
      socket.emit('error', createErrorResponse(ERROR_CODES.BAD_REQUEST, 'Invalid data for joining room.'));
      return;
    }
    
    const room = rooms.get(data.roomId);
    if (!room) {
      socket.emit('room not found', createErrorResponse(ERROR_CODES.NOT_FOUND, 'Room not found.'));
      return;
    }
    
    // Check room circuit breaker
    if (!checkRoomCircuit(data.roomId)) {
      socket.emit('error', createErrorResponse(ERROR_CODES.CIRCUIT_OPEN, 
        'This room is temporarily unavailable due to unusual traffic. Please try again in a minute.'));
      return;
    }
    
    if (room.type === 'semi-private') {
      const validatedAccessCode = socket.handshake.session.validatedRooms && socket.handshake.session.validatedRooms[data.roomId];
      let codeToUse = data.accessCode;
      
      if (validatedAccessCode) {
          codeToUse = validatedAccessCode;
      } else if (!codeToUse) {
        socket.emit('access code required'); return;
      }
      
      if (typeof codeToUse !== 'string' || codeToUse.length !== 6 || !/^\d+$/.test(codeToUse)) {
        socket.emit('error', createErrorResponse(ERROR_CODES.VALIDATION_ERROR, 'Invalid access code format.')); return;
      }
      
      if (room.accessCode !== codeToUse) {
        socket.emit('error', createErrorResponse(ERROR_CODES.FORBIDDEN, 'Incorrect access code.')); return;
      }
      
      if (!validatedAccessCode && socket.handshake.session) {
          if (!socket.handshake.session.validatedRooms) socket.handshake.session.validatedRooms = {};
          socket.handshake.session.validatedRooms[data.roomId] = codeToUse;
          await new Promise((resolve) => {
            socket.handshake.session.save(err => { 
              if (err) console.error("Session save error (join room access code):", err);
              resolve();
            });
          });
      }
    }
    
    let { username, location, userId } = socket.handshake.session || {};
    
    if (!userId) {
        userId = socket.handshake.sessionID;
        if (socket.handshake.session) {
            socket.handshake.session.userId = userId;
            if (!username) socket.handshake.session.username = "Anonymous";
            if (!location) socket.handshake.session.location = "On The Web";
        } else {
            console.error("No session available for socket " + socket.id + " during join room");
            socket.emit('error', createErrorResponse(ERROR_CODES.SERVER_ERROR, 'Session error, cannot join room.'));
            return;
        }
    }
    
    username = username || "Anonymous";
    location = location || "On The Web";
    
    joinRoom(socket, data.roomId, userId);
  }));
  
  socket.on('vote', safe(async (data) => {
    if (!data || typeof data !== 'object' || !data.targetUserId) {
      socket.emit('error', createErrorResponse(ERROR_CODES.BAD_REQUEST, 'Invalid vote data.'));
      return;
    }
    
    const { targetUserId } = data;
    const userId = socket.handshake.session.userId;
    const roomId = socket.roomId;
    
    if (!roomId || !userId) return;
    
    const room = rooms.get(roomId);
    if (!room || !room.users.find(u => u.id === userId)) return;
    if (userId === targetUserId) return;
    
    if (!room.votes) room.votes = {};
    
    if (room.votes[userId] === targetUserId) {
      delete room.votes[userId];
    } else {
      room.votes[userId] = targetUserId;
    }
    
    io.to(roomId).emit('update votes', room.votes);
    
    const votesAgainstTarget = Object.values(room.votes).filter(v => v === targetUserId).length;
    const totalUsers = room.users.length;
    
    if (totalUsers >=3 && votesAgainstTarget > Math.floor(totalUsers / 2)) {
      const targetSocket = [...io.sockets.sockets.values()].find(s => s.handshake.session.userId === targetUserId && s.roomId === roomId);
      
      if (targetSocket) {
        targetSocket.emit('kicked');
        if (!room.bannedUserIds) room.bannedUserIds = new Set();
        room.bannedUserIds.add(targetUserId);
        await leaveRoom(targetSocket, targetUserId);
      }
    }
  }));
  
  socket.on('leave room', safe(async () => {
    clearTimeout(AFK_TIMEOUT);
    const userId = socket.handshake.session ? socket.handshake.session.userId : null;
    if (userId) await leaveRoom(socket, userId);
  }));
  
  // Updated 'chat update' event handler with batching and circuit breaker
  socket.on('chat update', safe(async (data) => {
    // Circuit breaker check
    if (!checkChatCircuit()) {
      socket.emit('error', createErrorResponse(ERROR_CODES.CIRCUIT_OPEN, 'System is temporarily unavailable. Please try again later.'));
      return;
    }
    
    if (!socket.roomId || !socket.handshake.session || !socket.handshake.session.userId) return;
    
    const userId = socket.handshake.session.userId;
    
    if (!data || typeof data !== 'object' || !data.diff || typeof data.diff !== 'object') {
      socket.emit('error', createErrorResponse(ERROR_CODES.BAD_REQUEST, 'Invalid chat update data format.'));
      return;
    }
    
    let { diff } = data;
    
    // Sanitize diff object
    if (!['full-replace', 'add', 'delete', 'replace'].includes(diff.type)) {
      socket.emit('error', createErrorResponse(ERROR_CODES.BAD_REQUEST, 'Unknown diff type.')); 
      return;
    }
    
    if ((diff.type === 'add' || diff.type === 'replace' || diff.type === 'full-replace') && typeof diff.text !== 'string') {
      socket.emit('error', createErrorResponse(ERROR_CODES.BAD_REQUEST, 'Diff text must be a string.')); 
      return;
    }
    
    if (diff.text) diff.text = enforceCharacterLimit(diff.text);
    
    if (diff.type !== 'full-replace' && (typeof diff.index !== 'number' || diff.index < 0)) {
       socket.emit('error', createErrorResponse(ERROR_CODES.BAD_REQUEST, 'Invalid diff index.')); 
       return;
    }
    
    if (diff.type === 'delete' && (typeof diff.count !== 'number' || diff.count < 0)) {
       socket.emit('error', createErrorResponse(ERROR_CODES.BAD_REQUEST, 'Invalid diff count for delete.')); 
       return;
    }
    
    // Add to pending updates
    if (!pendingChatUpdates.has(userId)) {
      pendingChatUpdates.set(userId, { diffs: [] });
    }
    
    pendingChatUpdates.get(userId).diffs.push(diff);
    
    // Schedule processing if not already scheduled
    if (!batchProcessingTimers.has(userId)) {
      batchProcessingTimers.set(userId, setTimeout(() => {
        processPendingChatUpdates(userId, socket);
      }, CONFIG.TIMING.BATCH_PROCESSING_INTERVAL));
    }
  }));
  
  socket.on('typing', safe(async (data) => {
    if (!socket.roomId || !socket.handshake.session || !socket.handshake.session.userId) return;
    
    const userId = socket.handshake.session.userId;
    const username = socket.handshake.session.username || "Anonymous";
    
    await typingLimiter.consume(userId).catch(() => { return; });
    
    if (!data || typeof data.isTyping !== 'boolean') return;
    
    handleTyping(socket, userId, username, data.isTyping);
  }));
  
  socket.on('get rooms', safe(async () => {
    const publicRooms = Array.from(rooms.values())
        .filter(room => room.type !== 'private')
        .map(room => ({
            ...room,
            accessCode: undefined,
            isFull: room.users.length >= CONFIG.LIMITS.MAX_ROOM_CAPACITY,
            users: Array.isArray(room.users) ? room.users.map(u => ({ id: u.id, username: u.username, location: u.location })) : []
        }));
    
    socket.emit('initial rooms', publicRooms);
  }));
  
  socket.on('get room state', safe(async (roomId) => {
    if (!roomId || typeof roomId !== 'string') {
      socket.emit('error', createErrorResponse(ERROR_CODES.BAD_REQUEST, 'Room ID is required.')); 
      return;
    }
    
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('error', createErrorResponse(ERROR_CODES.NOT_FOUND, 'Room not found.')); 
      return;
    }
    
    socket.emit('room state', {
      id: room.id, name: room.name, type: room.type, layout: room.layout,
      users: room.users, votes: room.votes,
      currentMessages: getCurrentMessages(room.users),
      isFull: room.users.length >= CONFIG.LIMITS.MAX_ROOM_CAPACITY
    });
  }));
  
  socket.on('disconnect', safe(async (reason) => {
    clearTimeout(AFK_TIMEOUT);
    
    const userId = socket.handshake.session ? socket.handshake.session.userId : null;
    if (userId) {
      await leaveRoom(socket, userId);
      userMessageBuffers.delete(userId);
      
      // Clear typing timeouts
      if (typingTimeouts.has(userId)) {
        clearTimeout(typingTimeouts.get(userId));
        typingTimeouts.delete(userId);
      }
      
      // Clean up batch processing
      if (batchProcessingTimers.has(userId)) {
        clearTimeout(batchProcessingTimers.get(userId));
        batchProcessingTimers.delete(userId);
        pendingChatUpdates.delete(userId);
      }
      
      users.delete(userId);
    }
    
    if (socket.clientIp) {
      const currentCount = ipConnections.get(socket.clientIp) || 0;
      if (currentCount > 1) ipConnections.set(socket.clientIp, currentCount - 1);
      else ipConnections.delete(socket.clientIp);
    }
    
    console.log(`Socket ${socket.id} disconnected. Reason: ${reason}. IP: ${socket.clientIp}`);
  }));
});

// Periodic cleanup for empty rooms
setInterval(async () => {
  for (const [roomId, room] of rooms.entries()) {
    if (room.users.length === 0) {
      const timeSinceLastActive = Date.now() - (room.lastActiveTime || 0);
      if (timeSinceLastActive > CONFIG.TIMING.ROOM_DELETION_TIMEOUT && !roomDeletionTimers.has(roomId)) {
        console.log(`Periodic cleanup: Room ${roomId} is empty and inactive. Deleting.`);
        rooms.delete(roomId);
        updateLobby();
        try {
            await debouncedSaveRooms();
        } catch (e) {
            console.error("Periodic cleanup saveRooms error:", e);
        }
      }
    }
  }
}, 60000);

// Cleanup abandoned resources
setInterval(() => {
  // Find active user IDs from all rooms
  const activeUserIds = new Set();
  for (const [, room] of rooms.entries()) {
    if (Array.isArray(room.users)) {
      for (const user of room.users) {
        activeUserIds.add(user.id);
      }
    }
  }
  
  // Clean up message buffers for inactive users
  for (const bufferId of userMessageBuffers.keys()) {
    if (!activeUserIds.has(bufferId)) {
      userMessageBuffers.delete(bufferId);
      console.log(`Cleaned up abandoned message buffer for user ${bufferId}`);
    }
  }
  
  // Clean up typing timeouts
  for (const timeoutId of typingTimeouts.keys()) {
    if (!activeUserIds.has(timeoutId)) {
      clearTimeout(typingTimeouts.get(timeoutId));
      typingTimeouts.delete(timeoutId);
      console.log(`Cleaned up abandoned typing timeout for user ${timeoutId}`);
    }
  }
  
  // Clean up batch processing timers and pending updates
  for (const userId of batchProcessingTimers.keys()) {
    if (!activeUserIds.has(userId)) {
      clearTimeout(batchProcessingTimers.get(userId));
      batchProcessingTimers.delete(userId);
      pendingChatUpdates.delete(userId);
      console.log(`Cleaned up abandoned batch processing for user ${userId}`);
    }
  }
}, 300000); // Every 5 minutes

// Enhanced server crash protection monitor
setInterval(() => {
  try {
    const memoryUsage = process.memoryUsage();
    const heapUsedPercentage = Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100);
    const now = Date.now();
    
    // Update memory warning level
    if (heapUsedPercentage > 90) {
      systemState.memoryWarningLevel = 2; // Critical
      console.warn(`MEMORY CRITICAL: Heap usage at ${heapUsedPercentage}%`);
    } else if (heapUsedPercentage > 80) {
      systemState.memoryWarningLevel = 1; // Warning
      console.warn(`MEMORY WARNING: Heap usage at ${heapUsedPercentage}%`);
    } else {
      systemState.memoryWarningLevel = 0; // Normal
    }
    
    // Set high load flag based on memory and connection count
    const connectedClients = io.sockets.sockets.size;
    const isHighLoad = (heapUsedPercentage > 85) || (connectedClients > 100);
    
    if (isHighLoad && !systemState.isHighLoad) {
      systemState.isHighLoad = true;
      systemState.highLoadSince = now;
      console.warn(`HIGH LOAD MODE ACTIVATED: ${connectedClients} clients, ${heapUsedPercentage}% heap usage`);
    } else if (!isHighLoad && systemState.isHighLoad && (now - systemState.highLoadSince > 60000)) {
      // Only exit high load mode after it's been normal for at least 1 minute
      systemState.isHighLoad = false;
      console.log(`HIGH LOAD MODE DEACTIVATED: ${connectedClients} clients, ${heapUsedPercentage}% heap usage`);
    }
    
    // Emergency cleanup of large message buffers during critical memory situations
    if (systemState.memoryWarningLevel === 2) {
      console.warn("EMERGENCY MEMORY CLEANUP: Clearing large message buffers");
      for (const [userId, message] of userMessageBuffers.entries()) {
        if (message.length > 1000) {
          userMessageBuffers.set(userId, message.substring(0, 1000) + "... [truncated for system stability]");
        }
      }
      
      // Force garbage collection if possible
      if (global.gc) {
        console.log("Forcing garbage collection");
        global.gc();
      }
    }
    
    // Periodic status report (only log every minute to avoid log spam)
    if (now - systemState.lastReportTime > 60000) {
      console.log(`Server status: ${connectedClients} connected clients, heap usage: ${heapUsedPercentage}%, memory warning level: ${systemState.memoryWarningLevel}`);
      systemState.lastReportTime = now;
      
      // Check for IP addresses with excessive connections
      let suspiciousIPs = 0;
      for (const [ip, count] of ipConnections.entries()) {
        if (count > CONFIG.LIMITS.MAX_CONNECTIONS_PER_IP * 0.8) {
          console.warn(`IP warning: ${ip} has ${count} connections (max: ${CONFIG.LIMITS.MAX_CONNECTIONS_PER_IP})`);
          suspiciousIPs++;
        }
      }
      
      if (suspiciousIPs > 0) {
        console.warn(`${suspiciousIPs} suspicious IPs detected with high connection counts`);
      }
      
      // Clean up tracking for rate limiting
      if (roomCircuitBreakers.size > 100) {
        const oldCircuits = [...roomCircuitBreakers.entries()]
          .filter(([_, data]) => now - data.lastReset > 3600000 && !data.isOpen)
          .map(([roomId]) => roomId);
          
        for (const roomId of oldCircuits) {
          roomCircuitBreakers.delete(roomId);
        }
        
        console.log(`Cleaned up ${oldCircuits.length} old room circuit breakers`);
      }
      
      // Clean up old connection tracking
      if (connectionTimestamps.size > 1000) {
        const entriesToRemove = [...connectionTimestamps.entries()]
          .filter(([_, timestamps]) => timestamps.length === 0 || 
                                      (timestamps.length > 0 && now - Math.max(...timestamps) > 3600000))
          .map(([ip]) => ip);
        
        for (const ip of entriesToRemove) {
          connectionTimestamps.delete(ip);
          connectionCounts.delete(ip);
        }
        
        console.log(`Cleaned up connection tracking for ${entriesToRemove.length} IPs`);
      }
      
      // Clean up expired IP blocks
      const expiredBlocks = [...blockedIPs.entries()]
        .filter(([_, data]) => now > data.expiry)
        .map(([ip]) => ip);
      
      for (const ip of expiredBlocks) {
        blockedIPs.delete(ip);
      }
      
      if (expiredBlocks.length > 0) {
        console.log(`Removed ${expiredBlocks.length} expired IP blocks`);
      }
    }
  } catch (err) {
    console.error("Error in server monitor:", err);
  }
}, 15000); // Every 15 seconds

// Monitor for persistent attackers
setInterval(() => {
  try {
    const now = Date.now();
    
    // Check for persistent connection attempts
    for (const [ip, timestamps] of connectionTimestamps.entries()) {
      // Clean up old timestamps
      const recentTimestamps = timestamps.filter(ts => now - ts < 60000); // Last minute
      connectionTimestamps.set(ip, recentTimestamps);
      
      // If still actively connecting despite being blocked
      if (blockedIPs.has(ip) && recentTimestamps.length > 5) {
        const blockData = blockedIPs.get(ip);
        
        // Extend block for persistent offenders
        const newExpiry = now + 3600000; // 1 hour
        blockedIPs.set(ip, {
          expiry: Math.max(blockData.expiry, newExpiry),
          count: blockData.count + 1
        });
        
        console.warn(`Extended block for persistent offender IP: ${ip}`);
      }
    }
  } catch (err) {
    console.error("Error in persistent attacker monitor:", err);
  }
}, 30000); // Every 30 seconds

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Talkomatic server is running on port ${PORT}`);
  console.log(`Server version: ${CONFIG.VERSIONS.SERVER}`);
  console.log(`Node.js version: ${process.version}`);
});