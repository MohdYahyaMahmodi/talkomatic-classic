// public/js/room-client.js
// Talkomatic chat room client: real-time diff-based chat, emote system,
// word filter integration, vote-kick UI, link safety, dev mode UI, layout.

// ── 1. CONSTANTS & STATE ────────────────────────────────────────────────────

// Dev mode: pass devKey from localStorage in socket auth
const socket = io({
  auth: {
    devKey: localStorage.getItem("talkomatic_devKey") || undefined,
  },
});

let currentUsername = "";
let currentLocation = "";
let currentRoomId = "";
let currentUserId = "";
let currentRoomLayout = "horizontal";
let currentRoomName = "";
let lastSentMessage = "";
let chatInput = null;
let talkoboardInstance = null;

// Dev mode state
let currentUserIsDev = false;
let currentUserIsVanished = false;
let currentUserIsHidden = false;

// The user's own raw (unfiltered) text and whether the display is filtered
let selfRawText = "";
let selfIsFiltered = false;

const mutedUsers = new Set();
const devContext = new Map();
const storedMessagesForMutedUsers = new Map();

const MAX_MESSAGE_LENGTH = 5000;

// Client-side mirror of the server's MIN_USERS_FOR_VOTING, used for UI
// cleanup only; the server remains the authority on votes
const MIN_USERS_FOR_VOTING = 3;

// Last vote state from the server, re-rendered after local DOM changes
let currentVotes = {};

const ERROR_CODES = {
  VALIDATION_ERROR: "Validation Error",
  SERVER_ERROR: "Server Error",
  UNAUTHORIZED: "Unauthorized",
  NOT_FOUND: "Not Found",
  RATE_LIMITED: "Rate Limited",
  ROOM_FULL: "Room Full",
  ACCESS_DENIED: "Access Denied",
  BAD_REQUEST: "Bad Request",
  FORBIDDEN: "Forbidden",
  CIRCUIT_OPEN: "Circuit Open",
  AFK_WARNING: "AFK Warning",
  AFK_TIMEOUT: "AFK Timeout",
};

// ── 2. WORD FILTER ──────────────────────────────────────────────────────────

let clientWordFilter = null;
let wordFilterEnabled = true;

// Filters text in segments around valid :code: emote tokens so emote codes
// containing filtered substrings still render instead of becoming asterisks.
// Unknown ":notanemote:" tokens are plain text and stay filterable.
function filterTextPreservingEmotes(text) {
  if (!text.includes(":")) {
    return clientWordFilter.filterText(text);
  }

  const regex = /:([\w]+):/g;
  let result = "";
  let lastIndex = 0;
  let foundEmote = false;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (!emoteList[match[1]]) continue;
    foundEmote = true;
    result += clientWordFilter.filterText(text.slice(lastIndex, match.index));
    result += match[0];
    lastIndex = match.index + match[0].length;
  }

  if (!foundEmote) {
    return clientWordFilter.filterText(text);
  }

  result += clientWordFilter.filterText(text.slice(lastIndex));
  return result;
}

function applyWordFilter(text) {
  if (!wordFilterEnabled || !clientWordFilter || !clientWordFilter.ready) {
    return text;
  }
  return filterTextPreservingEmotes(text);
}

function toggleWordFilter() {
  wordFilterEnabled = !wordFilterEnabled;
  localStorage.setItem("wordFilterEnabled", JSON.stringify(wordFilterEnabled));
  updateFilterToggleUI();

  if (chatInput && selfRawText) {
    const cursor = getCursorPosition(chatInput);
    const display = wordFilterEnabled
      ? applyWordFilter(selfRawText)
      : selfRawText;
    chatInput.innerHTML = "";
    chatInput.textContent = display;
    replaceEmotes(chatInput);
    try {
      setCursorPosition(chatInput, cursor);
    } catch {
      placeCursorAtEnd(chatInput);
    }
    selfIsFiltered = wordFilterEnabled && clientWordFilter?.ready;
  }

  document.querySelectorAll(".chat-row").forEach((row) => {
    if (row.dataset.userId === currentUserId) return;
    const chatDiv = row.querySelector(".chat-input");
    if (!chatDiv || chatDiv.dataset.rawText === undefined) return;
    renderOtherUserMessage(chatDiv, chatDiv.dataset.rawText);
  });
}

function updateFilterToggleUI() {
  const btn = document.getElementById("filterToggle");
  if (!btn) return;
  btn.classList.toggle("filter-off", !wordFilterEnabled);
  btn.title = wordFilterEnabled
    ? "Word Filter: ON (click to disable)"
    : "Word Filter: OFF (click to enable)";
}

// ── 3. MODAL SYSTEM ─────────────────────────────────────────────────────────

const customModal = document.getElementById("customModal");
const modalTitle = document.getElementById("modalTitle");
const modalMessage = document.getElementById("modalMessage");
const modalInput = document.getElementById("modalInput");
const modalInputContainer = document.getElementById("modalInputContainer");
const modalInputError = document.getElementById("modalInputError");
const modalCancelBtn = document.getElementById("modalCancelBtn");
const modalConfirmBtn = document.getElementById("modalConfirmBtn");
const closeModalBtn = document.querySelector(".close-modal-btn");
let currentModalCallback = null;

function showModal(title, message, options = {}) {
  modalTitle.textContent = title;
  modalMessage.textContent = message;
  modalInputContainer.style.display = "none";
  modalInput.value = "";
  modalInputError.style.display = "none";
  modalInputError.textContent = "";
  if (options.showInput) {
    modalInputContainer.style.display = "block";
    modalInput.placeholder = options.inputPlaceholder || "";
    modalInput.setAttribute("maxlength", options.maxLength || "6");
    modalInput.focus();
  }
  modalCancelBtn.textContent = options.cancelText || "Cancel";
  modalConfirmBtn.textContent = options.confirmText || "Confirm";
  modalCancelBtn.style.display =
    options.showCancel !== false ? "block" : "none";
  currentModalCallback = options.callback || null;
  customModal.classList.add("show");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  customModal.classList.remove("show");
  document.body.style.overflow = "";
  currentModalCallback = null;
}

function showErrorModal(message) {
  showModal("Error", message, { showCancel: false, confirmText: "OK" });
}

function showInfoModal(message, callback = null) {
  showModal("Information", message, {
    showCancel: false,
    confirmText: "OK",
    callback: callback || (() => {}),
  });
}

function showConfirmModal(message, callback) {
  showModal("Confirmation", message, {
    confirmText: "Yes",
    cancelText: "No",
    callback,
  });
}

function showInputModal(title, message, options, callback) {
  showModal(title, message, {
    showInput: true,
    inputPlaceholder: options.placeholder || "",
    maxLength: options.maxLength || "6",
    confirmText: options.confirmText || "Submit",
    callback: (confirmed, inputValue) => {
      if (confirmed && options.validate) {
        const result = options.validate(inputValue);
        if (result !== true) {
          modalInputError.textContent = result;
          modalInputError.style.display = "block";
          return false;
        }
      }
      callback(confirmed, inputValue);
      return true;
    },
  });
}

modalConfirmBtn.addEventListener("click", () => {
  if (currentModalCallback) {
    if (currentModalCallback(true, modalInput.value) !== false) closeModal();
  } else closeModal();
});
modalCancelBtn.addEventListener("click", () => {
  if (currentModalCallback) currentModalCallback(false);
  closeModal();
});
closeModalBtn.addEventListener("click", closeModal);
customModal.addEventListener("click", (e) => {
  if (e.target === customModal) closeModal();
});
modalInput.addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/[^0-9]/g, "");
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && customModal.classList.contains("show"))
    closeModal();
});
modalInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") modalConfirmBtn.click();
});

// ── 4. SOUND ────────────────────────────────────────────────────────────────

const joinSound = document.getElementById("joinSound");
const leaveSound = document.getElementById("leaveSound");
const muteToggleButton = document.getElementById("muteToggle");
const muteIcon = document.getElementById("muteIcon");
let soundEnabled = true;

function playJoinSound() {
  if (soundEnabled) joinSound.play().catch(() => {});
}
function playLeaveSound() {
  if (soundEnabled) leaveSound.play().catch(() => {});
}
function toggleMute() {
  soundEnabled = !soundEnabled;
  localStorage.setItem("soundEnabled", JSON.stringify(soundEnabled));
  updateMuteIcon();
}
function updateMuteIcon() {
  muteIcon.src = soundEnabled
    ? "images/icons/sound-on.svg"
    : "images/icons/sound-off.svg";
  muteIcon.alt = soundEnabled ? "Sound On" : "Sound Off";
}

// ── 5. CONTENTEDITABLE UTILITIES ────────────────────────────────────────────

// Extracts plain text from the contenteditable, converting emote <img>
// elements back to their :code: tokens and DIVs/BRs to newlines
function getPlainText(element) {
  if (!element) return "";
  function extract(node) {
    let t = "";
    if (node.nodeType === Node.TEXT_NODE) {
      t += node.textContent;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.nodeName === "IMG" && node.dataset.emoteCode) {
        t += `:${node.dataset.emoteCode}:`;
      } else if (node.nodeName === "BR") {
        t += "\n";
      } else if (node.nodeName === "DIV") {
        if (node.previousSibling) t += "\n";
        for (const child of node.childNodes) t += extract(child);
      } else {
        for (const child of node.childNodes) t += extract(child);
      }
    }
    return t;
  }
  try {
    return extract(element);
  } catch {
    return element.textContent || "";
  }
}

function placeCursorAtEnd(el) {
  if (!el) return;
  try {
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  } catch {}
}

// Returns the caret position as a plain-text offset (emotes count as the
// length of their :code: token)
function getCursorPosition(element) {
  if (!element) return 0;
  try {
    const sel = window.getSelection();
    if (sel.rangeCount === 0) return 0;
    const range = sel.getRangeAt(0);
    const pre = range.cloneRange();
    pre.selectNodeContents(element);
    pre.setEnd(range.endContainer, range.endOffset);
    function countLen(node) {
      let len = 0;
      const w = document.createTreeWalker(
        node,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
        null,
        false,
      );
      while (w.nextNode()) {
        if (w.currentNode.nodeType === Node.TEXT_NODE)
          len += w.currentNode.textContent.length;
        else if (
          w.currentNode.nodeName === "IMG" &&
          w.currentNode.dataset.emoteCode
        )
          len += w.currentNode.dataset.emoteCode.length + 2;
      }
      return len;
    }
    return countLen(pre.cloneContents());
  } catch {
    return 0;
  }
}

// Restores the caret to a plain-text offset
function setCursorPosition(element, position) {
  if (!element) return;
  try {
    element.focus();
    const nodes = [];
    const w = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      null,
      false,
    );
    while (w.nextNode()) nodes.push(w.currentNode);
    if (nodes.length === 0) {
      const r = document.createRange();
      r.setStart(element, 0);
      r.collapse(true);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      return;
    }
    let pos = 0;
    for (const node of nodes) {
      let nLen = 0;
      if (node.nodeType === Node.TEXT_NODE) {
        nLen = node.length;
        if (pos + nLen >= position) {
          const r = document.createRange();
          r.setStart(node, position - pos);
          r.collapse(true);
          const s = window.getSelection();
          s.removeAllRanges();
          s.addRange(r);
          return;
        }
      } else if (node.nodeName === "IMG" && node.dataset.emoteCode) {
        nLen = node.dataset.emoteCode.length + 2;
        if (pos + nLen > position) {
          const r = document.createRange();
          r.setStartAfter(node);
          r.collapse(true);
          const s = window.getSelection();
          s.removeAllRanges();
          s.addRange(r);
          return;
        }
      }
      pos += nLen;
    }
    placeCursorAtEnd(element);
  } catch {
    placeCursorAtEnd(element);
  }
}

// Computes a minimal diff between two strings for the chat update protocol
function getDiff(oldStr, newStr) {
  if (oldStr === newStr) return null;
  if (newStr.startsWith(oldStr))
    return {
      type: "add",
      text: newStr.slice(oldStr.length),
      index: oldStr.length,
    };
  if (oldStr.startsWith(newStr))
    return {
      type: "delete",
      count: oldStr.length - newStr.length,
      index: newStr.length,
    };
  return { type: "full-replace", text: newStr };
}

// ── 6. EMOTE SYSTEM ─────────────────────────────────────────────────────────

let emoteList = {};
let emoteAutocomplete = null;
let autocompleteActive = false;
let selectedEmoteIndex = -1;
let filteredEmotes = [];
let currentEmotePrefix = "";
let currentEmoteInfo = null;

async function loadEmotes() {
  try {
    const resp = await fetch("/js/emojiList.json?v=1.0.1");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    emoteList = await resp.json();
    console.log("Emotes loaded:", Object.keys(emoteList).length);
  } catch (err) {
    console.error("Error loading emotes:", err);
    emoteList = {};
  }
}

// Converts :code: tokens in an element to emote <img> elements, preserving
// the caret if the element is focused
function replaceEmotes(element) {
  if (!element) return;
  const text = getPlainText(element);
  if (!text.includes(":")) return;
  const regex = /:([\w]+):/g;
  if (!regex.test(text)) return;
  regex.lastIndex = 0;
  const isActive = document.activeElement === element;
  let cursorPos = 0;
  if (isActive) cursorPos = getCursorPosition(element);
  let html = "",
    lastIdx = 0,
    match,
    changed = false;
  while ((match = regex.exec(text)) !== null) {
    if (emoteList[match[1]]) {
      changed = true;
      html += text.substring(lastIdx, match.index);
      html += `<img src="${emoteList[match[1]]}" alt=":${match[1]}:" title=":${match[1]}:" class="emote" data-emote-code="${match[1]}">`;
      lastIdx = match.index + match[0].length;
    }
  }
  if (!changed) return;
  html += text.substring(lastIdx);
  element.innerHTML = html;
  if (isActive) {
    try {
      setCursorPosition(element, cursorPos);
    } catch {
      placeCursorAtEnd(element);
    }
  }
}

// Finds the ":prefix" being typed at the caret. Handles element-node caret
// positions (where the caret lands right after an emote <img> insertion) by
// stepping into the text node immediately before the caret.
function findEmoteAtCursor() {
  if (!chatInput || document.activeElement !== chatInput) return null;
  const sel = window.getSelection();
  if (sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);

  let node = range.startContainer;
  let offset = range.startOffset;

  if (node.nodeType === Node.ELEMENT_NODE) {
    const prev = node.childNodes[offset - 1];
    if (prev && prev.nodeType === Node.TEXT_NODE) {
      node = prev;
      offset = prev.textContent.length;
    } else {
      return null; // caret sits after an <img>/<br>, nothing to complete
    }
  }

  if (node.nodeType !== Node.TEXT_NODE) return null;

  const text = node.textContent;
  let start = offset - 1;
  while (start >= 0 && text[start] !== ":") start--;
  if (start >= 0 && text[start] === ":") {
    const prefix = text.substring(start + 1, offset);
    if (prefix) return { node, prefix, startPos: start, endPos: offset };
  }
  return null;
}

function showAutocomplete(prefix) {
  if (!prefix || prefix.length < 1) {
    hideAutocomplete();
    return;
  }
  filteredEmotes = Object.keys(emoteList)
    .filter((c) => c.toLowerCase().startsWith(prefix.toLowerCase()))
    .slice(0, 10);
  if (filteredEmotes.length === 0) {
    hideAutocomplete();
    return;
  }
  currentEmoteInfo = findEmoteAtCursor();
  if (!emoteAutocomplete) {
    emoteAutocomplete = document.getElementById("emoteAutocomplete");
    if (!emoteAutocomplete) {
      emoteAutocomplete = document.createElement("div");
      emoteAutocomplete.id = "emoteAutocomplete";
      emoteAutocomplete.className = "emote-autocomplete";
      document.body.appendChild(emoteAutocomplete);
    }
  }
  const sel = window.getSelection();
  if (sel.rangeCount === 0) {
    hideAutocomplete();
    return;
  }
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  emoteAutocomplete.innerHTML = "";
  const header = document.createElement("div");
  header.className = "emote-autocomplete-header";
  header.textContent = "Emoticons";
  emoteAutocomplete.appendChild(header);
  const list = document.createElement("div");
  list.className = "emote-autocomplete-list";
  filteredEmotes.forEach((code, i) => {
    const item = document.createElement("div");
    item.className =
      "emote-autocomplete-item" + (i === selectedEmoteIndex ? " selected" : "");
    const img = document.createElement("img");
    img.src = emoteList[code];
    img.alt = `:${code}:`;
    const span = document.createElement("span");
    span.textContent = code;
    span.style.fontFamily = "monospace";
    item.appendChild(img);
    item.appendChild(span);
    item.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const info = currentEmoteInfo ? { ...currentEmoteInfo } : null;
      setTimeout(() => insertEmote(code, info), 0);
    });
    item.addEventListener("mouseover", () => {
      selectedEmoteIndex = i;
      updateSelectedEmote();
    });
    list.appendChild(item);
  });
  emoteAutocomplete.appendChild(list);
  emoteAutocomplete.style.top = `${rect.bottom + window.scrollY + 5}px`;
  emoteAutocomplete.style.left = `${rect.left + window.scrollX}px`;
  emoteAutocomplete.style.display = "block";
  autocompleteActive = true;
  currentEmotePrefix = prefix;
  if (filteredEmotes.length > 0 && selectedEmoteIndex < 0) {
    selectedEmoteIndex = 0;
    updateSelectedEmote();
  }
}

function hideAutocomplete() {
  if (emoteAutocomplete) emoteAutocomplete.style.display = "none";
  autocompleteActive = false;
  selectedEmoteIndex = -1;
  currentEmotePrefix = "";
}

function handleEmoteNavigation(e) {
  if (!autocompleteActive) return false;
  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      selectedEmoteIndex = (selectedEmoteIndex + 1) % filteredEmotes.length;
      updateSelectedEmote();
      return true;
    case "ArrowUp":
      e.preventDefault();
      selectedEmoteIndex =
        selectedEmoteIndex <= 0
          ? filteredEmotes.length - 1
          : selectedEmoteIndex - 1;
      updateSelectedEmote();
      return true;
    case "Tab":
    case "Enter":
      e.preventDefault();
      if (selectedEmoteIndex < 0 && filteredEmotes.length > 0)
        selectedEmoteIndex = 0;
      if (
        selectedEmoteIndex >= 0 &&
        selectedEmoteIndex < filteredEmotes.length
      ) {
        insertEmote(filteredEmotes[selectedEmoteIndex], currentEmoteInfo);
        return true;
      }
      break;
    case "Escape":
      hideAutocomplete();
      return true;
  }
  return false;
}

function updateSelectedEmote() {
  if (!emoteAutocomplete) return;
  emoteAutocomplete
    .querySelectorAll(".emote-autocomplete-item")
    .forEach((item, i) => {
      item.classList.toggle("selected", i === selectedEmoteIndex);
      if (i === selectedEmoteIndex) item.scrollIntoView?.({ block: "nearest" });
    });
}

// Guarantees the caret lives inside a TEXT node after an insertHTML, so the
// next ":" the user types is found by findEmoteAtCursor(). Empty text nodes
// are invisible and ignored by getPlainText().
function ensureCaretInTextNode() {
  try {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (range.startContainer.nodeType === Node.TEXT_NODE) return;

    const tn = document.createTextNode("");
    range.insertNode(tn);
    range.setStart(tn, 0);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {
    // non-fatal: autocomplete will simply skip this position
  }
}

function insertEmote(emoteCode, emoteInfo) {
  if (!chatInput) return;
  chatInput.focus();
  const html = `<img src="${emoteList[emoteCode]}" alt=":${emoteCode}:" title=":${emoteCode}:" class="emote" data-emote-code="${emoteCode}">`;
  try {
    if (emoteInfo && emoteInfo.node && emoteInfo.node.parentNode) {
      const sel = window.getSelection();
      const r = document.createRange();
      r.setStart(emoteInfo.node, emoteInfo.startPos);
      r.setEnd(emoteInfo.node, emoteInfo.endPos);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    document.execCommand("insertHTML", false, html);
  } catch {
    try {
      document.execCommand("insertHTML", false, html);
    } catch {}
  }

  ensureCaretInTextNode();

  hideAutocomplete();
  currentEmoteInfo = null;
  updateSentMessage();
  setTimeout(() => {
    chatInput.focus();
    ensureCaretInTextNode();
  }, 10);
}

// Reads the input, reconstructs the raw text if the display is filtered,
// and sends a diff to the server
function updateSentMessage() {
  if (!chatInput) return;
  try {
    const currentDisplay = getPlainText(chatInput);

    if (selfIsFiltered && wordFilterEnabled && clientWordFilter?.ready) {
      const prevDisplay = applyWordFilter(selfRawText);
      selfRawText = reconstructRawText(
        prevDisplay,
        currentDisplay,
        selfRawText,
      );
    } else {
      selfRawText = currentDisplay;
    }

    const diff = getDiff(lastSentMessage, selfRawText);
    if (diff) {
      socket.emit("chat update", { diff, index: diff.index });
      lastSentMessage = selfRawText;
    }

    applySelfFilter();
  } catch (err) {
    console.error("updateSentMessage error:", err);
  }
}

// Maps an edit made on the FILTERED display back onto the RAW text by
// finding the common prefix/suffix and splicing the inserted region
function reconstructRawText(prevFiltered, currentDisplay, prevRaw) {
  if (prevFiltered === currentDisplay) return prevRaw;

  let start = 0;
  while (
    start < prevFiltered.length &&
    start < currentDisplay.length &&
    prevFiltered[start] === currentDisplay[start]
  ) {
    start++;
  }

  let prevEnd = prevFiltered.length - 1;
  let curEnd = currentDisplay.length - 1;
  while (
    prevEnd > start &&
    curEnd > start &&
    prevFiltered[prevEnd] === currentDisplay[curEnd]
  ) {
    prevEnd--;
    curEnd--;
  }

  const inserted = currentDisplay.slice(start, curEnd + 1);
  return prevRaw.slice(0, start) + inserted + prevRaw.slice(prevEnd + 1);
}

// Re-renders the user's own input with the filter applied
function applySelfFilter() {
  if (!chatInput) return;

  if (wordFilterEnabled && clientWordFilter?.ready) {
    const filtered = applyWordFilter(selfRawText);
    const currentDisplay = getPlainText(chatInput);

    if (filtered !== currentDisplay) {
      const cursor = getCursorPosition(chatInput);
      chatInput.innerHTML = "";
      chatInput.textContent = filtered;
      replaceEmotes(chatInput);
      try {
        setCursorPosition(chatInput, cursor);
      } catch {
        placeCursorAtEnd(chatInput);
      }
    }
    selfIsFiltered = true;
  } else {
    selfIsFiltered = false;
  }
}

// Builds the Emoticons button beside .room-type (wrapped in a group so the
// room type display is never replaced) and the emote picker dropdown
function createEmotesDropdown() {
  if (document.getElementById("emotesButton")) return;

  const roomTypeEl = document.querySelector(".room-type");
  if (!roomTypeEl) return;

  const button = document.createElement("button");
  button.id = "emotesButton";
  button.className = "emotes-button";
  button.textContent = "Emoticons";

  const dropdown = document.createElement("div");
  dropdown.id = "emotesDropdown";
  dropdown.className = "emotes-dropdown";
  dropdown.style.display = "none";
  dropdown.style.position = "absolute";
  dropdown.style.zIndex = "10000";

  Object.entries(emoteList).forEach(([code, url]) => {
    const item = document.createElement("div");
    item.className = "emote-item";
    const img = document.createElement("img");
    img.src = url;
    img.alt = `:${code}:`;
    const name = document.createElement("span");
    name.textContent = code;
    item.appendChild(img);
    item.appendChild(name);
    item.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropdown.style.display = "none";
      setTimeout(() => {
        if (chatInput) {
          chatInput.focus();
          insertEmote(code, null);
        }
      }, 0);
    });
    dropdown.appendChild(item);
  });

  button.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const visible = dropdown.style.display === "flex";
    document
      .querySelectorAll(".emotes-dropdown")
      .forEach((d) => (d.style.display = "none"));
    if (!visible) {
      const rect = button.getBoundingClientRect();
      dropdown.style.top = `${rect.bottom + window.scrollY + 5}px`;
      dropdown.style.left = `${rect.left + window.scrollX}px`;
      dropdown.style.display = "flex";
      if (chatInput) setTimeout(() => chatInput.focus(), 0);
    }
  });

  document.addEventListener("click", (e) => {
    if (
      dropdown.style.display === "flex" &&
      !dropdown.contains(e.target) &&
      e.target !== button
    )
      dropdown.style.display = "none";
  });

  const group = document.createElement("div");
  group.className = "room-type-group";
  roomTypeEl.parentNode.insertBefore(group, roomTypeEl);
  group.appendChild(roomTypeEl);
  group.appendChild(button);

  document.body.appendChild(dropdown);
}

// ── 7. APP DIRECTORY ────────────────────────────────────────────────────────

const APPS_DATA = {
  watchparty: {
    name: "WatchParty",
    description: "Watch YouTube videos together",
    icon: "https://watchparty.talkomatic.co/images/logo.png",
    iconClass: "watchparty",
    status: "available",
    url: "https://watchparty.talkomatic.co/",
    openInNewTab: true,
  },
  infiniteboard: {
    name: "Talkoboard",
    description: "Draw together in real-time",
    icon: "\uD83C\uDFA8",
    iconClass: "placeholder",
    status: "available",
    url: null,
    openInNewTab: false,
    action: "talkoboard",
  },
  minigames: {
    name: "Mini Games",
    description: "Uno, Hangman, Tic Tac Toe & more",
    icon: "\uD83C\uDFAE",
    iconClass: "placeholder",
    status: "coming-soon",
    url: null,
    openInNewTab: false,
  },
  fileshare: {
    name: "File Share",
    description: "Share files and images securely",
    icon: "\uD83D\uDCC1",
    iconClass: "placeholder",
    status: "coming-soon",
    url: null,
    openInNewTab: false,
  },
};
let appDirectoryDropdown = null;

function createAppDirectoryDropdown() {
  if (appDirectoryDropdown) appDirectoryDropdown.remove();
  appDirectoryDropdown = document.createElement("div");
  appDirectoryDropdown.className = "app-directory-dropdown";
  appDirectoryDropdown.id = "appDirectoryDropdown";
  const header = document.createElement("div");
  header.className = "app-directory-header";
  header.textContent = "\uD83D\uDE80 App Directory";
  const grid = document.createElement("div");
  grid.className = "app-grid";
  Object.entries(APPS_DATA).forEach(([id, app]) => {
    const item = document.createElement("div");
    item.className = `app-item ${app.status === "coming-soon" ? "disabled" : ""}`;
    const icon = document.createElement("div");
    icon.className = `app-icon ${app.iconClass}`;
    if (app.iconClass === "placeholder") {
      icon.textContent = app.icon;
    } else {
      const img = document.createElement("img");
      img.src = app.icon;
      img.alt = app.name;
      img.style.cssText = "width:100%;height:100%;object-fit:cover";
      icon.appendChild(img);
    }
    const info = document.createElement("div");
    info.className = "app-info";
    const nameEl = document.createElement("div");
    nameEl.className = "app-name";
    nameEl.textContent = app.name;
    const desc = document.createElement("div");
    desc.className = "app-description";
    desc.textContent = app.description;
    info.appendChild(nameEl);
    info.appendChild(desc);
    const status = document.createElement("div");
    status.className = `app-status status-${app.status}`;
    status.textContent =
      app.status === "available" ? "Available" : "Coming Soon";
    item.appendChild(icon);
    item.appendChild(info);
    item.appendChild(status);
    if (app.status === "available") {
      item.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        hideAppDirectory();
        if (app.action === "talkoboard") {
          openTalkoboard();
        } else if (app.openInNewTab) {
          window.open(app.url, "_blank", "noopener,noreferrer");
        } else {
          window.location.href = app.url;
        }
      });
    }
    grid.appendChild(item);
  });
  const footer = document.createElement("div");
  footer.className = "app-directory-footer";
  const link = document.createElement("a");
  link.href = "app-directory.html";
  link.className = "view-all-link";
  link.target = "_blank";
  link.textContent = "\uD83D\uDCC2 View All Apps";
  footer.appendChild(link);
  appDirectoryDropdown.appendChild(header);
  appDirectoryDropdown.appendChild(grid);
  appDirectoryDropdown.appendChild(footer);
  const navbar = document.querySelector(".top-navbar");
  if (navbar) {
    navbar.style.position = "relative";
    navbar.appendChild(appDirectoryDropdown);
  }
}

function showAppDirectory() {
  if (!appDirectoryDropdown) createAppDirectoryDropdown();
  hideAutocomplete();
  const ed = document.getElementById("emotesDropdown");
  if (ed) ed.style.display = "none";
  appDirectoryDropdown.classList.add("show");
}
function hideAppDirectory() {
  if (appDirectoryDropdown) appDirectoryDropdown.classList.remove("show");
}
function toggleAppDirectory() {
  if (!appDirectoryDropdown) createAppDirectoryDropdown();
  appDirectoryDropdown.classList.contains("show")
    ? hideAppDirectory()
    : showAppDirectory();
}
function initializeAppDirectory() {
  const btn = document.getElementById("appDirectoryToggle");
  if (btn)
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleAppDirectory();
    });
  document.addEventListener("click", (e) => {
    if (
      appDirectoryDropdown?.classList.contains("show") &&
      !appDirectoryDropdown.contains(e.target) &&
      !e.target.closest("#appDirectoryToggle")
    )
      hideAppDirectory();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && appDirectoryDropdown?.classList.contains("show"))
      hideAppDirectory();
  });
}

// ── 8. TALKOBOARD INTEGRATION ───────────────────────────────────────────────

function openTalkoboard() {
  if (!currentRoomId || !currentUserId) {
    showErrorModal("You must be in a room to use Talkoboard.");
    return;
  }
  if (!talkoboardInstance) {
    talkoboardInstance = new Talkoboard(socket, currentUserId, currentUsername);
  }
  talkoboardInstance.open();
}

// ── 9. VOTING UI ────────────────────────────────────────────────────────────

// Renders vote counters and button states. Below MIN_USERS_FOR_VOTING all
// counters are removed and highlights cleared (matching server behavior).
// Counters at 0 votes are removed instead of lingering.
function updateVotesUI(votes) {
  currentVotes = votes || {};
  const rows = document.querySelectorAll(".chat-row");
  const votingActive = rows.length >= MIN_USERS_FOR_VOTING;

  rows.forEach((row) => {
    const uid = row.dataset.userId;
    const voteBtn = row.querySelector(".vote-button");
    const count = votingActive
      ? Object.values(currentVotes).filter((v) => v === uid).length
      : 0;

    // Own row: the votes-against-me counter
    if (uid === currentUserId) {
      let counter = row.querySelector(".votes-counter");
      if (!votingActive || count === 0) {
        if (counter) counter.remove();
      } else {
        if (!counter) {
          counter = document.createElement("div");
          counter.className = "votes-counter";
          row.querySelector(".user-info").appendChild(counter);
        }
        counter.textContent = `\uD83D\uDC4E ${count}`;
        counter.style.color = "#ff6b6b";
      }
    }

    // Other rows: the vote button
    if (voteBtn) {
      voteBtn.innerHTML = `\uD83D\uDC4E ${count}`;
      voteBtn.classList.toggle(
        "voted",
        votingActive && currentVotes[currentUserId] === uid,
      );
    }
  });
}

function adjustVoteButtonVisibility() {
  const userCount = document.querySelectorAll(".chat-row").length;
  document.querySelectorAll(".chat-row").forEach((row) => {
    const btn = row.querySelector(".vote-button");
    if (btn)
      btn.style.display =
        userCount >= MIN_USERS_FOR_VOTING &&
        row.dataset.userId !== currentUserId
          ? "inline-block"
          : "none";
  });
}

function adjustMuteButtonVisibility() {
  document.querySelectorAll(".chat-row").forEach((row) => {
    const uid = row.dataset.userId;
    const btn = row.querySelector(".mute-button");
    if (btn && uid !== currentUserId) {
      btn.style.display = "inline-block";
      if (mutedUsers.has(uid)) {
        btn.innerHTML = "\uD83D\uDD07";
        btn.classList.add("muted");
        const ci = row.querySelector(".chat-input");
        if (ci) ci.style.opacity = "0.3";
      }
    }
  });
}

// ── 10. CHAT PROCESSING ─────────────────────────────────────────────────────

// Renders another user's message: filter, emotes, then link detection
function renderOtherUserMessage(element, rawMessage) {
  if (!element) return;
  element.dataset.rawText = rawMessage;
  const display = applyWordFilter(rawMessage);
  element.innerHTML = "";
  element.appendChild(document.createTextNode(display));
  replaceEmotes(element);
  linkifyElement(element);
}

function updateCurrentMessages(messages) {
  Object.keys(messages).forEach((uid) => {
    const chatDiv = document.querySelector(
      `.chat-row[data-user-id="${uid}"] .chat-input`,
    );
    if (!chatDiv) return;
    const text = messages[uid].slice(0, MAX_MESSAGE_LENGTH);
    if (uid === currentUserId) {
      selfRawText = text;
      lastSentMessage = text;
      const isActive = document.activeElement === chatDiv;
      let cursor = isActive ? getCursorPosition(chatDiv) : 0;
      const display = applyWordFilter(text);
      chatDiv.innerHTML = "";
      chatDiv.textContent = display;
      replaceEmotes(chatDiv);
      selfIsFiltered = wordFilterEnabled && clientWordFilter?.ready;
      if (isActive) {
        try {
          setCursorPosition(chatDiv, Math.min(cursor, display.length));
        } catch {
          placeCursorAtEnd(chatDiv);
        }
      }
    } else {
      renderOtherUserMessage(chatDiv, text);
    }
  });
}

function displayChatMessage(data) {
  if (mutedUsers.has(data.userId)) {
    if (!storedMessagesForMutedUsers.has(data.userId))
      storedMessagesForMutedUsers.set(data.userId, []);
    storedMessagesForMutedUsers.get(data.userId).push(data);
    return;
  }
  const chatDiv = document.querySelector(
    `.chat-row[data-user-id="${data.userId}"] .chat-input`,
  );
  if (!chatDiv) return;

  let currentText = getPlainText(chatDiv);
  let newText = "";
  if (data.diff) {
    if (data.diff.type === "full-replace") newText = data.diff.text;
    else if (data.diff.type === "add")
      newText =
        currentText.slice(0, data.diff.index) +
        data.diff.text +
        currentText.slice(data.diff.index);
    else if (data.diff.type === "delete")
      newText =
        currentText.slice(0, data.diff.index) +
        currentText.slice(data.diff.index + data.diff.count);
    else if (data.diff.type === "replace")
      newText =
        currentText.slice(0, data.diff.index) +
        data.diff.text +
        currentText.slice(data.diff.index + data.diff.text.length);
  } else if (data.message) newText = data.message;
  else return;
  newText = newText.slice(0, MAX_MESSAGE_LENGTH);

  if (data.userId === currentUserId) {
    selfRawText = newText;
    lastSentMessage = newText;
    const isActive = document.activeElement === chatDiv;
    let cursor = isActive ? getCursorPosition(chatDiv) : 0;
    const display = applyWordFilter(selfRawText);
    chatDiv.innerHTML = "";
    chatDiv.textContent = display;
    if (display.includes(":")) replaceEmotes(chatDiv);
    selfIsFiltered = wordFilterEnabled && clientWordFilter?.ready;
    if (isActive) {
      try {
        setCursorPosition(chatDiv, Math.min(cursor, display.length));
      } catch {
        placeCursorAtEnd(chatDiv);
      }
    }
  } else {
    renderOtherUserMessage(chatDiv, newText);
  }
}

// ── 11. LINK SAFETY ─────────────────────────────────────────────────────────
// URLs in OTHER users' messages are wrapped in .chat-link spans, never real
// anchors. Clicking one opens a warning popup explaining that strange links
// can log your IP or scam you; navigation only happens after confirmation,
// in a new tab with noopener/noreferrer. The user's own input is NOT
// linkified because it is a contenteditable with delicate caret handling.

const URL_PATTERN = new RegExp(
  "(?:https?:\\/\\/[^\\s<>\"']+)" +
    "|(?:www\\.[^\\s<>\"']+)" +
    "|(?:\\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?" +
    "(?:\\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*" +
    "\\.(?:com|net|org|io|gg|co|me|app|dev|xyz|info|link|site|online|club|live|stream|fun|top|cc|tv|to|gl|ly|us|uk|ca|eu|de|fr|es|it|nl|jp|kr|in|br|au|ru|cn)" +
    "(?:\\/[^\\s<>\"']*)?)",
  "gi",
);

const TRAILING_PUNCTUATION = /[.,!?;:)\]}'"]+$/;

let linkWarningOverlay = null;
let pendingLinkUrl = "";

// Walks the text nodes of a rendered message and wraps detected URLs in
// .chat-link spans. Only TEXT nodes are visited, so emote <img> elements
// are untouched. Runs after replaceEmotes().
function linkifyElement(element) {
  if (!element) return;

  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    null,
    false,
  );
  const candidates = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentNode?.closest?.(".chat-link")) continue;
    URL_PATTERN.lastIndex = 0;
    if (URL_PATTERN.test(node.textContent)) candidates.push(node);
  }

  for (const node of candidates) {
    const text = node.textContent;
    const frag = document.createDocumentFragment();
    let last = 0;
    let found = false;
    let match;

    URL_PATTERN.lastIndex = 0;
    while ((match = URL_PATTERN.exec(text)) !== null) {
      const url = match[0].replace(TRAILING_PUNCTUATION, "");
      if (!url) continue;

      frag.appendChild(document.createTextNode(text.slice(last, match.index)));

      const span = document.createElement("span");
      span.className = "chat-link";
      span.dataset.url = url;
      span.title = "Outside link. Click for safety info.";
      span.textContent = url;
      frag.appendChild(span);

      last = match.index + url.length;
      found = true;
    }

    if (!found) continue;
    frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }
}

function createLinkWarningModal() {
  linkWarningOverlay = document.createElement("div");
  linkWarningOverlay.className = "link-warning-overlay";

  const box = document.createElement("div");
  box.className = "link-warning-box";

  const icon = document.createElement("div");
  icon.className = "link-warning-icon";
  icon.textContent = "\u26A0\uFE0F";

  const title = document.createElement("div");
  title.className = "link-warning-title";
  title.textContent = "You Are Leaving Talkomatic";

  const body = document.createElement("div");
  body.textContent =
    "This link was posted by another user. The site behind it can log " +
    "your IP address, estimate your location, or try to scam you. Never " +
    "trust links from strangers. The safest option is to type the address " +
    "yourself in a new tab, on your own.";

  const urlBox = document.createElement("div");
  urlBox.className = "link-warning-url";

  const note = document.createElement("div");
  note.className = "link-warning-note";
  note.textContent =
    "Talkomatic does not check or endorse outside links. Continue only if " +
    "you know and trust this site.";

  const buttons = document.createElement("div");
  buttons.className = "link-warning-buttons";

  const backBtn = document.createElement("button");
  backBtn.className = "link-warning-back";
  backBtn.textContent = "Go Back";
  backBtn.addEventListener("click", hideLinkWarning);

  const visitBtn = document.createElement("button");
  visitBtn.className = "link-warning-visit";
  visitBtn.textContent = "Visit At My Own Risk";
  visitBtn.addEventListener("click", () => {
    let target = pendingLinkUrl;
    if (!target) return hideLinkWarning();
    if (!/^https?:\/\//i.test(target)) target = "https://" + target;
    window.open(target, "_blank", "noopener,noreferrer");
    hideLinkWarning();
  });

  buttons.appendChild(backBtn);
  buttons.appendChild(visitBtn);

  box.appendChild(icon);
  box.appendChild(title);
  box.appendChild(body);
  box.appendChild(urlBox);
  box.appendChild(note);
  box.appendChild(buttons);
  linkWarningOverlay.appendChild(box);

  linkWarningOverlay.addEventListener("click", (e) => {
    if (e.target === linkWarningOverlay) hideLinkWarning();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && linkWarningOverlay.classList.contains("show")) {
      hideLinkWarning();
    }
  });

  document.body.appendChild(linkWarningOverlay);
}

function showLinkWarning(url) {
  if (!url) return;
  if (!linkWarningOverlay) createLinkWarningModal();
  pendingLinkUrl = url;
  linkWarningOverlay.querySelector(".link-warning-url").textContent = url;
  linkWarningOverlay.classList.add("show");
}

function hideLinkWarning() {
  if (!linkWarningOverlay) return;
  linkWarningOverlay.classList.remove("show");
  pendingLinkUrl = "";
}

// One delegated click listener on the static chat container, so it survives
// every room update that rebuilds the rows inside it
function initLinkSafety() {
  const container = document.querySelector(".chat-container");
  if (!container) return;
  container.addEventListener("click", (e) => {
    const link = e.target.closest?.(".chat-link");
    if (!link) return;
    e.preventDefault();
    e.stopPropagation();
    showLinkWarning(link.dataset.url);
  });
}

// ── 12. DEV MODE: Confetti & Navbar Controls ────────────────────────────────

// Self-contained confetti burst shown when a dev joins
function triggerDevConfetti() {
  const container = document.createElement("div");
  container.style.cssText =
    "position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:99999;overflow:hidden;";
  document.body.appendChild(container);

  const colors = [
    "#ff9800",
    "#ff4444",
    "#00ffff",
    "#ffd700",
    "#ff69b4",
    "#44ff44",
    "#ff44ff",
    "#4488ff",
  ];
  const pieces = [];

  for (let i = 0; i < 80; i++) {
    const el = document.createElement("div");
    const color = colors[Math.floor(Math.random() * colors.length)];
    const size = 6 + Math.random() * 10;
    const startX = Math.random() * window.innerWidth;
    const startY = -20 - Math.random() * 100;
    const speed = 2 + Math.random() * 4;
    const drift = (Math.random() - 0.5) * 3;
    const rotSpeed = (Math.random() - 0.5) * 12;

    el.style.cssText = `position:absolute;width:${size}px;height:${size * 0.6}px;background:${color};border-radius:2px;left:0;top:0;pointer-events:none;`;
    container.appendChild(el);
    pieces.push({ el, x: startX, y: startY, speed, drift, rot: 0, rotSpeed });
  }

  let frame;
  function animate() {
    let alive = false;
    for (const p of pieces) {
      p.y += p.speed;
      p.x += p.drift;
      p.rot += p.rotSpeed;
      if (p.y < window.innerHeight + 50) alive = true;
      const opacity = Math.max(0, 1 - p.y / window.innerHeight);
      p.el.style.transform = `translate(${p.x}px, ${p.y}px) rotate(${p.rot}deg)`;
      p.el.style.opacity = opacity;
    }
    if (alive) {
      frame = requestAnimationFrame(animate);
    } else {
      cancelAnimationFrame(frame);
      container.remove();
    }
  }
  frame = requestAnimationFrame(animate);

  setTimeout(() => {
    cancelAnimationFrame(frame);
    if (container.parentNode) container.remove();
  }, 5000);
}

function createDevColorPicker() {
  const navRight = document.querySelector(".navbar-right");
  if (!navRight || document.getElementById("devColorPicker")) return;

  const wrapper = document.createElement("div");
  wrapper.id = "devColorPicker";
  wrapper.style.cssText =
    "display:flex;align-items:center;gap:6px;margin-right:8px;";

  const label = document.createElement("span");
  label.textContent = "Color:";
  label.style.cssText = "color:#ff9800;font-size:12px;";

  const input = document.createElement("input");
  input.type = "color";
  input.value = localStorage.getItem("talkomatic_devColor") || "#ff9800";
  input.title = "Change your text color";
  input.style.cssText =
    "width:28px;height:28px;border:1px solid #555;border-radius:4px;cursor:pointer;background:none;padding:0;";

  input.addEventListener("input", (e) => {
    const color = e.target.value;
    localStorage.setItem("talkomatic_devColor", color);
    socket.emit("dev set color", { color });
    applyDevColor(color);
  });

  wrapper.appendChild(label);
  wrapper.appendChild(input);

  const leaveBtn = navRight.querySelector(".leave-room");
  if (leaveBtn) {
    navRight.insertBefore(wrapper, leaveBtn);
  } else {
    navRight.appendChild(wrapper);
  }

  const savedColor = localStorage.getItem("talkomatic_devColor");
  if (savedColor) {
    socket.emit("dev set color", { color: savedColor });
    applyDevColor(savedColor);
  }
}

function getCurrentUserRow() {
  return document.querySelector(`.chat-row[data-user-id="${currentUserId}"]`);
}

function applyDevAppearanceToRow(row, user) {
  if (!row || !user) return;

  const info = row.querySelector(".user-info");
  const ci = row.querySelector(".chat-input");
  if (!info || !ci) return;

  const crown = info.querySelector(".dev-crown");
  const showDevFlair = !!user.isDev && !user.isHidden;

  if (showDevFlair) {
    row.classList.add("dev-user");
    ci.classList.add("dev-fire-text");

    if (user.devColor) {
      ci.style.setProperty("color", user.devColor, "important");
    }

    if (!crown) {
      const crownImg = document.createElement("img");
      crownImg.src = "images/icons/crown.gif";
      crownImg.alt = "Dev";
      crownImg.className = "dev-crown";
      info.insertBefore(crownImg, info.firstChild);
    }
  } else {
    row.classList.remove("dev-user");
    ci.classList.remove("dev-fire-text");
    ci.style.removeProperty("color");
    if (crown) crown.remove();
  }
}

function refreshCurrentUserAppearance() {
  const row = getCurrentUserRow();
  if (!row) return;

  const user = {
    id: currentUserId,
    isDev: currentUserIsDev,
    isHidden: currentUserIsHidden,
    devColor:
      currentUserIsDev && !currentUserIsHidden
        ? localStorage.getItem("talkomatic_devColor") || null
        : null,
  };

  applyDevAppearanceToRow(row, user);
}

function applyDevColor(color) {
  refreshCurrentUserAppearance();
}

function updateDevVanishButton(button) {
  if (!button) return;
  button.textContent = currentUserIsVanished ? "Vanish: ON" : "Vanish: OFF";
  button.title = currentUserIsVanished
    ? "You are vanished. Click to appear public."
    : "You are public. Click to vanish from normal users.";
}

function createDevVanishToggle() {
  const navRight = document.querySelector(".navbar-right");
  if (!navRight || document.getElementById("devVanishToggle")) return;

  const button = document.createElement("button");
  button.id = "devVanishToggle";
  button.type = "button";
  button.style.cssText =
    "display:flex;align-items:center;gap:6px;margin-right:8px;padding:6px 10px;border:1px solid #555;border-radius:4px;background:#111;color:#ff9800;cursor:pointer;font-size:12px;";

  updateDevVanishButton(button);

  button.addEventListener("click", () => {
    if (!socket.connected) return;
    socket.emit("dev set vanish", { isVanished: !currentUserIsVanished });
  });

  const leaveBtn = navRight.querySelector(".leave-room");
  if (leaveBtn) navRight.insertBefore(button, leaveBtn);
  else navRight.appendChild(button);
}

function updateDevHideButton(button) {
  if (!button) return;
  button.textContent = currentUserIsHidden ? "Hide: ON" : "Hide: OFF";
  button.title = currentUserIsHidden
    ? "Your dev flair is hidden from everyone. Click to show it again."
    : "Your dev flair is visible. Click to hide crown, color, and glow.";
}

function createDevHideToggle() {
  const navRight = document.querySelector(".navbar-right");
  if (!navRight || document.getElementById("devHideToggle")) return;

  const button = document.createElement("button");
  button.id = "devHideToggle";
  button.type = "button";
  button.style.cssText =
    "display:flex;align-items:center;gap:6px;margin-right:8px;padding:6px 10px;border:1px solid #555;border-radius:4px;background:#111;color:#ff9800;cursor:pointer;font-size:12px;";

  updateDevHideButton(button);

  button.addEventListener("click", () => {
    if (!socket.connected) return;
    socket.emit("dev set hide", { isHidden: !currentUserIsHidden });
  });

  const leaveBtn = navRight.querySelector(".leave-room");
  if (leaveBtn) navRight.insertBefore(button, leaveBtn);
  else navRight.appendChild(button);
}

// Dev-only overlay showing per-user context (IP) in the room
function renderDevContext() {
  if (!currentUserIsDev) return;
  document.querySelectorAll(".chat-row").forEach((row) => {
    const uid = row.dataset.userId;
    const info = row.querySelector(".user-info");
    if (!info) return;

    const existing = info.querySelector(".dev-meta");
    if (existing) existing.remove();

    const meta = devContext.get(uid);
    if (meta && meta.d) {
      const span = document.createElement("span");
      span.className = "dev-meta";
      span.textContent = meta.d;
      info.appendChild(span);
    }
  });
}

socket.on("dev context", (ctx) => {
  devContext.clear();
  for (const [uid, data] of Object.entries(ctx)) {
    devContext.set(uid, data);
  }
  renderDevContext();
});

socket.on("dev vanish status", (data) => {
  currentUserIsVanished = !!data?.isVanished;
  const button = document.getElementById("devVanishToggle");
  updateDevVanishButton(button);
});

socket.on("dev hide status", (data) => {
  currentUserIsHidden = !!data?.isHidden;
  const button = document.getElementById("devHideToggle");
  updateDevHideButton(button);
  refreshCurrentUserAppearance();
  renderDevContext();
});

// ── 13. ROOM UI ─────────────────────────────────────────────────────────────

function createUserRow(user, container) {
  const row = document.createElement("div");
  row.classList.add("chat-row");
  if (user.id === currentUserId) row.classList.add("current-user");
  row.dataset.userId = user.id;

  if (user.isDev && !user.isHidden) {
    row.classList.add("dev-user");
  }

  const info = document.createElement("span");
  info.className = "user-info";

  if (user.isDev && !user.isHidden) {
    const crown = document.createElement("img");
    crown.src = "images/icons/crown.gif";
    crown.alt = "Dev";
    crown.className = "dev-crown";
    info.appendChild(crown);
  }

  info.appendChild(
    document.createTextNode(`${user.username} / ${user.location}`),
  );

  // Mute button
  const muteBtn = document.createElement("button");
  muteBtn.className = "mute-button";
  muteBtn.innerHTML = "\uD83D\uDD0A";
  muteBtn.style.display = "none";
  muteBtn.addEventListener("click", () => {
    if (mutedUsers.has(user.id)) {
      mutedUsers.delete(user.id);
      muteBtn.innerHTML = "\uD83D\uDD0A";
      muteBtn.classList.remove("muted");
      const ci = row.querySelector(".chat-input");
      if (ci) ci.style.opacity = "1";
      const queued = storedMessagesForMutedUsers.get(user.id);
      if (queued?.length) {
        queued.forEach(displayChatMessage);
        storedMessagesForMutedUsers.delete(user.id);
      }
    } else {
      mutedUsers.add(user.id);
      muteBtn.innerHTML = "\uD83D\uDD07";
      muteBtn.classList.add("muted");
      const ci = row.querySelector(".chat-input");
      if (ci) ci.style.opacity = "0.3";
    }
  });

  // Vote button
  const voteBtn = document.createElement("button");
  voteBtn.className = "vote-button";
  voteBtn.innerHTML = "\uD83D\uDC4E 0";
  voteBtn.style.display = "none";
  if (user.id !== currentUserId) {
    voteBtn.addEventListener("click", () =>
      socket.emit("vote", { targetUserId: user.id }),
    );
  }

  info.appendChild(muteBtn);
  info.appendChild(voteBtn);

  // Dev force-kick button (visible to devs, not on themselves)
  if (currentUserIsDev && user.id !== currentUserId) {
    const kickBtn = document.createElement("button");
    kickBtn.className = "dev-kick-button";
    kickBtn.innerHTML = "\u26A1";
    kickBtn.title = "Force kick (Dev)";
    kickBtn.addEventListener("click", () => {
      if (confirm(`Force-kick ${user.username}?`)) {
        socket.emit("dev force kick", { targetUserId: user.id });
      }
    });
    info.appendChild(kickBtn);
  }

  // Chat input wrapper + contenteditable
  const wrapper = document.createElement("div");
  wrapper.className = "chat-input-wrapper";
  wrapper.style.cssText = "position:relative;width:100%;height:100%";

  const div = document.createElement("div");
  div.className = "chat-input";

  if (user.isDev && !user.isHidden) {
    div.classList.add("dev-fire-text");
  }

  if (user.devColor && user.isDev && !user.isHidden) {
    div.style.setProperty("color", user.devColor, "important");
  }

  div.contentEditable = user.id === currentUserId;
  div.style.cssText =
    "width:100%;height:100%;background:black;color:orange;overflow-x:hidden;overflow-y:auto;padding:6px 8px;box-sizing:border-box;outline:none;white-space:pre-wrap;word-break:break-word;position:absolute;top:0;left:0;z-index:2";
  div.spellcheck = false;

  if (user.devColor && user.isDev && !user.isHidden) {
    div.style.color = user.devColor;
  }

  if (user.id === currentUserId) {
    chatInput = div;
    div.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = e.clipboardData?.getData("text/plain") || "";
      document.execCommand("insertText", false, text);
    });
    div.addEventListener("input", () => {
      const emoteInfo = findEmoteAtCursor();
      if (emoteInfo) {
        currentEmoteInfo = emoteInfo;
        showAutocomplete(emoteInfo.prefix);
      } else hideAutocomplete();
      const text = getPlainText(div);
      if (text.includes(":") && /:([\w]+):/.test(text)) replaceEmotes(div);
      updateSentMessage();
    });
    div.addEventListener("keydown", (e) => {
      if (handleEmoteNavigation(e)) return;
      if (e.ctrlKey || e.metaKey) return;
      if (
        getPlainText(div).length >= MAX_MESSAGE_LENGTH &&
        ![
          "Backspace",
          "Delete",
          "ArrowLeft",
          "ArrowRight",
          "Home",
          "End",
        ].includes(e.key)
      ) {
        e.preventDefault();
      }
    });
    div.addEventListener("mousedown", (e) => e.stopPropagation());
    setTimeout(() => div.focus(), 0);
  }

  wrapper.appendChild(div);
  row.appendChild(info);
  row.appendChild(wrapper);
  container.appendChild(row);
  adjustVoteButtonVisibility();
  adjustMuteButtonVisibility();
  return row;
}

function updateRoomUI(roomData) {
  const container = document.querySelector(".chat-container");
  if (!container) return;
  while (container.firstChild) container.removeChild(container.firstChild);
  chatInput = null;
  if (roomData.users && Array.isArray(roomData.users)) {
    roomData.users.forEach((u) => createUserRow(u, container));
  }
  adjustLayout();
  if (chatInput)
    setTimeout(() => {
      chatInput.focus();
      placeCursorAtEnd(chatInput);
    }, 0);
}

function getRoomTypeDisplay(type) {
  switch (type) {
    case "public":
      return "Public";
    case "semi-private":
      return "Semi-Private";
    case "private":
      return "Private";
    default:
      return type || "";
  }
}

function updateRoomInfo(data) {
  const nameEl = document.querySelector(".room-name");
  const idEl = document.querySelector(".room-id");
  const typeEl = document.querySelector(".room-type");

  if (nameEl)
    nameEl.textContent = `Room: ${currentRoomName || data.roomName || data.roomId}`;
  if (idEl) idEl.textContent = `Room ID: ${data.roomId || currentRoomId}`;

  // "room joined" sends roomType, "room update" sends type
  const roomType = data.roomType || data.type;
  if (typeEl && roomType) {
    typeEl.textContent = `${getRoomTypeDisplay(roomType)} Room`;
  }

  if (!document.getElementById("emotesButton")) createEmotesDropdown();
}

// ── 14. LAYOUT ──────────────────────────────────────────────────────────────

let _stylesInjected = false;
function injectStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const style = document.createElement("style");
  style.setAttribute("data-emote-styles", "true");
  style.textContent = `
    .emote { display:inline-block; vertical-align:middle; width:auto; height:20px; margin:0 2px; }
    .chat-input { background-color:black; color:orange; outline:none; white-space:pre-wrap; word-break:break-word; }
    .emote-autocomplete { position:absolute; z-index:10000; background:#333; border:1px solid #555; border-radius:4px; max-height:300px; overflow-y:auto; width:200px; box-shadow:0 3px 10px rgba(0,0,0,0.3); }
    .emote-autocomplete-header { padding:5px 10px; font-weight:bold; border-bottom:1px solid #555; color:#eee; }
    .emote-autocomplete-list { max-height:250px; overflow-y:auto; }
    .emote-autocomplete-item { display:flex; align-items:center; padding:8px 10px; cursor:pointer; border-bottom:1px solid #444; color:#fff; }
    .emote-autocomplete-item.selected, .emote-autocomplete-item:hover { background-color:#555; }
    .emote-autocomplete-item img { width:auto; height:20px; margin-right:10px; vertical-align:middle; }
    .votes-counter { display:inline-block; margin-left:10px; padding:2px 6px; background:#333; border-radius:4px; font-size:14px; transition:color 0.3s ease; }
    .vote-button { cursor:pointer; transition:background-color 0.2s ease; }
    .vote-button.voted { background-color:#5c3d3d !important; color:#ff9090 !important; }
    .emotes-button { padding:5px 10px; background:#444; color:white; border:none; border-radius:4px; cursor:pointer; }
    .emotes-dropdown { background:#333; border:1px solid #555; border-radius:4px; padding:10px; max-width:300px; max-height:300px; overflow-y:auto; flex-wrap:wrap; gap:5px; }
    .emote-item { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:5px; cursor:pointer; border-radius:4px; background:#444; width:60px; height:60px; transition:background-color 0.2s ease; }
    .emote-item:hover { background-color:#555; }
    .emote-item img { width:30px; height:auto; }
    .emote-item span { font-size:10px; color:white; margin-top:5px; text-align:center; word-break:break-all; }
    #filterToggle { font-size:16px; opacity:1; transition:opacity 0.2s ease; }
    #filterToggle.filter-off { opacity:0.4; }

    /* Link safety */
    .chat-link { color:#4da6ff; text-decoration:underline; cursor:pointer; word-break:break-all; }
    .chat-link:hover { color:#80c1ff; }
    .link-warning-overlay { display:none; position:fixed; inset:0; z-index:100000; background:rgba(0,0,0,0.8); align-items:center; justify-content:center; }
    .link-warning-overlay.show { display:flex; }
    .link-warning-box { background:#1a1a1a; border:2px solid #ff9800; border-radius:12px; max-width:440px; width:90%; padding:24px 28px; text-align:center; color:#ccc; font-size:14px; line-height:1.6; box-shadow:0 12px 40px rgba(0,0,0,0.6); }
    .link-warning-icon { font-size:40px; margin-bottom:6px; }
    .link-warning-title { color:#ff9800; font-size:18px; font-weight:bold; margin:6px 0 12px; }
    .link-warning-url { background:#000; border:1px solid #555; border-radius:6px; padding:8px 10px; margin:12px 0; color:#fff; word-break:break-all; font-family:monospace; font-size:13px; max-height:80px; overflow-y:auto; }
    .link-warning-note { color:#888; font-size:12px; margin-top:10px; }
    .link-warning-buttons { display:flex; gap:10px; justify-content:center; margin-top:18px; }
    .link-warning-back { background:#444; color:#fff; border:none; padding:10px 18px; border-radius:6px; cursor:pointer; font-weight:bold; }
    .link-warning-back:hover { background:#555; }
    .link-warning-visit { background:#ff9800; color:#000; border:none; padding:10px 18px; border-radius:6px; cursor:pointer; font-weight:bold; }
    .link-warning-visit:hover { background:#ffb74d; }

    /* Mobile: prefer dynamic viewport units where supported */
    @supports (height: 100dvh) {
      html, body { height: 100dvh; }
      .page-container { height: 100dvh; min-height: 100dvh; }
    }
  `;
  document.head.appendChild(style);
}

function isMobile() {
  return window.innerWidth <= 768;
}

// On mobile, the collapsing URL bar and on-screen keyboard change
// visualViewport.height without a matching change to window.innerHeight,
// which left a dead white strip at the bottom. Desktop is unchanged since
// the two values match there.
function getAvailableViewportHeight() {
  if (
    window.visualViewport &&
    typeof window.visualViewport.height === "number"
  ) {
    return window.visualViewport.height;
  }
  return window.innerHeight;
}

function adjustLayout() {
  injectStyles();
  const container = document.querySelector(".chat-container");
  const rows = document.querySelectorAll(".chat-row");
  if (!container || rows.length === 0) return;

  const activeEl = document.activeElement;
  let activeUserId = null;
  if (activeEl?.classList.contains("chat-input")) {
    activeUserId = activeEl.closest(".chat-row")?.dataset.userId;
  }

  const layout = isMobile() ? "horizontal" : currentRoomLayout;
  if (layout === "horizontal") {
    container.style.flexDirection = "column";
    const containerTop = container.getBoundingClientRect().top;
    const avail = getAvailableViewportHeight() - containerTop;
    const gap = (rows.length - 1) * 10;
    const h = Math.floor((avail - gap) / rows.length);
    rows.forEach((row) => {
      row.style.height = `${h}px`;
      row.style.minHeight = "100px";
      row.style.width = "100%";
      const ui = row.querySelector(".user-info");
      const iw = row.querySelector(".chat-input-wrapper");
      iw.style.height = `${h - ui.offsetHeight - 2}px`;
    });
  } else {
    container.style.flexDirection = "row";
    const avail = container.offsetWidth;
    const gap = (rows.length - 1) * 10;
    const w = Math.floor((avail - gap) / rows.length);
    rows.forEach((row) => {
      row.style.width = `${w}px`;
      row.style.height = "100%";
      const ui = row.querySelector(".user-info");
      const iw = row.querySelector(".chat-input-wrapper");
      iw.style.height = `calc(100% - ${ui.offsetHeight}px - 2px)`;
    });
  }

  if (activeUserId) {
    const el = document.querySelector(
      `.chat-row[data-user-id="${activeUserId}"] .chat-input`,
    );
    if (el) setTimeout(() => el.focus(), 0);
  }
}

function handleViewportChange() {
  const vp = document.querySelector("meta[name=viewport]");
  if (window.visualViewport) {
    // -1 tolerates sub-pixel rounding so the keyboard branch only fires
    // when the keyboard or URL bar is genuinely eating space
    if (window.visualViewport.height < window.innerHeight - 1) {
      if (vp)
        vp.setAttribute(
          "content",
          "width=device-width, initial-scale=1, maximum-scale=1",
        );
      document.body.style.height = `${window.visualViewport.height}px`;
    } else {
      if (vp) vp.setAttribute("content", "width=device-width, initial-scale=1");
      // Clear the inline override so the dvh rule applies instead
      document.body.style.height = "";
    }
  }
  adjustLayout();
}

// ── 15. INVITE LINKS & DATE/TIME ────────────────────────────────────────────

function generateInviteLink() {
  const url = new URL(window.location.href);
  url.searchParams.set("roomId", currentRoomId);
  url.searchParams.delete("accessCode"); // never leak codes in invite links
  return url.href;
}

// No-op until a room has been joined, so an empty roomId never renders
function updateInviteLink() {
  const el = document.getElementById("inviteLink");
  const copyBtn = document.getElementById("copyInviteLink");
  if (!currentRoomId) {
    if (el) el.textContent = "";
    if (copyBtn) copyBtn.style.display = "none";
    return;
  }
  const link = generateInviteLink();
  el.textContent = link;
  el.href = link;
  copyBtn.style.display = "inline-block";
}

function copyInviteLink() {
  navigator.clipboard
    .writeText(generateInviteLink())
    .then(() => showInfoModal("Invite link copied to clipboard!"))
    .catch(() => showErrorModal("Failed to copy invite link."));
}

const dateTimeElement = document.querySelector("#dateTime");
function updateDateTime() {
  const now = new Date();
  dateTimeElement.querySelector(".date").textContent = now.toLocaleDateString(
    "en-US",
    { weekday: "long", year: "numeric", month: "short", day: "numeric" },
  );
  dateTimeElement.querySelector(".time").textContent = now.toLocaleTimeString(
    "en-US",
    { hour: "2-digit", minute: "2-digit", hour12: true },
  );
}

// ── 16. SOCKET EVENT HANDLERS ───────────────────────────────────────────────

socket.on("chat update", displayChatMessage);

socket.on("update votes", updateVotesUI);

socket.on("kicked", () => {
  showInfoModal(
    "You have been removed from the room by a majority vote.",
    () => {
      window.location.href = "/index.html";
    },
  );
});

socket.on("room full", () => {
  showInfoModal(
    "This room is full. You will be redirected to the lobby.",
    () => {
      window.location.href = "/index.html";
    },
  );
});

socket.on("room joined", (data) => {
  currentUserId = data.userId;
  currentRoomId = data.roomId;
  currentUsername = data.username;
  currentLocation = data.location;
  currentRoomLayout = data.layout || currentRoomLayout;
  currentRoomName = data.roomName;

  currentUserIsDev = !!data.isDev;
  currentUserIsHidden = !!data.isHidden;
  currentUserIsVanished = !!data.isVanished;

  updateRoomInfo(data);
  updateRoomUI(data);
  if (data.votes) updateVotesUI(data.votes);
  if (data.currentMessages) updateCurrentMessages(data.currentMessages);
  updateInviteLink();
  createEmotesDropdown();

  if (currentUserIsDev) {
    createDevColorPicker();
    createDevHideToggle();
    createDevVanishToggle();
    updateDevHideButton(document.getElementById("devHideToggle"));
    if (!currentUserIsHidden) triggerDevConfetti();
    const savedColor = localStorage.getItem("talkomatic_devColor");
    if (savedColor) applyDevColor(savedColor);
  }

  renderDevContext();
  updateDevHideButton(document.getElementById("devHideToggle"));

  setTimeout(() => {
    if (chatInput) {
      chatInput.focus();
      placeCursorAtEnd(chatInput);
    }
  }, 100);
});

socket.on("room not found", () => {
  showInfoModal(
    "The room does not exist or has been deleted. Redirecting to lobby.",
    () => {
      window.location.href = "/index.html";
    },
  );
});

socket.on("user joined", (data) => {
  if (!document.querySelector(`.chat-row[data-user-id="${data.id}"]`)) {
    const c = document.querySelector(".chat-container");
    if (c) {
      createUserRow(data, c);
      adjustLayout();
      updateRoomInfo(data);
      playJoinSound();

      // A new join can cross the voting threshold
      updateVotesUI(currentVotes);

      // Confetti only on the dev's own screen
      if (data.isDev && !data.isHidden && currentUserIsDev) {
        triggerDevConfetti();
      }
    }
    if (chatInput) setTimeout(() => chatInput.focus(), 10);
  }
});

socket.on("user left", (userId) => {
  if (userId !== currentUserId) {
    const row = document.querySelector(`.chat-row[data-user-id="${userId}"]`);
    if (row) {
      row.remove();
      adjustLayout();
      playLeaveSound();

      // Dropping below the voting minimum must clean up vote UI immediately
      adjustVoteButtonVisibility();
      updateVotesUI(currentVotes);
    }
    if (chatInput) setTimeout(() => chatInput.focus(), 10);
  }
});

socket.on("room update", (roomData) => {
  currentRoomLayout = roomData.layout || currentRoomLayout;
  updateRoomInfo(roomData);
  const activeEl = document.activeElement;
  const saved = new Map();
  let savedCursor = 0;

  document.querySelectorAll(".chat-row").forEach((row) => {
    const uid = row.dataset.userId;
    const ci = row.querySelector(".chat-input");
    if (ci) {
      if (uid === currentUserId) {
        saved.set(uid, selfRawText);
      } else {
        saved.set(
          uid,
          ci.dataset.rawText !== undefined
            ? ci.dataset.rawText
            : getPlainText(ci),
        );
      }
      if (activeEl === ci) savedCursor = getCursorPosition(ci);
    }
  });

  const existing = new Set();
  document
    .querySelectorAll(".chat-row")
    .forEach((r) => existing.add(r.dataset.userId));
  if (roomData.users) {
    const c = document.querySelector(".chat-container");
    roomData.users.forEach((u) => {
      if (!existing.has(u.id)) createUserRow(u, c);
    });
  }
  const current = new Set(roomData.users.map((u) => u.id));
  document.querySelectorAll(".chat-row").forEach((r) => {
    if (!current.has(r.dataset.userId) && r.dataset.userId !== currentUserId)
      r.remove();
  });

  // Refresh dev appearance on existing rows
  if (roomData.users) {
    roomData.users.forEach((u) => {
      const row = document.querySelector(`.chat-row[data-user-id="${u.id}"]`);
      if (!row) return;
      applyDevAppearanceToRow(row, u);
    });
  }

  if (currentUserIsDev) refreshCurrentUserAppearance();

  saved.forEach((rawVal, uid) => {
    const ci = document.querySelector(
      `.chat-row[data-user-id="${uid}"] .chat-input`,
    );
    if (!ci) return;
    if (uid === currentUserId) {
      selfRawText = rawVal;
      const display = applyWordFilter(rawVal);
      ci.innerHTML = "";
      ci.textContent = display;
      replaceEmotes(ci);
      selfIsFiltered = wordFilterEnabled && clientWordFilter?.ready;
      if (
        activeEl?.classList.contains("chat-input") &&
        activeEl.closest(".chat-row")?.dataset.userId === uid
      ) {
        ci.focus();
        try {
          setCursorPosition(ci, savedCursor);
        } catch {
          placeCursorAtEnd(ci);
        }
      }
    } else {
      renderOtherUserMessage(ci, rawVal);
    }
  });

  // Re-render vote UI after the row set may have changed
  adjustVoteButtonVisibility();
  updateVotesUI(roomData.votes || currentVotes);
  adjustLayout();

  renderDevContext();
});

socket.on("access code required", () => {
  showInputModal(
    "Access Code Required",
    "Please enter the 6-digit access code for this room:",
    {
      placeholder: "6-digit code",
      maxLength: "6",
      validate: (v) =>
        !v
          ? "Access code is required"
          : v.length !== 6 || !/^\d+$/.test(v)
            ? "Invalid code."
            : true,
    },
    (confirmed, code) => {
      if (confirmed && code) joinRoom(currentRoomId, code);
      else
        showInfoModal("You will be redirected to the lobby.", () => {
          window.location.href = "/index.html";
        });
    },
  );
});

socket.on("afk timeout", (data) => {
  showInfoModal(data.message ?? "Removed from room due to inactivity.", () => {
    window.location.href = data.redirectTo ?? "/";
  });
});

socket.on("error", (error) => {
  console.log(error);
  showErrorModal(
    (error.error.replaceDefaultText ? "" : "An error occurred: ") +
      error.error.message,
  );
});

socket.on("dev kick success", (data) => {
  console.log(`[DEV] Kicked "${data.targetUsername}" from "${data.roomName}"`);
});

// ── 17. INITIALIZATION ──────────────────────────────────────────────────────

function joinRoom(roomId, accessCode = null) {
  socket.emit("join room", { roomId, accessCode });
}

// Reads roomId from the URL and scrubs any legacy ?accessCode= parameter
// from the address bar and browser history
function readAndScrubUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get("roomId");
  const accessCode = params.get("accessCode"); // legacy fallback only

  if (accessCode !== null) {
    params.delete("accessCode");
    const query = params.toString();
    const cleanUrl = window.location.pathname + (query ? `?${query}` : "");
    try {
      history.replaceState(null, "", cleanUrl);
    } catch {
      // history API unavailable, join still works
    }
  }

  return { roomId, accessCode };
}

async function initRoom() {
  const filter = new ClientWordFilter();
  await Promise.all([loadEmotes(), filter.init()]);
  if (filter.ready) clientWordFilter = filter;
  else console.warn("[WordFilter] Not available.");

  const saved = localStorage.getItem("wordFilterEnabled");
  wordFilterEnabled = saved !== "false";
  updateFilterToggleUI();

  const { roomId, accessCode } = readAndScrubUrlParams();

  if (roomId) {
    currentRoomId = roomId;
    joinRoom(roomId, accessCode);
  } else {
    showInfoModal("No room ID provided. Redirecting to lobby.", () => {
      window.location.href = "/index.html";
    });
  }
}

window.addEventListener("load", () => {
  injectStyles();
  initRoom();
  updateDateTime();
  adjustLayout();
  updateInviteLink();
  initializeAppDirectory();

  document
    .getElementById("copyInviteLink")
    .addEventListener("click", copyInviteLink);

  // Sound
  const savedMute = localStorage.getItem("soundEnabled");
  if (savedMute !== null) {
    soundEnabled = JSON.parse(savedMute);
    updateMuteIcon();
  }
  muteToggleButton.addEventListener("click", toggleMute);

  // Word filter toggle
  const filterBtn = document.getElementById("filterToggle");
  if (filterBtn) filterBtn.addEventListener("click", toggleWordFilter);

  // Viewport: immediate handler so the mobile keyboard reflows without lag
  if (window.visualViewport)
    window.visualViewport.addEventListener("resize", handleViewportChange);

  // Link safety (delegated click handler + warning popup)
  initLinkSafety();

  // Ensure autocomplete element exists
  if (!document.getElementById("emoteAutocomplete")) {
    const el = document.createElement("div");
    el.id = "emoteAutocomplete";
    el.className = "emote-autocomplete";
    el.style.display = "none";
    document.body.appendChild(el);
    emoteAutocomplete = el;
  }
});

document.querySelector(".leave-room").addEventListener("click", () => {
  socket.emit("leave room");
  window.location.href = "/index.html";
});

// Window resize runs ONE debounced layout pass (the visualViewport listener
// above stays immediate for keyboard responsiveness)
let viewportDebounceTimer = null;
function debouncedViewportChange() {
  if (viewportDebounceTimer) clearTimeout(viewportDebounceTimer);
  viewportDebounceTimer = setTimeout(() => {
    viewportDebounceTimer = null;
    handleViewportChange();
  }, 100);
}

setInterval(updateDateTime, 1000);
window.addEventListener("resize", debouncedViewportChange);
