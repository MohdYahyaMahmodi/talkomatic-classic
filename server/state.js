// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  FILE 1: server/state.js                                                ║
// ║  Shared config, constants, state, and utility functions                  ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

const path = require("path");
const fs = require("fs").promises;
const crypto = require("crypto");
const util = require("util");
const WordFilter = require("../public/js/word-filter.js");

// ── Config ──────────────────────────────────────────────────────────────────

const CONFIG = {
  LIMITS: {
    MAX_USERNAME_LENGTH: 15,
    MAX_AFK_TIME: 180000,
    MAX_LOCATION_LENGTH: 20,
    MAX_ROOM_NAME_LENGTH: 25,
    MAX_MESSAGE_LENGTH: 15000,
    MAX_ROOM_CAPACITY: 5,
    BASE_MAX_ROOMS: 15,
    ROOM_SCALING_INCREMENT: 5,
    MAX_CONNECTIONS_PER_IP: 8,
    SOCKET_MAX_REQUESTS_WINDOW: 1,
    SOCKET_MAX_REQUESTS_PER_WINDOW: 75,
    CHAT_UPDATE_RATE_LIMIT: 500,
    TYPING_RATE_LIMIT: 60,
    CONNECTION_DELAY: 100,
    MAX_ID_GEN_ATTEMPTS: 100,
    BATCH_SIZE_LIMIT: 50,
    MAX_ROOMS_PER_USER: 1,
    BOT_DETECTION_JOIN_THRESHOLD: 10,
    BOT_DETECTION_WINDOW: 60000,
    MAX_REQUESTS_PER_MINUTE: 100,
    MAX_BOT_REQUESTS_PER_MINUTE: 500,
    MAX_BOT_TOKENS_PER_IP: 3,
    BOT_TOKEN_REQUEST_COOLDOWN: 300000,
    IP_USER_CLEANUP_INTERVAL: 3600000,

    // ── Anti-Spam: Per-IP Room Limits ─────────────────────────────────
    MAX_ROOMS_PER_IP: 2,
    IP_ROOM_CREATION_COOLDOWN: 30000, // 30s between room creations per IP

    // ── Anti-Spam: Pressure System ────────────────────────────────────
    HARD_MAX_ROOMS: 50,

    PRESSURE_TIERS: [
      { threshold: 0, ttl: 20 * 60 * 1000 },
      { threshold: 15, ttl: 10 * 60 * 1000 },
      { threshold: 30, ttl: 3 * 60 * 1000 },
      { threshold: 40, ttl: 60 * 1000 },
    ],

    HEALTHY_ROOM_AGE_MS: 5 * 60 * 1000,
    PRESSURE_CLEANUP_INTERVAL: 30000,
  },
  FEATURES: {
    ENABLE_WORD_FILTER: true,
    LOAD_ROOMS_ON_STARTUP: false,
    ENABLE_BOT_PROTECTION: true,
    ENABLE_DYNAMIC_SCALING: true,
    ENABLE_STRICT_ANTIBOT: true,
    ENABLE_BOT_TOKENS: true,
    ENABLE_IP_BASED_USERS: false,
    REQUIRE_USER_AGENT: true,
  },
  TIMING: {
    ROOM_CREATION_COOLDOWN: 10000,
    ROOM_DELETION_TIMEOUT: 30000,
    TYPING_TIMEOUT: 2000,
    BATCH_PROCESSING_INTERVAL: 20,
    AFK_WARNING_TIME: 150000,
    BOT_BLOCK_DURATION: 300000,
    BOT_TOKEN_EXPIRY: 2592000000,
    BOT_TOKEN_CLEANUP_INTERVAL: 86400000,
  },
  VERSIONS: {
    API: "v1",
    SERVER: "2.0.0",
  },

  // ── DEV MODE ────────────────────────────────────────────────────────────
  // SHA-256 hash of the secret dev key. Set in .env as DEV_KEY_HASH.
  // Generate it:  echo -n "your_secret_key" | sha256sum
  // Or in Node:   crypto.createHash('sha256').update('your_secret_key').digest('hex')
  DEV: {
    KEY_HASH: process.env.DEV_KEY_HASH || "",
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
  ROOM_NAME_EXISTS: "ROOM_NAME_EXISTS",
  ROOM_LIMIT_REACHED: "ROOM_LIMIT_REACHED",
  BOT_TOKEN_REQUIRED: "BOT_TOKEN_REQUIRED",
  INVALID_BOT_TOKEN: "INVALID_BOT_TOKEN",
  TOKEN_NOT_ALLOWED_IN_BROWSER: "TOKEN_NOT_ALLOWED_IN_BROWSER",
  AUTOMATED_ACCESS_BLOCKED: "AUTOMATED_ACCESS_BLOCKED",
};

// ── Word Filter ─────────────────────────────────────────────────────────────

let wordFilter;
try {
  wordFilter = new WordFilter(
    path.join(__dirname, "..", "public", "js", "offensive_words.json"),
    path.join(__dirname, "..", "public", "js", "character_substitutions.json"),
  );
} catch (err) {
  console.error("Failed to initialize WordFilter:", err);
  wordFilter = {
    checkText: () => ({ hasOffensiveWord: false }),
    filterText: (text) => text,
  };
  CONFIG.FEATURES.ENABLE_WORD_FILTER = false;
}

// ── Shared Mutable State ────────────────────────────────────────────────────

const state = {
  // io reference (set by server.js after creation)
  io: null,

  // Room data
  rooms: new Map(),
  users: new Map(),
  roomDeletionTimers: new Map(),
  lastRoomCreationTimes: new Map(),

  // Chat / typing
  typingTimeouts: new Map(),
  userMessageBuffers: new Map(),
  pendingChatUpdates: new Map(),
  batchProcessingTimers: new Map(),

  // AFK
  afkTimers: new Map(),
  afkWarningTimers: new Map(),

  // Circuit breaker
  chatCircuitState: {
    failures: 0,
    lastFailure: 0,
    isOpen: false,
    threshold: 50,
    resetTimeout: 15000,
  },

  // Connection / security tracking
  ipConnections: new Map(),
  ipLastConnectionTime: new Map(),
  blockedIPs: new Map(),
  userJoinAttempts: new Map(),
  ipJoinAttempts: new Map(),
  suspiciousUsers: new Map(),
  botBlacklist: new Set(),

  // Bot tokens
  botTokens: new Map(),
  ipBotTokenCounts: new Map(),
  botTokenRequests: new Map(),
  ipBasedUsers: new Map(),

  // ── Anti-Spam: Per-IP room creation tracking ──────────────────────
  ipLastRoomCreation: new Map(),

  // ── Anti-Spam: Per-room solo timestamp ────────────────────────────
  roomSoloSince: new Map(),

  // ── Anti-Spam: Per-room last chat activity ────────────────────────
  roomLastChatActivity: new Map(),

  // ── DEV MODE: Track which userIds are devs ────────────────────────
  // Set by socket middleware when a valid devKey is provided.
  // Maps userId -> true. Used to include isDev in user broadcasts.
  devUsers: new Set(),

  // Caches
  normalizeCache: new Map(),
  apiCache: new Map(),
  API_CACHE_TTL: 10000,

  // Save state
  saveRoomsPending: false,
  lastSaveTimestamp: 0,
  SAVE_INTERVAL_MIN: 30000,
};

// ── Utility Functions ───────────────────────────────────────────────────────

function getClientIP(req) {
  const cfIP = req.headers["cf-connecting-ip"];
  if (cfIP) return cfIP;
  const realIP = req.headers["x-real-ip"];
  if (realIP) return realIP;
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress || req.connection?.remoteAddress;
}

function createErrorResponse(
  code,
  message,
  details = null,
  replaceDefaultText = false,
) {
  const response = { error: { code, message, replaceDefaultText } };
  if (details) response.error.details = details;
  return response;
}

function sendErrorResponse(res, code, message, status = 400, details = null) {
  return res.status(status).json(createErrorResponse(code, message, details));
}

function normalize(str) {
  if (!str) return "";
  if (state.normalizeCache.has(str)) return state.normalizeCache.get(str);
  const normalized = str.trim().toLowerCase();
  if (str.length <= 30) {
    state.normalizeCache.set(str, normalized);
    if (state.normalizeCache.size > 1000) {
      const keys = Array.from(state.normalizeCache.keys()).slice(0, 200);
      keys.forEach((k) => state.normalizeCache.delete(k));
    }
  }
  return normalized;
}

function enforceCharacterLimit(msg) {
  return typeof msg === "string"
    ? msg.slice(0, CONFIG.LIMITS.MAX_MESSAGE_LENGTH)
    : "";
}
function enforceUsernameLimit(val) {
  return typeof val === "string"
    ? val.slice(0, CONFIG.LIMITS.MAX_USERNAME_LENGTH)
    : "";
}
function enforceLocationLimit(val) {
  return typeof val === "string"
    ? val.slice(0, CONFIG.LIMITS.MAX_LOCATION_LENGTH)
    : "";
}
function enforceRoomNameLimit(val) {
  return typeof val === "string"
    ? val.slice(0, CONFIG.LIMITS.MAX_ROOM_NAME_LENGTH)
    : "";
}

function promisifySessionSave(session) {
  if (!session || typeof session.save !== "function") return Promise.resolve();
  return util.promisify(session.save).bind(session)();
}

// ── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  CONFIG,
  ERROR_CODES,
  wordFilter,
  state,
  getClientIP,
  createErrorResponse,
  sendErrorResponse,
  normalize,
  enforceCharacterLimit,
  enforceUsernameLimit,
  enforceLocationLimit,
  enforceRoomNameLimit,
  promisifySessionSave,
};
