/****************************
 * server.js
 * ==========================
 ****************************/

require('dotenv').config();

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs').promises;
const path = require('path');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const sharedsession = require('express-socket.io-session');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const xss = require('xss-clean');
const hpp = require('hpp');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const WordFilter = require('./public/js/word-filter.js');
const wordFilter = new WordFilter(
  path.join(__dirname, 'public', 'js', 'offensive_words.json')
);

const lastRoomCreationTimes = new Map();
const ROOM_CREATION_COOLDOWN = 30000; // 30 seconds

const app = express();
const server = http.createServer(app);

let userStore = new Map(); // Map<guestId, { guestId, username, location, userId, createdAt }>

// Parse JSON bodies
app.use(express.json());

const MAX_USERNAME_LENGTH = 12;
const MAX_LOCATION_LENGTH = 12;
const MAX_ROOM_NAME_LENGTH = 20;
const MAX_MESSAGE_LENGTH = 5000;
const MAX_ROOM_CAPACITY = 5;
const ENABLE_WORD_FILTER = true;

// Allowed CORS origins
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://classic.talkomatic.co',
  'https://dev.talkomatic.co'
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      return callback(
        new Error('CORS policy does not allow access from this origin.'),
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

// Helmet security headers
// We REMOVE the dynamic nonce for scriptSrc to avoid console warnings.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "'unsafe-eval'",
          "https://cdnjs.cloudflare.com"
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
          "https://classic.talkomatic.co"
        ]
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginOpenerPolicy: false
  })
);

app.use(xss());
app.use(hpp());

// Rate limit
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
});
app.use(limiter);

// Session
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || '723698977cc31aaf8e84...',
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 14 * 24 * 60 * 60 * 1000,
  },
});
app.use(sessionMiddleware);

// Socket.io
const io = socketIo(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});
io.use(sharedsession(sessionMiddleware, { autoSave: true }));

// Serve static
app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.js')) {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=31536000');
      }
    },
  })
);

// In-memory for rooms
let rooms = new Map();
const roomDeletionTimers = new Map();
const typingTimeouts = new Map();
const userMessageBuffers = new Map();

// Load/save rooms
async function saveRooms() {
  try {
    const data = JSON.stringify(Array.from(rooms.entries()));
    await fs.writeFile(path.join(__dirname, 'rooms.json'), data);
  } catch (err) {
    console.error('Error saving rooms:', err);
  }
}
async function loadRooms() {
  try {
    const data = await fs.readFile(path.join(__dirname, 'rooms.json'), 'utf8');
    const loaded = JSON.parse(data);
    rooms = new Map(loaded);
    // optionally clear on restart:
    rooms.clear();
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('Error loading rooms:', err);
    }
  }
}
loadRooms();

// Load/save users
async function saveUsers() {
  try {
    const data = JSON.stringify(Array.from(userStore.entries()));
    await fs.writeFile(path.join(__dirname, 'users.json'), data);
  } catch (err) {
    console.error('Error saving users:', err);
  }
}
async function loadUsers() {
  try {
    const data = await fs.readFile(path.join(__dirname, 'users.json'), 'utf8');
    const loaded = JSON.parse(data);
    userStore = new Map(loaded);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('Error loading users:', err);
    }
  }
}
loadUsers();

// Helpers
function normalize(str) {
  return (str || '').trim().toLowerCase();
}
function enforceCharacterLimit(msg) {
  return typeof msg === 'string' ? msg.slice(0, MAX_MESSAGE_LENGTH) : msg;
}
function enforceUsernameLimit(u) {
  return u.slice(0, MAX_USERNAME_LENGTH);
}
function enforceLocationLimit(l) {
  return l.slice(0, MAX_LOCATION_LENGTH);
}
function enforceRoomNameLimit(n) {
  return n.slice(0, MAX_ROOM_NAME_LENGTH);
}
function generateRoomId() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
function getUserRoomsCount(userId) {
  let count = 0;
  for (const [, rm] of rooms) {
    if (rm.users.some((u) => u.id === userId)) {
      count++;
    }
  }
  return count;
}
function getUsernameLocationRoomsCount(username, location) {
  const uLow = normalize(username);
  const lLow = normalize(location);
  let count = 0;
  for (const [, rm] of rooms) {
    for (const mem of rm.users) {
      if (normalize(mem.username) === uLow && normalize(mem.location) === lLow) {
        count++;
      }
    }
  }
  return count;
}
function updateLobby() {
  const publicRooms = Array.from(rooms.values())
    .filter((r) => r.type !== 'private')
    .map((r) => ({
      ...r,
      accessCode: undefined,
      isFull: r.users.length >= MAX_ROOM_CAPACITY,
    }));
  io.to('lobby').emit('lobby update', publicRooms);
}
function updateRoom(roomId) {
  const rm = rooms.get(roomId);
  if (rm) {
    io.to(roomId).emit('room update', {
      id: rm.id,
      name: rm.name,
      type: rm.type,
      layout: rm.layout,
      users: rm.users,
      votes: rm.votes,
      leaderId: rm.leaderId,
      locked: rm.locked || false,
      accessCode: undefined
    });
  }
}
function getCurrentMessages(users) {
  const messages = {};
  users.forEach((u) => {
    messages[u.id] = userMessageBuffers.get(u.id) || '';
  });
  return messages;
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

// leaving room
async function leaveRoom(socket, userId) {
  if (!socket.roomId) return;
  const rm = rooms.get(socket.roomId);
  if (rm) {
    // remove user
    rm.users = rm.users.filter((u) => u.id !== userId);
    // if leader => pass to next (oldest remaining user)
    if (rm.leaderId === userId && rm.users.length > 0) {
      rm.leaderId = rm.users[0].id; // next oldest
    }
    rm.lastActiveTime = Date.now();

    // remove votes
    if (rm.votes) {
      delete rm.votes[userId];
      for (let voterId in rm.votes) {
        if (rm.votes[voterId] === userId) {
          delete rm.votes[voterId];
        }
      }
      io.to(socket.roomId).emit('update votes', rm.votes);
    }

    socket.leave(socket.roomId);
    io.to(socket.roomId).emit('user left', userId);
    updateRoom(socket.roomId);

    if (rm.users.length === 0) {
      startRoomDeletionTimer(socket.roomId);
    }
  }
  socket.roomId = null;
  socket.handshake.session.currentRoom = null;
  await new Promise((resolve) => socket.handshake.session.save(resolve));
  socket.join('lobby');
  updateLobby();
  await saveRooms();
}

// joining room
function joinRoom(socket, roomId, userId) {
  if (!roomId || roomId.length !== 6) {
    socket.emit('room not found');
    return;
  }
  const rm = rooms.get(roomId);
  if (!rm) {
    socket.emit('room not found');
    return;
  }

  // Set leader if not already assigned (i.e. first user joining)
  if (!rm.leaderId) {
    rm.leaderId = userId;
  }

  // Check permanent ban
  if (rm.bannedUserIds && rm.bannedUserIds.has(userId)) {
    socket.emit('error', 'You have been banned from rejoining this room.');
    return;
  }

  // Check 5-minute kick
  if (rm.tempBans && rm.tempBans.has(userId)) {
    const banExpiry = rm.tempBans.get(userId);
    if (Date.now() < banExpiry) {
      socket.emit('error', 'You have been kicked for 5 minutes. Please try again later.');
      return;
    } else {
      // ban is expired
      rm.tempBans.delete(userId);
    }
  }

  // if locked, cannot join
  if (rm.locked) {
    socket.emit('error', 'This room is locked by the moderator. Cannot join.');
    return;
  }

  const { username, location } = socket.handshake.session;
  const userLower = normalize(username);
  const locLower = normalize(location);
  const isAnonymous = userLower === 'anonymous' && locLower === 'on the web';

  if (!isAnonymous) {
    if (getUserRoomsCount(userId) >= 2) {
      socket.emit('error', 'unable to join room at the moment please try again later');
      return;
    }
    if (getUsernameLocationRoomsCount(username, location) >= 2) {
      socket.emit('error', 'unable to join room at the moment please try again later');
      return;
    }
  }

  if (!rm.users) rm.users = [];
  if (!rm.votes) rm.votes = {};

  if (rm.users.length >= MAX_ROOM_CAPACITY) {
    socket.emit('room full');
    return;
  }

  socket.join(roomId);

  // see if user is already in the room
  let existingUser = rm.users.find((u) => u.id === userId);
  if (existingUser) {
    existingUser.username = username;
    existingUser.location = location;
    // do not emit "user joined" again
  } else {
    rm.users.push({
      id: userId,
      username,
      location,
    });
    io.to(roomId).emit('user joined', {
      id: userId,
      username,
      location,
      roomName: rm.name,
      roomType: rm.type,
    });
  }
  rm.lastActiveTime = Date.now();

  socket.roomId = roomId;
  socket.handshake.session.currentRoom = roomId;
  socket.handshake.session.save(() => {
    updateRoom(roomId);
    updateLobby();

    const currentMsgs = getCurrentMessages(rm.users);
    socket.emit('room joined', {
      roomId,
      userId,
      username,
      location,
      roomName: rm.name,
      roomType: rm.type,
      users: rm.users,
      layout: rm.layout,
      votes: rm.votes,
      currentMessages: currentMsgs,
      leaderId: rm.leaderId,
      locked: rm.locked || false
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
  if (!socket.roomId) return;
  if (typingTimeouts.has(userId)) {
    clearTimeout(typingTimeouts.get(userId));
  }
  if (isTyping) {
    socket.to(socket.roomId).emit('user typing', { userId, username, isTyping: true });
    typingTimeouts.set(
      userId,
      setTimeout(() => {
        socket.to(socket.roomId).emit('user typing', { userId, username, isTyping: false });
        typingTimeouts.delete(userId);
      }, 2000)
    );
  } else {
    socket.to(socket.roomId).emit('user typing', { userId, username, isTyping: false });
    typingTimeouts.delete(userId);
  }
}

io.on('connection', (socket) => {
  const { guestId } = socket.handshake.query;
  if (!guestId) {
    socket.emit('error', 'No guestId (fingerprint) provided. Reload the page.');
    return;
  } else {
    if (userStore.has(guestId)) {
      socket.emit('guest detection', `user detected: ${guestId}`);
    } else {
      socket.emit('guest detection', `No account detected making new account: ${guestId}`);
      userStore.set(guestId, {
        guestId,
        username: '',
        location: '',
        createdAt: Date.now(),
      });
      saveUsers();
    }
    socket.handshake.session.guestId = guestId;
  }

  // check sign-in status
  socket.on('check signin status', () => {
    let { guestId, username, location, userId } = socket.handshake.session;
    if ((!username || !location || !userId) && guestId && userStore.has(guestId)) {
      let record = userStore.get(guestId);
      if (record.username && record.location) {
        username = record.username;
        location = record.location;
        userId = record.userId || guestId + '-' + uuidv4().slice(0, 6);
        socket.handshake.session.username = username;
        socket.handshake.session.location = location;
        socket.handshake.session.userId = userId;
        socket.handshake.session.save();
      }
    }
    if (username && location && userId) {
      socket.emit('signin status', {
        isSignedIn: true,
        username,
        location,
        userId,
      });
      socket.join('lobby');
    } else {
      socket.emit('signin status', { isSignedIn: false });
    }
  });

  // join lobby
  socket.on('join lobby', async (data) => {
    try {
      if (!data) {
        socket.emit('error', 'No data provided when joining lobby.');
        return;
      }
      let username = enforceUsernameLimit(data.username || '');
      let location = enforceLocationLimit(data.location || 'On The Web');

      if (ENABLE_WORD_FILTER) {
        const unCheck = wordFilter.checkText(username);
        if (unCheck.hasOffensiveWord) {
          socket.emit('error', 'Your chosen name contains forbidden words. Please pick another.');
          return;
        }
        const locCheck = wordFilter.checkText(location);
        if (locCheck.hasOffensiveWord) {
          socket.emit('error', 'Your chosen location contains forbidden words. Please pick another.');
          return;
        }
      }

      const userId = guestId + '-' + uuidv4().slice(0, 6);
      socket.handshake.session.username = username;
      socket.handshake.session.location = location;
      socket.handshake.session.userId = userId;

      if (userStore.has(guestId)) {
        const rec = userStore.get(guestId);
        rec.username = username;
        rec.location = location;
        rec.userId = userId;
        userStore.set(guestId, rec);
        await saveUsers();
      }

      socket.handshake.session.save((err) => {
        if (!err) {
          socket.join('lobby');
          socket.emit('signin status', {
            isSignedIn: true,
            username,
            location,
            userId,
          });
          updateLobby();
        }
      });
    } catch (err) {
      console.error('Error in join lobby:', err);
      socket.emit('error', 'Internal server error while joining lobby.');
    }
  });

  // create room
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
      const { username, location } = socket.handshake.session;
      const userLower = normalize(username);
      const locLower = normalize(location);
      const isAnon = userLower === 'anonymous' && locLower === 'on the web';

      if (isAnon) {
        socket.emit('error', 'Anonymous users cannot create rooms.');
        return;
      }

      if (getUsernameLocationRoomsCount(username, location) >= 2) {
        socket.emit('error', 'unable to create room at the moment please try again later');
        return;
      }
      if (getUserRoomsCount(userId) >= 2) {
        socket.emit('error', 'You are in too many rooms to create a new one right now.');
        return;
      }

      const now = Date.now();
      const lastCreation = lastRoomCreationTimes.get(userId) || 0;
      if (now - lastCreation < ROOM_CREATION_COOLDOWN) {
        socket.emit('error', 'You are creating rooms too frequently. Please wait a bit.');
        return;
      }

      let roomName = enforceRoomNameLimit(data.name || 'Just Chatting');
      if (ENABLE_WORD_FILTER) {
        const nmCheck = wordFilter.checkText(roomName);
        if (nmCheck.hasOffensiveWord) {
          socket.emit('error', 'Your chosen room name contains forbidden words.');
          return;
        }
      }
      let roomType = data.type;
      let layout = data.layout;
      if (!roomType || !layout) {
        socket.emit('error', 'Room type or layout missing.');
        return;
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
        layout,
        users: [],
        accessCode: roomType === 'semi-private' ? data.accessCode : null,
        votes: {},
        bannedUserIds: new Set(),
        tempBans: new Map(), // for 5-min kicks
        leaderId: null,
        locked: false,
        lastActiveTime: Date.now(),
      };
      rooms.set(roomId, newRoom);

      socket.emit('room created', roomId);
      updateLobby();
      saveRooms();
    } catch (err) {
      console.error('Error in create room:', err);
      socket.emit('error', 'Internal server error while creating room.');
    }
  });

  // join room
  socket.on('join room', (data) => {
    try {
      if (!data || !data.roomId) {
        socket.emit('error', 'Invalid or missing data when attempting to join room.');
        return;
      }
      const rm = rooms.get(data.roomId);
      if (!rm) {
        socket.emit('room not found');
        return;
      }
      if (rm.type === 'semi-private') {
        if (!data.accessCode) {
          socket.emit('access code required');
          return;
        }
        if (rm.accessCode !== data.accessCode) {
          socket.emit('error', 'Incorrect access code');
          return;
        }
      }
      let { username, location, userId } = socket.handshake.session;
      if (!username || !location || !userId) {
        // fallback
        userId = guestId + '-' + uuidv4().slice(0, 6);
        username = 'Anonymous';
        location = 'On The Web';
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

  // vote
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
      const rmId = socket.roomId;
      if (!rmId) return;
      const rm = rooms.get(rmId);
      if (!rm) return;

      if (!rm.users.find((u) => u.id === userId)) return; // not in room
      if (userId === targetUserId) return; // can't vote self
      if (!rm.votes) rm.votes = {};

      if (rm.votes[userId] === targetUserId) {
        // unvote
        delete rm.votes[userId];
        io.to(rmId).emit('update votes', rm.votes);
      } else {
        rm.votes[userId] = targetUserId;
        io.to(rmId).emit('update votes', rm.votes);

        // majority check
        const votesAgainst = Object.values(rm.votes).filter((v) => v === targetUserId).length;
        const totalUsers = rm.users.length;
        if (votesAgainst > Math.floor(totalUsers / 2)) {
          // Kick for majority vote
          const targetSocket = [...io.sockets.sockets.values()].find(
            (s) => s.handshake.session.userId === targetUserId
          );
          if (targetSocket) {
            targetSocket.emit('kicked', { reason: 'You have been voted by the majority to be kicked from this room' });
            // With majority vote, we do a temporary 5-minute kick:
            if (!rm.tempBans) rm.tempBans = new Map();
            rm.tempBans.set(targetUserId, Date.now() + 5 * 60 * 1000);

            leaveRoom(targetSocket, targetUserId);
          }
        }
      }
    } catch (err) {
      console.error('Error in vote handler:', err);
      socket.emit('error', 'Internal server error during vote.');
    }
  });

  // leave room
  socket.on('leave room', async () => {
    try {
      const userId = socket.handshake.session.userId;
      await leaveRoom(socket, userId);
    } catch (err) {
      console.error('Error in leave room:', err);
      socket.emit('error', 'Internal server error while leaving room.');
    }
  });

  // chat update
  socket.on('chat update', (data) => {
    try {
      if (!socket.roomId) return;
      const rm = rooms.get(socket.roomId);
      if (!rm) return;

      const userId = socket.handshake.session.userId;
      const username = socket.handshake.session.username;

      // check global mute
      if (rm.mutedUserIds && rm.mutedUserIds.has(userId)) {
        return; // do not broadcast
      }

      if (!userMessageBuffers.has(userId)) {
        userMessageBuffers.set(userId, '');
      }
      let userMessage = userMessageBuffers.get(userId);

      if (!data || typeof data !== 'object') {
        socket.emit('error', 'Invalid chat update data.');
        return;
      }

      const diff = data.diff;
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
            userMessage.slice(0, diff.index) +
            userMessage.slice(diff.index + diff.count);
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
          // Replace in buffer
          userMessage = wordFilter.filterText(userMessage);
          userMessageBuffers.set(userId, userMessage);
          // Let entire room know
          io.to(socket.roomId).emit('offensive word detected', {
            userId,
            filteredMessage: userMessage,
          });
        } else {
          // broadcast diff
          socket.to(socket.roomId).emit('chat update', {
            userId,
            username,
            diff,
          });
        }
      } else {
        socket.to(socket.roomId).emit('chat update', {
          userId,
          username,
          diff,
        });
      }
    } catch (err) {
      console.error('Error in chat update:', err);
      socket.emit('error', 'Internal server error during chat update.');
    }
  });

  // typing
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

  // moderator action
  socket.on('moderator action', (data) => {
    try {
      const userId = socket.handshake.session.userId;
      const rmId = socket.roomId;
      if (!rmId || !data) return;
      const rm = rooms.get(rmId);
      if (!rm) return;
      if (rm.leaderId !== userId) {
        socket.emit('error', 'Only the room leader can do that');
        return;
      }
      const { action, targetUserId } = data;
      switch (action) {
        case 'kick': {
          if (targetUserId) {
            // Kick for 5 min
            if (!rm.tempBans) rm.tempBans = new Map();
            rm.tempBans.set(targetUserId, Date.now() + 5 * 60 * 1000);

            const tSock = [...io.sockets.sockets.values()].find(
              (s) => s.handshake.session.userId === targetUserId
            );
            if (tSock) {
              tSock.emit('kicked', { reason: 'Moderator kicked you out (5 min)' });
              leaveRoom(tSock, targetUserId);
            }
          }
          break;
        }
        case 'ban': {
          if (targetUserId) {
            if (!rm.bannedUserIds) {
              rm.bannedUserIds = new Set();
            }
            rm.bannedUserIds.add(targetUserId);
            const tSock = [...io.sockets.sockets.values()].find(
              (s) => s.handshake.session.userId === targetUserId
            );
            if (tSock) {
              tSock.emit('kicked', { reason: 'Banned by Moderator' });
              leaveRoom(tSock, targetUserId);
            }
          }
          break;
        }
        case 'transfer-leader': {
          if (targetUserId && rm.users.some((u) => u.id === targetUserId)) {
            rm.leaderId = targetUserId;
            updateRoom(rmId);
          }
          break;
        }
        case 'lock-room': {
          rm.locked = !rm.locked;
          updateRoom(rmId);
          break;
        }
        case 'mute': {
          if (!targetUserId) break;
          if (!rm.mutedUserIds) {
            rm.mutedUserIds = new Set();
          }
          if (rm.mutedUserIds.has(targetUserId)) {
            rm.mutedUserIds.delete(targetUserId);
          } else {
            rm.mutedUserIds.add(targetUserId);
          }
          updateRoom(rmId);
          break;
        }
        default:
          socket.emit('error', 'Unknown mod action');
          break;
      }
    } catch (err) {
      console.error('Moderator action error:', err);
    }
  });

  // get rooms
  socket.on('get rooms', () => {
    socket.emit('initial rooms', Array.from(rooms.values()));
  });

  // disconnect
  socket.on('disconnect', async () => {
    try {
      const userId = socket.handshake.session.userId;
      await leaveRoom(socket, userId);
      userMessageBuffers.delete(userId);
    } catch (err) {
      console.error('Error on disconnect:', err);
    }
  });
});

// Periodic cleanup
setInterval(() => {
  for (const [rmId, rm] of rooms.entries()) {
    if (rm.users.length === 0) {
      const sinceLastActive = Date.now() - (rm.lastActiveTime || 0);
      if (sinceLastActive > 15000) {
        rooms.delete(rmId);
        roomDeletionTimers.delete(rmId);
        updateLobby();
        saveRooms();
        console.log(`Periodic cleanup: removed empty room ${rmId}`);
      }
    }
  }
}, 10000);

/***************************************************
 * OPTIONAL: Additional REST API
 ***************************************************/
function apiAuth(req, res, next) {
  const apiKey = req.header('x-api-key');
  const validApiKey = 'tK_public_key_4f8a9b2c7d6e3f1a5g8h9i0j4k5l6m7n8o9p';
  if (!apiKey || apiKey !== validApiKey) {
    return res.status(403).json({ error: 'Forbidden: invalid or missing x-api-key.' });
  }
  next();
}

// example: GET /api/v1/rooms
app.get('/api/v1/rooms', limiter, apiAuth, (req, res) => {
  const pubRooms = Array.from(rooms.values())
    .filter((r) => r.type !== 'private')
    .map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      users: r.users.map((u) => ({
        id: u.id,
        username: u.username,
        location: u.location,
      })),
      isFull: r.users.length >= MAX_ROOM_CAPACITY,
    }));
  res.json(pubRooms);
});

// GET /api/v1/rooms/:id
app.get('/api/v1/rooms/:id', limiter, apiAuth, (req, res) => {
  const rm = rooms.get(req.params.id);
  if (!rm) {
    return res.status(404).json({ error: 'Room not found' });
  }
  res.json({
    id: rm.id,
    name: rm.name,
    type: rm.type,
    users: rm.users.map((u) => ({
      id: u.id,
      username: u.username,
      location: u.location,
    })),
    isFull: rm.users.length >= MAX_ROOM_CAPACITY,
  });
});

// POST /api/v1/rooms
app.post('/api/v1/rooms', limiter, apiAuth, (req, res) => {
  try {
    const data = req.body;
    if (!data || !data.name || !data.type || !data.layout) {
      return res.status(400).json({ error: 'Missing required fields: name, type, layout' });
    }
    let roomName = enforceRoomNameLimit(data.name);
    if (ENABLE_WORD_FILTER) {
      const check = wordFilter.checkText(roomName);
      if (check.hasOffensiveWord) {
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
      layout,
      users: [],
      accessCode: roomType === 'semi-private' ? data.accessCode : null,
      votes: {},
      bannedUserIds: new Set(),
      tempBans: new Map(),
      leaderId: null,
      locked: false,
      lastActiveTime: Date.now(),
    };
    rooms.set(roomId, newRoom);
    updateLobby();
    saveRooms();
    return res.json({ success: true, roomId });
  } catch (err) {
    console.error('Error in /api/v1/rooms POST:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/v1/rooms/:id/join
app.post('/api/v1/rooms/:id/join', limiter, apiAuth, (req, res) => {
  try {
    const rm = rooms.get(req.params.id);
    if (!rm) {
      return res.status(404).json({ error: 'Room not found' });
    }
    if (rm.users.length >= MAX_ROOM_CAPACITY) {
      return res.status(400).json({ error: 'Room is full' });
    }
    if (rm.type === 'semi-private') {
      if (rm.accessCode !== req.body.accessCode) {
        return res.status(403).json({ error: 'Invalid access code' });
      }
    }
    return res.json({
      success: true,
      message: 'You can now connect via Socket.IO to join the room in real time.',
    });
  } catch (err) {
    console.error('Error in /api/v1/rooms/:id/join:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// example test route
app.get('/api/v1/protected/ping', limiter, apiAuth, (req, res) => {
  return res.json({ message: 'pong', time: Date.now() });
});

const PORT = process.env.PORT || 7842;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
