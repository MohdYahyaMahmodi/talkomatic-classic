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

const MAX_USERNAME_LENGTH = 12;
const MAX_LOCATION_LENGTH = 12;
const MAX_ROOM_NAME_LENGTH = 20;

function checkSignInStatus() {
    console.log('Checking sign-in status');
    socket.emit('check signin status');
}

// Show/hide access code input based on room type selection
roomTypeRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
        if (e.target.value === 'semi-private') {
            accessCodeInput.style.display = 'block';
        } else {
            accessCodeInput.style.display = 'none';
        }
    });
});

// Handle user sign in
logForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const newUsername = usernameInput.value.trim().slice(0, MAX_USERNAME_LENGTH);
    const newLocation = locationInput.value.trim().slice(0, MAX_LOCATION_LENGTH) || 'On The Web';
    if (newUsername) {
        if (currentUsername) {
            signInButton.textContent = 'Changed';
            setTimeout(() => {
                signInButton.innerHTML = 'Change <img src="images/icons/pencil.png" alt="Arrow" class="arrow-icon">';
            }, 2000);
        } else {
            signInButton.innerHTML = 'Change <img src="images/icons/pencil.png" alt="Arrow" class="arrow-icon">';
            createRoomForm.classList.remove('hidden');
        }
        currentUsername = newUsername;
        currentLocation = newLocation;
        isSignedIn = true;

        console.log(`Joining lobby as ${currentUsername} from ${currentLocation}`);
        socket.emit('join lobby', { username: currentUsername, location: currentLocation });
        showRoomList();
    } else {
        alert('Please enter a username.');
    }
});

// Handle room creation
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
        console.log(`Creating room: ${roomName}, Type: ${roomType}, Layout: ${roomLayout}`);
        socket.emit('create room', { name: roomName, type: roomType, layout: roomLayout, accessCode });
    } else {
        alert('Please fill in all room details.');
    }
});

// Handle room entry
dynamicRoomList.addEventListener('click', (e) => {
    if (e.target.classList.contains('enter-button')) {
        const roomId = e.target.closest('.room').dataset.roomId;
        const roomType = e.target.closest('.room').dataset.roomType;
        console.log(`Attempting to join room: ${roomId}, Type: ${roomType}`);

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
    console.log(`Successfully joined room:`, data);
    window.location.href = `/room.html?roomId=${data.roomId}`;
});

socket.on('signin status', (data) => {
    console.log('Received signin status:', data);
    if (data.isSignedIn) {
        currentUsername = data.username;
        currentLocation = data.location;
        currentUserId = data.userId;
        isSignedIn = true;
        usernameInput.value = currentUsername;
        locationInput.value = currentLocation;
        signInButton.innerHTML = 'Change <img src="images/icons/pencil.png" alt="Arrow" class="arrow-icon">';
        createRoomForm.classList.remove('hidden');
        showRoomList();
    } else {
        console.log('User not signed in');
        signInMessage.style.display = 'block';
        roomListContainer.style.display = 'none';
    }
});

socket.on('lobby update', (rooms) => {
    console.log('Received lobby update:', rooms);
    updateLobby(rooms);
});

socket.on('room joined', (data) => {
    console.log(`Successfully joined room:`, data);
    window.location.href = `/room.html?roomId=${data.roomId}`;
});

socket.on('room created', (roomId) => {
    console.log(`Room created with ID: ${roomId}`);
    window.location.href = `/room.html?roomId=${roomId}`;
});

socket.on('error', (error) => {
    console.error('Received error:', error);
    alert(`An error occurred: ${error}`);
});

function createRoomElement(room) {
    const roomElement = document.createElement('div');
    roomElement.classList.add('room');
    roomElement.dataset.roomId = room.id;
    roomElement.dataset.roomType = room.type;
    roomElement.innerHTML = `
        <button class="enter-button">Enter</button>
        <div class="room-top">
            <div class="room-info">
                <div class="room-name">${room.name} (${room.users.length} People)</div>
                <div class="room-details">${getRoomTypeDisplay(room.type)} Room</div>
                <div class="users-detail">
                    ${room.users.map((user, index) => `
                        <div><span class="user-number">${index + 1}.</span><span class="user-name">${user.username}</span> / ${user.location}</div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
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
    console.log('Updating lobby with rooms:', rooms);
    dynamicRoomList.innerHTML = '';

    const publicRooms = rooms.filter(room => room.type !== 'private');

    if (publicRooms.length === 0) {
        console.log('No public rooms available');
        noRoomsMessage.style.display = 'block';
        dynamicRoomList.style.display = 'none';
    } else {
        console.log(`Displaying ${publicRooms.length} public rooms`);
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
    console.log('Initializing lobby');
    document.querySelector('input[name="roomType"][value="public"]').checked = true;
    document.querySelector('input[name="roomLayout"][value="horizontal"]').checked = true;
    
    console.log('Checking signin status with server');
    socket.emit('check signin status');
}

window.addEventListener('load', () => {
    initLobby();
});

socket.on('initial rooms', (rooms) => {
    console.log('Received initial room list:', rooms);
    updateLobby(rooms);
});