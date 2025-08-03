// ============================================================================
// room-client.js - Improved emote handling with bugfixes
// ============================================================================

const socket = io(); // Initialize Socket.IO connection

socket.on("ping", () => {
  socket.emit("pong");
});

// Also handle the built-in pong event
socket.on("pong", () => {
  if (socket.isAlive !== undefined) {
    socket.isAlive = true;
  }
});

let currentUsername = "";
let currentLocation = "";
let currentRoomId = "";
let currentUserId = "";
let currentRoomLayout = "horizontal";
let lastSentMessage = "";
let currentRoomName = "";
let chatInput = null;
let isSpectator = false;
let spectatorCount = 0;
const mutedUsers = new Set();
const storedMessagesForMutedUsers = new Map();

const joinSound = document.getElementById("joinSound");
const leaveSound = document.getElementById("leaveSound");
let soundEnabled = true;

const muteToggleButton = document.getElementById("muteToggle");
const muteIcon = document.getElementById("muteIcon");

const MAX_MESSAGE_LENGTH = 5000;

const ERROR_CODES = {
  VALIDATION_ERROR: "Validation Error",
  SERVER_ERROR: "Server Error",
  UNAUTHORIZED: "Unauthorized",
  NOT_FOUND: "Not Found",
  RATE_LIMITED: "Rate Limited",
  ROOM_FULL: "Room Full",
  ACCESS_DENIED: "Access Denied",
  BAD_REQUEST: "Bad Request",
  FORBIDDEN: "Forbidden",
  CIRCUIT_OPEN: "Circuit Open",
  AFK_WARNING: "AFK Warning",
  AFK_TIMEOUT: "AFK Timeout",
};

// Emote system variables
let emoteList = {};
let emoteAutocomplete = null;
let autocompleteActive = false;
let selectedEmoteIndex = -1;
let filteredEmotes = [];
let currentEmotePrefix = "";
let currentEmoteInfo = null;
let lastClickedEmoteCode = null; // Track last clicked emote for better insertion

// Modal functionality
const customModal = document.getElementById("customModal");
const modalTitle = document.getElementById("modalTitle");
const modalMessage = document.getElementById("modalMessage");
const modalInput = document.getElementById("modalInput");
const modalInputContainer = document.getElementById("modalInputContainer");
const modalInputError = document.getElementById("modalInputError");
const modalCancelBtn = document.getElementById("modalCancelBtn");
const modalConfirmBtn = document.getElementById("modalConfirmBtn");
const closeModalBtn = document.querySelector(".close-modal-btn");

let currentModalCallback = null;

const APPS_DATA = {
  tictactoe: {
    name: "Tic Tac Toe (Beta)",
    description: "Classic 3x3 grid game for two players",
    icon: "❌",
    iconClass: "placeholder",
    status: "available",
    url: null,
    openInNewTab: false,
  },
  watchparty: {
    name: "WatchParty",
    description: "Watch YouTube videos together",
    icon: "https://watchparty.talkomatic.co/images/logo.png",
    iconClass: "watchparty",
    status: "available",
    url: "https://watchparty.talkomatic.co/",
    openInNewTab: true,
  },
  infiniteboard: {
    name: "InfiniteBoard",
    description: "Collaborative whiteboard drawing",
    icon: "🎨",
    iconClass: "placeholder",
    status: "coming-soon",
    url: null,
    openInNewTab: false,
  },
  minigames: {
    name: "Mini Games",
    description: "Uno, Hangman, Tic Tac Toe & more",
    icon: "🎮",
    iconClass: "placeholder",
    status: "coming-soon",
    url: null,
    openInNewTab: false,
  },
  fileshare: {
    name: "File Share",
    description: "Share files and images securely",
    icon: "📁",
    iconClass: "placeholder",
    status: "coming-soon",
    url: null,
    openInNewTab: false,
  },
};

let appDirectoryDropdown = null;

// Load emotes from JSON file
async function loadEmotes() {
  try {
    const response = await fetch("/js/emojiList.json?v=1.0.1");
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    emoteList = await response.json();
    console.log("Emotes loaded:", Object.keys(emoteList).length);
  } catch (error) {
    console.error("Error loading emotes:", error);
    emoteList = {}; // Empty object as fallback
  }
}

function createAppDirectoryDropdown() {
  // Remove existing dropdown if any
  if (appDirectoryDropdown) {
    appDirectoryDropdown.remove();
  }

  // Create dropdown container
  appDirectoryDropdown = document.createElement("div");
  appDirectoryDropdown.className = "app-directory-dropdown";
  appDirectoryDropdown.id = "appDirectoryDropdown";

  // Create header
  const header = document.createElement("div");
  header.className = "app-directory-header";
  header.textContent = "🚀 App Directory";

  // Create app grid
  const appGrid = document.createElement("div");
  appGrid.className = "app-grid";

  // Add apps to grid
  Object.entries(APPS_DATA).forEach(([appId, app]) => {
    const appItem = document.createElement("div");
    appItem.className = `app-item ${
      app.status === "coming-soon" ? "disabled" : ""
    }`;
    appItem.setAttribute("data-app-id", appId);

    // Create app icon
    const appIcon = document.createElement("div");
    appIcon.className = `app-icon ${app.iconClass}`;

    if (app.iconClass === "placeholder") {
      appIcon.textContent = app.icon;
    } else {
      const img = document.createElement("img");
      img.src = app.icon;
      img.alt = app.name;
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "cover";
      appIcon.appendChild(img);
    }

    // Create app info
    const appInfo = document.createElement("div");
    appInfo.className = "app-info";

    const appName = document.createElement("div");
    appName.className = "app-name";
    appName.textContent = app.name;

    const appDescription = document.createElement("div");
    appDescription.className = "app-description";
    appDescription.textContent = app.description;

    appInfo.appendChild(appName);
    appInfo.appendChild(appDescription);

    // Create status badge
    const appStatus = document.createElement("div");
    appStatus.className = `app-status status-${app.status.replace("-", "-")}`;
    appStatus.textContent =
      app.status === "available" ? "Available" : "Coming Soon";

    // Assemble app item
    appItem.appendChild(appIcon);
    appItem.appendChild(appInfo);
    appItem.appendChild(appStatus);

    // Add click handler
    if (app.status === "available") {
      appItem.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleAppClick(appId, app);
      });
    }

    appGrid.appendChild(appItem);
  });

  // Create footer
  const footer = document.createElement("div");
  footer.className = "app-directory-footer";

  const viewAllLink = document.createElement("a");
  viewAllLink.href = "app-directory.html";
  viewAllLink.className = "view-all-link";
  viewAllLink.target = "_blank";
  viewAllLink.textContent = "📂 View All Apps";

  footer.appendChild(viewAllLink);

  // Assemble dropdown
  appDirectoryDropdown.appendChild(header);
  appDirectoryDropdown.appendChild(appGrid);
  appDirectoryDropdown.appendChild(footer);

  // Add to navbar
  const navbar = document.querySelector(".top-navbar");
  if (navbar) {
    navbar.style.position = "relative"; // Ensure navbar can contain positioned elements
    navbar.appendChild(appDirectoryDropdown);
  }
}

function toggleAppDirectory() {
  if (!appDirectoryDropdown) {
    createAppDirectoryDropdown();
  }

  const isVisible = appDirectoryDropdown.classList.contains("show");

  if (isVisible) {
    hideAppDirectory();
  } else {
    showAppDirectory();
  }
}

function showAppDirectory() {
  if (!appDirectoryDropdown) {
    createAppDirectoryDropdown();
  }

  // Hide any other open dropdowns
  hideAutocomplete();
  const emotesDropdown = document.getElementById("emotesDropdown");
  if (emotesDropdown) {
    emotesDropdown.style.display = "none";
  }

  appDirectoryDropdown.classList.add("show");
}

function hideAppDirectory() {
  if (appDirectoryDropdown) {
    appDirectoryDropdown.classList.remove("show");
  }
}

function handleAppClick(appId, app) {
  console.log(`Opening app: ${app.name}`);

  // Hide the dropdown
  hideAppDirectory();

  // Handle different app types
  switch (appId) {
    case "tictactoe":
      // Check if user is signed in and in a room
      if (!currentUserId || !currentRoomId) {
        showErrorModal("You must be signed in and in a room to play games.");
        return;
      }

      // Check if spectator
      if (isSpectator) {
        showErrorModal(
          "Spectators cannot start games. You can only watch existing games."
        );
        return;
      }

      // Create or show games for tic-tac-toe
      showTicTacToeOptions();
      break;

    case "watchparty":
      if (app.openInNewTab) {
        // Open WatchParty in new tab
        window.open(app.url, "_blank", "noopener,noreferrer");
      } else {
        // Redirect to WatchParty
        window.location.href = app.url;
      }
      break;

    case "infiniteboard":
    case "minigames":
    case "fileshare":
      // Coming soon apps
      showInfoModal(
        `${app.name} is coming soon! We're working hard to bring you this feature.`
      );
      break;

    default:
      console.warn(`Unknown app: ${appId}`);
      break;
  }
}

// Add this new function after handleAppClick:

function showTicTacToeOptions() {
  // First, get available games in the room
  socket.emit("get room games", { roomId: currentRoomId });

  // Wait a moment for the response, then show options
  setTimeout(() => {
    showTicTacToeModal();
  }, 100);
}

function showTicTacToeModal() {
  const modalContent = `
    <div style="text-align: center; padding: 20px;">
      <h3 style="color: #ff9800; margin-bottom: 20px;">🎮 Tic Tac Toe</h3>
      <p style="margin-bottom: 30px; color: #ccc;">Choose an option to get started:</p>
      
      <div style="display: flex; flex-direction: column; gap: 15px; max-width: 300px; margin: 0 auto;">
        <button id="createTicTacToeBtn" style="
          padding: 15px 20px;
          background: #4caf50;
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
          font-weight: bold;
          transition: all 0.2s ease;
        ">
          🆕 Create New Game
        </button>
        
        <button id="findTicTacToeBtn" style="
          padding: 15px 20px;
          background: #2196f3;
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
          font-weight: bold;
          transition: all 0.2s ease;
        ">
          🔍 Find Game to Join
        </button>
        
        <p style="font-size: 12px; color: #666; margin-top: 10px;">
          Other users in this room can join your game or you can join theirs!
        </p>
      </div>
    </div>
  `;

  showModal("Tic Tac Toe", "", {
    showCancel: true,
    cancelText: "Close",
    confirmText: "", // Hide confirm button
    callback: (confirmed) => {
      // Modal closed
    },
  });

  // Replace modal content
  const modalMessage = document.getElementById("modalMessage");
  if (modalMessage) {
    modalMessage.innerHTML = modalContent;

    // Hide the default confirm button since we have custom buttons
    const modalConfirmBtn = document.getElementById("modalConfirmBtn");
    if (modalConfirmBtn) {
      modalConfirmBtn.style.display = "none";
    }
  }

  // Add event listeners for the custom buttons
  setTimeout(() => {
    const createBtn = document.getElementById("createTicTacToeBtn");
    const findBtn = document.getElementById("findTicTacToeBtn");

    if (createBtn) {
      createBtn.addEventListener("mouseenter", () => {
        createBtn.style.background = "#45a049";
        createBtn.style.transform = "translateY(-2px)";
      });
      createBtn.addEventListener("mouseleave", () => {
        createBtn.style.background = "#4caf50";
        createBtn.style.transform = "translateY(0)";
      });
      createBtn.addEventListener("click", () => {
        closeModal();
        createTicTacToeGame();
      });
    }

    if (findBtn) {
      findBtn.addEventListener("mouseenter", () => {
        findBtn.style.background = "#1976d2";
        findBtn.style.transform = "translateY(-2px)";
      });
      findBtn.addEventListener("mouseleave", () => {
        findBtn.style.background = "#2196f3";
        findBtn.style.transform = "translateY(0)";
      });
      findBtn.addEventListener("click", () => {
        closeModal();
        findTicTacToeGames();
      });
    }
  }, 50);
}

function createTicTacToeGame() {
  if (window.gameClient) {
    window.gameClient.createGame("tictactoe");
  } else {
    showErrorModal("Game system not loaded. Please refresh the page.");
  }
}

function findTicTacToeGames() {
  // Request available games
  socket.emit("get room games", { roomId: currentRoomId });

  // Listen for the response
  const handleRoomGames = (data) => {
    socket.off("room games updated", handleRoomGames); // Remove listener after use

    const availableGames = data.games.filter(
      (game) =>
        game.type === "tictactoe" &&
        game.state === "waiting" &&
        game.players.length < 2 &&
        !game.players.some((p) => p.id === currentUserId)
    );

    if (availableGames.length === 0) {
      showInfoModal(
        "No available games to join right now. Would you like to create a new game?",
        (confirmed) => {
          if (confirmed) {
            createTicTacToeGame();
          }
        }
      );
      return;
    }

    showAvailableGamesModal(availableGames);
  };

  socket.on("room games updated", handleRoomGames);

  // Timeout fallback
  setTimeout(() => {
    socket.off("room games updated", handleRoomGames);
  }, 5000);
}

function showAvailableGamesModal(games) {
  let gamesList = games
    .map((game, index) => {
      const creator = game.players[0];
      return `
      <div class="available-game-item" data-game-id="${game.id}" data-index="${index}" style="
        padding: 15px;
        margin: 10px 0;
        background: #333;
        border-radius: 8px;
        border: 1px solid #555;
        cursor: pointer;
        transition: all 0.2s ease;
      ">
        <div style="font-weight: bold; color: #ff9800;">Game by ${creator.username}</div>
        <div style="font-size: 12px; color: #ccc;">Waiting for second player...</div>
        <div style="font-size: 10px; color: #666; margin-top: 5px;">Click to join</div>
      </div>
    `;
    })
    .join("");

  const modalContent = `
    <div style="text-align: left; padding: 20px;">
      <h3 style="color: #ff9800; margin-bottom: 20px; text-align: center;">🎮 Available Games</h3>
      <div id="gamesList" style="max-height: 300px; overflow-y: auto;">
        ${gamesList}
      </div>
      <div style="text-align: center; margin-top: 20px;">
        <button id="createNewGameBtn" style="
          padding: 10px 20px;
          background: #4caf50;
          color: white;
          border: none;
          border-radius: 5px;
          cursor: pointer;
          font-weight: bold;
        ">Create New Game Instead</button>
      </div>
    </div>
  `;

  showModal("Available Games", "", {
    showCancel: true,
    cancelText: "Close",
    confirmText: "",
    callback: (confirmed) => {
      // Modal closed
    },
  });

  const modalMessage = document.getElementById("modalMessage");
  if (modalMessage) {
    modalMessage.innerHTML = modalContent;

    const modalConfirmBtn = document.getElementById("modalConfirmBtn");
    if (modalConfirmBtn) {
      modalConfirmBtn.style.display = "none";
    }

    // Add proper event listeners after DOM is updated
    setTimeout(() => {
      // Add click handlers for game items
      const gameItems = document.querySelectorAll(".available-game-item");
      console.log(`Found ${gameItems.length} game items`);

      gameItems.forEach((item, index) => {
        const gameId = item.dataset.gameId;
        console.log(`Setting up click handler for game ${gameId}`);

        // Add hover effects
        item.addEventListener("mouseenter", () => {
          item.style.background = "#444";
          item.style.borderColor = "#ff9800";
        });

        item.addEventListener("mouseleave", () => {
          item.style.background = "#333";
          item.style.borderColor = "#555";
        });

        // Add click handler
        item.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          console.log(`Clicked on game ${gameId}`);
          joinTicTacToeGame(gameId);
        });
      });

      // Add click handler for create new game button
      const createBtn = document.getElementById("createNewGameBtn");
      if (createBtn) {
        createBtn.addEventListener("click", (e) => {
          e.preventDefault();
          closeModal();
          createTicTacToeGame();
        });
      }
    }, 100);
  }
}

function joinTicTacToeGame(gameId) {
  console.log(`Attempting to join game: ${gameId}`);

  closeModal();

  const client = window.gameClient;
  if (!client) {
    console.error("Game client not available");
    showErrorModal("Game system not loaded. Please refresh the page.");
    return;
  }

  console.log("Game client found, calling joinGame...");

  try {
    client.joinGame(gameId);
    console.log("Join game request sent");
  } catch (error) {
    console.error("Error joining game:", error);
    showErrorModal("Failed to join game: " + error.message);
  }
}

// Make sure this function is globally accessible
window.joinTicTacToeGame = joinTicTacToeGame;

// Add this global function for joining games
window.joinTicTacToeGame = function (gameId) {
  closeModal();
  if (window.gameClient) {
    window.gameClient.joinGame(gameId);
  } else {
    showErrorModal("Game system not loaded. Please refresh the page.");
  }
};

function initializeAppDirectory() {
  const appDirectoryButton = document.getElementById("appDirectoryToggle");
  if (appDirectoryButton) {
    appDirectoryButton.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleAppDirectory();
    });
  }

  // Close dropdown when clicking outside
  document.addEventListener("click", (e) => {
    if (
      appDirectoryDropdown &&
      appDirectoryDropdown.classList.contains("show") &&
      !appDirectoryDropdown.contains(e.target) &&
      !e.target.closest("#appDirectoryToggle")
    ) {
      hideAppDirectory();
    }
  });

  // Close dropdown with Escape key
  document.addEventListener("keydown", (e) => {
    if (
      e.key === "Escape" &&
      appDirectoryDropdown &&
      appDirectoryDropdown.classList.contains("show")
    ) {
      hideAppDirectory();
    }
  });
}

// Modal functionality
function showModal(title, message, options = {}) {
  modalTitle.textContent = title;
  modalMessage.textContent = message;

  // Reset modal state
  modalInputContainer.style.display = "none";
  modalInput.value = "";
  modalInputError.style.display = "none";
  modalInputError.textContent = "";

  // Configure input if needed
  if (options.showInput) {
    modalInputContainer.style.display = "block";
    modalInput.placeholder = options.inputPlaceholder || "";
    modalInput.setAttribute("maxlength", options.maxLength || "6");
    modalInput.focus();
  }

  // Configure buttons
  modalCancelBtn.textContent = options.cancelText || "Cancel";
  modalConfirmBtn.textContent = options.confirmText || "Confirm";

  // Show/hide cancel button
  modalCancelBtn.style.display =
    options.showCancel !== false ? "block" : "none";

  // Store callback
  currentModalCallback = options.callback || null;

  // Show modal
  customModal.classList.add("show");

  // Prevent background scrolling
  document.body.style.overflow = "hidden";
}

function closeModal() {
  customModal.classList.remove("show");
  document.body.style.overflow = "";
  currentModalCallback = null;
}

function showErrorModal(message) {
  showModal("Error", message, {
    showCancel: false,
    confirmText: "OK",
    callback: (confirmed) => {
      // Just close the modal
    },
  });
}

function showInfoModal(message, callback = null) {
  showModal("Information", message, {
    showCancel: false,
    confirmText: "OK",
    callback:
      callback ||
      ((confirmed) => {
        // Just close the modal
      }),
  });
}

function showConfirmModal(message, callback) {
  showModal("Confirmation", message, {
    confirmText: "Yes",
    cancelText: "No",
    callback: callback,
  });
}

function showInputModal(title, message, options, callback) {
  showModal(title, message, {
    showInput: true,
    inputPlaceholder: options.placeholder || "",
    maxLength: options.maxLength || "6",
    confirmText: options.confirmText || "Submit",
    callback: (confirmed, inputValue) => {
      if (confirmed && options.validate) {
        const validationResult = options.validate(inputValue);
        if (validationResult !== true) {
          modalInputError.textContent = validationResult;
          modalInputError.style.display = "block";
          return false; // Prevent modal from closing
        }
      }
      callback(confirmed, inputValue);
      return true;
    },
  });
}

// Event listeners for modal
modalConfirmBtn.addEventListener("click", () => {
  if (currentModalCallback) {
    const shouldClose = currentModalCallback(true, modalInput.value);
    if (shouldClose !== false) {
      closeModal();
    }
  } else {
    closeModal();
  }
});

modalCancelBtn.addEventListener("click", () => {
  if (currentModalCallback) {
    currentModalCallback(false);
  }
  closeModal();
});

closeModalBtn.addEventListener("click", closeModal);

// Close modal when clicking outside the content
customModal.addEventListener("click", (e) => {
  if (e.target === customModal) {
    closeModal();
  }
});

// Validate input for numbers only
modalInput.addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/[^0-9]/g, "");
});

// Close modal with Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && customModal.classList.contains("show")) {
    closeModal();
  }
});

// Enter key in input field triggers confirm button
modalInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    modalConfirmBtn.click();
  }
});

// === Improved Utility Functions for ContentEditable Handling ===

// FIXED: Get plain text from contenteditable - properly handles emoticons for copying WITH colons
function getPlainText(element) {
  if (!element) return "";

  // Function to extract text recursively, handling images
  function extractText(node) {
    let text = "";
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.nodeName === "IMG" && node.dataset.emoteCode) {
        // FIXED: Always include the full :code: format with colons for copy/paste
        text += `:${node.dataset.emoteCode}:`;
      } else if (node.nodeName === "BR") {
        text += "\n";
      } else if (node.nodeName === "DIV") {
        // For div elements (new lines in contenteditable)
        if (node.previousSibling) {
          text += "\n";
        }
        for (let child of node.childNodes) {
          text += extractText(child);
        }
      } else {
        for (let child of node.childNodes) {
          text += extractText(child);
        }
      }
    }
    return text;
  }

  try {
    return extractText(element);
  } catch (error) {
    console.error("Error extracting plain text:", error);
    return element.textContent || "";
  }
}

// Improved emote replacement with better cursor handling
function replaceEmotes(element) {
  if (!element) return;

  // Get current text content and check if there are any potential emotes
  const text = getPlainText(element);

  // If no colon, no emotes to process
  if (!text.includes(":")) return;

  // Regular expression to find emote patterns
  const emoteRegex = /:([\w]+):/g;

  // Check if there are any emote matches
  if (!emoteRegex.test(text)) return;

  // Reset regex state
  emoteRegex.lastIndex = 0;

  // Save selection state before modification
  const selection = window.getSelection();
  let cursorPosition = 0;

  // Only save if focused on this element
  const isActive = document.activeElement === element;
  if (isActive && selection.rangeCount > 0) {
    cursorPosition = getCursorPosition(element);
  }

  // Process the text, replacing emotes with images
  let resultHTML = "";
  let lastIndex = 0;
  let match;
  let firstEmoteFound = false;
  let firstEmoteLength = 0;
  let hasProcessedEmotes = false;

  while ((match = emoteRegex.exec(text)) !== null) {
    const emoteCode = match[1];
    // Only replace if we have this emote
    if (emoteList[emoteCode]) {
      hasProcessedEmotes = true;

      // Track if this is the first emote found (for cursor positioning)
      if (!firstEmoteFound) {
        firstEmoteFound = true;
        firstEmoteLength = match[0].length;
      }

      // Add text before the emote
      resultHTML += text.substring(lastIndex, match.index);

      // Add the image HTML
      resultHTML += `<img src="${emoteList[emoteCode]}" 
              alt=":${emoteCode}:" 
              title=":${emoteCode}:" 
              class="emote" 
              style="display:inline-block;vertical-align:middle;width:auto;height:20px;margin:0 2px;" 
              data-emote-code="${emoteCode}">`;

      lastIndex = match.index + match[0].length;
    }
  }

  // Add any remaining text
  if (lastIndex < text.length) {
    resultHTML += text.substring(lastIndex);
  }

  // Only update if something changed
  if (hasProcessedEmotes) {
    // Update the element with the new HTML
    element.innerHTML = resultHTML;

    // Handle cursor position
    if (isActive) {
      try {
        // Try to restore cursor position
        setCursorPosition(element, cursorPosition);
      } catch (e) {
        console.error("Error restoring cursor position:", e);
        placeCursorAtEnd(element);
      }
    }
  }
}

// Set cursor position at the end of contenteditable
function placeCursorAtEnd(element) {
  if (!element) return;

  try {
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false); // false means collapse to end

    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  } catch (error) {
    console.error("Error placing cursor at end:", error);
  }
}

// IMPROVED: Find emote code at cursor - now handles more edge cases
function findEmoteAtCursor() {
  // Only look in the current user's input
  if (!chatInput || document.activeElement !== chatInput) return null;

  const selection = window.getSelection();
  if (selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  const cursorNode = range.startContainer;
  const cursorOffset = range.startOffset;

  // If cursor is in a text node
  if (cursorNode.nodeType === Node.TEXT_NODE) {
    const text = cursorNode.textContent;

    // Look for the colon before cursor
    let startPos = cursorOffset - 1;
    while (startPos >= 0 && text[startPos] !== ":") {
      startPos--;
    }

    if (startPos >= 0 && text[startPos] === ":") {
      const prefix = text.substring(startPos + 1, cursorOffset);
      if (prefix) {
        return {
          node: cursorNode,
          prefix: prefix,
          startPos: startPos,
          endPos: cursorOffset,
        };
      }
    }
  }

  return null;
}

// FIXED: Improved autocomplete functions with better styling
function showAutocomplete(prefix) {
  if (!prefix || prefix.length < 1) {
    hideAutocomplete();
    return;
  }

  // Filter emotes by prefix
  filteredEmotes = Object.keys(emoteList)
    .filter((code) => code.toLowerCase().startsWith(prefix.toLowerCase()))
    .slice(0, 10); // Limit to 10 suggestions

  if (filteredEmotes.length === 0) {
    hideAutocomplete();
    return;
  }

  // Save current emote info for when user clicks on menu
  currentEmoteInfo = findEmoteAtCursor();

  if (!emoteAutocomplete) {
    emoteAutocomplete = document.getElementById("emoteAutocomplete");
    if (!emoteAutocomplete) {
      // Create autocomplete element if it doesn't exist
      emoteAutocomplete = document.createElement("div");
      emoteAutocomplete.id = "emoteAutocomplete";
      emoteAutocomplete.className = "emote-autocomplete";
      document.body.appendChild(emoteAutocomplete);
    }
  }

  // Get position for dropdown
  const selection = window.getSelection();
  if (selection.rangeCount === 0) {
    hideAutocomplete();
    return;
  }

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  // Populate autocomplete with improved styling
  emoteAutocomplete.innerHTML = "";

  // Add a header
  const header = document.createElement("div");
  header.className = "emote-autocomplete-header";
  header.textContent = "Emoticons";
  header.style.padding = "5px 10px";
  header.style.fontWeight = "bold";
  header.style.borderBottom = "1px solid #555";
  header.style.color = "#eee";
  emoteAutocomplete.appendChild(header);

  // Add a container for the list
  const listContainer = document.createElement("div");
  listContainer.className = "emote-autocomplete-list";
  listContainer.style.maxHeight = "250px";
  listContainer.style.overflowY = "auto";

  filteredEmotes.forEach((code, index) => {
    const item = document.createElement("div");
    item.className = "emote-autocomplete-item";
    item.style.display = "flex";
    item.style.alignItems = "center";
    item.style.padding = "8px 10px";
    item.style.cursor = "pointer";
    item.style.borderBottom = "1px solid #444";
    item.style.color = "#fff";

    if (index === selectedEmoteIndex) {
      item.classList.add("selected");
      item.style.backgroundColor = "#555";
    }

    const img = document.createElement("img");
    img.src = emoteList[code];
    img.alt = `:${code}:`;
    img.style.width = "auto";
    img.style.height = "20px";
    img.style.marginRight = "10px";
    img.style.verticalAlign = "middle";

    const span = document.createElement("span");
    span.textContent = code;
    span.style.fontFamily = "monospace";

    item.appendChild(img);
    item.appendChild(span);

    // FIXED: Improved click handler to fix emote insertion issues
    item.addEventListener("mousedown", (e) => {
      // Prevent default to prevent blur and focus loss
      e.preventDefault();
      e.stopPropagation();

      // Store the emote code and emote info for insertion
      lastClickedEmoteCode = code;

      // Capture emote info now before focus changes
      const capturedEmoteInfo = { ...currentEmoteInfo };

      // Use setTimeout to ensure this runs after the current event cycle
      setTimeout(() => {
        insertEmoteFromAutocompleteClick(code, capturedEmoteInfo);
      }, 0);
    });

    item.addEventListener("mouseover", () => {
      selectedEmoteIndex = index;
      updateSelectedEmote();
    });

    listContainer.appendChild(item);
  });

  emoteAutocomplete.appendChild(listContainer);

  // Position dropdown near cursor
  const top = rect.bottom + window.scrollY + 5;
  const left = rect.left + window.scrollX;

  emoteAutocomplete.style.top = `${top}px`;
  emoteAutocomplete.style.left = `${left}px`;
  emoteAutocomplete.style.display = "block";
  emoteAutocomplete.style.zIndex = "10000"; // Make sure it's on top

  autocompleteActive = true;
  currentEmotePrefix = prefix;

  // Auto-select first item by default
  if (filteredEmotes.length > 0 && selectedEmoteIndex < 0) {
    selectedEmoteIndex = 0;
    updateSelectedEmote();
  }
}

function hideAutocomplete() {
  if (emoteAutocomplete) {
    emoteAutocomplete.style.display = "none";
  }
  autocompleteActive = false;
  selectedEmoteIndex = -1;
  currentEmotePrefix = "";
  // Don't clear currentEmoteInfo here, it's needed for handling clicks
}

// Improved emote navigation with Tab selecting first emote by default
function handleEmoteNavigation(e) {
  if (!autocompleteActive) return false;

  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      selectedEmoteIndex = (selectedEmoteIndex + 1) % filteredEmotes.length;
      updateSelectedEmote();
      return true;

    case "ArrowUp":
      e.preventDefault();
      selectedEmoteIndex =
        selectedEmoteIndex <= 0
          ? filteredEmotes.length - 1
          : selectedEmoteIndex - 1;
      updateSelectedEmote();
      return true;

    case "Tab":
    case "Enter":
      e.preventDefault();
      // If no emote is selected, select the first one
      if (selectedEmoteIndex < 0 && filteredEmotes.length > 0) {
        selectedEmoteIndex = 0;
      }

      if (
        selectedEmoteIndex >= 0 &&
        selectedEmoteIndex < filteredEmotes.length
      ) {
        insertEmoteFromAutocomplete(filteredEmotes[selectedEmoteIndex]);
        return true;
      }
      break;

    case "Escape":
      hideAutocomplete();
      return true;
  }

  return false;
}

function updateSelectedEmote() {
  if (!emoteAutocomplete) return;

  const items = emoteAutocomplete.querySelectorAll(".emote-autocomplete-item");
  items.forEach((item, index) => {
    if (index === selectedEmoteIndex) {
      item.classList.add("selected");
      item.style.backgroundColor = "#555";
      // Scroll item into view if needed
      if (
        item.offsetTop < item.parentNode.scrollTop ||
        item.offsetTop + item.offsetHeight >
          item.parentNode.scrollTop + item.parentNode.offsetHeight
      ) {
        item.scrollIntoView({ block: "nearest" });
      }
    } else {
      item.classList.remove("selected");
      item.style.backgroundColor = "";
    }
  });
}

// NEW: Separate function specifically for handling click-based emoticon insertion
function insertEmoteFromAutocompleteClick(emoteCode, capturedEmoteInfo) {
  // Make sure we have the chatInput reference
  if (!chatInput) return;

  // Force focus on chat input to ensure we're inserting in the right place
  chatInput.focus();

  // Create the emote image HTML
  const emoteHtml = `<img src="${emoteList[emoteCode]}" 
        alt=":${emoteCode}:" 
        title=":${emoteCode}:" 
        class="emote" 
        style="display:inline-block;vertical-align:middle;width:auto;height:20px;margin:0 2px;" 
        data-emote-code="${emoteCode}">`;

  try {
    // Use the captured emote info to replace the typed prefix
    if (
      capturedEmoteInfo &&
      capturedEmoteInfo.node &&
      capturedEmoteInfo.node.parentNode
    ) {
      const selection = window.getSelection();

      // Create a new range for replacing the emote text
      const prefixRange = document.createRange();
      prefixRange.setStart(capturedEmoteInfo.node, capturedEmoteInfo.startPos);
      prefixRange.setEnd(capturedEmoteInfo.node, capturedEmoteInfo.endPos);

      // Select this range
      selection.removeAllRanges();
      selection.addRange(prefixRange);

      // Delete the selection and insert the emote
      document.execCommand("insertHTML", false, emoteHtml);
    } else {
      // Just insert at the current cursor position
      document.execCommand("insertHTML", false, emoteHtml);
    }

    // Hide autocomplete
    hideAutocomplete();

    // Update the last sent message
    updateSentMessage();

    // Reset current emote info after successful insertion
    currentEmoteInfo = null;

    // Give time for the DOM to update, then place cursor after the inserted emote
    setTimeout(() => {
      chatInput.focus();
      // Find the emote at cursor after insertion, allowing for future emotes
      const newEmoteInfo = findEmoteAtCursor();
      if (!newEmoteInfo) {
        // If no emote at cursor, show autocomplete again if user starts typing an emote
        chatInput.addEventListener(
          "input",
          function checkForEmote() {
            const checkEmoteInfo = findEmoteAtCursor();
            if (checkEmoteInfo) {
              showAutocomplete(checkEmoteInfo.prefix);
              chatInput.removeEventListener("input", checkForEmote);
            }
          },
          { once: true }
        );
      }
    }, 10);
  } catch (error) {
    console.error("Error inserting emote:", error);
    // Try a simple insertion as fallback
    try {
      document.execCommand("insertHTML", false, emoteHtml);
      updateSentMessage();
    } catch (e) {
      console.error("Fallback insertion failed:", e);
    }
  }
}

// FIXED: Function specifically for inserting emotes from autocomplete via keyboard
function insertEmoteFromAutocomplete(emoteCode) {
  // Make sure we have the chatInput reference
  if (!chatInput) return;

  // Force focus on chat input to ensure we're inserting in the right place
  chatInput.focus();

  // Create the emote image HTML
  const emoteHtml = `<img src="${emoteList[emoteCode]}" 
        alt=":${emoteCode}:" 
        title=":${emoteCode}:" 
        class="emote" 
        style="display:inline-block;vertical-align:middle;width:auto;height:20px;margin:0 2px;" 
        data-emote-code="${emoteCode}">`;

  // Use the current emote info to replace the typed prefix
  if (currentEmoteInfo) {
    try {
      const selection = window.getSelection();

      // Create a new range for replacing the emote text
      const prefixRange = document.createRange();
      prefixRange.setStart(currentEmoteInfo.node, currentEmoteInfo.startPos);
      prefixRange.setEnd(currentEmoteInfo.node, currentEmoteInfo.endPos);

      // Select this range
      selection.removeAllRanges();
      selection.addRange(prefixRange);

      // Delete the selection and insert the emote
      document.execCommand("insertHTML", false, emoteHtml);
    } catch (error) {
      console.error("Error inserting emote with range:", error);
      // Fallback to inserting at current position
      document.execCommand("insertHTML", false, emoteHtml);
    }
  } else {
    // Just insert at the current cursor position
    document.execCommand("insertHTML", false, emoteHtml);
  }

  // Hide autocomplete
  hideAutocomplete();

  // Update the last sent message
  updateSentMessage();

  // Reset current emote info after successful insertion
  currentEmoteInfo = null;

  // Keep focus on input and place cursor after the inserted emote
  setTimeout(() => {
    chatInput.focus();
  }, 10);
}

// FIXED: Generic function to insert emote at cursor (for dropdown menu)
function insertEmoteAtCursor(emoteCode) {
  // Make sure we have the chatInput reference
  if (!chatInput) return;

  // Force focus on chat input to ensure we're inserting in the right place
  chatInput.focus();

  // Create the emote image HTML
  const emoteHtml = `<img src="${emoteList[emoteCode]}" 
        alt=":${emoteCode}:" 
        title=":${emoteCode}:" 
        class="emote" 
        style="display:inline-block;vertical-align:middle;width:auto;height:20px;margin:0 2px;" 
        data-emote-code="${emoteCode}">`;

  // Insert at the current cursor position
  document.execCommand("insertHTML", false, emoteHtml);

  // Update the last sent message
  updateSentMessage();

  // Keep focus on input and place cursor after the inserted emote
  setTimeout(() => {
    chatInput.focus();
  }, 10);
}

// Update the last sent message with the current content
function updateSentMessage() {
  try {
    if (!chatInput) return;

    const plainText = getPlainText(chatInput);
    const diff = getDiff(lastSentMessage, plainText);
    if (diff) {
      socket.emit("chat update", { diff, index: diff.index });
      lastSentMessage = plainText;
    }
  } catch (error) {
    console.error("Error updating sent message:", error);
  }
}

// IMPROVED: Create emoticons dropdown button that replaces room-type
function createEmotesDropdown() {
  // Find room-type element
  const roomTypeEl = document.querySelector(".room-type");
  if (!roomTypeEl) return;

  // Create button
  const button = document.createElement("button");
  button.id = "emotesButton";
  button.classList.add("emotes-button");
  button.textContent = "Emoticons";
  button.style.padding = "5px 10px";
  button.style.backgroundColor = "#444";
  button.style.color = "white";
  button.style.border = "none";
  button.style.borderRadius = "4px";
  button.style.cursor = "pointer";

  // Create dropdown
  const dropdown = document.createElement("div");
  dropdown.id = "emotesDropdown";
  dropdown.classList.add("emotes-dropdown");
  dropdown.style.display = "none";
  dropdown.style.position = "absolute";
  dropdown.style.backgroundColor = "#333";
  dropdown.style.border = "1px solid #555";
  dropdown.style.borderRadius = "4px";
  dropdown.style.padding = "10px";
  dropdown.style.zIndex = "10000"; // Higher z-index to ensure it's on top
  dropdown.style.maxWidth = "300px";
  dropdown.style.maxHeight = "300px";
  dropdown.style.overflowY = "auto";
  dropdown.style.flexWrap = "wrap";
  dropdown.style.gap = "5px";

  // Populate dropdown with emotes
  Object.entries(emoteList).forEach(([code, url]) => {
    const emoteItem = document.createElement("div");
    emoteItem.classList.add("emote-item");
    emoteItem.style.display = "flex";
    emoteItem.style.flexDirection = "column";
    emoteItem.style.alignItems = "center";
    emoteItem.style.padding = "5px";
    emoteItem.style.cursor = "pointer";
    emoteItem.style.borderRadius = "4px";
    emoteItem.style.backgroundColor = "#444";
    emoteItem.style.width = "60px";
    emoteItem.style.height = "60px";

    const img = document.createElement("img");
    img.src = url;
    img.alt = `:${code}:`;
    img.style.width = "30px";
    img.style.height = "auto";

    const name = document.createElement("span");
    name.textContent = code;
    name.style.fontSize = "10px";
    name.style.color = "white";
    name.style.marginTop = "5px";
    name.style.textAlign = "center";
    name.style.wordBreak = "break-all";

    emoteItem.appendChild(img);
    emoteItem.appendChild(name);

    // FIXED: Improved click handler for dropdown emoticon selection
    emoteItem.addEventListener("mousedown", (e) => {
      // Prevent the default action to avoid focus loss
      e.preventDefault();
      e.stopPropagation();

      // Store the code for insertion
      const emoteCodeToInsert = code;

      // Close the dropdown
      dropdown.style.display = "none";

      // Insert the emoticon with a small delay to ensure focus handling works correctly
      setTimeout(() => {
        // Insert the emoticon (ensure chatInput is focused first)
        if (chatInput) {
          chatInput.focus();
          insertEmoteAtCursor(emoteCodeToInsert);
        }
      }, 0);
    });

    dropdown.appendChild(emoteItem);
  });

  // Toggle dropdown on button click
  button.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    const isVisible = dropdown.style.display === "flex";

    // Close all dropdowns first
    document.querySelectorAll(".emotes-dropdown").forEach((d) => {
      d.style.display = "none";
    });

    if (!isVisible) {
      // Position dropdown below button
      const rect = button.getBoundingClientRect();
      dropdown.style.top = `${rect.bottom + window.scrollY + 5}px`;
      dropdown.style.left = `${rect.left + window.scrollX}px`;
      dropdown.style.display = "flex";

      // Make sure chat input keeps focus even when dropdown is open
      if (chatInput) {
        setTimeout(() => chatInput.focus(), 0);
      }
    }
  });

  // Close dropdown when clicking elsewhere
  document.addEventListener("click", (e) => {
    if (
      dropdown.style.display === "flex" &&
      !dropdown.contains(e.target) &&
      e.target !== button
    ) {
      dropdown.style.display = "none";
    }
  });

  // Replace room-type with button
  roomTypeEl.parentNode.replaceChild(button, roomTypeEl);

  // Add dropdown to the document body
  document.body.appendChild(dropdown);
}

function playJoinSound() {
  if (soundEnabled) {
    joinSound
      .play()
      .catch((error) => console.error("Error playing join sound:", error));
  }
}

function playLeaveSound() {
  if (soundEnabled) {
    leaveSound
      .play()
      .catch((error) => console.error("Error playing leave sound:", error));
  }
}

function toggleMute() {
  soundEnabled = !soundEnabled;
  localStorage.setItem("soundEnabled", JSON.stringify(soundEnabled));
  updateMuteIcon();
}

function updateMuteIcon() {
  if (soundEnabled) {
    muteIcon.src = "images/icons/sound-on.svg";
    muteIcon.alt = "Sound On";
  } else {
    muteIcon.src = "images/icons/sound-off.svg";
    muteIcon.alt = "Sound Off";
  }
}

function updateVotesUI(votes) {
  document.querySelectorAll(".chat-row").forEach((row) => {
    const userId = row.dataset.userId;
    const voteButton = row.querySelector(".vote-button");
    const votesAgainstUser = Object.values(votes).filter(
      (v) => v === userId
    ).length;

    if (userId === currentUserId) {
      // Current user - show votes counter in their info area (since their vote button is hidden)
      let votesCounter = row.querySelector(".votes-counter");
      if (!votesCounter) {
        votesCounter = document.createElement("div");
        votesCounter.classList.add("votes-counter");
        votesCounter.style.display = "inline-block";
        votesCounter.style.marginLeft = "10px";
        votesCounter.style.padding = "2px 6px";
        votesCounter.style.backgroundColor = "#333";
        votesCounter.style.borderRadius = "4px";
        votesCounter.style.fontSize = "14px";
        row.querySelector(".user-info").appendChild(votesCounter);
      }

      if (votesAgainstUser > 0) {
        votesCounter.textContent = `👎 ${votesAgainstUser}`;
        votesCounter.style.color = "#ff6b6b"; // Red color to draw attention
      } else {
        votesCounter.textContent = "👎 0";
        votesCounter.style.color = "#aaa"; // Gray when no votes
      }
    }

    // Update vote button for other users
    if (voteButton) {
      voteButton.innerHTML = `👎 ${votesAgainstUser}`;
      if (votes[currentUserId] === userId) {
        voteButton.classList.add("voted");
      } else {
        voteButton.classList.remove("voted");
      }
    }
  });
}

function updateCurrentMessages(messages) {
  Object.keys(messages).forEach((userId) => {
    const chatDiv = document.querySelector(
      `.chat-row[data-user-id="${userId}"] .chat-input`
    );
    if (chatDiv) {
      const messageText = messages[userId].slice(0, MAX_MESSAGE_LENGTH);

      if (userId === currentUserId) {
        // Save current focus state
        const isActive = document.activeElement === chatDiv;
        let cursorPosition = 0;

        if (isActive) {
          const selection = window.getSelection();
          if (selection.rangeCount > 0) {
            // Save cursor position
            cursorPosition = getCursorPosition(chatDiv);
          }
        }

        // Clear and set plain text first
        chatDiv.innerHTML = "";
        chatDiv.textContent = messageText;

        // Then replace emotes
        replaceEmotes(chatDiv);

        // Update last sent message
        lastSentMessage = messageText;

        // Restore cursor position if previously focused
        if (isActive) {
          try {
            setCursorPosition(
              chatDiv,
              Math.min(cursorPosition, messageText.length)
            );
          } catch (e) {
            console.error("Error restoring cursor:", e);
            // Place cursor at end as fallback
            placeCursorAtEnd(chatDiv);
          }
        }
      } else {
        // For other users just render the message with emotes
        updateOtherUserMessage(chatDiv, messageText);
      }
    }
  });
}

// Update message display for other users
function updateOtherUserMessage(element, message) {
  if (!element) return;

  // Clear the element
  element.innerHTML = "";

  // Create a text node with the message
  const textNode = document.createTextNode(message);
  element.appendChild(textNode);

  // Replace emotes
  replaceEmotes(element);
}

async function initRoom() {
  // Load emotes first
  await loadEmotes();

  const urlParams = new URLSearchParams(window.location.search);
  const roomIdFromUrl = urlParams.get("roomId");
  const accessCodeFromUrl = urlParams.get("accessCode");
  const spectatorMode = urlParams.get("spectator") === "true"; // NEW: Check for spectator flag

  if (roomIdFromUrl) {
    currentRoomId = roomIdFromUrl;
    isSpectator = spectatorMode; // NEW: Set spectator mode

    if (spectatorMode) {
      joinRoomAsSpectator(roomIdFromUrl, accessCodeFromUrl);
    } else {
      joinRoom(roomIdFromUrl, accessCodeFromUrl);
    }
  } else {
    console.error("No room ID provided in URL");
    showInfoModal("No room ID provided. Redirecting to lobby.", () => {
      window.location.href = "/index.html";
    });
    return;
  }
}

// ADD NEW FUNCTION: joinRoomAsSpectator
function joinRoomAsSpectator(roomId, accessCode = null) {
  const data = { roomId, accessCode };
  socket.emit("join room as spectator", data);
}

// ADD NEW SOCKET EVENT HANDLER: "room joined as spectator"
socket.on("room joined as spectator", (data) => {
  currentUserId = data.userId;
  currentRoomId = data.roomId;
  currentUsername = data.username;
  currentLocation = data.location;
  currentRoomLayout = data.layout || currentRoomLayout;
  currentRoomName = data.roomName;
  isSpectator = true; // NEW: Set spectator flag
  spectatorCount = data.spectators ? data.spectators.length : 0;

  updateRoomInfo(data);
  updateRoomUI(data);
  updateSpectatorUI(); // NEW: Setup spectator-specific UI

  if (data.votes) {
    updateVotesUI(data.votes);
  }
  if (data.currentMessages) {
    updateCurrentMessages(data.currentMessages);
  }
  updateInviteLink();

  // Create emotes dropdown (but disable it for spectators)
  createEmotesDropdown();
  if (isSpectator) {
    const emotesButton = document.getElementById("emotesButton");
    if (emotesButton) {
      emotesButton.disabled = true;
      emotesButton.style.opacity = "0.5";
      emotesButton.style.cursor = "not-allowed";
    }
  }
});

// ADD NEW FUNCTION: updateSpectatorUI
function updateSpectatorUI() {
  if (!isSpectator) return;

  // Update navbar to show spectator status
  const roomTypeEl =
    document.querySelector(".room-type") ||
    document.getElementById("emotesButton");
  if (roomTypeEl.tagName === "BUTTON") {
    // If emotes button exists, add spectator indicator next to it
    const spectatorIndicator = document.createElement("div");
    spectatorIndicator.className = "spectator-indicator";
    spectatorIndicator.textContent = "👁️ Spectating";
    spectatorIndicator.style.padding = "5px 10px";
    spectatorIndicator.style.backgroundColor = "#000"; // black background
    spectatorIndicator.style.color = "#fff"; // white text
    spectatorIndicator.style.borderRadius = "5px"; //  rounded
    spectatorIndicator.style.border = "1px solid #ff9800"; // orange border
    spectatorIndicator.style.fontWeight = "bold";
    spectatorIndicator.style.fontSize = "12px";
    roomTypeEl.parentNode.insertBefore(spectatorIndicator, roomTypeEl);
  } else {
    roomTypeEl.textContent = "👁️ Spectating";
    roomTypeEl.style.backgroundColor = "#000"; // black background
    roomTypeEl.style.color = "#fff"; // white text
    roomTypeEl.style.borderRadius = "8px"; // more rounded
    roomTypeEl.style.border = "2px solid orange"; // orange border
  }

  // Add spectator count display
  const secondNavbar = document.querySelector(".second-navbar");
  if (secondNavbar && spectatorCount > 0) {
    const spectatorCountEl = document.createElement("div");
    spectatorCountEl.className = "spectator-count";
    spectatorCountEl.textContent = `${spectatorCount} watching`;
    spectatorCountEl.style.fontSize = "12px";
    spectatorCountEl.style.color = "#ffeb3b";
    spectatorCountEl.style.fontWeight = "bold";
    secondNavbar.appendChild(spectatorCountEl);
  }

  // Disable all interactive elements
  disableInteractiveElements();
}

// ADD NEW FUNCTION: disableInteractiveElements
function disableInteractiveElements() {
  // Disable any input fields that might exist
  document.querySelectorAll(".chat-input").forEach((input) => {
    if (input.contentEditable) {
      input.contentEditable = false;
      input.style.opacity = "0.6";
      input.style.cursor = "not-allowed";
      input.style.backgroundColor = "#000000";
    }
  });

  // Disable vote buttons
  document.querySelectorAll(".vote-button").forEach((button) => {
    button.disabled = true;
    button.style.opacity = "0.5";
    button.style.cursor = "not-allowed";
  });

  // Disable mute buttons (spectators shouldn't be able to mute)
  document.querySelectorAll(".mute-button").forEach((button) => {
    button.disabled = true;
    button.style.opacity = "0.5";
    button.style.cursor = "not-allowed";
  });
}

function joinRoom(roomId, accessCode = null) {
  const data = { roomId, accessCode };
  socket.emit("join room", data);
}

socket.on("access code required", () => {
  showInputModal(
    "Access Code Required",
    "Please enter the 6-digit access code for this room:",
    {
      placeholder: "6-digit code",
      maxLength: "6",
      validate: (value) => {
        if (!value) return "Access code is required";
        if (value.length !== 6 || !/^\d+$/.test(value)) {
          return "Invalid access code. Please enter a 6-digit number.";
        }
        return true;
      },
    },
    (confirmed, accessCode) => {
      if (confirmed && accessCode) {
        joinRoom(currentRoomId, accessCode);
      } else {
        showInfoModal("You will be redirected to the lobby.", () => {
          window.location.href = "/index.html";
        });
      }
    }
  );
});

socket.on("update votes", (votes) => {
  updateVotesUI(votes);
});

socket.on("spectator joined", (data) => {
  spectatorCount = data.spectatorCount;
  // Update spectator count display
  const spectatorCountEl = document.querySelector(".spectator-count");
  if (spectatorCountEl) {
    spectatorCountEl.textContent = `${spectatorCount} watching`;
  }
});

socket.on("spectator left", (data) => {
  spectatorCount = data.spectatorCount;
  // Update spectator count display
  const spectatorCountEl = document.querySelector(".spectator-count");
  if (spectatorCountEl) {
    if (spectatorCount > 0) {
      spectatorCountEl.textContent = `${spectatorCount} watching`;
    } else {
      spectatorCountEl.remove();
    }
  }
});

socket.on("kicked", () => {
  showInfoModal(
    "You have been removed from the room by a majority vote.",
    () => {
      window.location.href = "/index.html";
    }
  );
});

socket.on("room full", () => {
  showInfoModal(
    "This room is full. You will be redirected to the lobby.",
    () => {
      window.location.href = "/index.html";
    }
  );
});

socket.on("room joined", (data) => {
  currentUserId = data.userId;
  currentRoomId = data.roomId;
  currentUsername = data.username;
  currentLocation = data.location;
  currentRoomLayout = data.layout || currentRoomLayout;
  currentRoomName = data.roomName;

  updateRoomInfo(data);
  updateRoomUI(data);

  if (data.votes) {
    updateVotesUI(data.votes);
  }
  if (data.currentMessages) {
    updateCurrentMessages(data.currentMessages);
  }
  updateInviteLink();

  // Create emotes dropdown
  createEmotesDropdown();

  // Focus the input field immediately when joining
  setTimeout(() => {
    if (chatInput) {
      chatInput.focus();
      placeCursorAtEnd(chatInput);
    }
  }, 100);
});

socket.on("room not found", () => {
  showInfoModal(
    "The room you are trying to join does not exist or has been deleted. Redirecting to lobby.",
    () => {
      window.location.href = "/index.html";
    }
  );
});

// Modified user joined handler to avoid disrupting typing
socket.on("user joined", (data) => {
  // Don't rebuild the UI, just add the new user
  if (!document.querySelector(`.chat-row[data-user-id="${data.id}"]`)) {
    const chatContainer = document.querySelector(".chat-container");
    if (chatContainer) {
      createUserRow(data, chatContainer);
      adjustLayout();
      updateRoomInfo(data);
      playJoinSound();

      // Make sure our input stays focused
      if (chatInput) {
        setTimeout(() => {
          chatInput.focus();
        }, 10);
      }
    }
  }
});

// Modified user left handler to avoid disrupting typing
socket.on("user left", (userId) => {
  // Only remove the specific user's row
  if (userId !== currentUserId) {
    const userRow = document.querySelector(
      `.chat-row[data-user-id="${userId}"]`
    );
    if (userRow) {
      userRow.remove();
      adjustLayout();
      playLeaveSound();

      // Make sure our input stays focused
      if (chatInput) {
        setTimeout(() => {
          chatInput.focus();
        }, 10);
      }
    }
  }
});

// Modified room update to preserve focus and input
socket.on("room update", (roomData) => {
  currentRoomLayout = roomData.layout || currentRoomLayout;

  // Update spectator count
  if (roomData.spectators) {
    spectatorCount = roomData.spectators.length;
    const spectatorCountEl = document.querySelector(".spectator-count");
    if (spectatorCountEl) {
      if (spectatorCount > 0) {
        spectatorCountEl.textContent = `${spectatorCount} watching`;
      } else {
        spectatorCountEl.remove();
      }
    }
  }

  updateRoomInfo(roomData);

  // [Keep all existing room update logic...]
  // Track current focus and input values
  const activeElement = document.activeElement;
  const inputValues = new Map();
  let currentCursorPosition = 0;

  // Save current state
  document.querySelectorAll(".chat-row").forEach((row) => {
    const userId = row.dataset.userId;
    const input = row.querySelector(".chat-input");
    if (input) {
      inputValues.set(userId, getPlainText(input));
      if (activeElement === input) {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
          currentCursorPosition = getCursorPosition(input);
        }
      }
    }
  });

  // Only update what's necessary
  const existingUserIds = new Set();
  document.querySelectorAll(".chat-row").forEach((row) => {
    existingUserIds.add(row.dataset.userId);
  });

  // Add missing users
  if (roomData.users && Array.isArray(roomData.users)) {
    const chatContainer = document.querySelector(".chat-container");
    roomData.users.forEach((user) => {
      if (!existingUserIds.has(user.id)) {
        createUserRow(user, chatContainer);
      }
    });
  }

  // Remove users no longer in the room
  const newUserIds = new Set(roomData.users.map((u) => u.id));
  document.querySelectorAll(".chat-row").forEach((row) => {
    const userId = row.dataset.userId;
    if (!newUserIds.has(userId) && userId !== currentUserId) {
      row.remove();
    }
  });

  // Restore state
  inputValues.forEach((value, userId) => {
    const chatDiv = document.querySelector(
      `.chat-row[data-user-id="${userId}"] .chat-input`
    );
    if (chatDiv) {
      if (userId === currentUserId && !isSpectator) {
        chatDiv.innerHTML = "";
        chatDiv.textContent = value;
        replaceEmotes(chatDiv);
        if (
          activeElement &&
          activeElement.classList.contains("chat-input") &&
          activeElement.closest(".chat-row").dataset.userId === userId
        ) {
          chatDiv.focus();
          try {
            setCursorPosition(chatDiv, currentCursorPosition);
          } catch (e) {
            placeCursorAtEnd(chatDiv);
          }
        }
      } else {
        updateOtherUserMessage(chatDiv, value);
      }
    }
  });

  if (roomData.votes) {
    updateVotesUI(roomData.votes);
  }

  adjustLayout();
});

socket.on("afk timeout", (data) => {
  showInfoModal(
    data.message ?? "You have been removed from the room due to inactivity.",
    () => {
      window.location.href = data.redirectTo ?? "/";
    }
  );
});

socket.on("error", (error) => {
  console.log(error);
  showErrorModal(
    (error.error.replaceDefaultText ? "" : `An error occurred: `) +
      error.error.message,
    error.error.code
  );
});

// IMPROVED: Create a user row without affecting the rest of the UI
function createUserRow(user, container) {
  const chatRow = document.createElement("div");
  chatRow.classList.add("chat-row");
  if (user.id === currentUserId) {
    chatRow.classList.add("current-user");
  }
  chatRow.dataset.userId = user.id;

  const userInfoSpan = document.createElement("span");
  userInfoSpan.classList.add("user-info");
  userInfoSpan.textContent = `${user.username} / ${user.location}`;

  // Mute button
  const muteButton = document.createElement("button");
  muteButton.classList.add("mute-button");
  muteButton.innerHTML = "🔊";
  muteButton.style.display = "none";

  // Disable mute button for spectators
  if (isSpectator) {
    muteButton.disabled = true;
    muteButton.style.opacity = "0.5";
  } else {
    muteButton.addEventListener("click", () => {
      if (mutedUsers.has(user.id)) {
        // Unmute
        mutedUsers.delete(user.id);
        muteButton.innerHTML = "🔊";
        muteButton.classList.remove("muted");
        const chatInput = chatRow.querySelector(".chat-input");
        if (chatInput) chatInput.style.opacity = "1";
        const queued = storedMessagesForMutedUsers.get(user.id);
        if (queued && queued.length) {
          queued.forEach((data) => displayChatMessage(data));
          storedMessagesForMutedUsers.delete(user.id);
        }
      } else {
        // Mute
        mutedUsers.add(user.id);
        muteButton.innerHTML = "🔇";
        muteButton.classList.add("muted");
        const chatInput = chatRow.querySelector(".chat-input");
        if (chatInput) chatInput.style.opacity = "0.3";
      }
    });
  }

  // Vote button - now has a consistent style for all users
  const voteButton = document.createElement("button");
  voteButton.classList.add("vote-button");
  voteButton.innerHTML = "👎 0";
  voteButton.style.display = "none";

  // Disable vote button for spectators and add click handler for non-spectators
  if (isSpectator) {
    voteButton.disabled = true;
    voteButton.style.opacity = "0.5";
  } else if (user.id !== currentUserId) {
    voteButton.addEventListener("click", () => {
      socket.emit("vote", { targetUserId: user.id });
    });
  }

  userInfoSpan.appendChild(muteButton);
  userInfoSpan.appendChild(voteButton);

  // Create chat input wrapper
  const chatInputWrapper = document.createElement("div");
  chatInputWrapper.classList.add("chat-input-wrapper");
  chatInputWrapper.style.position = "relative";
  chatInputWrapper.style.width = "100%";
  chatInputWrapper.style.height = "100%";

  // Create contenteditable div for input
  const contentEditableDiv = document.createElement("div");
  contentEditableDiv.classList.add("chat-input");

  // NEW: Disable input for spectators and non-current users
  const canEdit = !isSpectator && user.id === currentUserId;
  contentEditableDiv.contentEditable = canEdit;

  contentEditableDiv.style.width = "100%";
  contentEditableDiv.style.height = "100%";
  contentEditableDiv.style.backgroundColor = "black";
  contentEditableDiv.style.color = "orange";
  contentEditableDiv.style.overflowX = "hidden";
  contentEditableDiv.style.overflowY = "auto";
  contentEditableDiv.style.padding = "6px 8px";
  contentEditableDiv.style.boxSizing = "border-box";
  contentEditableDiv.style.outline = "none";
  contentEditableDiv.style.whiteSpace = "pre-wrap";
  contentEditableDiv.style.wordBreak = "break-word";
  contentEditableDiv.style.position = "absolute";
  contentEditableDiv.style.top = "0";
  contentEditableDiv.style.left = "0";
  contentEditableDiv.style.zIndex = "2";
  contentEditableDiv.spellcheck = false;

  // NEW: Style differently for spectators
  if (isSpectator || user.id !== currentUserId) {
    contentEditableDiv.style.opacity = isSpectator ? "0.8" : "1";
    contentEditableDiv.style.cursor = isSpectator ? "not-allowed" : "default";
    if (isSpectator && user.id === currentUserId) {
      contentEditableDiv.style.backgroundColor = "#000000";
    }
  }

  // Set up for current user (only if not spectator)
  if (user.id === currentUserId && !isSpectator) {
    chatInput = contentEditableDiv;

    // [Keep all existing event listeners for input, keydown, etc.]
    // Prevent paste with formatting
    contentEditableDiv.addEventListener("paste", (e) => {
      e.preventDefault();
      let text = "";
      if (e.clipboardData && e.clipboardData.getData) {
        text = e.clipboardData.getData("text/plain");
      }
      document.execCommand("insertText", false, text);
    });

    // Handle input events
    contentEditableDiv.addEventListener("input", (e) => {
      const emotePrefixInfo = findEmoteAtCursor();
      if (emotePrefixInfo) {
        currentEmoteInfo = emotePrefixInfo;
        showAutocomplete(emotePrefixInfo.prefix);
      } else {
        hideAutocomplete();
      }

      const text = getPlainText(contentEditableDiv);
      if (text.includes(":") && /:([\w]+):/.test(text)) {
        replaceEmotes(contentEditableDiv);
      }
      updateSentMessage();
    });

    // Handle keydown for special keys
    contentEditableDiv.addEventListener("keydown", (e) => {
      if (handleEmoteNavigation(e)) {
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        return;
      }
      if (
        getPlainText(contentEditableDiv).length >= MAX_MESSAGE_LENGTH &&
        ![
          "Backspace",
          "Delete",
          "ArrowLeft",
          "ArrowRight",
          "Home",
          "End",
        ].includes(e.key)
      ) {
        e.preventDefault();
        return;
      }
    });

    contentEditableDiv.addEventListener("mousedown", (e) => {
      e.stopPropagation();
    });

    setTimeout(() => {
      contentEditableDiv.focus();
    }, 0);
  }

  chatInputWrapper.appendChild(contentEditableDiv);
  chatRow.appendChild(userInfoSpan);
  chatRow.appendChild(chatInputWrapper);
  container.appendChild(chatRow);

  adjustVoteButtonVisibility();
  adjustMuteButtonVisibility();

  return chatRow;
}

socket.on("chat update", (data) => {
  displayChatMessage(data);
});

socket.on("offensive word detected", (data) => {
  // DEPRECATED

  console.warn(
    "For talkomatic developers: the 'offensive word detected' event is now deprecated in favor of directly sending the censored text in the 'chat update' event as a bugfix."
  );
  console.info(
    "This is kept for compatibility, but avoid calling this event if necessary."
  );

  const { userId, filteredMessage } = data;
  const chatDiv = document.querySelector(
    `.chat-row[data-user-id="${userId}"] .chat-input`
  );
  if (!chatDiv) return;

  if (userId === currentUserId) {
    // Save cursor position and focus state
    const isActive = document.activeElement === chatDiv;
    let cursorPosition = 0;

    if (isActive) {
      const selection = window.getSelection();
      if (selection.rangeCount > 0) {
        cursorPosition = getCursorPosition(chatDiv);
      }
    }

    // Update our own display
    chatDiv.innerHTML = "";
    chatDiv.textContent = filteredMessage.slice(0, MAX_MESSAGE_LENGTH);
    replaceEmotes(chatDiv);

    // Update last sent message
    lastSentMessage = filteredMessage;

    // Restore cursor and focus
    if (isActive) {
      try {
        setCursorPosition(
          chatDiv,
          Math.min(cursorPosition, filteredMessage.length)
        );
      } catch (e) {
        console.error("Error restoring cursor position:", e);
        placeCursorAtEnd(chatDiv);
      }
    }
  } else {
    // Update other user's display
    updateOtherUserMessage(
      chatDiv,
      filteredMessage.slice(0, MAX_MESSAGE_LENGTH)
    );
  }
});

// IMPROVED: Get cursor position in contenteditable with better emoticon handling
function getCursorPosition(element) {
  if (!element) return 0;

  try {
    const selection = window.getSelection();
    if (selection.rangeCount === 0) return 0;

    const range = selection.getRangeAt(0);
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(element);
    preCaretRange.setEnd(range.endContainer, range.endOffset);

    // Count also the length of image emoticons as their text representation length
    function countTextLength(node) {
      let length = 0;
      const walker = document.createTreeWalker(
        node,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
        null,
        false
      );

      while (walker.nextNode()) {
        if (walker.currentNode.nodeType === Node.TEXT_NODE) {
          length += walker.currentNode.textContent.length;
        } else if (
          walker.currentNode.nodeType === Node.ELEMENT_NODE &&
          walker.currentNode.nodeName === "IMG" &&
          walker.currentNode.dataset.emoteCode
        ) {
          // Count emoticon as ":code:" (length of code + 2 for colons)
          length += walker.currentNode.dataset.emoteCode.length + 2;
        }
      }
      return length;
    }

    return countTextLength(preCaretRange.cloneContents());
  } catch (error) {
    console.error("Error getting cursor position:", error);
    return 0;
  }
}

// IMPROVED: Set cursor position in contenteditable with better emoticon handling
function setCursorPosition(element, position) {
  if (!element) return false;

  try {
    // First, ensure the element has focus
    element.focus();

    // Get all text and element nodes
    const nodes = [];
    const walk = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      null,
      false
    );

    while (walk.nextNode()) {
      nodes.push(walk.currentNode);
    }

    if (nodes.length === 0) {
      // If no nodes, place at beginning
      const range = document.createRange();
      range.setStart(element, 0);
      range.collapse(true);

      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);

      return true;
    }

    // Find the right node and offset
    let currentPos = 0;
    for (const node of nodes) {
      let nodeLength = 0;

      if (node.nodeType === Node.TEXT_NODE) {
        nodeLength = node.length;

        if (currentPos + nodeLength >= position) {
          const range = document.createRange();
          range.setStart(node, position - currentPos);
          range.collapse(true);

          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);

          return true;
        }
      } else if (
        node.nodeType === Node.ELEMENT_NODE &&
        node.nodeName === "IMG" &&
        node.dataset.emoteCode
      ) {
        // The emoticon counts as ":code:" in position calculations
        nodeLength = node.dataset.emoteCode.length + 2;

        if (currentPos + nodeLength > position) {
          // If position is inside an emoticon, place cursor after it
          const range = document.createRange();
          range.setStartAfter(node);
          range.collapse(true);

          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);

          return true;
        }
      }

      currentPos += nodeLength;
    }

    // If we get here, position was beyond text length, so place at end
    placeCursorAtEnd(element);
    return true;
  } catch (error) {
    console.error("Error setting cursor position:", error);
    placeCursorAtEnd(element);
    return false;
  }
}

function updateRoomInfo(data) {
  const roomNameElement = document.querySelector(".room-name");
  const roomIdElement = document.querySelector(".room-id");

  if (roomNameElement) {
    roomNameElement.textContent = `Room: ${
      currentRoomName || data.roomName || data.roomId
    }`;
  }

  if (roomIdElement) {
    roomIdElement.textContent = `Room ID: ${data.roomId || currentRoomId}`;
  }

  // Recreate the emotes dropdown if needed
  if (!document.getElementById("emotesButton")) {
    createEmotesDropdown();
  }
}

function adjustVoteButtonVisibility() {
  const userCount = document.querySelectorAll(".chat-row").length;
  document.querySelectorAll(".chat-row").forEach((row) => {
    const userId = row.dataset.userId;
    const voteButton = row.querySelector(".vote-button");
    if (voteButton) {
      // Hide vote buttons for spectators or show them based on user count
      if (isSpectator || userCount < 3 || userId === currentUserId) {
        voteButton.style.display = "none";
      } else {
        voteButton.style.display = "inline-block";
      }
    }
  });
}

function adjustMuteButtonVisibility() {
  document.querySelectorAll(".chat-row").forEach((row) => {
    const userId = row.dataset.userId;
    const muteButton = row.querySelector(".mute-button");
    if (muteButton && userId !== currentUserId) {
      // Show mute buttons even for spectators (they can still mute to hide distracting content)
      muteButton.style.display = "inline-block";
      if (mutedUsers.has(userId)) {
        muteButton.innerHTML = "🔇";
        muteButton.classList.add("muted");
        const chatInput = row.querySelector(".chat-input");
        if (chatInput) chatInput.style.opacity = "0.3";
      }
    }
  });
}

function updateRoomUI(roomData) {
  const chatContainer = document.querySelector(".chat-container");
  if (!chatContainer) return;

  // Clear the container first
  while (chatContainer.firstChild) {
    chatContainer.removeChild(chatContainer.firstChild);
  }

  chatInput = null;

  if (roomData.users && Array.isArray(roomData.users)) {
    roomData.users.forEach((user) => {
      createUserRow(user, chatContainer);
    });
  }

  adjustLayout();

  // Focus the input right away
  if (chatInput) {
    setTimeout(() => {
      chatInput.focus();
      placeCursorAtEnd(chatInput);
    }, 0);
  }
}

function displayChatMessage(data) {
  if (mutedUsers.has(data.userId)) {
    if (!storedMessagesForMutedUsers.has(data.userId)) {
      storedMessagesForMutedUsers.set(data.userId, []);
    }
    storedMessagesForMutedUsers.get(data.userId).push(data);
    return;
  }

  const chatRow = document.querySelector(
    `.chat-row[data-user-id="${data.userId}"]`
  );
  if (!chatRow) return;

  const chatDiv = chatRow.querySelector(".chat-input");
  if (!chatDiv) return;

  // Get current plain text
  let currentText = getPlainText(chatDiv);
  let newText = "";

  if (data.diff) {
    if (data.diff.type === "full-replace") {
      newText = data.diff.text.slice(0, MAX_MESSAGE_LENGTH);
    } else {
      switch (data.diff.type) {
        case "add":
          newText =
            currentText.slice(0, data.diff.index) +
            data.diff.text +
            currentText.slice(data.diff.index);
          break;
        case "delete":
          newText =
            currentText.slice(0, data.diff.index) +
            currentText.slice(data.diff.index + data.diff.count);
          break;
        case "replace":
          newText =
            currentText.slice(0, data.diff.index) +
            data.diff.text +
            currentText.slice(data.diff.index + data.diff.text.length);
          break;
      }
    }
  } else if (data.message) {
    newText = data.message.slice(0, MAX_MESSAGE_LENGTH);
  } else {
    return;
  }

  // Trim to max length
  newText = newText.slice(0, MAX_MESSAGE_LENGTH);

  if (data.userId === currentUserId) {
    // Save cursor position and focus state
    const isActive = document.activeElement === chatDiv;
    let cursorPosition = 0;

    if (isActive) {
      const selection = window.getSelection();
      if (selection.rangeCount > 0) {
        cursorPosition = getCursorPosition(chatDiv);
      }
    }

    // Update our content
    chatDiv.innerHTML = "";
    chatDiv.textContent = newText;
    if (newText.includes(":")) {
      replaceEmotes(chatDiv);
    }

    // Restore cursor position
    if (isActive) {
      try {
        setCursorPosition(chatDiv, Math.min(cursorPosition, newText.length));
      } catch (e) {
        console.error("Error restoring cursor position:", e);
        // Fallback to end
        placeCursorAtEnd(chatDiv);
      }
    }

    // Update last sent message
    lastSentMessage = newText;
  } else {
    // For other users, just update their display
    updateOtherUserMessage(chatDiv, newText);
  }
}

function isMobile() {
  return window.innerWidth <= 768;
}

function adjustLayout() {
  const chatContainer = document.querySelector(".chat-container");
  const chatRows = document.querySelectorAll(".chat-row");

  // Save active element before layout changes
  const activeElement = document.activeElement;
  let activeUserId = null;

  if (activeElement && activeElement.classList.contains("chat-input")) {
    const chatRow = activeElement.closest(".chat-row");
    if (chatRow) {
      activeUserId = chatRow.dataset.userId;
    }
  }

  // Add CSS styles for emote handling
  const style = document.createElement("style");
  style.textContent = `
    .emote {
      display: inline-block;
      vertical-align: middle;
      width: auto;
      height: 20px;
      margin: 0 2px;
    }
    
    .chat-input {
      background-color: black;
      color: orange;
      outline: none;
      white-space: pre-wrap;
      word-break: break-word;
    }
    
    .emote-autocomplete {
      position: absolute;
      z-index: 1000;
      background-color: #333;
      border: 1px solid #555;
      border-radius: 4px;
      max-height: 300px;
      overflow-y: auto;
      width: 200px;
      box-shadow: 0 3px 10px rgba(0, 0, 0, 0.3);
    }
    
    .emote-autocomplete-header {
      padding: 5px 10px;
      font-weight: bold;
      border-bottom: 1px solid #555;
      color: #eee;
    }
    
    .emote-autocomplete-list {
      max-height: 250px;
      overflow-y: auto;
    }
    
    .emote-autocomplete-item {
      display: flex;
      align-items: center;
      padding: 8px 10px;
      cursor: pointer;
      border-bottom: 1px solid #444;
      color: #fff;
    }
    
    .emote-autocomplete-item.selected,
    .emote-autocomplete-item:hover {
      background-color: #555;
    }
    
    .emote-autocomplete-item img {
      width: auto;
      height: 20px;
      margin-right: 10px;
      vertical-align: middle;
    }
    
    .votes-counter {
      transition: color 0.3s ease;
    }
    
    .vote-button {
      cursor: pointer;
      transition: background-color 0.2s ease;
    }
    
    .vote-button.voted {
      background-color: #5c3d3d !important;
      color: #ff9090 !important;
    }
    
    .emotes-button {
      padding: 5px 10px;
      background-color: #444;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
    
    .emotes-dropdown {
      background-color: #333;
      border: 1px solid #555;
      border-radius: 4px;
      padding: 10px;
      z-index: 1000;
      max-width: 300px;
      max-height: 300px;
      overflow-y: auto;
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
    }
    
    .emote-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 5px;
      cursor: pointer;
      border-radius: 4px;
      background-color: #444;
      width: 60px;
      height: 60px;
      transition: background-color 0.2s ease;
    }
    
    .emote-item:hover {
      background-color: #555;
    }
    
    .emote-item img {
      width: 30px;
      height: auto;
    }
    
    .emote-item span {
      font-size: 10px;
      color: white;
      margin-top: 5px;
      text-align: center;
      word-break: break-all;
    }
  `;

  // Remove any previous style with this content
  const existingStyle = document.querySelector("style[data-emote-styles]");
  if (existingStyle) {
    existingStyle.remove();
  }

  style.setAttribute("data-emote-styles", "true");
  document.head.appendChild(style);

  const effectiveLayout = isMobile() ? "horizontal" : currentRoomLayout;

  if (effectiveLayout === "horizontal") {
    chatContainer.style.flexDirection = "column";
    const availableHeight = window.innerHeight - chatContainer.offsetTop;
    const rowGap = 10;
    const totalGap = (chatRows.length - 1) * rowGap;
    const chatRowHeight = Math.floor(
      (availableHeight - totalGap) / chatRows.length
    );

    chatRows.forEach((row) => {
      row.style.height = `${chatRowHeight}px`;
      row.style.minHeight = "100px";
      row.style.width = "100%";
      const userInfo = row.querySelector(".user-info");
      const inputWrapper = row.querySelector(".chat-input-wrapper");
      const inputHeight = chatRowHeight - userInfo.offsetHeight - 2;
      inputWrapper.style.height = `${inputHeight}px`;
    });
  } else {
    chatContainer.style.flexDirection = "row";
    const availableWidth = chatContainer.offsetWidth;
    const columnGap = 10;
    const totalGap = (chatRows.length - 1) * columnGap;
    const chatColumnWidth = Math.floor(
      (availableWidth - totalGap) / chatRows.length
    );

    chatRows.forEach((row) => {
      row.style.width = `${chatColumnWidth}px`;
      row.style.height = "100%";
      const userInfo = row.querySelector(".user-info");
      const inputWrapper = row.querySelector(".chat-input-wrapper");
      inputWrapper.style.height = `calc(100% - ${userInfo.offsetHeight}px - 2px)`;
    });
  }

  // Restore focus if needed
  if (activeUserId) {
    const activeInput = document.querySelector(
      `.chat-row[data-user-id="${activeUserId}"] .chat-input`
    );
    if (activeInput) {
      setTimeout(() => {
        activeInput.focus();
      }, 0);
    }
  }
}

function handleViewportChange() {
  const viewport = document.querySelector("meta[name=viewport]");
  if (window.visualViewport) {
    if (window.visualViewport.height < window.innerHeight) {
      viewport.setAttribute(
        "content",
        "width=device-width, initial-scale=1, maximum-scale=1"
      );
      document.body.style.height = `${window.visualViewport.height}px`;
    } else {
      viewport.setAttribute("content", "width=device-width, initial-scale=1");
      document.body.style.height = "100%";
    }
  }
  adjustLayout();
}

function getDiff(oldStr, newStr) {
  if (oldStr === newStr) return null;
  if (newStr.startsWith(oldStr)) {
    return {
      type: "add",
      text: newStr.slice(oldStr.length),
      index: oldStr.length,
    };
  }
  if (oldStr.startsWith(newStr)) {
    return {
      type: "delete",
      count: oldStr.length - newStr.length,
      index: newStr.length,
    };
  }
  return { type: "full-replace", text: newStr };
}

window.addEventListener("load", () => {
  initRoom();
  updateDateTime();
  adjustLayout();
  updateInviteLink();

  // Initialize App Directory
  initializeAppDirectory();

  document
    .getElementById("copyInviteLink")
    .addEventListener("click", copyInviteLink);
  const savedMuteState = localStorage.getItem("soundEnabled");
  if (savedMuteState !== null) {
    soundEnabled = JSON.parse(savedMuteState);
    updateMuteIcon();
  }
  muteToggleButton.addEventListener("click", toggleMute);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", handleViewportChange);
  }
  // Create autocomplete element if it doesn't exist yet
  if (!document.getElementById("emoteAutocomplete")) {
    const emoteAutocompleteEl = document.createElement("div");
    emoteAutocompleteEl.id = "emoteAutocomplete";
    emoteAutocompleteEl.className = "emote-autocomplete";
    emoteAutocompleteEl.style.display = "none";
    document.body.appendChild(emoteAutocompleteEl);
    emoteAutocomplete = emoteAutocompleteEl;
  }
});

document.querySelector(".leave-room").addEventListener("click", () => {
  socket.emit("leave room");
  window.location.href = "/index.html";
});

const dateTimeElement = document.querySelector("#dateTime");
function updateDateTime() {
  const now = new Date();
  const dateOptions = {
    weekday: "long",
    year: "numeric",
    month: "short",
    day: "numeric",
  };
  const timeOptions = {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  };

  const formattedDate = now.toLocaleDateString("en-US", dateOptions);
  const formattedTime = now.toLocaleTimeString("en-US", timeOptions);

  dateTimeElement.querySelector(".date").textContent = formattedDate;
  dateTimeElement.querySelector(".time").textContent = formattedTime;
}
setInterval(updateDateTime, 1000);

window.addEventListener("resize", adjustLayout);
window.addEventListener("resize", handleViewportChange);

function generateInviteLink() {
  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.set("roomId", currentRoomId);

  // Important: Remove the access code from invite links!
  currentUrl.searchParams.delete("accessCode");

  return currentUrl.href;
}

function updateInviteLink() {
  const inviteLinkElement = document.getElementById("inviteLink");
  const inviteLink = generateInviteLink();
  inviteLinkElement.textContent = inviteLink;
  inviteLinkElement.href = inviteLink;
  const copyButton = document.getElementById("copyInviteLink");
  copyButton.style.display = "inline-block";
}

function copyInviteLink() {
  const inviteLink = generateInviteLink();
  navigator.clipboard
    .writeText(inviteLink)
    .then(() => {
      showInfoModal("Invite link copied to clipboard!");
    })
    .catch((err) => {
      console.error("Failed to copy invite link: ", err);
      showErrorModal("Failed to copy invite link to clipboard.");
    });
}
