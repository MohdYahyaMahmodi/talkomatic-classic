const socket = io();

let currentUsername = '';
let currentLocation = '';
let currentRoomId = '';
let currentUserId = '';
let currentRoomLayout = 'horizontal';
let lastSentMessage = '';
let typingTimeout;

const joinSound = document.getElementById('joinSound');
const leaveSound = document.getElementById('leaveSound');
let soundEnabled = true; // You can add a UI toggle for this if you want

const MAX_MESSAGE_LENGTH = 5000;

function playJoinSound() {
    if (soundEnabled) {
        joinSound.play().catch(error => console.error('Error playing join sound:', error));
    }
}

// Function to play leave sound
function playLeaveSound() {
    if (soundEnabled) {
        leaveSound.play().catch(error => console.error('Error playing leave sound:', error));
    }
}

// Get room information from sessionStorage
function getRoomInfo() {
    const roomData = JSON.parse(sessionStorage.getItem('roomData'));
    if (roomData) {
        currentRoomId = roomData.roomId;
        currentUsername = roomData.username;
        currentLocation = roomData.location;
        currentUserId = roomData.userId;
        currentRoomLayout = roomData.layout || 'horizontal';
        return roomData;
    }
    return null;
}

// Initialize room
function initRoom() {
    const roomData = getRoomInfo();
    if (roomData) {
        console.log(`Rejoining room: ${currentRoomId} as ${currentUsername} from ${currentLocation}`);
        console.log(`Room layout: ${currentRoomLayout}`);
        updateRoomInfo(roomData);
        socket.emit('rejoin room', {
            roomId: currentRoomId,
            username: currentUsername,
            location: currentLocation,
            layout: currentRoomLayout
        });

        // Add a timeout to redirect if 'room joined' event is not received
        setTimeout(() => {
            if (!document.querySelector('.chat-row')) {
                console.error('Failed to join room');
                alert('Failed to join the room. Redirecting to lobby.');
                window.location.href = '/index.html';
            }
        }, 5000); // 5 seconds timeout
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
    currentRoomLayout = data.layout || currentRoomLayout;
    console.log(`Room layout: ${currentRoomLayout}`);
    updateRoomInfo(data);
    if (data.users) {
        updateRoomUI(data);
    }
});

socket.on('room not found', () => {
    console.error('Room not found');
    alert('The room you are trying to join does not exist.');
    window.location.href = '/index.html';
});

// Handle user joined event
socket.on('user joined', (user) => {
    console.log(`User joined:`, user);
    addUserToRoom(user);
    playJoinSound();
});

// Handle user left event
socket.on('user left', (userId) => {
    console.log(`User left: ${userId}`);
    removeUserFromRoom(userId);
    playLeaveSound();
});

// Handle room update event
socket.on('room update', (roomData) => {
    console.log('Room update received:', roomData);
    currentRoomLayout = roomData.layout || currentRoomLayout;
    console.log(`Updated room layout: ${currentRoomLayout}`);
    updateRoomInfo(roomData);
    updateRoomUI(roomData);
});

// Handle chat update event
socket.on('chat update', (data) => {
    console.log(`Chat update from ${data.username}:`, data.diff);
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
    document.querySelector('.room-layout').textContent = `Layout: ${currentRoomLayout}`;
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
    const focusedElement = document.activeElement;
    const focusedUserId = focusedElement.closest('.chat-row')?.dataset.userId;
    const userInputs = {};

    // Save current user inputs
    chatContainer.querySelectorAll('.chat-row').forEach(row => {
        const userId = row.dataset.userId;
        const input = row.querySelector('.chat-input');
        userInputs[userId] = input.value;
    });

    chatContainer.innerHTML = '';
    if (roomData.users && Array.isArray(roomData.users)) {
        roomData.users.forEach(user => {
            addUserToRoom(user);
            // Restore user input
            const chatRow = chatContainer.querySelector(`.chat-row[data-user-id="${user.id}"]`);
            if (chatRow) {
                const input = chatRow.querySelector('.chat-input');
                input.value = userInputs[user.id] || '';
                // Restore focus if this was the focused element
                if (user.id === focusedUserId) {
                    input.focus();
                    // Move cursor to the end of the input
                    input.setSelectionRange(input.value.length, input.value.length);
                }
            }
        });
    } else {
        console.warn('No users data available');
    }
    adjustLayout();
}

// Function to display a chat message
function displayChatMessage(data) {
    const chatInput = document.querySelector(`.chat-row[data-user-id="${data.userId}"] .chat-input`);
    if (chatInput) {
        if (data.diff) {
            const currentText = chatInput.value;
            let newText;
            switch (data.diff.type) {
                case 'add':
                    newText = currentText.slice(0, data.diff.index) + data.diff.text + currentText.slice(data.diff.index);
                    break;
                case 'delete':
                    newText = currentText.slice(0, data.diff.index) + currentText.slice(data.diff.index + data.diff.count);
                    break;
                case 'replace':
                    newText = currentText.slice(0, data.diff.index) + data.diff.text + currentText.slice(data.diff.index + data.diff.text.length);
                    break;
            }
            chatInput.value = newText.slice(0, MAX_MESSAGE_LENGTH);
        } else {
            chatInput.value = data.message.slice(0, MAX_MESSAGE_LENGTH);
        }
    }
}

// Function to update typing indicator
function updateTypingIndicator(data) {
    const userInfo = document.querySelector(`.chat-row[data-user-id="${data.userId}"] .user-info`);
    if (userInfo) {
        userInfo.textContent = `${data.username} / ${data.location} ${data.isTyping ? '(typing...)' : ''}`;
    }
}

// Function to check if the device is mobile
function isMobile() {
    return window.innerWidth <= 768; // You can adjust this threshold as needed
}

// Function to adjust layout
function adjustLayout() {
    const chatContainer = document.querySelector('.chat-container');
    const chatRows = document.querySelectorAll('.chat-row');
    
    // Always use horizontal layout for mobile devices
    const effectiveLayout = isMobile() ? 'horizontal' : currentRoomLayout;
    console.log(`Adjusting layout: ${effectiveLayout}`);

    if (effectiveLayout === 'horizontal') {
        chatContainer.style.flexDirection = 'column';
        const availableHeight = chatContainer.offsetHeight;
        const rowGap = 10;
        const totalGap = (chatRows.length - 1) * rowGap;
        const chatRowHeight = Math.floor((availableHeight - totalGap) / chatRows.length);

        chatRows.forEach(row => {
            row.style.height = `${chatRowHeight}px`;
            row.style.width = '100%';
            const userInfo = row.querySelector('.user-info');
            const chatInput = row.querySelector('.chat-input');
            const inputHeight = chatRowHeight - userInfo.offsetHeight - 2;
            chatInput.style.height = `${inputHeight}px`;
        });
    } else { // vertical layout
        chatContainer.style.flexDirection = 'row';
        const availableWidth = chatContainer.offsetWidth;
        const columnGap = 10;
        const totalGap = (chatRows.length - 1) * columnGap;
        const chatColumnWidth = Math.floor((availableWidth - totalGap) / chatRows.length);

        chatRows.forEach(row => {
            row.style.width = `${chatColumnWidth}px`;
            row.style.height = '100%';
            const userInfo = row.querySelector('.user-info');
            const chatInput = row.querySelector('.chat-input');
            chatInput.style.height = `calc(100% - ${userInfo.offsetHeight}px - 2px)`;
        });
    }
}

// Function to calculate the difference between two strings
function getDiff(oldStr, newStr) {
    let i = 0;
    while (i < oldStr.length && i < newStr.length && oldStr[i] === newStr[i]) i++;
    
    if (i === oldStr.length && i === newStr.length) return null; // No change
    
    if (i === oldStr.length) {
        // Addition
        return { type: 'add', text: newStr.slice(i), index: i };
    } else if (i === newStr.length) {
        // Deletion
        return { type: 'delete', count: oldStr.length - i, index: i };
    } else {
        // Replacement
        return { type: 'replace', text: newStr.slice(i), index: i };
    }
}

// Modify the input event listener
document.querySelector('.chat-container').addEventListener('input', (e) => {
    if (e.target.classList.contains('chat-input') && e.target.closest('.chat-row').dataset.userId === currentUserId) {
        const currentMessage = e.target.value;
        
        // Enforce character limit
        if (currentMessage.length > MAX_MESSAGE_LENGTH) {
            e.target.value = currentMessage.slice(0, MAX_MESSAGE_LENGTH);
            return;
        }

        const diff = getDiff(lastSentMessage, currentMessage);
        
        if (diff) {
            socket.emit('chat update', { diff, index: diff.index });
            lastSentMessage = currentMessage;
        }

        // Handle typing indicator
        clearTimeout(typingTimeout);
        socket.emit('typing', { isTyping: true });
        typingTimeout = setTimeout(() => {
            socket.emit('typing', { isTyping: false });
        }, 1000);
    }
});

// Event listener for leaving the room
document.querySelector('.leave-room').addEventListener('click', () => {
    const roomData = JSON.parse(sessionStorage.getItem('roomData'));
    socket.emit('leave room');
    // Don't remove roomData from sessionStorage
    // Instead, update it to remove room-specific information
    sessionStorage.setItem('roomData', JSON.stringify({
        username: roomData.username,
        location: roomData.location,
        userId: roomData.userId
    }));
    window.location.href = '/index.html';
});

// Date and Time functionality
const dateTimeElement = document.querySelector('#dateTime');

function updateDateTime() {
  const now = new Date();
  const dateOptions = { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric'
  };
  const timeOptions = {
    hour: '2-digit', 
    minute: '2-digit', 
    hour12: true 
  };
  
  const formattedDate = now.toLocaleDateString('en-US', dateOptions);
  const formattedTime = now.toLocaleTimeString('en-US', timeOptions);
  
  dateTimeElement.querySelector('.date').textContent = formattedDate;
  dateTimeElement.querySelector('.time').textContent = formattedTime;
}

// Update date and time every second
setInterval(updateDateTime, 1000);

// Initialize the room and date/time when the page loads
window.addEventListener('load', () => {
    initRoom();
    updateDateTime();
    adjustLayout(); // Call adjustLayout after initializing the room
});

// Adjust layout on window resize
window.addEventListener('resize', adjustLayout);