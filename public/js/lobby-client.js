// ============================================================================
// lobby-client.js
// ============================================================================

// Modal functionality wrapped in an IIFE to avoid conflicts
(function() {
  if (window.modalFunctionsInitialized) {
    console.log("Custom modal already initialized");
    return;
  }
  window.modalFunctionsInitialized = true;
  
  // Get modal elements
  const customModal = document.getElementById('customModal');
  const modalTitle = document.getElementById('modalTitle');
  const modalMessage = document.getElementById('modalMessage');
  const modalInput = document.getElementById('modalInput');
  const modalInputContainer = document.getElementById('modalInputContainer');
  const modalInputError = document.getElementById('modalInputError');
  const modalCancelBtn = document.getElementById('modalCancelBtn');
  const modalConfirmBtn = document.getElementById('modalConfirmBtn');
  const closeModalBtn = document.querySelector('.close-modal-btn');
  
  let currentModalCallback = null;
  
  function showModal(title, message, options = {}) {
    modalTitle.textContent = title;
    modalMessage.innerHTML = message;
    
    // Reset modal input state
    modalInputContainer.style.display = 'none';
    modalInput.value = '';
    modalInputError.style.display = 'none';
    modalInputError.textContent = '';
    
    // Show input if needed
    if (options.showInput) {
      modalInputContainer.style.display = 'block';
      modalInput.placeholder = options.inputPlaceholder || '';
      modalInput.setAttribute('maxLength', options.maxLength || '6');
      modalInput.focus();
    }
    
    // Buttons
    modalCancelBtn.textContent = options.cancelText || 'Cancel';
    modalConfirmBtn.textContent = options.confirmText || 'Confirm';
    modalCancelBtn.style.display = options.showCancel !== false ? 'block' : 'none';
    
    currentModalCallback = options.callback || null;
    
    // Show the modal
    customModal.classList.add('show');
    document.body.style.overflow = 'hidden'; // Prevent background scrolling
  }
  
  function hideCustomModal() {
    customModal.classList.remove('show');
    document.body.style.overflow = '';
    currentModalCallback = null;
  }
  
  // Expose some public modal functions
  window.showErrorModal = function(message) {
    showModal('Error', message, { showCancel: false, confirmText: 'OK' });
  };
  
  window.showInfoModal = function(message) {
    showModal('Information', message, { showCancel: false, confirmText: 'OK' });
  };
  
  window.showConfirmModal = function(message, callback) {
    showModal('Confirmation', message, {
      confirmText: 'Yes',
      cancelText: 'No',
      callback: callback
    });
  };
  
  window.showInputModal = function(title, message, options, callback) {
    showModal(title, message, {
      showInput: true,
      inputPlaceholder: options.placeholder || '',
      maxLength: options.maxLength || '6',
      confirmText: options.confirmText || 'Submit',
      callback: (confirmed, inputValue) => {
        if (confirmed && options.validate) {
          const validationResult = options.validate(inputValue);
          if (validationResult !== true) {
            modalInputError.textContent = validationResult;
            modalInputError.style.display = 'block';
            return false; // prevent modal from closing
          }
        }
        callback(confirmed, inputValue);
        return true;
      }
    });
  };
  
  // Modal event listeners
  modalConfirmBtn.addEventListener('click', () => {
    if (currentModalCallback) {
      const shouldClose = currentModalCallback(true, modalInput.value);
      if (shouldClose !== false) {
        hideCustomModal();
      }
    } else {
      hideCustomModal();
    }
  });
  
  modalCancelBtn.addEventListener('click', () => {
    if (currentModalCallback) {
      currentModalCallback(false);
    }
    hideCustomModal();
  });
  
  closeModalBtn.addEventListener('click', hideCustomModal);
  
  // Close modal if click outside content
  customModal.addEventListener('click', (e) => {
    if (e.target === customModal) {
      hideCustomModal();
    }
  });
  
  // Numbers only in the modal input
  modalInput.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/[^0-9]/g, '');
  });
  
  // Escape key to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && customModal.classList.contains('show')) {
      hideCustomModal();
    }
  });
  
  // Enter key in input triggers confirm
  modalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      modalConfirmBtn.click();
    }
  });
})();

// ========================
// Socket.io initialization
// ========================
const socket = io();

// DOM elements
const logForm = document.getElementById('logform');
const createRoomForm = document.getElementById('lobbyForm');
const roomListContainer = document.querySelector('.roomList');
const dynamicRoomList = document.getElementById('dynamicRoomList');

const usernameInput = logForm.querySelector('input[placeholder="Your Name"]');
const locationInput = logForm.querySelector('input[placeholder="Location (optional)"]');
const roomNameInput = createRoomForm.querySelector('input[placeholder="Room Name"]');
const goChatButton = createRoomForm.querySelector('.go-chat-button');
const signInButton = logForm.querySelector('button[type="submit"]');
const signInMessage = document.getElementById('signInMessage');
const noRoomsMessage = document.getElementById('noRoomsMessage');
const accessCodeInput = document.getElementById('accessCodeInput');
const roomTypeRadios = document.querySelectorAll('input[name="roomType"]');

let currentUsername = '';
let currentLocation = '';
let isSignedIn = false;
let lastUsedAccessCode = null;

const MAX_USERNAME_LENGTH = 12;
const MAX_LOCATION_LENGTH = 12;
const MAX_ROOM_NAME_LENGTH = 20;

/**
 * 1) Mapping from our funny username/location to the "comment" text
 *    so we can display it in the modal.
 */
const funnyNameComments = {
  "RizzReject": "charm? never met her",
  "NPCNoob": "thinks 2+2 is vibes",
  "LKing": "crown of losses",
  "CringeCzar": "rules the awkward",
  "AuraAllergy": "vibes make you sneeze",
  "FlopFame": "10 likes, 9 are bots",
  "RatioRoach": "crawls in own Ls",
  "BaitBaby": "fell for clickbait",
  "CapCorn": "lies pop like kernels",
  "MogMeat": "ground up by alphas",
  "TrendTramp": "chases dead fads",
  "FypFossil": "scrolls ancient TikToks",
  "SimpSack": "carries e-girl bags",
  "GlowGoner": "shine left in 2023",
  "StanStink": "fanboy breath reeks",
  "BetaBlob": "spineless and soggy",
  "DripDummy": "wears Shein drip",
  "VibeVirus": "infects with lame",
  "TokTwerp": "dances for 3 views",
  "YeetYam": "throws self into Ls",
  "CloutCarcass": "fame rotted away",
  "RageRunt": "mad but 5’2”",
  "NoWinners": "trophy case empty",
  "FlexFraud": "gym pic, no gains",
  "ZoomZombie": "brain dead on calls",
  "SkibidiSkimp": "brainrot on a budget",
  "LadLeak": "drips with failure",
  "MemeMaggot": "lives in dead posts",
  "ChatChump": "muted in Discord",
  "RizzRubble": "charm’s a ruin"
};

const funnyLocationComments = {
  "RizzRubble": "where charm crumbles",
  "NPCCubicle": "desk for drones",
  "LThrone": "sit on your losses",
  "CringeCastl": "awkward kingdom",
  "AuraAttic": "vibes collect dust",
  "FlopFoyer": "fame’s front door",
  "RatioRanch": "owned by numbers",
  "BaitBench": "sit and get tricked",
  "CapCage": "locked in lies",
  "MogMud": "sunk by better bois",
  "TrendTrash": "yesterday’s dump",
  "FypFridge": "cold scroll storage",
  "SimpStool": "kneel for e-queens",
  "GlowGrave": "bury your shine",
  "StanStall": "fanboy restroom",
  "BetaBunk": "weakling dorm",
  "DripDitch": "style’s drainage",
  "VibeVault": "locked lame vibes",
  "TokToilet": "flush your dances",
  "YeetYoke": "chained to chaos",
  "CloutCliff": "fall off fame",
  "RageRoof": "scream at clouds",
  "WinWreck": "victory crashed",
  "FlexFlop": "muscle mirage",
  "ZoomZoo": "cage of blank stares",
  "SkibidiShed": "brainrot shack",
  "LadLagoon": "swim in Ls",
  "MemeMush": "rotten post pile",
  "ChatChoke": "silenced server",
  "RubbleRink": "skate on ruins"
};

/** 
 * Helper: shows the "funny forced rename" modal if the name is in the funny list.
 * Called after we get user data from the server (signin or join).
 */
function maybeShowFunnyModal(funnyName, funnyLocation) {
  // If not in dictionary, do nothing
  const nameComment = funnyNameComments[funnyName] || "";
  const locComment = funnyLocationComments[funnyLocation] || "";

  // If *both* are unknown, probably not an April Fools name
  if (!nameComment && !locComment) return;

  // Build a comedic message
  const message = `
  <b>⚠️ System Notice:</b><br><br>
  After conducting a thorough (and highly judgmental) analysis of your behavior, we've updated your identity to better reflect your vibe:
  <br><br>
  • <b>Username:</b> ${funnyName} — (${nameComment})<br>
  • <b>Location:</b> ${funnyLocation} — (${locComment})
  <br><br>
  This change is <b>mandatory</b> and <b>cannot be appealed</b>.<br>
  Your original identity will be considered for reinstatement after <b>April 1st</b>, depending on how cringe you remain.<br><br>
  Thank you for your cooperation (not that you had a choice).
`;


  window.showInfoModal(message);
}

// Show/hide access code field
roomTypeRadios.forEach(radio => {
  radio.addEventListener('change', (e) => {
    if (e.target.value === 'semi-private') {
      accessCodeInput.style.display = 'block';
    } else {
      accessCodeInput.style.display = 'none';
    }
  });
});

// Sign in logic
logForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const newUsername = usernameInput.value.trim().slice(0, MAX_USERNAME_LENGTH);
  const newLocation = locationInput.value.trim().slice(0, MAX_LOCATION_LENGTH) || 'On The Web';

  if (!newUsername) {
    window.showErrorModal('Please enter a username.');
    return;
  }

  if (currentUsername) {
    signInButton.textContent = 'Changed';
    setTimeout(() => {
      signInButton.textContent = 'Change ';
      const img = document.createElement('img');
      img.src = 'images/icons/pencil.png';
      img.alt = 'Arrow';
      img.classList.add('arrow-icon');
      signInButton.appendChild(img);
    }, 2000);
  } else {
    signInButton.textContent = 'Change ';
    const img = document.createElement('img');
    img.src = 'images/icons/pencil.png';
    img.alt = 'Arrow';
    img.classList.add('arrow-icon');
    signInButton.appendChild(img);
    createRoomForm.classList.remove('hidden');
  }

  currentUsername = newUsername;
  currentLocation = newLocation;
  isSignedIn = true;

  socket.emit('join lobby', {
    username: currentUsername,
    location: currentLocation
  });

  showRoomList();
});

// "Go Chat" button -> create room
goChatButton.addEventListener('click', () => {
  const roomName = roomNameInput.value.trim().slice(0, MAX_ROOM_NAME_LENGTH);
  const roomType = document.querySelector('input[name="roomType"]:checked')?.value;
  const roomLayout = document.querySelector('input[name="roomLayout"]:checked')?.value;
  const accessCode = accessCodeInput.querySelector('input').value;

  if (!roomName || !roomType || !roomLayout) {
    window.showErrorModal('Please fill in all room details.');
    return;
  }

  if (roomType === 'semi-private') {
    if (!accessCode || accessCode.length !== 6 || !/^\d+$/.test(accessCode)) {
      window.showErrorModal('Please enter a valid 6-digit access code for the semi-private room.');
      return;
    }
    lastUsedAccessCode = accessCode;
  }
  
  socket.emit('create room', {
    name: roomName,
    type: roomType,
    layout: roomLayout,
    accessCode
  });
});

// Room list "enter" button (join existing room)
dynamicRoomList.addEventListener('click', (e) => {
  if (e.target.classList.contains('enter-button') && !e.target.disabled) {
    const roomElement = e.target.closest('.room');
    const roomId = roomElement.dataset.roomId;
    const roomType = roomElement.dataset.roomType;

    if (roomType === 'semi-private') {
      promptAccessCode(roomId);
    } else {
      joinRoom(roomId);
    }
  }
});

// Utility to ask for an access code
function promptAccessCode(roomId) {
  window.showInputModal(
    'Access Code Required',
    'Please enter the 6-digit access code for this room:',
    {
      placeholder: '6-digit code',
      maxLength: '6',
      validate: (value) => {
        if (!value) return 'Access code is required';
        if (value.length !== 6 || !/^\d+$/.test(value)) {
          return 'Invalid access code. Please enter a 6-digit number.';
        }
        return true;
      }
    },
    (confirmed, accessCode) => {
      if (confirmed && accessCode) {
        lastUsedAccessCode = accessCode;
        joinRoom(roomId, accessCode);
      }
    }
  );
}

// Actually join the room via socket
function joinRoom(roomId, accessCode = null) {
  const data = { roomId, accessCode };
  socket.emit('join room', data);
}

// Sign-in status check
socket.on('signin status', (data) => {
  if (!data.isSignedIn) {
    signInMessage.style.display = 'block';
    roomListContainer.style.display = 'none';
    return;
  }

  // The server might have replaced the user's name/location with something "funny"
  currentUsername = data.username;
  currentLocation = data.location;
  currentUserId = data.userId;
  isSignedIn = true;

  usernameInput.value = currentUsername;
  locationInput.value = currentLocation;

  signInButton.textContent = 'Change ';
  const img = document.createElement('img');
  img.src = 'images/icons/pencil.png';
  img.alt = 'Arrow';
  img.classList.add('arrow-icon');
  signInButton.appendChild(img);

  createRoomForm.classList.remove('hidden');
  showRoomList();

  // 2) Possibly show the "funny rename" modal
  maybeShowFunnyModal(currentUsername, currentLocation);
});

// “room joined” -> redirect to the room page
socket.on('room joined', (data) => {
  // Possibly show the "funny rename" modal *before* redirect:
  maybeShowFunnyModal(data.username, data.location);

  if (lastUsedAccessCode) {
    window.location.href = `/room.html?roomId=${data.roomId}&accessCode=${lastUsedAccessCode}`;
    lastUsedAccessCode = null;
  } else {
    window.location.href = `/room.html?roomId=${data.roomId}`;
  }
});

socket.on('lobby update', (rooms) => {
  updateLobby(rooms);
});

socket.on('initial rooms', (rooms) => {
  updateLobby(rooms);
});

// If a room was created, navigate to it
socket.on('room created', (roomId) => {
  if (lastUsedAccessCode) {
    window.location.href = `/room.html?roomId=${roomId}&accessCode=${lastUsedAccessCode}`;
    lastUsedAccessCode = null;
  } else {
    window.location.href = `/room.html?roomId=${roomId}`;
  }
});

socket.on('error', (error) => {
  window.showErrorModal(`An error occurred: ${error}`);
});

// Show the list of rooms
function showRoomList() {
  signInMessage.style.display = 'none';
  roomListContainer.style.display = 'block';
  socket.emit('get rooms');
}

// Update the dynamic list of rooms
function updateLobby(rooms) {
  dynamicRoomList.innerHTML = '';
  const publicRooms = rooms.filter(room => room.type !== 'private');

  if (publicRooms.length === 0) {
    noRoomsMessage.style.display = 'block';
    dynamicRoomList.style.display = 'none';
  } else {
    noRoomsMessage.style.display = 'none';
    dynamicRoomList.style.display = 'block';

    publicRooms.forEach((room) => {
      const roomElement = createRoomElement(room);
      dynamicRoomList.appendChild(roomElement);
    });
  }
}

// Construct a DOM element for each room
function createRoomElement(room) {
  const roomElement = document.createElement('div');
  roomElement.classList.add('room');
  roomElement.dataset.roomId = room.id;
  roomElement.dataset.roomType = room.type;

  const enterButton = document.createElement('button');
  enterButton.classList.add('enter-button');

  if (room.users.length >= 5) {
    enterButton.textContent = 'Full';
    enterButton.disabled = true;
    roomElement.classList.add('full');
  } else {
    enterButton.textContent = 'Enter';
  }

  const roomTop = document.createElement('div');
  roomTop.classList.add('room-top');

  const roomInfo = document.createElement('div');
  roomInfo.classList.add('room-info');

  const roomNameDiv = document.createElement('div');
  roomNameDiv.classList.add('room-name');
  roomNameDiv.textContent = `${room.name} (${room.users.length}/5 People)`;

  const roomDetailsDiv = document.createElement('div');
  roomDetailsDiv.classList.add('room-details');
  roomDetailsDiv.textContent = getRoomTypeDisplay(room.type);

  const usersDetailDiv = document.createElement('div');
  usersDetailDiv.classList.add('users-detail');

  room.users.forEach((user, index) => {
    const userDiv = document.createElement('div');

    const userNumberSpan = document.createElement('span');
    userNumberSpan.classList.add('user-number');
    userNumberSpan.textContent = `${index + 1}.`;

    const userNameSpan = document.createElement('span');
    userNameSpan.classList.add('user-name');
    userNameSpan.textContent = user.username;

    userDiv.appendChild(userNumberSpan);
    userDiv.appendChild(userNameSpan);
    userDiv.append(` / ${user.location}`);

    usersDetailDiv.appendChild(userDiv);
  });

  roomInfo.appendChild(roomNameDiv);
  roomInfo.appendChild(roomDetailsDiv);
  roomInfo.appendChild(usersDetailDiv);

  roomTop.appendChild(roomInfo);
  roomElement.appendChild(enterButton);
  roomElement.appendChild(roomTop);

  return roomElement;
}

function getRoomTypeDisplay(type) {
  switch (type) {
    case 'public': return 'Public Room';
    case 'semi-private': return 'Semi-Private Room';
    case 'private': return 'Private Room';
    default: return type;
  }
}

// Auto-check sign-in status on page load
function initLobby() {
  document.querySelector('input[name="roomType"][value="public"]').checked = true;
  document.querySelector('input[name="roomLayout"][value="horizontal"]').checked = true;
  socket.emit('check signin status');
}

window.addEventListener('load', () => {
  initLobby();
});
