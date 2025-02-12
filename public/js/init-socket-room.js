// init-socket-room.js
const guestId = generateGuestId();
const socket = io({
  query: { guestId }
});
