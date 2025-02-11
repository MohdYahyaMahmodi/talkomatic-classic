// ============================================================================
// room-client.js
// ============================================================================
//
// Implements two separate modals:
//  1) Room Settings Modal (#roomSettingsModal) for the moderator
//     - lock/unlock room
//     - mute/unmute doorbell (only affects moderator's ding sounds)
//  2) User Settings Modal (#userSettingsModal) for per-user moderator actions
//     - kick (temp 5 min), ban (perm), mute (global), promote (transfer leader)
//

// Maximum length for messages
const MAX_MESSAGE_LENGTH = 5000;

// Basic user info
let currentUsername = '';
let currentLocation = '';
let currentRoomId = '';
let currentUserId = '';
let currentRoomLayout = 'horizontal';
let currentRoomName = '';
let currentLeaderId = null;
let roomIsLocked = false; // track whether the room is locked

// For tracking local text
let lastSentMessage = '';
let chatInput = null;

// Doorbell sound handling
let moderatorDoorbellMuted = false; // toggled by the room settings if I'm the moderator

// For moderator user settings modal
let moderatorTargetUserId = null;

// Basic sounds
const joinSound = document.getElementById('joinSound');
const leaveSound = document.getElementById('leaveSound');
let soundEnabled = true;  // personal mute toggle
const muteToggleButton = document.getElementById('muteToggle');
const roomSettingsBtn = document.getElementById('roomSettingsBtn');
const muteIcon = document.getElementById('muteIcon');

// Global variable for local (per-client) mutes:
let locallyMutedUsers = new Set();

// -------------- SOUND & MUTE (Personal) --------------
function playJoinSound() {
  // If I'm the leader and I've muted doorbell, skip
  if (currentLeaderId === currentUserId && moderatorDoorbellMuted) return;

  if (soundEnabled) {
    joinSound.play().catch((err) => console.error('Error playing join sound:', err));
  }
}
function playLeaveSound() {
  // If I'm the leader and I've muted doorbell, skip
  if (currentLeaderId === currentUserId && moderatorDoorbellMuted) return;

  if (soundEnabled) {
    leaveSound.play().catch((err) => console.error('Error playing leave sound:', err));
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

// -------------- Voting --------------
function updateVotesUI(votes) {
  document.querySelectorAll('.chat-row').forEach((row) => {
    const userId = row.dataset.userId;
    const voteButton = row.querySelector('.vote-button');
    if (voteButton) {
      const votesAgainstUser = Object.values(votes).filter((v) => v === userId).length;
      voteButton.innerHTML = `👎 ${votesAgainstUser}`;
      if (votes[currentUserId] === userId) {
        voteButton.classList.add('voted');
      } else {
        voteButton.classList.remove('voted');
      }
    }
  });
}

// -------------- initRoom --------------
async function initRoom() {
  const urlParams = new URLSearchParams(window.location.search);
  const roomIdFromUrl = urlParams.get('roomId');
  if (roomIdFromUrl) {
    currentRoomId = roomIdFromUrl;
    joinRoom(roomIdFromUrl);
  } else {
    alert('No room ID provided. Redirecting to lobby.');
    window.location.href = '/index.html';
  }
}
function joinRoom(roomId, accessCode = null) {
  socket.emit('join room', { roomId, accessCode });
}

// -------------- Socket Handlers --------------
socket.on('access code required', () => {
  const code = prompt('Enter 6-digit access code:');
  if (code) {
    if (code.length !== 6 || !/^\d+$/.test(code)) {
      alert('Invalid code. Must be 6 digits.');
      return;
    }
    joinRoom(currentRoomId, code);
  } else {
    alert('Access code required. Redirecting...');
    window.location.href = '/index.html';
  }
});

socket.on('update votes', (votes) => {
  updateVotesUI(votes);
});

socket.on('dev message', (msg) => {
  console.log(msg);
});

socket.on('kicked', (payload) => {
  alert(payload?.reason || 'You have been removed by a moderator.');
  window.location.href = '/index.html';
});

socket.on('room full', () => {
  alert('Room is full. Redirecting...');
  window.location.href = '/index.html';
});

socket.on('room joined', (data) => {
  currentUserId = data.userId;
  currentRoomId = data.roomId;
  currentUsername = data.username;
  currentLocation = data.location;
  currentRoomLayout = data.layout || currentRoomLayout;
  currentRoomName = data.roomName;
  currentLeaderId = data.leaderId || null;
  roomIsLocked = data.locked || false; // if server sends a locked flag

  updateRoomInfo(data);
  updateRoomUI(data);

  if (data.votes) updateVotesUI(data.votes);
  if (data.currentMessages) {
    Object.keys(data.currentMessages).forEach((uid) => {
      const inp = document.querySelector(`.chat-row[data-user-id="${uid}"] .chat-input`);
      if (inp) {
        inp.value = data.currentMessages[uid].slice(0, MAX_MESSAGE_LENGTH);
        if (uid === currentUserId) {
          lastSentMessage = data.currentMessages[uid];
        }
      }
    });
  }
  updateInviteLink();
  adjustNavForLeader();
});

socket.on('room not found', () => {
  alert('Room not found or deleted. Redirecting...');
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

// This is sent whenever something about the room changes:
socket.on('room update', (roomData) => {
  currentRoomLayout = roomData.layout || currentRoomLayout;
  if (roomData.leaderId) {
    currentLeaderId = roomData.leaderId;
  }
  if (typeof roomData.locked === 'boolean') {
    roomIsLocked = roomData.locked;
  }
  updateRoomInfo(roomData);
  updateRoomUI(roomData);
  if (roomData.votes) {
    updateVotesUI(roomData.votes);
  }
  adjustNavForLeader();
});

socket.on('chat update', (data) => {
  displayChatMessage(data);
});

socket.on('offensive word detected', (data) => {
  const { userId, filteredMessage } = data;
  const chatInp = document.querySelector(`.chat-row[data-user-id="${userId}"] .chat-input`);
  if (!chatInp) return;
  chatInp.value = filteredMessage.slice(0, MAX_MESSAGE_LENGTH);
  if (userId === currentUserId) {
    lastSentMessage = filteredMessage;
  }
});

socket.on('guest detection', (message) => {
  console.log(message);
});

// -------------- adjustNavForLeader --------------
function adjustNavForLeader() {
  if (currentLeaderId === currentUserId) {
    // I'm the leader => hide personal mute toggle, show roomSettingsBtn
    muteToggleButton.style.display = 'none';
    roomSettingsBtn.style.display = 'inline-block';
  } else {
    // normal user => show personal mute toggle, hide roomSettingsBtn
    muteToggleButton.style.display = 'inline-block';
    roomSettingsBtn.style.display = 'none';
  }
}

// -------------- Room Info --------------
function updateRoomInfo(data) {
  const roomNameEl = document.querySelector('.room-name');
  const roomTypeEl = document.querySelector('.room-type');
  const roomIdEl = document.querySelector('.room-id');

  if (roomNameEl) {
    roomNameEl.textContent = `Room: ${data.roomName || data.roomId}`;
  }
  if (roomTypeEl) {
    roomTypeEl.textContent = `${data.roomType || 'Public'} Room`;
  }
  if (roomIdEl) {
    roomIdEl.textContent = `Room ID: ${data.roomId || currentRoomId}`;
  }
}

// -------------- Build UI --------------
function updateRoomUI(roomData) {
  const chatContainer = document.querySelector('.chat-container');
  if (!chatContainer) return;

  // store existing text states
  const currentTextMap = new Map();
  let focusedUserId = null;

  document.querySelectorAll('.chat-row').forEach((row) => {
    const uid = row.dataset.userId;
    const txt = row.querySelector('.chat-input');
    if (txt) {
      currentTextMap.set(uid, txt.value);
      if (document.activeElement === txt) {
        focusedUserId = uid;
      }
    }
  });

  while (chatContainer.firstChild) {
    chatContainer.removeChild(chatContainer.firstChild);
  }
  chatInput = null;

  if (Array.isArray(roomData.users)) {
    roomData.users.forEach((u) => {
      addUserToRoom(u);
      if (currentTextMap.has(u.id)) {
        const inputEl = document.querySelector(`.chat-row[data-user-id="${u.id}"] .chat-input`);
        if (inputEl) {
          inputEl.value = currentTextMap.get(u.id);
          if (u.id === focusedUserId) {
            inputEl.focus();
          }
        }
      }
    });
  }
  adjustLayout();
  adjustVoteButtonVisibility();
  adjustMuteButtonVisibility();
  adjustModMenuVisibility();
  updateInviteLink();
}

// -------------- addUserToRoom --------------
function addUserToRoom(user) {
  // Check if a chat row for this user already exists.
  const existingRow = document.querySelector(`.chat-row[data-user-id="${user.id}"]`);
  if (existingRow) {
    // Update the user info (username and location)
    const userInfo = existingRow.querySelector('.user-info');
    if (userInfo) {
      userInfo.textContent = `${user.username} / ${user.location}`;
    }
    return; // no duplicate row
  }
  // Otherwise, create a new chat row.
  const container = document.querySelector('.chat-container');
  if (!container) return;

  const row = document.createElement('div');
  row.classList.add('chat-row');
  row.dataset.userId = user.id;
  if (user.id === currentUserId) {
    row.classList.add('current-user');
  }

  const userInfo = document.createElement('span');
  userInfo.classList.add('user-info');
  userInfo.textContent = `${user.username} / ${user.location}`;

  // Create the local mute button for this user (only for other users)
  const muteBtn = document.createElement('button');
  muteBtn.classList.add('mute-button');
  muteBtn.innerHTML = '🔊';
  // Initially hide; adjustMuteButtonVisibility will show it if needed.
  muteBtn.style.display = 'none';
  muteBtn.addEventListener('click', () => {
    const rowEl = muteBtn.closest('.chat-row');
    const chatInput = rowEl.querySelector('.chat-input');
    if (locallyMutedUsers.has(user.id)) {
      // Unmute: remove from set, update button icon, show chat input, remove placeholder if any.
      locallyMutedUsers.delete(user.id);
      muteBtn.innerHTML = '🔊';
      chatInput.style.display = 'block';
      const placeholder = rowEl.querySelector('.muted-placeholder');
      if (placeholder) {
        placeholder.remove();
      }
    } else {
      // Mute: add to set, update button icon, hide chat input and show a placeholder.
      locallyMutedUsers.add(user.id);
      muteBtn.innerHTML = '🔇';
      chatInput.style.display = 'none';
      if (!rowEl.querySelector('.muted-placeholder')) {
        const placeholder = document.createElement('span');
        placeholder.classList.add('muted-placeholder');
        placeholder.textContent = '[Muted]';
        rowEl.appendChild(placeholder);
      }
    }
  });
  userInfo.appendChild(muteBtn);

  // Vote button for downvoting
  const voteBtn = document.createElement('button');
  voteBtn.classList.add('vote-button');
  voteBtn.innerHTML = '👎 0';
  voteBtn.style.display = 'none';
  voteBtn.addEventListener('click', () => {
    socket.emit('vote', { targetUserId: user.id });
  });
  userInfo.appendChild(voteBtn);

  // Moderator settings (gear) button (only shown if you are the room leader)
  const modMenuBtn = document.createElement('button');
  modMenuBtn.classList.add('mod-menu-button');
  modMenuBtn.innerText = '⚙️';
  modMenuBtn.style.display = 'none';
  modMenuBtn.addEventListener('click', () => {
    openUserSettingsModal(user);
  });
  userInfo.appendChild(modMenuBtn);

  const textArea = document.createElement('textarea');
  textArea.classList.add('chat-input');
  if (user.id === currentUserId) {
    chatInput = textArea;
  } else {
    textArea.readOnly = true;
  }

  row.appendChild(userInfo);
  row.appendChild(textArea);
  container.appendChild(row);

  adjustLayout();
  adjustVoteButtonVisibility();
  adjustMuteButtonVisibility();
  adjustModMenuVisibility();
}

// -------------- removeUserFromRoom --------------
function removeUserFromRoom(userId) {
  const row = document.querySelector(`.chat-row[data-user-id="${userId}"]`);
  if (row) {
    row.remove();
  }
  adjustLayout();
}

// -------------- displayChatMessage --------------
function displayChatMessage(data) {
  const row = document.querySelector(`.chat-row[data-user-id="${data.userId}"]`);
  if (!row) return;
  const inputEl = row.querySelector('.chat-input');
  if (!inputEl) return;

  const currentText = inputEl.value;
  let newText;
  switch (data.diff.type) {
    case 'full-replace':
      newText = data.diff.text.slice(0, MAX_MESSAGE_LENGTH);
      break;
    case 'add':
      newText =
        currentText.slice(0, data.diff.index) +
        data.diff.text +
        currentText.slice(data.diff.index);
      break;
    case 'delete':
      newText =
        currentText.slice(0, data.diff.index) +
        currentText.slice(data.diff.index + data.diff.count);
      break;
    case 'replace':
      newText =
        currentText.slice(0, data.diff.index) +
        data.diff.text +
        currentText.slice(data.diff.index + data.diff.text.length);
      break;
    default:
      newText = currentText;
  }
  // Always update the underlying value (even if the user is muted)
  inputEl.value = newText.slice(0, MAX_MESSAGE_LENGTH);

  // If the user is muted locally, update the placeholder text (if present)
  if (locallyMutedUsers.has(data.userId)) {
    const placeholder = row.querySelector('.muted-placeholder');
    if (placeholder) {
      placeholder.textContent = '[Muted]';
    }
  }
}

// -------------- Modals: User Settings --------------
function openUserSettingsModal(user) {
  moderatorTargetUserId = user.id;

  const modal = document.getElementById('userSettingsModal');
  const targetNameEl = document.getElementById('moderatorTargetName');
  const targetIdEl = document.getElementById('moderatorTargetId');

  targetNameEl.textContent = user.username;
  targetIdEl.textContent = user.id;

  modal.style.display = 'block';
}
function closeUserSettingsModal() {
  const modal = document.getElementById('userSettingsModal');
  modal.style.display = 'none';
  moderatorTargetUserId = null;
}

// -------------- Modals: Room Settings --------------
function openRoomSettingsModal() {
  // Show lock/unlock status
  const lockStatusEl = document.getElementById('roomLockStatus');
  lockStatusEl.textContent = roomIsLocked
    ? 'Room is currently LOCKED'
    : 'Room is currently UNLOCKED';

  const modal = document.getElementById('roomSettingsModal');
  modal.style.display = 'block';
}
function closeRoomSettingsModal() {
  document.getElementById('roomSettingsModal').style.display = 'none';
}

// -------------- Layout & UI Adjustments --------------
function adjustVoteButtonVisibility() {
  const userCount = document.querySelectorAll('.chat-row').length;
  document.querySelectorAll('.chat-row').forEach((row) => {
    const uid = row.dataset.userId;
    const voteBtn = row.querySelector('.vote-button');
    if (voteBtn) {
      if (userCount >= 3 && uid !== currentUserId) {
        voteBtn.style.display = 'inline-block';
      } else {
        voteBtn.style.display = 'none';
      }
    }
  });
}

function adjustMuteButtonVisibility() {
  document.querySelectorAll('.chat-row').forEach((row) => {
    const uid = row.dataset.userId;
    const muteBtn = row.querySelector('.mute-button');
    if (muteBtn) {
      if (uid !== currentUserId) {
        muteBtn.style.display = 'inline-block';
      } else {
        muteBtn.style.display = 'none';
      }
    }
  });
}

function adjustModMenuVisibility() {
  document.querySelectorAll('.chat-row').forEach((row) => {
    const uid = row.dataset.userId;
    const modBtn = row.querySelector('.mod-menu-button');
    if (!modBtn) return;
    if (currentLeaderId === currentUserId && uid !== currentUserId) {
      modBtn.style.display = 'inline-block';
    } else {
      modBtn.style.display = 'none';
    }
  });
}

function adjustLayout() {
  const chatContainer = document.querySelector('.chat-container');
  const chatRows = document.querySelectorAll('.chat-row');
  if (!chatContainer) return;

  const isMobile = window.innerWidth <= 768;
  const layout = isMobile ? 'horizontal' : currentRoomLayout;

  if (layout === 'horizontal') {
    chatContainer.style.flexDirection = 'column';
    const availableHeight = window.innerHeight - chatContainer.offsetTop;
    const rowGap = 10;
    const totalGap = (chatRows.length - 1) * rowGap;
    const rowHeight = Math.floor((availableHeight - totalGap) / chatRows.length);

    chatRows.forEach((r) => {
      r.style.height = `${rowHeight}px`;
      r.style.minHeight = '100px';
      r.style.width = '100%';
      const userInfo = r.querySelector('.user-info');
      const chatInp = r.querySelector('.chat-input');
      const inH = rowHeight - userInfo.offsetHeight - 2;
      chatInp.style.height = `${inH}px`;
    });
  } else {
    chatContainer.style.flexDirection = 'row';
    const availableWidth = chatContainer.offsetWidth;
    const columnGap = 10;
    const totalGap = (chatRows.length - 1) * columnGap;
    const colWidth = Math.floor((availableWidth - totalGap) / chatRows.length);

    chatRows.forEach((r) => {
      r.style.width = `${colWidth}px`;
      r.style.height = '100%';
      const userInfo = r.querySelector('.user-info');
      const chatInp = r.querySelector('.chat-input');
      chatInp.style.height = `calc(100% - ${userInfo.offsetHeight}px - 2px)`;
    });
  }
}

// -------------- onLoad --------------
window.addEventListener('load', () => {
  initRoom();

  setInterval(updateDateTime, 1000);
  updateDateTime();
  updateInviteLink();

  const savedMuteState = localStorage.getItem('soundEnabled');
  if (savedMuteState !== null) {
    soundEnabled = JSON.parse(savedMuteState);
    updateMuteIcon();
  }

  // Personal mute toggle
  muteToggleButton.addEventListener('click', toggleMute);

  // Room settings button => open the room settings modal
  roomSettingsBtn.addEventListener('click', () => {
    openRoomSettingsModal();
  });

  // User Settings modal close
  document.getElementById('userSettingsModalClose').addEventListener('click', closeUserSettingsModal);

  // Room Settings modal close
  document.getElementById('roomSettingsModalClose').addEventListener('click', closeRoomSettingsModal);

  // Moderator actions (User Settings)
  document.getElementById('modKickBtn').addEventListener('click', () => {
    if (!moderatorTargetUserId) return;
    socket.emit('moderator action', {
      action: 'kick',
      targetUserId: moderatorTargetUserId,
    });
    closeUserSettingsModal();
  });
  document.getElementById('modBanBtn').addEventListener('click', () => {
    if (!moderatorTargetUserId) return;
    socket.emit('moderator action', {
      action: 'ban',
      targetUserId: moderatorTargetUserId,
    });
    closeUserSettingsModal();
  });
  document.getElementById('modMuteBtn').addEventListener('click', () => {
    if (!moderatorTargetUserId) return;
    socket.emit('moderator action', {
      action: 'mute',
      targetUserId: moderatorTargetUserId,
    });
    closeUserSettingsModal();
  });
  document.getElementById('modTransferBtn').addEventListener('click', () => {
    if (!moderatorTargetUserId) return;
    socket.emit('moderator action', {
      action: 'transfer-leader',
      targetUserId: moderatorTargetUserId,
    });
    closeUserSettingsModal();
  });

  // Moderator actions (Room Settings)
  document.getElementById('toggleLockBtn').addEventListener('click', () => {
    socket.emit('moderator action', {
      action: 'lock-room',
    });
    closeRoomSettingsModal();
  });
  document.getElementById('toggleDoorbellBtn').addEventListener('click', () => {
    moderatorDoorbellMuted = !moderatorDoorbellMuted;
    const btn = document.getElementById('toggleDoorbellBtn');
    btn.textContent = moderatorDoorbellMuted ? 'Unmute Doorbell' : 'Mute Doorbell';
  });

  // copy invite link
  document.getElementById('copyInviteLink').addEventListener('click', copyInviteLink);

  // leave room
  document.querySelector('.leave-room').addEventListener('click', () => {
    socket.emit('leave room');
    window.location.href = '/index.html';
  });

  // chat input
  document.querySelector('.chat-container').addEventListener('input', (e) => {
    if (
      e.target.classList.contains('chat-input') &&
      e.target.closest('.chat-row').dataset.userId === currentUserId
    ) {
      const curVal = e.target.value;
      if (curVal.length > MAX_MESSAGE_LENGTH) {
        e.target.value = curVal.slice(0, MAX_MESSAGE_LENGTH);
        return;
      }
      const diff = getDiff(lastSentMessage, curVal);
      if (diff) {
        socket.emit('chat update', { diff, index: diff.index });
        lastSentMessage = curVal;
      }
    }
  });

  window.addEventListener('resize', adjustLayout);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', handleViewportChange);
  }
});

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

function updateDateTime() {
  const now = new Date();
  const dateOptions = { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' };
  const timeOptions = { hour: '2-digit', minute: '2-digit', hour12: true };
  const formattedDate = now.toLocaleDateString('en-US', dateOptions);
  const formattedTime = now.toLocaleTimeString('en-US', timeOptions);
  const dtEl = document.getElementById('dateTime');
  if (dtEl) {
    dtEl.querySelector('.date').textContent = formattedDate;
    dtEl.querySelector('.time').textContent = formattedTime;
  }
}

function updateInviteLink() {
  const linkEl = document.getElementById('inviteLink');
  if (!linkEl) return;
  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.set('roomId', currentRoomId);
  const inviteLink = currentUrl.href;
  linkEl.textContent = inviteLink;
  linkEl.href = inviteLink;
  const copyBtn = document.getElementById('copyInviteLink');
  if (copyBtn) {
    copyBtn.style.display = 'inline-block';
  }
}

function copyInviteLink() {
  const linkEl = document.getElementById('inviteLink');
  if (!linkEl) return;
  navigator.clipboard
    .writeText(linkEl.textContent)
    .then(() => {
      alert('Invite link copied to clipboard!');
    })
    .catch((err) => {
      console.error('Copy failed:', err);
    });
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
