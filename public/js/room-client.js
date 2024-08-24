const socket = io();

let currentUsername = '';
let currentLocation = '';
let currentRoomId = '';
let currentUserId = '';

// Get room information from sessionStorage
function getRoomInfo() {
    const roomData = JSON.parse(sessionStorage.getItem('roomData'));
    if (roomData) {
        currentRoomId = roomData.roomId;
        currentUsername = roomData.username;
        currentLocation = roomData.location;
        currentUserId = roomData.userId;
        return roomData;
    }
    return null;
}

// Initialize room
function initRoom() {
    const roomData = getRoomInfo();
    if (roomData) {
        console.log(`Rejoining room: ${currentRoomId} as ${currentUsername} from ${currentLocation}`);
        updateRoomInfo(roomData);
        socket.emit('rejoin room', {
            roomId: currentRoomId,
            username: currentUsername,
            location: currentLocation
        });
    } else {
        console.error('No room data found');
        window.location.href = '/index.html';
    }
}

// Handle successful room join
socket.on('room joined', (data) => {
    console.log(`Successfully joined room:`, data);
    currentUserId = data.userId;
    currentRoomId = data.roomId;
    currentUsername = data.username;
    currentLocation = data.location;
    updateRoomInfo(data);
    if (data.users) {
        updateRoomUI(data);
    }
});

// Handle user joined event
socket.on('user joined', (user) => {
    console.log(`User joined:`, user);
    addUserToRoom(user);
});

// Handle user left event
socket.on('user left', (userId) => {
    console.log(`User left: ${userId}`);
    removeUserFromRoom(userId);
});

// Handle room update event
socket.on('room update', (roomData) => {
    console.log('Room update received:', roomData);
    updateRoomUI(roomData);
});

// Handle chat message event
socket.on('chat message', (data) => {
    console.log(`Chat message from ${data.username}: ${data.message}`);
    displayChatMessage(data);
});

// Handle user typing event
socket.on('user typing', (data) => {
    console.log(`${data.username} is typing: ${data.isTyping}`);
    updateTypingIndicator(data);
});

// Function to update room information in the UI
function updateRoomInfo(data) {
    document.querySelector('.room-name').textContent = `Room: ${data.roomName || currentRoomId}`;
    document.querySelector('.room-type').textContent = `${data.roomType || 'Public'} Room`;
    document.querySelector('.room-id').textContent = `Room ID: ${data.roomId || currentRoomId}`;
}

// Function to add a user to the room UI
function addUserToRoom(user) {
    const chatContainer = document.querySelector('.chat-container');
    const existingChatRow = document.querySelector(`.chat-row[data-user-id="${user.id}"]`);
    
    if (existingChatRow) {
        return; // User already has a chat row
    }

    const chatRow = document.createElement('div');
    chatRow.classList.add('chat-row');
    chatRow.dataset.userId = user.id;
    chatRow.innerHTML = `
        <span class="user-info">${user.username} / ${user.location}</span>
        <textarea class="chat-input" ${user.id !== currentUserId ? 'readonly' : ''}></textarea>
    `;
    chatContainer.appendChild(chatRow);
    adjustLayout();
}

// Function to remove a user from the room UI
function removeUserFromRoom(userId) {
    const chatRow = document.querySelector(`.chat-row[data-user-id="${userId}"]`);
    if (chatRow) {
        chatRow.remove();
        adjustLayout();
    }
}

// Function to update the entire room UI
function updateRoomUI(roomData) {
    const chatContainer = document.querySelector('.chat-container');
    chatContainer.innerHTML = '';
    if (roomData.users && Array.isArray(roomData.users)) {
        roomData.users.forEach(user => addUserToRoom(user));
    } else {
        console.warn('No users data available');
    }
    adjustLayout();
}

// Function to display a chat message
function displayChatMessage(data) {
    const chatInput = document.querySelector(`.chat-row[data-user-id="${data.userId}"] .chat-input`);
    if (chatInput) {
        chatInput.value = data.message;
    }
}

// Function to update typing indicator
function updateTypingIndicator(data) {
    const userInfo = document.querySelector(`.chat-row[data-user-id="${data.userId}"] .user-info`);
    if (userInfo) {
        userInfo.textContent = `${data.username} / ${data.location} ${data.isTyping ? '(typing...)' : ''}`;
    }
}

// Function to adjust layout
function adjustLayout() {
    const chatContainer = document.querySelector('.chat-container');
    const chatRows = document.querySelectorAll('.chat-row');
    const availableHeight = chatContainer.offsetHeight;
    const rowGap = 10;
    const totalGap = (chatRows.length - 1) * rowGap;
    const chatRowHeight = Math.floor((availableHeight - totalGap) / chatRows.length);

    chatRows.forEach(row => {
        row.style.height = `${chatRowHeight}px`;
        const userInfo = row.querySelector('.user-info');
        const chatInput = row.querySelector('.chat-input');
        const inputHeight = chatRowHeight - userInfo.offsetHeight - 2;
        chatInput.style.height = `${inputHeight}px`;
    });
}

// Event listener for sending chat messages
document.querySelector('.chat-container').addEventListener('input', (e) => {
    if (e.target.classList.contains('chat-input') && e.target.closest('.chat-row').dataset.userId === currentUserId) {
        const message = e.target.value;
        socket.emit('chat message', message);
        socket.emit('typing', { isTyping: message.length > 0 });
    }
});

// Event listener for leaving the room
document.querySelector('.leave-room').addEventListener('click', () => {
    socket.emit('leave room');
    sessionStorage.removeItem('roomData');
    window.location.href = '/index.html';
});

// Initialize the room when the page loads
window.addEventListener('load', initRoom);

// Adjust layout on window resize
window.addEventListener('resize', adjustLayout);