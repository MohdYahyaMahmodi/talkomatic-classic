// ============================================================================
// lobby-client.js
// ============================================================================

// (We assume socket is already defined globally via <script> in index.html)
// Because we do: const socket = io({ query: { guestId } });

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

const MAX_USERNAME_LENGTH = 12;
const MAX_LOCATION_LENGTH = 12;
const MAX_ROOM_NAME_LENGTH = 20;

// Show/hide access code field based on room type selection
roomTypeRadios.forEach(radio => {
  radio.addEventListener('change', (e) => {
    if (e.target.value === 'semi-private') {
      accessCodeInput.style.display = 'block';
    } else {
      accessCodeInput.style.display = 'none';
    }
  });
});

logForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const newUsername = usernameInput.value.trim().slice(0, MAX_USERNAME_LENGTH);
  const newLocation = locationInput.value.trim().slice(0, MAX_LOCATION_LENGTH) || 'On The Web';

  if (newUsername) {
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
  } else {
    alert('Please enter a username.');
  }
});

goChatButton.addEventListener('click', () => {
  const roomName = roomNameInput.value.trim().slice(0, MAX_ROOM_NAME_LENGTH);
  const roomType = document.querySelector('input[name="roomType"]:checked')?.value;
  const roomLayout = document.querySelector('input[name="roomLayout"]:checked')?.value;
  const accessCode = accessCodeInput.querySelector('input').value;

  if (roomName && roomType && roomLayout) {
    if (roomType === 'semi-private') {
      if (!accessCode || accessCode.length !== 6 || !/^\d+$/.test(accessCode)) {
        alert('Please enter a valid 6-digit access code for the semi-private room.');
        return;
      }
    }
    socket.emit('create room', {
      name: roomName,
      type: roomType,
      layout: roomLayout,
      accessCode
    });
  } else {
    alert('Please fill in all room details.');
  }
});

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

function promptAccessCode(roomId) {
  const accessCode = prompt('Please enter the 6-digit access code for this room:');
  if (accessCode) {
    joinRoom(roomId, accessCode);
  }
}

function joinRoom(roomId, accessCode = null) {
  const data = { roomId, accessCode };
  socket.emit('join room', data);
}

socket.on('access code required', () => {
  const roomId = new URLSearchParams(window.location.search).get('roomId');
  promptAccessCode(roomId);
});

socket.on('room joined', (data) => {
  window.location.href = `/room.html?roomId=${data.roomId}`;
});

socket.on('signin status', (data) => {
  if (data.isSignedIn) {
    currentUsername = data.username;
    currentLocation = data.location;
    isSignedIn = true;
    usernameInput.value = currentUsername;
    locationInput.value = currentLocation;
    console.log(`Auto sign in detected: ${currentUsername} (${currentLocation})`);
    signInButton.textContent = 'Change ';
    const img = document.createElement('img');
    img.src = 'images/icons/pencil.png';
    img.alt = 'Arrow';
    img.classList.add('arrow-icon');
    signInButton.appendChild(img);
    createRoomForm.classList.remove('hidden');
    showRoomList();
  } else {
    signInMessage.style.display = 'block';
    roomListContainer.style.display = 'none';
  }
});

socket.on('lobby update', (rooms) => {
  updateLobby(rooms);
});

socket.on('room created', (roomId) => {
  window.location.href = `/room.html?roomId=${roomId}`;
});

socket.on('error', (error) => {
  alert(`An error occurred: ${error}`);
});

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
  roomDetailsDiv.textContent = `${getRoomTypeDisplay(room.type)} Room`;

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
    case 'public': return 'Public';
    case 'semi-private': return 'Semi-Private';
    case 'private': return 'Private';
    default: return type;
  }
}

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

function showRoomList() {
  signInMessage.style.display = 'none';
  roomListContainer.style.display = 'block';
  socket.emit('get rooms');
}

function initLobby() {
  document.querySelector('input[name="roomType"][value="public"]').checked = true;
  document.querySelector('input[name="roomLayout"][value="horizontal"]').checked = true;
  socket.emit('check signin status');
}

window.addEventListener('load', () => {
  initLobby();
});

socket.on('initial rooms', (rooms) => {
  updateLobby(rooms);
});

socket.on('dev message', (msg) => {
  console.log(msg);
});