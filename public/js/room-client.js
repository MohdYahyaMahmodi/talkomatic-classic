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
let chatInput = null;
const mutedUsers = new Set();

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

function updateVotesUI(votes) {
    document.querySelectorAll('.chat-row').forEach(row => {
        const userId = row.dataset.userId;
        const voteButton = row.querySelector('.vote-button');

        if (voteButton) {
            const votesAgainstUser = Object.values(votes).filter(v => v === userId).length;
            voteButton.innerHTML = `👎 ${votesAgainstUser}`;

            if (votes[currentUserId] === userId) {
                voteButton.classList.add('voted');
            } else {
                voteButton.classList.remove('voted');
            }
        }
    });
}

function updateCurrentMessages(messages) {
    Object.keys(messages).forEach(userId => {
        const chatInput = document.querySelector(`.chat-row[data-user-id="${userId}"] .chat-input`);
        if (chatInput) {
            chatInput.value = messages[userId].slice(0, MAX_MESSAGE_LENGTH);

            // If the message is from the current user, update lastSentMessage
            if (userId === currentUserId) {
                lastSentMessage = messages[userId];
            }
        }
    });
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

socket.on('disconnect', () => {
    window.location.reload();
});

socket.on('connect_error', () => {
    window.location.reload();
});

// Also handle if the server explicitly closes
socket.on('connect_failed', () => {
    window.location.reload();
});

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

socket.on('update votes', (votes) => {
    updateVotesUI(votes);
});

socket.on('kicked', () => {
    alert('You have been removed from the room by a majority vote.');
    window.location.href = '/index.html';
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

    // Update votes
    if (data.votes) {
        updateVotesUI(data.votes);
    }

    // Update current messages
    if (data.currentMessages) {
        updateCurrentMessages(data.currentMessages);
    }

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

    // Update votes
    if (roomData.votes) {
        updateVotesUI(roomData.votes);
    }
});

/**
 * Updates the chat with new message data from a user.
 * @param {Object} data - The message data received from the server.
 */
socket.on('chat update', (data) => {
    displayChatMessage(data); // Display the received chat message
});

/**
 * Handles offensive words detected by the server.
 * @param {Object} data - Contains userId and the filteredMessage.
 */
socket.on('offensive word detected', (data) => {
    const { userId, filteredMessage } = data;

    const chatInput = document.querySelector(`.chat-row[data-user-id="${userId}"] .chat-input`);
    if (!chatInput) return;

    // Replace the chat input value with the filtered message
    chatInput.value = filteredMessage.slice(0, MAX_MESSAGE_LENGTH);

    // If it's the current user, update the last sent message
    if (userId === currentUserId) {
        lastSentMessage = filteredMessage;
    }
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

function adjustVoteButtonVisibility() {
    const userCount = document.querySelectorAll('.chat-row').length;

    document.querySelectorAll('.chat-row').forEach(row => {
        const userId = row.dataset.userId;
        const voteButton = row.querySelector('.vote-button');

        if (voteButton) {
            if (userCount >= 3 && userId !== currentUserId) {
                voteButton.style.display = 'inline-block';
            } else {
                voteButton.style.display = 'none';
            }
        }
    });
}


/**
 * Adds a user to the room UI.
 * @param {Object} user - The user data to add to the room.
 */
function addUserToRoom(user) {
    const chatContainer = document.querySelector('.chat-container');
    if (!chatContainer) return;

    const chatRow = document.createElement('div');
    chatRow.classList.add('chat-row');
    if (user.id === currentUserId) {
        chatRow.classList.add('current-user');
    }
    chatRow.dataset.userId = user.id;

    const userInfoSpan = document.createElement('span');
    userInfoSpan.classList.add('user-info');
    userInfoSpan.textContent = `${user.username} / ${user.location}`;

    // Create mute button
    const muteButton = document.createElement('button');
    muteButton.classList.add('mute-button');
    muteButton.innerHTML = '🔊';
    muteButton.style.display = 'none';

    // Add click handler for mute button
    muteButton.addEventListener('click', () => {
        if (mutedUsers.has(user.id)) {
            mutedUsers.delete(user.id);
            muteButton.innerHTML = '🔊';
            muteButton.classList.remove('muted');
            // Show current chat content
            const chatInput = chatRow.querySelector('.chat-input');
            chatInput.style.opacity = '1';
        } else {
            mutedUsers.add(user.id);
            muteButton.innerHTML = '🔇';
            muteButton.classList.add('muted');
            // Hide chat content
            const chatInput = chatRow.querySelector('.chat-input');
            chatInput.style.opacity = '0.3';
        }
    });

    // Create vote button
    const voteButton = document.createElement('button');
    voteButton.classList.add('vote-button');
    voteButton.innerHTML = '👎 0';
    voteButton.style.display = 'none';

    voteButton.addEventListener('click', () => {
        socket.emit('vote', { targetUserId: user.id });
    });

    // Add buttons to user info
    userInfoSpan.appendChild(muteButton);
    userInfoSpan.appendChild(voteButton);

    const newChatInput = document.createElement('textarea');
    newChatInput.classList.add('chat-input');
    
    if (user.id === currentUserId) {
        chatInput = newChatInput;
    } else {
        newChatInput.readOnly = true;
        // Apply muted state if user is muted
        if (mutedUsers.has(user.id)) {
            newChatInput.style.opacity = '0.3';
        }
    }

    chatRow.appendChild(userInfoSpan);
    chatRow.appendChild(newChatInput);
    chatContainer.appendChild(chatRow);
    
    adjustVoteButtonVisibility();
    adjustMuteButtonVisibility();
}

function adjustMuteButtonVisibility() {
    document.querySelectorAll('.chat-row').forEach(row => {
        const userId = row.dataset.userId;
        const muteButton = row.querySelector('.mute-button');

        if (muteButton && userId !== currentUserId) {
            muteButton.style.display = 'inline-block';
            // Restore muted state if user was previously muted
            if (mutedUsers.has(userId)) {
                muteButton.innerHTML = '🔇';
                muteButton.classList.add('muted');
                const chatInput = row.querySelector('.chat-input');
                chatInput.style.opacity = '0.3';
            }
        }
    });
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
    if (!chatContainer) return;

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

    while (chatContainer.firstChild) {
        chatContainer.removeChild(chatContainer.firstChild);
    }

    chatInput = null;

    if (roomData.users && Array.isArray(roomData.users)) {
        roomData.users.forEach(user => {
            addUserToRoom(user);
            
            if (currentInputs.has(user.id)) {
                const newInput = document.querySelector(`.chat-row[data-user-id="${user.id}"] .chat-input`);
                if (newInput) {
                    newInput.value = currentInputs.get(user.id);
                    if (user.id === focusedUserId) {
                        newInput.focus();
                    }
                }
            }
        });
    }

    adjustLayout();
    adjustVoteButtonVisibility();
    adjustMuteButtonVisibility();
    updateInviteLink();
}

/**
 * Displays a chat message in the room UI.
 * @param {Object} data - The chat message data from the server.
 */
function displayChatMessage(data) {
    // Don't update chat for muted users
    if (mutedUsers.has(data.userId)) return;

    const chatInput = document.querySelector(`.chat-row[data-user-id="${data.userId}"] .chat-input`);
    if (!chatInput) return;

    if (data.diff) {
        if (data.diff.type === 'full-replace') {
            chatInput.value = data.diff.text.slice(0, MAX_MESSAGE_LENGTH);
        } else {
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
    if (oldStr === newStr) return null; // No change

    // If the change is an addition at the end
    if (newStr.startsWith(oldStr)) {
        return { type: 'add', text: newStr.slice(oldStr.length), index: oldStr.length };
    }

    // If the change is a deletion from the end
    if (oldStr.startsWith(newStr)) {
        return { type: 'delete', count: oldStr.length - newStr.length, index: newStr.length };
    }

    // Else, treat it as a full replacement
    return { type: 'full-replace', text: newStr };
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
