// ============================================================================
// room-client.js
// ============================================================================
//
// Changes:
// 1) If I'm the leader, show #roomSettingsBtn instead of #muteToggle in the top nav.
// 2) "Mute" from the moderator modal calls `socket.emit('moderator action', { action:'mute', targetUserId })`
//    which globally mutes that user server-side.
// 3) On 'room update', we get a list of 'locked' plus any 'mutedUserIds' if we want to highlight them.
// 4) The moderator modal also displays "Room is currently locked/unlocked" in #roomLockStatus.
//
// We'll assume we get 'locked' in the 'room update' event. If you want to keep track
// of the globally muted users in the client, you can have the server also send something like
// 'mutedUserIds': [...room.mutedUserIds].
//
// Let's implement that.
//
// We'll also have a separate "settings" modal if you'd like for the entire room, but
// your request said you want the same modal to show Lock/Unlock status. We'll store it
// in #roomLockStatus for now.
//

const MAX_MESSAGE_LENGTH = 5000;

let currentUsername = '';
let currentLocation = '';
let currentRoomId = '';
let currentUserId = '';
let currentRoomLayout = 'horizontal'; 
let lastSentMessage = '';
let currentRoomName = '';
let chatInput = null;
let currentLeaderId = null;
let roomIsLocked = false; // track if locked

// For moderator modal actions
let moderatorTargetUserId = null;

// Basic sounds
const joinSound = document.getElementById('joinSound');
const leaveSound = document.getElementById('leaveSound');
let soundEnabled = true;

const muteToggleButton = document.getElementById('muteToggle');
const roomSettingsBtn = document.getElementById('roomSettingsBtn'); // new button for leaders
const muteIcon = document.getElementById('muteIcon');

// -------------- SOUND & MUTE (Personal) --------------
function playJoinSound() {
  if (soundEnabled) {
    joinSound.play().catch(err => console.error('Error playing join sound:', err));
  }
}
function playLeaveSound() {
  if (soundEnabled) {
    leaveSound.play().catch(err => console.error('Error playing leave sound:', err));
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
  roomIsLocked = data.locked || false;

  updateRoomInfo(data);
  updateRoomUI(data);

  if (data.votes) updateVotesUI(data.votes);
  if (data.currentMessages) {
    Object.keys(data.currentMessages).forEach(uid => {
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
  const roomIdEl   = document.querySelector('.room-id');

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

  document.querySelectorAll('.chat-row').forEach(row => {
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
    roomData.users.forEach(u => {
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

  // Mute button
  const muteBtn = document.createElement('button');
  muteBtn.classList.add('mute-button');
  muteBtn.innerHTML = '🔊';
  muteBtn.style.display = 'none';
  muteBtn.addEventListener('click', () => {
    // personal sound approach or local mute approach
    // ...
    alert("In this version, global mute is done by the moderator's 'mute' button in the settings modal.");
  });
  userInfo.appendChild(muteBtn);

  // Vote button
  const voteBtn = document.createElement('button');
  voteBtn.classList.add('vote-button');
  voteBtn.innerHTML = '👎 0';
  voteBtn.style.display = 'none';
  voteBtn.addEventListener('click', () => {
    socket.emit('vote', { targetUserId: user.id });
  });
  userInfo.appendChild(voteBtn);

  // Moderator gear
  const modMenuBtn = document.createElement('button');
  modMenuBtn.classList.add('mod-menu-button');
  modMenuBtn.innerText = '⚙️';
  modMenuBtn.style.display = 'none';
  modMenuBtn.addEventListener('click', () => {
    openModeratorModal(user);
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
  const inputEl = document.querySelector(`.chat-row[data-user-id="${data.userId}"] .chat-input`);
  if (!inputEl) return;

  if (data.diff) {
    const currentText = inputEl.value;
    let newText;
    switch (data.diff.type) {
      case 'full-replace':
        newText = data.diff.text.slice(0, MAX_MESSAGE_LENGTH);
        break;
      case 'add':
        newText = currentText.slice(0, data.diff.index) + data.diff.text + currentText.slice(data.diff.index);
        break;
      case 'delete':
        newText = currentText.slice(0, data.diff.index) + currentText.slice(data.diff.index + data.diff.count);
        break;
      case 'replace':
        newText = currentText.slice(0, data.diff.index) 
                  + data.diff.text 
                  + currentText.slice(data.diff.index + data.diff.text.length);
        break;
      default:
        newText = currentText;
    }
    inputEl.value = newText.slice(0, MAX_MESSAGE_LENGTH);
  }
}

// -------------- Modals: open/close --------------
function openModeratorModal(user) {
  moderatorTargetUserId = user.id;

  const modal = document.getElementById('moderatorModal');
  const targetNameEl = document.getElementById('moderatorTargetName');
  const targetIdEl   = document.getElementById('moderatorTargetId');
  const lockStatusEl = document.getElementById('roomLockStatus');

  targetNameEl.textContent = user.username;
  targetIdEl.textContent   = user.id;

  // show locked/unlocked
  if (roomIsLocked) {
    lockStatusEl.textContent = 'Room is currently LOCKED';
  } else {
    lockStatusEl.textContent = 'Room is currently UNLOCKED';
  }

  modal.style.display = 'block';
}

function closeModeratorModal() {
  const modal = document.getElementById('moderatorModal');
  modal.style.display = 'none';
  moderatorTargetUserId = null;
}

// -------------- Layout & UI Adjustments --------------
function adjustVoteButtonVisibility() {
  const userCount = document.querySelectorAll('.chat-row').length;
  document.querySelectorAll('.chat-row').forEach(row => {
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
  document.querySelectorAll('.chat-row').forEach(row => {
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
  document.querySelectorAll('.chat-row').forEach(row => {
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

    chatRows.forEach(r => {
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

    chatRows.forEach(r => {
      r.style.width = `${colWidth}px`;
      r.style.height = '100%';
      const userInfo = r.querySelector('.user-info');
      const chatInp = r.querySelector('.chat-input');
      chatInp.style.height = `calc(100% - ${userInfo.offsetHeight}px - 2px)`;
    });
  }
}

// -------------- Events --------------
document.querySelector('.leave-room').addEventListener('click', () => {
  socket.emit('leave room');
  window.location.href = '/index.html';
});

document.querySelector('.chat-container').addEventListener('input', (e) => {
  if (e.target.classList.contains('chat-input')
   && e.target.closest('.chat-row').dataset.userId === currentUserId) {
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

  // Show/hide nav items
  muteToggleButton.addEventListener('click', toggleMute);
  roomSettingsBtn.addEventListener('click', () => {
    // We could open a separate "Room Settings" modal or re-use the moderator modal
    // for overall "Lock/Unlock" state. But your request merges them, so let's just
    // open the modal with no user selected => show lock status
    openModeratorModal({ id: '', username: 'No specific user' });
  });

  // Moderator modal
  const modalClose = document.getElementById('moderatorModalClose');
  modalClose.addEventListener('click', closeModeratorModal);

  document.getElementById('modKickBtn').addEventListener('click', () => {
    if (!moderatorTargetUserId) return;
    socket.emit('moderator action', {
      action: 'kick',
      targetUserId: moderatorTargetUserId
    });
    closeModeratorModal();
  });
  document.getElementById('modBanBtn').addEventListener('click', () => {
    if (!moderatorTargetUserId) return;
    socket.emit('moderator action', {
      action: 'ban',
      targetUserId: moderatorTargetUserId
    });
    closeModeratorModal();
  });
  document.getElementById('modMuteBtn').addEventListener('click', () => {
    if (!moderatorTargetUserId) return;
    socket.emit('moderator action', {
      action: 'mute',
      targetUserId: moderatorTargetUserId
    });
    closeModeratorModal();
  });
  document.getElementById('modTransferBtn').addEventListener('click', () => {
    if (!moderatorTargetUserId) return;
    socket.emit('moderator action', {
      action: 'transfer-leader',
      targetUserId: moderatorTargetUserId
    });
    closeModeratorModal();
  });
  document.getElementById('modLockRoomBtn').addEventListener('click', () => {
    socket.emit('moderator action', {
      action: 'lock-room'
    });
    closeModeratorModal();
  });

  document.getElementById('copyInviteLink').addEventListener('click', copyInviteLink);

  window.addEventListener('resize', adjustLayout);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', handleViewportChange);
  }
});

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
  navigator.clipboard.writeText(linkEl.textContent).then(() => {
    alert('Invite link copied to clipboard!');
  }).catch(err => {
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
