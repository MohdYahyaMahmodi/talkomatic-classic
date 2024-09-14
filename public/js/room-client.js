const socket = io();

let currentUsername = '';
let currentLocation = '';
let currentRoomId = '';
let currentUserId = '';
let currentRoomLayout = 'horizontal';
let lastSentMessage = '';
let currentRoomName = ''; // Add this line to store the room name

const joinSound = document.getElementById('joinSound');
const leaveSound = document.getElementById('leaveSound');
let soundEnabled = true;

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
    return new Promise((resolve) => {
        socket.emit('get room info');
        socket.once('room info', (roomData) => {
            if (roomData) {
                currentRoomId = roomData.roomId;
                currentUsername = roomData.username;
                currentLocation = roomData.location;
                currentUserId = roomData.userId;
                currentRoomLayout = roomData.layout || 'horizontal';
                currentRoomName = roomData.roomName; // Store the room name
                resolve(roomData);
            } else {
                resolve(null);
            }
        });
    });
}

// New function to generate invite link
function generateInviteLink() {
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set('roomId', currentRoomId);
    return currentUrl.href;
}

// New function to update invite link in UI
function updateInviteLink() {
    const inviteLinkElement = document.getElementById('inviteLink');
    const inviteLink = generateInviteLink();
    inviteLinkElement.textContent = inviteLink;
    inviteLinkElement.href = inviteLink;
    
    // Ensure the copy button is visible
    const copyButton = document.getElementById('copyInviteLink');
    copyButton.style.display = 'inline-block';
}

function copyInviteLink() {
    const inviteLink = generateInviteLink();
    navigator.clipboard.writeText(inviteLink).then(() => {
        alert('Invite link copied to clipboard!');
    }).catch(err => {
        console.error('Failed to copy invite link: ', err);
    });
}

// Initialize room
async function initRoom() {
    const urlParams = new URLSearchParams(window.location.search);
    const roomIdFromUrl = urlParams.get('roomId');

    if (roomIdFromUrl) {
        console.log('Joining room from URL:', roomIdFromUrl);
        currentRoomId = roomIdFromUrl;
        joinRoom(roomIdFromUrl);
    } else {
        console.error('No room ID provided in URL');
        alert('No room ID provided. Redirecting to lobby.');
        window.location.href = '/index.html';
        return;
    }
}

function joinRoom(roomId, accessCode = null) {
    const data = { roomId, accessCode };
    socket.emit('join room', data);
}

socket.on('access code required', () => {
    const accessCode = prompt('Please enter the 6-digit access code for this room:');
    if (accessCode) {
        if (accessCode.length !== 6 || !/^\d+$/.test(accessCode)) {
            alert('Invalid access code. Please enter a 6-digit number.');
            return;
        }
        joinRoom(currentRoomId, accessCode);
    } else {
        alert('Access code is required. Redirecting to lobby.');
        window.location.href = '/index.html';
    }
});

socket.on('rejoin room', (data) => {
    console.log(`Successfully rejoined room:`, data);
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
    updateInviteLink();

    // Add this line to create chat rows for all users
    data.users.forEach(user => addUserToRoom(user));
});


// Handle successful room join
socket.on('room joined', (data) => {
    console.log(`Successfully joined room:`, data);
    currentUserId = data.userId;
    currentRoomId = data.roomId;
    currentUsername = data.username;
    currentLocation = data.location;
    currentRoomLayout = data.layout || currentRoomLayout;
    currentRoomName = data.roomName; // Store the room name when joining
    console.log(`Room layout: ${currentRoomLayout}`);
    updateRoomInfo(data);
    updateRoomUI(data);
    updateInviteLink();
});

socket.on('room not found', () => {
    console.error('Room not found');
    alert('The room you are trying to join does not exist or has been deleted due to inactivity. You will be redirected to the lobby.');
    window.location.href = '/index.html';
  });

// Handle user joined event
socket.on('user joined', (data) => {
    console.log(`User joined:`, data);
    addUserToRoom(data);
    updateRoomInfo(data);
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

// Function to update room information in the UI
function updateRoomInfo(data) {
    document.querySelector('.room-name').textContent = `Room: ${currentRoomName || data.roomName || data.roomId}`; // Use stored room name
    document.querySelector('.room-type').textContent = `${data.roomType || 'Public'} Room`;
    document.querySelector('.room-id').textContent = `Room ID: ${data.roomId || currentRoomId}`;
}

// Modify the addUserToRoom function
function addUserToRoom(user) {
    const chatContainer = document.querySelector('.chat-container');
    if (!chatContainer) {
        console.error('Chat container not found');
        return;
    }

    const chatRow = document.createElement('div');
    chatRow.classList.add('chat-row');
    if (user.id === currentUserId) {
        chatRow.classList.add('current-user');
    }
    chatRow.dataset.userId = user.id;
    chatRow.innerHTML = `
        <span class="user-info">${user.username} / ${user.location}</span>
        <textarea class="chat-input" ${user.id !== currentUserId ? 'readonly' : ''}></textarea>
    `;
    chatContainer.appendChild(chatRow);
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
    if (!chatContainer) {
        console.error('Chat container not found');
        return;
    }

    chatContainer.innerHTML = ''; // Clear existing content

    if (roomData.users && Array.isArray(roomData.users)) {
        roomData.users.forEach(user => {
            addUserToRoom(user);
        });
    } else {
        console.warn('No users data available');
    }
    adjustLayout();
    updateInviteLink(); // Ensure invite link is updated after UI changes
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
    }
});

// Event listener for leaving the room
document.querySelector('.leave-room').addEventListener('click', () => {
    socket.emit('leave room');
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
    adjustLayout();
    updateInviteLink(); // Ensure invite link is updated when the page loads

    // Add event listener for copy button
    document.getElementById('copyInviteLink').addEventListener('click', copyInviteLink);
});


// Adjust layout on window resize
window.addEventListener('resize', adjustLayout);
window.addEventListener('load', initRoom);
