# Bot Development Best Practices

Essential guidelines and patterns for creating reliable Talkomatic bots.

## 1. Error Handling

```javascript
class BotErrorHandler {
  constructor(socket) {
    this.socket = socket;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.setupErrorHandlers();
  }

  setupErrorHandlers() {
    // Socket errors
    this.socket.on('error', this.handleError.bind(this));
    this.socket.on('connect_error', this.handleConnectionError.bind(this));
    this.socket.on('disconnect', this.handleDisconnect.bind(this));
    
    // Global error handler
    process.on('uncaughtException', this.handleUncaughtException.bind(this));
    process.on('unhandledRejection', this.handleUnhandledRejection.bind(this));
  }

  handleError(error) {
    console.error('Socket error:', error);
    this.logError('socket', error);
  }

  handleConnectionError(error) {
    console.error('Connection error:', error);
    this.logError('connection', error);
    this.attemptReconnect();
  }

  handleDisconnect(reason) {
    console.log('Disconnected:', reason);
    this.attemptReconnect();
  }

  handleUncaughtException(error) {
    console.error('Uncaught exception:', error);
    this.logError('uncaught', error);
    process.exit(1);
  }

  handleUnhandledRejection(reason, promise) {
    console.error('Unhandled rejection:', reason);
    this.logError('rejection', reason);
  }

  async attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }

    const backoffTime = Math.pow(2, this.reconnectAttempts) * 1000;
    await new Promise(resolve => setTimeout(resolve, backoffTime));
    
    this.reconnectAttempts++;
    this.socket.connect();
  }

  logError(type, error) {
    // Implement your error logging logic here
  }
}
```

> **Warning:** Always implement comprehensive error handling to ensure your bot can recover from failures.

## 2. Rate Limiting

```javascript
class RateLimiter {
  constructor() {
    this.limits = new Map();
    this.setupDefaultLimits();
  }

  setupDefaultLimits() {
    // Define rate limits
    this.addLimit('message', 500, 10);     // 10 messages per 500ms
    this.addLimit('roomJoin', 5000, 1);    // 1 room join per 5s
    this.addLimit('roomCreate', 30000, 1); // 1 room creation per 30s
  }

  addLimit(action, window, maxCalls) {
    this.limits.set(action, {
      window,
      maxCalls,
      calls: []
    });
  }

  canPerformAction(action) {
    const limit = this.limits.get(action);
    if (!limit) return true;

    const now = Date.now();
    const windowStart = now - limit.window;
    
    // Remove old calls
    limit.calls = limit.calls.filter(time => time > windowStart);
    
    // Check if under limit
    if (limit.calls.length < limit.maxCalls) {
      limit.calls.push(now);
      return true;
    }
    
    return false;
  }

  getNextAllowedTime(action) {
    const limit = this.limits.get(action);
    if (!limit || limit.calls.length === 0) return Date.now();
    
    return limit.calls[0] + limit.window;
  }

  async waitForAction(action) {
    while (!this.canPerformAction(action)) {
      const nextTime = this.getNextAllowedTime(action);
      const waitTime = nextTime - Date.now();
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    return true;
  }
}
```

> **Info:** Rate limiting prevents your bot from being disconnected or banned for excessive activity.

## 3. Logging and Monitoring

```javascript
class BotLogger {
  constructor(options = {}) {
    this.logLevel = options.logLevel || 'info';
    this.logFile = options.logFile || 'bot.log';
    this.setupLogging();
  }

  setupLogging() {
    this.levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3
    };
  }

  log(level, message, data = {}) {
    if (this.levels[level] <= this.levels[this.logLevel]) {
      const timestamp = new Date().toISOString();
      const logEntry = {
        timestamp,
        level,
        message,
        data
      };

      console.log(JSON.stringify(logEntry));
      this.writeToFile(logEntry);
    }
  }

  writeToFile(entry) {
    const fs = require('fs').promises;
    fs.appendFile(this.logFile, JSON.stringify(entry) + '\n')
      .catch(err => console.error('Failed to write log:', err));
  }

  error(message, data) { this.log('error', message, data); }
  warn(message, data) { this.log('warn', message, data); }
  info(message, data) { this.log('info', message, data); }
  debug(message, data) { this.log('debug', message, data); }
}
```

## 4. State Management

```javascript
class BotState {
  constructor() {
    this.state = {
      connected: false,
      currentRoom: null,
      users: new Map(),
      messageQueue: [],
      lastAction: null
    };
  }

  updateState(key, value) {
    this.state[key] = value;
    this.emit('stateChange', { key, value });
  }

  getState(key) {
    return this.state[key];
  }

  saveState() {
    // Implement state persistence if needed
  }

  loadState() {
    // Implement state loading if needed
  }
}
```

## 5. Configuration Management

```javascript
class BotConfig {
  constructor() {
    this.config = {
      username: process.env.BOT_USERNAME || 'DefaultBot',
      location: process.env.BOT_LOCATION || 'BotLand',
      serverUrl: process.env.SERVER_URL || 'http://localhost:3000',
      logLevel: process.env.LOG_LEVEL || 'info',
      features: {
        autoReconnect: true,
        messageLogging: true,
        rateLimiting: true,
        stateManagement: true
      }
    };
  }

  get(key) {
    return key.split('.').reduce((obj, part) => obj && obj[part], this.config);
  }

  set(key, value) {
    const parts = key.split('.');
    const last = parts.pop();
    const obj = parts.reduce((obj, part) => obj && obj[part], this.config);
    if (obj) obj[last] = value;
  }
}
```

## Best Practices Summary

> **Tip:** Follow these key guidelines for robust bot development:

1. **Error Handling**
   - Implement comprehensive error catching
   - Use exponential backoff for reconnection
   - Log all errors for debugging
   - Handle connection losses gracefully

2. **Rate Limiting**
   - Respect server limits
   - Implement client-side throttling
   - Use queuing for messages
   - Track API usage

3. **Monitoring**
   - Log all important events
   - Track bot performance
   - Monitor resource usage
   - Set up alerts for issues

4. **Code Organization**
   - Use modular architecture
   - Separate concerns
   - Document your code
   - Follow consistent patterns

5. **Security**
   - Store credentials securely
   - Validate all input
   - Use environment variables
   - Implement proper authentication

## Implementation Example

```javascript
class TalkomaticBot {
  constructor(options = {}) {
    this.config = new BotConfig();
    this.logger = new BotLogger(options.logging);
    this.rateLimiter = new RateLimiter();
    this.state = new BotState();
    
    this.socket = io(this.config.get('serverUrl'), {
      transports: ['websocket'],
      autoConnect: true
    });

    this.errorHandler = new BotErrorHandler(this.socket);
    
    this.initialize();
  }

  async initialize() {
    try {
      await this.connect();
      this.setupEventHandlers();
      this.logger.info('Bot initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize bot', error);
      throw error;
    }
  }

  setupEventHandlers() {
    // Implement your event handlers here
  }
}

// Usage
const bot = new TalkomaticBot({
  logging: {
    level: 'debug',
    file: 'bot.log'
  }
});
```

> **Note:** This implementation provides a solid foundation for building reliable Talkomatic bots.

Remember to adapt these practices based on your specific bot's needs while maintaining the core principles of reliability, security, and maintainability.