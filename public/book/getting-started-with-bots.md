# Talkomatic Bot Developer Guide

Everything you need to build, authenticate, and run a bot on Talkomatic.

---

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Step 1: Request a Bot Token](#step-1-request-a-bot-token)
- [Step 2: Connect via Socket.IO](#step-2-connect-via-socketio)
- [Step 3: Sign In (Join the Lobby)](#step-3-sign-in-join-the-lobby)
- [Step 4: List, Create, or Join Rooms](#step-4-list-create-or-join-rooms)
- [Step 5: Send and Receive Messages](#step-5-send-and-receive-messages)
- [Step 6: Stay Alive (AFK System)](#step-6-stay-alive-afk-system)
- [Step 7: Leave a Room](#step-7-leave-a-room)
- [Socket.IO Events Reference](#socketio-events-reference)
- [Rate Limits and Constraints](#rate-limits-and-constraints)
- [Error Handling](#error-handling)
- [Best Practices](#best-practices)

---

## Overview

Talkomatic bots connect through **Socket.IO** and interact in real time just like human users. The server distinguishes bots from browsers using header analysis. Non-browser clients **must** authenticate with a **bot token** before the Socket.IO connection is accepted.

**How it works at a high level:**

1. Your bot requests a token from the REST API.
2. Your bot opens a Socket.IO connection, passing the token.
3. The server validates the token and grants access.
4. Your bot signs in, joins rooms, and sends/receives messages via Socket.IO events.

> **Important:** Bots use Socket.IO for all real-time operations (joining rooms, chatting, etc.). The REST API is only used for requesting/checking your bot token.

---

## Prerequisites

**Node.js bots:**

```bash
npm install socket.io-client
```

**Python bots:**

```bash
pip install python-socketio[client] requests
```

You also need:

- A terminal or script that can make HTTP POST requests (curl, fetch, requests, etc.)
- The server URL: `https://classic.talkomatic.co`

---

## Step 1: Request a Bot Token

Before connecting via Socket.IO, you need a bot token. Tokens are requested via the REST API.

**Endpoint:** `POST https://classic.talkomatic.co/api/v1/bot-tokens/request`

**Rules:**

- The request **must not** come from a web browser. The server checks request headers (`User-Agent`, `Accept`, `Accept-Language`, `Accept-Encoding`) and rejects requests that look like a browser. Standard curl, Node.js `fetch`, or Python `requests` all work fine.
- Rate limit: **3 token requests per hour** per IP.
- Maximum **3 active tokens per IP** at any time.
- Tokens expire after **30 days**.

### Using curl

```bash
curl -X POST https://classic.talkomatic.co/api/v1/bot-tokens/request
```

**Response:**

```json
{
  "token": "tk_f581c57545280753093b4e61a4c4dc9903bee373c06c7a7a4e3d4debe82304e3",
  "expiresIn": 2592000000,
  "expiresAt": "2026-04-16T07:23:15.115Z",
  "usage": {
    "rateLimit": "500 req/min",
    "headers": "Authorization: Bearer {token}"
  }
}
```

### Using Node.js

```javascript
async function requestToken() {
  const res = await fetch(
    "https://classic.talkomatic.co/api/v1/bot-tokens/request",
    {
      method: "POST",
    },
  );
  if (!res.ok) throw new Error(`Token request failed: ${res.status}`);
  const data = await res.json();
  console.log("Token:", data.token);
  console.log("Expires:", data.expiresAt);
  return data.token;
}
```

### Using Python

```python
import requests

def request_token():
    res = requests.post('https://classic.talkomatic.co/api/v1/bot-tokens/request')
    res.raise_for_status()
    data = res.json()
    print(f"Token: {data['token']}")
    print(f"Expires: {data['expiresAt']}")
    return data['token']
```

### Checking Token Info

You can verify a token is still valid:

```
GET https://classic.talkomatic.co/api/v1/bot-tokens/info
Header: Authorization: Bearer tk_your_token_here
```

**Response:**

```json
{
  "valid": true,
  "createdAt": "2026-03-17T07:23:15.115Z",
  "lastUsed": "2026-03-17T08:00:00.000Z",
  "expiresAt": "2026-04-16T07:23:15.115Z",
  "uses": 42
}
```

Save your token somewhere safe (environment variable, `.env` file, config file). You do not need to request a new token every time your bot starts — reuse it until it expires.

---

## Step 2: Connect via Socket.IO

This is where most bot developers get stuck. The token **must** be passed in the Socket.IO `auth` object during connection — not as an HTTP header, and not after connecting.

### Node.js

```javascript
const { io } = require("socket.io-client");

const SERVER_URL = "https://classic.talkomatic.co";
const BOT_TOKEN = "tk_your_token_here"; // from Step 1

const socket = io(SERVER_URL, {
  auth: {
    token: BOT_TOKEN,
  },
  transports: ["websocket"],
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 2000,
});

socket.on("connect", () => {
  console.log("Connected to Talkomatic");
});

socket.on("connect_error", (err) => {
  console.error("Connection failed:", err.message);
  // Common errors:
  // "Bot token required"   → token not passed in auth object
  // "Invalid bot token"    → token is wrong or expired
  // "IP rate limit exceeded" → too many connections too fast
});
```

### Python

```python
import socketio

SERVER_URL = 'https://classic.talkomatic.co'
BOT_TOKEN = 'tk_your_token_here'

sio = socketio.Client()

@sio.event
def connect():
    print('Connected to Talkomatic')

@sio.event
def connect_error(data):
    print(f'Connection failed: {data}')

# The token goes in the auth parameter
sio.connect(SERVER_URL, auth={'token': BOT_TOKEN}, transports=['websocket'])
```

### Common Connection Errors

| Error Message                        | Cause                                 | Fix                                                 |
| ------------------------------------ | ------------------------------------- | --------------------------------------------------- |
| `Bot token required`                 | Token not provided in `auth` object   | Pass `auth: { token: '...' }` in connection options |
| `Invalid bot token`                  | Token is wrong, malformed, or expired | Request a new token via the REST API                |
| `IP rate limit exceeded`             | Too many connection attempts          | Wait and retry with exponential backoff             |
| `Too many connections`               | More than 8 connections from your IP  | Close unused connections                            |
| `Bot tokens not allowed in browsers` | Token used from a browser client      | Bot tokens are for server-side scripts only         |

---

## Step 3: Sign In (Join the Lobby)

After connecting, your bot needs to sign in with a username and location. This is done by emitting the `join lobby` event.

```javascript
socket.on("connect", () => {
  socket.emit("join lobby", {
    username: "MyBot", // max 15 characters
    location: "Bot Server", // max 20 characters, defaults to "On The Web"
  });
});

socket.on("signin status", (data) => {
  if (data.isSignedIn) {
    console.log(`Signed in as ${data.username} (${data.userId})`);
    console.log(`Bot flag: ${data.isBot}`); // true for bot connections
    // Now you can create/join rooms
  }
});
```

**Rules:**

- Username: required, 1–15 characters, must not be empty or only whitespace.
- Location: optional (defaults to `"On The Web"`), max 20 characters.
- If the word filter is enabled server-side, offensive usernames/locations are rejected.
- A username of `"Anonymous"` with location `"On The Web"` is treated as an anonymous user and has restrictions (cannot create rooms).

---

## Step 4: List, Create, or Join Rooms

### Listing Available Rooms

```javascript
socket.emit("get rooms");

socket.on("initial rooms", (rooms) => {
  // rooms is an array of public and semi-private rooms
  rooms.forEach((room) => {
    console.log(
      `${room.name} (${room.id}) — ${room.userCount}/5 users — ${room.type}`,
    );
  });
});
```

Each room object contains:

```javascript
{
  id: '123456',          // 6-digit room ID
  name: 'Room Name',
  type: 'public',        // "public" or "semi-private" (private rooms are hidden)
  isFull: false,
  userCount: 2,
  lastChatActivity: 1711100000000,  // timestamp of last chat activity
  createdAt: 1711099000000,
  users: [
    { id: 'user1', username: 'Alice', location: 'NYC' },
    { id: 'user2', username: 'Bob', location: 'London' },
  ]
}
```

You also receive live updates while in the lobby:

```javascript
socket.on("lobby update", (rooms) => {
  // Same format as initial rooms, sent whenever room list changes
});
```

### Creating a Room

```javascript
socket.emit("create room", {
  name: "Bot Hangout", // required, 1–25 characters
  type: "public", // "public", "semi-private", or "private"
  layout: "horizontal", // "horizontal" or "vertical"
  accessCode: null, // required for semi-private (6-digit string, e.g. "123456")
});

socket.on("room created", (roomId) => {
  console.log(`Room created with ID: ${roomId}`);
  // You still need to join the room after creating it
  socket.emit("join room", { roomId });
});
```

**Room creation constraints:**

- Anonymous users cannot create rooms.
- 10-second cooldown between room creations per user.
- 30-second cooldown between room creations per IP.
- Maximum 2 rooms per IP at any time.
- You can only be in 1 room at a time.
- Room names must be unique (case-insensitive).
- The server has a hard cap of 50 total rooms and a dynamic "healthy room" limit.

### Joining an Existing Room

```javascript
// Public room
socket.emit("join room", { roomId: "123456" });

// Semi-private room (requires 6-digit access code)
socket.emit("join room", { roomId: "123456", accessCode: "789012" });

socket.on("room joined", (data) => {
  console.log(`Joined room: ${data.roomName} (${data.roomId})`);
  console.log(`Users in room:`, data.users);
  console.log(`Current messages:`, data.currentMessages);
  // data.currentMessages is { [userId]: "their current message text" }
});

// Error cases
socket.on("room not found", () => {
  console.log("Room does not exist");
});

socket.on("room full", () => {
  console.log("Room is full (5/5)");
});

socket.on("access code required", () => {
  console.log("This room requires an access code");
});
```

**`room joined` payload:**

```javascript
{
  roomId: '123456',
  userId: 'your_session_id',
  username: 'MyBot',
  location: 'Bot Server',
  roomName: 'Bot Hangout',
  roomType: 'public',
  users: [
    { id: 'user1', username: 'Alice', location: 'NYC' },
    { id: 'your_id', username: 'MyBot', location: 'Bot Server' },
  ],
  layout: 'horizontal',
  votes: {},
  currentMessages: {
    'user1': 'Hello everyone!',
    'your_id': '',
  }
}
```

---

## Step 5: Send and Receive Messages

Talkomatic uses a **character-by-character diff system** instead of traditional chat messages. Every user has a single text buffer that they edit in real time. Other users see the changes as they happen.

### Sending Messages

The simplest way to send a message is a `full-replace` diff, which overwrites your entire text buffer:

```javascript
function sendMessage(socket, text) {
  socket.emit("chat update", {
    diff: {
      type: "full-replace",
      text: text, // max 15,000 characters
    },
  });
}

// Usage
sendMessage(socket, "Hello, I am a bot!");
```

**All diff types:**

| Type           | Fields           | Description                                            |
| -------------- | ---------------- | ------------------------------------------------------ |
| `full-replace` | `text`           | Replace entire message buffer with new text            |
| `add`          | `text`, `index`  | Insert text at position `index`                        |
| `delete`       | `count`, `index` | Delete `count` characters starting at position `index` |
| `replace`      | `text`, `index`  | Overwrite text starting at position `index`            |

For most bots, `full-replace` is all you need. The other types are useful for bots that simulate typing character-by-character.

### Simulating Typing (Character by Character)

```javascript
async function typeMessage(socket, text, delayMs = 50) {
  for (let i = 0; i < text.length; i++) {
    socket.emit("chat update", {
      diff: {
        type: "add",
        text: text[i],
        index: i,
      },
    });
    await new Promise((r) => setTimeout(r, delayMs));
  }
}

// Usage: types out "Hello!" one character at a time
await typeMessage(socket, "Hello!");
```

### Receiving Messages

```javascript
// Track each user's current message
const userMessages = new Map();

socket.on("chat update", (data) => {
  const { userId, username, diff } = data;

  let msg = userMessages.get(userId) || "";

  switch (diff.type) {
    case "full-replace":
      msg = diff.text;
      break;
    case "add":
      msg = msg.slice(0, diff.index) + diff.text + msg.slice(diff.index);
      break;
    case "delete":
      msg = msg.slice(0, diff.index) + msg.slice(diff.index + diff.count);
      break;
    case "replace":
      msg =
        msg.slice(0, diff.index) +
        diff.text +
        msg.slice(diff.index + diff.text.length);
      break;
  }

  userMessages.set(userId, msg);
  console.log(`[${username}]: ${msg}`);
});
```

### Receiving Current Messages on Join

When you join a room, `room joined` includes a `currentMessages` object with the current text buffer for every user already in the room. Initialize your `userMessages` map from this:

```javascript
socket.on("room joined", (data) => {
  // Seed message buffers with existing messages
  for (const [userId, text] of Object.entries(data.currentMessages)) {
    userMessages.set(userId, text);
  }
});
```

---

## Step 6: Stay Alive (AFK System)

The server has an AFK (away-from-keyboard) system that kicks inactive users:

- **Warning** at **2.5 minutes** of inactivity.
- **Kick** at **3 minutes** of inactivity.
- The AFK timer **only resets** when:
  1. Your bot sends a `chat update` event, OR
  2. Your bot emits `afk response` after receiving an `afk warning`.

**Typing indicators, `get rooms`, and all other events do NOT reset the AFK timer.** This is intentional to prevent bots from staying alive without actually participating.

### Option A: Respond to AFK Warnings (Recommended)

```javascript
socket.on("afk warning", (data) => {
  console.log(
    `AFK warning: ${data.message} (${data.secondsRemaining}s remaining)`,
  );
  // Send afk response to reset the timer
  socket.emit("afk response");
});

socket.on("afk timeout", (data) => {
  console.log(`Kicked for inactivity: ${data.message}`);
  // Optionally rejoin the room or exit
});
```

### Option B: Periodic Chat Updates

If your bot is actively chatting, the AFK timer resets automatically on every `chat update`. If your bot is mostly idle but needs to stay in a room, you can send a periodic no-op update:

```javascript
let keepAliveInterval;

function startKeepAlive(socket) {
  // Send a keep-alive chat update every 2 minutes
  keepAliveInterval = setInterval(() => {
    socket.emit("chat update", {
      diff: { type: "full-replace", text: "🤖 Bot is listening..." },
    });
  }, 120000); // 120 seconds
}

function stopKeepAlive() {
  if (keepAliveInterval) clearInterval(keepAliveInterval);
}
```

---

## Step 7: Leave a Room

```javascript
socket.emit("leave room");
// You are now back in the lobby and can join another room
```

### Room Events While Inside a Room

```javascript
// A new user entered the room
socket.on("user joined", (data) => {
  console.log(`${data.username} joined from ${data.location}`);
});

// A user left the room
socket.on("user left", (userId) => {
  console.log(`User ${userId} left`);
  userMessages.delete(userId);
});

// Room state changed (user list, votes, layout, etc.)
socket.on("room update", (roomData) => {
  console.log(`Room update: ${roomData.users.length} users`);
});

// Vote counts changed
socket.on("update votes", (votes) => {
  // votes = { [voterId]: targetUserId }
  console.log("Votes updated:", votes);
});

// Your bot was voted out by majority
socket.on("kicked", () => {
  console.log("Bot was kicked from the room");
});
```

---

## Socket.IO Events Reference

### Events Your Bot Emits (Client → Server)

| Event                 | Payload                                     | Description                               |
| --------------------- | ------------------------------------------- | ----------------------------------------- |
| `join lobby`          | `{ username: string, location: string }`    | Sign in to the platform                   |
| `check signin status` | _(none)_                                    | Check if session is still active          |
| `get rooms`           | _(none)_                                    | Request list of public/semi-private rooms |
| `create room`         | `{ name, type, layout, accessCode? }`       | Create a new room                         |
| `join room`           | `{ roomId, accessCode? }`                   | Join an existing room                     |
| `leave room`          | _(none)_                                    | Leave your current room                   |
| `chat update`         | `{ diff: { type, text?, index?, count? } }` | Send/update your message                  |
| `typing`              | `{ isTyping: boolean }`                     | Send typing indicator                     |
| `vote`                | `{ targetUserId: string }`                  | Vote to kick a user (toggle)              |
| `afk response`        | _(none)_                                    | Respond to AFK warning to stay alive      |
| `get room state`      | `roomId: string`                            | Request current state of a room           |

### Events Your Bot Receives (Server → Client)

| Event                  | Payload                                                                                             | Description                            |
| ---------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `signin status`        | `{ isSignedIn, username, location, userId, isBot }`                                                 | Authentication result                  |
| `initial rooms`        | `[room, ...]`                                                                                       | Room list (response to `get rooms`)    |
| `lobby update`         | `[room, ...]`                                                                                       | Live room list updates while in lobby  |
| `room created`         | `roomId: string`                                                                                    | Your room was created successfully     |
| `room joined`          | `{ roomId, userId, username, location, roomName, roomType, users, layout, votes, currentMessages }` | You successfully joined a room         |
| `room not found`       | error object                                                                                        | Room does not exist                    |
| `room full`            | error object                                                                                        | Room is at capacity (5 users)          |
| `access code required` | _(none)_                                                                                            | Semi-private room needs an access code |
| `user joined`          | `{ id, username, location, roomName, roomType }`                                                    | New user entered your room             |
| `user left`            | `userId: string`                                                                                    | User left your room                    |
| `room update`          | `{ id, name, type, layout, users, votes }`                                                          | Room state changed                     |
| `chat update`          | `{ userId, username, diff }`                                                                        | Another user's message changed         |
| `update votes`         | `{ [voterId]: targetUserId }`                                                                       | Vote counts changed                    |
| `user typing`          | `{ userId, username, isTyping }`                                                                    | Another user's typing status           |
| `kicked`               | _(none)_                                                                                            | You were voted out of the room         |
| `afk warning`          | `{ message, secondsRemaining }`                                                                     | You will be kicked for inactivity soon |
| `afk timeout`          | `{ message, redirectTo }`                                                                           | You were kicked for inactivity         |
| `error`                | `{ error: { code, message } }`                                                                      | Server error                           |
| `validation_error`     | `{ [field]: "error message" }`                                                                      | Input validation failed                |
| `room state`           | room object                                                                                         | Response to `get room state`           |

---

## Rate Limits and Constraints

### Connection Limits

| Limit                   | Value               |
| ----------------------- | ------------------- |
| Max connections per IP  | 8                   |
| Bot token rate limit    | 500 requests/minute |
| Human socket rate limit | 75 requests/window  |

### Room Limits

| Limit                             | Value         |
| --------------------------------- | ------------- |
| Max room capacity                 | 5 users       |
| Max rooms per IP                  | 2             |
| Max rooms per user                | 1             |
| Room creation cooldown (per user) | 10 seconds    |
| Room creation cooldown (per IP)   | 30 seconds    |
| Room name max length              | 25 characters |
| Hard max total rooms on server    | 50            |

### Message Limits

| Limit                       | Value                    |
| --------------------------- | ------------------------ |
| Max message length          | 15,000 characters        |
| Chat update rate limit      | 500 events per 5 seconds |
| Typing indicator rate limit | 60 per second            |

### User Limits

| Limit               | Value         |
| ------------------- | ------------- |
| Username max length | 15 characters |
| Location max length | 20 characters |
| AFK warning         | 2.5 minutes   |
| AFK kick            | 3 minutes     |

### Bot Token Limits

| Limit                          | Value   |
| ------------------------------ | ------- |
| Token requests per IP per hour | 3       |
| Max active tokens per IP       | 3       |
| Token lifetime                 | 30 days |

---

## Error Handling

Always listen for error events:

```javascript
socket.on("error", (data) => {
  const { code, message } = data.error;
  console.error(`Error [${code}]: ${message}`);
});

socket.on("validation_error", (errors) => {
  // errors = { fieldName: "error message", ... }
  console.error("Validation errors:", errors);
});

socket.on("connect_error", (err) => {
  console.error("Connection error:", err.message);
});

socket.on("disconnect", (reason) => {
  console.log("Disconnected:", reason);
  if (reason === "io server disconnect") {
    // Server forcefully disconnected — reconnect manually
    socket.connect();
  }
  // Otherwise socket.io will attempt automatic reconnection
});
```

**Common error codes:**

| Code                 | Meaning                                            |
| -------------------- | -------------------------------------------------- |
| `VALIDATION_ERROR`   | Invalid input data                                 |
| `UNAUTHORIZED`       | Not signed in                                      |
| `NOT_FOUND`          | Room not found                                     |
| `RATE_LIMITED`       | Too many requests                                  |
| `ROOM_FULL`          | Room is at capacity                                |
| `FORBIDDEN`          | Action not allowed (banned, already in room, etc.) |
| `ROOM_NAME_EXISTS`   | Room name already taken                            |
| `ROOM_LIMIT_REACHED` | Server room limit hit                              |
| `BAD_REQUEST`        | Malformed request                                  |
| `CIRCUIT_OPEN`       | Server under heavy load, try again shortly         |

---

## Best Practices

### 1. Reuse Your Token

Request a token once and store it. Tokens last 30 days. Do not request a new token every time your bot starts.

```javascript
// Store in .env file
// BOT_TOKEN=tk_abc123...

const BOT_TOKEN = process.env.BOT_TOKEN;
```

### 2. Handle Reconnection Gracefully

```javascript
const socket = io(SERVER_URL, {
  auth: { token: BOT_TOKEN },
  transports: ["websocket"],
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 2000,
  reconnectionDelayMax: 30000,
});

socket.on("connect", () => {
  console.log("Connected");
  // Re-sign-in after reconnection
  socket.emit("join lobby", { username: "MyBot", location: "Bot Server" });
});
```

### 3. Always Handle AFK

If your bot sits idle in a room without sending `chat update` events, it will be kicked in 3 minutes. Either listen for `afk warning` and respond with `afk response`, or send periodic chat updates.

### 4. Respect Rate Limits

Add client-side rate limiting to avoid being throttled or banned:

```javascript
class RateLimiter {
  constructor(minIntervalMs) {
    this.minInterval = minIntervalMs;
    this.lastAction = 0;
  }

  async wait() {
    const now = Date.now();
    const elapsed = now - this.lastAction;
    if (elapsed < this.minInterval) {
      await new Promise((r) => setTimeout(r, this.minInterval - elapsed));
    }
    this.lastAction = Date.now();
  }
}

const messageLimiter = new RateLimiter(200); // 200ms between messages

async function sendMessage(socket, text) {
  await messageLimiter.wait();
  socket.emit("chat update", { diff: { type: "full-replace", text } });
}
```

### 5. Clean Up on Shutdown

```javascript
process.on("SIGINT", () => {
  console.log("Shutting down...");
  socket.emit("leave room");
  socket.disconnect();
  process.exit(0);
});

process.on("SIGTERM", () => {
  socket.emit("leave room");
  socket.disconnect();
  process.exit(0);
});
```

### 6. Do Not Impersonate Real Users

Give your bot a clearly identifiable name like `"QuizBot"` or `"MusicBot"`. Do not use names designed to impersonate other users.

### 7. Do Not Spam

Bots that flood rooms with messages, rapidly create/destroy rooms, or perform any action designed to disrupt the platform will be permanently banned.
