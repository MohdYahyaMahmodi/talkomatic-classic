// ============================================================================
// games-client.js - Client-side Game Logic (Fixed Version)
// ============================================================================

class GameClient {
  constructor() {
    this.currentGame = null;
    this.gameModal = null;
    this.isPlayer = false;
    this.isSpectator = false;
    this.playerSymbol = null;
    this.serverPlayerId = null; // To store the server's player ID for this game
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

    // Add CSS animations
    if (!document.getElementById("gameAnimations")) {
      const style = document.createElement("style");
      style.id = "gameAnimations";
      style.textContent = `
        @keyframes pulse {
          0% { transform: scale(1.1); }
          50% { transform: scale(1.15); }
          100% { transform: scale(1.1); }
        }
        
        .current-turn {
          animation: pulse 1.5s infinite !important;
        }
      `;
      document.head.appendChild(style);
    }

    const modalContent = this.gameModal.querySelector(".game-modal-content");
    modalContent.style.cssText = `
      background: #1a1a1a;
      border: 2px solid #ff9800;
      border-radius: 10px;
      max-width: 90vw;
      max-height: 85vh;
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
      padding: 8px;
      min-height: 200px;
    `;

    const footer = this.gameModal.querySelector(".game-modal-footer");
    footer.style.cssText = `
      padding: 8px 12px;
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
    // Socket error handling
    socket.on("error", (error) => {
      console.error("Socket error:", error);
    });

    // Socket disconnect handling
    socket.on("disconnect", (reason) => {
      console.log("Socket disconnected:", reason);
    });

    // Socket connect handling
    socket.on("connect", () => {
      console.log("Socket connected");
    });

    // Game created
    socket.on("game:created", (data) => {
      console.log("Game created event received:", data);
      console.log("Current game before update:", this.currentGame);
      
      this.currentGame = data.gameState || { id: data.gameId, type: data.gameType };
      this.isPlayer = true;
      this.playerSymbol = "X"; // First player is X
      
      console.log("Stored current game:", this.currentGame);
      console.log("vsBot flag:", data.vsBot);
      
      if (data.vsBot) {
        // If it's a bot game, show the game interface immediately
        console.log("Showing bot game immediately");
        this.showGame(this.currentGame);
      } else {
        // If it's a player game, show the game interface
        console.log("Showing player game");
        this.showGame(this.currentGame);
      }
    });

    // Game joined
    socket.on("game:joined", (data) => {
      console.log("Game joined event received:", data);
      this.currentGame = data.gameState || { id: data.gameId, type: "tictactoe" };
      this.isPlayer = true;
      this.playerSymbol = data.playerSymbol;
      
      console.log("Stored current game after join:", this.currentGame);
      
      // Store the server's player ID for this game (don't overwrite window.currentUserId)
      if (data.gameState && data.gameState.players) {
        const ourPlayer = data.gameState.players.find(p => p.symbol === data.playerSymbol);
        if (ourPlayer) {
          this.serverPlayerId = ourPlayer.id; // Store server's ID separately
          console.log("Stored server player ID:", this.serverPlayerId);
        }
      }
      
      this.showGame(this.currentGame);
    });

    // Game state update
    socket.on("game:stateUpdate", (data) => {
      if (this.currentGame && this.currentGame.id === data.gameId) {
        this.updateGameDisplay(data.gameState);
      }
    });

    // Game over
    socket.on("game:gameOver", (data) => {
      if (this.currentGame && this.currentGame.id === data.gameId) {
        this.showGameEndMessage(data);
      }
    });

    // Game error
    socket.on("game:error", (data) => {
      console.log("Game error received:", data);
      this.showGameError(data.message || "An error occurred");
    });

    // Game notification
    socket.on("game:notification", (data) => {
      this.showGameNotification(data);
    });

    // Room games list
    socket.on("room:games", (data) => {
      this.updateAvailableGames(data.games);
    });

    // Game spectating
    socket.on("game:spectating", (data) => {
      this.currentGame = data.gameState;
      this.isSpectator = true;
      this.isPlayer = false;
      this.updateGameDisplay(data.gameState);
    });

    // Player left game
    socket.on("game:playerLeft", (data) => {
      if (this.currentGame && this.currentGame.id === data.gameId) {
        console.log("Player left game:", data);
        
        // Check if the current user left the game
        if (data.playerId === this.serverPlayerId || 
            data.playerId === window.currentUserId ||
            (this.currentGame.players && !this.currentGame.players.find(p => 
              p.id === this.serverPlayerId || 
              p.id === window.currentUserId ||
              p.symbol === this.playerSymbol
            ))) {
          // Current user left, close the game
          console.log("Current user left the game, closing modal");
          this.closeGame();
          this.showAvailableGames();
        } else {
          // Another player left, refresh the game display
          console.log("Another player left, refreshing display");
          this.showAvailableGames();
        }
      }
    });
  }

  // Show game notification
  showGameNotification(data) {
    // Create a simple notification that a game is available
    const notification = document.createElement("div");
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #4caf50;
      color: white;
      padding: 15px 20px;
      border-radius: 5px;
      z-index: 10001;
      box-shadow: 0 2px 10px rgba(0,0,0,0.3);
      cursor: pointer;
      max-width: 300px;
    `;
    notification.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 5px;">🎮 Game Available!</div>
      <div>A ${data.gameType} game is ready to join in this room.</div>
    `;
    
    notification.addEventListener("click", () => {
      // Join the game when notification is clicked
      if (typeof socket !== "undefined") {
        const roomId = window.currentRoomId;
        socket.emit("join game", { gameId: data.gameId, roomId: roomId });
      }
      notification.remove();
    });
    
    document.body.appendChild(notification);
    
    // Auto-remove after 10 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        notification.remove();
      }
    }, 10000);
  }

  // Update game display
  updateGameDisplay(gameState = null) {
    if (!this.currentGame) {
      return;
    }
    
    // If we have game state, update the current game and display
    if (gameState) {
      // Update the current game with the new state
      this.currentGame = { ...this.currentGame, ...gameState };
      
      // Check if we need to show the game board (transition from waiting to playing)
      if (gameState.state === "playing" && this.isPlayer) {
        this.showGame(this.currentGame);
      } else {
        // Otherwise, just update the existing board
        this.updateGameBoard(gameState);
      }
    } else {
      // No game state provided, skipping update
    }
  }

  // Update only the game board without re-rendering everything
  updateGameBoard(gameState) {
    if (!this.gameModal || this.gameModal.style.display !== "flex") return;
    
    const gameBoard = this.gameModal.querySelector(".tic-tac-toe-board");
    if (!gameBoard) return;
    
    // Update each cell with new state
    for (let i = 0; i < 9; i++) {
      const cell = gameBoard.querySelector(`[data-position="${i}"]`);
      if (cell) {
        // Update cell content
        if (gameState.board && gameState.board[i]) {
          cell.textContent = gameState.board[i];
          cell.style.color = gameState.board[i] === "X" ? "#ff9800" : "#00bcd4";
        } else {
          cell.textContent = "";
        }
        
        // Update cell styling based on winning line
        if (gameState.winningLine && gameState.winningLine.includes(i)) {
          cell.style.background = "#4caf50";
          cell.style.boxShadow = "0 0 15px #4caf50";
          cell.style.borderColor = "#4caf50";
        } else if (!gameState.board || !gameState.board[i]) {
          cell.style.background = "#000";
          cell.style.boxShadow = "none";
        }
        
        // Update cursor based on whether move is allowed
        const canMove = this.canMakeMove(this.currentGame, i);
        cell.style.cursor = canMove ? "pointer" : "default";
      }
    }
    
    // Update game status text
    const gameStatus = this.gameModal.querySelector(".game-status");
    if (gameStatus && gameState.state !== undefined) {
      gameStatus.textContent = this.getGameStatusText(this.currentGame);
    }
    
    // Update player info if it changed
    if (gameState.players) {
      this.updatePlayerInfo(gameState.players);
    }
  }

  // Update player information display
  updatePlayerInfo(players) {
    const playersInfo = this.gameModal.querySelector(".players-info");
    if (!playersInfo) return;
    
    playersInfo.innerHTML = "";
    
    if (players.length >= 2) {
      const player1 = players[0];
      const player2 = players[1];
      
      const player1Div = document.createElement("div");
      player1Div.style.cssText = `
        text-align: center;
        flex: 1;
        padding: 10px;
        border-right: 1px solid #666;
      `;
      player1Div.innerHTML = `
        <div style="color: #ff9800; font-weight: bold;">${player1.username || "Player 1"}</div>
        <div style="color: #ccc; font-size: 12px;">X</div>
      `;
      
      const player2Div = document.createElement("div");
      player2Div.style.cssText = `
        text-align: center;
        flex: 1;
        padding: 10px;
      `;
      player2Div.innerHTML = `
        <div style="color: #00bcd4; font-weight: bold;">${player2.username || "Player 2"}</div>
        <div style="color: #ccc; font-size: 12px;">O</div>
      `;
      
      playersInfo.appendChild(player1Div);
      playersInfo.appendChild(player2Div);
    } else if (players.length === 1) {
      const player = players[0];
      const playerDiv = document.createElement("div");
      playerDiv.style.cssText = `
        text-align: center;
        flex: 1;
        padding: 10px;
      `;
      playerDiv.innerHTML = `
        <div style="color: #ff9800; font-weight: bold;">${player.username || "Player 1"}</div>
        <div style="color: #ccc; font-size: 12px;">X</div>
      `;
      
      const waitingDiv = document.createElement("div");
      waitingDiv.style.cssText = `
        text-align: center;
        flex: 1;
        padding: 10px;
        border-left: 1px solid #666;
        color: #666;
        font-style: italic;
      `;
      waitingDiv.textContent = "Waiting for player...";
      
      playersInfo.appendChild(playerDiv);
      playersInfo.appendChild(waitingDiv);
    }
  }

  // Get game title
  getGameTitle(game) {
    switch (game.type) {
      case "tictactoe":
        return "Tic Tac Toe";
      default:
        return "Game";
    }
  }

  // Show game interface
  showGame(game) {
    if (!game) return;

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
      margin-bottom: 8px;
      text-align: center;
    `;

    // Player info
    const playersInfo = document.createElement("div");
    playersInfo.className = "players-info";
    playersInfo.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
      padding: 4px;
      background: #333;
      border-radius: 5px;
    `;

    if (game.players.length >= 2) {
      const player1 = game.players[0];
      const player2 = game.players[1];

      // Determine which player the current user is
      let isCurrentUserPlayer1 = false;
      let isCurrentUserPlayer2 = false;
      
      if (this.playerSymbol) {
        // Use playerSymbol to determine which player we are
        if (player1.symbol === this.playerSymbol) {
          isCurrentUserPlayer1 = true;
        } else if (player2.symbol === this.playerSymbol) {
          isCurrentUserPlayer2 = true;
        }
      } else if (this.serverPlayerId) {
        // Fallback to serverPlayerId
        if (player1.id === this.serverPlayerId) {
          isCurrentUserPlayer1 = true;
        } else if (player2.id === this.serverPlayerId) {
          isCurrentUserPlayer2 = true;
        }
      }

      playersInfo.innerHTML = `
        <div class="player-info ${
          game.currentPlayerIndex === 0 ? "current-turn" : ""
        }" 
             style="text-align: center; padding: 6px; border-radius: 6px; ${
               game.currentPlayerIndex === 0
                 ? "background: #ff9800; color: #000; font-weight: bold; box-shadow: 0 0 15px #ff9800; transform: scale(1.05); border: 2px solid #fff; animation: pulse 1.5s infinite;"
                 : "background: #333; color: #ccc; border: 1px solid #666;"
             } transition: all 0.3s ease;">
          <div style="font-size: 11px; margin-bottom: 2px;">${player1.username}</div>
          <div style="font-size: 20px; margin: 2px 0; font-weight: bold;">${player1.symbol}</div>
          <div style="font-size: 9px;">Score: ${player1.score}</div>
          ${game.currentPlayerIndex === 0 && isCurrentUserPlayer1 ? '<div style="font-size: 10px; margin-top: 3px; font-weight: bold; text-shadow: 1px 1px 2px rgba(0,0,0,0.5);">🎯 YOUR TURN!</div>' : game.currentPlayerIndex === 0 ? '<div style="font-size: 9px; margin-top: 3px; color: #999;">⏳ Player 1\'s Turn</div>' : '<div style="font-size: 9px; margin-top: 3px; color: #999;">⏳ Waiting...</div>'}
        </div>
        <div style="font-size: 12px; color: #666; display: flex; align-items: center; justify-content: center;">
          <div style="text-align: center;">
            <div style="font-size: 10px; color: #ff9800; margin-bottom: 1px;">VS</div>
            <div style="font-size: 8px; color: #666;">${game.state === 'playing' ? 'Game Active' : 'Waiting'}</div>
          </div>
        </div>
        <div class="player-info ${
          game.currentPlayerIndex === 1 ? "current-turn" : ""
        }" 
             style="text-align: center; padding: 6px; border-radius: 6px; ${
               game.currentPlayerIndex === 1
                 ? "background: #00bcd4; color: #000; font-weight: bold; box-shadow: 0 0 15px #00bcd4; transform: scale(1.05); border: 2px solid #fff; animation: pulse 1.5s infinite;"
                 : "background: #333; color: #ccc; border: 1px solid #666;"
             } transition: all 0.3s ease;">
          <div style="font-size: 11px; margin-bottom: 2px;">${player2.username}</div>
          <div style="font-size: 20px; margin: 2px 0; font-weight: bold;">${player2.symbol}</div>
          <div style="font-size: 9px;">Score: ${player2.score}</div>
          ${game.currentPlayerIndex === 1 && isCurrentUserPlayer2 ? '<div style="font-size: 10px; margin-top: 3px; font-weight: bold; text-shadow: 1px 1px 2px rgba(0,0,0,0.5);">🎯 YOUR TURN!</div>' : game.currentPlayerIndex === 1 ? '<div style="font-size: 9px; margin-top: 3px; color: #999;">⏳ Player 2\'s Turn</div>' : '<div style="font-size: 9px; margin-top: 3px; color: #999;">⏳ Waiting...</div>'}
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
      margin: 4px 0;
      font-size: 14px;
      min-height: 16px;
    `;
    gameStatus.textContent = this.getGameStatusText(game);

    gameInfo.appendChild(playersInfo);
    gameInfo.appendChild(gameStatus);
    // Removed redundant turn indicator - player info panels already show whose turn it is

    // Game board - Reduced size to prevent cut-off
    const gameBoard = document.createElement("div");
    gameBoard.className = "tic-tac-toe-board";
    gameBoard.style.cssText = `
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      grid-gap: 4px;
      width: 280px;
      height: 280px;
      margin: 6px auto;
      background: #333;
      border: 3px solid #ff9800;
      border-radius: 15px;
      padding: 12px;
      box-shadow: 0 0 20px rgba(255, 152, 0, 0.3);
    `;

    // Create board cells
    for (let i = 0; i < 9; i++) {
      const cell = document.createElement("div");
      cell.className = "board-cell";
      cell.dataset.position = i;
      
      const canMove = this.canMakeMove(game, i);
      
      cell.style.cssText = `
        background: ${canMove ? "#2a2a2a" : "#000"};
        border: 2px solid ${canMove ? "#ff9800" : "#666"};
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 32px;
        font-weight: bold;
        cursor: ${canMove ? "pointer" : "default"};
        transition: all 0.3s ease;
        position: relative;
        min-height: 70px;
        box-shadow: ${canMove ? "0 0 10px rgba(255, 152, 0, 0.3)" : "none"};
      `;

      // Set cell content
      if (game.board[i]) {
        cell.textContent = game.board[i];
        cell.style.color = game.board[i] === "X" ? "#ff9800" : "#00bcd4";
        cell.style.background = "#1a1a1a";
      }

      // Highlight winning line
      if (game.winningLine && game.winningLine.includes(i)) {
        cell.style.background = "#4caf50";
        cell.style.boxShadow = "0 0 15px #4caf50";
        cell.style.borderColor = "#4caf50";
      }

      // Add hover effect and click handler
      if (canMove) {
        cell.style.cursor = "pointer";
        cell.style.background = "#2a2a2a"; // Make clickable cells more visible
        cell.style.border = "2px solid #ff9800"; // Orange border for clickable cells

        cell.addEventListener("mouseenter", () => {
          if (!game.board[i]) {
            cell.style.background = "#ff9800";
            cell.style.color = "#000";
            cell.style.transform = "scale(1.1)";
            cell.style.boxShadow = "0 0 20px #ff9800";
          }
        });

        cell.addEventListener("mouseleave", () => {
          if (
            !game.board[i] &&
            (!game.winningLine || !game.winningLine.includes(i))
          ) {
            cell.style.background = "#2a2a2a";
            cell.style.color = "#fff";
            cell.style.transform = "scale(1)";
            cell.style.boxShadow = "none";
          }
        });

        // Add click handler with better error handling
        cell.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();

          if (this.canMakeMove(game, i)) {
            this.makeMove(i);
          } else {
            this.showGameError("Invalid move or game state.");

            // Show helpful error message
            if (!this.isPlayer) {
              this.showGameError("You are not a player in this game.");
            } else if (game.state !== "playing") {
              this.showGameError("Game is not currently active.");
            } else if (game.board[i]) {
              this.showGameError("This position is already taken.");
            } else if (
              game.players[game.currentPlayerIndex]?.id !== window.currentUserId
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
        cell.style.background = "#000"; // Black background for non-clickable cells
        cell.style.border = "1px solid #666"; // Gray border for non-clickable cells
        
        // Add visual indicator for non-clickable cells
        if (!game.board[i]) {
          cell.style.opacity = "0.5";
        }
        
        // Add click handler for making moves
        cell.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          
          if (this.canMakeMove(game, i)) {
            this.makeMove(game, i);
          }
        });
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

  // Show game end message
  showGameEndMessage(data) {
    const gameModalBody = this.gameModal.querySelector("#gameModalBody");
    const gameModalFooter = this.gameModal.querySelector("#gameModalFooter");

    // Clear previous content
    gameModalBody.innerHTML = "";
    gameModalFooter.innerHTML = "";

    // Create a more prominent win/lose display
    const resultContainer = document.createElement("div");
    resultContainer.style.cssText = `
      text-align: center;
      padding: 30px;
      background: linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 100%);
      border-radius: 15px;
      margin-bottom: 25px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.3);
    `;

    // Create the result icon and text
    const resultIcon = document.createElement("div");
    resultIcon.style.cssText = `
      font-size: 64px;
      margin-bottom: 20px;
      animation: bounce 1s ease-in-out;
    `;

    const resultText = document.createElement("div");
    resultText.style.cssText = `
      font-size: 28px;
      font-weight: bold;
      margin-bottom: 15px;
      text-shadow: 2px 2px 4px rgba(0,0,0,0.5);
    `;

    const resultSubtext = document.createElement("div");
    resultSubtext.style.cssText = `
      font-size: 16px;
      color: #ccc;
      margin-bottom: 20px;
    `;

    // Determine the result
    if (data.winner === "draw") {
      resultIcon.textContent = "🤝";
      resultText.textContent = "It's a Draw!";
      resultText.style.color = "#ffd700";
      resultSubtext.textContent = "Great game! Both players played well.";
    } else if (data.winner) {
      // Find the winning player's info
      const winningPlayer = this.currentGame.players.find(p => p.symbol === data.winner);
      const isCurrentUser = winningPlayer && (
        winningPlayer.id === this.serverPlayerId || 
        winningPlayer.id === window.currentUserId ||
        winningPlayer.symbol === this.playerSymbol
      );

      if (isCurrentUser) {
        resultIcon.textContent = "🏆";
        resultText.textContent = "YOU WIN!";
        resultText.style.color = "#4caf50";
        resultSubtext.textContent = `Congratulations! You won with ${data.winner}!`;
      } else {
        resultIcon.textContent = "😔";
        resultText.textContent = "YOU LOSE";
        resultText.style.color = "#f44336";
        resultSubtext.textContent = `${winningPlayer ? winningPlayer.username : 'Opponent'} won with ${data.winner}`;
      }
    } else {
      resultIcon.textContent = "❓";
      resultText.textContent = "Game Over";
      resultText.style.color = "#ff9800";
      resultSubtext.textContent = "The game has ended.";
    }

    // Add CSS animation for the icon
    const style = document.createElement("style");
    style.textContent = `
      @keyframes bounce {
        0%, 20%, 50%, 80%, 100% {
          transform: translateY(0);
        }
        40% {
          transform: translateY(-20px);
        }
        60% {
          transform: translateY(-10px);
        }
      }
    `;
    document.head.appendChild(style);

    resultContainer.appendChild(resultIcon);
    resultContainer.appendChild(resultText);
    resultContainer.appendChild(resultSubtext);

    // Add game stats if available
    if (data.gameState && data.gameState.moveHistory) {
      const statsContainer = document.createElement("div");
      statsContainer.style.cssText = `
        background: #333;
        padding: 15px;
        border-radius: 8px;
        margin-bottom: 20px;
        border: 1px solid #555;
      `;

      const movesCount = data.gameState.moveHistory.length;
      const statsText = document.createElement("div");
      statsText.style.cssText = `
        font-size: 14px;
        color: #ccc;
      `;
      statsText.textContent = `Total moves: ${movesCount}`;
      
      statsContainer.appendChild(statsText);
      resultContainer.appendChild(statsContainer);
    }

    gameModalBody.appendChild(resultContainer);

    // No Play Again button - removed due to functionality issues
    // No Leave button needed - X button already closes the game
  }

  // Show game error
  showGameError(message) {
    const gameModalBody = this.gameModal.querySelector("#gameModalBody");
    const gameModalFooter = this.gameModal.querySelector("#gameModalFooter");

    // Clear previous content
    gameModalBody.innerHTML = "";
    gameModalFooter.innerHTML = "";

    const errorMessage = document.createElement("div");
    errorMessage.style.cssText = `
      text-align: center;
      padding: 20px;
      font-size: 18px;
      color: #f44336;
      background: #1a1a1a;
      border: 2px solid #f44336;
      border-radius: 10px;
      margin-bottom: 20px;
    `;
    errorMessage.textContent = message;

    const okBtn = document.createElement("button");
    okBtn.textContent = "OK";
    okBtn.style.cssText = `
      padding: 10px 20px;
      background: #ff9800;
      color: #000;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      font-size: 16px;
      font-weight: bold;
      transition: background 0.3s ease;
    `;
    okBtn.addEventListener("click", () => {
      this.closeGame();
    });

    gameModalFooter.appendChild(okBtn);
  }

  // Show game notification
  showGameNotification(data) {
    // Create a simple notification that a game is available
    const notification = document.createElement("div");
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #4caf50;
      color: white;
      padding: 15px 20px;
      border-radius: 5px;
      z-index: 10001;
      box-shadow: 0 2px 10px rgba(0,0,0,0.3);
      cursor: pointer;
      max-width: 300px;
    `;
    notification.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 5px;">🎮 Game Available!</div>
      <div>A ${data.gameType} game is ready to join in this room.</div>
    `;
    
    notification.addEventListener("click", () => {
      // Join the game when notification is clicked
      if (typeof socket !== "undefined") {
        const roomId = window.currentRoomId;
        socket.emit("join game", { gameId: data.gameId, roomId: roomId });
      }
      notification.remove();
    });
    
    document.body.appendChild(notification);
    
    // Auto-remove after 10 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        notification.remove();
      }
    }, 10000);
  }

  // Update available games list
  updateAvailableGames(games) {
    const roomGamesList = document.getElementById("roomGamesList");
    if (!roomGamesList) return;

    roomGamesList.innerHTML = "";

    if (games.length === 0) {
      roomGamesList.innerHTML = "<p>No games available in this room.</p>";
      return;
    }

    games.forEach(game => {
      const gameItem = document.createElement("div");
      gameItem.className = "game-item";
      gameItem.style.cssText = `
        padding: 10px 15px;
        margin-bottom: 10px;
        background: #333;
        border: 1px solid #666;
        border-radius: 5px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        cursor: pointer;
        transition: background 0.3s ease;
      `;
      gameItem.textContent = `${this.getGameTitle(game)} (${game.players.length}/2)`;

      if (game.state === "playing") {
        gameItem.style.background = "#4caf50";
        gameItem.style.borderColor = "#4caf50";
        gameItem.style.color = "#000";
      } else if (game.state === "waiting") {
        gameItem.style.background = "#ff9800";
        gameItem.style.borderColor = "#ff9800";
        gameItem.style.color = "#000";
      } else if (game.state === "finished") {
        gameItem.style.background = "#f44336";
        gameItem.style.borderColor = "#f44336";
        gameItem.style.color = "#fff";
      }

      gameItem.addEventListener("click", () => {
        if (typeof socket !== "undefined") {
          const roomId = window.currentRoomId;
          socket.emit("join game", { gameId: game.id, roomId: roomId });
        }
      });

      roomGamesList.appendChild(gameItem);
    });
  }

  // Show available games
  showAvailableGames() {
    const roomGamesList = document.getElementById("roomGamesList");
    if (!roomGamesList) return;

    roomGamesList.innerHTML = "<h3>Available Games</h3>";
    this.updateAvailableGames(this.currentGame.games); // Assuming currentGame.games contains the list of games
  }

  // Show waiting for game state
  showWaitingForGameState() {
    const gameModalBody = this.gameModal.querySelector("#gameModalBody");
    const gameModalFooter = this.gameModal.querySelector("#gameModalFooter");

    // Clear previous content
    gameModalBody.innerHTML = "";
    gameModalFooter.innerHTML = "";

    const waitingMessage = document.createElement("div");
    waitingMessage.style.cssText = `
      text-align: center;
      padding: 20px;
      font-size: 18px;
      color: #ff9800;
      background: #1a1a1a;
      border: 2px solid #ff9800;
      border-radius: 10px;
      margin-bottom: 20px;
    `;
    waitingMessage.textContent = "Waiting for game state update...";

    const okBtn = document.createElement("button");
    okBtn.textContent = "OK";
    okBtn.style.cssText = `
      padding: 10px 20px;
      background: #ff9800;
      color: #000;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      font-size: 16px;
      font-weight: bold;
      transition: background 0.3s ease;
    `;
    okBtn.addEventListener("click", () => {
      this.closeGame();
    });

    gameModalFooter.appendChild(okBtn);
  }

  // Close game modal
  closeGame() {
    this.gameModal.style.display = "none";
    this.currentGame = null;
    this.isPlayer = false;
    this.isSpectator = false;
    this.playerSymbol = null;
    this.serverPlayerId = null; // Reset server player ID on close
  }

  // Make a move
  makeMove(position) {
    if (!this.currentGame) {
      return;
    }

    if (!this.isPlayer) {
      return;
    }

    if (this.canMakeMove(this.currentGame, position)) {
      const roomId = window.currentRoomId;
      
      // Find our actual player ID from the game
      let ourPlayerId = window.currentUserId;
      if (this.serverPlayerId) {
        ourPlayerId = this.serverPlayerId;
      } else if (this.playerSymbol) {
        const ourPlayer = this.currentGame.players.find(p => p.symbol === this.playerSymbol);
        if (ourPlayer) {
          ourPlayerId = ourPlayer.id;
        }
      }
      
      const moveData = {
        gameId: this.currentGame.id,
        position: position,
        roomId: roomId,
        playerId: ourPlayerId  // Send the correct player ID
      };
      socket.emit("make move", moveData);
    } else {
      this.showGameError("Invalid move or game state.");
    }
  }

  // Check if a move can be made
  canMakeMove(game, position) {
    const userId = window.currentUserId;
    const currentPlayerId = game.players[game.currentPlayerIndex]?.id;
    
    // Find our player object using playerSymbol or stored serverPlayerId
    let ourPlayer = null;
    if (this.playerSymbol) {
      // First try to find by stored serverPlayerId (most reliable)
      if (this.serverPlayerId) {
        ourPlayer = game.players.find(p => p.id === this.serverPlayerId);
      }
      
      // If that fails, try by symbol
      if (!ourPlayer) {
        ourPlayer = game.players.find(p => p.symbol === this.playerSymbol);
      }
      
      // Last resort: try to find by local userId
      if (!ourPlayer) {
        ourPlayer = game.players.find(p => p.id === userId);
      }
    }
    
    // Check if user is a player in this game
    let isPlayerInGame = false;
    
    // Method 1: Check if we have a playerSymbol that matches a player in the game
    if (ourPlayer) {
      isPlayerInGame = true;
    }
    
    // Method 2: Direct ID match (fallback)
    if (!isPlayerInGame) {
      isPlayerInGame = game.players.some(p => p.id === userId);
    }
    
    // Method 3: Check if we're marked as a player in this instance
    if (!isPlayerInGame && this.isPlayer) {
      isPlayerInGame = true;
    }
    
    // For the turn check, use our actual player ID from the game, not window.currentUserId
    const ourPlayerId = ourPlayer ? ourPlayer.id : userId;
    const isOurTurn = currentPlayerId === ourPlayerId;
    
    const canMove = (
      this.isPlayer &&
      isPlayerInGame &&
      game.state === "playing" &&
      !game.board[position] &&
      isOurTurn
    );
    
    return canMove;
  }

  // Get game status text
  getGameStatusText(game) {
    if (!game) return "No game data";

    if (game.state === "waiting") {
      return "Waiting for players to join...";
    } else if (game.state === "playing") {
      const currentPlayer = game.players[game.currentPlayerIndex];
      return `Current turn: ${currentPlayer?.username || 'Unknown Player'}`;
    } else if (game.state === "finished") {
      if (game.winner && game.winner !== 'draw') {
        return `${game.winner} wins!`;
      } else {
        return "It's a tie!";
      }
    }
    return "Game Status";
  }

  // Render game footer
  renderGameFooter(game, footer) {
    // No Play Again button - removed due to functionality issues
    // No Leave button needed - X button already closes the game
  }



  // Game actions
  joinGame(gameId) {
    const roomId = window.currentRoomId;
    socket.emit("join game", { gameId: gameId, roomId: roomId });
  }

  spectateGame(gameId) {
    const roomId = window.currentRoomId;
    socket.emit("spectate game", { gameId: gameId, roomId: roomId });
  }

  // Show game selection
  showGameSelection() {
    // Show the game selection interface
    if (!this.gameModal) {
      this.createGameModal();
    }
    
    const modalBody = this.gameModal.querySelector("#gameModalBody");
    const modalFooter = this.gameModal.querySelector("#gameModalFooter");
    
    // Set title
    this.gameModal.querySelector("#gameTitle").textContent = "Select a Game";
    
    // Create game selection content
    modalBody.innerHTML = `
      <div class="game-selection">
        <div class="game-option" data-game="tictactoe">
          <div class="game-icon">⭕</div>
          <div class="game-name">Tic Tac Toe</div>
          <div class="game-description">Classic X's and O's game for 2 players</div>
        </div>
      </div>
    `;
    
    // Create footer buttons
    modalFooter.innerHTML = `
      <button class="game-btn game-btn-secondary" id="cancelGameBtn">Cancel</button>
    `;
    
    // Add event listeners
    const gameOptions = modalBody.querySelectorAll(".game-option");
    gameOptions.forEach(option => {
      option.addEventListener("click", () => {
        const gameType = option.getAttribute("data-game");
        this.startGame(gameType);
      });
    });
    
    const cancelBtn = modalFooter.querySelector("#cancelGameBtn");
    cancelBtn.addEventListener("click", () => {
      this.hideGameModal();
    });
    
    // Show the modal
    this.gameModal.style.display = "flex";
    
    // Add styles for game selection
    this.addGameSelectionStyles();
  }
  
  startGame(gameType) {
    if (gameType === "tictactoe") {
      this.startTicTacToe();
    } else {
      this.showGameError(`${gameType} is not implemented yet. Only Tic Tac Toe is available.`);
    }
  }
  
  startTicTacToe() {
    // Show game mode selection
    const modalBody = this.gameModal.querySelector("#gameModalBody");
    modalBody.innerHTML = `
      <div class="game-mode-selection">
        <h4>Choose Game Mode:</h4>
        <div class="game-mode-option" data-mode="vs-player">
          <div class="mode-icon">👥</div>
          <div class="mode-name">Play vs Player</div>
          <div class="mode-description">Wait for another player to join</div>
        </div>
        <div class="game-mode-option" data-mode="vs-bot">
          <div class="mode-icon">🤖</div>
          <div class="mode-name">Play vs Bot</div>
          <div class="mode-description">Play against the computer</div>
        </div>
      </div>
    `;
    
    // Update footer
    const modalFooter = this.gameModal.querySelector("#gameModalFooter");
    modalFooter.innerHTML = `
      <button class="game-btn game-btn-secondary" id="backBtn">Back</button>
    `;
    
    // Add event listeners
    const modeOptions = modalBody.querySelectorAll(".game-mode-option");
    modeOptions.forEach(option => {
      option.addEventListener("click", () => {
        const mode = option.getAttribute("data-mode");
        this.createTicTacToeGame(mode === "vs-bot");
      });
    });
    
    const backBtn = modalFooter.querySelector("#backBtn");
    backBtn.addEventListener("click", () => {
      this.showGameSelection();
    });
    
    // Add styles for mode selection
    this.addModeSelectionStyles();
  }
  
  createTicTacToeGame(vsBot) {
    // Create a new Tic Tac Toe game
    if (typeof socket !== "undefined") {
      const gameData = {
        gameType: "tictactoe",
        roomId: window.currentRoomId,
        vsBot: vsBot
      };
      
      socket.emit("create game", gameData);
      
      // Show loading state
      const modalBody = this.gameModal.querySelector("#gameModalBody");
      modalBody.innerHTML = `
        <div class="game-loading">
          <div class="loading-spinner"></div>
          <div class="loading-text">Creating Tic Tac Toe game...</div>
          <div class="waiting-text">${vsBot ? 'Starting game vs Bot...' : 'Waiting for another player to join...'}</div>
        </div>
      `;
      
      // Update footer
      const modalFooter = this.gameModal.querySelector("#gameModalFooter");
      modalFooter.innerHTML = `
        <button class="game-btn game-btn-secondary" id="cancelGameBtn">Cancel</button>
      `;
      
      const cancelBtn = modalFooter.querySelector("#cancelGameBtn");
      cancelBtn.addEventListener("click", () => {
        this.hideGameModal();
      });
    } else {
      this.showGameError("Socket connection not available");
    }
  }
  
  hideGameModal() {
    if (this.gameModal) {
      this.gameModal.style.display = "none";
    }
  }
  
  addGameSelectionStyles() {
    // Add CSS for game selection interface
    if (!document.getElementById("gameSelectionStyles")) {
      const style = document.createElement("style");
      style.id = "gameSelectionStyles";
      style.textContent = `
        .game-selection {
          padding: 20px;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 20px;
        }
        
        .game-option {
          background: #2a2a2a;
          border: 2px solid #ff9800;
          border-radius: 10px;
          padding: 20px;
          text-align: center;
          cursor: pointer;
          transition: all 0.3s ease;
        }
        
        .game-option:hover {
          background: #3a3a3a;
          border-color: #ffcc80;
          transform: translateY(-2px);
        }
        
        .game-icon {
          font-size: 48px;
          margin-bottom: 15px;
        }
        
        .game-name {
          font-size: 18px;
          font-weight: bold;
          color: #ff9800;
          margin-bottom: 10px;
        }
        
        .game-description {
          font-size: 14px;
          color: #ccc;
          line-height: 1.4;
        }
        
        .game-loading {
          text-align: center;
          padding: 40px 20px;
        }
        
        .loading-spinner {
          width: 40px;
          height: 40px;
          border: 4px solid #333;
          border-top: 4px solid #ff9800;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto 20px;
        }
        
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        
        .loading-text {
          font-size: 18px;
          color: #ff9800;
          margin-bottom: 10px;
        }
        
        .waiting-text {
          font-size: 14px;
          color: #ccc;
        }
        
        .game-btn {
          padding: 10px 20px;
          border: none;
          border-radius: 5px;
          cursor: pointer;
          font-size: 14px;
          margin: 0 5px;
          transition: all 0.3s ease;
        }
        
        .game-btn-secondary {
          background: #666;
          color: white;
        }
        
        .game-btn-secondary:hover {
          background: #777;
        }
      `;
      document.head.appendChild(style);
    }
  }
  
  addModeSelectionStyles() {
    // Add CSS for game mode selection interface
    if (!document.getElementById("modeSelectionStyles")) {
      const style = document.createElement("style");
      style.id = "modeSelectionStyles";
      style.textContent = `
        .game-mode-selection {
          padding: 20px;
          text-align: center;
        }
        
        .game-mode-selection h4 {
          color: #ff9800;
          margin-bottom: 20px;
          font-size: 16px;
        }
        
        .game-mode-option {
          background: #2a2a2a;
          border: 2px solid #ff9800;
          border-radius: 10px;
          padding: 20px;
          margin: 15px 0;
          cursor: pointer;
          transition: all 0.3s ease;
          display: flex;
          align-items: center;
          text-align: left;
        }
        
        .game-mode-option:hover {
          background: #3a3a3a;
          border-color: #ffcc80;
          transform: translateY(-2px);
        }
        
        .mode-icon {
          font-size: 32px;
          margin-right: 15px;
          flex-shrink: 0;
        }
        
        .mode-name {
          font-size: 16px;
          font-weight: bold;
          color: #ff9800;
          margin-bottom: 5px;
        }
        
        .mode-description {
          font-size: 14px;
          color: #ccc;
          line-height: 1.4;
        }
      `;
      document.head.appendChild(style);
    }
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