# Message Handling

Learn how to effectively handle messages in your Talkomatic bot.

## Message Handler Class

```javascript
class MessageHandler {
  constructor(socket) {
    this.socket = socket;
    this.messageBuffer = '';
    this.MAX_MESSAGE_LENGTH = 5000;
    this.setupMessageHandlers();
  }

  setupMessageHandlers() {
    // Listen for incoming messages
    this.socket.on('chat update', this.handleIncomingMessage.bind(this));
    this.socket.on('offensive word detected', this.handleOffensiveWord.bind(this));
  }

  handleIncomingMessage(data) {
    const { userId, username, diff } = data;
    
    // Track message state for this user
    if (!this.userMessages) {
      this.userMessages = new Map();
    }
    
    let currentMessage = this.userMessages.get(userId) || '';
    
    // Apply the diff
    switch (diff.type) {
      case 'full-replace':
        currentMessage = diff.text;
        break;
      case 'add':
        currentMessage = currentMessage.slice(0, diff.index) + 
                        diff.text + 
                        currentMessage.slice(diff.index);
        break;
      case 'delete':
        currentMessage = currentMessage.slice(0, diff.index) + 
                        currentMessage.slice(diff.index + diff.count);
        break;
      case 'replace':
        currentMessage = currentMessage.slice(0, diff.index) + 
                        diff.text + 
                        currentMessage.slice(diff.index + diff.text.length);
        break;
    }

    this.userMessages.set(userId, currentMessage);
    
    // Process the message
    this.processMessage(userId, username, currentMessage);
  }

  processMessage(userId, username, message) {
    // Override this method in your bot implementation
    console.log(`Message from ${username}: ${message}`);
  }

  sendMessage(text) {
    // Ensure message length compliance
    const message = text.slice(0, this.MAX_MESSAGE_LENGTH);
    
    // Send as full replacement
    this.socket.emit('chat update', {
      diff: {
        type: 'full-replace',
        text: message
      }
    });
    
    // Update local buffer
    this.messageBuffer = message;
  }

  updateMessage(newText, startIndex = 0) {
    const oldText = this.messageBuffer;
    
    // Calculate optimal diff
    if (oldText === newText) return;
    
    let diff;
    if (newText.startsWith(oldText)) {
      // Adding text
      diff = {
        type: 'add',
        text: newText.slice(oldText.length),
        index: oldText.length
      };
    } else if (oldText.startsWith(newText)) {
      // Deleting text
      diff = {
        type: 'delete',
        count: oldText.length - newText.length,
        index: newText.length
      };
    } else {
      // Replace section
      diff = {
        type: 'replace',
        text: newText.slice(startIndex),
        index: startIndex
      };
    }
    
    this.socket.emit('chat update', { diff });
    this.messageBuffer = newText;
  }

  handleOffensiveWord(data) {
    // Handle filtered content
    console.log('Message filtered:', data.filteredMessage);
    this.messageBuffer = data.filteredMessage;
  }
}

// Example usage with command handling
class CommandBot extends MessageHandler {
  constructor(socket) {
    super(socket);
    this.commands = new Map();
    this.setupCommands();
  }

  setupCommands() {
    this.commands.set('!hello', this.handleHello.bind(this));
    this.commands.set('!time', this.handleTime.bind(this));
  }

  processMessage(userId, username, message) {
    // Check for commands
    const args = message.split(' ');
    const command = args[0].toLowerCase();
    
    if (this.commands.has(command)) {
      this.commands.get(command)(userId, username, args.slice(1));
    }
  }

  handleHello(userId, username) {
    this.sendMessage(`Hello, ${username}! 👋`);
  }

  handleTime(userId, username) {
    const time = new Date().toLocaleTimeString();
    this.sendMessage(`Current time: ${time}`);
  }
}
```

> **Info:** The MessageHandler class provides a foundation for handling Talkomatic's real-time message updates.

## Typing Indicators

```javascript
class TypingIndicator {
  constructor(socket) {
    this.socket = socket;
    this.isTyping = false;
    this.typingTimeout = null;
  }

  startTyping() {
    if (!this.isTyping) {
      this.isTyping = true;
      this.socket.emit('typing', { isTyping: true });
    }
    this.resetTypingTimeout();
  }

  stopTyping() {
    if (this.isTyping) {
      this.isTyping = false;
      this.socket.emit('typing', { isTyping: false });
    }
  }

  resetTypingTimeout() {
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
    }
    this.typingTimeout = setTimeout(() => this.stopTyping(), 2000);
  }
}
```

> **Tip:** Use typing indicators to make your bot feel more natural and interactive.