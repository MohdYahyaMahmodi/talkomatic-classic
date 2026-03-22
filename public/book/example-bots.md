# Example Bots

Complete, runnable bot examples for Talkomatic. Each example demonstrates different capabilities. All examples use Node.js with the `socket.io-client` package.

**Install the dependency:**

```bash
npm install socket.io-client
```

**All examples expect a bot token in the `BOT_TOKEN` environment variable:**

```bash
# Request a token first
curl -X POST https://classic.talkomatic.co/api/v1/bot-tokens/request
# Then run your bot
BOT_TOKEN=tk_your_token_here node bot.js
```

---

## Table of Contents

- [Example 1: Greeter Bot](#example-1-greeter-bot)
- [Example 2: Command Bot](#example-2-command-bot)
- [Example 3: Trivia Bot](#example-3-trivia-bot)
- [Example 4: Room Host Bot](#example-4-room-host-bot)
- [Example 5: Python Echo Bot](#example-5-python-echo-bot)

---

## Example 1: Greeter Bot

A simple bot that joins a room and greets users when they arrive or leave. Demonstrates: connection, authentication, room joining, event listening, sending messages, and AFK handling.

```javascript
// greeter-bot.js
const { io } = require("socket.io-client");

const SERVER = "https://classic.talkomatic.co";
const TOKEN = process.env.BOT_TOKEN;
const ROOM_ID = process.env.ROOM_ID; // pass the room ID to join

if (!TOKEN) {
  console.error("Set BOT_TOKEN env var");
  process.exit(1);
}
if (!ROOM_ID) {
  console.error("Set ROOM_ID env var");
  process.exit(1);
}

const socket = io(SERVER, {
  auth: { token: TOKEN },
  transports: ["websocket"],
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 3000,
});

let myUserId = null;

// ── Connect & Sign In ───────────────────────────────────────────────────────

socket.on("connect", () => {
  console.log("[+] Connected");
  socket.emit("join lobby", {
    username: "GreeterBot",
    location: "Lobby",
  });
});

socket.on("signin status", (data) => {
  if (data.isSignedIn) {
    myUserId = data.userId;
    console.log(`[+] Signed in as ${data.username} (${data.userId})`);
    socket.emit("join room", { roomId: ROOM_ID });
  }
});

// ── Room Events ─────────────────────────────────────────────────────────────

socket.on("room joined", (data) => {
  console.log(`[+] Joined room: ${data.roomName}`);
  sendMessage(`👋 Hello! I'm GreeterBot. Welcome to ${data.roomName}!`);
});

socket.on("user joined", (data) => {
  if (data.id !== myUserId) {
    console.log(`[+] ${data.username} joined`);
    sendMessage(`👋 Welcome, ${data.username}!`);
  }
});

socket.on("user left", (userId) => {
  console.log(`[-] User ${userId} left`);
  sendMessage(`👋 Someone just left. See you next time!`);
});

// ── AFK Handling ────────────────────────────────────────────────────────────

socket.on("afk warning", () => {
  socket.emit("afk response");
});

socket.on("afk timeout", (data) => {
  console.log(`[!] Kicked for AFK: ${data.message}`);
});

// ── Error Handling ──────────────────────────────────────────────────────────

socket.on("error", (data) => {
  console.error(`[!] Error: ${data.error?.message || data}`);
});

socket.on("connect_error", (err) => {
  console.error(`[!] Connection error: ${err.message}`);
});

socket.on("kicked", () => {
  console.log("[!] Kicked from room");
  process.exit(0);
});

// ── Send Helper ─────────────────────────────────────────────────────────────

function sendMessage(text) {
  socket.emit("chat update", {
    diff: { type: "full-replace", text },
  });
}

// ── Graceful Shutdown ───────────────────────────────────────────────────────

process.on("SIGINT", () => {
  console.log("\n[*] Shutting down...");
  socket.emit("leave room");
  socket.disconnect();
  process.exit(0);
});
```

**Run it:**

```bash
BOT_TOKEN=tk_... ROOM_ID=123456 node greeter-bot.js
```

---

## Example 2: Command Bot

A bot that listens for messages from other users and responds to commands like `!help`, `!time`, `!flip`, and `!roll`. Demonstrates: tracking other users' messages via diffs, command parsing, and responding contextually.

```javascript
// command-bot.js
const { io } = require("socket.io-client");

const SERVER = "https://classic.talkomatic.co";
const TOKEN = process.env.BOT_TOKEN;
const ROOM_ID = process.env.ROOM_ID;

if (!TOKEN || !ROOM_ID) {
  console.error("Set BOT_TOKEN and ROOM_ID env vars");
  process.exit(1);
}

const socket = io(SERVER, {
  auth: { token: TOKEN },
  transports: ["websocket"],
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 3000,
});

let myUserId = null;
const userMessages = new Map(); // userId -> current full message text
const processedCmds = new Map(); // userId -> last command we processed (avoid re-firing)

// ── Connect & Sign In ───────────────────────────────────────────────────────

socket.on("connect", () => {
  console.log("[+] Connected");
  socket.emit("join lobby", { username: "CmdBot", location: "Terminal" });
});

socket.on("signin status", (data) => {
  if (data.isSignedIn) {
    myUserId = data.userId;
    console.log(`[+] Signed in as ${data.username}`);
    socket.emit("join room", { roomId: ROOM_ID });
  }
});

socket.on("room joined", (data) => {
  console.log(`[+] Joined room: ${data.roomName}`);
  // Seed existing message buffers
  for (const [uid, text] of Object.entries(data.currentMessages)) {
    userMessages.set(uid, text);
  }
  sendMessage("🤖 CmdBot online! Type !help for commands.");
});

// ── Message Tracking & Command Detection ────────────────────────────────────

socket.on("chat update", (data) => {
  const { userId, username, diff } = data;
  if (userId === myUserId) return; // ignore our own echoes

  // Apply the diff to rebuild the user's full message
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

  // Check for a command (starts with "!")
  const trimmed = msg.trim();
  if (!trimmed.startsWith("!")) return;

  // Avoid re-processing the same command while user is still typing
  const lastProcessed = processedCmds.get(userId);
  if (lastProcessed === trimmed) return;

  // Only process if the message looks "complete" (ends with space or is a known command)
  const parts = trimmed.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  // For single-word commands, process immediately.
  // For multi-word commands, wait for a trailing space to indicate they're done typing.
  const knownSingleWord = ["!help", "!time", "!flip", "!roll", "!ping"];
  if (
    knownSingleWord.includes(cmd) ||
    trimmed.endsWith(" ") ||
    parts.length > 1
  ) {
    processedCmds.set(userId, trimmed);
    handleCommand(cmd, args, username);
  }
});

// ── Command Handlers ────────────────────────────────────────────────────────

function handleCommand(cmd, args, username) {
  switch (cmd) {
    case "!help":
      sendMessage(
        "🤖 Commands:\n" +
          "  !help  — Show this message\n" +
          "  !time  — Current server time\n" +
          "  !flip  — Flip a coin\n" +
          "  !roll  — Roll a dice (default d6, or !roll 20)\n" +
          "  !ping  — Pong!",
      );
      break;

    case "!time":
      sendMessage(`🕐 ${new Date().toUTCString()}`);
      break;

    case "!flip":
      sendMessage(`🪙 ${Math.random() < 0.5 ? "Heads!" : "Tails!"}`);
      break;

    case "!roll": {
      const sides = parseInt(args[0]) || 6;
      const clamped = Math.min(Math.max(sides, 2), 1000);
      const result = Math.floor(Math.random() * clamped) + 1;
      sendMessage(`🎲 Rolling d${clamped}... ${result}!`);
      break;
    }

    case "!ping":
      sendMessage(`🏓 Pong, ${username}!`);
      break;

    default:
      sendMessage(`❓ Unknown command: ${cmd}. Type !help for a list.`);
  }
}

// ── AFK / Error / Shutdown ──────────────────────────────────────────────────

socket.on("afk warning", () => socket.emit("afk response"));
socket.on("afk timeout", () => process.exit(1));
socket.on("kicked", () => {
  console.log("[!] Kicked");
  process.exit(0);
});
socket.on("error", (d) => console.error("[!]", d.error?.message || d));
socket.on("connect_error", (e) =>
  console.error("[!] Connect error:", e.message),
);

socket.on("user left", (uid) => {
  userMessages.delete(uid);
  processedCmds.delete(uid);
});

function sendMessage(text) {
  socket.emit("chat update", { diff: { type: "full-replace", text } });
}

process.on("SIGINT", () => {
  socket.emit("leave room");
  socket.disconnect();
  process.exit(0);
});
```

---

## Example 3: Trivia Bot

A bot that creates its own room and runs a trivia game. Users type their answer and the bot checks it. Demonstrates: room creation, game state management, timed rounds, and tracking multiple users.

```javascript
// trivia-bot.js
const { io } = require("socket.io-client");

const SERVER = "https://classic.talkomatic.co";
const TOKEN = process.env.BOT_TOKEN;

if (!TOKEN) {
  console.error("Set BOT_TOKEN env var");
  process.exit(1);
}

const QUESTIONS = [
  { q: "What planet is closest to the Sun?", a: "mercury" },
  { q: "What is the chemical symbol for gold?", a: "au" },
  { q: "In what year did the Berlin Wall fall?", a: "1989" },
  { q: "What is the largest ocean on Earth?", a: "pacific" },
  { q: "How many sides does a hexagon have?", a: "6" },
  { q: "What gas do plants absorb from the atmosphere?", a: "carbon dioxide" },
  { q: "Who painted the Mona Lisa?", a: "da vinci" },
  { q: "What is the smallest prime number?", a: "2" },
];

const socket = io(SERVER, {
  auth: { token: TOKEN },
  transports: ["websocket"],
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 3000,
});

let myUserId = null;
let myRoomId = null;

// Game state
const userMessages = new Map();
const scores = new Map();
let currentQuestion = null;
let questionIndex = -1;
let roundTimeout = null;
let gameActive = false;

// ── Connect & Create Room ───────────────────────────────────────────────────

socket.on("connect", () => {
  console.log("[+] Connected");
  socket.emit("join lobby", { username: "TriviaBot", location: "Quiz Room" });
});

socket.on("signin status", (data) => {
  if (!data.isSignedIn) return;
  myUserId = data.userId;
  console.log(`[+] Signed in as ${data.username}`);

  // Create a room for the trivia game
  socket.emit("create room", {
    name: "Trivia Night",
    type: "public",
    layout: "horizontal",
  });
});

socket.on("room created", (roomId) => {
  console.log(`[+] Room created: ${roomId}`);
  myRoomId = roomId;
  socket.emit("join room", { roomId });
});

socket.on("room joined", (data) => {
  console.log(`[+] Joined room: ${data.roomName}`);
  for (const [uid, text] of Object.entries(data.currentMessages)) {
    userMessages.set(uid, text);
  }
  sendMessage(
    "🧠 Welcome to Trivia Night!\n" +
      'Wait for more players to join. The game starts when someone types "!start".\n' +
      "Type your answer in the chat. First correct answer wins the round!",
  );
});

// ── Message Handling ────────────────────────────────────────────────────────

socket.on("chat update", (data) => {
  const { userId, username, diff } = data;
  if (userId === myUserId) return;

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

  const trimmed = msg.trim().toLowerCase();

  // Start command
  if (trimmed === "!start" && !gameActive) {
    startGame();
    return;
  }

  // Check answer
  if (gameActive && currentQuestion) {
    if (trimmed.includes(currentQuestion.a)) {
      // Correct answer!
      const pts = (scores.get(userId) || 0) + 1;
      scores.set(userId, pts);
      clearTimeout(roundTimeout);
      sendMessage(
        `✅ ${username} got it! The answer was "${currentQuestion.a}".\nScore: ${pts} point(s).\n`,
      );
      currentQuestion = null;
      setTimeout(() => nextQuestion(), 3000);
    }
  }
});

// ── Game Logic ──────────────────────────────────────────────────────────────

function startGame() {
  gameActive = true;
  questionIndex = -1;
  scores.clear();
  sendMessage("🎮 Game starting!\n");
  setTimeout(() => nextQuestion(), 2000);
}

function nextQuestion() {
  questionIndex++;
  if (questionIndex >= QUESTIONS.length) {
    endGame();
    return;
  }
  currentQuestion = QUESTIONS[questionIndex];
  sendMessage(
    `❓ Question ${questionIndex + 1}/${QUESTIONS.length}:\n\n` +
      `${currentQuestion.q}\n\n` +
      `(You have 30 seconds!)`,
  );

  roundTimeout = setTimeout(() => {
    sendMessage(`⏰ Time's up! The answer was "${currentQuestion.a}".\n`);
    currentQuestion = null;
    setTimeout(() => nextQuestion(), 3000);
  }, 30000);
}

function endGame() {
  gameActive = false;
  currentQuestion = null;

  let leaderboard = "🏆 Game Over! Final Scores:\n\n";
  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) {
    leaderboard += "(No one scored any points)\n";
  } else {
    sorted.forEach(([uid, pts], i) => {
      const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "  ";
      leaderboard += `${medal} ${pts} pts\n`;
    });
  }
  leaderboard += "\nType !start to play again!";
  sendMessage(leaderboard);
}

// ── Utility & Events ────────────────────────────────────────────────────────

socket.on("user joined", (data) => {
  if (data.id !== myUserId) {
    const status = gameActive
      ? "A game is in progress — jump in and answer!"
      : "Type !start to begin!";
    sendMessage(`👋 ${data.username} joined! ${status}`);
  }
});

socket.on("user left", (uid) => {
  userMessages.delete(uid);
});

socket.on("afk warning", () => socket.emit("afk response"));
socket.on("afk timeout", () => process.exit(1));
socket.on("kicked", () => process.exit(0));
socket.on("error", (d) => console.error("[!]", d.error?.message || d));
socket.on("connect_error", (e) => console.error("[!]", e.message));

function sendMessage(text) {
  socket.emit("chat update", { diff: { type: "full-replace", text } });
}

process.on("SIGINT", () => {
  if (roundTimeout) clearTimeout(roundTimeout);
  socket.emit("leave room");
  socket.disconnect();
  process.exit(0);
});
```

**Run it:**

```bash
BOT_TOKEN=tk_... node trivia-bot.js
```

The bot creates its own public room called "Trivia Night". Users join and type `!start` to begin.

---

## Example 4: Room Host Bot

A bot that creates a room, monitors it, and provides utility features: user count announcements, a clock that updates every minute, and auto-cleanup of its message when no one else is in the room. Demonstrates: periodic updates, room state tracking, and conditional behavior.

```javascript
// host-bot.js
const { io } = require("socket.io-client");

const SERVER = "https://classic.talkomatic.co";
const TOKEN = process.env.BOT_TOKEN;
const ROOM_NAME = process.env.ROOM_NAME || "Open Lounge";

if (!TOKEN) {
  console.error("Set BOT_TOKEN env var");
  process.exit(1);
}

const socket = io(SERVER, {
  auth: { token: TOKEN },
  transports: ["websocket"],
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 3000,
});

let myUserId = null;
let myRoomId = null;
let userCount = 0; // includes the bot itself
let clockInterval = null;

// ── Connect & Create Room ───────────────────────────────────────────────────

socket.on("connect", () => {
  console.log("[+] Connected");
  socket.emit("join lobby", { username: "HostBot", location: "Always On" });
});

socket.on("signin status", (data) => {
  if (!data.isSignedIn) return;
  myUserId = data.userId;
  socket.emit("create room", {
    name: ROOM_NAME,
    type: "public",
    layout: "horizontal",
  });
});

socket.on("room created", (roomId) => {
  myRoomId = roomId;
  socket.emit("join room", { roomId });
});

socket.on("room joined", (data) => {
  console.log(`[+] Hosting room: ${data.roomName} (${data.roomId})`);
  userCount = data.users.length;
  updateStatus();
  startClock();
});

// ── User Tracking ───────────────────────────────────────────────────────────

socket.on("user joined", (data) => {
  if (data.id === myUserId) return;
  userCount++;
  console.log(`[+] ${data.username} joined (${userCount} in room)`);
  updateStatus();
});

socket.on("user left", (userId) => {
  if (userId === myUserId) return;
  userCount = Math.max(1, userCount - 1); // at least the bot
  console.log(`[-] User left (${userCount} in room)`);
  updateStatus();
});

socket.on("room update", (data) => {
  userCount = data.users ? data.users.length : userCount;
});

// ── Status Display ──────────────────────────────────────────────────────────

function updateStatus() {
  const time = new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  const guests = userCount - 1; // subtract the bot
  let msg = `🏠 ${ROOM_NAME}\n`;
  msg += `🕐 ${time}\n`;
  msg += `👥 ${guests} guest${guests !== 1 ? "s" : ""} here\n`;
  msg += `\n`;
  if (guests === 0) {
    msg += `It's quiet in here. Say hello!\n`;
  } else if (guests <= 2) {
    msg += `Welcome! Feel free to chat.\n`;
  } else {
    msg += `Room is getting lively!\n`;
  }
  sendMessage(msg);
}

function startClock() {
  if (clockInterval) clearInterval(clockInterval);
  // Update the displayed time every 60 seconds
  clockInterval = setInterval(() => updateStatus(), 60000);
}

// ── AFK / Error / Shutdown ──────────────────────────────────────────────────

socket.on("afk warning", () => socket.emit("afk response"));
socket.on("afk timeout", () => {
  console.log("[!] AFK kicked — restarting");
  process.exit(1); // let a process manager (pm2, systemd) restart
});
socket.on("kicked", () => {
  console.log("[!] Voted out");
  process.exit(0);
});
socket.on("error", (d) => console.error("[!]", d.error?.message || d));
socket.on("connect_error", (e) => console.error("[!]", e.message));

function sendMessage(text) {
  socket.emit("chat update", { diff: { type: "full-replace", text } });
}

process.on("SIGINT", () => {
  if (clockInterval) clearInterval(clockInterval);
  socket.emit("leave room");
  socket.disconnect();
  process.exit(0);
});
```

---

## Example 5: Python Echo Bot

An echo bot written in Python using `python-socketio`. Demonstrates the same flow in a different language.

**Install:**

```bash
pip install "python-socketio[client]"
```

```python
# echo_bot.py
import os
import sys
import socketio

SERVER  = 'https://classic.talkomatic.co'
TOKEN   = os.environ.get('BOT_TOKEN')
ROOM_ID = os.environ.get('ROOM_ID')

if not TOKEN:
    print('Set BOT_TOKEN env var')
    sys.exit(1)
if not ROOM_ID:
    print('Set ROOM_ID env var')
    sys.exit(1)

sio = socketio.Client(reconnection=True, reconnection_attempts=10)

my_user_id = None
user_messages = {}  # userId -> current message text


@sio.event
def connect():
    print('[+] Connected')
    sio.emit('join lobby', {'username': 'EchoBot', 'location': 'Python'})


@sio.on('signin status')
def on_signin(data):
    global my_user_id
    if data.get('isSignedIn'):
        my_user_id = data['userId']
        print(f"[+] Signed in as {data['username']}")
        sio.emit('join room', {'roomId': ROOM_ID})


@sio.on('room joined')
def on_room_joined(data):
    print(f"[+] Joined room: {data['roomName']}")
    # Seed existing messages
    for uid, text in data.get('currentMessages', {}).items():
        user_messages[uid] = text
    send_message('🐍 EchoBot (Python) is online! I repeat what you say.')


@sio.on('chat update')
def on_chat_update(data):
    user_id = data['userId']
    username = data['username']
    diff = data['diff']

    if user_id == my_user_id:
        return

    # Rebuild the user's message from the diff
    msg = user_messages.get(user_id, '')

    if diff['type'] == 'full-replace':
        msg = diff['text']
    elif diff['type'] == 'add':
        idx = diff['index']
        msg = msg[:idx] + diff['text'] + msg[idx:]
    elif diff['type'] == 'delete':
        idx = diff['index']
        msg = msg[:idx] + msg[idx + diff['count']:]
    elif diff['type'] == 'replace':
        idx = diff['index']
        new_text = diff['text']
        msg = msg[:idx] + new_text + msg[idx + len(new_text):]

    user_messages[user_id] = msg

    # Echo the message back
    if msg.strip():
        send_message(f'🔁 {username} said: {msg}')


@sio.on('user joined')
def on_user_joined(data):
    if data['id'] != my_user_id:
        send_message(f"👋 Welcome, {data['username']}!")


@sio.on('user left')
def on_user_left(user_id):
    user_messages.pop(user_id, None)


@sio.on('afk warning')
def on_afk_warning(data):
    sio.emit('afk response')


@sio.on('afk timeout')
def on_afk_timeout(data):
    print(f"[!] AFK kicked: {data.get('message')}")
    sys.exit(1)


@sio.on('kicked')
def on_kicked():
    print('[!] Kicked from room')
    sys.exit(0)


@sio.on('error')
def on_error(data):
    msg = data.get('error', {}).get('message', data) if isinstance(data, dict) else data
    print(f'[!] Error: {msg}')


@sio.event
def connect_error(data):
    print(f'[!] Connection error: {data}')


def send_message(text):
    sio.emit('chat update', {
        'diff': {'type': 'full-replace', 'text': text}
    })


if __name__ == '__main__':
    try:
        sio.connect(SERVER, auth={'token': TOKEN}, transports=['websocket'])
        sio.wait()
    except KeyboardInterrupt:
        print('\n[*] Shutting down...')
        sio.emit('leave room')
        sio.disconnect()
```

**Run it:**

```bash
BOT_TOKEN=tk_... ROOM_ID=123456 python echo_bot.py
```
