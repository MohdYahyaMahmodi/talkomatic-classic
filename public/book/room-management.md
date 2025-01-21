# Room Management

This guide covers how to manage room interactions in your Talkomatic bot.

## Room Manager Class

```javascript
class RoomManager {
  constructor(socket) {
    this.socket = socket;
    this.currentRoom = null;
    this.rooms = new Map();
    this.setupRoomHandlers();
  }

  setupRoomHandlers() {
    // Room events
    this.socket.on('room joined', this.handleRoomJoined.bind(this));
    this.socket.on('user joined', this.handleUserJoined.bind(this));
    this.socket.on('user left', this.handleUserLeft.bind(this));
    this.socket.on('room update', this.handleRoomUpdate.bind(this));
    this.socket.on('update votes', this.handleVotes.bind(this));
    this.socket.on('kicked', this.handleKicked.bind(this));
  }

  handleRoomJoined(data) {
    this.currentRoom = {
      id: data.roomId,
      name: data.roomName,
      type: data.roomType,
      users: data.users,
      layout: data.layout,
      votes: data.votes
    };
    
    this.rooms.set(data.roomId, this.currentRoom);
    console.log(`Joined room: ${data.roomName}`);
  }

  handleUserJoined(data) {
    const room = this.rooms.get(data.roomId);
    if (room) {
      room.users.push({
        id: data.id,
        username: data.username,
        location: data.location
      });
      this.onUserJoined?.(data); // Optional callback
    }
  }

  handleUserLeft(userId) {
    if (this.currentRoom) {
      this.currentRoom.users = this.currentRoom.users.filter(
        user => user.id !== userId
      );
      this.onUserLeft?.(userId); // Optional callback
    }
  }

  handleRoomUpdate(data) {
    if (this.currentRoom && this.currentRoom.id === data.id) {
      Object.assign(this.currentRoom, data);
      this.onRoomUpdate?.(data); // Optional callback
    }
  }

  handleVotes(votes) {
    if (this.currentRoom) {
      this.currentRoom.votes = votes;
      this.checkVoteStatus();
    }
  }

  handleKicked() {
    console.log('Bot was kicked from room');
    this.currentRoom = null;
    this.onKicked?.(); // Optional callback
    // Implement rejoin logic if needed
  }

  // Room actions
  async createRoom(options) {
    const {
      name = 'Bot Room',
      type = 'public',
      layout = 'horizontal',
      accessCode = null
    } = options;

    return new Promise((resolve, reject) => {
      this.socket.emit('create room', {
        name,
        type,
        layout,
        accessCode
      });

      this.socket.once('room created', (roomId) => {
        resolve(roomId);
      });

      this.socket.once('error', reject);
    });
  }

  async joinRoom(roomId, accessCode = null) {
    return new Promise((resolve, reject) => {
      this.socket.emit('join room', { roomId, accessCode });

      const timeout = setTimeout(() => {
        reject(new Error('Join room timeout'));
      }, 5000);

      this.socket.once('room joined', (data) => {
        clearTimeout(timeout);
        resolve(data);
      });

      this.socket.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  leaveRoom() {
    if (this.currentRoom) {
      this.socket.emit('leave room');
      this.currentRoom = null;
    }
  }

  // Vote management
  checkVoteStatus() {
    if (!this.currentRoom || !this.currentRoom.votes) return;

    const votesAgainstBot = Object.values(this.currentRoom.votes)
      .filter(targetId => targetId === this.socket.id)
      .length;

    const voteThreshold = Math.floor(this.currentRoom.users.length / 2);

    if (votesAgainstBot > voteThreshold) {
      // Bot is being voted out - implement appropriate response
      this.handleHighVoteCount();
    }
  }

  handleHighVoteCount() {
    // Implement your bot's response to high vote counts
    // Example: leave room, apologize, change behavior, etc.
    console.log('High vote count detected against bot');
  }
}

// Example usage with automatic room management
class RoomBot extends RoomManager {
  constructor(socket) {
    super(socket);
    this.setupCallbacks();
  }

  setupCallbacks() {
    this.onUserJoined = this.handleNewUser.bind(this);
    this.onUserLeft = this.handleUserExit.bind(this);
    this.onKicked = this.handleBotKicked.bind(this);
  }

  handleNewUser(data) {
    this.socket.emit('chat update', {
      diff: {
        type: 'full-replace',
        text: `Welcome ${data.username}! 👋`
      }
    });
  }

  handleUserExit(userId) {
    const user = this.currentRoom.users.find(u => u.id === userId);
    if (user) {
      this.socket.emit('chat update', {
        diff: {
          type: 'full-replace',
          text: `Goodbye ${user.username}! 👋`
        }
      });
    }
  }

  handleBotKicked() {
    console.log('Bot was kicked - implementing recovery strategy');
    // Implement rejoin logic or move to another room
  }
}
```

> **Warning:** Always implement proper error handling and rate limiting when managing rooms.