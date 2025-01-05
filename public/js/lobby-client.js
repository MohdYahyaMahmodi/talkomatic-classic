// ============================================================================
// Talkomatic Lobby Client-Side Logic
// ----------------------------------------------------------------------------
// This JavaScript file handles the client-side interactions for the Talkomatic
// lobby page. It includes event listeners, DOM manipulation, and communication
// with the server using Socket.IO for real-time features like signing in, room
// creation, and joining existing chat rooms.
//
// Key Functionalities:
// - User sign-in with optional location.
// - Room creation with options for room type and layout.
// - Dynamically updating the list of rooms from the server.
// - Handling room entry, including semi-private rooms with access codes.
//
// Dependencies:
// - socket.io.js: Used for real-time communication between the client and server.
// ============================================================================

const socket = io(); // Initialize Socket.IO connection

// DOM elements
const logForm = document.getElementById('logform'); // User sign-in form
const createRoomForm = document.getElementById('lobbyForm'); // Room creation form
const roomListContainer = document.querySelector('.roomList'); // Room list container
const dynamicRoomList = document.getElementById('dynamicRoomList'); // Dynamic list of rooms
const usernameInput = logForm.querySelector('input[placeholder="Your Name"]'); // Input for username
const locationInput = logForm.querySelector('input[placeholder="Location (optional)"]'); // Optional location input
const roomNameInput = createRoomForm.querySelector('input[placeholder="Room Name"]'); // Input for room name
const goChatButton = createRoomForm.querySelector('.go-chat-button'); // Button to create and enter room
const signInButton = logForm.querySelector('button[type="submit"]'); // Sign-in button
const signInMessage = document.getElementById('signInMessage'); // Sign-in message displayed if user is not signed in
const noRoomsMessage = document.getElementById('noRoomsMessage'); // Message displayed when no rooms are available
const accessCodeInput = document.getElementById('accessCodeInput'); // Input field for semi-private room access code
const roomTypeRadios = document.querySelectorAll('input[name="roomType"]'); // Radio buttons for selecting room type

// Variables for tracking user state
let currentUsername = ''; // Store the current username
let currentLocation = ''; // Store the current location (optional)
let isSignedIn = false; // Flag to track if the user is signed in

// Constraints for input fields
const MAX_USERNAME_LENGTH = 12; // Maximum allowed characters for username
const MAX_LOCATION_LENGTH = 12; // Maximum allowed characters for location
const MAX_ROOM_NAME_LENGTH = 20; // Maximum allowed characters for room name

// ============================================================================
// Function: checkSignInStatus
// ----------------------------------------------------------------------------
// This function sends a request to the server to check if the user is already
// signed in. It is used when the page is first loaded to determine the user's
// sign-in status.
// ============================================================================
function checkSignInStatus() {
    socket.emit('check signin status');
}

// ============================================================================
// Room Type Selection: Show/Hide Access Code
// ----------------------------------------------------------------------------
// This section toggles the visibility of the access code input field based on
// the selected room type. The access code field is shown for "semi-private"
// rooms and hidden for "public" and "private" rooms.
// ============================================================================
roomTypeRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
        if (e.target.value === 'semi-private') {
            accessCodeInput.style.display = 'block';
        } else {
            accessCodeInput.style.display = 'none';
        }
    });
});

// ============================================================================
// Event Listener: Handle User Sign-in
// ----------------------------------------------------------------------------
// This event listener is triggered when the user submits the sign-in form. It
// processes the inputted username and location (optional), validates the data,
// and emits a 'join lobby' event to the server if the sign-in is successful.
// ============================================================================
logForm.addEventListener('submit', (e) => {
    e.preventDefault(); // Prevent default form submission behavior
    const newUsername = usernameInput.value.trim().slice(0, MAX_USERNAME_LENGTH); // Get and trim username
    const newLocation = locationInput.value.trim().slice(0, MAX_LOCATION_LENGTH) || 'On The Web'; // Default location if not provided

    if (newUsername) { // Proceed only if a username is provided
        if (currentUsername) {
            // Change the sign-in button text if the user is already signed in
            signInButton.textContent = 'Changed';
            setTimeout(() => {
                // Reset button text and icon after a delay
                signInButton.textContent = 'Change ';
                const img = document.createElement('img');
                img.src = 'images/icons/pencil.png';
                img.alt = 'Arrow';
                img.classList.add('arrow-icon');
                signInButton.appendChild(img);
            }, 2000);
        } else {
            // Set the button and reveal the room creation form for new sign-ins
            signInButton.textContent = 'Change ';
            const img = document.createElement('img');
            img.src = 'images/icons/pencil.png';
            img.alt = 'Arrow';
            img.classList.add('arrow-icon');
            signInButton.appendChild(img);
            createRoomForm.classList.remove('hidden'); // Show room creation form
        }
        currentUsername = newUsername; // Update username
        currentLocation = newLocation; // Update location
        isSignedIn = true; // Mark user as signed in

        socket.emit('join lobby', { username: currentUsername, location: currentLocation }); // Notify server
        showRoomList(); // Display room list after signing in
    } else {
        alert('Please enter a username.'); // Alert if no username is provided
    }
});

// ============================================================================
// Event Listener: Handle Room Creation
// ----------------------------------------------------------------------------
// This event listener is triggered when the user clicks the "Go Chat" button
// to create a new room. It gathers the room details (name, type, layout), validates
// them, and emits a 'create room' event to the server with the room information.
// ============================================================================
goChatButton.addEventListener('click', () => {
    const roomName = roomNameInput.value.trim().slice(0, MAX_ROOM_NAME_LENGTH); // Room name input
    const roomType = document.querySelector('input[name="roomType"]:checked')?.value; // Selected room type
    const roomLayout = document.querySelector('input[name="roomLayout"]:checked')?.value; // Selected room layout
    const accessCode = accessCodeInput.querySelector('input').value; // Access code for semi-private rooms

    // Validate room name, type, and layout
    if (roomName && roomType && roomLayout) {
        if (roomType === 'semi-private') {
            // Validate access code for semi-private rooms (must be 6 digits)
            if (!accessCode || accessCode.length !== 6 || !/^\d+$/.test(accessCode)) {
                alert('Please enter a valid 6-digit access code for the semi-private room.');
                return;
            }
        }
        socket.emit('create room', { name: roomName, type: roomType, layout: roomLayout, accessCode }); // Send room creation request to server
    } else {
        alert('Please fill in all room details.'); // Alert if any room detail is missing
    }
});

// ============================================================================
// Event Listener: Handle Room Entry
// ----------------------------------------------------------------------------
// This listener is triggered when the user clicks the "Enter" button to join
// a room. If the room is semi-private, the user is prompted for an access code.
// If the room is public, the user is directly allowed to join.
// ============================================================================
dynamicRoomList.addEventListener('click', (e) => {
    if (e.target.classList.contains('enter-button') && !e.target.disabled) {
        const roomElement = e.target.closest('.room');
        const roomId = roomElement.dataset.roomId; // Get room ID from element
        const roomType = roomElement.dataset.roomType; // Get room type

        if (roomType === 'semi-private') {
            promptAccessCode(roomId); // Prompt for access code for semi-private rooms
        } else {
            joinRoom(roomId); // Join room if not semi-private
        }
    }
});

// ============================================================================
// Function: promptAccessCode
// ----------------------------------------------------------------------------
// This function prompts the user for a 6-digit access code when trying to join
// a semi-private room. It then attempts to join the room if the code is valid.
// ============================================================================
function promptAccessCode(roomId) {
    const accessCode = prompt('Please enter the 6-digit access code for this room:');
    if (accessCode) {
        joinRoom(roomId, accessCode); // Join room with access code
    }
}

// ============================================================================
// Function: joinRoom
// ----------------------------------------------------------------------------
// This function emits a 'join room' event to the server, sending the room ID
// and optional access code if required for semi-private rooms.
// ============================================================================
function joinRoom(roomId, accessCode = null) {
    const data = { roomId, accessCode };
    socket.emit('join room', data); // Notify server to join room
}

// ============================================================================
// Socket.IO Event Handlers
// ----------------------------------------------------------------------------
// These event handlers listen for server responses and updates, including
// sign-in status, room creation, room joining, and lobby updates.
// ============================================================================

socket.on('access code required', () => {
    const roomId = new URLSearchParams(window.location.search).get('roomId');
    promptAccessCode(roomId); // Prompt for access code if required
});

socket.on('room joined', (data) => {
    window.location.href = `/room.html?roomId=${data.roomId}`; // Redirect to room page
});

socket.on('signin status', (data) => {
    if (data.isSignedIn) {
        // If signed in, pre-fill user data and show room list
        currentUsername = data.username;
        currentLocation = data.location;
        currentUserId = data.userId;
        isSignedIn = true;
        usernameInput.value = currentUsername;
        locationInput.value = currentLocation;

        // Update sign-in button with "Change" option
        signInButton.textContent = 'Change ';
        const img = document.createElement('img');
        img.src = 'images/icons/pencil.png';
        img.alt = 'Arrow';
        img.classList.add('arrow-icon');
        signInButton.appendChild(img);
        createRoomForm.classList.remove('hidden'); // Show room creation form
        showRoomList(); // Show list of rooms
    } else {
        signInMessage.style.display = 'block'; // Display sign-in prompt
        roomListContainer.style.display = 'none'; // Hide room list
    }
});

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

socket.on('lobby update', (rooms) => {
    updateLobby(rooms); // Update the room list in the lobby
});

socket.on('room created', (roomId) => {
    window.location.href = `/room.html?roomId=${roomId}`; // Redirect to new room
});

socket.on('error', (error) => {
    alert(`An error occurred: ${error}`); // Show error message
});

// ============================================================================
// Function: createRoomElement
// ----------------------------------------------------------------------------
// This function dynamically creates a room element to display in the room list.
// It generates the room's name, details, and user list, along with an "Enter"
// button that allows users to join the room.
// ============================================================================
function createRoomElement(room) {
    const roomElement = document.createElement('div');
    roomElement.classList.add('room');
    roomElement.dataset.roomId = room.id;
    roomElement.dataset.roomType = room.type;

    const enterButton = document.createElement('button');
    enterButton.classList.add('enter-button');

    // Disable "Enter" button if the room is full
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

    // Add user details for each user in the room
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

    return roomElement; // Return the complete room element
}

// ============================================================================
// Function: getRoomTypeDisplay
// ----------------------------------------------------------------------------
// This helper function returns a display-friendly name for the room type. It
// converts internal room types ("public", "semi-private", "private") into more
// readable labels for the user interface.
// ============================================================================
function getRoomTypeDisplay(type) {
    switch (type) {
        case 'public': return 'Public';
        case 'semi-private': return 'Semi-Private';
        case 'private': return 'Private';
        default: return type;
    }
}

// ============================================================================
// Function: updateLobby
// ----------------------------------------------------------------------------
// This function updates the dynamic room list in the lobby with the available
// public rooms. It hides the room list if there are no public rooms available.
// ============================================================================
function updateLobby(rooms) {
    dynamicRoomList.innerHTML = ''; // Clear the room list

    const publicRooms = rooms.filter(room => room.type !== 'private'); // Filter out private rooms

    if (publicRooms.length === 0) {
        noRoomsMessage.style.display = 'block'; // Show "no rooms" message
        dynamicRoomList.style.display = 'none'; // Hide room list
    } else {
        noRoomsMessage.style.display = 'none'; // Hide "no rooms" message
        dynamicRoomList.style.display = 'block'; // Show room list

        publicRooms.forEach((room) => {
            const roomElement = createRoomElement(room); // Create room element
            dynamicRoomList.appendChild(roomElement); // Append room to list
        });
    }
}

// ============================================================================
// Function: showRoomList
// ----------------------------------------------------------------------------
// This function hides the sign-in message and displays the list of rooms once
// the user has signed in. It requests the list of rooms from the server.
// ============================================================================
function showRoomList() {
    signInMessage.style.display = 'none'; // Hide sign-in message
    roomListContainer.style.display = 'block'; // Show room list
    socket.emit('get rooms'); // Request room list from server
}

// ============================================================================
// Function: initLobby
// ----------------------------------------------------------------------------
// This function initializes the lobby page when it is first loaded. It sets
// default values for the room type and layout radio buttons and checks the
// user's sign-in status with the server.
// ============================================================================
function initLobby() {
    document.querySelector('input[name="roomType"][value="public"]').checked = true; // Default to public room
    document.querySelector('input[name="roomLayout"][value="horizontal"]').checked = true; // Default to horizontal layout

    socket.emit('check signin status'); // Check if user is already signed in
}

// Event listener for page load
window.addEventListener('load', () => {
    initLobby(); // Initialize lobby on page load
});

// Socket.IO event listener for receiving the initial room list from the server
socket.on('initial rooms', (rooms) => {
    updateLobby(rooms); // Update room list with initial rooms
});
