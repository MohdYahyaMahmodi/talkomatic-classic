# Talkomatic Classic - Server Documentation

## Table of Contents

- [Introduction](#introduction)
- [Server Architecture](#server-architecture)
- [Key Features](#key-features)
- [Rate Limiting System](#rate-limiting-system)
- [Room Management](#room-management)
- [User Experience Features](#user-experience-features)
- [Bot Development Guide](#bot-development-guide)
- [Installation and Setup](#installation-and-setup)
- [Security Features](#security-features)
- [Performance Optimizations](#performance-optimizations)

## Introduction

Talkomatic Classic is an open-source real-time chat platform that revives the original 1973 PLATO system chatroom experience. The unique feature of Talkomatic is that users can see messages appear letter-by-letter as they are being typed, allowing for a more immediate and interactive conversation experience.

Key characteristics:

- Each participant has their own section of the screen
- Messages appear in real-time as they're typed
- Up to five users per room
- Three room types: public, semi-private (with access code), and private
- No registration required
- Modern implementation of a classic interface

## Server Architecture

The server is built on Node.js using Express for HTTP endpoints and Socket.IO for real-time communication. It employs an event-driven architecture with several core components:

### Core Components

1. **Express Server** - Handles HTTP requests, serves static files, and provides API endpoints
2. **Socket.IO Server** - Manages WebSocket connections for real-time updates
3. **Room Management System** - Handles creation, joining, and administration of chat rooms
4. **Message Processing System** - Processes and relays real-time typing updates
5. **Rate Limiting System** - Ensures system stability and fair resource allocation
6. **Security Layer** - Implements protections against abuse and attacks

## Key Features

### Real-time Letter-by-Letter Chat

Talkomatic's signature feature is showing messages as they are typed, character by character. This is implemented through a differential update system:

```javascript
// Examples of different diff types
// 1. Full replace - completely replace current message
{
  type: 'full-replace',
  text: 'Hello, world!'
}

// 2. Add - insert text at a specific position
{
  type: 'add',
  index: 7,
  text: 'beautiful '
}

// 3. Delete - remove text at a specific position
{
  type: 'delete',
  index: 7,
  count: 5
}

// 4. Replace - replace text at a specific position
{
  type: 'replace',
  index: 0,
  text: 'Greetings'
}
```

To optimize performance, multiple updates are batched and processed at intervals:

```javascript
// Batch processing occurs every 20ms (50 times per second)
CONFIG.TIMING.BATCH_PROCESSING_INTERVAL = 20;
```

## Rate Limiting System

The server implements multiple rate limiting mechanisms to ensure stability and fair resource allocation.

### 1. Chat Update Rate Limiter

Controls the frequency of message updates:

```javascript
const chatUpdateLimiter = new RateLimiterMemory({
  points: CONFIG.LIMITS.CHAT_UPDATE_RATE_LIMIT, // 300 points
  duration: 5, // 5 second window
  blockDuration: 2, // Block for 2 seconds if exceeded
});
```

- **Maximum throughput**: 60 operations per second (300 ÷ 5)
- **Recommended usage**: Stay below 40 updates per second
- **Batching**: Updates are collected and processed every 20ms
- **Point consumption**: Based on batch size:
  ```javascript
  const pointsToConsume = Math.min(
    1 + Math.floor(pendingData.diffs.length / 10),
    2
  );
  ```

### 2. Socket Operation Rate Limiter

Limits general socket operations:

```javascript
const socketRateLimiter = new RateLimiterMemory({
  points: CONFIG.LIMITS.SOCKET_MAX_REQUESTS_PER_WINDOW, // 50 points
  duration: CONFIG.LIMITS.SOCKET_MAX_REQUESTS_WINDOW, // 1 second window
  blockDuration: 5, // Block for 5 seconds if exceeded
});
```

- **Maximum throughput**: 50 operations per second
- **Exempt operations**: `["error", "connect", "disconnect", "disconnecting", "typing", "get rooms", "get room state"]`
- **Recommended usage**: Stay below 30 operations per second

### 3. Typing Notification Rate Limiter

Controls typing indicator events:

```javascript
const typingLimiter = new RateLimiterMemory({
  points: CONFIG.LIMITS.TYPING_RATE_LIMIT, // 60 points
  duration: 1, // 1 second window
});
```

- **Maximum throughput**: 60 typing events per second
- **Behavior when exceeded**: Events are silently dropped

### 4. IP-Based Connection Rate Limiter

Prevents connection flooding:

```javascript
const ipRateLimiter = new RateLimiterMemory({
  points: 20,
  duration: 15,
  blockDuration: 30,
});
```

- **New connections**: Maximum 20 new connections per 15 seconds
- **Total connections**: Maximum 30 simultaneous connections per IP
- **Block duration**: 30 seconds when exceeded

### 5. HTTP API Rate Limiter

Limits requests to HTTP API endpoints:

```javascript
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 2000, // 2000 requests per window
});
```

- **Maximum throughput**: ~2.2 requests per second

### Adaptive Rate Limiting

When approaching rate limits, the system:

1. Reduces batch sizes from 50 to 10 updates
2. Sends warning notifications for significant rate limit events
3. Implements graduated throttling rather than immediate blocking

### Circuit Breaker Pattern

A circuit breaker protects against system overload:

```javascript
const chatCircuitState = {
  failures: 0,
  lastFailure: 0,
  isOpen: false,
  threshold: 50,
  resetTimeout: 15000,
};
```

- Opens after 50 consecutive failures
- Resets after 15 seconds
- Prevents system degradation during high load

## Room Management

### Room Types

- **Public**: Visible to all users, no access restrictions
- **Semi-Private**: Visible in the lobby but requires a 6-digit access code
- **Private**: Not visible in the lobby, join by direct link/code

### Room Creation

```javascript
// Create a new room
socket.emit("create room", {
  name: "My Chat Room", // Room name
  type: "public", // 'public', 'semi-private', or 'private'
  layout: "horizontal", // 'horizontal' or 'vertical'
  accessCode: "123456", // Required for semi-private rooms
});
```

### Room Joining

```javascript
// Join an existing room
socket.emit("join room", {
  roomId: "123456", // 6-digit room ID
  accessCode: "123456", // Required for semi-private rooms
});
```

### Room Lifecycle

- Rooms are created with a unique 6-digit ID
- Empty rooms are automatically deleted after inactivity (default: 30 seconds)
- Users can be voted out of a room (majority vote)
- Configuration limits rooms to 5 concurrent users per room

## User Experience Features

### AFK Detection

The server monitors user activity and manages AFK (Away From Keyboard) status:

```javascript
CONFIG.LIMITS.MAX_AFK_TIME = 180000; // 3 minutes until AFK timeout
CONFIG.TIMING.AFK_WARNING_TIME = 150000; // 2.5 minutes - warn before kick
```

- Users inactive for 2.5 minutes receive a warning
- After 3 minutes of inactivity, users are returned to the lobby
- Any user activity (typing, sending messages) resets the AFK timer

### Typing Indicators

```javascript
socket.emit("typing", { isTyping: true }); // Start typing indicator
socket.emit("typing", { isTyping: false }); // Stop typing indicator
```

- Typing indicators automatically expire after 2 seconds of inactivity
- Rate limited to 60 events per second globally

## Bot Development Guide

### Connection and Authentication

```javascript
const io = require("socket.io-client");
const socket = io("https://classic.talkomatic.co", {
  transports: ["websocket"],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
});

// Sign in to the system
socket.emit("join lobby", {
  username: "MyBot",
  location: "Bot Server",
});

socket.on("signin status", (data) => {
  if (data.isSignedIn) {
    console.log(`Signed in as ${data.username} with ID ${data.userId}`);
  }
});
```

### Optimal Update Rate Implementation

For bots that display information (time, status, data):

```javascript
// Update at 10 fps (well within rate limits)
const UPDATE_INTERVAL = 100; // milliseconds
let lastMessage = "";

setInterval(() => {
  const timeString = new Date().toLocaleTimeString();

  // Only send if content changed (optimization)
  if (timeString !== lastMessage) {
    lastMessage = timeString;

    // Use full-replace instead of character-by-character updates
    socket.emit("chat update", {
      diff: {
        type: "full-replace",
        text: `Current time: ${timeString}`,
      },
    });
  }
}, UPDATE_INTERVAL);
```

### Recommended Update Rates

| Operation Type    | Maximum Rate | Recommended Rate | Notes                            |
| ----------------- | ------------ | ---------------- | -------------------------------- |
| Chat Updates      | 60/second    | 10-20/second     | Use batch updates                |
| Socket Operations | 50/second    | 25/second        | Cache when possible              |
| Typing Events     | 60/second    | 5/second         | Limit frequency                  |
| API Calls         | 2.2/second   | 1/second         | Use for non-real-time operations |

### Client-Side Rate Limiting

Implement your own rate limiting to avoid server-side rejections:

```javascript
const UPDATE_INTERVAL = 100; // Min ms between updates
let lastUpdateTime = 0;
let updateQueue = [];

function sendUpdate(content) {
  const now = Date.now();
  if (now - lastUpdateTime < UPDATE_INTERVAL) {
    // Queue the update for later
    updateQueue.push(content);
    if (updateQueue.length === 1) {
      setTimeout(processQueue, UPDATE_INTERVAL - (now - lastUpdateTime));
    }
    return;
  }

  lastUpdateTime = now;
  socket.emit("chat update", { diff: content });
}

function processQueue() {
  if (updateQueue.length === 0) return;

  // Send the next update
  const content = updateQueue.shift();
  lastUpdateTime = Date.now();
  socket.emit("chat update", { diff: content });

  // Schedule next update if queue isn't empty
  if (updateQueue.length > 0) {
    setTimeout(processQueue, UPDATE_INTERVAL);
  }
}
```

### Error Handling

Listen for rate limit warnings and errors:

```javascript
// Track current update interval
let currentUpdateInterval = 100;

socket.on("error", (error) => {
  if (error.error && error.error.code === "RATE_LIMITED") {
    // Implement exponential backoff
    currentUpdateInterval *= 1.5;
    console.warn(`Rate limited. New interval: ${currentUpdateInterval}ms`);
    setTimeout(() => {
      // Gradually return to normal after some time
      currentUpdateInterval = Math.max(100, currentUpdateInterval * 0.9);
    }, 10000);
  }
});

socket.on("message", (message) => {
  if (message.type === "warning" && message.text.includes("Slow down")) {
    // Reduce frequency preemptively
    currentUpdateInterval *= 1.2;
  }
});
```

### Handling AFK Warnings

Bots should listen for and respond to AFK warnings to prevent being kicked:

```javascript
socket.on("afk warning", (data) => {
  console.log(
    `AFK Warning: ${data.message}, ${data.secondsRemaining}s remaining`
  );

  // Send a response to show the bot is still active
  socket.emit("afk response", { active: true });

  // Also send some activity to reset the timer
  socket.emit("typing", { isTyping: true });
  setTimeout(() => {
    socket.emit("typing", { isTyping: false });
  }, 500);
});

socket.on("afk timeout", (data) => {
  console.log(`AFK Timeout: ${data.message}`);
  // Handle reconnection if needed
});
```

### Best Practices for Bots

1. **Use full-replace updates** instead of character-by-character changes
2. **Implement adaptive rates** based on system feedback
3. **Batch multiple small changes** into single updates
4. **Maintain persistent connections** rather than reconnecting frequently
5. **Target 10-15 fps** for real-time display bots (plenty below the 60/sec limit)
6. **Implement client-side rate limiting** before server-side limits are reached
7. **Handle AFK warnings** to prevent automatic disconnection
8. **Cache room and user data** to reduce unnecessary requests
9. **Use exponential backoff** when encountering rate limits
10. **Monitor connectivity** and implement graceful reconnection

## Installation and Setup

### Requirements

- Node.js 14.x or higher
- NPM 6.x or higher

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/talkomatic-classic.git

# Navigate to the project directory
cd talkomatic-classic

# Install dependencies
npm install

# Start the server
npm start
```

### Environment Variables

Create a `.env` file in the root directory with the following variables:

```
PORT=3000
NODE_ENV=development
SESSION_SECRET=your_session_secret
CLOUDFLARE_ENABLED=false
TALKOMATIC_API_KEY=your_api_key
```

## Security Features

The server implements several security measures:

1. **Helmet.js Integration** - Configures secure HTTP headers
2. **Content Security Policy** - Restricts resource loading to trusted sources
3. **Rate Limiting** - Prevents abuse and DoS attacks
4. **Input Validation** - Sanitizes all user inputs
5. **Word Filtering** - Optional filtering of offensive content
6. **XSS Protection** - Prevents cross-site scripting attacks
7. **Session Security** - Secure cookies and session management
8. **Circuit Breaker Pattern** - Prevents cascading failures under high load

## Performance Optimizations

The server includes several optimizations for performance:

1. **Message Batching** - Processes multiple updates in batches
2. **Caching** - Uses in-memory caches for frequently accessed data
3. **Debounced Saving** - Coalesces multiple save operations
4. **Staggered Cleanup** - Distributes cleanup tasks to minimize impact
5. **Early Exit Strategies** - Avoids unnecessary processing
6. **Memory Monitoring** - Tracks and manages memory usage
7. **Optimized Socket.IO Configuration** - Tuned for WebSocket performance

### Memory Management

The server actively monitors memory usage:

```javascript
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

        // Truncate large messages
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
      }
    }
  } catch (err) {
    console.error("Error in server monitor:", err);
  }
}, 120000); // Every 2 minutes
```

---

This documentation is intended to provide a comprehensive overview of the Talkomatic Classic server implementation. For more detailed information or to contribute to the project, please visit [https://github.com/mohdyahyamahmodi/talkomatic-classic](https://github.com/mohdyahyamahmodi/talkomatic-classic).
