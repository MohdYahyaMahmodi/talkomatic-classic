const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const session = require('express-session');
const sharedsession = require("express-socket.io-session");

const app = express();
const server = http.createServer(app);

// Set up session middleware
const sessionMiddleware = session({
  secret: 'your_session_secret',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // Set to true if using HTTPS
});

app.use(sessionMiddleware);

const io = socketIo(server);

// Share session middleware with socket.io
io.use(sharedsession(sessionMiddleware, {
  autoSave: true
}));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Store rooms and users
const rooms = new Map();
const users = new Map();

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
    socket.username = data.username;
    socket.location = data.location || 'Earth';
    users.set(userId, { id: userId, username: socket.username, location: socket.location });
    socket.join('lobby');
    console.log(`User ${userId} joined lobby`);
    updateLobby();
  });

  // Create room
  socket.on('create room', (data) => {
    console.log(`User ${userId} creating room: ${JSON.stringify(data)}`);
    const roomId = generateRoomId();
    rooms.set(roomId, {
      id: roomId,
      name: data.name,
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
      socket.emit('error', 'Room not found');
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
      socket.emit('error', 'Room not found');
    }
  });

  // Leave room
  socket.on('leave room', () => {
    console.log(`User ${userId} leaving room`);
    leaveRoom(socket, userId);
  });

  // Handle chat message
  socket.on('chat message', (message) => {
    if (socket.roomId) {
      console.log(`Chat message in room ${socket.roomId} from user ${userId}: ${message}`);
      io.to(socket.roomId).emit('chat message', {
        userId: userId,
        username: socket.username,
        message,
      });
    }
  });

  // Handle typing
  socket.on('typing', (data) => {
    if (socket.roomId) {
      console.log(`User ${userId} typing status in room ${socket.roomId}: ${data.isTyping}`);
      socket.to(socket.roomId).emit('user typing', {
        userId: userId,
        username: socket.username,
        isTyping: data.isTyping,
      });
    }
  });

  // Get rooms
  socket.on('get rooms', () => {
    console.log(`User ${userId} requesting room list`);
    socket.emit('initial rooms', Array.from(rooms.values()));
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${userId}`);
    leaveRoom(socket, userId);
    users.delete(userId);
  });
});

function joinRoom(socket, room, userId) {
  socket.join(room.id);
  room.users = room.users.filter(user => user.id !== userId);
  room.users.push({
    id: userId,
    username: socket.username,
    location: socket.location,
  });
  socket.roomId = room.id;
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
    users: room.users
  });
  socket.leave('lobby');
  console.log(`User ${userId} joined room: ${room.id}`);
  updateLobby();
}

function leaveRoom(socket, userId) {
  if (socket.roomId) {
    console.log(`User ${userId} leaving room ${socket.roomId}`);
    const room = rooms.get(socket.roomId);
    if (room) {
      room.users = room.users.filter(user => user.id !== userId);
      socket.leave(socket.roomId);
      io.to(socket.roomId).emit('user left', userId);
      updateRoom(socket.roomId);
    }
    socket.roomId = null;
    socket.join('lobby');
  }
  updateLobby();
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