const socket = io();

// DOM elements
const dateTimeElement = document.querySelector('#dateTime');
const chatContainer = document.querySelector('.chat-container');
const topNavbar = document.querySelector('.top-navbar');
const secondNavbar = document.querySelector('.second-navbar');
const inviteSection = document.querySelector('.invite-section');
const leaveRoomButton = document.querySelector('.leave-room');
const roomNameElement = document.querySelector('.room-name');
const roomTypeElement = document.querySelector('.room-type');
const roomIdElement = document.querySelector('.room-id');

let currentUser = null;

/**
 * Updates the date and time display in the navbar.
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

/**
 * Adjusts the layout of the chat container and chat rows based on available screen space.
 */
function adjustLayout() {
  const availableHeight = window.innerHeight - 
                          topNavbar.offsetHeight - 
                          secondNavbar.offsetHeight - 
                          inviteSection.offsetHeight;
  
  chatContainer.style.height = `${availableHeight}px`;
  
  const chatRows = document.querySelectorAll('.chat-row');
  const rowGap = 10; // Gap between chat rows in pixels
  const totalGap = (chatRows.length - 1) * rowGap;
  const chatRowHeight = Math.floor((availableHeight - totalGap) / chatRows.length);
  
  chatRows.forEach(row => {
    row.style.height = `${chatRowHeight}px`;
    const userInfo = row.querySelector('.user-info');
    const chatInput = row.querySelector('.chat-input');
    const inputHeight = chatRowHeight - userInfo.offsetHeight - 2; // 2px for borders
    chatInput.style.height = `${inputHeight}px`;
  });
}

/**
 * Creates a chat row for a user
 */
function createChatRow(user) {
  const chatRow = document.createElement('div');
  chatRow.classList.add('chat-row');
  chatRow.dataset.userId = user.id;
  chatRow.innerHTML = `
    <span class="user-info">${user.username} / ${user.location}</span>
    <textarea class="chat-input" ${user.id !== currentUser.id ? 'readonly' : ''}></textarea>
  `;
  
  const chatInput = chatRow.querySelector('.chat-input');
  chatInput.addEventListener('input', (e) => {
    socket.emit('typing', { roomId: currentUser.roomId, text: e.target.value });
  });

  return chatRow;
}

/**
 * Updates the room information
 */
function updateRoomInfo(room) {
  roomNameElement.textContent = room.name;
  roomTypeElement.textContent = `${room.type} Room`;
  roomIdElement.textContent = `Room ID: ${room.id}`;
}

/**
 * Updates the chat container with the current users
 */
function updateChatContainer(users) {
  chatContainer.innerHTML = '';
  users.forEach(user => {
    const chatRow = createChatRow(user);
    chatContainer.appendChild(chatRow);
  });
  adjustLayout();
}

/**
 * Initializes the page by setting up initial states and event listeners.
 */
function initializePage() {
  updateDateTime();
  setInterval(updateDateTime, 1000);
  window.addEventListener('resize', adjustLayout);

  // Get room info from URL
  const urlParams = new URLSearchParams(window.location.search);
  const roomId = urlParams.get('roomId');
  const username = urlParams.get('username');
  const location = urlParams.get('location');

  currentUser = { id: socket.id, username, location, roomId };

  // Join room
  socket.emit('join room', { roomId, username, location });

  // Handle room update
  socket.on('room update', (room) => {
    updateRoomInfo(room);
    updateChatContainer(room.users);
  });

  // Handle user typing
  socket.on('user typing', ({ userId, text }) => {
    const chatRow = document.querySelector(`.chat-row[data-user-id="${userId}"]`);
    if (chatRow) {
      const chatInput = chatRow.querySelector('.chat-input');
      chatInput.value = text;
    }
  });

  // Handle leave room
  leaveRoomButton.addEventListener('click', () => {
    socket.emit('leave room', currentUser.roomId);
    window.location.href = '/index.html';
  });
}

// Initialize the page when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', initializePage);