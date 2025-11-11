// Chat functionality for the meeting room
class ChatManager {
    constructor(socket, meetingId) {
        this.socket = socket;
        this.meetingId = meetingId;
        this.messageHistory = [];
        this.emojiPicker = null;
        this.isTyping = false;
        this.typingTimer = null;
        
        this.initializeElements();
        this.setupEventListeners();
        this.loadChatHistory();
    }
    
    initializeElements() {
        this.chatPanel = document.getElementById('chatPanel');
        this.chatMessages = document.getElementById('chatMessages');
        this.messageInput = document.getElementById('messageInput');
        this.sendBtn = document.getElementById('sendBtn');
        this.emojiBtn = document.getElementById('emojiBtn');
        this.emojiPicker = document.getElementById('emojiPicker');
        this.chatToggle = document.getElementById('chatBtn');
        this.typingIndicator = document.getElementById('typingIndicator');
    }
    
    setupEventListeners() {
        // Send message events
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        this.messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        // Typing indicator
        this.messageInput.addEventListener('input', () => this.handleTyping());
        
        // Emoji picker
        this.emojiBtn.addEventListener('click', () => this.toggleEmojiPicker());
        
        // Socket events
        this.socket.on('new_message', (data) => this.receiveMessage(data));
        this.socket.on('user_typing', (data) => this.showTypingIndicator(data));
        this.socket.on('user_stopped_typing', (data) => this.hideTypingIndicator(data));
        
        // File sharing (if implemented)
        this.setupFileSharing();
        
        // Chat commands
        this.setupChatCommands();
    }
    
    sendMessage() {
        const message = this.messageInput.value.trim();
        if (!message) return;
        
        // Check for commands
        if (message.startsWith('/')) {
            this.handleCommand(message);
            return;
        }
        
        // Send regular message
        this.socket.emit('send_message', {
            meeting_id: this.meetingId,
            message: message,
            timestamp: new Date().toISOString()
        });
        
        this.messageInput.value = '';
        this.stopTyping();
    }
    
    receiveMessage(data) {
        this.addMessage(data);
        this.messageHistory.push(data);
        
        // Show notification if chat is closed
        if (!this.chatPanel.classList.contains('open')) {
            this.showChatNotification();
        }
        
        // Auto-scroll to bottom
        this.scrollToBottom();
    }
    
    addMessage(data) {
        const messageElement = this.createMessageElement(data);
        this.chatMessages.appendChild(messageElement);
        
        // Animate message in
        requestAnimationFrame(() => {
            messageElement.style.opacity = '1';
            messageElement.style.transform = 'translateY(0)';
        });
    }
    
    createMessageElement(data) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'chat-message';
        messageDiv.style.opacity = '0';
        messageDiv.style.transform = 'translateY(20px)';
        messageDiv.style.transition = 'all 0.3s ease';
        
        const isCurrentUser = data.username === window.currentUsername;
        const isSystemMessage = data.isSystem || false;
        
        if (isSystemMessage) {
            messageDiv.classList.add('system-message');
            messageDiv.innerHTML = `
                <div class="system-content">
                    <i class="fas fa-info-circle"></i>
                    ${this.formatMessage(data.message)}
                </div>
                <div class="message-time">${this.formatTime(data.timestamp)}</div>
            `;
        } else {
            messageDiv.classList.add(isCurrentUser ? 'own-message' : 'other-message');
            messageDiv.innerHTML = `
                <div class="message-header">
                    <div class="message-author">
                        <div class="user-avatar">${data.username.charAt(0).toUpperCase()}</div>
                        <span class="username">${data.username}</span>
                    </div>
                    <div class="message-time">${this.formatTime(data.timestamp)}</div>
                </div>
                <div class="message-content">${this.formatMessage(data.message)}</div>
                <div class="message-actions">
                    <button class="action-btn" onclick="this.replyToMessage('${data.id}')">
                        <i class="fas fa-reply"></i>
                    </button>
                    <button class="action-btn" onclick="this.reactToMessage('${data.id}', '👍')">
                        <i class="fas fa-thumbs-up"></i>
                    </button>
                </div>
            `;
        }
        
        return messageDiv;
    }
    
    formatMessage(message) {
        // Convert URLs to links
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        message = message.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener">$1</a>');
        
        // Convert emoji shortcodes
        const emojiMap = {
            ':smile:': '😊', ':laugh:': '😂', ':sad:': '😢', ':heart:': '❤️',
            ':thumbsup:': '👍', ':thumbsdown:': '👎', ':clap:': '👏', ':fire:': '🔥',
            ':star:': '⭐', ':100:': '💯', ':ok:': '👌', ':peace:': '✌️'
        };
        
        Object.keys(emojiMap).forEach(code => {
            message = message.replace(new RegExp(code, 'g'), emojiMap[code]);
        });
        
        // Format mentions
        message = message.replace(/@(\w+)/g, '<span class="mention">@$1</span>');
        
        // Format code blocks
        message = message.replace(/`([^`]+)`/g, '<code>$1</code>');
        
        return message;
    }
    
    formatTime(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });
    }
    
    handleTyping() {
        if (!this.isTyping) {
            this.isTyping = true;
            this.socket.emit('user_typing', {
                meeting_id: this.meetingId,
                username: window.currentUsername
            });
        }
        
        // Clear existing timer
        clearTimeout(this.typingTimer);
        
        // Set new timer
        this.typingTimer = setTimeout(() => {
            this.stopTyping();
        }, 2000);
    }
    
    stopTyping() {
        if (this.isTyping) {
            this.isTyping = false;
            this.socket.emit('user_stopped_typing', {
                meeting_id: this.meetingId,
                username: window.currentUsername
            });
        }
        clearTimeout(this.typingTimer);
    }
    
    showTypingIndicator(data) {
        if (data.username === window.currentUsername) return;
        
        if (!this.typingIndicator) {
            this.typingIndicator = document.createElement('div');
            this.typingIndicator.className = 'typing-indicator';
            this.typingIndicator.id = 'typingIndicator';
            this.chatMessages.appendChild(this.typingIndicator);
        }
        
        this.typingIndicator.innerHTML = `
            <div class="typing-content">
                <span class="typing-user">${data.username}</span> is typing
                <div class="typing-dots">
                    <span></span><span></span><span></span>
                </div>
            </div>
        `;
        
        this.scrollToBottom();
    }
    
    hideTypingIndicator(data) {
        if (this.typingIndicator && data.username !== window.currentUsername) {
            this.typingIndicator.remove();
            this.typingIndicator = null;
        }
    }
    
    toggleEmojiPicker() {
        this.emojiPicker.classList.toggle('open');
        
        if (this.emojiPicker.classList.contains('open')) {
            this.populateEmojiPicker();
        }
    }
    
    populateEmojiPicker() {
        if (this.emojiPicker.children.length > 0) return;
        
        const emojiCategories = {
            'Smileys': ['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘'],
            'Gestures': ['👍', '👎', '👌', '🤝', '👏', '🙌', '🤲', '🤜', '🤛', '✌️', '🤞', '🤟', '🤘', '👊', '✊', '✋'],
            'Objects': ['❤️', '💔', '💕', '💖', '💗', '💓', '💘', '💝', '💟', '💙', '💚', '💛', '🧡', '💜', '🖤', '🤍'],
            'Symbols': ['🔥', '⭐', '💯', '💢', '💥', '💫', '💦', '💨', '🕳️', '💬', '🗨️', '🗯️', '💭', '🔔', '🔕', '🎵']
        };
        
        Object.keys(emojiCategories).forEach(category => {
            const categoryDiv = document.createElement('div');
            categoryDiv.className = 'emoji-category';
            
            const categoryTitle = document.createElement('div');
            categoryTitle.className = 'emoji-category-title';
            categoryTitle.textContent = category;
            categoryDiv.appendChild(categoryTitle);
            
            const emojiGrid = document.createElement('div');
            emojiGrid.className = 'emoji-grid';
            
            emojiCategories[category].forEach(emoji => {
                const emojiBtn = document.createElement('button');
                emojiBtn.className = 'emoji-btn';
                emojiBtn.textContent = emoji;
                emojiBtn.onclick = () => this.insertEmoji(emoji);
                emojiGrid.appendChild(emojiBtn);
            });
            
            categoryDiv.appendChild(emojiGrid);
            this.emojiPicker.appendChild(categoryDiv);
        });
    }
    
    insertEmoji(emoji) {
        const cursorPos = this.messageInput.selectionStart;
        const value = this.messageInput.value;
        
        this.messageInput.value = value.slice(0, cursorPos) + emoji + value.slice(cursorPos);
        this.messageInput.selectionStart = this.messageInput.selectionEnd = cursorPos + emoji.length;
        this.messageInput.focus();
        
        this.emojiPicker.classList.remove('open');
    }
    
    handleCommand(command) {
        const [cmd, ...args] = command.split(' ');
        
        switch (cmd.toLowerCase()) {
            case '/help':
                this.showHelp();
                break;
            case '/clear':
                this.clearChat();
                break;
            case '/mute':
                this.executeCommand('mute', args);
                break;
            case '/unmute':
                this.executeCommand('unmute', args);
                break;
            case '/kick':
                this.executeCommand('kick', args);
                break;
            default:
                this.showError(`Unknown command: ${cmd}`);
        }
        
        this.messageInput.value = '';
    }
    
    showHelp() {
        const helpMessage = {
            username: 'System',
            message: `Available commands:
            /help - Show this help message
            /clear - Clear chat history
            /mute @username - Mute a participant (admin only)
            /unmute @username - Unmute a participant (admin only)
            /kick @username - Remove a participant (admin only)`,
            timestamp: new Date().toISOString(),
            isSystem: true
        };
        
        this.addMessage(helpMessage);
    }
    
    clearChat() {
        this.chatMessages.innerHTML = '';
        this.messageHistory = [];
        
        const clearMessage = {
            username: 'System',
            message: 'Chat history cleared',
            timestamp: new Date().toISOString(),
            isSystem: true
        };
        
        this.addMessage(clearMessage);
    }
    
    executeCommand(action, args) {
        if (args.length === 0) {
            this.showError(`Usage: /${action} @username`);
            return;
        }
        
        const username = args[0].replace('@', '');
        
        this.socket.emit('admin_command', {
            meeting_id: this.meetingId,
            action: action,
            target_username: username
        });
    }
    
    setupFileSharing() {
        // File sharing functionality (basic implementation)
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.style.display = 'none';
        fileInput.accept = 'image/*,.pdf,.doc,.docx,.txt';
        document.body.appendChild(fileInput);
        
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file && file.size <= 10 * 1024 * 1024) { // 10MB limit
                this.shareFile(file);
            } else {
                this.showError('File size must be less than 10MB');
            }
        });
        
        // Add file share button
        const fileBtn = document.createElement('button');
        fileBtn.className = 'control-btn file-btn';
        fileBtn.innerHTML = '<i class="fas fa-paperclip"></i>';
        fileBtn.title = 'Share file';
        fileBtn.onclick = () => fileInput.click();
        
        const chatInput = document.querySelector('.chat-input');
        if (chatInput) {
            chatInput.appendChild(fileBtn);
        }
    }
    
    shareFile(file) {
        // Basic file sharing implementation
        const reader = new FileReader();
        reader.onload = (e) => {
            const fileData = {
                name: file.name,
                type: file.type,
                size: file.size,
                data: e.target.result
            };
            
            this.socket.emit('share_file', {
                meeting_id: this.meetingId,
                file: fileData
            });
        };
        
        reader.readAsDataURL(file);
    }
    
    setupChatCommands() {
        // Auto-complete for commands and mentions
        this.messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                this.handleAutoComplete();
            }
        });
    }
    
    handleAutoComplete() {
        const value = this.messageInput.value;
        const cursorPos = this.messageInput.selectionStart;
        const beforeCursor = value.slice(0, cursorPos);
        
        // Command auto-complete
        if (beforeCursor.startsWith('/')) {
            const commands = ['help', 'clear', 'mute', 'unmute', 'kick'];
            const partial = beforeCursor.slice(1);
            const match = commands.find(cmd => cmd.startsWith(partial));
            
            if (match) {
                this.messageInput.value = '/' + match + value.slice(cursorPos);
                this.messageInput.selectionStart = this.messageInput.selectionEnd = match.length + 1;
            }
        }
        
        // Mention auto-complete (would need participant list)
        if (beforeCursor.includes('@')) {
            // Implementation would go here
        }
    }
    
    showChatNotification() {
        // Show a small notification badge on chat button
        const chatBtn = document.getElementById('chatBtn');
        if (chatBtn) {
            let badge = chatBtn.querySelector('.notification-badge');
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'notification-badge';
                badge.style.cssText = `
                    position: absolute;
                    top: -5px;
                    right: -5px;
                    background: var(--error-color);
                    color: white;
                    border-radius: 50%;
                    width: 20px;
                    height: 20px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 12px;
                    font-weight: bold;
                `;
                badge.textContent = '1';
                chatBtn.style.position = 'relative';
                chatBtn.appendChild(badge);
            } else {
                badge.textContent = parseInt(badge.textContent) + 1;
            }
            
            // Remove badge when chat is opened
            const observer = new MutationObserver(() => {
                if (this.chatPanel.classList.contains('open') && badge) {
                    badge.remove();
                }
            });
            
            observer.observe(this.chatPanel, { attributes: true });
        }
    }
    
    scrollToBottom() {
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }
    
    loadChatHistory() {
        // Load existing chat messages from the server
        this.socket.emit('get_chat_history', {
            meeting_id: this.meetingId
        });
        
        this.socket.on('chat_history', (messages) => {
            messages.forEach(message => {
                this.addMessage(message);
            });
        });
    }
    
    showError(message) {
        const errorMsg = {
            username: 'System',
            message: `Error: ${message}`,
            timestamp: new Date().toISOString(),
            isSystem: true
        };
        
        this.addMessage(errorMsg);
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ChatManager;
}
