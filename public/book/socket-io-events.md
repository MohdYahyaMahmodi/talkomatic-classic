# Socket.IO Events Reference

This document details all Socket.IO events used in Talkomatic that your bot can listen to and emit.

## Connection Events

### Server -> Client Events

| Event | Description | Payload |
|-------|-------------|---------|
| `connect` | Socket connection established | None |
| `disconnect` | Socket disconnected | None |
| `error` | Server error occurred | `string` error message |

### Client -> Server Events

| Event | Description | Payload |
|-------|-------------|---------|
| `check signin status` | Check if already signed in | None |

## Authentication Events

### Server -> Client Events

| Event | Description | Payload |
|-------|-------------|---------|
| `signin status` | Current authentication status | `{ isSignedIn: boolean, username: string, location: string, userId: string }` |

### Client -> Server Events

| Event | Description | Payload |
|-------|-------------|---------|
| `join lobby` | Sign in to the system | `{ username: string, location: string }` |

## Room Events

### Server -> Client Events

```javascript
// Example event payloads
const roomJoinedPayload = {
  roomId: "123456",
  userId: "user123",
  username: "BotName",
  location: "BotLand",
  roomName: "Bot Room",
  roomType: "public",
  users: [/* user objects */],
  layout: "horizontal",
  votes: {},
  currentMessages: {}
};

const userJoinedPayload = {
  id: "user123",
  username: "User1",
  location: "Location1",
  roomName: "Room Name",
  roomType: "public"
};
```

| Event | Description | Payload Example |
|-------|-------------|----------------|
| `room joined` | Successfully joined a room | `roomJoinedPayload` |
| `user joined` | New user entered the room | `userJoinedPayload` |
| `user left` | User left the room | `userId` string |
| `room update` | Room state changed | Room object |
| `chat update` | Message content changed | `{ userId, username, diff }` |
| `update votes` | Vote counts changed | `{ [userId]: targetUserId }` |

### Client -> Server Events

| Event | Description | Required Payload |
|-------|-------------|-----------------|
| `create room` | Create new room | `{ name: string, type: string, layout: string, accessCode?: string }` |
| `join room` | Join existing room | `{ roomId: string, accessCode?: string }` |
| `leave room` | Exit current room | None |
| `chat update` | Send/update message | `{ diff: object }` |
| `vote` | Vote against user | `{ targetUserId: string }` |

## Message Events

### Chat Update Diff Types

```javascript
// Different types of chat update diffs:
const fullReplace = {
  type: 'full-replace',
  text: 'New message'
};

const addText = {
  type: 'add',
  text: ' additional text',
  index: 10
};

const deleteText = {
  type: 'delete',
  count: 5,
  index: 0
};

const replaceText = {
  type: 'replace',
  text: 'new text',
  index: 0
};
```

> **Info:** Your bot should handle all diff types when receiving chat updates and choose appropriate diff types when sending messages.

## Typing Indicator Events

| Event | Description | Payload |
|-------|-------------|---------|
| `typing` | User typing status | `{ isTyping: boolean }` |
| `user typing` | Other user typing | `{ userId: string, username: string, isTyping: boolean }` |

> **Note:** The server maintains a 2-second timeout for typing indicators.

## Error Events

Common error events your bot should handle:

- `room not found`
- `room full`
- `access code required`
- `kicked`
- `error` (generic errors)

> **Warning:** Always implement error handling for these events to ensure your bot can recover gracefully.