/*
    server.js
    =========

    This file sets up the Talkomatic server using Express.js, socket.io for real-time communication,
    and other security and session management middlewares like helmet, rate limiting, and cookie parsing.

    Key Features:
    - Serves static files and manages CORS settings.
    - Supports real-time chatroom functionality with socket.io.
    - Implements secure session handling, XSS protection, and input sanitization.
    - Provides mechanisms for creating, joining, and managing chatrooms, including semi-private rooms with access codes.
    - Manages user sessions, room deletion after a certain time, and typing indicators.
    
    Last updated: 2024
*/

// Import required modules
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

// Initialize Express and HTTP server
const app = express();
const server = http.createServer(app);

/* 
    Input sanitization function 
    ===========================
    This function is intended for basic input handling; currently, it returns input as is. 
    It's a placeholder for any future input sanitization logic.
*/
function sanitizeInput(input) {
    return input; // Return input without modifications
}

// Constants to manage application limits
const MAX_USERNAME_LENGTH = 12;
const MAX_LOCATION_LENGTH = 12;
const MAX_ROOM_NAME_LENGTH = 20;
const MAX_MESSAGE_LENGTH = 5000;
const MAX_ROOM_CAPACITY = 5;

const ENABLE_WORD_FILTER = true; // Set to false to disable word filtering

// Define allowed origins for CORS policy
const allowedOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000', 'https://open.talkomatic.co/'];

// CORS options
const corsOptions = {
    origin: function (origin, callback) {
        if (!origin) return callback(null, true); // Allow if no origin is present (e.g., same-origin requests)
        if (allowedOrigins.indexOf(origin) === -1) {
            return callback(new Error('The CORS policy does not allow access from the specified origin.'), false);
        }
        return callback(null, true); // Allow origin
    },
    methods: ['GET', 'POST'],
    credentials: true,
    optionsSuccessStatus: 200,
    allowedHeaders: ['Content-Type', 'Authorization'],
};

// Apply middleware for security, CORS, session handling, etc.
app.use(cors(corsOptions));  // Enable CORS with the specified options
app.use(cookieParser()); // Parse cookies

/*
    Generate a random nonce for Content Security Policy (CSP) 
    ========================================================
    This middleware creates a unique 'nonce' for each request, ensuring that only inline scripts
    with this nonce are allowed to run on the page.
*/
app.use((req, res, next) => {
    res.locals.nonce = crypto.randomBytes(16).toString('base64');
    next();
});

// Apply helmet security headers and set CSP policies
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            ...helmet.contentSecurityPolicy.getDefaultDirectives(),
            "script-src": ["'self'", (req, res) => `'nonce-${res.locals.nonce}'`],
            "style-src": ["'self'", "'unsafe-inline'"],
        },
    },
}));

app.use(xss()); // Prevent cross-site scripting (XSS)
app.use(hpp()); // Protect against HTTP Parameter Pollution

/*
    Apply rate limiting to mitigate DoS attacks 
    ===========================================
    Limits each client to 1000 requests per 15 minutes.
*/
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000,  // Limit each IP to 1000 requests per windowMs
});
app.use(limiter);

// Session setup for Express and socket.io
const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || '723698977cc31aaf8e84d93feffadcf72d65bfe0e56d58ba2cbdb88d74809745', // Fallback to default if no environment variable
    resave: false,
    saveUninitialized: true,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',  // Use secure cookies in production
        httpOnly: true,  // Prevent access to cookie via JavaScript
        maxAge: 14 * 24 * 60 * 60 * 1000 // 14 days expiry
    }
});

app.use(sessionMiddleware); // Use the session middleware

// Initialize socket.io with shared session support
const io = socketIo(server, {
    cors: {
        origin: allowedOrigins,  // Define allowed origins
        methods: ["GET", "POST"], // Allowed methods
        credentials: true  // Include cookies
    }
});

// Share session middleware with socket.io to sync Express and socket.io sessions
io.use(sharedsession(sessionMiddleware, {
    autoSave: true  // Automatically save the session with socket.io
}));

// Serve static files with specific headers for JavaScript and fonts
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, path) => {
        if (path.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
            res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache JS files for 1 year
        }
        if (path.endsWith('.ttf')) {
            res.setHeader('Content-Type', 'font/ttf');
        }
    }
}));

/* 
    Global variables for room and user management 
    =============================================
    - `rooms`: A Map to store active rooms.
    - `users`: A Map to store active users.
    - `roomDeletionTimers`: A Map to store timers for deleting inactive rooms.
    - `typingTimeouts`: A Map to manage user typing timeouts.
*/
let rooms = new Map();
const users = new Map();
const roomDeletionTimers = new Map();
const typingTimeouts = new Map();

const userMessageBuffers = new Map();

// Helper functions to enforce character limits for different fields
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

/* 
    Room persistence functions 
    ==========================
    - `saveRooms()`: Saves the current state of rooms to a file.
    - `loadRooms()`: Loads the state of rooms from a file at server startup.
*/
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
        rooms.clear();  // Ensures that all rooms are cleared after a restart
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error('Error loading rooms:', error);
        }
    }
}

// Call `loadRooms()` to load the rooms when the server starts
loadRooms();

/*
    Socket.io event handlers
    ========================
    These handlers manage the real-time communication with the clients.
*/
io.on('connection', (socket) => {

    // Check if a user is signed in and set the session accordingly
    socket.on('check signin status', () => {
        const { username, location, userId } = socket.handshake.session;
        if (username && location && userId) {
            socket.emit('signin status', { isSignedIn: true, username, location, userId });
            socket.join('lobby'); // Add user to the 'lobby'
            users.set(userId, { id: userId, username, location }); // Add user to active users
            updateLobby(); // Update the lobby for all users
        } else {
            socket.emit('signin status', { isSignedIn: false });
        }
    });

    // Handle user joining the lobby
    socket.on('join lobby', (data) => {
        const username = enforceUsernameLimit(data.username);
        const location = enforceLocationLimit(data.location || 'On The Web');
        const userId = socket.handshake.sessionID;  // Use session ID as user ID

        socket.handshake.session.username = username;
        socket.handshake.session.location = location;
        socket.handshake.session.userId = userId;

        socket.handshake.session.save((err) => {
            if (!err) {
                users.set(userId, { id: userId, username, location });  // Add user to active users list
                socket.join('lobby');  // Join the lobby room
                updateLobby();  // Update lobby view for all users
                socket.emit('signin status', { isSignedIn: true, username, location, userId });
            }
        });
    });

    // Helper function to generate a random 6-digit room ID
    function generateRoomId() {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    // Handle room creation
    socket.on('create room', (data) => {
        let roomId;
        do {
            roomId = generateRoomId();  // Generate a unique room ID
        } while (rooms.has(roomId));  // Ensure the room ID is unique

        const newRoom = {
            id: roomId,
            name: enforceRoomNameLimit(data.name),  // Enforce room name length limit
            type: data.type,
            layout: data.layout,
            users: [],
            accessCode: data.type === 'semi-private' ? data.accessCode : null,  // Set access code for semi-private rooms
        };
        rooms.set(roomId, newRoom);  // Add new room to the rooms map
        socket.emit('room created', roomId);  // Notify the user that the room was created
        updateLobby();  // Update the lobby
        saveRooms();  // Save the rooms to persistent storage
    });

    // Handle a user joining a room
    socket.on('join room', (data) => {
        if (!data || !data.roomId) {
            socket.emit('error', 'Invalid room join request');  // Emit an error if no roomId is provided
            return;
        }

        const room = rooms.get(data.roomId);  // Fetch the room details
        if (room) {
            if (room.type === 'semi-private') {
                // Check for access code if the room is semi-private
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
                // Automatically assign session details if not already present
                userId = socket.handshake.sessionID;
                username = "Anonymous";
                location = 'On The Web';

                socket.handshake.session.username = username;
                socket.handshake.session.location = location;
                socket.handshake.session.userId = userId;
            }

            socket.handshake.session.save((err) => {
                if (!err) {
                    joinRoom(socket, data.roomId, userId);  // Proceed to join the room
                }
            });
        } else {
            socket.emit('room not found');  // Emit error if room is not found
        }
    });

    socket.on('vote', (data) => {
        const { targetUserId } = data;
        const userId = socket.handshake.session.userId;
        const roomId = socket.roomId;
    
        if (!roomId) return;
    
        const room = rooms.get(roomId);
        if (!room) return;
    
        // Ensure the user is in the room
        if (!room.users.find(u => u.id === userId)) return;
    
        // Users cannot vote for themselves
        if (userId === targetUserId) return;
    
        // Remove any previous vote from this user
        room.votes[userId] = targetUserId;
    
        // Broadcast the updated votes to all clients in the room
        io.to(roomId).emit('update votes', room.votes);
    
        // Check if the target user has majority votes
        const votesAgainstTarget = Object.values(room.votes).filter(v => v === targetUserId).length;
        const totalUsers = room.users.length;
    
        // Majority calculation: More than half of the other users
        if (votesAgainstTarget > Math.floor(totalUsers / 2)) {
            // Disconnect the target user
            const targetSocket = [...io.sockets.sockets.values()].find(s => s.handshake.session.userId === targetUserId);
    
            if (targetSocket) {
                targetSocket.emit('kicked');
                leaveRoom(targetSocket, targetUserId);
            }
        }
    });

    // Handle a user leaving the room
    socket.on('leave room', async () => {
        const userId = socket.handshake.session.userId;
        await leaveRoom(socket, userId);
    });

    // Chat update handler for diff-based text changes
    socket.on('chat update', (data) => {
        if (socket.roomId) {
            const userId = socket.handshake.session.userId;
            const username = socket.handshake.session.username;
    
            // Initialize user's message buffer if not present
            if (!userMessageBuffers.has(userId)) {
                userMessageBuffers.set(userId, '');
            }
    
            let userMessage = userMessageBuffers.get(userId);
            let diff = data.diff;
    
            if (diff) {
                // Enforce character limits
                if (diff.text) {
                    diff.text = enforceCharacterLimit(diff.text);
                }
    
                // Apply the diff to the user's message buffer
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
                }
    
                // Update the message buffer
                userMessageBuffers.set(userId, userMessage);
    
                if (ENABLE_WORD_FILTER) {
                    // Check for offensive words
                    const filterResult = wordFilter.checkText(userMessage);
    
                    if (filterResult.hasOffensiveWord) {
                        // Offensive word detected
                        // Remove offensive word from the user's message buffer
                        userMessage = wordFilter.filterText(userMessage);
                        userMessageBuffers.set(userId, userMessage);
    
                        // Notify all clients to update the user's message
                        io.to(socket.roomId).emit('offensive word detected', {
                            userId,
                            filteredMessage: userMessage,
                        });
                    } else {
                        // No offensive words, broadcast the diff as usual
                        socket.to(socket.roomId).emit('chat update', {
                            userId,
                            username,
                            diff: diff,
                        });
                    }
                } else {
                    // Word filter is disabled, broadcast the diff as usual
                    socket.to(socket.roomId).emit('chat update', {
                        userId,
                        username,
                        diff: diff,
                    });
                }
            }
        }
    });

    // Handle typing events (user typing indicators)
    socket.on('typing', (data) => {
        if (socket.roomId) {
            const userId = socket.handshake.session.userId;
            const username = socket.handshake.session.username;
            handleTyping(socket, userId, username, data.isTyping);
        }
    });

    // Provide room list to the client
    socket.on('get rooms', () => {
        socket.emit('initial rooms', Array.from(rooms.values()));
    });

    // Handle disconnection
    socket.on('disconnect', async () => {
        const userId = socket.handshake.session.userId;
        await leaveRoom(socket, userId);

        // **Clean up user's message buffer**
        userMessageBuffers.delete(userId);

        users.delete(userId);
    });
});

/*
    joinRoom
    ========
    Handles the logic for joining a room, including ensuring room capacity, updating session information,
    and emitting necessary events to the client.
*/
function joinRoom(socket, roomId, userId) {
    if (!roomId || typeof roomId !== 'string' || roomId.length !== 6) {
        socket.emit('room not found');
        return;
    }

    let room = rooms.get(roomId);
    if (!room) {
        socket.emit('room not found');
        return;
    }

    // Check if the room has reached its capacity
    if (room.users && room.users.length >= MAX_ROOM_CAPACITY) {
        socket.emit('room full');
        return;
    }

    // Initialize users array if it doesn't exist
    if (!room.users) {
        room.users = [];
    }

    if (!room.votes) {
        room.votes = {};
    }

    // Remove the user from the room if they're already in it
    room.users = room.users.filter(user => user.id !== userId);

    socket.join(roomId);  // Join the room
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

        updateRoom(roomId);  // Update the room with new user data

        // Get current messages for all users in the room
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
        socket.leave('lobby');  // Leave the lobby once the user has joined the room

        // Clear room deletion timer if the room is now active
        if (roomDeletionTimers.has(roomId)) {
            clearTimeout(roomDeletionTimers.get(roomId));
            roomDeletionTimers.delete(roomId);
        }
    });

    // Save rooms after user joins
    saveRooms();
}

function getCurrentMessages(users) {
    const messages = {};
    users.forEach(user => {
        messages[user.id] = userMessageBuffers.get(user.id) || '';
    });
    return messages;
}

/*
    leaveRoom
    =========
    Handles the logic for a user leaving a room, including emitting 'user left' events
    and starting the room deletion timer if necessary.
*/
async function leaveRoom(socket, userId) {
    if (socket.roomId) {
        const room = rooms.get(socket.roomId);
        if (room) {
            // Remove the user from the room
            room.users = room.users.filter(user => user.id !== userId);

            // Remove votes cast by the user
            delete room.votes[userId];

            // Remove votes against the user
            for (let voterId in room.votes) {
                if (room.votes[voterId] === userId) {
                    delete room.votes[voterId];
                }
            }

            // Notify others of updated votes
            io.to(socket.roomId).emit('update votes', room.votes);
            socket.leave(socket.roomId);
            io.to(socket.roomId).emit('user left', userId);  // Notify others that the user has left
            updateRoom(socket.roomId);  // Update the room

            if (room.users.length === 0) {
                startRoomDeletionTimer(socket.roomId);  // Start deletion timer if no users remain
            }
        }
        socket.roomId = null;
        socket.handshake.session.currentRoom = null;
        await new Promise((resolve) => {
            socket.handshake.session.save(resolve);  // Save the session changes
        });
        socket.join('lobby');  // Rejoin the lobby
    }
    updateLobby();  // Update the lobby for all users
    await saveRooms();  // Save the room data
}

/*
    startRoomDeletionTimer
    ======================
    Starts a timer to delete a room after 15 seconds of inactivity (when no users are in the room).
*/
function startRoomDeletionTimer(roomId) {
    if (roomDeletionTimers.has(roomId)) {
        clearTimeout(roomDeletionTimers.get(roomId));  // Clear any existing timer
    }

    const timer = setTimeout(() => {
        rooms.delete(roomId);  // Delete the room
        roomDeletionTimers.delete(roomId);
        updateLobby();  // Update the lobby
        saveRooms();  // Save updated room data
    }, 15000);  // 15 seconds

    roomDeletionTimers.set(roomId, timer);  // Set the timer in the map
}

/*
    updateLobby
    ===========
    Updates the lobby by emitting the current list of public rooms to all users in the lobby.
*/
function updateLobby() {
    const publicRooms = Array.from(rooms.values())
        .filter(room => room.type !== 'private')
        .map(room => ({
            ...room,
            accessCode: undefined,  // Don't expose access codes to clients
            isFull: room.users.length >= MAX_ROOM_CAPACITY
        }));
    io.to('lobby').emit('lobby update', publicRooms);
}

/*
    updateRoom
    ==========
    Updates the room's state and sends the updated room information to all users in the room.
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
            votes: room.votes, // Include votes
            accessCode: undefined  // Remove access code from client-side data
        });
    }
}

/*
    handleTyping
    ============
    Handles the typing indicator for a user, notifying others in the room when a user is typing
    and stopping the indicator after a 2-second timeout.
*/
function handleTyping(socket, userId, username, isTyping) {
    if (typingTimeouts.has(userId)) {
        clearTimeout(typingTimeouts.get(userId));  // Clear any existing typing timeout
    }

    if (isTyping) {
        socket.to(socket.roomId).emit('user typing', { userId, username, isTyping: true });
        typingTimeouts.set(userId, setTimeout(() => {
            socket.to(socket.roomId).emit('user typing', { userId, username, isTyping: false });
            typingTimeouts.delete(userId);
        }, 2000));  // Stop typing indicator after 2 seconds
    } else {
        socket.to(socket.roomId).emit('user typing', { userId, username, isTyping: false });
        typingTimeouts.delete(userId);  // Remove timeout once typing stops
    }
}

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    // Server is running on the specified port
});
