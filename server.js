const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const session = require('express-session');
const sharedsession = require("express-socket.io-session");
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const xss = require('xss-clean');
const hpp = require('hpp');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);

// Constants
const MAX_USERNAME_LENGTH = 12;
const MAX_LOCATION_LENGTH = 12;
const MAX_ROOM_NAME_LENGTH = 20;
const MAX_MESSAGE_LENGTH = 5000;

// Define allowed origins
const allowedOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000'];

// CORS options
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      var msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  methods: ['GET', 'POST'],
  credentials: true,
  optionsSuccessStatus: 200
};

// Apply CORS middleware
app.use(cors(corsOptions));

app.use((req, res, next) => {
  res.locals.nonce = crypto.randomBytes(16).toString('base64');
  next();
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "script-src": ["'self'", (req, res) => `'nonce-${res.locals.nonce}'`],
      "style-src": ["'self'", "'unsafe-inline'"],
    },
  },
}));
app.use(cors()); // Enable CORS
app.use(xss()); // Sanitize input
app.use(hpp()); // Protect against HTTP Parameter Pollution attacks

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Set up session middleware
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || '723698977cc31aaf8e84d93feffadcf72d65bfe0e56d58ba2cbdb88d74809745',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
});

app.use(sessionMiddleware);

const io = socketIo(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Share session middleware with socket.io
io.use(sharedsession(sessionMiddleware, {
  autoSave: true
}));

// Serve static files
app.use((req, res, next) => {
  res.locals.nonce = crypto.randomBytes(16).toString('base64');
  next();
}, express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript');
      res.setHeader('Cache-Control', 'public, max-age=31536000');
    }
  }
}));

// Store rooms and users
const rooms = new Map();
const users = new Map();

// Store room deletion timers
const roomDeletionTimers = new Map();

// Store typing timeouts
const typingTimeouts = new Map();

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

const clearUserSession = (socket) => {
  return new Promise((resolve, reject) => {
    if (socket && socket.handshake && socket.handshake.session) {
      socket.handshake.session.currentRoom = null;
      socket.handshake.session.save((err) => {
        if (err) {
          console.error('Error saving session:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    } else {
      resolve(); // If there's no session, just resolve
    }
  });
};

// Socket.io event handlers
io.on('connection', (socket) => {
  console.log(`New user connected: ${socket.id}`);

  // Generate a unique user ID if not already present in the session
  if (!socket.handshake.session.userId) {
    socket.handshake.session.userId = uuidv4();
    socket.handshake.session.save();
  }

  const userId = socket.handshake.session.userId;

  // Join lobby
  socket.on('join lobby', (data) => {
    console.log(`User ${userId} joining lobby with username: ${data.username}, location: ${data.location}`);
    socket.username = enforceUsernameLimit(data.username);
    socket.location = enforceLocationLimit(data.location || 'Earth');
    users.set(userId, { id: userId, username: socket.username, location: socket.location });
    
    // Store user information in the session
    socket.handshake.session.username = socket.username;
    socket.handshake.session.location = socket.location;
    socket.handshake.session.save((err) => {
      if (err) {
        console.error('Error saving session:', err);
      } else {
        socket.join('lobby');
        console.log(`User ${userId} joined lobby`);
        updateLobby();
      }
    });
  });

  // Check signin status
  socket.on('check signin status', () => {
    const username = socket.handshake.session.username;
    const location = socket.handshake.session.location;
    const userId = socket.handshake.session.userId;
    if (username && location && userId) {
      socket.emit('signin status', { isSignedIn: true, username, location, userId });
      socket.join('lobby');
      users.set(userId, { id: userId, username, location });
      updateLobby();
    } else {
      socket.emit('signin status', { isSignedIn: false });
    }
  });

  // Create room
  socket.on('create room', (data) => {
    console.log(`User ${userId} creating room: ${JSON.stringify(data)}`);
    const roomId = generateRoomId();
    rooms.set(roomId, {
      id: roomId,
      name: enforceRoomNameLimit(data.name),
      type: data.type,
      layout: data.layout,
      users: [],
    });
    console.log(`Room created with ID: ${roomId}`);
    socket.emit('room created', roomId);
    updateLobby();
  });
  
  // Join room
  socket.on('join room', (roomId) => {
    console.log(`User ${userId} attempting to join room: ${roomId}`);
    const room = rooms.get(roomId);
    if (room) {
      joinRoom(socket, room, userId);
    } else {
      console.log(`Room ${roomId} not found`);
      socket.emit('room not found');
    }
  });

  // Rejoin room (after page refresh)
  socket.on('rejoin room', (data) => {
    console.log(`User ${userId} attempting to rejoin room: ${data.roomId}`);
    const room = rooms.get(data.roomId);
    if (room) {
      socket.username = data.username;
      socket.location = data.location;
      users.set(userId, { id: userId, username: socket.username, location: socket.location });
      joinRoom(socket, room, userId);
    } else {
      console.log(`Room ${data.roomId} not found for rejoin`);
      socket.emit('room not found');
    }
  });

  // Leave room
  socket.on('leave room', async () => {
    console.log(`User ${userId} leaving room`);
    await leaveRoom(socket, userId);
  });

  // Handle chat update
  socket.on('chat update', (data) => {
    if (socket.roomId) {
      console.log(`Chat update in room ${socket.roomId} from user ${userId}:`, data);
      if (data.diff && data.diff.text) {
        data.diff.text = enforceCharacterLimit(data.diff.text);
      }
      socket.to(socket.roomId).emit('chat update', {
        userId: userId,
        username: socket.username,
        diff: data.diff
      });
    }
  });

  // Handle typing
  socket.on('typing', (data) => {
    if (socket.roomId) {
      if (typingTimeouts.has(userId)) {
        clearTimeout(typingTimeouts.get(userId));
      }

      if (data.isTyping) {
        socket.to(socket.roomId).emit('user typing', {
          userId: userId,
          username: socket.username,
          isTyping: true
        });

        typingTimeouts.set(userId, setTimeout(() => {
          socket.to(socket.roomId).emit('user typing', {
            userId: userId,
            username: socket.username,
            isTyping: false
          });
          typingTimeouts.delete(userId);
        }, 2000)); // Stop "typing" after 2 seconds of inactivity
      } else {
        socket.to(socket.roomId).emit('user typing', {
          userId: userId,
          username: socket.username,
          isTyping: false
        });
        typingTimeouts.delete(userId);
      }
    }
  });

  // Get rooms
  socket.on('get rooms', () => {
    console.log(`User ${userId} requesting room list`);
    socket.emit('initial rooms', Array.from(rooms.values()));
  });

  // Disconnect
  socket.on('disconnect', async () => {
    console.log(`User disconnected: ${userId}`);
    await leaveRoom(socket, userId);
    users.delete(userId);
  });
});

async function joinRoom(socket, room, userId) {
  socket.join(room.id);
  room.users = room.users.filter(user => user.id !== userId);
  room.users.push({
    id: userId,
    username: socket.username,
    location: socket.location,
  });
  socket.roomId = room.id;
  socket.handshake.session.currentRoom = room.id;
  await new Promise((resolve, reject) => {
    socket.handshake.session.save((err) => {
      if (err) {
        console.error('Error saving session:', err);
        reject(err);
      } else {
        resolve();
      }
    });
  });
  io.to(room.id).emit('user joined', {
    id: userId,
    username: socket.username,
    location: socket.location,
  });
  updateRoom(room.id);
  socket.emit('room joined', { 
    roomId: room.id, 
    userId: userId,
    username: socket.username,
    location: socket.location,
    roomName: room.name,
    roomType: room.type,
    users: room.users,
    layout: room.layout
  });
  socket.leave('lobby');
  console.log(`User ${userId} joined room: ${room.id}`);
  updateLobby();

  // Clear the room deletion timer if it exists
  if (roomDeletionTimers.has(room.id)) {
    clearTimeout(roomDeletionTimers.get(room.id));
    roomDeletionTimers.delete(room.id);
    console.log(`Cleared deletion timer for room ${room.id}`);
  }
}

async function leaveRoom(socket, userId) {
  if (socket.roomId) {
    console.log(`User ${userId} leaving room ${socket.roomId}`);
    const room = rooms.get(socket.roomId);
    if (room) {
      room.users = room.users.filter(user => user.id !== userId);
      socket.leave(socket.roomId);
      io.to(socket.roomId).emit('user left', userId);
      updateRoom(socket.roomId);

      // Start the room deletion timer if the room is empty
      if (room.users.length === 0) {
        startRoomDeletionTimer(socket.roomId);
      }
    }
    socket.roomId = null;
    // Instead of clearing the entire session, just remove the currentRoom
    if (socket.handshake.session) {
      socket.handshake.session.currentRoom = null;
      await new Promise((resolve, reject) => {
        socket.handshake.session.save((err) => {
          if (err) {
            console.error('Error saving session:', err);
            reject(err);
          } else {
            resolve();
          }
        });
      });
    }
    socket.join('lobby');
  }
  updateLobby();
}

function startRoomDeletionTimer(roomId) {
  console.log(`Starting deletion timer for room ${roomId}`);
  const timer = setTimeout(() => {
    console.log(`Deleting empty room ${roomId}`);
    rooms.delete(roomId);
    roomDeletionTimers.delete(roomId);
    updateLobby();
  }, 15000); // 15 seconds

  roomDeletionTimers.set(roomId, timer);
}

function updateLobby() {
  console.log('Updating lobby');
  const roomList = Array.from(rooms.values());
  console.log(`Current rooms: ${JSON.stringify(roomList)}`);
  io.to('lobby').emit('lobby update', roomList);
}

function updateRoom(roomId) {
  const room = rooms.get(roomId);
  if (room) {
    console.log(`Updating room ${roomId}: ${JSON.stringify(room)}`);
    io.to(roomId).emit('room update', room);
  }
}

function generateRoomId() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});