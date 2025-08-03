// ============================================================================
// games-client.js - Client-side Game Logic
// ============================================================================

class GameClient {
  constructor() {
    this.currentGame = null;
    this.gameModal = null;
    this.isPlayer = false;
    this.isSpectator = false;
    this.playerSymbol = null;
  }

  // Initialize game client
  init() {
    this.createGameModal();
    this.setupSocketListeners();
  }

  // Create the game modal structure
  createGameModal() {
    // Remove existing modal if it exists
    const existingModal = document.getElementById("gameModal");
    if (existingModal) {
      existingModal.remove();
    }

    this.gameModal = document.createElement("div");
    this.gameModal.id = "gameModal";
    this.gameModal.className = "game-modal";
    this.gameModal.innerHTML = `
      <div class="game-modal-content">
        <div class="game-modal-header">
          <h3 id="gameTitle">Game</h3>
          <button class="game-close-btn" id="gameCloseBtn">&times;</button>
        </div>
        <div class="game-modal-body" id="gameModalBody">
          <!-- Game content will be inserted here -->
        </div>
        <div class="game-modal-footer" id="gameModalFooter">
          <!-- Game controls will be inserted here -->
        </div>
      </div>
    `;

    // Add styles
    this.gameModal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      z-index: 10000;
      display: none;
      justify-content: center;
      align-items: center;
    `;

    const modalContent = this.gameModal.querySelector(".game-modal-content");
    modalContent.style.cssText = `
      background: #1a1a1a;
      border: 2px solid #ff9800;
      border-radius: 10px;
      max-width: 90vw;
      max-height: 90vh;
      min-width: 400px;
      color: white;
      position: relative;
      overflow: hidden;
    `;

    const header = this.gameModal.querySelector(".game-modal-header");
    header.style.cssText = `
      padding: 15px 20px;
      border-bottom: 1px solid #ff9800;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #000;
    `;

    const title = this.gameModal.querySelector("#gameTitle");
    title.style.cssText = `
      margin: 0;
      color: #ff9800;
      font-size: 18px;
    `;

    const closeBtn = this.gameModal.querySelector(".game-close-btn");
    closeBtn.style.cssText = `
      background: none;
      border: none;
      color: #ff9800;
      font-size: 24px;
      cursor: pointer;
      padding: 0;
      width: 30px;
      height: 30px;
      display: flex;
      align-items: center;
      justify-content: center;
    `;

    const body = this.gameModal.querySelector(".game-modal-body");
    body.style.cssText = `
      padding: 20px;
      min-height: 300px;
    `;

    const footer = this.gameModal.querySelector(".game-modal-footer");
    footer.style.cssText = `
      padding: 15px 20px;
      border-top: 1px solid #333;
      background: #000;
    `;

    // Event listeners
    closeBtn.addEventListener("click", () => this.closeGame());

    this.gameModal.addEventListener("click", (e) => {
      if (e.target === this.gameModal) {
        this.closeGame();
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.gameModal.style.display === "flex") {
        this.closeGame();
      }
    });

    document.body.appendChild(this.gameModal);
  }

  // Setup socket event listeners for games
  setupSocketListeners() {
    // Game created
    socket.on("game created", (data) => {
      console.log("Game created:", data);
      this.currentGame = data.game;
      this.isPlayer = true;
      this.playerSymbol = data.playerSymbol;
      this.showGame(data.game);
    });

    // Game joined
    socket.on("game joined", (data) => {
      console.log("Game joined:", data);
      this.currentGame = data.game;
      this.isPlayer = true;
      this.playerSymbol = data.playerSymbol;
      this.showGame(data.game);
    });

    // Game spectate
    socket.on("game spectate", (data) => {
      console.log("Spectating game:", data);
      this.currentGame = data.game;
      this.isPlayer = false;
      this.isSpectator = true;
      this.showGame(data.game);
    });

    // Game updated
    socket.on("game updated", (data) => {
      if (this.currentGame && this.currentGame.id === data.game.id) {
        this.currentGame = data.game;
        this.updateGameDisplay(data.game);
      }
    });

    // Game ended
    socket.on("game ended", (data) => {
      if (this.currentGame && this.currentGame.id === data.gameId) {
        console.log("Game ended:", data);
        this.showGameEndMessage(data);
      }
    });

    // Game error
    socket.on("game error", (data) => {
      console.error("Game error:", data);
      this.showGameError(data.message);
    });

    // Game list updated
    socket.on("room games updated", (data) => {
      this.updateAvailableGames(data.games);
    });
  }

  // Show game interface
  showGame(game) {
    if (!game) return;

    console.log("showGame called:", {
      gameId: game.id,
      gameType: game.type,
      currentUserId:
        typeof currentUserId !== "undefined" ? currentUserId : "undefined",
      isPlayer: this.isPlayer,
      playerSymbol: this.playerSymbol,
      gameState: game.state,
      currentPlayerIndex: game.currentPlayerIndex,
    });

    const title = this.gameModal.querySelector("#gameTitle");
    const body = this.gameModal.querySelector("#gameModalBody");
    const footer = this.gameModal.querySelector("#gameModalFooter");

    // Clear previous content completely
    body.innerHTML = "";
    footer.innerHTML = "";

    // Set title
    title.textContent = this.getGameTitle(game);

    // Render game based on type
    switch (game.type) {
      case "tictactoe":
        this.renderTicTacToe(game, body, footer);
        break;
      default:
        body.innerHTML = "<p>Unknown game type</p>";
    }

    // Show modal
    this.gameModal.style.display = "flex";
  }

  // Render Tic Tac Toe game
  renderTicTacToe(game, body, footer) {
    // Game info section
    const gameInfo = document.createElement("div");
    gameInfo.className = "game-info";
    gameInfo.style.cssText = `
      margin-bottom: 20px;
      text-align: center;
    `;

    // Player info
    const playersInfo = document.createElement("div");
    playersInfo.className = "players-info";
    playersInfo.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 15px;
      padding: 10px;
      background: #333;
      border-radius: 5px;
    `;

    if (game.players.length >= 2) {
      const player1 = game.players[0];
      const player2 = game.players[1];

      playersInfo.innerHTML = `
        <div class="player-info ${
          game.currentPlayerIndex === 0 ? "current-turn" : ""
        }" 
             style="text-align: center; ${
               game.currentPlayerIndex === 0
                 ? "color: #ff9800; font-weight: bold;"
                 : ""
             }">
          <div>${player1.username}</div>
          <div style="font-size: 24px; margin: 5px 0;">${player1.symbol}</div>
          <div>Score: ${player1.score}</div>
        </div>
        <div style="font-size: 20px; color: #666;">VS</div>
        <div class="player-info ${
          game.currentPlayerIndex === 1 ? "current-turn" : ""
        }" 
             style="text-align: center; ${
               game.currentPlayerIndex === 1
                 ? "color: #ff9800; font-weight: bold;"
                 : ""
             }">
          <div>${player2.username}</div>
          <div style="font-size: 24px; margin: 5px 0;">${player2.symbol}</div>
          <div>Score: ${player2.score}</div>
        </div>
      `;
    } else {
      playersInfo.innerHTML = `
        <div class="waiting-message" style="text-align: center; width: 100%; color: #ff9800;">
          Waiting for another player to join...
        </div>
      `;
    }

    // Game status
    const gameStatus = document.createElement("div");
    gameStatus.className = "game-status";
    gameStatus.style.cssText = `
      text-align: center;
      margin: 10px 0;
      font-size: 16px;
      min-height: 20px;
    `;
    gameStatus.textContent = this.getGameStatusText(game);

    gameInfo.appendChild(playersInfo);
    gameInfo.appendChild(gameStatus);

    // Game board
    const gameBoard = document.createElement("div");
    gameBoard.className = "tic-tac-toe-board";
    gameBoard.style.cssText = `
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      grid-gap: 3px;
      width: 300px;
      height: 300px;
      margin: 20px auto;
      background: #333;
      border: 2px solid #ff9800;
      border-radius: 10px;
      padding: 10px;
    `;

    // Create board cells
    for (let i = 0; i < 9; i++) {
      const cell = document.createElement("div");
      cell.className = "board-cell";
      cell.dataset.position = i;
      cell.style.cssText = `
        background: #000;
        border: 1px solid #666;
        border-radius: 5px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 36px;
        font-weight: bold;
        cursor: ${this.canMakeMove(game, i) ? "pointer" : "default"};
        transition: all 0.2s ease;
      `;

      // Set cell content
      if (game.board[i]) {
        cell.textContent = game.board[i];
        cell.style.color = game.board[i] === "X" ? "#ff9800" : "#00bcd4";
      }

      // Highlight winning line
      if (game.winningLine && game.winningLine.includes(i)) {
        cell.style.background = "#4caf50";
        cell.style.boxShadow = "0 0 10px #4caf50";
      }

      // Add hover effect and click handler
      if (this.canMakeMove(game, i)) {
        cell.style.cursor = "pointer";

        cell.addEventListener("mouseenter", () => {
          if (!game.board[i]) {
            cell.style.background = "#333";
            cell.style.transform = "scale(1.05)";
          }
        });

        cell.addEventListener("mouseleave", () => {
          if (
            !game.board[i] &&
            (!game.winningLine || !game.winningLine.includes(i))
          ) {
            cell.style.background = "#000";
            cell.style.transform = "scale(1)";
          }
        });

        // Add click handler with better error handling
        cell.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();

          console.log(`Cell ${i} clicked`);

          if (this.canMakeMove(game, i)) {
            console.log(`Making move at position ${i}`);
            this.makeMove(i);
          } else {
            console.log(`Cannot make move at position ${i}`);

            // Show helpful error message
            if (!this.isPlayer) {
              this.showGameError("You are not a player in this game.");
            } else if (game.state !== "playing") {
              this.showGameError("Game is not currently active.");
            } else if (game.board[i]) {
              this.showGameError("This position is already taken.");
            } else if (
              game.players[game.currentPlayerIndex]?.id !== currentUserId
            ) {
              const currentPlayer = game.players[game.currentPlayerIndex];
              this.showGameError(
                `It's ${currentPlayer?.username || "the other player"}'s turn.`
              );
            }
          }
        });
      } else {
        cell.style.cursor = "default";
      }

      gameBoard.appendChild(cell);
    }

    // Spectator info
    if (this.isSpectator) {
      const spectatorInfo = document.createElement("div");
      spectatorInfo.style.cssText = `
        text-align: center;
        color: #ffeb3b;
        font-weight: bold;
        margin: 10px 0;
        padding: 10px;
        background: rgba(255, 235, 59, 0.1);
        border-radius: 5px;
      `;
      spectatorInfo.textContent = `👁️ You are spectating this game`;
      gameInfo.appendChild(spectatorInfo);
    }

    body.appendChild(gameInfo);
    body.appendChild(gameBoard);

    // Footer buttons
    this.renderGameFooter(game, footer);
  }

  // Render game footer with controls
  renderGameFooter(game, footer) {
    const buttonContainer = document.createElement("div");
    buttonContainer.style.cssText = `
      display: flex;
      gap: 10px;
      justify-content: center;
      align-items: center;
    `;

    // New Game button (for players when game is finished)
    if (this.isPlayer && game.state === "finished") {
      const newGameBtn = document.createElement("button");
      newGameBtn.textContent = "New Game";
      newGameBtn.style.cssText = `
        padding: 10px 20px;
        background: #4caf50;
        color: white;
        border: none;
        border-radius: 5px;
        cursor: pointer;
        font-size: 14px;
        font-weight: bold;
      `;

      newGameBtn.addEventListener("click", () => {
        socket.emit("new game", { gameId: game.id });
      });

      buttonContainer.appendChild(newGameBtn);
    }

    // Leave Game button
    const leaveBtn = document.createElement("button");
    leaveBtn.textContent = this.isPlayer ? "Leave Game" : "Stop Watching";
    leaveBtn.style.cssText = `
      padding: 10px 20px;
      background: #f44336;
      color: white;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      font-size: 14px;
      font-weight: bold;
    `;

    leaveBtn.addEventListener("click", () => {
      this.leaveGame();
    });

    buttonContainer.appendChild(leaveBtn);

    // Game info
    if (game.spectatorCount > 0) {
      const spectatorCount = document.createElement("span");
      spectatorCount.style.cssText = `
        color: #666;
        font-size: 12px;
        margin-left: 10px;
      `;
      spectatorCount.textContent = `${game.spectatorCount} watching`;
      buttonContainer.appendChild(spectatorCount);
    }

    footer.appendChild(buttonContainer);
  }

  // Update game display when game state changes
  updateGameDisplay(game) {
    if (this.gameModal.style.display !== "flex") return;

    const body = this.gameModal.querySelector("#gameModalBody");
    const footer = this.gameModal.querySelector("#gameModalFooter");

    // Clear previous content completely before re-rendering
    body.innerHTML = "";
    footer.innerHTML = "";

    // Re-render the game
    this.renderTicTacToe(game, body, footer);
  }

  // Helper methods
  getGameTitle(game) {
    switch (game.type) {
      case "tictactoe":
        return `Tic Tac Toe - Game ${game.gameNumber}`;
      default:
        return "Game";
    }
  }

  getGameStatusText(game) {
    if (game.state === "waiting") {
      return "Waiting for players...";
    } else if (game.state === "finished") {
      if (game.winner === "draw") {
        return "It's a draw! 🤝";
      } else {
        const winner = game.players.find((p) => p.symbol === game.winner);
        return `🎉 ${winner ? winner.username : game.winner} wins!`;
      }
    } else if (game.state === "playing") {
      const currentPlayer = game.players[game.currentPlayerIndex];
      if (this.isPlayer) {
        const isMyTurn = currentPlayer.id === currentUserId;
        return isMyTurn
          ? "Your turn!"
          : `Waiting for ${currentPlayer.username}...`;
      } else {
        return `${currentPlayer.username}'s turn`;
      }
    }
    return "";
  }

  canMakeMove(game, position) {
    console.log("canMakeMove check:", {
      isPlayer: this.isPlayer,
      gameState: game.state,
      boardPosition: game.board[position],
      currentPlayerIndex: game.currentPlayerIndex,
      currentUserId:
        typeof currentUserId !== "undefined" ? currentUserId : "undefined",
      currentPlayerInGame: game.players[game.currentPlayerIndex]?.id,
      playersInGame: game.players.map((p) => ({
        id: p.id,
        username: p.username,
      })),
    });

    return (
      this.isPlayer &&
      game.state === "playing" &&
      !game.board[position] &&
      game.players[game.currentPlayerIndex] &&
      game.players[game.currentPlayerIndex].id === currentUserId
    );
  }

  // Game actions
  createGame(gameType) {
    socket.emit("create game", {
      roomId: currentRoomId,
      gameType: gameType,
    });
  }

  joinGame(gameId) {
    socket.emit("join game", { gameId: gameId });
  }

  spectateGame(gameId) {
    socket.emit("spectate game", { gameId: gameId });
  }

  makeMove(position) {
    if (!this.currentGame) {
      console.error("No current game");
      return;
    }

    console.log("Making move:", {
      gameId: this.currentGame.id,
      position: position,
      currentUserId:
        typeof currentUserId !== "undefined" ? currentUserId : "undefined",
    });

    socket.emit("game move", {
      gameId: this.currentGame.id,
      move: { position: position },
    });
  }

  leaveGame() {
    if (this.currentGame) {
      socket.emit("leave game", { gameId: this.currentGame.id });
      this.closeGame();
    }
  }

  closeGame() {
    this.gameModal.style.display = "none";
    this.currentGame = null;
    this.isPlayer = false;
    this.isSpectator = false;
    this.playerSymbol = null;
  }

  // Show available games in room
  showAvailableGames() {
    socket.emit("get room games", { roomId: currentRoomId });
  }

  updateAvailableGames(games) {
    // This could be used to show a list of available games
    // For now, we'll just log them
    console.log("Available games in room:", games);
  }

  showGameError(message) {
    console.error("Game error:", message);

    // You can integrate this with your existing modal system
    if (typeof showErrorModal === "function") {
      showErrorModal(`Game Error: ${message}`);
    } else {
      // Fallback: show in game modal if it's open
      if (this.gameModal && this.gameModal.style.display === "flex") {
        const errorDiv = document.createElement("div");
        errorDiv.style.cssText = `
          position: absolute;
          top: 10px;
          left: 50%;
          transform: translateX(-50%);
          background: #f44336;
          color: white;
          padding: 10px 15px;
          border-radius: 5px;
          z-index: 10001;
          font-size: 14px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        `;
        errorDiv.textContent = message;
        this.gameModal.appendChild(errorDiv);

        // Remove after 3 seconds
        setTimeout(() => {
          if (errorDiv.parentNode) {
            errorDiv.parentNode.removeChild(errorDiv);
          }
        }, 3000);
      } else {
        alert(`Game Error: ${message}`);
      }
    }
  }

  showGameEndMessage(data) {
    // Show end game message if needed
    console.log("Game ended:", data.reason);
  }
}

// Initialize game client when script loads
let gameClient;

// Function to initialize game client
function initializeGameClient() {
  if (typeof socket !== "undefined" && !gameClient) {
    gameClient = new GameClient();
    gameClient.init();
    window.gameClient = gameClient;
    console.log("Game client initialized successfully");
    return true;
  }
  return false;
}

// Try to initialize immediately
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(initializeGameClient, 100);
  });
} else {
  setTimeout(initializeGameClient, 100);
}

// Also try when window loads (fallback)
window.addEventListener("load", () => {
  if (!gameClient) {
    setTimeout(initializeGameClient, 200);
  }
});

// Keep trying until socket is available (up to 10 seconds)
let initAttempts = 0;
const maxAttempts = 50; // 50 attempts * 200ms = 10 seconds

function tryInitialize() {
  if (initializeGameClient()) {
    return; // Success!
  }

  initAttempts++;
  if (initAttempts < maxAttempts) {
    setTimeout(tryInitialize, 200);
  } else {
    console.error("Failed to initialize game client: socket not available");
  }
}

// Start trying to initialize
setTimeout(tryInitialize, 100);
