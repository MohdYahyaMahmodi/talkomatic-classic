// ============================================================================
// Talkomatic Room Client-Side Logic
// ----------------------------------------------------------------------------
// This JavaScript file handles the client-side logic for the Talkomatic room
// interface. It includes event listeners for joining and leaving rooms, 
// sending and receiving chat messages, and updating the UI based on room data 
// and real-time updates from the server.
//
// Key Functionalities:
// - Joining and leaving rooms.
// - Displaying and updating chat messages.
// - Handling real-time updates via Socket.IO.
// - Managing room layout and invite link generation.
//
// Dependencies:
// - socket.io.js: Used for real-time communication between the client and server.
// ============================================================================

const socket = io(); // Initialize Socket.IO connection

// Variables to store current room, user, and message information
let currentUsername = '';
let currentLocation = '';
let currentRoomId = '';
let currentUserId = '';
let currentRoomLayout = 'horizontal'; // Default room layout
let lastSentMessage = ''; // Last message sent by the current user
let currentRoomName = '';

// DOM elements for sound effects
const joinSound = document.getElementById('joinSound'); // Sound for user joining
const leaveSound = document.getElementById('leaveSound'); // Sound for user leaving
let soundEnabled = true; // Flag to control sound effects

// Maximum allowed length for chat messages
const MAX_MESSAGE_LENGTH = 5000;

/**
 * Plays the join sound if sound is enabled.
 */
function playJoinSound() {
    if (soundEnabled) {
        joinSound.play().catch(error => console.error('Error playing join sound:', error));
    }
}

/**
 * Plays the leave sound if sound is enabled.
 */
function playLeaveSound() {
    if (soundEnabled) {
        leaveSound.play().catch(error => console.error('Error playing leave sound:', error));
    }
}

/**
 * Initializes the room by extracting the room ID from the URL and joining the room.
 * If no room ID is found, redirects to the lobby.
 */
async function initRoom() {
    const urlParams = new URLSearchParams(window.location.search);
    const roomIdFromUrl = urlParams.get('roomId');

    if (roomIdFromUrl) {
        currentRoomId = roomIdFromUrl;
        joinRoom(roomIdFromUrl);
    } else {
        console.error('No room ID provided in URL');
        alert('No room ID provided. Redirecting to lobby.');
        window.location.href = '/index.html'; // Redirect to lobby if no room ID
        return;
    }
}

/**
 * Joins a room by emitting a 'join room' event to the server.
 * @param {string} roomId - The ID of the room to join.
 * @param {string|null} accessCode - Optional access code for semi-private rooms.
 */
function joinRoom(roomId, accessCode = null) {
    const data = { roomId, accessCode };
    socket.emit('join room', data); // Emit join room event to server
}

// ============================================================================
// Socket.IO Event Handlers
// ----------------------------------------------------------------------------
// The following handlers respond to events emitted by the server, such as
// access code prompts, room joins, user joins/leaves, room updates, and chat
// updates.
// ============================================================================

/**
 * Prompts the user for an access code if required by the room.
 */
socket.on('access code required', () => {
    const accessCode = prompt('Please enter the 6-digit access code for this room:');
    if (accessCode) {
        if (accessCode.length !== 6 || !/^\d+$/.test(accessCode)) {
            alert('Invalid access code. Please enter a 6-digit number.');
            return;
        }
        joinRoom(currentRoomId, accessCode); // Join room with provided access code
    } else {
        alert('Access code is required. Redirecting to lobby.');
        window.location.href = '/index.html'; // Redirect to lobby if no code provided
    }
});

/**
 * Notifies the user that the room is full and redirects to the lobby.
 */
socket.on('room full', () => {
    alert('This room is full. You will be redirected to the lobby.');
    window.location.href = '/index.html'; // Redirect to lobby if room is full
});

/**
 * Handles successful room join and updates local room and user data.
 * @param {Object} data - The room and user data received from the server.
 */
socket.on('room joined', (data) => {
    currentUserId = data.userId;
    currentRoomId = data.roomId;
    currentUsername = data.username;
    currentLocation = data.location;
    currentRoomLayout = data.layout || currentRoomLayout; // Use layout from server if provided
    currentRoomName = data.roomName;
    updateRoomInfo(data); // Update room info on UI
    updateRoomUI(data); // Update room layout on UI
    updateInviteLink(); // Update the invite link
});

/**
 * Alerts the user if the room does not exist and redirects to the lobby.
 */
socket.on('room not found', () => {
    alert('The room you are trying to join does not exist or has been deleted due to inactivity. You will be redirected to the lobby.');
    window.location.href = '/index.html'; // Redirect to lobby if room not found
});

/**
 * Adds a new user to the room UI when they join.
 * @param {Object} data - The data of the user who joined.
 */
socket.on('user joined', (data) => {
    addUserToRoom(data); // Add the user to the room UI
    updateRoomInfo(data); // Update room info with new user
    playJoinSound(); // Play the join sound
});

/**
 * Removes a user from the room UI when they leave.
 * @param {string} userId - The ID of the user who left the room.
 */
socket.on('user left', (userId) => {
    removeUserFromRoom(userId); // Remove the user from the room UI
    playLeaveSound(); // Play the leave sound
});

/**
 * Updates the room UI when the room data changes (e.g., layout, users).
 * @param {Object} roomData - The updated room data from the server.
 */
socket.on('room update', (roomData) => {
    currentRoomLayout = roomData.layout || currentRoomLayout; // Update room layout if provided
    updateRoomInfo(roomData); // Update room info on UI
    updateRoomUI(roomData); // Update room layout on UI
});

/**
 * Updates the chat with new message data from a user.
 * @param {Object} data - The message data received from the server.
 */
socket.on('chat update', (data) => {
    displayChatMessage(data); // Display the received chat message
});

// ============================================================================
// Room and Chat UI Updates
// ----------------------------------------------------------------------------
// These functions handle updating the room information, adding/removing users,
// displaying chat messages, and adjusting the layout of the room UI.
// ============================================================================

/**
 * Updates the room information displayed in the UI.
 * @param {Object} data - The room and user data.
 */
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

/**
 * Adds a user to the room UI.
 * @param {Object} user - The user data to add to the room.
 */
function addUserToRoom(user) {
    const chatContainer = document.querySelector('.chat-container');
    if (!chatContainer) {
        console.error('Chat container not found');
        return;
    }

    const chatRow = document.createElement('div');
    chatRow.classList.add('chat-row');
    if (user.id === currentUserId) {
        chatRow.classList.add('current-user'); // Highlight the current user's row
    }
    chatRow.dataset.userId = user.id;

    const userInfoSpan = document.createElement('span');
    userInfoSpan.classList.add('user-info');
    userInfoSpan.textContent = `${user.username} / ${user.location}`;

    const chatInput = document.createElement('textarea');
    chatInput.classList.add('chat-input');
    if (user.id !== currentUserId) {
        chatInput.readOnly = true; // Make input read-only for other users
    }

    chatRow.appendChild(userInfoSpan);
    chatRow.appendChild(chatInput);
    chatContainer.appendChild(chatRow);
}

/**
 * Removes a user from the room UI.
 * @param {string} userId - The ID of the user to remove.
 */
function removeUserFromRoom(userId) {
    const chatRow = document.querySelector(`.chat-row[data-user-id="${userId}"]`);
    if (chatRow) {
        chatRow.remove(); // Remove the chat row for the user
        adjustLayout(); // Adjust the room layout after removing a user
    }
}

/**
 * Updates the room layout and adjusts the UI based on the current room data.
 * @param {Object} roomData - The room data from the server.
 */
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
            currentInputs.set(userId, input.value); // Save current input values
            if (document.activeElement === input) {
                focusedUserId = userId; // Track focused input
            }
        }
    });

    // Clear existing chat rows
    while (chatContainer.firstChild) {
        chatContainer.removeChild(chatContainer.firstChild);
    }

    // Recreate chat rows for each user in the room
    if (roomData.users && Array.isArray(roomData.users)) {
        roomData.users.forEach(user => {
            addUserToRoom(user); // Add the user to the UI
            // Restore input value and focus
            if (currentInputs.has(user.id)) {
                const newInput = document.querySelector(`.chat-row[data-user-id="${user.id}"] .chat-input`);
                if (newInput) {
                    newInput.value = currentInputs.get(user.id); // Restore input
                    if (user.id === focusedUserId) {
                        newInput.focus(); // Restore focus
                    }
                }
            }
        });
    } else {
        console.warn('No users data available');
    }
    adjustLayout(); // Adjust the layout after updating the room
    updateInviteLink(); // Update the invite link
}

/**
 * Displays a chat message in the room UI.
 * @param {Object} data - The chat message data from the server.
 */
function displayChatMessage(data) {
    const chatInput = document.querySelector(`.chat-row[data-user-id="${data.userId}"] .chat-input`);
    if (!chatInput) return;

    if (data.diff) {
        if (data.diff.type === 'full-replace') {
            // Handle complete text replacement
            chatInput.value = data.diff.text.slice(0, MAX_MESSAGE_LENGTH);
        } else {
            // Handle incremental changes
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
        }
    } else {
        chatInput.value = data.message.slice(0, MAX_MESSAGE_LENGTH);
    }
}

/**
 * Checks if the current device is mobile.
 * @returns {boolean} True if the screen width is less than or equal to 768px.
 */
function isMobile() {
    return window.innerWidth <= 768; // Adjust threshold for mobile devices
}

/**
 * Adjusts the layout of the chat room based on the current layout (horizontal or vertical).
 */
function adjustLayout() {
    const chatContainer = document.querySelector('.chat-container');
    const chatRows = document.querySelectorAll('.chat-row');

    const effectiveLayout = isMobile() ? 'horizontal' : currentRoomLayout; // Use horizontal layout on mobile

    if (effectiveLayout === 'horizontal') {
        chatContainer.style.flexDirection = 'column'; // Stack rows vertically
        const availableHeight = window.innerHeight - chatContainer.offsetTop;
        const rowGap = 10;
        const totalGap = (chatRows.length - 1) * rowGap;
        const chatRowHeight = Math.floor((availableHeight - totalGap) / chatRows.length);

        chatRows.forEach(row => {
            row.style.height = `${chatRowHeight}px`;
            row.style.minHeight = '100px'; // Ensure minimum height
            row.style.width = '100%';
            const userInfo = row.querySelector('.user-info');
            const chatInput = row.querySelector('.chat-input');
            const inputHeight = chatRowHeight - userInfo.offsetHeight - 2;
            chatInput.style.height = `${inputHeight}px`;
        });
    } else {
        chatContainer.style.flexDirection = 'row'; // Arrange rows side by side
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

/**
 * Handles viewport changes, typically triggered when the keyboard is opened/closed on mobile devices.
 */
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
    adjustLayout(); // Adjust layout after viewport change
}

/**
 * Calculates the difference (diff) between the old and new message strings.
 * @param {string} oldStr - The previous message string.
 * @param {string} newStr - The updated message string.
 * @returns {Object|null} The diff object (add, delete, or replace) or null if no change.
 */
function getDiff(oldStr, newStr) {
    // If the strings are completely different or there's a large change,
    // treat it as a full replacement
    if (oldStr.length === 0 || newStr.length === 0 || 
        Math.abs(oldStr.length - newStr.length) > Math.min(oldStr.length, newStr.length) / 2) {
        return { type: 'full-replace', text: newStr };
    }
    
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
        // Incremental replacement
        return { type: 'replace', text: newStr.slice(i), index: i };
    }
}

// ============================================================================
// Event Listeners for Chat and Room Controls
// ----------------------------------------------------------------------------
// These event listeners handle sending chat updates, leaving the room, and
// copying the invite link.
// ============================================================================

/**
 * Listens for input in the chat and sends updates to the server.
 */
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
            socket.emit('chat update', { diff, index: diff.index }); // Send chat update to server
            lastSentMessage = currentMessage; // Update last sent message
        }
    }
});

/**
 * Listens for the "leave room" button click and emits a 'leave room' event.
 */
document.querySelector('.leave-room').addEventListener('click', () => {
    socket.emit('leave room');
    window.location.href = '/index.html'; // Redirect to lobby after leaving room
});

// ============================================================================
// Date and Time Display
// ----------------------------------------------------------------------------
// This section handles updating the date and time displayed in the room.
// ============================================================================

const dateTimeElement = document.querySelector('#dateTime');

/**
 * Updates the date and time display every second.
 */
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

// Update the date and time every second
setInterval(updateDateTime, 1000);

// ============================================================================
// Page Initialization and Event Listeners
// ----------------------------------------------------------------------------
// This section initializes the room page on load and adds listeners for viewport
// changes and window resizing.
// ============================================================================

window.addEventListener('load', () => {
    initRoom(); // Initialize the room
    updateDateTime(); // Update the date and time display
    adjustLayout(); // Adjust the layout based on current screen size
    updateInviteLink(); // Update the invite link
    document.getElementById('copyInviteLink').addEventListener('click', copyInviteLink); // Set up invite link copy functionality
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', handleViewportChange); // Listen for viewport changes
    }
});

window.addEventListener('resize', adjustLayout); // Listen for window resizing
window.addEventListener('resize', handleViewportChange); // Listen for viewport resizing

// ============================================================================
// Invite Link Generation and Copying
// ----------------------------------------------------------------------------
// This section generates the invite link for the current room and allows the
// user to copy it to the clipboard.
// ============================================================================

/**
 * Generates the invite link for the current room.
 * @returns {string} The invite link URL.
 */
function generateInviteLink() {
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set('roomId', currentRoomId);
    return currentUrl.href;
}

/**
 * Updates the invite link displayed on the page.
 */
function updateInviteLink() {
    const inviteLinkElement = document.getElementById('inviteLink');
    const inviteLink = generateInviteLink();
    inviteLinkElement.textContent = inviteLink;
    inviteLinkElement.href = inviteLink;
    
    // Ensure the copy button is visible
    const copyButton = document.getElementById('copyInviteLink');
    copyButton.style.display = 'inline-block';
}

/**
 * Copies the invite link to the clipboard.
 */
function copyInviteLink() {
    const inviteLink = generateInviteLink();
    navigator.clipboard.writeText(inviteLink).then(() => {
        alert('Invite link copied to clipboard!');
    }).catch(err => {
        console.error('Failed to copy invite link: ', err);
    });
}
