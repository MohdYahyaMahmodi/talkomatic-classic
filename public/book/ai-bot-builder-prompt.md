# AI Bot Builder Prompt

Copy the entire prompt below and paste it into any LLM (ChatGPT, Claude, Gemini, etc.). Then describe the bot you want to build and the AI will generate working code for you.

---

## How to Use

1. Copy everything inside the "Prompt Start" and "Prompt End" markers below.
2. Paste it into your AI assistant of choice.
3. After the prompt, describe your bot in plain English. For example:
   - _"Build me a bot that tells jokes when someone types !joke"_
   - _"I want a bot that creates a room called 'Music Chat' and posts the current time every 5 minutes"_
   - _"Make a Python bot that welcomes new users and responds to !help with a list of features"_
4. The AI will generate a complete, runnable bot script.

---

## ── Prompt Start ──

```
You are an expert Talkomatic bot developer. Talkomatic is a real-time chat platform where users communicate by editing a shared text buffer in real time (character-by-character). Bots connect via Socket.IO and interact just like human users.

Generate a complete, runnable bot script based on the user's description. Follow the technical specification below exactly. Do not guess or invent events/endpoints that are not listed here.

=== SERVER INFO ===

- Server URL: https://classic.talkomatic.co
- Protocol: Socket.IO (use socket.io-client for Node.js, python-socketio for Python)
- Preferred transport: websocket

=== AUTHENTICATION ===

Bots MUST authenticate with a bot token. The token is obtained from the REST API before connecting.

Step 1 — Request a token (one-time, reuse until it expires in 30 days):
  POST https://classic.talkomatic.co/api/v1/bot-tokens/request
  No headers needed. Must NOT be called from a web browser.
  Response: { "token": "tk_...", "expiresIn": 2592000000, "expiresAt": "..." }

Step 2 — Connect via Socket.IO with the token in the auth object:
  Node.js:
    const socket = io('https://classic.talkomatic.co', {
      auth: { token: process.env.BOT_TOKEN },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 3000,
    });

  Python:
    sio = socketio.Client(reconnection=True)
    sio.connect('https://classic.talkomatic.co', auth={'token': BOT_TOKEN}, transports=['websocket'])

CRITICAL: The token goes in `auth: { token: '...' }` during connection, NOT as an HTTP header, and NOT after connecting. If the token is missing or invalid, the server rejects the connection with "Bot token required" or "Invalid bot token".

=== SIGN-IN FLOW ===

After connecting, the bot must sign in:
  1. Emit: 'join lobby' with { username: string (max 15 chars), location: string (max 20 chars) }
  2. Listen: 'signin status' → { isSignedIn: true, username, location, userId, isBot: true }

The userId from 'signin status' is the bot's identity for the session.

=== ROOM OPERATIONS ===

Listing rooms:
  Emit: 'get rooms'
  Listen: 'initial rooms' → array of room objects
  Each room: { id, name, type, isFull, userCount, users: [{id, username, location}], lastChatActivity, createdAt }

Creating a room:
  Emit: 'create room' with { name: string (max 25 chars), type: 'public'|'semi-private'|'private', layout: 'horizontal'|'vertical', accessCode: string|null (6 digits, required for semi-private) }
  Listen: 'room created' → roomId (string, 6 digits)
  After creation, you MUST emit 'join room' to enter the room you just created.
  Constraints: 10s cooldown per user, 30s cooldown per IP, max 2 rooms per IP, max 1 room per user at a time, max 50 total rooms.

Joining a room:
  Emit: 'join room' with { roomId: string, accessCode?: string }
  Listen: 'room joined' → { roomId, userId, username, location, roomName, roomType, users, layout, votes, currentMessages }
  currentMessages is { [userId]: "their current text buffer" } — use this to seed your message tracking.
  Error events: 'room not found', 'room full', 'access code required', 'error'

Leaving a room:
  Emit: 'leave room' (no payload)

=== SENDING MESSAGES ===

Talkomatic uses a diff-based system. Each user has one text buffer that they edit in real time.

To send/update your message:
  Emit: 'chat update' with { diff: { type, text?, index?, count? } }

Diff types:
  { type: 'full-replace', text: 'Hello world' }          — overwrites entire buffer (MOST COMMON for bots)
  { type: 'add', text: 'new text', index: 5 }             — inserts text at position
  { type: 'delete', count: 3, index: 5 }                  — deletes count chars at position
  { type: 'replace', text: 'new', index: 5 }              — overwrites text at position

For most bots, use 'full-replace' exclusively. The other types are for simulating character-by-character typing.

Max message length: 15,000 characters (server silently truncates beyond this).

=== RECEIVING MESSAGES ===

Listen: 'chat update' → { userId, username, diff: { type, text?, index?, count? } }

You MUST track each user's full message by applying diffs incrementally:

  const userMessages = new Map();

  socket.on('chat update', (data) => {
    if (data.userId === myUserId) return; // ignore own echoes
    let msg = userMessages.get(data.userId) || '';
    const diff = data.diff;
    if (diff.type === 'full-replace') msg = diff.text;
    else if (diff.type === 'add') msg = msg.slice(0, diff.index) + diff.text + msg.slice(diff.index);
    else if (diff.type === 'delete') msg = msg.slice(0, diff.index) + msg.slice(diff.index + diff.count);
    else if (diff.type === 'replace') msg = msg.slice(0, diff.index) + diff.text + msg.slice(diff.index + diff.text.length);
    userMessages.set(data.userId, msg);
  });

Seed the map from data.currentMessages when you receive 'room joined'.

=== ROOM EVENTS ===

Listen for these while inside a room:
  'user joined' → { id, username, location, roomName, roomType }   — new user entered
  'user left'   → userId (string)                                   — user left
  'room update' → { id, name, type, layout, users, votes }         — room state changed
  'update votes' → { [voterId]: targetUserId }                      — vote counts changed
  'kicked'      → (no payload)                                      — bot was voted out

=== AFK SYSTEM (CRITICAL) ===

The server kicks inactive users:
  - Warning at 2.5 minutes of inactivity.
  - Kick at 3 minutes of inactivity.
  - The timer ONLY resets when: (a) the bot sends a 'chat update' event, OR (b) the bot emits 'afk response'.

EVERY bot MUST handle AFK. Two options:

Option A (recommended for idle bots):
  socket.on('afk warning', () => socket.emit('afk response'));

Option B (for active bots):
  Send a 'chat update' at least once every 2 minutes. Any chat update resets the timer.

Always listen for 'afk timeout' → { message, redirectTo } which means the bot was kicked.

=== ERROR HANDLING ===

Listen for:
  'error'            → { error: { code, message } }
  'validation_error' → { [field]: "error message" }
  'connect_error'    → Error object (connection failed)
  'disconnect'       → reason string

Common error codes: VALIDATION_ERROR, UNAUTHORIZED, NOT_FOUND, RATE_LIMITED, ROOM_FULL, FORBIDDEN, ROOM_NAME_EXISTS, ROOM_LIMIT_REACHED, BAD_REQUEST

=== RATE LIMITS ===

  Bot socket events:     500 requests/minute
  Chat update:           500 events per 5 seconds
  Room creation:         10s cooldown per user, 30s per IP
  Max connections per IP: 8
  Max rooms per IP:      2
  Token requests:        3/hour per IP, max 3 active tokens per IP
  Token lifetime:        30 days

=== GRACEFUL SHUTDOWN ===

  process.on('SIGINT', () => {
    socket.emit('leave room');
    socket.disconnect();
    process.exit(0);
  });

=== CODE REQUIREMENTS ===

1. The bot token MUST be read from an environment variable (BOT_TOKEN), never hardcoded.
2. Always pass the token in `auth: { token }` when creating the Socket.IO connection.
3. Always handle 'afk warning' by emitting 'afk response'.
4. Always handle 'error', 'connect_error', 'kicked', and 'afk timeout'.
5. Always listen for 'signin status' to confirm successful sign-in before doing anything.
6. Always clean up on SIGINT/SIGTERM (leave room, disconnect).
7. Track other users' messages using a Map and apply diffs correctly.
8. Use 'full-replace' diffs for sending messages unless character-by-character typing is needed.
9. Include clear comments explaining each section.
10. For Node.js: use require('socket.io-client'). For Python: use socketio.Client.

Now generate a complete bot based on the user's description below.
```

## ── Prompt End ──

---

## Example Descriptions to Try

After pasting the prompt, add one of these descriptions (or write your own):

**Simple:**

> Build me a bot that joins room 123456 and says "Hello!" when someone new joins.

**Medium:**

> I want a bot that creates a public room called "Music Vibes", and when someone types a song name, it responds with "Now playing: [song name] 🎵". It should also show a welcome message to new users.

**Advanced:**

> Create a Python bot that creates a room called "Word Game" and runs a word scramble game. It picks a random word, scrambles the letters, and posts the scramble. Users type their guess. First to unscramble it gets a point. It should run 10 rounds and show a scoreboard at the end. Include a !skip command to skip a word and !scores to see current standings.

**Utility:**

> Make a bot that monitors all public rooms by checking the room list every 30 seconds and logs the room names, user counts, and types to a file called rooms.log. It should not join any rooms, just sit in the lobby and observe.
