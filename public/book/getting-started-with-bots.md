# Getting Started with Bots

Welcome to the Talkomatic Bot Development guide! This documentation will help you create bots that can interact with Talkomatic's chat system.

## Prerequisites

Before you begin, make sure you have:

- Node.js (v14 or higher)
- npm or yarn
- Basic knowledge of JavaScript and Socket.IO
- Understanding of asynchronous programming

## Setup

First, create a new Node.js project and install the required dependencies:

```bash
mkdir talkomatic-bot
cd talkomatic-bot
npm init -y
npm install socket.io-client dotenv
```

Create a `.env` file in your project root:

```plaintext
BOT_USERNAME=MyBot
BOT_LOCATION=BotLand
SERVER_URL=http://localhost:3000
```

> **Note:** Replace the SERVER_URL with the actual Talkomatic server URL you're connecting to.

## Basic Bot Structure

Here's a minimal bot implementation:

```javascript
const { io } = require('socket.io-client');
require('dotenv').config();

class TalkomaticBot {
  constructor() {
    this.socket = io(process.env.SERVER_URL, {
      transports: ['websocket'],
      autoConnect: true
    });
    
    this.username = process.env.BOT_USERNAME;
    this.location = process.env.BOT_LOCATION;
    this.currentRoom = null;
    
    this.setupEventHandlers();
  }

  setupEventHandlers() {
    this.socket.on('connect', () => {
      console.log('Connected to Talkomatic server');
      this.joinLobby();
    });

    this.socket.on('signin status', (data) => {
      if (data.isSignedIn) {
        console.log('Successfully signed in as:', data.username);
      }
    });

    this.socket.on('room joined', (data) => {
      console.log('Joined room:', data.roomName);
      this.currentRoom = data.roomId;
    });
  }

  joinLobby() {
    this.socket.emit('join lobby', {
      username: this.username,
      location: this.location
    });
  }

  joinRoom(roomId, accessCode = null) {
    this.socket.emit('join room', { roomId, accessCode });
  }

  sendMessage(message) {
    if (!this.currentRoom) return;
    
    this.socket.emit('chat update', {
      diff: {
        type: 'full-replace',
        text: message
      }
    });
  }
}

// Create and start the bot
const bot = new TalkomaticBot();
```

## Limitations and Rules

> **Warning:** Be mindful of these important limitations:
- Maximum message length: 5000 characters
- Username length: 12 characters
- Location length: 12 characters
- Room creation cooldown: 30 seconds
- Maximum users per room: 5

## Bot Capabilities

Your bot can:
1. Join the lobby
2. Create rooms
3. Join existing rooms
4. Send and receive messages
5. Track user presence
6. Respond to votes
7. Handle room events

> **Info:** Bots use the same Socket.IO events as regular clients but can automate responses and actions.

## Next Steps

1. Read the Socket.IO Events documentation to understand available events
2. Review the Authentication guide for securing your bot
3. Implement message handling logic
4. Add room management capabilities
5. Follow best practices for reliable bot operation

> **Tip:** Start with a simple bot that just joins rooms and listens to messages before adding more complex functionality.