/*
    server.js
    =========
    Last updated: 2025
*/

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

const wordFilter = new WordFilter(path.join(__dirname, 'public', 'js', 'offensive_words.json'));

const lastRoomCreationTimes = new Map();
const ROOM_CREATION_COOLDOWN = 30000; // 30 seconds cooldown

const app = express();
const server = http.createServer(app);

function sanitizeInput(input) {
    return input; 
}

const MAX_USERNAME_LENGTH = 12;
const MAX_LOCATION_LENGTH = 12;
const MAX_ROOM_NAME_LENGTH = 20;
const MAX_MESSAGE_LENGTH = 5000;
const MAX_ROOM_CAPACITY = 5;

const ENABLE_WORD_FILTER = true;

const allowedOrigins = [
    'http://localhost:3000', 
    'http://127.0.0.1:3000', 
    'https://open.talkomatic.co/',
];

const corsOptions = {
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) === -1) {
            return callback(new Error('The CORS policy does not allow access from the specified origin.'), false);
        }
        return callback(null, true);
    },
    methods: ['GET', 'POST'],
    credentials: true,
    optionsSuccessStatus: 200,
    allowedHeaders: ['Content-Type', 'Authorization'],
};

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

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
});
app.use(limiter);

const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || '723698977cc31aaf8e84...',
    resave: false,
    saveUninitialized: true,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 14 * 24 * 60 * 60 * 1000 
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

io.use(sharedsession(sessionMiddleware, { autoSave: true }));

app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
            res.setHeader('Cache-Control', 'public, max-age=31536000');
        }
        if (filePath.endsWith('.ttf')) {
            res.setHeader('Content-Type', 'font/ttf');
        }
    }
}));

let rooms = new Map();
const users = new Map();
const roomDeletionTimers = new Map();
const typingTimeouts = new Map();
const userMessageBuffers = new Map();

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

/** 
 *  Helper: Generate random 6-digit room ID 
 */
function generateRoomId() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 *  startRoomDeletionTimer
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
    }, 15000);
    roomDeletionTimers.set(roomId, timer);
}

/** 
 *  updateLobby 
 */
function updateLobby() {
    const publicRooms = Array.from(rooms.values())
        .filter(room => room.type !== 'private')
        .map(room => ({
            ...room,
            accessCode: undefined,
            isFull: room.users.length >= MAX_ROOM_CAPACITY
        }));
    io.to('lobby').emit('lobby update', publicRooms);
}

/** 
 *  updateRoom 
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
            accessCode: undefined
        });
    }
}

/**
 *  getCurrentMessages
 */
function getCurrentMessages(users) {
    const messages = {};
    users.forEach(user => {
        messages[user.id] = userMessageBuffers.get(user.id) || '';
    });
    return messages;
}

/**
 *  leaveRoom
 */
async function leaveRoom(socket, userId) {
    if (socket.roomId) {
        const room = rooms.get(socket.roomId);
        if (room) {
            room.users = room.users.filter(user => user.id !== userId);
            
            // Remove votes from or for this user
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
 *  joinRoom
 */
function joinRoom(socket, roomId, userId) {
    // Basic validation
    if (!roomId || typeof roomId !== 'string' || roomId.length !== 6) {
        socket.emit('room not found');
        return;
    }

    const room = rooms.get(roomId);
    if (!room) {
        socket.emit('room not found');
        return;
    }

    // NEW: Check if user is banned from this room
    if (room.bannedUserIds && room.bannedUserIds.has(userId)) {
        socket.emit('error', 'You have been banned from rejoining this room.');
        return; // Stop here so they can’t rejoin
    }

    if (!room.users) room.users = [];
    if (!room.votes) room.votes = {};

    if (room.users.length >= MAX_ROOM_CAPACITY) {
        socket.emit('room full');
        return;
    }

    // Remove user if they're already in the room
    room.users = room.users.filter(user => user.id !== userId);

    socket.join(roomId);
    room.users.push({
        id: userId,
        username: socket.handshake.session.username,
        location: socket.handshake.session.location,
    });
    socket.roomId = roomId;
    socket.handshake.session.currentRoom = roomId;
    socket.handshake.session.save(() => {
        io.to(roomId).emit('user joined', {
            id: userId,
            username: socket.handshake.session.username,
            location: socket.handshake.session.location,
            roomName: room.name,
            roomType: room.type
        });
        
        updateRoom(roomId);
        updateLobby();

        // Gather current messages
        const currentMessages = getCurrentMessages(room.users);

        socket.emit('room joined', {
            roomId: roomId,
            userId,
            username: socket.handshake.session.username,
            location: socket.handshake.session.location,
            roomName: room.name,
            roomType: room.type,
            users: room.users,
            layout: room.layout,
            votes: room.votes,
            currentMessages: currentMessages
        });
        socket.leave('lobby');

        // Clear room deletion timer if it exists
        if (roomDeletionTimers.has(roomId)) {
            clearTimeout(roomDeletionTimers.get(roomId));
            roomDeletionTimers.delete(roomId);
        }
    });
    saveRooms();
}

/**
 *  handleTyping
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
        }, 2000));
    } else {
        socket.to(socket.roomId).emit('user typing', { userId, username, isTyping: false });
        typingTimeouts.delete(userId);
    }
}

io.on('connection', (socket) => {

    socket.on('check signin status', () => {
        const { username, location, userId } = socket.handshake.session;
        if (username && location && userId) {
            socket.emit('signin status', { isSignedIn: true, username, location, userId });
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
                    socket.emit('signin status', { isSignedIn: true, username, location, userId });
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

            const now = Date.now();
            const lastCreationTime = lastRoomCreationTimes.get(userId) || 0;
            if (now - lastCreationTime < ROOM_CREATION_COOLDOWN) {
                socket.emit('error', 'You are creating rooms too frequently. Please wait a bit.');
                return;
            }

            // Validate user data
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

            // Check offensive words
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
                // NEW: track banned or kicked users
                bannedUserIds: new Set(),
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
                userId = socket.handshake.sessionID;
                username = "Anonymous";
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

    // *****************************
    // IMPORTANT: "vote" event fix
    // *****************************
    socket.on('vote', (data) => {
        try {
            // Validate the incoming data
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

            if (!room.users.find(u => u.id === userId)) return;

            // Users cannot vote for themselves
            if (userId === targetUserId) return;

            // Ensure the room has a votes object
            if (!room.votes) {
                room.votes = {};
            }

            // Remove any previous vote from this user
            room.votes[userId] = targetUserId;

            // Broadcast the updated votes
            io.to(roomId).emit('update votes', room.votes);

            // Check if the target user has the majority
            const votesAgainstTarget = Object.values(room.votes).filter(v => v === targetUserId).length;
            const totalUsers = room.users.length;
            if (votesAgainstTarget > Math.floor(totalUsers / 2)) {
                // Disconnect the target user
                const targetSocket = [...io.sockets.sockets.values()]
                    .find(s => s.handshake.session.userId === targetUserId);
            
                if (targetSocket) {
                    // 1) Let them know they got kicked
                    targetSocket.emit('kicked');
            
                    // 2) NEW: Add them to the bannedUserIds set
                    room.bannedUserIds.add(targetUserId);
            
                    // 3) Actually remove them from the room
                    leaveRoom(targetSocket, targetUserId);
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

            // Basic validation
            if (!data || typeof data !== 'object') {
                socket.emit('error', 'Invalid chat update data.');
                return;
            }
            let diff = data.diff;
            if (!diff) return;

            // Enforce character limit on the incoming text
            if (diff.text) {
                diff.text = enforceCharacterLimit(diff.text);
            }

            switch (diff.type) {
                case 'full-replace':
                    userMessage = diff.text;
                    break;
                case 'add':
                    userMessage = userMessage.slice(0, diff.index) + diff.text + userMessage.slice(diff.index);
                    break;
                case 'delete':
                    userMessage = userMessage.slice(0, diff.index) + userMessage.slice(diff.index + diff.count);
                    break;
                case 'replace':
                    userMessage = userMessage.slice(0, diff.index) + diff.text + userMessage.slice(diff.index + diff.text.length);
                    break;
                default:
                    socket.emit('error', 'Unknown diff type.');
                    return;
            }

            userMessageBuffers.set(userId, userMessage);

            if (ENABLE_WORD_FILTER) {
                const filterResult = wordFilter.checkText(userMessage);
                if (filterResult.hasOffensiveWord) {
                    userMessage = wordFilter.filterText(userMessage);
                    userMessageBuffers.set(userId, userMessage);

                    io.to(socket.roomId).emit('offensive word detected', {
                        userId,
                        filteredMessage: userMessage,
                    });
                } else {
                    socket.to(socket.roomId).emit('chat update', {
                        userId,
                        username,
                        diff: diff,
                    });
                }
            } else {
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
                // If the data is invalid, just ignore or optionally emit an error
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
