const io = require('socket.io-client');
const uuid = require('uuid').v4;

const SERVER_URL = 'http://localhost:3000';
const NUM_BOTS = 15; // Test above/below MAX_CONNECTIONS_PER_IP (10 or 50 if tweaked)
const JOIN_SPAM_RATE_MS = 2; // 500 joins/sec per bot - insane flood
const ROOM_ID = '123456'; // REPLACE WITH A REAL ROOM ID YOU CREATED
const CONNECTION_DELAY_MS = 100; // Match your tweaked CONNECTION_DELAY

const usernames = ['JoinSpammer', 'RoomFlooder', 'SocketBlaster', 'ChaosBot'];
const locations = ['Web', 'SpamZone', 'FloodLand'];
const bots = [];

function createBot(botId) {
  const socket = io(SERVER_URL, {
    reconnection: false,
    transports: ['websocket'],
  });
  const botUsername = `${usernames[Math.floor(Math.random() * usernames.length)]}${botId}`;
  const botLocation = locations[Math.floor(Math.random() * locations.length)];
  let userId;

  socket.on('connect', () => {
    console.log(`Bot ${botId} (${botUsername}) connected`);
    socket.emit('join lobby', { username: botUsername, location: botLocation });
  });

  socket.on('signin status', (data) => {
    if (data.isSignedIn) {
      userId = data.userId;
      console.log(`Bot ${botId} signed in as ${botUsername} with ID ${userId}`);

      // Start spamming join room
      setInterval(() => {
        socket.emit('join room', { roomId: ROOM_ID });
      }, JOIN_SPAM_RATE_MS);
    }
  });

  socket.on('room joined', (data) => {
    console.log(`Bot ${botId} joined room ${data.roomId}`);
    // Optionally leave immediately to rejoin and spam more
    socket.emit('leave room');
  });

  socket.on('error', (err) => {
    console.log(`Bot ${botId} error: ${err.error.code} - ${err.error.message}`);
  });

  socket.on('connect_error', (err) => {
    console.error(`Bot ${botId} connection error: ${err.message}`);
  });

  socket.on('disconnect', (reason) => {
    console.log(`Bot ${botId} disconnected: ${reason}`);
  });

  return socket;
}

function spawnBots() {
  let i = 0;
  const interval = setInterval(() => {
    if (i < NUM_BOTS) {
      bots.push(createBot(i));
      i++;
    } else {
      clearInterval(interval);
    }
  }, CONNECTION_DELAY_MS);
}

spawnBots();

process.on('SIGINT', () => {
  console.log('Shutting down bots...');
  bots.forEach((socket, index) => {
    socket.disconnect();
    console.log(`Bot ${index} closed`);
  });
  process.exit(0);
});

console.log(`Spawning ${NUM_BOTS} bots to flood ${SERVER_URL} with join room spam...`);