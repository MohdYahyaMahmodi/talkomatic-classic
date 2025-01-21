# Building a Tic-tac-toe Bot for Talkomatic

A guide to creating a Tic-tac-toe bot that hosts its own room on Talkomatic.

## Prerequisites

Before starting, you need:
- Node.js (v14 or higher)
- npm (Node Package Manager)
- Basic JavaScript knowledge
- A text editor

## Project Setup

1. Create your project:
```bash
mkdir talkomatic-tictactoe-bot
cd talkomatic-tictactoe-bot
npm init -y
```

2. Install dependencies:
```bash
npm install socket.io-client dotenv
```

3. Create `.env` file:
```plaintext
BOT_USERNAME=TicTacToeBot
BOT_LOCATION=GameRoom
BOT_ROOM_NAME=Tic-Tac-Toe Game Room
SERVER_URL=https://classic.talkomatic.co
```

## Bot Implementation

Create `bot.js`:

```javascript
const { io } = require('socket.io-client');
require('dotenv').config();

class TicTacToeBot {
  constructor() {
    this.socket = io(process.env.SERVER_URL, {
      transports: ['websocket'],
      autoConnect: true
    });

    // Bot configuration
    this.username = process.env.BOT_USERNAME;
    this.location = process.env.BOT_LOCATION;
    this.roomName = process.env.BOT_ROOM_NAME;
    
    this.currentRoom = null;
    this.games = new Map(); // Track multiple games

    this.setupEventHandlers();
  }

  setupEventHandlers() {
    // Connection events
    this.socket.on('connect', () => {
      console.log('Connected to Talkomatic');
      this.joinLobby();
    });

    this.socket.on('signin status', (data) => {
      if (data.isSignedIn) {
        console.log('Signed in as:', data.username);
        this.createGameRoom();
      }
    });

    this.socket.on('room created', (roomId) => {
      console.log('Room created:', roomId);
      this.joinRoom(roomId);
    });

    this.socket.on('room joined', (data) => {
      console.log('Joined room:', data.roomName);
      this.currentRoom = data.roomId;
      this.sendMessage(this.getWelcomeMessage());
    });

    this.socket.on('user joined', (data) => {
      if (data.username !== this.username) {
        console.log('User joined:', data.username);
        this.sendMessage(`Welcome ${data.username}! Type !play to start a game.`);
      }
    });

    this.socket.on('user left', (userId) => {
      if (this.games.has(userId)) {
        this.endGame(userId);
        this.sendMessage(`Game ended - player left.`);
      }
    });

    this.socket.on('chat update', (data) => {
      if (!data.diff || data.diff.type !== 'full-replace') return;
      
      const message = data.diff.text.trim().toLowerCase();
      if (message.startsWith('!')) {
        this.handleCommand(data.userId, data.username, message);
      }
    });

    // Error handling
    this.socket.on('error', (error) => {
      console.error('Socket error:', error);
      this.reconnect();
    });

    this.socket.on('disconnect', () => {
      console.log('Disconnected from server');
      this.reconnect();
    });
  }

  reconnect() {
    setTimeout(() => {
      console.log('Attempting to reconnect...');
      this.socket.connect();
    }, 5000);
  }

  createGameRoom() {
    this.socket.emit('create room', {
      name: this.roomName,
      type: 'public',
      layout: 'horizontal'
    });
  }

  joinLobby() {
    this.socket.emit('join lobby', {
      username: this.username,
      location: this.location
    });
  }

  joinRoom(roomId) {
    this.socket.emit('join room', { roomId });
  }

  handleCommand(userId, username, message) {
    const [command, ...args] = message.split(' ');

    switch (command) {
      case '!play':
        this.startGame(userId, username);
        break;
      case '!move':
        this.handleMove(userId, args[0]);
        break;
      case '!quit':
        this.endGame(userId);
        break;
      case '!help':
        this.sendHelp();
        break;
    }
  }

  startGame(userId, username) {
    if (this.games.has(userId)) {
      this.sendMessage('You already have a game in progress!');
      return;
    }

    const game = {
      player: { id: userId, username },
      board: Array(9).fill(null),
      playerSymbol: 'O',
      botSymbol: 'X',
      currentTurn: 'player'
    };

    this.games.set(userId, game);
    this.sendGameStart(userId);
  }

  handleMove(userId, position) {
    const game = this.games.get(userId);
    if (!game) {
      this.sendMessage('No game in progress. Type !play to start.');
      return;
    }

    if (game.currentTurn !== 'player') {
      this.sendMessage("Not your turn!");
      return;
    }

    const pos = parseInt(position) - 1;
    if (isNaN(pos) || pos < 0 || pos > 8) {
      this.sendMessage('Invalid move! Use numbers 1-9.');
      return;
    }

    if (game.board[pos]) {
      this.sendMessage('That position is taken!');
      return;
    }

    // Make player's move
    game.board[pos] = game.playerSymbol;
    this.displayBoard(game);

    if (this.checkWinner(game.board)) {
      this.sendMessage(`🎉 ${game.player.username} wins!`);
      this.endGame(userId);
      return;
    }

    if (this.isBoardFull(game.board)) {
      this.sendMessage("It's a draw!");
      this.endGame(userId);
      return;
    }

    // Bot's turn
    game.currentTurn = 'bot';
    setTimeout(() => this.makeBotMove(userId), 1000);
  }

  makeBotMove(userId) {
    const game = this.games.get(userId);
    if (!game) return;

    const pos = this.calculateBestMove(game);
    game.board[pos] = game.botSymbol;
    this.displayBoard(game);

    if (this.checkWinner(game.board)) {
      this.sendMessage('I win! 🤖');
      this.endGame(userId);
      return;
    }

    if (this.isBoardFull(game.board)) {
      this.sendMessage("It's a draw!");
      this.endGame(userId);
      return;
    }

    game.currentTurn = 'player';
    this.sendMessage(`Your turn, ${game.player.username}!`);
  }

  calculateBestMove(game) {
    // Check for winning move
    for (let i = 0; i < 9; i++) {
      if (!game.board[i]) {
        game.board[i] = game.botSymbol;
        if (this.checkWinner(game.board)) {
          game.board[i] = null;
          return i;
        }
        game.board[i] = null;
      }
    }

    // Block player's winning move
    for (let i = 0; i < 9; i++) {
      if (!game.board[i]) {
        game.board[i] = game.playerSymbol;
        if (this.checkWinner(game.board)) {
          game.board[i] = null;
          return i;
        }
        game.board[i] = null;
      }
    }

    // Take center
    if (!game.board[4]) return 4;

    // Take corners
    const corners = [0, 2, 6, 8];
    const availableCorners = corners.filter(i => !game.board[i]);
    if (availableCorners.length > 0) {
      return availableCorners[Math.floor(Math.random() * availableCorners.length)];
    }

    // Take any available space
    for (let i = 0; i < 9; i++) {
      if (!game.board[i]) return i;
    }
  }

  checkWinner(board) {
    const lines = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
      [0, 3, 6], [1, 4, 7], [2, 5, 8], // Columns
      [0, 4, 8], [2, 4, 6] // Diagonals
    ];

    return lines.some(([a, b, c]) =>
      board[a] && board[a] === board[b] && board[a] === board[c]
    );
  }

  isBoardFull(board) {
    return board.every(cell => cell !== null);
  }

  displayBoard(game) {
    const board = game.board.map(cell => cell || '·');
    const display = [
      '```',
      ` ${board[0]} │ ${board[1]} │ ${board[2]} `,
      '───┼───┼───',
      ` ${board[3]} │ ${board[4]} │ ${board[5]} `,
      '───┼───┼───',
      ` ${board[6]} │ ${board[7]} │ ${board[8]} `,
      '```'
    ].join('\n');

    this.sendMessage(display);
  }

  endGame(userId) {
    this.games.delete(userId);
  }

  sendMessage(text) {
    this.socket.emit('chat update', {
      diff: {
        type: 'full-replace',
        text: text
      }
    });
  }

  getWelcomeMessage() {
    return [
      '🎮 Welcome to Tic-tac-toe!',
      '',
      'Commands:',
      '!play - Start a new game',
      '!move <1-9> - Make your move',
      '!quit - End your game',
      '!help - Show this help'
    ].join('\n');
  }

  sendHelp() {
    this.sendMessage(this.getWelcomeMessage());
  }

  sendGameStart(userId) {
    const game = this.games.get(userId);
    const message = [
      `🎮 Starting game with ${game.player.username}!`,
      'Board positions:',
      '```',
      ' 1 │ 2 │ 3 ',
      '───┼───┼───',
      ' 4 │ 5 │ 6 ',
      '───┼───┼───',
      ' 7 │ 8 │ 9 ',
      '```',
      "You're O, I'm X. Your turn first!"
    ].join('\n');

    this.sendMessage(message);
    this.displayBoard(game);
  }
}

// Start the bot
const bot = new TicTacToeBot();
```

## Running the Bot

1. Start the bot:
```bash
node bot.js
```

## How to Play Against the Bot

1. Visit https://classic.talkomatic.co/
2. Look for the room named "Tic-Tac-Toe Game Room" in the lobby
3. Join the room
4. Use these commands to play:
   - `!play` - Start a new game
   - `!move <1-9>` - Make your move
   - `!quit` - End your game
   - `!help` - Show commands

> **Note:** The bot creates its own public room and can handle multiple games simultaneously with different players.

> **Info:** The bot uses a simple AI strategy:
1. Try to win if possible
2. Block opponent's winning moves
3. Take center if available
4. Take corners
5. Take any available space

> **Tip:** Players can test their own bots by connecting to the same room and playing against this bot.

This implementation provides a complete Tic-tac-toe bot that:
- Automatically creates and manages its own room
- Handles multiple simultaneous games
- Implements basic AI strategy
- Provides clear feedback and game state
- Handles disconnections and errors gracefully