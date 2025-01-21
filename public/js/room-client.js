// ============================================================================
// room-client.js
// ============================================================================

const socket = io(); // Initialize Socket.IO connection

let currentUsername = '';
let currentLocation = '';
let currentRoomId = '';
let currentUserId = '';
let currentRoomLayout = 'horizontal'; 
let lastSentMessage = '';
let currentRoomName = '';
let chatInput = null;
const mutedUsers = new Set();
const storedMessagesForMutedUsers = new Map();

const joinSound = document.getElementById('joinSound');
const leaveSound = document.getElementById('leaveSound');
let soundEnabled = true;

const muteToggleButton = document.getElementById('muteToggle');
const muteIcon = document.getElementById('muteIcon');

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

function toggleMute() {
  soundEnabled = !soundEnabled;
  localStorage.setItem('soundEnabled', JSON.stringify(soundEnabled));
  updateMuteIcon();
}

function updateMuteIcon() {
  if (soundEnabled) {
    muteIcon.src = 'images/icons/sound-on.svg';
    muteIcon.alt = 'Sound On';
  } else {
    muteIcon.src = 'images/icons/sound-off.svg';
    muteIcon.alt = 'Sound Off';
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
      if (userId === currentUserId) {
        lastSentMessage = messages[userId];
      }
    }
  });
}

async function initRoom() {
  const urlParams = new URLSearchParams(window.location.search);
  const roomIdFromUrl = urlParams.get('roomId');

  if (roomIdFromUrl) {
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

socket.on('update votes', (votes) => {
  updateVotesUI(votes);
});

socket.on('kicked', () => {
  alert('You have been removed from the room by a majority vote.');
  window.location.href = '/index.html';
});

socket.on('room full', () => {
  alert('This room is full. You will be redirected to the lobby.');
  window.location.href = '/index.html';
});

socket.on('room joined', (data) => {
  currentUserId = data.userId;
  currentRoomId = data.roomId;
  currentUsername = data.username;
  currentLocation = data.location;
  currentRoomLayout = data.layout || currentRoomLayout;
  currentRoomName = data.roomName;

  updateRoomInfo(data);
  updateRoomUI(data);

  if (data.votes) {
    updateVotesUI(data.votes);
  }
  if (data.currentMessages) {
    updateCurrentMessages(data.currentMessages);
  }
  updateInviteLink();
});

socket.on('room not found', () => {
  alert('The room you are trying to join does not exist or has been deleted. Redirecting to lobby.');
  window.location.href = '/index.html';
});

socket.on('user joined', (data) => {
  addUserToRoom(data);
  updateRoomInfo(data);
  playJoinSound();
});

socket.on('user left', (userId) => {
  removeUserFromRoom(userId);
  playLeaveSound();
});

socket.on('room update', (roomData) => {
  currentRoomLayout = roomData.layout || currentRoomLayout;
  updateRoomInfo(roomData);
  updateRoomUI(roomData);
  if (roomData.votes) {
    updateVotesUI(roomData.votes);
  }
});

socket.on('chat update', (data) => {
  displayChatMessage(data);
});

socket.on('offensive word detected', (data) => {
  const { userId, filteredMessage } = data;
  const chatInput = document.querySelector(`.chat-row[data-user-id="${userId}"] .chat-input`);
  if (!chatInput) return;
  chatInput.value = filteredMessage.slice(0, MAX_MESSAGE_LENGTH);
  if (userId === currentUserId) {
    lastSentMessage = filteredMessage;
  }
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

  // Mute button
  const muteButton = document.createElement('button');
  muteButton.classList.add('mute-button');
  muteButton.innerHTML = '🔊';
  muteButton.style.display = 'none';
  muteButton.addEventListener('click', () => {
    if (mutedUsers.has(user.id)) {
      // Unmute
      mutedUsers.delete(user.id);
      muteButton.innerHTML = '🔊';
      muteButton.classList.remove('muted');
      const chatInput = chatRow.querySelector('.chat-input');
      chatInput.style.opacity = '1';
      const queued = storedMessagesForMutedUsers.get(user.id);
      if (queued && queued.length) {
        queued.forEach(data => displayChatMessage(data));
        storedMessagesForMutedUsers.delete(user.id);
      }
    } else {
      // Mute
      mutedUsers.add(user.id);
      muteButton.innerHTML = '🔇';
      muteButton.classList.add('muted');
      const chatInput = chatRow.querySelector('.chat-input');
      chatInput.style.opacity = '0.3';
    }
  });

  // Vote button
  const voteButton = document.createElement('button');
  voteButton.classList.add('vote-button');
  voteButton.innerHTML = '👎 0';
  voteButton.style.display = 'none';
  voteButton.addEventListener('click', () => {
    socket.emit('vote', { targetUserId: user.id });
  });

  userInfoSpan.appendChild(muteButton);
  userInfoSpan.appendChild(voteButton);

  const newChatInput = document.createElement('textarea');
  newChatInput.classList.add('chat-input');
  if (user.id === currentUserId) {
    chatInput = newChatInput;
  } else {
    newChatInput.readOnly = true;
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
      if (mutedUsers.has(userId)) {
        muteButton.innerHTML = '🔇';
        muteButton.classList.add('muted');
        const chatInput = row.querySelector('.chat-input');
        chatInput.style.opacity = '0.3';
      }
    }
  });
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

function displayChatMessage(data) {
  if (mutedUsers.has(data.userId)) {
    if (!storedMessagesForMutedUsers.has(data.userId)) {
      storedMessagesForMutedUsers.set(data.userId, []);
    }
    storedMessagesForMutedUsers.get(data.userId).push(data);
    return;
  }

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

function isMobile() {
  return window.innerWidth <= 768;
}

function adjustLayout() {
  const chatContainer = document.querySelector('.chat-container');
  const chatRows = document.querySelectorAll('.chat-row');

  const effectiveLayout = isMobile() ? 'horizontal' : currentRoomLayout;

  if (effectiveLayout === 'horizontal') {
    chatContainer.style.flexDirection = 'column';
    const availableHeight = window.innerHeight - chatContainer.offsetTop;
    const rowGap = 10;
    const totalGap = (chatRows.length - 1) * rowGap;
    const chatRowHeight = Math.floor((availableHeight - totalGap) / chatRows.length);

    chatRows.forEach(row => {
      row.style.height = `${chatRowHeight}px`;
      row.style.minHeight = '100px';
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
      viewport.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1');
      document.body.style.height = `${window.visualViewport.height}px`;
    } else {
      viewport.setAttribute('content', 'width=device-width, initial-scale=1');
      document.body.style.height = '100%';
    }
  }
  adjustLayout();
}

function getDiff(oldStr, newStr) {
  if (oldStr === newStr) return null;
  if (newStr.startsWith(oldStr)) {
    return { type: 'add', text: newStr.slice(oldStr.length), index: oldStr.length };
  }
  if (oldStr.startsWith(newStr)) {
    return { type: 'delete', count: oldStr.length - newStr.length, index: newStr.length };
  }
  return { type: 'full-replace', text: newStr };
}

document.querySelector('.chat-container').addEventListener('input', (e) => {
  if (e.target.classList.contains('chat-input') &&
      e.target.closest('.chat-row').dataset.userId === currentUserId) {
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

document.querySelector('.leave-room').addEventListener('click', () => {
  socket.emit('leave room');
  window.location.href = '/index.html';
});

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

  const savedMuteState = localStorage.getItem('soundEnabled');
  if (savedMuteState !== null) {
    soundEnabled = JSON.parse(savedMuteState);
    updateMuteIcon();
  }
  muteToggleButton.addEventListener('click', toggleMute);

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
