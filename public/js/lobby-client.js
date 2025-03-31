// ============================================================================
// lobby-client.js
// ============================================================================

// Immediately-invoked function for custom modal initialization
(function() {
  // Avoid re-initializing if this script is included multiple times
  if (window.modalFunctionsInitialized) {
    console.log("Custom modal already initialized");
    return;
  }
  window.modalFunctionsInitialized = true;

  // Grab modal DOM references
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

  // Show a generic modal with optional input
  function showModal(title, message, options = {}) {
    modalTitle.textContent = title;
    // Using innerHTML so we can include <br> in messages
    modalMessage.innerHTML = message;

    // Reset input elements
    modalInputContainer.style.display = 'none';
    modalInput.value = '';
    modalInputError.style.display = 'none';
    modalInputError.textContent = '';

    if (options.showInput) {
      modalInputContainer.style.display = 'block';
      modalInput.placeholder = options.inputPlaceholder || '';
      modalInput.setAttribute('maxLength', options.maxLength || '6');
      modalInput.focus();
    }

    modalCancelBtn.textContent = options.cancelText || 'Cancel';
    modalConfirmBtn.textContent = options.confirmText || 'Confirm';
    // Show or hide cancel button
    modalCancelBtn.style.display = options.showCancel !== false ? 'block' : 'none';

    // Store callback to be invoked on confirm/cancel
    currentModalCallback = options.callback || null;

    // Show the modal
    customModal.classList.add('show');
    document.body.style.overflow = 'hidden'; // Prevent scrolling behind the modal
  }

  function hideCustomModal() {
    customModal.classList.remove('show');
    document.body.style.overflow = '';
    currentModalCallback = null;
  }

  // Expose some modal convenience functions
  window.showErrorModal = function(message) {
    showModal('Error', message, {
      showCancel: false,
      confirmText: 'OK'
    });
  };

  window.showInfoModal = function(message) {
    showModal('Information', message, {
      showCancel: false,
      confirmText: 'OK'
    });
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
            return false; // prevent closing
          }
        }
        callback(confirmed, inputValue);
        return true;
      }
    });
  };

  // Modal button handlers
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

  // Click outside the content => close
  customModal.addEventListener('click', (e) => {
    if (e.target === customModal) {
      hideCustomModal();
    }
  });

  // Only numeric input for the input field
  modalInput.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/[^0-9]/g, '');
  });

  // Escape => close the modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && customModal.classList.contains('show')) {
      hideCustomModal();
    }
  });

  // Enter => confirm
  modalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      modalConfirmBtn.click();
    }
  });
})();

// ========================
// Socket.IO Initialization
// ========================
const socket = io();

// DOM references
const logForm        = document.getElementById('logform');
const createRoomForm = document.getElementById('lobbyForm');
const roomListContainer = document.querySelector('.roomList');
const dynamicRoomList   = document.getElementById('dynamicRoomList');

const usernameInput  = document.getElementById('aprilFoolsNameInput');
const locationInput  = document.getElementById('aprilFoolsLocationInput');
const signInButton   = document.getElementById('aprilFoolsSignInButton');

const roomNameInput  = createRoomForm.querySelector('input[placeholder="Room Name"]');
const goChatButton   = createRoomForm.querySelector('.go-chat-button');
const signInMessage  = document.getElementById('signInMessage');
const noRoomsMessage = document.getElementById('noRoomsMessage');
const accessCodeInput= document.getElementById('accessCodeInput');
const roomTypeRadios = document.querySelectorAll('input[name="roomType"]');

let currentUsername   = '';
let currentLocation   = '';
let currentUserId     = '';
let isSignedIn        = false;
let lastUsedAccessCode= null;

// Limits
const MAX_USERNAME_LENGTH = 12;
const MAX_LOCATION_LENGTH = 12;
const MAX_ROOM_NAME_LENGTH= 20;

/** 
 * COMEDIC DICTIONARIES
 * 
 * Paste your dictionary objects below 
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

// If comedic name => show comedic modal
function maybeShowFunnyModal(funnyName, funnyLocation) {
  const nameComment = funnyNameComments[funnyName] || "";
  const locComment  = funnyLocationComments[funnyLocation] || "";

  if (!nameComment && !locComment) {
    // Not in the dictionary => not "funny"
    return;
  }

  const message = `
    <b>⚠️ System Notice:</b><br><br>
    After conducting a thorough (and highly judgmental) analysis of your behavior, 
    we've updated your identity to better reflect your vibe:
    <br><br>
    • <b>Username:</b> ${funnyName} — (${nameComment})<br>
    • <b>Location:</b> ${funnyLocation} — (${locComment})
    <br><br>
    This change is <b>mandatory</b> and <b>cannot be appealed</b>.<br>
    Your original identity will be considered for reinstatement after <b>April 1st</b>, 
    depending on how cringe you remain.<br><br>
    Thank you for your cooperation (not that you had a choice).
  `;
  window.showInfoModal(message);
}

// *** APRIL FOOLS PRANKS ***

// Flip page upside down for 5s
function aprilFoolsFlipPage() {
  document.body.classList.add('april-fools-upside-down');
  setTimeout(() => {
    document.body.classList.remove('april-fools-upside-down');
  }, 5000);
}

// Clown cursor, color-cycling
function aprilFoolsApplyStyles() {
  document.body.classList.add('april-fools-cursor');
  document.body.classList.add('april-fools-crazy');
}

// Falling clown emoji confetti
function aprilFoolsConfetti(emoji = "🤡", count = 20) {
  for (let i = 0; i < count; i++) {
    const elem = document.createElement('div');
    elem.textContent = emoji;
    elem.style.position = 'fixed';
    elem.style.left = (Math.random() * 100) + '%';
    elem.style.top  = '-50px';
    elem.style.fontSize = '2rem';
    elem.style.zIndex = 999999;
    document.body.appendChild(elem);

    const duration = 3000 + Math.random() * 3000;
    elem.animate([
      { transform: 'translateY(0px)', opacity: 1 },
      { transform: `translateY(${window.innerHeight + 100}px)`, opacity: 0 }
    ], {
      duration,
      easing: 'linear'
    }).onfinish = () => elem.remove();
  }
}

// Make signInButton move away on mouseover (only 2 times)
function aprilFoolsMoveSignInButton() {
  let moveCount = 0;
  signInButton.addEventListener('mouseover', () => {
    if (moveCount < 2) {
      signInButton.style.position = 'absolute';
      signInButton.style.left = (Math.random() * 250) + 'px';
      signInButton.style.top  = (Math.random() * 100 + 50) + 'px';
      moveCount++;
    }
  });
}

// After user has a name, the next "Change" becomes impossible
function aprilFoolsMakeChangeButtonImpossible() {
  // Periodically flash random clown emojis in text
  const clownEmojis = ["🤡","🎪","🤪","🎈","🃏","🎉"];
  // If you want the text to never revert, store interval
  setInterval(() => {
    const randomClown = clownEmojis[Math.floor(Math.random()*clownEmojis.length)];
    signInButton.textContent = `Change ${randomClown}`;
  }, 700);

  // On mouseover, reposition
  signInButton.addEventListener('mouseover', () => {
    signInButton.style.position = 'absolute';
    signInButton.style.left = (Math.random() * 300) + 'px';
    signInButton.style.top  = (Math.random() * 100 + 50) + 'px';

    const randomScale = 0.5 + Math.random() * 1.5;
    const randomRotation = Math.floor(Math.random()*30 - 15);
    signInButton.style.transform = `scale(${randomScale}) rotate(${randomRotation}deg)`;
  });

  // If user manages to click => show comedic modal + confetti
  signInButton.addEventListener('click', (e) => {
    e.preventDefault();
    // Show comedic modal re: their name
    const nameComment = funnyNameComments[currentUsername] || "";
    const locComment  = funnyLocationComments[currentLocation] || "";

    const message = `
      <b>⚠️ System Notice:</b><br><br>
      After conducting a thorough (and highly judgmental) analysis of your behavior, 
      we've updated your identity to better reflect your vibe:
      <br><br>
      • <b>Username:</b> ${currentUsername} — (${nameComment})<br>
      • <b>Location:</b> ${currentLocation} — (${locComment})
      <br><br>
      This change is <b>mandatory</b> and <b>cannot be appealed</b>.<br>
      Your original identity will be considered for reinstatement after <b>April 1st</b>, 
      depending on how cringe you remain.<br><br>
      Thank you for your cooperation (not that you had a choice).
    `;

    // Show modal
    window.showInfoModal(message);
    // Also do clown confetti for comedic effect
    aprilFoolsConfetti("🤡", 20);

    // Teleport again
    signInButton.style.position = 'absolute';
    signInButton.style.left = (Math.random()*300) + 'px';
    signInButton.style.top  = (Math.random()*100 + 50) + 'px';

    const randomScale = 0.5 + Math.random()*1.5;
    const randomRotation = Math.floor(Math.random()*30 - 15);
    signInButton.style.transform = `scale(${randomScale}) rotate(${randomRotation}deg)`;
  });
}

// For dev testing => always true
function isAprilFoolsDayClient() {
  // In real usage, you'd check the date:
  // const now = new Date();
  // return (now.getMonth() === 3 && now.getDate() === 1);
  return true;
}

// Show/hide Access Code input for semi-private
roomTypeRadios.forEach(radio => {
  radio.addEventListener('change', () => {
    if (radio.value === 'semi-private') {
      accessCodeInput.style.display = 'block';
    } else {
      accessCodeInput.style.display = 'none';
    }
  });
});

// Sign in form submission
logForm.addEventListener('submit', (e) => {
  e.preventDefault();

  const newUsername = usernameInput.value.trim().slice(0, MAX_USERNAME_LENGTH);
  const newLocation = locationInput.value.trim().slice(0, MAX_LOCATION_LENGTH) || 'On The Web';

  if (!newUsername) {
    window.showErrorModal('Please enter a username.');
    return;
  }

  // If we already had a name => "Change" scenario
  if (currentUsername) {
    signInButton.textContent = 'Changed';
    setTimeout(() => {
      signInButton.textContent = 'Change ';
      const pencilIcon = document.createElement('img');
      pencilIcon.src = 'images/icons/pencil.png';
      pencilIcon.alt = 'Arrow';
      pencilIcon.classList.add('arrow-icon');
      signInButton.appendChild(pencilIcon);

      // Now it becomes "impossible to click"
      aprilFoolsMakeChangeButtonImpossible();
    }, 2000);

  } else {
    // First time sign in
    signInButton.textContent = 'Change ';
    const pencilIcon = document.createElement('img');
    pencilIcon.src = 'images/icons/pencil.png';
    pencilIcon.alt = 'Arrow';
    pencilIcon.classList.add('arrow-icon');
    signInButton.appendChild(pencilIcon);

    createRoomForm.classList.remove('hidden');
  }

  currentUsername = newUsername;
  currentLocation = newLocation;
  isSignedIn = true;

  // Send to server
  socket.emit('join lobby', {
    username: currentUsername,
    location: currentLocation
  });

  // Confetti to celebrate sign-in
  aprilFoolsConfetti("🤡", 30);

  // Show the list of rooms
  showRoomList();
});

// Create Room button
goChatButton.addEventListener('click', () => {
  const roomName   = roomNameInput.value.trim().slice(0, MAX_ROOM_NAME_LENGTH);
  const roomType   = document.querySelector('input[name="roomType"]:checked')?.value;
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
  
  // Request room creation from server
  socket.emit('create room', {
    name: roomName,
    type: roomType,
    layout: roomLayout,
    accessCode
  });
});

// Clicking "Enter" on listed rooms
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

// Prompt for the semi-private code
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
    (confirmed, code) => {
      if (confirmed && code) {
        lastUsedAccessCode = code;
        joinRoom(roomId, code);
      }
    }
  );
}

function joinRoom(roomId, accessCode = null) {
  socket.emit('join room', { roomId, accessCode });
}

// Socket events from server

// 1) After sign-in status is returned
socket.on('signin status', (data) => {
  if (!data.isSignedIn) {
    signInMessage.style.display = 'block';
    roomListContainer.style.display = 'none';
    return;
  }

  // Possibly replaced by server with a "funny" name
  currentUsername = data.username;
  currentLocation = data.location;
  currentUserId   = data.userId;
  isSignedIn      = true;

  usernameInput.value = currentUsername;
  locationInput.value = currentLocation;

  // If we haven't used this form yet
  if (!currentUsername) {
    signInButton.textContent = 'Change ';
    const pencilIcon = document.createElement('img');
    pencilIcon.src = 'images/icons/pencil.png';
    pencilIcon.alt = 'Arrow';
    pencilIcon.classList.add('arrow-icon');
    signInButton.appendChild(pencilIcon);

    createRoomForm.classList.remove('hidden');
  }

  signInMessage.style.display = 'none';
  roomListContainer.style.display = 'block';

  maybeShowFunnyModal(currentUsername, currentLocation);
  showRoomList();
});

// 2) After "room joined"
socket.on('room joined', (data) => {
  // Possibly show comedic modal again if it's a funny name
  maybeShowFunnyModal(data.username, data.location);

  if (lastUsedAccessCode) {
    // If user needed an access code, store in URL
    window.location.href = `/room.html?roomId=${data.roomId}&accessCode=${lastUsedAccessCode}`;
    lastUsedAccessCode = null;
  } else {
    // Otherwise just roomId
    window.location.href = `/room.html?roomId=${data.roomId}`;
  }
});

// 3) After "lobby update"
socket.on('lobby update', (rooms) => {
  updateLobby(rooms);
});

// 4) "initial rooms"
socket.on('initial rooms', (rooms) => {
  updateLobby(rooms);
});

// 5) "room created"
socket.on('room created', (roomId) => {
  if (lastUsedAccessCode) {
    window.location.href = `/room.html?roomId=${roomId}&accessCode=${lastUsedAccessCode}`;
    lastUsedAccessCode = null;
  } else {
    window.location.href = `/room.html?roomId=${roomId}`;
  }
});

// 6) Error
socket.on('error', (errorMsg) => {
  window.showErrorModal(`An error occurred: ${errorMsg}`);
});

/** 
 * Helpers to show/hide room list 
 */
function showRoomList() {
  signInMessage.style.display = 'none';
  roomListContainer.style.display = 'block';
  // Ask server for updated rooms
  socket.emit('get rooms');
}

function updateLobby(rooms) {
  dynamicRoomList.innerHTML = '';
  const publicRooms = rooms.filter(r => r.type !== 'private');

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

// Build DOM element for each public or semi-private room
function createRoomElement(room) {
  const roomElement = document.createElement('div');
  roomElement.classList.add('room');
  roomElement.dataset.roomId = room.id;
  roomElement.dataset.roomType= room.type;

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
  if (room.type === 'private') {
    roomDetailsDiv.textContent = 'Private Room';
  } else if (room.type === 'semi-private') {
    roomDetailsDiv.textContent = 'Semi-Private Room';
  } else {
    roomDetailsDiv.textContent = 'Public Room';
  }

  const usersDetailDiv = document.createElement('div');
  usersDetailDiv.classList.add('users-detail');

  // List current users
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

// Initialize on page load
function initLobby() {
  // Default radio selections
  document.querySelector('input[name="roomType"][value="public"]').checked = true;
  document.querySelector('input[name="roomLayout"][value="horizontal"]').checked = true;

  // Ask server: is user already signed in?
  socket.emit('check signin status');

  // If it's April Fools, do the extra pranks
  if (isAprilFoolsDayClient()) {
    aprilFoolsFlipPage();
    aprilFoolsApplyStyles();
    aprilFoolsMoveSignInButton();
  }
}

window.addEventListener('load', () => {
  initLobby();
});
