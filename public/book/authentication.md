# Bot Authentication

This guide explains how to properly authenticate your bot with the Talkomatic server.

## Authentication Flow

```javascript
const { io } = require('socket.io-client');

class BotAuthenticator {
  constructor(config) {
    this.socket = io(config.serverUrl, {
      transports: ['websocket'],
      autoConnect: true
    });
    
    this.credentials = {
      username: config.username,
      location: config.location
    };
    
    this.authenticated = false;
  }

  async authenticate() {
    return new Promise((resolve, reject) => {
      // Check existing session
      this.socket.emit('check signin status');
      
      // Handle signin status
      this.socket.on('signin status', (data) => {
        if (data.isSignedIn) {
          this.authenticated = true;
          resolve(data);
        } else {
          this.joinLobby();
        }
      });
      
      // Handle successful lobby join
      this.socket.on('lobby update', () => {
        if (!this.authenticated) {
          this.authenticated = true;
          resolve(this.credentials);
        }
      });
      
      // Handle errors
      this.socket.on('error', (error) => {
        reject(new Error(`Authentication failed: ${error}`));
      });
      
      // Set timeout
      setTimeout(() => {
        if (!this.authenticated) {
          reject(new Error('Authentication timeout'));
        }
      }, 5000);
    });
  }

  joinLobby() {
    this.socket.emit('join lobby', this.credentials);
  }
}
```

## Usage Example

```javascript
const config = {
  serverUrl: 'http://localhost:3000',
  username: 'MyBot',
  location: 'BotLand'
};

const auth = new BotAuthenticator(config);

auth.authenticate()
  .then(session => {
    console.log('Bot authenticated:', session);
  })
  .catch(error => {
    console.error('Authentication failed:', error);
  });
```

## Security Considerations

> **Warning:** Important security practices:
- Implement rate limiting in your bot
- Handle reconnection gracefully
- Monitor for authentication failures

## Session Management

The server uses express-session for session management. Your bot should handle session persistence:

```javascript
class SessionManager {
  constructor(socket) {
    this.socket = socket;
    this.sessionData = null;
  }

  saveSession(data) {
    this.sessionData = data;
    // Optional: persist to file/database
  }

  restoreSession() {
    if (!this.sessionData) return false;
    
    return new Promise((resolve, reject) => {
      this.socket.emit('check signin status');
      
      this.socket.once('signin status', (status) => {
        resolve(status.isSignedIn);
      });
      
      setTimeout(() => reject(new Error('Session restore timeout')), 5000);
    });
  }
}
```

## Rate Limiting

> **Info:** The server implements rate limiting:
- 1000 requests per 15 minutes
- 30-second cooldown on room creation
- Message length and frequency limits

Implement rate limiting in your bot:

```javascript
class RateLimiter {
  constructor() {
    this.lastAction = {};
    this.limits = {
      message: 500,    // ms between messages
      roomJoin: 5000,  // ms between room joins
      roomCreate: 30000 // ms between room creations
    };
  }

  canPerformAction(action) {
    const now = Date.now();
    const lastTime = this.lastAction[action] || 0;
    const limit = this.limits[action];
    
    if (now - lastTime < limit) {
      return false;
    }
    
    this.lastAction[action] = now;
    return true;
  }
}
```

## Best Practices

> **Tip:** Follow these authentication best practices:
1. Always verify successful authentication before performing actions
2. Implement exponential backoff for reconnection attempts
3. Handle session expiration gracefully
4. Monitor connection state
5. Log authentication events for debugging

## Error Handling

Implement comprehensive error handling:

```javascript
class BotErrorHandler {
  constructor(socket) {
    this.socket = socket;
    this.setupErrorHandlers();
  }

  setupErrorHandlers() {
    this.socket.on('error', this.handleError.bind(this));
    this.socket.on('connect_error', this.handleConnectionError.bind(this));
    this.socket.on('disconnect', this.handleDisconnect.bind(this));
  }

  handleError(error) {
    console.error('Socket error:', error);
    // Implement recovery logic
  }

  handleConnectionError(error) {
    console.error('Connection error:', error);
    // Implement reconnection logic
  }

  handleDisconnect(reason) {
    console.log('Disconnected:', reason);
    // Implement reconnection logic
  }
}
```