// ============================================================================
// games.js - Server-side Game Logic
// ============================================================================

class GameManager {
  constructor() {
    this.games = new Map(); // gameId -> Game instance
    this.roomGames = new Map(); // roomId -> Set of gameIds
    this.playerGames = new Map(); // userId -> gameId
  }

  createGame(roomId, gameType, player1Id, player1Username) {
    const gameId = this.generateGameId();

    let game;
    switch (gameType) {
      case "tictactoe":
        game = new TicTacToeGame(gameId, roomId, player1Id, player1Username);
        break;
      default:
        throw new Error(`Unknown game type: ${gameType}`);
    }

    this.games.set(gameId, game);

    // Track games by room
    if (!this.roomGames.has(roomId)) {
      this.roomGames.set(roomId, new Set());
    }
    this.roomGames.get(roomId).add(gameId);

    // Track player's active game
    this.playerGames.set(player1Id, gameId);

    return game;
  }

  joinGame(gameId, player2Id, player2Username) {
    const game = this.games.get(gameId);
    if (!game) {
      throw new Error("Game not found");
    }

    if (game.state !== "waiting") {
      throw new Error("Game is not accepting players");
    }

    if (game.players.length >= 2) {
      throw new Error("Game is full");
    }

    game.addPlayer(player2Id, player2Username);
    this.playerGames.set(player2Id, gameId);

    return game;
  }

  getGame(gameId) {
    return this.games.get(gameId);
  }

  getPlayerGame(userId) {
    const gameId = this.playerGames.get(userId);
    return gameId ? this.games.get(gameId) : null;
  }

  getRoomGames(roomId) {
    const gameIds = this.roomGames.get(roomId) || new Set();
    return Array.from(gameIds)
      .map((id) => this.games.get(id))
      .filter(Boolean);
  }

  removeGame(gameId) {
    const game = this.games.get(gameId);
    if (!game) return;

    // Remove from room tracking
    const roomGames = this.roomGames.get(game.roomId);
    if (roomGames) {
      roomGames.delete(gameId);
      if (roomGames.size === 0) {
        this.roomGames.delete(game.roomId);
      }
    }

    // Remove from player tracking
    game.players.forEach((player) => {
      this.playerGames.delete(player.id);
    });

    // Remove the game
    this.games.delete(gameId);
  }

  makeMove(gameId, playerId, move) {
    const game = this.games.get(gameId);
    if (!game) {
      throw new Error("Game not found");
    }

    return game.makeMove(playerId, move);
  }

  generateGameId() {
    return "game_" + Math.random().toString(36).substr(2, 9);
  }

  // Cleanup inactive games
  cleanupGames() {
    const now = Date.now();
    const gamesToRemove = [];

    for (const [gameId, game] of this.games) {
      // Remove games that have been inactive for 30 minutes
      if (now - game.lastActivity > 30 * 60 * 1000) {
        gamesToRemove.push(gameId);
      }
    }

    gamesToRemove.forEach((gameId) => this.removeGame(gameId));

    if (gamesToRemove.length > 0) {
      console.log(`Cleaned up ${gamesToRemove.length} inactive games`);
    }
  }
}

class TicTacToeGame {
  constructor(gameId, roomId, player1Id, player1Username) {
    this.id = gameId;
    this.roomId = roomId;
    this.type = "tictactoe";
    this.state = "waiting"; // waiting, playing, finished
    this.players = [
      {
        id: player1Id,
        username: player1Username,
        symbol: "X",
        score: 0,
      },
    ];
    this.currentPlayerIndex = 0;
    this.board = Array(9).fill("");
    this.winner = null;
    this.winningLine = null;
    this.moveHistory = [];
    this.spectators = new Set();
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    this.gameNumber = 1;
  }

  addPlayer(playerId, username) {
    if (this.players.length >= 2) {
      throw new Error("Game is full");
    }

    this.players.push({
      id: playerId,
      username: username,
      symbol: "O",
      score: 0,
    });

    if (this.players.length === 2) {
      this.state = "playing";
    }

    this.lastActivity = Date.now();
  }

  addSpectator(userId) {
    this.spectators.add(userId);
    this.lastActivity = Date.now();
  }

  removeSpectator(userId) {
    this.spectators.delete(userId);
    this.lastActivity = Date.now();
  }

  makeMove(playerId, position) {
    this.lastActivity = Date.now();

    if (this.state !== "playing") {
      throw new Error("Game is not in playing state");
    }

    if (this.players[this.currentPlayerIndex].id !== playerId) {
      throw new Error("Not your turn");
    }

    if (position < 0 || position > 8) {
      throw new Error("Invalid position");
    }

    if (this.board[position] !== "") {
      throw new Error("Position already taken");
    }

    // Make the move
    const currentPlayer = this.players[this.currentPlayerIndex];
    this.board[position] = currentPlayer.symbol;

    // Record the move
    this.moveHistory.push({
      playerId: playerId,
      username: currentPlayer.username,
      symbol: currentPlayer.symbol,
      position: position,
      timestamp: Date.now(),
    });

    // Check for winner
    const winner = this.checkWinner();
    if (winner) {
      this.winner = winner.symbol;
      this.winningLine = winner.line;
      this.state = "finished";

      // Update score
      const winningPlayer = this.players.find(
        (p) => p.symbol === winner.symbol
      );
      if (winningPlayer) {
        winningPlayer.score++;
      }
    } else if (this.board.every((cell) => cell !== "")) {
      // It's a draw
      this.state = "finished";
      this.winner = "draw";
    } else {
      // Switch turns
      this.currentPlayerIndex = 1 - this.currentPlayerIndex;
    }

    return {
      valid: true,
      gameState: this.getGameState(),
    };
  }

  checkWinner() {
    const lines = [
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8], // Rows
      [0, 3, 6],
      [1, 4, 7],
      [2, 5, 8], // Columns
      [0, 4, 8],
      [2, 4, 6], // Diagonals
    ];

    for (const line of lines) {
      const [a, b, c] = line;
      if (
        this.board[a] &&
        this.board[a] === this.board[b] &&
        this.board[a] === this.board[c]
      ) {
        return {
          symbol: this.board[a],
          line: line,
        };
      }
    }

    return null;
  }

  resetGame() {
    this.board = Array(9).fill("");
    this.state = "playing";
    this.winner = null;
    this.winningLine = null;
    this.currentPlayerIndex = this.gameNumber % 2; // Alternate who goes first
    this.moveHistory = [];
    this.gameNumber++;
    this.lastActivity = Date.now();
  }

  getGameState() {
    return {
      id: this.id,
      type: this.type,
      state: this.state,
      players: this.players,
      currentPlayerIndex: this.currentPlayerIndex,
      board: this.board,
      winner: this.winner,
      winningLine: this.winningLine,
      moveHistory: this.moveHistory,
      spectatorCount: this.spectators.size,
      gameNumber: this.gameNumber,
    };
  }

  canPlayerPlay(userId) {
    return this.players.some((p) => p.id === userId);
  }

  isPlayerTurn(userId) {
    return (
      this.state === "playing" &&
      this.players[this.currentPlayerIndex].id === userId
    );
  }
}

// Export for use in server.js
module.exports = { GameManager, TicTacToeGame };
