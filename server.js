require("dotenv").config();
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const fs = require("fs").promises;
const path = require("path");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const sharedsession = require("express-socket.io-session");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const xss = require("xss-clean");
const hpp = require("hpp");
const crypto = require("crypto");
const WordFilter = require("./public/js/word-filter.js");
const util = require("util");
const { RateLimiterMemory } = require("rate-limiter-flexible");

// Global error handlers - last line of defense
process.on("unhandledRejection", (reason, promise) => {
  console.error("=== UNHANDLED PROMISE REJECTION ===");
  console.error("Reason:", reason);
  console.error("Promise:", promise);
  console.error(
    "Stack:",
    reason instanceof Error ? reason.stack : "No stack trace available"
  );
  console.error("=====================================");
});

process.on("uncaughtException", (error) => {
  console.error("=== UNCAUGHT EXCEPTION ===");
  console.error("Error:", error.message);
  console.error("Stack:", error.stack);
  console.error("===========================");
});

// Configuration - OPTIMIZED VALUES
const CONFIG = {
  LIMITS: {
    MAX_USERNAME_LENGTH: 15,
    MAX_AFK_TIME: 180000, // Set to 3 minutes (180000ms) for inactive users
    MAX_LOCATION_LENGTH: 20,
    MAX_ROOM_NAME_LENGTH: 25,
    MAX_MESSAGE_LENGTH: 5000,
    MAX_ROOM_CAPACITY: 5,
    MAX_CONNECTIONS_PER_IP: 30,
    SOCKET_MAX_REQUESTS_WINDOW: 1,
    SOCKET_MAX_REQUESTS_PER_WINDOW: 50,
    CHAT_UPDATE_RATE_LIMIT: 300,
    TYPING_RATE_LIMIT: 60,
    CONNECTION_DELAY: 100,
    MAX_ID_GEN_ATTEMPTS: 100,
    BATCH_SIZE_LIMIT: 50,
  },
  FEATURES: {
    ENABLE_WORD_FILTER: true,
    LOAD_ROOMS_ON_STARTUP: false, // Added flag to control room loading on startup
  },
  TIMING: {
    ROOM_CREATION_COOLDOWN: 10000,
    ROOM_DELETION_TIMEOUT: 30000,
    TYPING_TIMEOUT: 2000,
    BATCH_PROCESSING_INTERVAL: 20,
    AFK_WARNING_TIME: 150000, // 2.5 minutes - warn before kick
  },
  VERSIONS: {
    API: "v1",
    SERVER: "1.3.2", // Updated version with AFK improvements
  },
};

const ERROR_CODES = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  SERVER_ERROR: "SERVER_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  NOT_FOUND: "NOT_FOUND",
  RATE_LIMITED: "RATE_LIMITED",
  ROOM_FULL: "ROOM_FULL",
  ACCESS_DENIED: "ACCESS_DENIED",
  BAD_REQUEST: "BAD_REQUEST",
  FORBIDDEN: "FORBIDDEN",
  CIRCUIT_OPEN: "CIRCUIT_OPEN",
  AFK_WARNING: "AFK_WARNING",
  AFK_TIMEOUT: "AFK_TIMEOUT",
};

// Load word filter
let wordFilter;
try {
  wordFilter = new WordFilter(
    path.join(__dirname, "public", "js", "offensive_words.json")
  );
} catch (err) {
  console.error(
    "Failed to initialize WordFilter. Word filtering will be disabled.",
    err
  );
  wordFilter = {
    checkText: () => ({ hasOffensiveWord: false }),
    filterText: (text) => text,
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

// Track AFK timers and warnings
const afkTimers = new Map();
const afkWarningTimers = new Map();

// Circuit breaker state with more lenient thresholds
const chatCircuitState = {
  failures: 0,
  lastFailure: 0,
  isOpen: false,
  threshold: 50,
  resetTimeout: 15000,
};

// Connection and rate limiting trackers
const ipConnections = new Map();
const ipLastConnectionTime = new Map();
const blockedIPs = new Map();

// Rate limiters - OPTIMIZED SETTINGS
const socketRateLimiter = new RateLimiterMemory({
  points: CONFIG.LIMITS.SOCKET_MAX_REQUESTS_PER_WINDOW,
  duration: CONFIG.LIMITS.SOCKET_MAX_REQUESTS_WINDOW,
  blockDuration: 5,
});

const chatUpdateLimiter = new RateLimiterMemory({
  points: CONFIG.LIMITS.CHAT_UPDATE_RATE_LIMIT,
  duration: 5,
  blockDuration: 2,
});

const typingLimiter = new RateLimiterMemory({
  points: CONFIG.LIMITS.TYPING_RATE_LIMIT,
  duration: 1,
});

const ipRateLimiter = new RateLimiterMemory({
  points: 20,
  duration: 15,
  blockDuration: 30,
});

const app = express();
const server = http.createServer(app);

// Improved proxy trust setting for production
const trustProxyConfig =
  process.env.NODE_ENV === "production"
    ? process.env.CLOUDFLARE_ENABLED === "true"
      ? 2
      : 1
    : "127.0.0.1";
app.set("trust proxy", trustProxyConfig);

// CORS Configuration
const allowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://classic.talkomatic.co",
  "https://congenial-space-umbrella-59w564vwqgph49g5.github.dev" // REMOVE
];

const corsOptions = {
  origin: function (origin, callback) {
    if (
      !origin ||
      allowedOrigins.indexOf(origin) !== -1 ||
      origin.endsWith("github.io")
    ) {
      return callback(null, true);
    }
    return callback(
      new Error("The CORS policy does not allow access from this origin."),
      false
    );
  },
  methods: ["GET", "POST"],
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization", "x-api-key"],
};

// Express middleware - OPTIMIZED
app.use(express.json({ limit: "100kb" }));
app.use(cors(corsOptions));
app.use(cookieParser());
app.use((req, res, next) => {
  res.locals.nonce = crypto.randomBytes(16).toString("base64");
  next();
});

// Security middleware - OPTIMIZED
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
          (req, res) => `'nonce-${res.locals.nonce}'`,
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://cdnjs.cloudflare.com",
          "https://fonts.googleapis.com",
        ],
        imgSrc: ["'self'", "data:", "https:", "blob:"],
        connectSrc: ["'self'"],
        fontSrc: [
          "'self'",
          "https://fonts.gstatic.com",
          "https://cdnjs.cloudflare.com",
        ],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
        styleSrcElem: [
          "'self'",
          "'unsafe-inline'",
          "https://cdnjs.cloudflare.com",
          "https://fonts.googleapis.com",
        ],
        scriptSrcElem: [
          "'self'",
          "https://cdnjs.cloudflare.com",
          "https://classic.talkomatic.co",
          (req, res) => `'nonce-${res.locals.nonce}'`,
        ],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: false,
  })
);
app.use(xss());
app.use(hpp());

// Global rate limiter - OPTIMIZED
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: ERROR_CODES.RATE_LIMITED,
      message: "Too many requests, please try again later.",
    },
  },
});
app.use(limiter);

// Session management
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 14 * 24 * 60 * 60 * 1000,
    sameSite: "lax",
  },
});
app.use(sessionMiddleware);

// Socket.IO setup with improved configuration
const io = socketIo(server, {
  cors: {
    origin: function (origin, callback) {
      if (
        !origin ||
        allowedOrigins.indexOf(origin) !== -1 ||
        origin.endsWith("github.io")
      ) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by Socket.IO CORS"), false);
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
  proxy: true,
  pingTimeout: 60000,
  pingInterval: 25000,
  connectTimeout: 45000,
  maxHttpBufferSize: 2e6,
  transports: ["websocket", "polling"],
  // Performance optimizations
  perMessageDeflate: {
    threshold: 1024,
  },
  httpCompression: true,
});

// Socket.IO middleware for connection control and rate limiting - OPTIMIZED
io.use((socket, next) => {
  try {
    const clientIp =
      socket.handshake.headers["x-forwarded-for"]?.split(",")[0].trim() ||
      socket.handshake.address;

    // Check if IP is blocked
    if (blockedIPs.has(clientIp)) {
      const blockData = blockedIPs.get(clientIp);
      if (Date.now() < blockData.expiry) {
        console.warn(`Rejected connection from blocked IP: ${clientIp}`);
        return next(new Error("IP temporarily blocked due to abuse detection"));
      } else {
        blockedIPs.delete(clientIp);
      }
    }

    // IP rate limiting - OPTIMIZED
    ipRateLimiter
      .consume(clientIp)
      .then(() => {
        // Connection count check
        const connectionsCount = ipConnections.get(clientIp) || 0;
        if (connectionsCount >= CONFIG.LIMITS.MAX_CONNECTIONS_PER_IP) {
          console.warn(`Rate limit (max connections): ${clientIp}`);
          return next(new Error("Too many connections from this IP"));
        }
        ipConnections.set(clientIp, connectionsCount + 1);
        socket.clientIp = clientIp;

        // Socket event rate limiting - OPTIMIZED with faster bypass
        socket.use((packet, nextMiddleware) => {
          const eventName = packet[0];
          if (
            ["error", "connect", "disconnect", "disconnecting"].includes(
              eventName
            )
          ) {
            return nextMiddleware();
          }

          // Fast path for low-impact events without rate limiting
          if (["typing", "get rooms", "get room state"].includes(eventName)) {
            return nextMiddleware();
          }

          socketRateLimiter
            .consume(socket.id)
            .then(() => nextMiddleware())
            .catch(() => {
              console.warn(
                `Socket rate limit exceeded for ${eventName} from ${socket.id}`
              );
              socket.emit(
                "error",
                createErrorResponse(
                  ERROR_CODES.RATE_LIMITED,
                  "Rate limit exceeded: Too many requests per second."
                )
              );
            });
        });

        next();
      })
      .catch(() => {
        console.warn(`IP rate limit exceeded for ${clientIp}`);
        return next(new Error("IP rate limit exceeded"));
      });
  } catch (err) {
    console.error("Socket connection middleware error:", err);
    next(new Error("Internal server error during connection setup"));
  }
});

io.use(sharedsession(sessionMiddleware, { autoSave: true }));

// Serve static files with optimized caching
app.use(
  express.static(path.join(__dirname, "public"), {
    setHeaders: (res, filePath) => {
      // Enhanced caching for static assets
      if (filePath.endsWith(".js")) {
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=31536000");
      } else if (filePath.endsWith(".css")) {
        res.setHeader("Cache-Control", "public, max-age=31536000");
      } else if (filePath.match(/\.(jpg|jpeg|png|gif|ico|svg)$/)) {
        res.setHeader("Cache-Control", "public, max-age=31536000");
      }

      if (filePath.endsWith(".ttf")) {
        res.setHeader("Content-Type", "font/ttf");
      }
    },
  })
);

// Utility functions
function createErrorResponse(
  code,
  message,
  details = null,
  replaceDefaultText = false
) {
  const response = { error: { code, message, replaceDefaultText } };
  if (details) response.error.details = details;
  return response;
}

function sendErrorResponse(res, code, message, status = 400, details = null) {
  return res.status(status).json(createErrorResponse(code, message, details));
}

// OPTIMIZED validation functions
const validationRules = {
  username: (value) => {
    if (!value || typeof value !== "string")
      return "Username is required and must be a string.";
    if (value.trim().length === 0) return "Username cannot be empty.";
    if (value.length > CONFIG.LIMITS.MAX_USERNAME_LENGTH)
      return `Username must be at most ${CONFIG.LIMITS.MAX_USERNAME_LENGTH} characters.`;
    return null;
  },
  location: (value) => {
    if (value && typeof value !== "string") return "Location must be a string.";
    if (
      typeof value === "string" &&
      value.length > CONFIG.LIMITS.MAX_LOCATION_LENGTH
    )
      return `Location must be at most ${CONFIG.LIMITS.MAX_LOCATION_LENGTH} characters.`;
    return null;
  },
  roomName: (value) => {
    if (!value || typeof value !== "string")
      return "Room name is required and must be a string.";
    if (value.trim().length === 0) return "Room name cannot be empty.";
    if (value.length > CONFIG.LIMITS.MAX_ROOM_NAME_LENGTH)
      return `Room name must be at most ${CONFIG.LIMITS.MAX_ROOM_NAME_LENGTH} characters.`;
    return null;
  },
  roomType: (value) => {
    if (!value) return "Room type is required.";
    if (!["public", "semi-private", "private"].includes(value))
      return "Room type must be public, semi-private, or private.";
    return null;
  },
  layout: (value) => {
    if (!value) return "Room layout is required.";
    if (!["horizontal", "vertical"].includes(value))
      return "Room layout must be horizontal or vertical.";
    return null;
  },
  accessCode: (value, roomType) => {
    if (roomType === "semi-private") {
      if (!value) return "Access code is required for semi-private rooms.";
      if (
        typeof value !== "string" ||
        value.length !== 6 ||
        !/^\d+$/.test(value)
      )
        return "Access code must be a 6-digit number.";
    }
    return null;
  },
};

function validate(field, value, context = {}) {
  if (validationRules[field]) {
    return validationRules[field](value, context);
  }
  return `Unknown validation field: ${field}`;
}

function validateObject(obj, rules) {
  const errors = {};
  if (typeof obj !== "object" || obj === null) {
    errors._general = "Invalid data object provided for validation.";
    return errors;
  }

  for (const [field, options] of Object.entries(rules)) {
    const value = obj[field];
    const context =
      options.context !== undefined
        ? options.context
        : obj.type || obj.roomType;
    const error = validate(options.rule || field, value, context);
    if (error) {
      errors[field] = error;
    }
  }

  return Object.keys(errors).length > 0 ? errors : null;
}

// OPTIMIZED string normalization - Using a cache for common values
const normalizeCache = new Map();
function normalize(str) {
  if (!str) return "";

  const cacheKey = str;
  if (normalizeCache.has(cacheKey)) {
    return normalizeCache.get(cacheKey);
  }

  const normalized = str.trim().toLowerCase();

  // Only cache if string is worth caching (not too long)
  if (str.length <= 30) {
    normalizeCache.set(cacheKey, normalized);

    // Keep cache size reasonable
    if (normalizeCache.size > 1000) {
      const keysToDelete = Array.from(normalizeCache.keys()).slice(0, 200);
      keysToDelete.forEach((key) => normalizeCache.delete(key));
    }
  }

  return normalized;
}

// OPTIMIZED user counting functions
function getUserRoomsCount(userId) {
  let count = 0;
  for (const [, room] of rooms) {
    if (room.users.some((u) => u.id === userId)) count++;
    if (count >= 2) break; // Early exit if count already reaches limit
  }
  return count;
}

function getUsernameLocationRoomsCount(username, location) {
  const userLower = normalize(username);
  const locLower = normalize(location);
  let count = 0;

  for (const [, room] of rooms) {
    for (const u of room.users) {
      if (
        normalize(u.username) === userLower &&
        normalize(u.location) === locLower
      ) {
        count++;
        if (count >= 2) return count; // Early exit if count already reaches limit
      }
    }
  }

  return count;
}

// OPTIMIZED string truncation functions
function enforceCharacterLimit(message) {
  return typeof message === "string"
    ? message.slice(0, CONFIG.LIMITS.MAX_MESSAGE_LENGTH)
    : "";
}

function enforceUsernameLimit(username) {
  return typeof username === "string"
    ? username.slice(0, CONFIG.LIMITS.MAX_USERNAME_LENGTH)
    : "";
}

function enforceLocationLimit(location) {
  return typeof location === "string"
    ? location.slice(0, CONFIG.LIMITS.MAX_LOCATION_LENGTH)
    : "";
}

function enforceRoomNameLimit(roomName) {
  return typeof roomName === "string"
    ? roomName.slice(0, CONFIG.LIMITS.MAX_ROOM_NAME_LENGTH)
    : "";
}

// AFK handling functions
function setupAFKTimers(socket, userId) {
  clearAFKTimers(userId);

  if (!socket || !socket.roomId) return;

  // Set warning timer (fires 30 seconds before timeout)
  const warningTimer = setTimeout(() => {
    if (socket && socket.connected) {
      socket.emit("afk warning", {
        message:
          "You have been inactive. You will be returned to the lobby soon.",
        secondsRemaining: 30,
      });
    }
  }, CONFIG.TIMING.AFK_WARNING_TIME);

  // Set AFK timeout timer
  const afkTimer = setTimeout(() => {
    handleAFKTimeout(socket, userId);
  }, CONFIG.LIMITS.MAX_AFK_TIME);

  // Store timers for cleanup
  afkWarningTimers.set(userId, warningTimer);
  afkTimers.set(userId, afkTimer);
}

function clearAFKTimers(userId) {
  // Clear existing timers if any
  if (afkWarningTimers.has(userId)) {
    clearTimeout(afkWarningTimers.get(userId));
    afkWarningTimers.delete(userId);
  }

  if (afkTimers.has(userId)) {
    clearTimeout(afkTimers.get(userId));
    afkTimers.delete(userId);
  }
}

async function handleAFKTimeout(socket, userId) {
  if (!socket || !socket.roomId) return;

  console.log(`AFK timeout for user ${userId} in room ${socket.roomId}`);

  try {
    // Send notification to user
    socket.emit("afk timeout", {
      message: "You have been removed from the room due to inactivity.",
      redirectTo: "/",
    });

    // Remove from room but don't disconnect
    await leaveRoom(socket, userId);

    // Clear the timers
    clearAFKTimers(userId);
  } catch (err) {
    console.error(`Error in handleAFKTimeout for user ${userId}:`, err);
  }
}

// OPTIMIZED chat update batch processing
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
    let userMessage = userMessageBuffers.get(userId) || "";
    const username = socket.handshake.session.username || "Anonymous";

    // Process rate limiting once for the batch - OPTIMIZED
    let shouldRateLimit = false;
    try {
      // Adjust points based on batch size with lower consumption rate
      const pointsToConsume = Math.min(
        1 + Math.floor(pendingData.diffs.length / 10),
        2
      );

      await chatUpdateLimiter.consume(userId, pointsToConsume);
    } catch (rateErr) {
      // Instead of failing, just mark that we should limit
      shouldRateLimit = true;

      // Only emit warning if seriously rate limited (don't spam users)
      if (rateErr.msBeforeNext > 1000) {
        socket.emit("message", {
          type: "warning",
          text: "Slow down typing, some updates are being delayed",
        });
      }
    }

    // If rate limited, process a smaller batch
    const batchLimit = shouldRateLimit
      ? Math.min(10, CONFIG.LIMITS.BATCH_SIZE_LIMIT)
      : CONFIG.LIMITS.BATCH_SIZE_LIMIT;

    // Limit batch size for processing
    const batchToProcess = pendingData.diffs.slice(0, batchLimit);
    pendingData.diffs = pendingData.diffs.slice(batchLimit);

    // Create a consolidated diff for the entire batch
    let consolidatedMessage = userMessage;

    // Process each diff in the batch
    for (const diff of batchToProcess) {
      // Apply the same processing logic from your original 'chat update' handler
      if (diff.type === "full-replace") {
        consolidatedMessage = diff.text || "";
      } else if (diff.type === "add") {
        diff.index = Math.min(diff.index, consolidatedMessage.length);
        if (
          consolidatedMessage.length + (diff.text || "").length >
          CONFIG.LIMITS.MAX_MESSAGE_LENGTH
        ) {
          diff.text = (diff.text || "").substring(
            0,
            CONFIG.LIMITS.MAX_MESSAGE_LENGTH - consolidatedMessage.length
          );
        }
        consolidatedMessage =
          consolidatedMessage.slice(0, diff.index) +
          (diff.text || "") +
          consolidatedMessage.slice(diff.index);
      } else if (diff.type === "delete") {
        diff.index = Math.min(diff.index, consolidatedMessage.length);
        diff.count = Math.min(
          diff.count,
          consolidatedMessage.length - diff.index
        );
        consolidatedMessage =
          consolidatedMessage.slice(0, diff.index) +
          consolidatedMessage.slice(diff.index + diff.count);
      } else if (diff.type === "replace") {
        diff.index = Math.min(diff.index, consolidatedMessage.length);
        const replaceTextLength = (diff.text || "").length;
        if (
          consolidatedMessage.length -
            Math.min(
              replaceTextLength,
              consolidatedMessage.length - diff.index
            ) +
            replaceTextLength >
          CONFIG.LIMITS.MAX_MESSAGE_LENGTH
        ) {
          diff.text = (diff.text || "").substring(
            0,
            CONFIG.LIMITS.MAX_MESSAGE_LENGTH -
              (consolidatedMessage.length -
                Math.min(
                  replaceTextLength,
                  consolidatedMessage.length - diff.index
                ))
          );
        }
        const endReplaceIndex = Math.min(
          diff.index + replaceTextLength,
          consolidatedMessage.length
        );
        consolidatedMessage =
          consolidatedMessage.slice(0, diff.index) +
          (diff.text || "") +
          consolidatedMessage.slice(endReplaceIndex);
      }
    }

    // Clean up and store the final message
    consolidatedMessage = consolidatedMessage.replace(/\r/g, "");
    consolidatedMessage = enforceCharacterLimit(consolidatedMessage);
    userMessageBuffers.set(userId, consolidatedMessage);

    // Create a simplified full-replace diff to broadcast
    const broadcastDiff = {
      type: "full-replace",
      text: consolidatedMessage,
    };

    let messageIsAppropriate = true;
    // Filter offensive words if enabled
    if (CONFIG.FEATURES.ENABLE_WORD_FILTER) {
      const filterResult = wordFilter.checkText(consolidatedMessage);
      if (filterResult.hasOffensiveWord) {
        messageIsAppropriate = false;
        io.to(socket.roomId).emit("chat update", {
          userId,
          username,
          diff: {
            type: 'full-replace',
            text: wordFilter.filterText(consolidatedMessage),
          }
        });
      }
    }
    if (messageIsAppropriate) {
      // Broadcast unfiltered message to others, since we know it's appropriate
      socket
        .to(socket.roomId)
        .emit("chat update", { userId, username, diff: broadcastDiff });
    }

    // Reset user's AFK timers since they're active
    setupAFKTimers(socket, userId);

    // If there are remaining diffs, schedule another batch with reduced interval
    if (pendingData.diffs.length > 0) {
      batchProcessingTimers.set(
        userId,
        setTimeout(() => {
          processPendingChatUpdates(userId, socket);
        }, CONFIG.TIMING.BATCH_PROCESSING_INTERVAL)
      );
    } else {
      pendingChatUpdates.delete(userId);
    }

    // Reset circuit breaker failures counter on successful updates
    if (chatCircuitState.failures > 0) {
      chatCircuitState.failures--;
    }
  } catch (error) {
    console.error("Error processing batched chat updates:", error);
    pendingChatUpdates.delete(userId);
  }
}

// OPTIMIZED circuit breaker
function checkChatCircuit() {
  const now = Date.now();

  // Reset after configured timeout
  if (
    chatCircuitState.isOpen &&
    now - chatCircuitState.lastFailure > chatCircuitState.resetTimeout
  ) {
    chatCircuitState.isOpen = false;
    chatCircuitState.failures = 0;
    console.log("Chat circuit breaker reset");
  }

  // Only open circuit if above threshold
  if (
    !chatCircuitState.isOpen &&
    chatCircuitState.failures > chatCircuitState.threshold
  ) {
    chatCircuitState.isOpen = true;
    chatCircuitState.lastFailure = now;
    console.warn(
      `Chat circuit breaker opened after ${chatCircuitState.failures} failures`
    );
  }

  return !chatCircuitState.isOpen;
}

// OPTIMIZED room state management with debouncing
let saveRoomsPending = false;
let lastSaveTimestamp = 0;
const SAVE_INTERVAL_MIN = 30000; // Min 30 seconds between full saves

async function saveRooms() {
  try {
    const now = Date.now();
    const timeSinceLastSave = now - lastSaveTimestamp;

    // Skip if last save was too recent
    if (timeSinceLastSave < SAVE_INTERVAL_MIN) {
      console.log(
        `Skipping room save (last save was ${timeSinceLastSave}ms ago)`
      );
      return;
    }

    const roomsData = JSON.stringify(Array.from(rooms.entries()));
    const tempFilePath = path.join(__dirname, "rooms.json.tmp");
    const finalFilePath = path.join(__dirname, "rooms.json");

    await fs.writeFile(tempFilePath, roomsData, "utf8");
    await fs.rename(tempFilePath, finalFilePath);

    lastSaveTimestamp = now;
    console.log("Rooms saved successfully.");
  } catch (error) {
    console.error("Error saving rooms:", error);
    try {
      await fs.unlink(path.join(__dirname, "rooms.json.tmp"));
    } catch (cleanupError) {
      /* ignore */
    }
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
      console.error("Error in debounced room save:", err);
    } finally {
      saveRoomsPending = false;
    }
  }, 10000); // 10 second debounce
};

// Modified to NOT load rooms on server startup based on config flag
async function loadRooms() {
  if (!CONFIG.FEATURES.LOAD_ROOMS_ON_STARTUP) {
    console.log("Starting with empty rooms (room loading disabled)");
    rooms = new Map();
    return;
  }

  try {
    const roomsData = await fs.readFile(
      path.join(__dirname, "rooms.json"),
      "utf8"
    );
    const loadedRoomsArray = JSON.parse(roomsData);

    if (Array.isArray(loadedRoomsArray)) {
      rooms = new Map(
        loadedRoomsArray.map((item) => {
          if (item[1]) {
            if (item[1].bannedUserIds) {
              if (item[1].bannedUserIds instanceof Set) {
                // Already a Set
              } else if (Array.isArray(item[1].bannedUserIds)) {
                item[1].bannedUserIds = new Set(item[1].bannedUserIds);
              } else if (typeof item[1].bannedUserIds === "object") {
                item[1].bannedUserIds = new Set(
                  Object.values(item[1].bannedUserIds)
                );
              } else {
                item[1].bannedUserIds = new Set();
              }
            } else {
              item[1].bannedUserIds = new Set();
            }
          }
          return item;
        })
      );
      console.log(`Loaded ${rooms.size} rooms from disk.`);
    } else {
      console.warn(
        "rooms.json was not in the expected format. Starting with empty rooms."
      );
      rooms = new Map();
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      console.log("rooms.json not found. Starting with empty rooms map.");
      rooms = new Map();
    } else {
      console.error(
        "Error loading rooms:",
        error,
        ". Starting with empty rooms map."
      );
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

// OPTIMIZED update functions
function updateLobby() {
  try {
    // Only include necessary room data for lobby updates
    const publicRooms = Array.from(rooms.values())
      .filter((room) => room.type !== "private")
      .map((room) => ({
        id: room.id,
        name: room.name,
        type: room.type,
        isFull: room.users.length >= CONFIG.LIMITS.MAX_ROOM_CAPACITY,
        userCount: room.users.length,
        users: Array.isArray(room.users)
          ? room.users.map((u) => ({
              id: u.id,
              username: u.username,
              location: u.location,
            }))
          : [],
      }));

    io.to("lobby").emit("lobby update", publicRooms);
  } catch (err) {
    console.error("Error in updateLobby:", err);
  }
}

function updateRoom(roomId) {
  try {
    const room = rooms.get(roomId);
    if (room) {
      io.to(roomId).emit("room update", {
        id: room.id,
        name: room.name,
        type: room.type,
        layout: room.layout,
        users: Array.isArray(room.users) ? room.users : [],
        votes: room.votes || {},
      });
    }
  } catch (err) {
    console.error(`Error in updateRoom for ${roomId}:`, err);
  }
}

function getCurrentMessages(usersInRoom) {
  const messages = {};
  if (Array.isArray(usersInRoom)) {
    usersInRoom.forEach((user) => {
      messages[user.id] = userMessageBuffers.get(user.id) || "";
    });
  }
  return messages;
}

const promisifySessionSave = (sessionInstance) => {
  if (!sessionInstance || typeof sessionInstance.save !== "function") {
    return Promise.resolve();
  }
  return util.promisify(sessionInstance.save).bind(sessionInstance)();
};

// OPTIMIZED leaveRoom function
async function leaveRoom(socket, userId) {
  try {
    const currentRoomId = socket.roomId;
    if (!currentRoomId) return;

    // Clear AFK timers for this user
    clearAFKTimers(userId);

    const room = rooms.get(currentRoomId);
    if (room) {
      // Remove user from room
      room.users = room.users.filter((user) => user.id !== userId);
      room.lastActiveTime = Date.now();

      // Clean up votes
      if (room.votes) {
        delete room.votes[userId];
        // Remove votes for this user
        for (let voterId in room.votes) {
          if (room.votes[voterId] === userId) delete room.votes[voterId];
        }
        io.to(currentRoomId).emit("update votes", room.votes);
      }

      // Leave room and notify
      socket.leave(currentRoomId);
      io.to(currentRoomId).emit("user left", userId);

      // Update room and potentially start deletion timer
      updateRoom(currentRoomId);
      if (room.users.length === 0) {
        await startRoomDeletionTimer(currentRoomId);
      }
    }

    // Clean up session
    if (socket.handshake.session) {
      if (
        socket.handshake.session.validatedRooms &&
        socket.handshake.session.validatedRooms[currentRoomId]
      ) {
        delete socket.handshake.session.validatedRooms[currentRoomId];
      }

      socket.handshake.session.currentRoom = null;
      await promisifySessionSave(socket.handshake.session).catch((err) =>
        console.error("Session save failed in leaveRoom:", err)
      );
    }

    // Remove user message buffer
    userMessageBuffers.delete(userId);

    // Reset socket state
    socket.roomId = null;
    socket.join("lobby");

    // Update lobby and save rooms
    updateLobby();
    await debouncedSaveRooms();
  } catch (err) {
    console.error("Error in leaveRoom:", err);
    if (socket && typeof socket.emit === "function") {
      socket.emit(
        "error",
        createErrorResponse(
          ERROR_CODES.SERVER_ERROR,
          "Error processing leave room."
        )
      );
    }
  }
}

// OPTIMIZED joinRoom function
function joinRoom(socket, roomId, userId) {
  try {
    if (!roomId || typeof roomId !== "string" || roomId.length !== 6) {
      socket.emit(
        "error",
        createErrorResponse(
          ERROR_CODES.NOT_FOUND,
          "Room not found (invalid ID format)."
        )
      );
      return;
    }

    const room = rooms.get(roomId);
    if (!room) {
      socket.emit(
        "error",
        createErrorResponse(ERROR_CODES.NOT_FOUND, "Room not found.")
      );
      return;
    }

    if (room.bannedUserIds && room.bannedUserIds.has(userId)) {
      socket.emit(
        "error",
        createErrorResponse(
          ERROR_CODES.FORBIDDEN,
          "You have been banned from rejoining this room."
        )
      );
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

    // Quick check if this is an anonymous user
    const isAnonymous = username === "Anonymous" && location === "On The Web";

    if (!isAnonymous) {
      // Check user room limits
      const userRoomsCount = getUserRoomsCount(userId);
      if (userRoomsCount >= 2) {
        socket.emit(
          "error",
          createErrorResponse(
            ERROR_CODES.FORBIDDEN,
            "You are already in the maximum number of rooms."
          )
        );
        return;
      }

      // Check username/location room limits
      const sameNameLocCount = getUsernameLocationRoomsCount(
        username,
        location
      );
      if (sameNameLocCount >= 2) {
        socket.emit(
          "error",
          createErrorResponse(
            ERROR_CODES.FORBIDDEN,
            "This username/location is already in the maximum number of rooms."
          )
        );
        return;
      }
    }

    // Initialize room properties if needed
    if (!room.users) room.users = [];
    if (!room.votes) room.votes = {};

    // Check room capacity
    if (room.users.length >= CONFIG.LIMITS.MAX_ROOM_CAPACITY) {
      socket.emit(
        "room full",
        createErrorResponse(ERROR_CODES.ROOM_FULL, "This room is full.")
      );
      return;
    }

    // Clear existing AFK timers if user is joining from another room
    clearAFKTimers(userId);

    // Remove user from room if already there
    room.users = room.users.filter((user) => user.id !== userId);

    // Add user to room
    socket.join(roomId);
    room.users.push({ id: userId, username, location });
    room.lastActiveTime = Date.now();
    socket.roomId = roomId;

    // Set up AFK timer for the user in this room
    setupAFKTimers(socket, userId);

    // Update session
    if (socket.handshake.session) {
      socket.handshake.session.currentRoom = roomId;
      socket.handshake.session.save((err) => {
        if (err) {
          console.error("Session save error in joinRoom:", err);
          socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.SERVER_ERROR,
              "Failed to save session on joining room."
            )
          );
          return;
        }
        emitJoinRoomSuccess(socket, room, userId, username, location);
      });
    } else {
      console.warn(`No session found for socket ${socket.id} during joinRoom.`);
      emitJoinRoomSuccess(socket, room, userId, username, location);
    }

    // Save room state
    debouncedSaveRooms().catch((err) =>
      console.error("Failed to save rooms after join:", err)
    );
  } catch (err) {
    console.error("Critical error in joinRoom logic:", err);
    socket.emit(
      "error",
      createErrorResponse(
        ERROR_CODES.SERVER_ERROR,
        "An unexpected error occurred while joining the room."
      )
    );
  }
}

function emitJoinRoomSuccess(socket, room, userId, username, location) {
  io.to(room.id).emit("user joined", {
    id: userId,
    username,
    location,
    roomName: room.name,
    roomType: room.type,
  });

  updateRoom(room.id);
  updateLobby();

  const currentMessages = getCurrentMessages(room.users);
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
    currentMessages,
  });

  socket.leave("lobby");

  if (roomDeletionTimers.has(room.id)) {
    clearTimeout(roomDeletionTimers.get(room.id));
    roomDeletionTimers.delete(room.id);
  }
}

// OPTIMIZED typing handler
function handleTyping(socket, userId, username, isTyping) {
  try {
    if (!socket.roomId) return;

    // Reset AFK timers when user is typing
    setupAFKTimers(socket, userId);

    if (typingTimeouts.has(userId)) {
      clearTimeout(typingTimeouts.get(userId));
    }

    if (isTyping) {
      socket
        .to(socket.roomId)
        .emit("user typing", { userId, username, isTyping: true });

      typingTimeouts.set(
        userId,
        setTimeout(() => {
          socket
            .to(socket.roomId)
            .emit("user typing", { userId, username, isTyping: false });
          typingTimeouts.delete(userId);
        }, CONFIG.TIMING.TYPING_TIMEOUT)
      );
    } else {
      socket
        .to(socket.roomId)
        .emit("user typing", { userId, username, isTyping: false });
      typingTimeouts.delete(userId);
    }
  } catch (err) {
    console.error("Error in handleTyping:", err);
  }
}

// Initialize
loadRooms().catch((err) => {
  console.error("Failed to load rooms on startup:", err);
});

// API Endpoints - OPTIMIZED with caching
const apiCache = new Map();
const API_CACHE_TTL = 10000; // 10 seconds

app.get(`/api/${CONFIG.VERSIONS.API}/config`, (req, res) => {
  const cacheKey = "config";

  if (apiCache.has(cacheKey)) {
    const cached = apiCache.get(cacheKey);
    if (Date.now() - cached.timestamp < API_CACHE_TTL) {
      return res.json(cached.data);
    }
  }

  const configData = {
    limits: CONFIG.LIMITS,
    features: CONFIG.FEATURES,
    versions: CONFIG.VERSIONS,
  };

  apiCache.set(cacheKey, {
    timestamp: Date.now(),
    data: configData,
  });

  res.json(configData);
});

app.get(`/api/${CONFIG.VERSIONS.API}/health`, (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: Date.now(),
    version: CONFIG.VERSIONS.SERVER,
  });
});

app.get(`/api/${CONFIG.VERSIONS.API}/me`, (req, res) => {
  const { username, location, userId } = req.session;
  if (username && location && userId) {
    res.json({ isSignedIn: true, username, location, userId });
  } else {
    res.json({ isSignedIn: false });
  }
});

// Caching for static JSON resources
const emojiListCache = {
  data: null,
  timestamp: 0,
};

app.get("/js/emojiList.json", async (req, res) => {
  try {
    // Check cache
    if (
      emojiListCache.data &&
      Date.now() - emojiListCache.timestamp < 3600000
    ) {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.send(emojiListCache.data);
    }

    const emojiListPath = path.join(
      __dirname,
      "public",
      "js",
      "emojiList.json"
    );
    const data = await fs.readFile(emojiListPath, "utf8");

    // Update cache
    emojiListCache.data = data;
    emojiListCache.timestamp = Date.now();

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(data);
  } catch (error) {
    console.error("Error serving emoji list:", error);
    res.status(404).json({ error: "Emoji list not found" });
  }
});

// API Auth middleware
function apiAuth(req, res, next) {
  const apiKey = req.header("x-api-key");
  const validApiKey =
    process.env.TALKOMATIC_API_KEY ||
    "tK_public_key_4f8a9b2c7d6e3f1a5g8h9i0j4k5l6m7n8o9p";

  if (!apiKey || apiKey !== validApiKey) {
    return sendErrorResponse(
      res,
      ERROR_CODES.UNAUTHORIZED,
      "Forbidden: invalid or missing x-api-key.",
      403
    );
  }

  next();
}

// OPTIMIZED API endpoints with caching
app.get(`/api/${CONFIG.VERSIONS.API}/rooms`, apiAuth, (req, res) => {
  try {
    const cacheKey = "public_rooms";

    if (apiCache.has(cacheKey)) {
      const cached = apiCache.get(cacheKey);
      if (Date.now() - cached.timestamp < API_CACHE_TTL) {
        return res.json(cached.data);
      }
    }

    const publicRooms = Array.from(rooms.values())
      .filter((room) => room.type !== "private")
      .map((room) => ({
        id: room.id,
        name: room.name,
        type: room.type,
        users: Array.isArray(room.users)
          ? room.users.map((u) => ({
              id: u.id,
              username: u.username,
              location: u.location,
            }))
          : [],
        isFull:
          (Array.isArray(room.users) ? room.users.length : 0) >=
          CONFIG.LIMITS.MAX_ROOM_CAPACITY,
      }));

    apiCache.set(cacheKey, {
      timestamp: Date.now(),
      data: publicRooms,
    });

    return res.json(publicRooms);
  } catch (err) {
    console.error("Error in GET /api/v1/rooms:", err);
    return sendErrorResponse(
      res,
      ERROR_CODES.SERVER_ERROR,
      "Internal server error",
      500
    );
  }
});

app.get(`/api/${CONFIG.VERSIONS.API}/rooms/:id`, apiAuth, (req, res) => {
  try {
    const roomId = req.params.id;
    const cacheKey = `room_${roomId}`;

    if (apiCache.has(cacheKey)) {
      const cached = apiCache.get(cacheKey);
      if (Date.now() - cached.timestamp < API_CACHE_TTL) {
        return res.json(cached.data);
      }
    }

    const room = rooms.get(roomId);
    if (!room)
      return sendErrorResponse(
        res,
        ERROR_CODES.NOT_FOUND,
        "Room not found",
        404
      );

    const roomData = {
      id: room.id,
      name: room.name,
      type: room.type,
      users: Array.isArray(room.users)
        ? room.users.map((u) => ({
            id: u.id,
            username: u.username,
            location: u.location,
          }))
        : [],
      isFull:
        (Array.isArray(room.users) ? room.users.length : 0) >=
        CONFIG.LIMITS.MAX_ROOM_CAPACITY,
    };

    apiCache.set(cacheKey, {
      timestamp: Date.now(),
      data: roomData,
    });

    return res.json(roomData);
  } catch (err) {
    console.error(`Error in GET /api/v1/rooms/${req.params.id}:`, err);
    return sendErrorResponse(
      res,
      ERROR_CODES.SERVER_ERROR,
      "Internal server error",
      500
    );
  }
});

app.post(`/api/${CONFIG.VERSIONS.API}/rooms`, apiAuth, async (req, res) => {
  try {
    const data = req.body;
    const validationErrors = validateObject(data, {
      name: { rule: "roomName" },
      type: { rule: "roomType" },
      layout: { rule: "layout" },
      accessCode: { rule: "accessCode", context: data.type },
    });

    if (validationErrors) {
      return sendErrorResponse(
        res,
        ERROR_CODES.VALIDATION_ERROR,
        "Validation failed",
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
          "Room name contains forbidden words.",
          400
        );
      }
    }

    let roomId;
    let attempts = 0;
    do {
      roomId = generateRoomIdInternal();
      attempts++;
      if (attempts > CONFIG.LIMITS.MAX_ID_GEN_ATTEMPTS && rooms.has(roomId)) {
        console.error("API: Failed to generate unique room ID.");
        return sendErrorResponse(
          res,
          ERROR_CODES.SERVER_ERROR,
          "Could not create room, server busy. Try again.",
          500
        );
      }
    } while (rooms.has(roomId));

    const newRoom = {
      id: roomId,
      name: roomName,
      type: data.type,
      layout: data.layout,
      users: [],
      accessCode: data.type === "semi-private" ? data.accessCode : null,
      votes: {},
      bannedUserIds: new Set(),
      lastActiveTime: Date.now(),
    };

    rooms.set(roomId, newRoom);

    if (req.session && data.type === "semi-private" && data.accessCode) {
      if (!req.session.validatedRooms) req.session.validatedRooms = {};
      req.session.validatedRooms[roomId] = data.accessCode;
      await promisifySessionSave(req.session).catch((err) =>
        console.error("API session save error:", err)
      );
    }

    // Invalidate room cache
    apiCache.delete("public_rooms");

    updateLobby();
    await debouncedSaveRooms();

    return res.status(201).json({ success: true, roomId });
  } catch (err) {
    console.error("Error in POST /api/v1/rooms:", err);
    return sendErrorResponse(
      res,
      ERROR_CODES.SERVER_ERROR,
      "Internal server error",
      500
    );
  }
});

app.post(
  `/api/${CONFIG.VERSIONS.API}/rooms/:id/join`,
  apiAuth,
  async (req, res) => {
    try {
      const roomId = req.params.id;
      const room = rooms.get(roomId);

      if (!room)
        return sendErrorResponse(
          res,
          ERROR_CODES.NOT_FOUND,
          "Room not found",
          404
        );

      if (room.users.length >= CONFIG.LIMITS.MAX_ROOM_CAPACITY) {
        return sendErrorResponse(
          res,
          ERROR_CODES.ROOM_FULL,
          "Room is full",
          400
        );
      }

      if (room.type === "semi-private") {
        const validatedAccessCode =
          req.session &&
          req.session.validatedRooms &&
          req.session.validatedRooms[roomId];

        if (!validatedAccessCode) {
          if (!req.body.accessCode)
            return sendErrorResponse(
              res,
              ERROR_CODES.FORBIDDEN,
              "Access code required",
              403
            );

          if (
            typeof req.body.accessCode !== "string" ||
            req.body.accessCode.length !== 6 ||
            !/^\d+$/.test(req.body.accessCode)
          ) {
            return sendErrorResponse(
              res,
              ERROR_CODES.VALIDATION_ERROR,
              "Invalid access code format",
              400
            );
          }

          if (room.accessCode !== req.body.accessCode) {
            return sendErrorResponse(
              res,
              ERROR_CODES.FORBIDDEN,
              "Incorrect access code",
              403
            );
          }

          if (req.session) {
            if (!req.session.validatedRooms) req.session.validatedRooms = {};
            req.session.validatedRooms[roomId] = req.body.accessCode;
            await promisifySessionSave(req.session).catch((err) =>
              console.error("API join session save error:", err)
            );
          }
        }
      }

      return res.json({
        success: true,
        message: "Access granted. Connect via Socket.IO to join.",
      });
    } catch (err) {
      console.error(`Error in POST /api/v1/rooms/${req.params.id}/join:`, err);
      return sendErrorResponse(
        res,
        ERROR_CODES.SERVER_ERROR,
        "Internal server error",
        500
      );
    }
  }
);

// Socket.IO Event Handlers - OPTIMIZED
io.on("connection", (socket) => {
  const clientIp = socket.clientIp || socket.handshake.address;

  // Helper to wrap all socket handlers for safety
  function safe(fn) {
    return async (...args) => {
      try {
        await fn(...args);
      } catch (err) {
        console.error(
          `Socket handler error in ${
            fn.name || "unnamed handler"
          } from ${clientIp}:`,
          err
        );

        try {
          socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.SERVER_ERROR,
              "Internal server error processing your request."
            )
          );

          // Only track serious errors to avoid unnecessary disconnections
          if (
            err.stack &&
            !(err instanceof TypeError || err instanceof ReferenceError)
          ) {
            socket._errorCount = (socket._errorCount || 0) + 1;

            // Only disconnect on repeated serious errors
            if (socket._errorCount > 10) {
              console.warn(
                `Disconnecting socket ${socket.id} after multiple errors`
              );
              socket.disconnect(true);
            }
          }
        } catch (emitErr) {
          console.error("Failed to send error to client:", emitErr);
        }
      }
    };
  }

  // Handle user activity to reset AFK timers
  socket.onAny(() => {
    try {
      if (
        socket.roomId &&
        socket.handshake.session &&
        socket.handshake.session.userId
      ) {
        // Reset AFK timers when user is active
        setupAFKTimers(socket, socket.handshake.session.userId);
      }
    } catch (err) {
      console.error("Error in socket.onAny AFK reset:", err);
    }
  });

  socket.on(
    "check signin status",
    safe(async () => {
      const { username, location, userId } = socket.handshake.session || {};
      if (username && location && userId) {
        socket.emit("signin status", {
          isSignedIn: true,
          username,
          location,
          userId,
        });
        socket.join("lobby");
        users.set(userId, { id: userId, username, location });
        updateLobby();
      } else {
        socket.emit("signin status", { isSignedIn: false });
      }
    })
  );

  socket.on(
    "join lobby",
    safe(async (data) => {
      if (!data || typeof data !== "object") {
        socket.emit(
          "error",
          createErrorResponse(
            ERROR_CODES.BAD_REQUEST,
            "Invalid data for joining lobby."
          )
        );
        return;
      }

      const validationErrors = validateObject(data, {
        username: { rule: "username" },
        location: { rule: "location" },
      });

      if (validationErrors) {
        socket.emit("validation_error", validationErrors);
        return;
      }

      let username = enforceUsernameLimit(data.username);
      let location = enforceLocationLimit(data.location || "On The Web");

      if (CONFIG.FEATURES.ENABLE_WORD_FILTER) {
        if (wordFilter.checkText(username).hasOffensiveWord) {
          socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.VALIDATION_ERROR,
              "Username contains forbidden words."
            )
          );
          return;
        }
        if (wordFilter.checkText(location).hasOffensiveWord) {
          socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.VALIDATION_ERROR,
              "Location contains forbidden words."
            )
          );
          return;
        }
      }

      const userId = socket.handshake.sessionID;
      if (!socket.handshake.session) {
        socket.emit(
          "error",
          createErrorResponse(
            ERROR_CODES.SERVER_ERROR,
            "Session not available."
          )
        );
        return;
      }

      socket.handshake.session.username = username;
      socket.handshake.session.location = location;
      socket.handshake.session.userId = userId;

      await promisifySessionSave(socket.handshake.session).catch((err) => {
        console.error("Session save error in join lobby:", err);
        socket.emit(
          "error",
          createErrorResponse(
            ERROR_CODES.SERVER_ERROR,
            "Failed to save session."
          )
        );
        throw err; // This will be caught by the outer safe wrapper
      });

      users.set(userId, { id: userId, username, location });
      socket.join("lobby");
      updateLobby();

      socket.emit("signin status", {
        isSignedIn: true,
        username,
        location,
        userId,
      });
    })
  );

  socket.on(
    "create room",
    safe(async (data) => {
      if (!data || typeof data !== "object") {
        socket.emit(
          "error",
          createErrorResponse(
            ERROR_CODES.BAD_REQUEST,
            "Invalid data for creating room."
          )
        );
        return;
      }

      const userId = socket.handshake.session
        ? socket.handshake.session.userId
        : null;

      if (!userId) {
        socket.emit(
          "error",
          createErrorResponse(
            ERROR_CODES.UNAUTHORIZED,
            "You must be signed in to create a room."
          )
        );
        return;
      }

      const validationErrors = validateObject(data, {
        name: { rule: "roomName" },
        type: { rule: "roomType" },
        layout: { rule: "layout" },
        accessCode: { rule: "accessCode", context: data.type },
      });

      if (validationErrors) {
        socket.emit("validation_error", validationErrors);
        return;
      }

      const { username, location } = socket.handshake.session;
      const isAnonymous =
        normalize(username) === "anonymous" &&
        normalize(location) === "on the web";

      if (isAnonymous) {
        socket.emit(
          "error",
          createErrorResponse(
            ERROR_CODES.FORBIDDEN,
            "Anonymous users cannot create rooms."
          )
        );
        return;
      }

      // Quick check for maximum rooms
      if (getUsernameLocationRoomsCount(username, location) >= 2) {
        socket.emit(
          "error",
          createErrorResponse(
            ERROR_CODES.FORBIDDEN,
            "This username/location is already in the maximum number of rooms."
          )
        );
        return;
      }

      if (getUserRoomsCount(userId) >= 2) {
        socket.emit(
          "error",
          createErrorResponse(
            ERROR_CODES.FORBIDDEN,
            "You are already in the maximum number of rooms."
          )
        );
        return;
      }

      // Check for room creation cooldown
      const now = Date.now();
      if (
        now - (lastRoomCreationTimes.get(userId) || 0) <
        CONFIG.TIMING.ROOM_CREATION_COOLDOWN
      ) {
        socket.emit(
          "error",
          createErrorResponse(
            ERROR_CODES.RATE_LIMITED,
            "Creating rooms too frequently."
          )
        );
        return;
      }

      let roomName = enforceRoomNameLimit(data.name);
      if (
        CONFIG.FEATURES.ENABLE_WORD_FILTER &&
        wordFilter.checkText(roomName).hasOffensiveWord
      ) {
        socket.emit(
          "error",
          createErrorResponse(
            ERROR_CODES.VALIDATION_ERROR,
            "Room name contains forbidden words."
          )
        );
        return;
      }

      lastRoomCreationTimes.set(userId, now);

      // Generate room ID
      let roomId;
      let attempts = 0;
      do {
        roomId = generateRoomIdInternal();
        attempts++;
        if (attempts > CONFIG.LIMITS.MAX_ID_GEN_ATTEMPTS && rooms.has(roomId)) {
          console.error("Socket: Failed to generate unique room ID.");
          socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.SERVER_ERROR,
              "Could not generate unique room ID. Try again."
            )
          );
          return;
        }
      } while (rooms.has(roomId));

      // Create new room
      const newRoom = {
        id: roomId,
        name: roomName,
        type: data.type,
        layout: data.layout,
        users: [],
        accessCode: data.type === "semi-private" ? data.accessCode : null,
        votes: {},
        bannedUserIds: new Set(),
        lastActiveTime: now,
      };

      rooms.set(roomId, newRoom);

      // Save access code in session if needed
      if (data.type === "semi-private" && data.accessCode) {
        if (!socket.handshake.session.validatedRooms)
          socket.handshake.session.validatedRooms = {};
        socket.handshake.session.validatedRooms[roomId] = data.accessCode;

        await promisifySessionSave(socket.handshake.session).catch((err) => {
          console.error("Session save error (create room):", err);
        });
      }

      // Invalidate room cache
      apiCache.delete("public_rooms");

      socket.emit("room created", roomId);
      updateLobby();
      await debouncedSaveRooms();
    })
  );

  socket.on(
    "join room",
    safe(async (data) => {
      if (!data || typeof data !== "object" || !data.roomId) {
        socket.emit(
          "error",
          createErrorResponse(
            ERROR_CODES.BAD_REQUEST,
            "Invalid data for joining room."
          )
        );
        return;
      }

      const room = rooms.get(data.roomId);
      if (!room) {
        socket.emit(
          "room not found",
          createErrorResponse(ERROR_CODES.NOT_FOUND, "Room not found.")
        );
        return;
      }

      // Check access code for semi-private rooms
      if (room.type === "semi-private") {
        const validatedAccessCode =
          socket.handshake.session.validatedRooms &&
          socket.handshake.session.validatedRooms[data.roomId];

        let codeToUse = data.accessCode;
        if (validatedAccessCode) {
          codeToUse = validatedAccessCode;
        } else if (!codeToUse) {
          socket.emit("access code required");
          return;
        }

        if (
          typeof codeToUse !== "string" ||
          codeToUse.length !== 6 ||
          !/^\d+$/.test(codeToUse)
        ) {
          socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.VALIDATION_ERROR,
              "Invalid access code format."
            )
          );
          return;
        }

        if (room.accessCode !== codeToUse) {
          socket.emit(
            "error",
            createErrorResponse(ERROR_CODES.FORBIDDEN, "Incorrect access code.")
          );
          return;
        }

        if (!validatedAccessCode && socket.handshake.session) {
          if (!socket.handshake.session.validatedRooms)
            socket.handshake.session.validatedRooms = {};
          socket.handshake.session.validatedRooms[data.roomId] = codeToUse;

          await promisifySessionSave(socket.handshake.session).catch((err) => {
            console.error("Session save error (join room access code):", err);
          });
        }
      }

      // Get user info from session
      let { username, location, userId } = socket.handshake.session || {};
      if (!userId) {
        userId = socket.handshake.sessionID;
        if (socket.handshake.session) {
          socket.handshake.session.userId = userId;
          if (!username) socket.handshake.session.username = "Anonymous";
          if (!location) socket.handshake.session.location = "On The Web";
        } else {
          console.error(
            "No session available for socket " + socket.id + " during join room"
          );
          socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.SERVER_ERROR,
              "Session error, cannot join room."
            )
          );
          return;
        }
      }

      username = username || "Anonymous";
      location = location || "On The Web";

      joinRoom(socket, data.roomId, userId);
    })
  );

  socket.on(
    "vote",
    safe(async (data) => {
      if (!data || typeof data !== "object" || !data.targetUserId) {
        socket.emit(
          "error",
          createErrorResponse(ERROR_CODES.BAD_REQUEST, "Invalid vote data.")
        );
        return;
      }

      const { targetUserId } = data;
      const userId = socket.handshake.session.userId;
      const roomId = socket.roomId;

      if (!roomId || !userId) return;

      const room = rooms.get(roomId);
      if (!room || !room.users.find((u) => u.id === userId)) return;
      if (userId === targetUserId) return;

      if (!room.votes) room.votes = {};

      // Toggle vote
      if (room.votes[userId] === targetUserId) {
        delete room.votes[userId];
      } else {
        room.votes[userId] = targetUserId;
      }

      io.to(roomId).emit("update votes", room.votes);

      // Check if user should be kicked
      const votesAgainstTarget = Object.values(room.votes).filter(
        (v) => v === targetUserId
      ).length;

      const totalUsers = room.users.length;
      if (totalUsers >= 3 && votesAgainstTarget > Math.floor(totalUsers / 2)) {
        const targetSocket = [...io.sockets.sockets.values()].find(
          (s) =>
            s.handshake.session.userId === targetUserId && s.roomId === roomId
        );

        if (targetSocket) {
          targetSocket.emit("kicked");
          if (!room.bannedUserIds) room.bannedUserIds = new Set();
          room.bannedUserIds.add(targetUserId);
          await leaveRoom(targetSocket, targetUserId);
        }
      }
    })
  );

  socket.on(
    "leave room",
    safe(async () => {
      const userId = socket.handshake.session
        ? socket.handshake.session.userId
        : null;

      if (userId) {
        clearAFKTimers(userId);
        await leaveRoom(socket, userId);
      }
    })
  );

  // OPTIMIZED chat update event handler with batching
  socket.on(
    "chat update",
    safe(async (data) => {
      // Circuit breaker check
      if (!checkChatCircuit()) {
        socket.emit(
          "error",
          createErrorResponse(
            ERROR_CODES.CIRCUIT_OPEN,
            "System is temporarily unavailable. Please try again later."
          )
        );
        return;
      }

      if (
        !socket.roomId ||
        !socket.handshake.session ||
        !socket.handshake.session.userId
      )
        return;

      const userId = socket.handshake.session.userId;

      if (
        !data ||
        typeof data !== "object" ||
        !data.diff ||
        typeof data.diff !== "object"
      ) {
        socket.emit(
          "error",
          createErrorResponse(
            ERROR_CODES.BAD_REQUEST,
            "Invalid chat update data format."
          )
        );
        return;
      }

      let { diff } = data;

      // Basic diff type validation
      if (!["full-replace", "add", "delete", "replace"].includes(diff.type)) {
        socket.emit(
          "error",
          createErrorResponse(ERROR_CODES.BAD_REQUEST, "Unknown diff type.")
        );
        return;
      }

      // Text validation for types that include text
      if (
        (diff.type === "add" ||
          diff.type === "replace" ||
          diff.type === "full-replace") &&
        typeof diff.text !== "string"
      ) {
        socket.emit(
          "error",
          createErrorResponse(
            ERROR_CODES.BAD_REQUEST,
            "Diff text must be a string."
          )
        );
        return;
      }

      // Apply character limit
      if (diff.text) diff.text = enforceCharacterLimit(diff.text);

      // Validate index for non-full-replace types
      if (
        diff.type !== "full-replace" &&
        (typeof diff.index !== "number" || diff.index < 0)
      ) {
        socket.emit(
          "error",
          createErrorResponse(ERROR_CODES.BAD_REQUEST, "Invalid diff index.")
        );
        return;
      }

      // Validate count for delete type
      if (
        diff.type === "delete" &&
        (typeof diff.count !== "number" || diff.count < 0)
      ) {
        socket.emit(
          "error",
          createErrorResponse(
            ERROR_CODES.BAD_REQUEST,
            "Invalid diff count for delete."
          )
        );
        return;
      }

      // Reset AFK timers since user is typing
      setupAFKTimers(socket, userId);

      // Add to pending updates
      if (!pendingChatUpdates.has(userId)) {
        pendingChatUpdates.set(userId, { diffs: [] });
      }

      pendingChatUpdates.get(userId).diffs.push(diff);

      // Schedule processing if not already scheduled
      if (!batchProcessingTimers.has(userId)) {
        batchProcessingTimers.set(
          userId,
          setTimeout(() => {
            processPendingChatUpdates(userId, socket);
          }, CONFIG.TIMING.BATCH_PROCESSING_INTERVAL)
        );
      }
    })
  );

  socket.on(
    "typing",
    safe(async (data) => {
      if (
        !socket.roomId ||
        !socket.handshake.session ||
        !socket.handshake.session.userId
      )
        return;

      const userId = socket.handshake.session.userId;
      const username = socket.handshake.session.username || "Anonymous";

      // Reset AFK timers since user is active
      setupAFKTimers(socket, userId);

      // Fast path for stopping typing
      if (data && data.isTyping === false) {
        handleTyping(socket, userId, username, false);
        return;
      }

      // Rate limit for starting typing
      await typingLimiter.consume(userId).catch(() => {
        return; // Silently fail on rate limiting for typing events
      });

      if (!data || typeof data.isTyping !== "boolean") return;

      handleTyping(socket, userId, username, data.isTyping);
    })
  );

  socket.on(
    "get rooms",
    safe(async () => {
      const cacheKey = "socket_rooms";
      let publicRooms;

      if (apiCache.has(cacheKey)) {
        const cached = apiCache.get(cacheKey);
        if (Date.now() - cached.timestamp < API_CACHE_TTL) {
          publicRooms = cached.data;
        }
      }

      if (!publicRooms) {
        publicRooms = Array.from(rooms.values())
          .filter((room) => room.type !== "private")
          .map((room) => ({
            id: room.id,
            name: room.name,
            type: room.type,
            isFull: room.users.length >= CONFIG.LIMITS.MAX_ROOM_CAPACITY,
            userCount: room.users.length,
            users: Array.isArray(room.users)
              ? room.users.map((u) => ({
                  id: u.id,
                  username: u.username,
                  location: u.location,
                }))
              : [],
          }));

        apiCache.set(cacheKey, {
          timestamp: Date.now(),
          data: publicRooms,
        });
      }

      socket.emit("initial rooms", publicRooms);
    })
  );

  socket.on(
    "get room state",
    safe(async (roomId) => {
      if (!roomId || typeof roomId !== "string") {
        socket.emit(
          "error",
          createErrorResponse(ERROR_CODES.BAD_REQUEST, "Room ID is required.")
        );
        return;
      }

      const room = rooms.get(roomId);
      if (!room) {
        socket.emit(
          "error",
          createErrorResponse(ERROR_CODES.NOT_FOUND, "Room not found.")
        );
        return;
      }

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
    })
  );

  socket.on(
    "disconnect",
    safe(async (reason) => {
      const userId = socket.handshake.session
        ? socket.handshake.session.userId
        : null;

      if (userId) {
        // Clean up all timers
        clearAFKTimers(userId);

        // Leave room if in one
        await leaveRoom(socket, userId);

        // Clean up user data
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

      // Update IP connection tracking
      if (socket.clientIp) {
        const currentCount = ipConnections.get(socket.clientIp) || 0;
        if (currentCount > 1)
          ipConnections.set(socket.clientIp, currentCount - 1);
        else ipConnections.delete(socket.clientIp);
      }

      console.log(
        `Socket ${socket.id} disconnected. Reason: ${reason}. IP: ${socket.clientIp}`
      );
    })
  );

  // Add handler for AFK acknowledgment from client
  socket.on(
    "afk response",
    safe(async (data) => {
      const userId = socket.handshake.session?.userId;
      if (!userId || !socket.roomId) return;

      // If user responded, reset their AFK timers
      setupAFKTimers(socket, userId);

      // Log the response for debugging
      console.log(`AFK response from user ${userId}: ${JSON.stringify(data)}`);
    })
  );
});

// OPTIMIZED periodic tasks with staggered intervals
// Periodic cleanup for empty rooms
setInterval(async () => {
  const now = Date.now();
  let roomsDeleted = 0;

  for (const [roomId, room] of rooms.entries()) {
    if (room.users.length === 0) {
      const timeSinceLastActive = now - (room.lastActiveTime || 0);
      if (
        timeSinceLastActive > CONFIG.TIMING.ROOM_DELETION_TIMEOUT &&
        !roomDeletionTimers.has(roomId)
      ) {
        console.log(
          `Periodic cleanup: Room ${roomId} is empty and inactive. Deleting.`
        );
        rooms.delete(roomId);
        roomsDeleted++;

        // Early exit if we've already cleaned up several rooms
        if (roomsDeleted >= 5) break;
      }
    }
  }

  if (roomsDeleted > 0) {
    updateLobby();
    apiCache.delete("public_rooms"); // Invalidate cache
    try {
      await debouncedSaveRooms();
    } catch (e) {
      console.error("Periodic cleanup saveRooms error:", e);
    }
  }
}, 60000); // Every minute

// Cleanup abandoned resources with staggered cleanup
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
    }
  }

  // Clean up typing timeouts
  for (const timeoutId of typingTimeouts.keys()) {
    if (!activeUserIds.has(timeoutId)) {
      clearTimeout(typingTimeouts.get(timeoutId));
      typingTimeouts.delete(timeoutId);
    }
  }

  // Clean up AFK timers for users no longer in rooms
  for (const userId of afkTimers.keys()) {
    if (!activeUserIds.has(userId)) {
      clearAFKTimers(userId);
    }
  }
}, 300000); // Every 5 minutes

// Clean up batch processing timers in a separate interval
setInterval(() => {
  const activeUserIds = new Set();
  for (const [, room] of rooms.entries()) {
    if (Array.isArray(room.users)) {
      for (const user of room.users) {
        activeUserIds.add(user.id);
      }
    }
  }

  // Clean up batch processing timers and pending updates
  for (const userId of batchProcessingTimers.keys()) {
    if (!activeUserIds.has(userId)) {
      clearTimeout(batchProcessingTimers.get(userId));
      batchProcessingTimers.delete(userId);
      pendingChatUpdates.delete(userId);
    }
  }

  // Clean up the normalize cache to prevent memory leaks
  if (normalizeCache.size > 1000) {
    const keysToDelete = Array.from(normalizeCache.keys()).slice(0, 200);
    keysToDelete.forEach((key) => normalizeCache.delete(key));
  }

  // Clean up API cache if it gets too large
  if (apiCache.size > 100) {
    const now = Date.now();
    for (const [key, entry] of apiCache.entries()) {
      if (now - entry.timestamp > API_CACHE_TTL) {
        apiCache.delete(key);
      }
    }
  }
}, 180000); // Every 3 minutes

// Server crash protection monitor - OPTIMIZED
setInterval(() => {
  try {
    const memoryUsage = process.memoryUsage();
    const heapUsedPercentage = Math.round(
      (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100
    );

    // Only log when usage is concerning
    if (heapUsedPercentage > 85) {
      console.warn(`MEMORY WARNING: Heap usage at ${heapUsedPercentage}%`);

      // Emergency cleanup of large message buffers
      if (heapUsedPercentage > 90) {
        console.warn(
          "EMERGENCY MEMORY CLEANUP: Clearing large message buffers"
        );

        for (const [userId, message] of userMessageBuffers.entries()) {
          if (message.length > 1000) {
            userMessageBuffers.set(
              userId,
              message.substring(0, 1000) +
                "... [truncated for system stability]"
            );
          }
        }

        // Purge caches
        normalizeCache.clear();
        apiCache.clear();

        // Force garbage collection if available (Node with --expose-gc flag)
        if (global.gc) {
          console.log("Forcing garbage collection");
          global.gc();
        }
      }
    }

    // Only log connected clients periodically
    const connectedClients = io.sockets.sockets.size;
    console.log(
      `Server status: ${connectedClients} connected clients, heap usage: ${heapUsedPercentage}%`
    );

    // Only check for excessive connections when needed
    if (connectedClients > 50) {
      for (const [ip, count] of ipConnections.entries()) {
        if (count > CONFIG.LIMITS.MAX_CONNECTIONS_PER_IP * 0.8) {
          console.warn(
            `IP warning: ${ip} has ${count} connections (max: ${CONFIG.LIMITS.MAX_CONNECTIONS_PER_IP})`
          );
        }
      }
    }
  } catch (err) {
    console.error("Error in server monitor:", err);
  }
}, 120000); // Every 2 minutes

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Talkomatic server is running on port ${PORT}`);
  console.log(`Server version: ${CONFIG.VERSIONS.SERVER}`);
  console.log(`Node.js version: ${process.version}`);
});
