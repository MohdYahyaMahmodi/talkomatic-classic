const socket = io();

let currentUsername = '';
let currentLocation = '';
let currentRoomId = '';
let currentUserId = '';
let currentRoomLayout = 'horizontal';
let lastSentMessage = '';
let currentRoomName = '';

const joinSound = document.getElementById('joinSound');
const leaveSound = document.getElementById('leaveSound');
let soundEnabled = true;

const MAX_MESSAGE_LENGTH = 5000;

function playJoinSound() {
    if (soundEnabled) {
        joinSound.play().catch(error => console.error('Error playing join sound:', error));
    }
}

function playLeaveSound() {
    if (soundEnabled) {
        leaveSound.play().catch(error => console.error('Error playing leave sound:', error));
    }
}

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

socket.on('room full', () => {
    alert('This room is full. You will be redirected to the lobby.');
    window.location.href = '/index.html';
});

socket.on('room joined', (data) => {
    console.log(`Successfully joined room:`, data);
    currentUserId = data.userId;
    currentRoomId = data.roomId;
    currentUsername = data.username;
    currentLocation = data.location;
    currentRoomLayout = data.layout || currentRoomLayout;
    currentRoomName = data.roomName;
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

socket.on('user joined', (data) => {
    console.log('User joined:', data);
    addUserToRoom(data);
    updateRoomInfo(data);
    playJoinSound();
});

socket.on('user left', (userId) => {
    console.log(`User left: ${userId}`);
    removeUserFromRoom(userId);
    playLeaveSound();
});

socket.on('room update', (roomData) => {
    console.log('Room update received:', roomData);
    currentRoomLayout = roomData.layout || currentRoomLayout;
    console.log(`Updated room layout: ${currentRoomLayout}`);
    updateRoomInfo(roomData);
    updateRoomUI(roomData);
});

socket.on('chat update', (data) => {
    console.log(`Chat update from ${data.username}:`, data.diff);
    displayChatMessage(data);
});

function updateRoomInfo(data) {
    const roomNameElement = document.querySelector('.room-name');
    const roomTypeElement = document.querySelector('.room-type');
    const roomIdElement = document.querySelector('.room-id');

    if (roomNameElement) {
        roomNameElement.textContent = `Room: ${currentRoomName || data.roomName || data.roomId}`;
    }
    if (roomTypeElement) {
        roomTypeElement.textContent = `${data.roomType || 'Public'} Room`;
    }
    if (roomIdElement) {
        roomIdElement.textContent = `Room ID: ${data.roomId || currentRoomId}`;
    }
}

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

    const userInfoSpan = document.createElement('span');
    userInfoSpan.classList.add('user-info');
    userInfoSpan.textContent = `${user.username} / ${user.location}`;

    const chatInput = document.createElement('textarea');
    chatInput.classList.add('chat-input');
    if (user.id !== currentUserId) {
        chatInput.readOnly = true;
    }

    chatRow.appendChild(userInfoSpan);
    chatRow.appendChild(chatInput);
    chatContainer.appendChild(chatRow);
}

function removeUserFromRoom(userId) {
    const chatRow = document.querySelector(`.chat-row[data-user-id="${userId}"]`);
    if (chatRow) {
        chatRow.remove();
        adjustLayout();
    }
}

function updateRoomUI(roomData) {
    const chatContainer = document.querySelector('.chat-container');
    if (!chatContainer) {
        console.error('Chat container not found');
        return;
    }

    // Store current input values and focus state
    const currentInputs = new Map();
    let focusedUserId = null;
    document.querySelectorAll('.chat-row').forEach(row => {
        const userId = row.dataset.userId;
        const input = row.querySelector('.chat-input');
        if (input) {
            currentInputs.set(userId, input.value);
            if (document.activeElement === input) {
                focusedUserId = userId;
            }
        }
    });

    // Clear existing content safely
    while (chatContainer.firstChild) {
        chatContainer.removeChild(chatContainer.firstChild);
    }

    if (roomData.users && Array.isArray(roomData.users)) {
        roomData.users.forEach(user => {
            addUserToRoom(user);
            // Restore input value if it existed
            if (currentInputs.has(user.id)) {
                const newInput = document.querySelector(`.chat-row[data-user-id="${user.id}"] .chat-input`);
                if (newInput) {
                    newInput.value = currentInputs.get(user.id);
                    // Restore focus if this was the focused input
                    if (user.id === focusedUserId) {
                        newInput.focus();
                    }
                }
            }
        });
    } else {
        console.warn('No users data available');
    }
    adjustLayout();
    updateInviteLink();
}

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

function isMobile() {
    return window.innerWidth <= 768; // Adjust threshold as needed
}

function adjustLayout() {
    const chatContainer = document.querySelector('.chat-container');
    const chatRows = document.querySelectorAll('.chat-row');

    const effectiveLayout = isMobile() ? 'horizontal' : currentRoomLayout;
    console.log(`Adjusting layout: ${effectiveLayout}`);

    if (effectiveLayout === 'horizontal') {
        chatContainer.style.flexDirection = 'column';
        const availableHeight = window.innerHeight - chatContainer.offsetTop;
        const rowGap = 10;
        const totalGap = (chatRows.length - 1) * rowGap;
        const chatRowHeight = Math.floor((availableHeight - totalGap) / chatRows.length);

        chatRows.forEach(row => {
            row.style.height = `${chatRowHeight}px`;
            row.style.minHeight = '100px';  // Ensure a minimum height
            row.style.width = '100%';
            const userInfo = row.querySelector('.user-info');
            const chatInput = row.querySelector('.chat-input');
            const inputHeight = chatRowHeight - userInfo.offsetHeight - 2;
            chatInput.style.height = `${inputHeight}px`;
        });
    } else {
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

function handleViewportChange() {
    const viewport = document.querySelector('meta[name=viewport]');
    if (window.visualViewport) {
        if (window.visualViewport.height < window.innerHeight) {
            // Keyboard is likely open
            viewport.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1');
            document.body.style.height = `${window.visualViewport.height}px`;
        } else {
            // Keyboard is likely closed
            viewport.setAttribute('content', 'width=device-width, initial-scale=1');
            document.body.style.height = '100%';
        }
    }
    adjustLayout();
}

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

setInterval(updateDateTime, 1000);

window.addEventListener('load', () => {
    initRoom();
    updateDateTime();
    adjustLayout();
    updateInviteLink();
    document.getElementById('copyInviteLink').addEventListener('click', copyInviteLink);
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', handleViewportChange);
    }
});

window.addEventListener('resize', adjustLayout);
window.addEventListener('resize', handleViewportChange);


function generateInviteLink() {
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set('roomId', currentRoomId);
    return currentUrl.href;
}

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