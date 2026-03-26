// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  FILE 4: server.js (root - entry point)                                 ║
// ║  Express, Socket.IO, API routes, startup                                ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

require("dotenv").config();
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const fs = require("fs").promises;
const session = require("express-session");
const cookieParser = require("cookie-parser");
const sharedsession = require("express-socket.io-session");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const xss = require("xss-clean");
const hpp = require("hpp");
const crypto = require("crypto");

const {
  CONFIG,
  ERROR_CODES,
  state,
  getClientIP,
  createErrorResponse,
  sendErrorResponse,
  promisifySessionSave,
} = require("./server/state");
const {
  antibotMiddleware,
  enhancedRateLimit,
  handleBotTokenRequest,
  handleBotTokenInfo,
  apiAuth,
  detectBrowserRequest,
  validateBotToken,
  createIPBasedUser,
  socketRateLimiter,
  ipRateLimiter,
  enhancedRateLimiters,
  validateObject,
} = require("./server/security");
const rooms = require("./server/rooms");

// ── Global Error Handlers ───────────────────────────────────────────────────

process.on("unhandledRejection", (reason) => {
  console.error("=== UNHANDLED REJECTION ===", reason);
});
process.on("uncaughtException", (error) => {
  console.error("=== UNCAUGHT EXCEPTION ===", error.message, error.stack);
});

// ── Express & HTTP ──────────────────────────────────────────────────────────

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://classic.talkomatic.co",
];
const corsOptions = {
  origin: (origin, cb) =>
    !origin || allowedOrigins.includes(origin) || origin.endsWith("github.io")
      ? cb(null, true)
      : cb(new Error("CORS blocked"), false),
  methods: ["GET", "POST"],
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization", "x-api-key"],
};

// ── Middleware (order matters!) ──────────────────────────────────────────────

app.use(express.json({ limit: "100kb" }));
app.use(cors(corsOptions));
app.use(cookieParser());

app.use((req, res, next) => {
  res.locals.nonce = crypto.randomBytes(16).toString("base64");
  next();
});

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          (req, res) => `'nonce-${res.locals.nonce}'`,
          "https://cdnjs.cloudflare.com",
          "https://classic.talkomatic.co",
          "https://unpkg.com",
          "https://static.cloudflareinsights.com",
        ],
        scriptSrcElem: [
          "'self'",
          (req, res) => `'nonce-${res.locals.nonce}'`,
          "https://cdnjs.cloudflare.com",
          "https://classic.talkomatic.co",
          "https://unpkg.com",
          "https://static.cloudflareinsights.com",
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://cdnjs.cloudflare.com",
          "https://fonts.googleapis.com",
        ],
        styleSrcElem: [
          "'self'",
          "'unsafe-inline'",
          "https://cdnjs.cloudflare.com",
          "https://fonts.googleapis.com",
        ],
        imgSrc: ["'self'", "data:", "https:", "blob:"],
        fontSrc: [
          "'self'",
          "https://fonts.gstatic.com",
          "https://cdnjs.cloudflare.com",
          "https://classic.talkomatic.co",
        ],
        connectSrc: ["'self'", "https://classic.talkomatic.co"],
        mediaSrc: ["'self'", "data:"],
        frameAncestors: ["'self'", "*"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: false,
  }),
);

app.use(xss());
app.use(hpp());

// Rate limiter — skip static file requests so they don't eat the limit
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => getClientIP(req),
    skip: (req) => {
      const url = req.path || req.url;
      return (
        /\.(js|css|png|jpg|jpeg|gif|ico|svg|ttf|otf|woff|woff2|mp3|wav|ogg|json|map)$/i.test(
          url,
        ) || url.startsWith("/socket.io/")
      );
    },
    message: {
      error: { code: ERROR_CODES.RATE_LIMITED, message: "Too many requests." },
    },
  }),
);

// ── Session ─────────────────────────────────────────────────────────────────

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

function enhancedSessionMiddleware(req, res, next) {
  sessionMiddleware(req, res, () => {
    if (CONFIG.FEATURES.ENABLE_IP_BASED_USERS && !req.session.username) {
      const browser = detectBrowserRequest(req);
      if (browser.isBrowser) {
        const ipUser = createIPBasedUser(getClientIP(req));
        Object.assign(req.session, {
          username: ipUser.username,
          location: ipUser.location,
          userId: ipUser.userId,
          isIPBased: true,
        });
      }
    }
    next();
  });
}
app.use(enhancedSessionMiddleware);

// ── Socket.IO ───────────────────────────────────────────────────────────────

const io = socketIo(server, {
  cors: {
    origin: (origin, cb) =>
      !origin || allowedOrigins.includes(origin) || origin.endsWith("github.io")
        ? cb(null, true)
        : cb(new Error("Socket CORS"), false),
    methods: ["GET", "POST"],
    credentials: true,
  },
  proxy: true,
  pingTimeout: 60000,
  pingInterval: 25000,
  connectTimeout: 45000,
  maxHttpBufferSize: 2e6,
  transports: ["websocket", "polling"],
  perMessageDeflate: { threshold: 1024 },
  httpCompression: true,
});

// Store io reference in shared state
state.io = io;

io.use(sharedsession(sessionMiddleware, { autoSave: true }));

// Socket.IO security middleware
io.use((socket, next) => {
  try {
    const clientIp = getClientIP({
      headers: socket.handshake.headers,
      socket: { remoteAddress: socket.handshake.address },
    });
    const botToken =
      socket.handshake.auth.token || socket.handshake.query.token;
    const browser = detectBrowserRequest(socket.handshake);

    if (state.blockedIPs.has(clientIp)) {
      const block = state.blockedIPs.get(clientIp);
      if (Date.now() < block.expiry) return next(new Error("IP blocked"));
      state.blockedIPs.delete(clientIp);
    }

    // ── DEV MODE CHECK ──────────────────────────────────────────────
    // Check for devKey in auth. If valid, flag the socket as dev.
    // This runs before bot/browser checks so it works for both.
    const devKey = socket.handshake.auth.devKey;
    if (devKey && CONFIG.DEV.KEY_HASH) {
      const hash = crypto
        .createHash("sha256")
        .update(String(devKey))
        .digest("hex");

      if (hash === CONFIG.DEV.KEY_HASH) {
        socket.isDev = true;
        socket.isHidden = !!socket.handshake?.session?.isDevHidden;
        console.log(`[DEV] Dev mode activated for IP:${clientIp}`);
      }
    }
    // ── END DEV MODE CHECK ──────────────────────────────────────────

    if (CONFIG.FEATURES.ENABLE_STRICT_ANTIBOT && !browser.isBrowser) {
      if (CONFIG.FEATURES.ENABLE_BOT_TOKENS) {
        if (!botToken) return next(new Error("Bot token required"));
        const tokenData = validateBotToken(botToken);
        if (!tokenData) return next(new Error("Invalid bot token"));
        socket.isBot = true;
        socket.botToken = tokenData;
      } else return next(new Error("Automated access blocked"));
    } else if (botToken && browser.isBrowser)
      return next(new Error("Bot tokens not allowed in browsers"));

    ipRateLimiter
      .consume(clientIp)
      .then(() => {
        const count = state.ipConnections.get(clientIp) || 0;
        if (count >= CONFIG.LIMITS.MAX_CONNECTIONS_PER_IP)
          return next(new Error("Too many connections"));
        state.ipConnections.set(clientIp, count + 1);
        socket.clientIp = clientIp;
        socket.browserDetection = browser;

        socket.use((packet, nextMw) => {
          // DEV MODE: Dev users bypass all socket rate limits
          if (socket.isDev) return nextMw();

          const evt = packet[0];
          if (
            [
              "error",
              "connect",
              "disconnect",
              "disconnecting",
              "typing",
              "get rooms",
              "get room state",
            ].includes(evt)
          )
            return nextMw();
          const limiter = socket.isBot
            ? enhancedRateLimiters.botApi
            : socketRateLimiter;
          limiter
            .consume(socket.id)
            .then(() => nextMw())
            .catch(() => {
              socket.emit(
                "error",
                createErrorResponse(
                  ERROR_CODES.RATE_LIMITED,
                  "Rate limit exceeded.",
                ),
              );
            });
        });
        next();
      })
      .catch(() => next(new Error("IP rate limit exceeded")));
  } catch (err) {
    console.error("Socket middleware error:", err);
    next(new Error("Connection setup failed"));
  }
});

// ── Static Files (AFTER session so HTML pages get session cookies) ───────────

app.use(
  express.static(path.join(__dirname, "public"), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".js")) {
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=31536000");
      } else if (filePath.endsWith(".css"))
        res.setHeader("Cache-Control", "public, max-age=31536000");
      else if (filePath.match(/\.(jpg|jpeg|png|gif|ico|svg)$/))
        res.setHeader("Cache-Control", "public, max-age=31536000");
      if (filePath.endsWith(".ttf")) res.setHeader("Content-Type", "font/ttf");
    },
  }),
);

// ── API Routes ──────────────────────────────────────────────────────────────

const API = `/api/${CONFIG.VERSIONS.API}`;

app.post(`${API}/bot-tokens/request`, handleBotTokenRequest);
app.get(`${API}/bot-tokens/info`, handleBotTokenInfo);
app.use("/api", antibotMiddleware);
app.use("/api", enhancedRateLimit);

app.get(`${API}/config`, (req, res) => {
  const cached = state.apiCache.get("config");
  if (cached && Date.now() - cached.timestamp < state.API_CACHE_TTL)
    return res.json(cached.data);
  const data = {
    limits: CONFIG.LIMITS,
    features: CONFIG.FEATURES,
    versions: CONFIG.VERSIONS,
    roomStatistics: rooms.getRoomStatistics(),
  };
  state.apiCache.set("config", { timestamp: Date.now(), data });
  res.json(data);
});

app.get(`${API}/health`, (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: Date.now(),
    version: CONFIG.VERSIONS.SERVER,
    roomStatistics: rooms.getRoomStatistics(),
    botTokens: { active: state.botTokens.size },
  });
});

app.get(`${API}/me`, (req, res) => {
  const { username, location, userId, isIPBased } = req.session;
  if (username && location && userId)
    res.json({
      isSignedIn: true,
      username,
      location,
      userId,
      isIPBased: !!isIPBased,
      isBot: !!req.isBot,
    });
  else res.json({ isSignedIn: false, isBot: !!req.isBot });
});

const emojiCache = { data: null, ts: 0 };
app.get("/js/emojiList.json", async (req, res) => {
  try {
    if (emojiCache.data && Date.now() - emojiCache.ts < 3600000) {
      res.setHeader("Content-Type", "application/json");
      return res.send(emojiCache.data);
    }
    const data = await require("fs").promises.readFile(
      path.join(__dirname, "public", "js", "emojiList.json"),
      "utf8",
    );
    emojiCache.data = data;
    emojiCache.ts = Date.now();
    res.setHeader("Content-Type", "application/json");
    res.send(data);
  } catch (e) {
    res.status(404).json({ error: "Emoji list not found" });
  }
});

app.get(`${API}/rooms`, apiAuth, (req, res) => {
  try {
    const cached = state.apiCache.get("public_rooms");
    if (cached && Date.now() - cached.timestamp < state.API_CACHE_TTL)
      return res.json(cached.data);
    const data = Array.from(state.rooms.values())
      .filter((r) => r.type !== "private")
      .map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        users: (r.users || [])
          .filter((u) => !u.isDev || !u.isVanished)
          .map((u) => ({
            id: u.id,
            username: u.username,
            location: u.location,
          })),
        isFull: (r.users || []).filter((u) => !u.isDev || !u.isVanished).length >= CONFIG.LIMITS.MAX_ROOM_CAPACITY,
      }));
    state.apiCache.set("public_rooms", { timestamp: Date.now(), data });
    res.json(data);
  } catch (e) {
    sendErrorResponse(res, ERROR_CODES.SERVER_ERROR, "Internal error", 500);
  }
});

app.get(`${API}/rooms/:id`, apiAuth, (req, res) => {
  const room = state.rooms.get(req.params.id);
  if (!room)
    return sendErrorResponse(res, ERROR_CODES.NOT_FOUND, "Room not found", 404);
  res.json({
    id: room.id,
    name: room.name,
    type: room.type,
    users: (room.users || [])
      .filter((u) => !u.isDev || !u.isVanished)
      .map((u) => ({
        id: u.id,
        username: u.username,
        location: u.location,
      })),
    isFull: (room.users || []).filter((u) => !u.isDev || !u.isVanished).length >= CONFIG.LIMITS.MAX_ROOM_CAPACITY,
  });
});

app.post(`${API}/rooms`, apiAuth, async (req, res) => {
  try {
    const data = req.body;
    const valErr = validateObject(data, {
      name: { rule: "roomName" },
      type: { rule: "roomType" },
      layout: { rule: "layout" },
      accessCode: { rule: "accessCode", context: data.type },
    });
    if (valErr)
      return sendErrorResponse(
        res,
        ERROR_CODES.VALIDATION_ERROR,
        "Validation failed",
        400,
        valErr,
      );
    const limit = rooms.calculateCurrentRoomLimit();
    if (state.rooms.size >= limit)
      return sendErrorResponse(
        res,
        ERROR_CODES.ROOM_LIMIT_REACHED,
        `Room limit (${limit}) reached`,
        429,
      );
    const ip = getClientIP(req);
    if (
      Date.now() - (state.lastRoomCreationTimes.get(ip) || 0) <
      CONFIG.TIMING.ROOM_CREATION_COOLDOWN
    )
      return sendErrorResponse(
        res,
        ERROR_CODES.RATE_LIMITED,
        "Creating rooms too fast",
        429,
      );
    const { enforceRoomNameLimit } = require("./server/state");
    let name = enforceRoomNameLimit(data.name);
    if (rooms.roomNameExists(name))
      return sendErrorResponse(
        res,
        ERROR_CODES.ROOM_NAME_EXISTS,
        "Room name exists",
        409,
      );

    let roomId,
      attempts = 0;
    do {
      roomId = Math.floor(100000 + Math.random() * 900000).toString();
      attempts++;
    } while (state.rooms.has(roomId) && attempts < 100);
    if (state.rooms.has(roomId))
      return sendErrorResponse(
        res,
        ERROR_CODES.SERVER_ERROR,
        "Could not generate ID",
        500,
      );

    state.lastRoomCreationTimes.set(ip, Date.now());
    state.rooms.set(roomId, {
      id: roomId,
      name,
      type: data.type,
      layout: data.layout,
      users: [],
      accessCode: data.type === "semi-private" ? data.accessCode : null,
      votes: {},
      bannedUserIds: new Set(),
      lastActiveTime: Date.now(),
    });
    if (req.session && data.type === "semi-private" && data.accessCode) {
      if (!req.session.validatedRooms) req.session.validatedRooms = {};
      req.session.validatedRooms[roomId] = data.accessCode;
      await promisifySessionSave(req.session).catch(() => { });
    }
    state.apiCache.delete("public_rooms");
    rooms.updateLobby();
    await rooms.debouncedSaveRooms();
    res.status(201).json({
      success: true,
      roomId,
      currentStatistics: rooms.getRoomStatistics(),
    });
  } catch (e) {
    console.error("POST rooms error:", e);
    sendErrorResponse(res, ERROR_CODES.SERVER_ERROR, "Internal error", 500);
  }
});

app.post(`${API}/rooms/:id/join`, apiAuth, async (req, res) => {
  const room = state.rooms.get(req.params.id);
  if (!room)
    return sendErrorResponse(res, ERROR_CODES.NOT_FOUND, "Room not found", 404);
  if (room.users.length >= CONFIG.LIMITS.MAX_ROOM_CAPACITY)
    return sendErrorResponse(res, ERROR_CODES.ROOM_FULL, "Full", 400);
  if (room.type === "semi-private") {
    const validated = req.session?.validatedRooms?.[req.params.id];
    if (!validated) {
      if (!req.body.accessCode)
        return sendErrorResponse(
          res,
          ERROR_CODES.FORBIDDEN,
          "Access code required",
          403,
        );
      if (room.accessCode !== req.body.accessCode)
        return sendErrorResponse(res, ERROR_CODES.FORBIDDEN, "Wrong code", 403);
      if (req.session) {
        if (!req.session.validatedRooms) req.session.validatedRooms = {};
        req.session.validatedRooms[req.params.id] = req.body.accessCode;
        await promisifySessionSave(req.session).catch(() => { });
      }
    }
  }
  res.json({
    success: true,
    message: "Access granted. Connect via Socket.IO.",
  });
});

// ── Startup ─────────────────────────────────────────────────────────────────

async function start() {
  await rooms.loadRooms();
  rooms.registerSocketHandlers();
  rooms.startCleanupIntervals();

  setTimeout(() => {
    rooms.purgeAllGhostUsers();
    rooms.updateLobby();
  }, 2000);

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    const stats = rooms.getRoomStatistics();
    console.log(`
══════════════════════════════════════════════════════
  Talkomatic Server v${CONFIG.VERSIONS.SERVER} started on port ${PORT}
  Node.js ${process.version}
  Rooms: ${stats.totalRooms}/${stats.currentLimit} | Users: ${stats.totalUsers}
  Antibot: ${CONFIG.FEATURES.ENABLE_STRICT_ANTIBOT ? "ON" : "OFF"} | Bot Tokens: ${CONFIG.FEATURES.ENABLE_BOT_TOKENS ? "ON" : "OFF"}
  Dev Mode: ${CONFIG.DEV.KEY_HASH ? "CONFIGURED" : "NOT SET"}
══════════════════════════════════════════════════════`);
  });
}

// Graceful shutdown
async function shutdown(signal) {
  console.log(`${signal} received. Saving rooms and shutting down...`);
  try {
    await rooms.saveRooms();
  } catch (e) {
    console.error("Shutdown save failed:", e);
  }
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start().catch((err) => {
  console.error("Startup failed:", err);
  process.exit(1);
});
