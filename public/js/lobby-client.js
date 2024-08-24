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

// Handle user sign in
logForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const newUsername = usernameInput.value.trim().slice(0, MAX_USERNAME_LENGTH);
    const newLocation = locationInput.value.trim().slice(0, MAX_LOCATION_LENGTH) || 'On The Web';
    if (newUsername) {
        if (currentUsername) {
            // Changing existing username/location
            signInButton.textContent = 'Changed';
            setTimeout(() => {
                signInButton.innerHTML = 'Change <img src="images/icons/pencil.png" alt="Arrow" class="arrow-icon">';
            }, 2000);
        } else {
            // First time sign in
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
    const roomName = roomNameInput.value.trim();
    const roomType = document.querySelector('input[name="roomType"]:checked')?.value;
    const roomLayout = document.querySelector('input[name="roomLayout"]:checked')?.value;
    if (roomName && roomType && roomLayout) {
        console.log(`Creating room: ${roomName}, Type: ${roomType}, Layout: ${roomLayout}`);
        socket.emit('create room', { name: roomName, type: roomType, layout: roomLayout });
    } else {
        alert('Please fill in all room details.');
    }
});

// Handle room entry
dynamicRoomList.addEventListener('click', (e) => {
    if (e.target.classList.contains('enter-button')) {
        const roomId = e.target.closest('.room').dataset.roomId;
        console.log(`Joining room: ${roomId}`);
        socket.emit('join room', roomId);
    }
});

// Add this event listener
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
        // If not signed in, show the sign-in form
        signInMessage.style.display = 'block';
        roomListContainer.style.display = 'none';
    }
});

// Update lobby with new room list
socket.on('lobby update', (rooms) => {
    console.log('Received lobby update:', rooms);
    updateLobby(rooms);
});

// Handle successful room join
socket.on('room joined', (data) => {
    console.log(`Successfully joined room:`, data);
    // Store room data in sessionStorage
    sessionStorage.setItem('roomData', JSON.stringify({
        roomId: data.roomId,
        userId: data.userId,
        username: currentUsername,
        location: currentLocation,
        roomName: data.roomName,
        roomType: data.roomType,
        layout: data.layout  // Add this line
    }));
    window.location.href = '/room.html';
});

// Handle successful room creation
socket.on('room created', (roomId) => {
    console.log(`Room created with ID: ${roomId}`);
    socket.emit('join room', roomId);
});

// Handle errors
socket.on('error', (error) => {
    console.error('Received error:', error);
    alert(`An error occurred: ${error}`);
});

// Create a room element
function createRoomElement(room) {
    const roomElement = document.createElement('div');
    roomElement.classList.add('room');
    roomElement.dataset.roomId = room.id;
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

// Get display text for room type
function getRoomTypeDisplay(type) {
    switch (type) {
        case 'public': return 'Public';
        case 'private': return 'Semi-Private';
        case 'invisible': return 'Private';
        default: return type;
    }
}

// Update lobby with new room list
function updateLobby(rooms) {
    console.log('Updating lobby with rooms:', rooms);
    dynamicRoomList.innerHTML = '';

    if (rooms.length === 0) {
        console.log('No rooms available');
        noRoomsMessage.style.display = 'block';
        dynamicRoomList.style.display = 'none';
    } else {
        console.log(`Displaying ${rooms.length} rooms`);
        noRoomsMessage.style.display = 'none';
        dynamicRoomList.style.display = 'block';
        rooms.forEach((room) => {
            const roomElement = createRoomElement(room);
            dynamicRoomList.appendChild(roomElement);
        });
    }
}

// Show room list and hide sign-in message
function showRoomList() {
    signInMessage.style.display = 'none';
    roomListContainer.style.display = 'block';
    socket.emit('get rooms');
}

// Initialize the lobby
function initLobby() {
    console.log('Initializing lobby');
    // Set default selections for room creation
    document.querySelector('input[name="roomType"][value="public"]').checked = true;
    document.querySelector('input[name="roomLayout"][value="horizontal"]').checked = true;
    
    // Check if user is already signed in
    checkSignInStatus();
}

function autoSignIn(username, location) {
    currentUsername = username;
    currentLocation = location;
    isSignedIn = true;
    console.log(`Auto signing in as ${currentUsername} from ${currentLocation}`);
    socket.emit('join lobby', { username: currentUsername, location: currentLocation });
    showRoomList();
}

window.addEventListener('load', () => {
    const roomData = sessionStorage.getItem('roomData');
    if (roomData) {
        const { username, location } = JSON.parse(roomData);
        autoSignIn(username, location);
    } else {
        initLobby();
    }
});

// Get initial room list
socket.on('initial rooms', (rooms) => {
    console.log('Received initial room list:', rooms);
    updateLobby(rooms);
});

// Initialize the lobby when the page loads
window.addEventListener('load', initLobby);