// ============================================================================
// lobby-client.js - Enhanced with server statistics, anti-spam lobby sorting,
// and integrated lobby visibility fixes
// ============================================================================

// Modal functionality wrapped in an IIFE to avoid conflicts
(function () {
  // Only initialize once to avoid duplicate event listeners
  if (window.modalFunctionsInitialized) {
    console.log("Custom modal already initialized");
    return;
  }
  window.modalFunctionsInitialized = true;

  // Get modal elements
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

  // Define the modal functions - make private to this scope
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
      modalInput.setAttribute("maxLength", options.maxLength || "6");
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

  function hideCustomModal() {
    customModal.classList.remove("show");
    document.body.style.overflow = "";
    currentModalCallback = null;
  }

  // Expose public methods to window
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

  window.showErrorModal = function (message, title) {
    showModal(ERROR_CODES[title] ?? "Error", message, {
      showCancel: false,
      confirmText: "OK",
    });
  };

  window.showInfoModal = function (message) {
    showModal("Information", message, {
      showCancel: false,
      confirmText: "OK",
    });
  };

  window.showConfirmModal = function (message, callback) {
    showModal("Confirmation", message, {
      confirmText: "Yes",
      cancelText: "No",
      callback: callback,
    });
  };

  window.showInputModal = function (title, message, options, callback) {
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
  };

  // Event listeners for modal
  modalConfirmBtn.addEventListener("click", () => {
    if (currentModalCallback) {
      const shouldClose = currentModalCallback(true, modalInput.value);
      if (shouldClose !== false) {
        hideCustomModal();
      }
    } else {
      hideCustomModal();
    }
  });

  modalCancelBtn.addEventListener("click", () => {
    if (currentModalCallback) {
      currentModalCallback(false);
    }
    hideCustomModal();
  });

  closeModalBtn.addEventListener("click", hideCustomModal);

  // Close modal when clicking outside the content
  customModal.addEventListener("click", (e) => {
    if (e.target === customModal) {
      hideCustomModal();
    }
  });

  // Validate input for numbers only
  modalInput.addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/[^0-9]/g, "");
  });

  // Close modal with Escape key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && customModal.classList.contains("show")) {
      hideCustomModal();
    }
  });

  // Enter key in input field triggers confirm button
  modalInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      modalConfirmBtn.click();
    }
  });
})();

// ============================================================================
// Stats for Nerds Modal Management
// ============================================================================
class StatsModal {
  constructor() {
    this.modal = document.getElementById("statsModal");
    this.closeButton = document.getElementById("statsModalClose");
    this.refreshButton = document.getElementById("modalRefreshButton");
    this.isOpen = false;
    this.lastUpdateTime = null;

    // Modal content sections
    this.loadingSection = document.getElementById("statsLoadingSection");
    this.errorSection = document.getElementById("statsErrorSection");
    this.contentSection = document.getElementById("statsContentSection");

    // Stats display elements
    this.elements = {
      rooms: document.getElementById("modalStatsRooms"),
      users: document.getElementById("modalStatsUsers"),
      version: document.getElementById("modalStatsVersion"),
      uptime: document.getElementById("modalStatsUptime"),
      utilizationPercentage: document.getElementById(
        "modalUtilizationPercentage",
      ),
      utilizationFill: document.getElementById("modalUtilizationFill"),
      public: document.getElementById("modalStatsPublic"),
      semiPrivate: document.getElementById("modalStatsSemiPrivate"),
      private: document.getElementById("modalStatsPrivate"),
      lastUpdated: document.getElementById("modalLastUpdated"),
      refreshIndicator: document.getElementById("modalRefreshIndicator"),
    };

    this.init();
  }

  init() {
    this.closeButton.addEventListener("click", () => this.close());
    this.refreshButton.addEventListener("click", () => this.fetchStats());

    this.modal.addEventListener("click", (e) => {
      if (e.target === this.modal) {
        this.close();
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isOpen) {
        this.close();
      }
    });
  }

  async open() {
    this.isOpen = true;
    this.modal.classList.add("show");
    document.body.style.overflow = "hidden";

    this.showLoading();
    await this.fetchStats();
  }

  close() {
    this.isOpen = false;
    this.modal.classList.remove("show");
    document.body.style.overflow = "";
  }

  showLoading() {
    this.loadingSection.style.display = "block";
    this.errorSection.style.display = "none";
    this.contentSection.style.display = "none";
  }

  showError() {
    this.loadingSection.style.display = "none";
    this.errorSection.style.display = "block";
    this.contentSection.style.display = "none";
  }

  showContent() {
    this.loadingSection.style.display = "none";
    this.errorSection.style.display = "none";
    this.contentSection.style.display = "block";
  }

  async fetchStats() {
    try {
      if (this.isOpen) {
        this.showLoading();
      }

      const [healthResponse, configResponse] = await Promise.all([
        fetch("/api/v1/health", {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        }),
        fetch("/api/v1/config", {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        }).catch(() => null),
      ]);

      if (!healthResponse.ok) {
        throw new Error(
          `HTTP ${healthResponse.status}: ${healthResponse.statusText}`,
        );
      }

      const healthData = await healthResponse.json();
      const configData =
        configResponse && configResponse.ok ? await configResponse.json() : null;

      this.updateStatsDisplay(healthData, configData);
      this.setConnectionStatus(true);

      if (this.isOpen) {
        this.showContent();
      }
    } catch (error) {
      console.error("Error fetching server stats:", error);
      this.setConnectionStatus(false);

      if (this.isOpen) {
        this.showError();
      }
    }
  }

  updateStatsDisplay(healthData, configData) {
    const stats = healthData.roomStatistics || {};

    this.elements.rooms.textContent = `${stats.totalRooms || 0}/${stats.currentLimit || 15
      }`;
    this.elements.users.textContent = stats.totalUsers || 0;
    this.elements.version.textContent = healthData.version || "Unknown";

    const uptime = healthData.uptime || 0;
    this.elements.uptime.textContent = this.formatUptime(uptime);

    const utilization = stats.utilizationPercentage || 0;
    this.elements.utilizationPercentage.textContent = `${utilization}%`;
    this.elements.utilizationFill.style.width = `${Math.min(utilization, 100)}%`;

    if (stats.roomTypes) {
      this.elements.public.textContent = stats.roomTypes.public || 0;
      this.elements.semiPrivate.textContent = stats.roomTypes["semi-private"] || 0;
      this.elements.private.textContent = stats.roomTypes.private || 0;
    }

    this.lastUpdateTime = new Date();
    this.elements.lastUpdated.textContent = `Last updated ${this.formatTime(
      this.lastUpdateTime,
    )}`;
  }

  setConnectionStatus(connected) {
    if (connected) {
      this.elements.refreshIndicator.classList.remove("offline");
    } else {
      this.elements.refreshIndicator.classList.add("offline");
    }
  }

  formatTime(date) {
    return date.toLocaleTimeString("en-US", {
      hour12: true,
      hour: "numeric",
      minute: "2-digit",
    });
  }

  formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  }
}

// ============================================================================
// Connection and Socket Management
// ============================================================================

const connectionStatus = document.createElement("div");
connectionStatus.id = "connectionStatus";
connectionStatus.style.position = "fixed";
connectionStatus.style.bottom = "10px";
connectionStatus.style.right = "10px";
connectionStatus.style.padding = "5px 10px";
connectionStatus.style.borderRadius = "5px";
connectionStatus.style.fontSize = "12px";
connectionStatus.style.fontWeight = "bold";
connectionStatus.style.zIndex = "1000";
document.body.appendChild(connectionStatus);

function updateConnectionStatus() {
  if (socket.connected) {
    connectionStatus.textContent = "Connected";
    connectionStatus.style.backgroundColor = "#070707";
    connectionStatus.style.color = "white";
  } else {
    connectionStatus.textContent = "Disconnected";
    connectionStatus.style.backgroundColor = "#F44336";
    connectionStatus.style.color = "white";
  }
}

// Socket.io initialization with robust connection settings
const socket = io({
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  timeout: 20000,
  autoConnect: true,
  withCredentials: true,
  auth: {
    devKey: localStorage.getItem("talkomatic_devKey") || undefined,
  },
});

// DOM elements
const logForm = document.getElementById("logform");
const createRoomForm = document.getElementById("lobbyForm");
const roomListContainer = document.querySelector(".roomList");
const dynamicRoomList = document.getElementById("dynamicRoomList");
const usernameInput = logForm.querySelector('input[placeholder="Your Name"]');
const locationInput = logForm.querySelector(
  'input[placeholder="Location (optional)"]',
);
const roomNameInput = createRoomForm.querySelector(
  'input[placeholder="Room Name"]',
);
const goChatButton = createRoomForm.querySelector(".go-chat-button");
const signInButton = logForm.querySelector('button[type="submit"]');
const signInMessage = document.getElementById("signInMessage");
const noRoomsMessage = document.getElementById("noRoomsMessage");
const accessCodeInput = document.getElementById("accessCodeInput");
const roomTypeRadios = document.querySelectorAll('input[name="roomType"]');

// Variables
let currentUsername = "";
let currentLocation = "";
let currentUserId = null;
let isSignedIn = false;
let lastUsedAccessCode = null;
let connectionRetryCount = 0;
const MAX_RETRIES = 3;
const MAX_USERNAME_LENGTH = 15;
const MAX_LOCATION_LENGTH = 20;
const MAX_ROOM_NAME_LENGTH = 25;
let devLobbyCodes = {};
let statsModal = null;

function checkSignInStatus() {
  if (socket.connected) {
    socket.emit("check signin status");
  } else {
    socket.once("connect", () => {
      socket.emit("check signin status");
    });
  }
}

function setSignedInButtonState() {
  while (signInButton.firstChild) {
    signInButton.removeChild(signInButton.firstChild);
  }
  signInButton.appendChild(document.createTextNode("Change "));

  const img = document.createElement("img");
  img.src = "images/icons/pencil.png";
  img.alt = "Arrow";
  img.classList.add("arrow-icon");
  signInButton.appendChild(img);
}

function setSignInState(username, location, shouldPersist = true) {
  currentUsername = username;
  currentLocation = location;
  isSignedIn = true;

  usernameInput.value = currentUsername;
  locationInput.value = currentLocation;
  setSignedInButtonState();
  createRoomForm.classList.remove("hidden");

  if (shouldPersist) {
    localStorage.setItem("talkomaticUsername", currentUsername);
    localStorage.setItem("talkomaticLocation", currentLocation);
  }
}

function emitJoinLobby(username, location) {
  const payload = {
    username,
    location,
  };

  if (socket.connected) {
    socket.emit("join lobby", payload);
  } else {
    socket.once("connect", () => {
      socket.emit("join lobby", payload);
    });
  }
}

socket.on("connect", () => {
  console.log("Socket connected successfully");
  connectionRetryCount = 0;
  updateConnectionStatus();
});

socket.on("disconnect", (reason) => {
  console.log(`Socket disconnected: ${reason}`);
  updateConnectionStatus();

  if (reason === "io server disconnect") {
    socket.connect();
  }
});

socket.on("connect_error", (error) => {
  console.error("Connection error:", error);
  updateConnectionStatus();

  if (connectionRetryCount < MAX_RETRIES) {
    connectionRetryCount++;
    console.log(`Retrying connection (${connectionRetryCount}/${MAX_RETRIES})...`);

    if (socket.disconnected) {
      setTimeout(() => {
        console.log("Attempting reconnection with clean session...");
        socket.io.opts.query = { clean: "true" };
        socket.connect();
      }, 1000 * connectionRetryCount);
    }
  } else {
    window.showErrorModal(
      "Unable to connect to the server. Please refresh the page and try again.",
      "SERVER_ERROR",
    );
  }
});

socket.on("reconnect", (attemptNumber) => {
  console.log(`Reconnected after ${attemptNumber} attempts`);
  updateConnectionStatus();
  checkSignInStatus();
});

socket.on("dev lobby context", (codes) => {
  devLobbyCodes = codes || {};
});

// Show/hide access code field
roomTypeRadios.forEach((radio) => {
  radio.addEventListener("change", (e) => {
    if (e.target.value === "semi-private") {
      accessCodeInput.style.display = "block";
    } else {
      accessCodeInput.style.display = "none";
    }
  });
});

logForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const newUsername = usernameInput.value.trim().slice(0, MAX_USERNAME_LENGTH);
  const newLocation =
    locationInput.value.trim().slice(0, MAX_LOCATION_LENGTH) || "On The Web";

  if (newUsername) {
    localStorage.setItem("talkomaticUsername", newUsername);
    localStorage.setItem("talkomaticLocation", newLocation);

    if (currentUsername) {
      signInButton.textContent = "Changed";
      setTimeout(() => {
        setSignedInButtonState();
      }, 2000);
    } else {
      setSignedInButtonState();
      createRoomForm.classList.remove("hidden");
    }

    currentUsername = newUsername;
    currentLocation = newLocation;
    isSignedIn = true;

    if (socket.connected) {
      socket.emit("join lobby", {
        username: currentUsername,
        location: currentLocation,
      });
    } else {
      socket.once("connect", () => {
        socket.emit("join lobby", {
          username: currentUsername,
          location: currentLocation,
        });
      });
    }

    showRoomList();
  } else {
    window.showErrorModal("Please enter a username.");
  }
});

goChatButton.addEventListener("click", () => {
  if (!socket.connected) {
    window.showErrorModal(
      "Not connected to server. Please wait for connection or refresh the page.",
      "SERVER_ERROR",
    );
    return;
  }

  const roomName = roomNameInput.value.trim().slice(0, MAX_ROOM_NAME_LENGTH);
  const roomType = document.querySelector(
    'input[name="roomType"]:checked',
  )?.value;
  const roomLayout = document.querySelector(
    'input[name="roomLayout"]:checked',
  )?.value;
  const accessCode = accessCodeInput.querySelector("input").value;

  if (roomName && roomType && roomLayout) {
    if (roomType === "semi-private") {
      if (!accessCode || accessCode.length !== 6 || !/^\d+$/.test(accessCode)) {
        window.showErrorModal(
          "Please enter a valid 6-digit access code for the semi-private room.",
        );
        return;
      }

      lastUsedAccessCode = accessCode;
    }

    socket.emit("create room", {
      name: roomName,
      type: roomType,
      layout: roomLayout,
      accessCode,
    });
  } else {
    window.showErrorModal("Please fill in all room details.");
  }
});

dynamicRoomList.addEventListener("click", (e) => {
  if (e.target.classList.contains("enter-button") && !e.target.disabled) {
    if (!socket.connected) {
      window.showErrorModal(
        "Not connected to server. Please wait for connection or refresh the page.",
        "SERVER_ERROR",
      );
      return;
    }

    const roomElement = e.target.closest(".room");
    const roomId = roomElement.dataset.roomId;
    const roomType = roomElement.dataset.roomType;

    if (roomType === "semi-private") {
      promptAccessCode(roomId);
    } else {
      joinRoom(roomId);
    }
  }
});

function promptAccessCode(roomId) {
  window.showInputModal(
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
        lastUsedAccessCode = accessCode;
        joinRoom(roomId, accessCode);
      }
    },
  );
}

function joinRoom(roomId, accessCode = null) {
  if (!socket.connected) {
    window.showErrorModal(
      "Not connected to server. Please wait for connection or refresh the page.",
      "SERVER_ERROR",
    );
    return;
  }

  socket.emit("join room", { roomId, accessCode });
}

socket.on("access code required", () => {
  const roomId = new URLSearchParams(window.location.search).get("roomId");
  promptAccessCode(roomId);
});

socket.on("room joined", (data) => {
  if (lastUsedAccessCode) {
    window.location.href = `/room.html?roomId=${data.roomId}&accessCode=${lastUsedAccessCode}`;
    lastUsedAccessCode = null;
  } else {
    window.location.href = `/room.html?roomId=${data.roomId}`;
  }
});

socket.on("signin status", (data) => {
  if (data.isSignedIn) {
    currentUsername = data.username;
    currentLocation = data.location;
    currentUserId = data.userId;
    isSignedIn = true;

    usernameInput.value = currentUsername;
    locationInput.value = currentLocation;

    localStorage.setItem("talkomaticUsername", currentUsername);
    localStorage.setItem("talkomaticLocation", currentLocation);

    setSignedInButtonState();
    createRoomForm.classList.remove("hidden");

    showRoomList();
  } else {
    signInMessage.style.display = "block";
    roomListContainer.style.display = "none";
  }
});

function signOut() {
  localStorage.removeItem("talkomaticUsername");
  localStorage.removeItem("talkomaticLocation");

  currentUsername = "";
  currentLocation = "";
  currentUserId = null;
  isSignedIn = false;
  usernameInput.value = "";
  locationInput.value = "";

  signInButton.textContent = "Sign In";
  while (signInButton.firstChild) {
    signInButton.removeChild(signInButton.firstChild);
  }

  createRoomForm.classList.add("hidden");
  signInMessage.style.display = "block";
  roomListContainer.style.display = "none";

  if (socket.connected) {
    socket.emit("leave lobby");
  }
}

socket.on("lobby update", (rooms) => {
  updateLobby(rooms);
});

socket.on("room created", (roomId) => {
  if (lastUsedAccessCode) {
    window.location.href = `/room.html?roomId=${roomId}&accessCode=${lastUsedAccessCode}`;
    lastUsedAccessCode = null;
  } else {
    window.location.href = `/room.html?roomId=${roomId}`;
  }
});

socket.on("error", (error) => {
  console.log(error);
  window.showErrorModal(
    (error.error.replaceDefaultText ? "" : `An error occurred: `) +
    error.error.message,
    error.error.code,
  );
});

function getJoinableCount(room) {
  if (!room) return 0;
  if (typeof room.userCount === "number") return room.userCount;
  if (!Array.isArray(room.users)) return 0;
  return room.users.filter((user) => !user?.isDev).length;
}

function createRoomElement(room) {
  const roomElement = document.createElement("div");
  roomElement.classList.add("room");
  roomElement.dataset.roomId = room.id;
  roomElement.dataset.roomType = room.type;

  const joinableCount = getJoinableCount(room);
  const isFull = !!room.isFull || joinableCount >= 5;

  const enterButton = document.createElement("button");
  enterButton.classList.add("enter-button");
  if (isFull) {
    enterButton.textContent = "Full";
    enterButton.disabled = true;
    roomElement.classList.add("full");
  } else {
    enterButton.textContent = "Enter";
  }

  const roomTop = document.createElement("div");
  roomTop.classList.add("room-top");

  const roomInfo = document.createElement("div");
  roomInfo.classList.add("room-info");

  const roomNameDiv = document.createElement("div");
  roomNameDiv.classList.add("room-name");
  roomNameDiv.textContent = `${room.name} (${joinableCount}/5 People)`;

  const roomDetailsDiv = document.createElement("div");
  roomDetailsDiv.classList.add("room-details");
  roomDetailsDiv.textContent = `${getRoomTypeDisplay(room.type)} Room`;

  const usersDetailDiv = document.createElement("div");
  usersDetailDiv.classList.add("users-detail");

  (room.users || []).forEach((user, index) => {
    const userDiv = document.createElement("div");

    const userNumberSpan = document.createElement("span");
    userNumberSpan.classList.add("user-number");
    userNumberSpan.textContent = `${index + 1}.`;

    const userNameSpan = document.createElement("span");
    userNameSpan.classList.add("user-name");
    userNameSpan.textContent = user.username;

    userDiv.appendChild(userNumberSpan);

    if (user.isDev && !user.isHidden) {
      const crown = document.createElement("img");
      crown.src = "images/icons/crown.gif";
      crown.alt = "";
      crown.className = "dev-lobby-badge";
      userDiv.appendChild(crown);
    }

    userDiv.appendChild(userNameSpan);
    userDiv.append(` / ${user.location}`);

    usersDetailDiv.appendChild(userDiv);
  });

  roomInfo.appendChild(roomNameDiv);
  roomInfo.appendChild(roomDetailsDiv);

  if (devLobbyCodes[room.id]) {
    const codeDiv = document.createElement("div");
    codeDiv.className = "dev-access-code";
    codeDiv.textContent = "\uD83D\uDD11 " + devLobbyCodes[room.id];
    roomInfo.appendChild(codeDiv);
  }

  roomInfo.appendChild(usersDetailDiv);

  roomTop.appendChild(roomInfo);
  roomElement.appendChild(enterButton);
  roomElement.appendChild(roomTop);

  return roomElement;
}

function getRoomTypeDisplay(type) {
  switch (type) {
    case "public":
      return "Public";
    case "semi-private":
      return "Semi-Private";
    case "private":
      return "Private";
    default:
      return type;
  }
}

// ============================================================================
// Anti-Spam: Activity-based room sorting
// ============================================================================
function sortRoomsByActivity(rooms) {
  return rooms.slice().sort((a, b) => {
    const aCount = getJoinableCount(a);
    const bCount = getJoinableCount(b);

    if (aCount !== bCount) {
      return bCount - aCount;
    }

    const aActivity = a.lastChatActivity || 0;
    const bActivity = b.lastChatActivity || 0;
    if (aActivity !== bActivity) {
      return bActivity - aActivity;
    }

    const aCreated = a.createdAt || 0;
    const bCreated = b.createdAt || 0;
    return bCreated - aCreated;
  });
}

function updateLobby(rooms) {
  dynamicRoomList.innerHTML = "";
  const publicRooms = rooms.filter((room) => room.type !== "private");

  if (publicRooms.length === 0) {
    noRoomsMessage.style.display = "block";
    dynamicRoomList.style.display = "none";
  } else {
    noRoomsMessage.style.display = "none";
    dynamicRoomList.style.display = "block";

    const sortedRooms = sortRoomsByActivity(publicRooms);
    sortedRooms.forEach((room) => {
      const roomElement = createRoomElement(room);
      dynamicRoomList.appendChild(roomElement);
    });
  }
}

function showRoomList() {
  signInMessage.style.display = "none";
  roomListContainer.style.display = "block";

  if (socket.connected) {
    socket.emit("get rooms");
  } else {
    socket.once("connect", () => {
      socket.emit("get rooms");
    });
  }
}

function initLobby() {
  document.querySelector('input[name="roomType"][value="public"]').checked =
    true;
  document.querySelector(
    'input[name="roomLayout"][value="horizontal"]',
  ).checked = true;

  statsModal = new StatsModal();

  document
    .getElementById("statsForNerdsButton")
    .addEventListener("click", (e) => {
      e.preventDefault();
      if (statsModal) {
        statsModal.open();
      }
    });

  setTimeout(() => {
    const savedUsername = localStorage.getItem("talkomaticUsername");
    const savedLocation = localStorage.getItem("talkomaticLocation");

    if (savedUsername) {
      currentUsername = savedUsername;
      currentLocation = savedLocation || "On The Web";
      isSignedIn = true;

      usernameInput.value = currentUsername;
      locationInput.value = currentLocation;

      setSignedInButtonState();
      createRoomForm.classList.remove("hidden");

      emitJoinLobby(savedUsername, savedLocation || "On The Web");
      showRoomList();
    } else {
      const guestDigits = Math.floor(10000 + Math.random() * 90000);
      const guestUsername = `Guest${guestDigits}`;
      const guestLocation = "Earth";

      usernameInput.value = guestUsername;
      locationInput.value = guestLocation;

      localStorage.setItem("talkomaticUsername", guestUsername);
      localStorage.setItem("talkomaticLocation", guestLocation);

      currentUsername = guestUsername;
      currentLocation = guestLocation;
      isSignedIn = true;

      setSignedInButtonState();
      createRoomForm.classList.remove("hidden");

      emitJoinLobby(guestUsername, guestLocation);
      showRoomList();
    }
  }, 500);

  updateConnectionStatus();
}

window.addEventListener("load", () => {
  initLobby();
});

socket.on("initial rooms", (rooms) => {
  updateLobby(rooms);
});

window.addEventListener("beforeunload", () => {
  if (statsModal) {
    statsModal.close();
  }
});