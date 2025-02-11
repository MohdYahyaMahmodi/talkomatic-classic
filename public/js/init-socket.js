// init-socket.js
//
// 1) We assume `generateGuestId()` is already available from fingerprint.js
// 2) We connect to the server with the "guestId" query
const guestId = generateGuestId();
const socket = io({
  query: { guestId }
});

// Now "socket" becomes a global variable accessible by lobby-client.js
