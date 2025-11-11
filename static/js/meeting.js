// Meeting room functionality with WebRTC
class MeetingRoom {
    constructor(meetingId, username) {
        this.meetingId = meetingId;
        this.username = username;
        this.socket = io();
        this.localStream = null;
        this.peers = new Map();
        this.isAudioMuted = false;
        this.isVideoOn = true;
        this.isScreenSharing = false;
        this.isChatOpen = false;
        this.isParticipantsOpen = false;
        
        this.initializeUI();
        this.initializeWebRTC();
        this.initializeSocket();
    }
    
    initializeUI() {
        // Control buttons
        this.audioBtn = document.getElementById('audioBtn');
        this.videoBtn = document.getElementById('videoBtn');
        this.screenShareBtn = document.getElementById('screenShareBtn');
        this.chatBtn = document.getElementById('chatBtn');
        this.participantsBtn = document.getElementById('participantsBtn');
        this.endCallBtn = document.getElementById('endCallBtn');
        
        // Panels
        this.chatPanel = document.getElementById('chatPanel');
        this.participantsPanel = document.getElementById('participantsPanel');
        this.videoGrid = document.getElementById('videoGrid');
        
        // Chat elements
        this.chatMessages = document.getElementById('chatMessages');
        this.messageInput = document.getElementById('messageInput');
        this.sendBtn = document.getElementById('sendBtn');
        this.emojiBtn = document.getElementById('emojiBtn');
        this.emojiPicker = document.getElementById('emojiPicker');
        
        // Event listeners
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        // Control buttons
        this.audioBtn.addEventListener('click', () => this.toggleAudio());
        this.videoBtn.addEventListener('click', () => this.toggleVideo());
        this.screenShareBtn.addEventListener('click', () => this.toggleScreenShare());
        this.chatBtn.addEventListener('click', () => this.toggleChat());
        this.participantsBtn.addEventListener('click', () => this.toggleParticipants());
        this.endCallBtn.addEventListener('click', () => this.endCall());
        
        // Chat functionality
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
        this.emojiBtn.addEventListener('click', () => this.toggleEmojiPicker());
        
        // Close panels when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.chatPanel.contains(e.target) && !this.chatBtn.contains(e.target)) {
                this.closeChatPanel();
            }
            if (!this.participantsPanel.contains(e.target) && !this.participantsBtn.contains(e.target)) {
                this.closeParticipantsPanel();
            }
            if (!this.emojiPicker.contains(e.target) && !this.emojiBtn.contains(e.target)) {
                this.closeEmojiPicker();
            }
        });
        
        // Copy meeting link
        document.getElementById('copyLinkBtn')?.addEventListener('click', () => {
            const meetingUrl = `${window.location.origin}/meeting/${this.meetingId}`;
            copyToClipboard(meetingUrl);
        });
    }
    
    async initializeWebRTC() {
        try {
            // Get user media
            this.localStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });
            
            // Display local video
            this.displayLocalVideo();
            
        } catch (error) {
            console.error('Error accessing media devices:', error);
            this.showError('Unable to access camera/microphone. Please check permissions.');
        }
    }
    
    displayLocalVideo() {
        const localVideoTile = this.createVideoTile(this.username, true);
        const videoElement = localVideoTile.querySelector('.video-element');
        videoElement.srcObject = this.localStream;
        videoElement.muted = true; // Prevent feedback
        this.videoGrid.appendChild(localVideoTile);
    }
    
    createVideoTile(username, isLocal = false) {
        const tile = document.createElement('div');
        tile.className = 'video-tile';
        tile.id = isLocal ? 'localVideo' : `video-${username}`;
        
        tile.innerHTML = `
            <video class="video-element" autoplay playsinline></video>
            <div class="video-overlay">
                <div class="participant-name">${username}${isLocal ? ' (You)' : ''}</div>
                <div class="participant-status">
                    <div class="status-icon ${this.isAudioMuted ? 'status-muted' : ''}" id="status-${username}">
                        <i class="fas ${this.isAudioMuted ? 'fa-microphone-slash' : 'fa-microphone'}"></i>
                    </div>
                </div>
            </div>
        `;
        
        return tile;
    }
    
    initializeSocket() {
        // Join meeting room
        this.socket.on('connect', () => {
            console.log('Connected to server');
            // Join the meeting room immediately after connection
            this.joinMeeting();
        });
        
        // User events
        this.socket.on('user_joined', (data) => {
            this.addChatMessage('System', `${data.username} joined the meeting`, true);
            this.updateParticipantsList();
        });
        
        this.socket.on('user_left', (data) => {
            this.addChatMessage('System', `${data.username} left the meeting`, true);
            this.removeVideoTile(data.username);
            this.updateParticipantsList();
        });
        
        // Chat events
        this.socket.on('new_message', (data) => {
            console.log('Received new_message:', data);
            // Only add message if it's not from the current user (to avoid duplicates)
            if (data.username !== this.username) {
                this.addChatMessage(data.username, data.message, false, data.timestamp);
            }
        });
        
        // Control events
        this.socket.on('audio_toggled', (data) => {
            this.updateParticipantStatus(data.username, 'audio', data.is_muted);
        });
        
        this.socket.on('video_toggled', (data) => {
            this.updateParticipantStatus(data.username, 'video', data.is_video_on);
        });
        
        // Screen sharing events
        this.socket.on('screen_share_started', (data) => {
            this.addChatMessage('System', `${data.username} started screen sharing`, true);
        });
        
        this.socket.on('screen_share_stopped', (data) => {
            this.addChatMessage('System', `${data.username} stopped screen sharing`, true);
        });
        
        // Admin events
        this.socket.on('force_mute', (data) => {
            this.showAlert(data.message, 'warning');
            this.forceAudioMute();
        });
        
        this.socket.on('removed_from_meeting', (data) => {
            this.showAlert(data.message, 'error');
            setTimeout(() => window.location.href = '/dashboard', 2000);
        });
        
        this.socket.on('meeting_ended', (data) => {
            this.showAlert(data.message, 'info');
            setTimeout(() => window.location.href = '/dashboard', 2000);
        });
        
        // WebRTC signaling
        this.socket.on('webrtc_offer', (data) => this.handleOffer(data));
        this.socket.on('webrtc_answer', (data) => this.handleAnswer(data));
        this.socket.on('webrtc_ice_candidate', (data) => this.handleIceCandidate(data));
    }
    
    joinMeeting() {
        console.log('Joining meeting:', this.meetingId, 'as', this.username);
        this.socket.emit('join_meeting', {
            meeting_id: this.meetingId,
            username: this.username
        });
    }
    
    // WebRTC peer connection methods
    async createPeerConnection(username) {
        const pc = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        });
        
        // Add local stream
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                pc.addTrack(track, this.localStream);
            });
        }
        
        // Handle remote stream
        pc.ontrack = (event) => {
            const remoteStream = event.streams[0];
            this.displayRemoteVideo(username, remoteStream);
        };
        
        // Handle ICE candidates
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit('webrtc_ice_candidate', {
                    target: username,
                    candidate: event.candidate
                });
            }
        };
        
        this.peers.set(username, pc);
        return pc;
    }
    
    displayRemoteVideo(username, stream) {
        let videoTile = document.getElementById(`video-${username}`);
        if (!videoTile) {
            videoTile = this.createVideoTile(username);
            this.videoGrid.appendChild(videoTile);
        }
        
        const videoElement = videoTile.querySelector('.video-element');
        videoElement.srcObject = stream;
    }
    
    removeVideoTile(username) {
        const videoTile = document.getElementById(`video-${username}`);
        if (videoTile) {
            videoTile.remove();
        }
        
        // Clean up peer connection
        const pc = this.peers.get(username);
        if (pc) {
            pc.close();
            this.peers.delete(username);
        }
    }
    
    async handleOffer(data) {
        const pc = await this.createPeerConnection(data.from);
        await pc.setRemoteDescription(data.offer);
        
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        this.socket.emit('webrtc_answer', {
            target: data.from,
            answer: answer
        });
    }
    
    async handleAnswer(data) {
        const pc = this.peers.get(data.from);
        if (pc) {
            await pc.setRemoteDescription(data.answer);
        }
    }
    
    async handleIceCandidate(data) {
        const pc = this.peers.get(data.from);
        if (pc) {
            await pc.addIceCandidate(data.candidate);
        }
    }
    
    // Control methods
    toggleAudio() {
        if (this.localStream) {
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                this.isAudioMuted = !audioTrack.enabled;
                
                // Update UI
                this.updateAudioButton();
                this.updateLocalStatus('audio');
                
                // Notify other participants
                this.socket.emit('toggle_audio', {
                    meeting_id: this.meetingId,
                    is_muted: this.isAudioMuted
                });
            }
        }
    }
    
    toggleVideo() {
        if (this.localStream) {
            const videoTrack = this.localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                this.isVideoOn = videoTrack.enabled;
                
                // Update UI
                this.updateVideoButton();
                this.updateLocalVideo();
                
                // Notify other participants
                this.socket.emit('toggle_video', {
                    meeting_id: this.meetingId,
                    is_video_on: this.isVideoOn
                });
            }
        }
    }
    
    async toggleScreenShare() {
        if (!this.isScreenSharing) {
            try {
                const screenStream = await navigator.mediaDevices.getDisplayMedia({
                    video: true,
                    audio: true
                });
                
                // Replace video track in peer connections
                const videoTrack = screenStream.getVideoTracks()[0];
                
                this.peers.forEach(async (pc) => {
                    const sender = pc.getSenders().find(s => 
                        s.track && s.track.kind === 'video'
                    );
                    if (sender) {
                        await sender.replaceTrack(videoTrack);
                    }
                });
                
                // Update local video
                const localVideo = document.querySelector('#localVideo .video-element');
                localVideo.srcObject = screenStream;
                
                this.isScreenSharing = true;
                this.updateScreenShareButton();
                
                // Handle screen share end
                videoTrack.onended = () => {
                    this.stopScreenShare();
                };
                
                // Notify other participants
                this.socket.emit('start_screen_share', {
                    meeting_id: this.meetingId
                });
                
            } catch (error) {
                console.error('Error starting screen share:', error);
                this.showError('Unable to start screen sharing');
            }
        } else {
            this.stopScreenShare();
        }
    }
    
    async stopScreenShare() {
        if (this.localStream) {
            const videoTrack = this.localStream.getVideoTracks()[0];
            
            // Replace screen share track with camera
            this.peers.forEach(async (pc) => {
                const sender = pc.getSenders().find(s => 
                    s.track && s.track.kind === 'video'
                );
                if (sender && videoTrack) {
                    await sender.replaceTrack(videoTrack);
                }
            });
            
            // Update local video
            const localVideo = document.querySelector('#localVideo .video-element');
            localVideo.srcObject = this.localStream;
        }
        
        this.isScreenSharing = false;
        this.updateScreenShareButton();
        
        // Notify other participants
        this.socket.emit('stop_screen_share', {
            meeting_id: this.meetingId
        });
    }
    
    forceAudioMute() {
        if (this.localStream && !this.isAudioMuted) {
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = false;
                this.isAudioMuted = true;
                this.updateAudioButton();
                this.updateLocalStatus('audio');
            }
        }
    }
    
    // UI update methods
    updateAudioButton() {
        const icon = this.audioBtn.querySelector('i');
        if (this.isAudioMuted) {
            icon.className = 'fas fa-microphone-slash';
            this.audioBtn.classList.add('muted');
            this.audioBtn.setAttribute('data-tooltip', 'Unmute');
        } else {
            icon.className = 'fas fa-microphone';
            this.audioBtn.classList.remove('muted');
            this.audioBtn.setAttribute('data-tooltip', 'Mute');
        }
    }
    
    updateVideoButton() {
        const icon = this.videoBtn.querySelector('i');
        if (this.isVideoOn) {
            icon.className = 'fas fa-video';
            this.videoBtn.classList.remove('muted');
            this.videoBtn.setAttribute('data-tooltip', 'Turn off camera');
        } else {
            icon.className = 'fas fa-video-slash';
            this.videoBtn.classList.add('muted');
            this.videoBtn.setAttribute('data-tooltip', 'Turn on camera');
        }
    }
    
    updateScreenShareButton() {
        const icon = this.screenShareBtn.querySelector('i');
        if (this.isScreenSharing) {
            icon.className = 'fas fa-stop';
            this.screenShareBtn.classList.add('active');
            this.screenShareBtn.setAttribute('data-tooltip', 'Stop sharing');
        } else {
            icon.className = 'fas fa-desktop';
            this.screenShareBtn.classList.remove('active');
            this.screenShareBtn.setAttribute('data-tooltip', 'Share screen');
        }
    }
    
    updateLocalVideo() {
        const localVideo = document.querySelector('#localVideo .video-element');
        if (localVideo && this.localStream) {
            const videoTrack = this.localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = this.isVideoOn;
            }
        }
    }
    
    updateLocalStatus(type) {
        const statusIcon = document.querySelector(`#status-${this.username}`);
        if (statusIcon) {
            const icon = statusIcon.querySelector('i');
            if (type === 'audio') {
                icon.className = this.isAudioMuted ? 'fas fa-microphone-slash' : 'fas fa-microphone';
                statusIcon.className = `status-icon ${this.isAudioMuted ? 'status-muted' : ''}`;
            }
        }
    }
    
    updateParticipantStatus(username, type, value) {
        const statusIcon = document.querySelector(`#status-${username}`);
        if (statusIcon) {
            const icon = statusIcon.querySelector('i');
            if (type === 'audio') {
                icon.className = value ? 'fas fa-microphone-slash' : 'fas fa-microphone';
                statusIcon.className = `status-icon ${value ? 'status-muted' : ''}`;
            }
        }
    }
    
    // Panel methods
    toggleChat() {
        this.isChatOpen = !this.isChatOpen;
        if (this.isChatOpen) {
            this.chatPanel.classList.add('open');
            this.chatBtn.classList.add('active');
            this.closeParticipantsPanel();
        } else {
            this.closeChatPanel();
        }
    }
    
    closeChatPanel() {
        this.isChatOpen = false;
        this.chatPanel.classList.remove('open');
        this.chatBtn.classList.remove('active');
        this.closeEmojiPicker();
    }
    
    toggleParticipants() {
        this.isParticipantsOpen = !this.isParticipantsOpen;
        if (this.isParticipantsOpen) {
            this.participantsPanel.classList.add('open');
            this.participantsBtn.classList.add('active');
            this.closeChatPanel();
        } else {
            this.closeParticipantsPanel();
        }
    }
    
    closeParticipantsPanel() {
        this.isParticipantsOpen = false;
        this.participantsPanel.classList.remove('open');
        this.participantsBtn.classList.remove('active');
    }
    
    // Chat methods
    sendMessage() {
        const message = this.messageInput.value.trim();
        if (message) {
            console.log('Sending message:', message);
            
            // Add message locally first for immediate feedback
            this.addChatMessage(this.username, message, false);
            
            this.socket.emit('send_message', {
                meeting_id: this.meetingId,
                message: message
            });
            this.messageInput.value = '';
        }
    }
    
    addChatMessage(username, message, isSystem = false, timestamp = null) {
        const messageDiv = document.createElement('div');
        const isOwnMessage = username === this.username && !isSystem;
        messageDiv.className = `message ${isSystem ? 'system-message' : ''} ${isOwnMessage ? 'own-message' : 'other-message'}`;
        
        const time = timestamp || new Date().toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });
        
        if (isSystem) {
            messageDiv.innerHTML = `
                <div class="message-content" style="text-align: center; font-style: italic; color: var(--secondary-color);">
                    <i class="fas fa-info-circle me-2"></i>${this.formatMessage(message)}
                </div>
                <div class="message-time" style="text-align: center;">${time}</div>
            `;
        } else {
            messageDiv.innerHTML = `
                <div class="message-author">${username}${isOwnMessage ? ' (You)' : ''}</div>
                <div class="message-content">${this.formatMessage(message)}</div>
                <div class="message-time">${time}</div>
            `;
        }
        
        this.chatMessages.appendChild(messageDiv);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
        
        console.log('Added chat message:', { username, message, isSystem, isOwnMessage });
    }
    
    formatMessage(message) {
        // Convert emoji codes to actual emojis
        const emojiMap = {
            ':)': '😊', ':-)': '😊', ':(': '😢', ':-(': '😢',
            ':D': '😄', ':-D': '😄', ':P': '😛', ':-P': '😛',
            ';)': '😉', ';-)': '😉', ':o': '😮', ':-o': '😮',
            ':thumbsup:': '👍', ':thumbsdown:': '👎', ':heart:': '❤️',
            ':clap:': '👏', ':fire:': '🔥', ':ok:': '👌'
        };
        
        let formattedMessage = message;
        Object.keys(emojiMap).forEach(code => {
            formattedMessage = formattedMessage.replace(new RegExp(code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), emojiMap[code]);
        });
        
        return formattedMessage;
    }
    
    toggleEmojiPicker() {
        this.emojiPicker.classList.toggle('open');
    }
    
    closeEmojiPicker() {
        this.emojiPicker.classList.remove('open');
    }
    
    insertEmoji(emoji) {
        this.messageInput.value += emoji;
        this.messageInput.focus();
        this.closeEmojiPicker();
    }
    
    updateParticipantsList() {
        // This would be implemented to fetch and display current participants
        // For now, we'll just show the participants that are already rendered
    }
    
    endCall() {
        if (confirm('Are you sure you want to leave the meeting?')) {
            // Clean up resources
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => track.stop());
            }
            
            this.peers.forEach(pc => pc.close());
            
            this.socket.emit('leave_meeting', {
                meeting_id: this.meetingId,
                username: this.username
            });
            
            window.location.href = '/dashboard';
        }
    }
    
    showError(message) {
        this.showAlert(message, 'error');
    }
    
    showAlert(message, type = 'info') {
        // Use the global showAlert function from main.js
        if (typeof showAlert === 'function') {
            showAlert(message, type);
        } else {
            alert(message);
        }
    }
}

// Initialize meeting room when page loads
document.addEventListener('DOMContentLoaded', function() {
    const meetingContainer = document.querySelector('.meeting-container');
    if (meetingContainer) {
        const meetingId = meetingContainer.dataset.meetingId;
        const username = meetingContainer.dataset.username;
        
        if (meetingId && username) {
            window.meetingRoom = new MeetingRoom(meetingId, username);
        }
    }
    
    // Setup emoji picker if present
    const emojiPicker = document.getElementById('emojiPicker');
    if (emojiPicker) {
        const emojis = ['😊', '😄', '😢', '😍', '😂', '😎', '🤔', '😴', '😱', '🙄', '👍', '👎', '👏', '🙌', '❤️', '💔', '🔥', '⭐', '💯', '👌', '✌️', '🤝', '🙏', '💪'];
        
        emojis.forEach(emoji => {
            const emojiBtn = document.createElement('button');
            emojiBtn.className = 'emoji-btn';
            emojiBtn.textContent = emoji;
            emojiBtn.onclick = () => {
                if (window.meetingRoom) {
                    window.meetingRoom.insertEmoji(emoji);
                }
            };
            emojiPicker.appendChild(emojiBtn);
        });
    }
});
