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
const app = express();
const server = http.createServer(app);

// Add this new function for sanitization
function sanitizeInput(input) {
  // Simply enforce character limits without escaping any characters
  return input; // Return the input as is
}

// Constants
const MAX_USERNAME_LENGTH = 12;
const MAX_LOCATION_LENGTH = 12;
const MAX_ROOM_NAME_LENGTH = 20;
const MAX_MESSAGE_LENGTH = 5000;

// Define allowed origins
const allowedOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000', 'https://open.talkomatic.co/'];

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

app.use(cookieParser());

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
app.use(xss());
app.use(hpp());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000
});
app.use(limiter);

// Set up session middleware
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || '723698977cc31aaf8e84d93feffadcf72d65bfe0e56d58ba2cbdb88d74809745',
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 14 * 24 * 60 * 60 * 1000 // 14 days
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
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript');
      res.setHeader('Cache-Control', 'public, max-age=31536000');
    }
  }
}));

// Store rooms and users
let rooms = new Map();
const users = new Map();
const roomDeletionTimers = new Map();
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

async function saveRooms() {
  try {
    const roomsData = JSON.stringify(Array.from(rooms.entries()));
    await fs.writeFile(path.join(__dirname, 'rooms.json'), roomsData);
    console.log('Rooms saved to file');
  } catch (error) {
    console.error('Error saving rooms:', error);
  }
}

async function loadRooms() {
  try {
    const roomsData = await fs.readFile(path.join(__dirname, 'rooms.json'), 'utf8');
    const loadedRooms = JSON.parse(roomsData);
    rooms = new Map(loadedRooms);
    console.log('Rooms loaded from file');
    
    // Clear all rooms on server restart
    rooms.clear();
    console.log('All rooms cleared on server restart');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Error loading rooms:', error);
    }
  }
}

// Call loadRooms() when the server starts
loadRooms();

// Socket.io event handlers
io.on('connection', (socket) => {
  console.log(`New connection, session ID: ${socket.handshake.sessionID}`);

  socket.on('check signin status', () => {
    const { username, location, userId } = socket.handshake.session;
    if (username && location && userId) {
      console.log(`User signed in: ${username}, ${location}, ${userId}`);
      socket.emit('signin status', { isSignedIn: true, username, location, userId });
      socket.join('lobby');
      users.set(userId, { id: userId, username, location });
      updateLobby();
    } else {
      console.log('User not signed in');
      socket.emit('signin status', { isSignedIn: false });
    }
  });

  socket.on('join lobby', (data) => {
    console.log(`User joining lobby: ${data.username}, ${data.location}`);
    const username = enforceUsernameLimit(data.username);
    const location = enforceLocationLimit(data.location || 'On The Web');
    const userId = socket.handshake.sessionID;

    socket.handshake.session.username = username;
    socket.handshake.session.location = location;
    socket.handshake.session.userId = userId;
    socket.handshake.session.save((err) => {
      if (err) {
        console.error('Error saving session:', err);
      } else {
        console.log('Session saved successfully:', socket.handshake.session);
        users.set(userId, { id: userId, username, location });
        socket.join('lobby');
        updateLobby();
        socket.emit('signin status', { isSignedIn: true, username, location, userId });
      }
    });
  });

  function generateRoomId() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  socket.on('create room', (data) => {
    let roomId;
    do {
        roomId = generateRoomId();
    } while (rooms.has(roomId));
  
    const newRoom = {
        id: roomId,
        name: enforceRoomNameLimit(data.name),
        type: data.type,
        layout: data.layout,
        users: [],
        accessCode: data.type === 'semi-private' ? data.accessCode : null,
    };
    rooms.set(roomId, newRoom);
    console.log(`Room created: ${roomId}, Type: ${data.type}`);
    socket.emit('room created', roomId);
    updateLobby();
    saveRooms();
  });


socket.on('join room', (data) => {
  console.log('Received join room request for:', data);
  if (!data || !data.roomId) {
      console.log('Invalid room join request: missing roomId');
      socket.emit('error', 'Invalid room join request');
      return;
  }

  const room = rooms.get(data.roomId);
  if (room) {
      if (room.type === 'semi-private') {
          if (!data.accessCode) {
              socket.emit('access code required');
              return;
          }
          if (room.accessCode !== data.accessCode) {
              socket.emit('error', 'Incorrect access code');
              return;
          }
      }

      let { username, location, userId } = socket.handshake.session;
      if (!username || !location || !userId) {
          // Auto sign-in for users without a session
          userId = socket.handshake.sessionID;
          username = "Anonymous";
          location = 'On The Web';
          
          socket.handshake.session.username = username;
          socket.handshake.session.location = location;
          socket.handshake.session.userId = userId;
      }
      
      socket.handshake.session.save((err) => {
          if (err) {
              console.error('Error saving session:', err);
              socket.emit('error', 'Failed to join room');
          } else {
              joinRoom(socket, data.roomId, userId);
          }
      });
  } else {
      console.log(`Room ${data.roomId} not found`);
      socket.emit('room not found');
  }
});
 
  socket.on('leave room', async () => {
    const userId = socket.handshake.session.userId;
    await leaveRoom(socket, userId);
  });

  socket.on('rejoin room', (roomId) => {
    const room = rooms.get(roomId);
    if (room) {
        const { username, location, userId } = socket.handshake.session;
        if (username && location && userId) {
            joinRoom(socket, roomId, userId);
        } else {
            socket.emit('signin required');
        }
    } else {
        console.log(`Room ${roomId} not found`);
        socket.emit('room not found');
    }
  });

  socket.on('chat update', (data) => {
    if (socket.roomId) {
      const userId = socket.handshake.session.userId;
      const username = socket.handshake.session.username;
      if (data.diff && data.diff.text) {
        data.diff.text = enforceCharacterLimit(data.diff.text);
      }
      socket.to(socket.roomId).emit('chat update', {
        userId,
        username,
        diff: data.diff
      });
    }
  });

  socket.on('typing', (data) => {
    if (socket.roomId) {
      const userId = socket.handshake.session.userId;
      const username = socket.handshake.session.username;
      handleTyping(socket, userId, username, data.isTyping);
    }
  });

  socket.on('get rooms', () => {
    console.log('User requesting room list');
    socket.emit('initial rooms', Array.from(rooms.values()));
  });

  socket.on('disconnect', async () => {
    const userId = socket.handshake.session.userId;
    console.log(`User disconnected: ${userId}`);
    await leaveRoom(socket, userId);
    users.delete(userId);
  });
});

function joinRoom(socket, roomId, userId) {
  console.log('Joining room:', roomId);
  if (!roomId || typeof roomId !== 'string' || roomId.length !== 6) {
      console.error('Invalid room ID:', roomId);
      socket.emit('room not found');
      return;
  }

  let room = rooms.get(roomId);
  if (!room) {
      console.log(`Room ${roomId} not found when trying to join`);
      socket.emit('room not found');
      return;
  }

  // Initialize users array if it doesn't exist
  if (!room.users) {
      room.users = [];
  }

  // Remove the user from the room if they're already in it
  room.users = room.users.filter(user => user.id !== userId);

  socket.join(roomId);
  room.users.push({
      id: userId,
      username: socket.handshake.session.username,
      location: socket.handshake.session.location,
  });
  socket.roomId = roomId;
  socket.handshake.session.currentRoom = roomId;
  socket.handshake.session.save((err) => {
    if (err) {
        console.error('Error saving session:', err);
    } else {
      io.to(roomId).emit('user joined', {
        id: userId,
        username: socket.handshake.session.username,
        location: socket.handshake.session.location,
        roomName: room.name,
        roomType: room.type
    });
        updateRoom(roomId);
        socket.emit('room joined', { 
          roomId: roomId, 
          userId,
          username: socket.handshake.session.username,
          location: socket.handshake.session.location,
          roomName: room.name, // Make sure to include the room name here
          roomType: room.type,
          users: room.users,
          layout: room.layout
      });
        socket.leave('lobby');
        console.log(`User ${userId} joined room: ${roomId}`);
        updateLobby();

          // Clear any existing deletion timer for this room
          if (roomDeletionTimers.has(roomId)) {
              clearTimeout(roomDeletionTimers.get(roomId));
              roomDeletionTimers.delete(roomId);
              console.log(`Cleared deletion timer for room ${roomId}`);
          }
      }
  });

  // Save rooms after joining
  saveRooms();
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

      if (room.users.length === 0) {
        startRoomDeletionTimer(socket.roomId);
      }
    }
    socket.roomId = null;
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
    socket.join('lobby');
  }
  updateLobby();
  await saveRooms();
}

function startRoomDeletionTimer(roomId) {
  console.log(`Starting deletion timer for room ${roomId}`);
  
  // Clear any existing timer for this room
  if (roomDeletionTimers.has(roomId)) {
    clearTimeout(roomDeletionTimers.get(roomId));
  }

  const timer = setTimeout(() => {
    console.log(`Deleting empty room ${roomId}`);
    rooms.delete(roomId);
    roomDeletionTimers.delete(roomId);
    updateLobby();
    saveRooms();
  }, 15000); // 15 seconds

  roomDeletionTimers.set(roomId, timer);
}


function updateLobby() {
  console.log('Updating lobby');
  const publicRooms = Array.from(rooms.values()).filter(room => room.type !== 'private').map(room => ({
      ...room,
      accessCode: undefined // Remove access code from client-side data
  }));
  io.to('lobby').emit('lobby update', publicRooms);
}

function updateRoom(roomId) {
  const room = rooms.get(roomId);
  if (room) {
      console.log(`Updating room ${roomId}`);
      io.to(roomId).emit('room update', {
          id: room.id,
          name: room.name,
          type: room.type,
          layout: room.layout,
          users: room.users,
          accessCode: undefined // Remove access code from client-side data
      });
  }
}

function handleTyping(socket, userId, username, isTyping) {
  if (typingTimeouts.has(userId)) {
    clearTimeout(typingTimeouts.get(userId));
  }

  if (isTyping) {
    socket.to(socket.roomId).emit('user typing', {
      userId,
      username,
      isTyping: true
    });

    typingTimeouts.set(userId, setTimeout(() => {
      socket.to(socket.roomId).emit('user typing', {
        userId,
        username,
        isTyping: false
      });
      typingTimeouts.delete(userId);
    }, 2000));
  } else {
    socket.to(socket.roomId).emit('user typing', {
      userId,
      username,
      isTyping: false
    });
    typingTimeouts.delete(userId);
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});