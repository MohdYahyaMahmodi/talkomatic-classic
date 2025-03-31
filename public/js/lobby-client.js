// ============================================================================
// lobby-client.js
// ============================================================================

// Immediately-invoked function for custom modal initialization
(function() {
  if (window.modalFunctionsInitialized) {
    console.log("Custom modal already initialized");
    return;
  }
  window.modalFunctionsInitialized = true;

  // Get modal DOM references
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
    modalMessage.innerHTML = message; // Accept HTML (for <br>, etc.)

    // Reset input container
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
    modalCancelBtn.style.display = options.showCancel !== false ? 'block' : 'none';

    currentModalCallback = options.callback || null;

    customModal.classList.add('show');
    document.body.style.overflow = 'hidden'; // Prevent background scroll
  }

  function hideCustomModal() {
    customModal.classList.remove('show');
    document.body.style.overflow = '';
    currentModalCallback = null;
  }

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

  // Modal button events
  modalConfirmBtn.addEventListener('click', () => {
    if (currentModalCallback) {
      const shouldClose = currentModalCallback(true, modalInput.value);
      if (shouldClose !== false) hideCustomModal();
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

  // Close modal when clicking outside the content
  customModal.addEventListener('click', (e) => {
    if (e.target === customModal) {
      hideCustomModal();
    }
  });

  // Only numeric input in the modal
  modalInput.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/[^0-9]/g, '');
  });

  // Escape closes modal
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
const logForm          = document.getElementById('logform');
const createRoomForm   = document.getElementById('lobbyForm');
const roomListContainer= document.querySelector('.roomList');
const dynamicRoomList  = document.getElementById('dynamicRoomList');

const usernameInput    = document.getElementById('aprilFoolsNameInput');
const locationInput    = document.getElementById('aprilFoolsLocationInput');
const signInButton     = document.getElementById('aprilFoolsSignInButton');

const roomNameInput    = createRoomForm.querySelector('input[placeholder="Room Name"]');
const goChatButton     = createRoomForm.querySelector('.go-chat-button');
const signInMessage    = document.getElementById('signInMessage');
const noRoomsMessage   = document.getElementById('noRoomsMessage');
const accessCodeInput  = document.getElementById('accessCodeInput');
const roomTypeRadios   = document.querySelectorAll('input[name="roomType"]');

let currentUsername    = '';
let currentLocation    = '';
let currentUserId      = '';
let isSignedIn         = false;
let lastUsedAccessCode = null;

const MAX_USERNAME_LENGTH   = 12;
const MAX_LOCATION_LENGTH   = 12;
const MAX_ROOM_NAME_LENGTH  = 20;

// For comedic disclaimers
const funnyNameComments = { /* ... your dictionary ... */ };
const funnyLocationComments = { /* ... your dictionary ... */ };

// Show comedic modal if username/location is "funny"
function maybeShowFunnyModal(funnyName, funnyLocation) {
  const nameComment = funnyNameComments[funnyName] || "";
  const locComment  = funnyLocationComments[funnyLocation] || "";

  if (!nameComment && !locComment) return;

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

// *** APRIL FOOLS TRICKS ***

// 1) Flip the page upside down for 5s
function aprilFoolsFlipPage() {
  document.body.classList.add('april-fools-upside-down');
  setTimeout(() => {
    document.body.classList.remove('april-fools-upside-down');
  }, 5000);
}

// 2) Clown cursor + color-cycle hover
function aprilFoolsApplyStyles() {
  document.body.classList.add('april-fools-cursor');
  document.body.classList.add('april-fools-crazy');
}

// 3) Confetti (falling clown emojis)
function aprilFoolsConfetti(emoji = "🤡", count = 20) {
  for (let i = 0; i < count; i++) {
    const elem = document.createElement('div');
    elem.textContent = emoji;
    elem.style.position = 'fixed';
    elem.style.left = (Math.random()*100) + '%';
    elem.style.top = '-50px';
    elem.style.fontSize = '2rem';
    elem.style.zIndex = 999999;
    document.body.appendChild(elem);

    const duration = 3000 + Math.random()*3000;
    elem.animate([
      { transform: 'translateY(0px)', opacity: 1 },
      { transform: `translateY(${window.innerHeight + 100}px)`, opacity: 0 }
    ], {
      duration,
      easing: 'linear'
    }).onfinish = () => elem.remove();
  }
}

// 4) Make signInButton move away on mouseover (only 2 times)
function aprilFoolsMoveSignInButton() {
  let moveCount = 0;
  signInButton.addEventListener('mouseover', () => {
    if (moveCount < 2) {
      signInButton.style.position = 'absolute';
      signInButton.style.left = Math.random() * 250 + 'px';
      signInButton.style.top  = (Math.random()*100 + 50) + 'px';
      moveCount++;
    }
  });
}

// 5) “Impossible to click” after user already has a name
//    Mouseover => reposition
//    If user DOES click => comedic modal + reposition
function aprilFoolsMakeChangeButtonImpossible() {
  // Random clown emojis in text
  const clownEmojis = ["🤡", "🎪", "🤪", "🎈", "🃏", "🎉"];
  setInterval(() => {
    const randomClown = clownEmojis[Math.floor(Math.random()*clownEmojis.length)];
    signInButton.textContent = `Change ${randomClown}`;
  }, 600);

  // Reposition on mouseover
  signInButton.addEventListener('mouseover', (e) => {
    // Keep them from easily hovering
    signInButton.style.position = 'absolute';
    signInButton.style.left = (Math.random()*300) + 'px';
    signInButton.style.top  = (Math.random()*100 + 50) + 'px';

    const randomScale = 0.5 + Math.random()*1.5;
    const randomRotation = Math.floor(Math.random()*30 - 15);
    signInButton.style.transform = `scale(${randomScale}) rotate(${randomRotation}deg)`;
  });

  // If user DOES manage to click => comedic modal + reposition
  signInButton.addEventListener('click', (e) => {
    e.preventDefault(); // prevent form submission or any real “Change” action

    // Show comedic modal about their name
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
    window.showInfoModal(message);

    // Then reposition again
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
  return true;
}

// If user picks "semi-private", show Access Code input
roomTypeRadios.forEach(radio => {
  radio.addEventListener('change', () => {
    if (radio.value === 'semi-private') {
      accessCodeInput.style.display = 'block';
    } else {
      accessCodeInput.style.display = 'none';
    }
  });
});

// Sign in form
logForm.addEventListener('submit', (e) => {
  e.preventDefault();

  const newUsername = usernameInput.value.trim().slice(0, MAX_USERNAME_LENGTH);
  const newLocation = locationInput.value.trim().slice(0, MAX_LOCATION_LENGTH) || 'On The Web';

  if (!newUsername) {
    window.showErrorModal('Please enter a username.');
    return;
  }

  if (currentUsername) {
    // Already had a name => "Change"
    signInButton.textContent = 'Changed';
    setTimeout(() => {
      signInButton.textContent = 'Change ';
      const img = document.createElement('img');
      img.src = 'images/icons/pencil.png';
      img.alt = 'Arrow';
      img.classList.add('arrow-icon');
      signInButton.appendChild(img);

      // Make it truly impossible now
      aprilFoolsMakeChangeButtonImpossible();
    }, 2000);

  } else {
    // First sign in
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

  // Send to server
  socket.emit('join lobby', {
    username: currentUsername,
    location: currentLocation
  });

  // Confetti each time
  aprilFoolsConfetti("🤡", 30);

  showRoomList();
});

// "Create Room" button
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
  
  socket.emit('create room', {
    name: roomName,
    type: roomType,
    layout: roomLayout,
    accessCode
  });
});

// Clicking "Enter" on a listed room
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

// Prompt user for the semi-private access code
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

// Socket events
socket.on('signin status', (data) => {
  if (!data.isSignedIn) {
    signInMessage.style.display = 'block';
    roomListContainer.style.display = 'none';
    return;
  }
  currentUsername = data.username;
  currentLocation = data.location;
  currentUserId   = data.userId;
  isSignedIn      = true;

  usernameInput.value = currentUsername;
  locationInput.value = currentLocation;

  if (!currentUsername) {
    // Possibly handle if you want to show "Change" button
    signInButton.textContent = 'Change ';
    const img = document.createElement('img');
    img.src = 'images/icons/pencil.png';
    img.alt = 'Arrow';
    img.classList.add('arrow-icon');
    signInButton.appendChild(img);

    createRoomForm.classList.remove('hidden');
  }

  signInMessage.style.display = 'none';
  roomListContainer.style.display = 'block';

  maybeShowFunnyModal(currentUsername, currentLocation);
  showRoomList();
});

socket.on('room joined', (data) => {
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

function showRoomList() {
  signInMessage.style.display = 'none';
  roomListContainer.style.display = 'block';
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

// Build the DOM element for each public/semi-public room
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

function initLobby() {
  document.querySelector('input[name="roomType"][value="public"]').checked = true;
  document.querySelector('input[name="roomLayout"][value="horizontal"]').checked = true;

  // Check with server
  socket.emit('check signin status');

  // If it's "April Fools" day, do pranks
  if (isAprilFoolsDayClient()) {
    aprilFoolsFlipPage();
    aprilFoolsApplyStyles();
    aprilFoolsMoveSignInButton();
  }
}

window.addEventListener('load', () => {
  initLobby();
});
