from flask import render_template, request, redirect, url_for, flash, jsonify, session
from flask_login import login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash, check_password_hash
from flask_socketio import emit, join_room, leave_room
from app import app, db, socketio
from models import User, Meeting, MeetingParticipant, ChatMessage
import uuid

# Store active meetings and participants in memory for real-time features
active_meetings = {}
meeting_participants = {}

@app.route('/')
def index():
    """Home page"""
    return render_template('index.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    """User registration"""
    if request.method == 'POST':
        username = request.form.get('username')
        email = request.form.get('email')
        password = request.form.get('password')
        confirm_password = request.form.get('confirm_password')
        
        # Validation
        if not username or not email or not password:
            flash('All fields are required', 'error')
            return render_template('register.html')
        
        if password != confirm_password:
            flash('Passwords do not match', 'error')
            return render_template('register.html')
        
        # Check if user already exists
        if User.query.filter_by(username=username).first():
            flash('Username already exists', 'error')
            return render_template('register.html')
        
        if User.query.filter_by(email=email).first():
            flash('Email already registered', 'error')
            return render_template('register.html')
        
        # Create new user
        password_hash = generate_password_hash(password)
        user = User(username=username, email=email, password_hash=password_hash)
        
        try:
            db.session.add(user)
            db.session.commit()
            flash('Registration successful! Please log in.', 'success')
            return redirect(url_for('login'))
        except Exception as e:
            db.session.rollback()
            flash('Registration failed. Please try again.', 'error')
            app.logger.error(f"Registration error: {e}")
            return render_template('register.html')
    
    return render_template('register.html')

@app.route('/login', methods=['GET', 'POST'])
def login():
    """User login"""
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        
        if not username or not password:
            flash('Username and password are required', 'error')
            return render_template('login.html')
        
        user = User.query.filter_by(username=username).first()
        
        if user and check_password_hash(user.password_hash, password):
            login_user(user)
            flash('Login successful!', 'success')
            
            # Check if user was trying to join a meeting
            pending_meeting_id = session.pop('pending_meeting_id', None)
            if pending_meeting_id:
                return redirect(url_for('join_meeting') + f'?id={pending_meeting_id}')
            
            return redirect(url_for('dashboard'))
        else:
            flash('Invalid username or password', 'error')
    
    return render_template('login.html')

@app.route('/logout')
@login_required
def logout():
    """User logout"""
    logout_user()
    flash('You have been logged out', 'info')
    return redirect(url_for('index'))

@app.route('/dashboard')
@login_required
def dashboard():
    """User dashboard"""
    # Get user's created meetings
    created_meetings = Meeting.query.filter_by(creator_id=current_user.id, is_active=True).all()
    
    # Get meetings user has joined
    participated_meetings = db.session.query(Meeting).join(MeetingParticipant).filter(
        MeetingParticipant.user_id == current_user.id,
        Meeting.is_active == True
    ).all()
    
    return render_template('dashboard.html', 
                         created_meetings=created_meetings,
                         participated_meetings=participated_meetings)

@app.route('/create_meeting', methods=['POST'])
@login_required
def create_meeting():
    """Create a new meeting"""
    title = request.form.get('title')
    description = request.form.get('description', '')
    
    if not title:
        flash('Meeting title is required', 'error')
        return redirect(url_for('dashboard'))
    
    meeting = Meeting(
        title=title,
        description=description,
        creator_id=current_user.id
    )
    
    try:
        db.session.add(meeting)
        db.session.commit()
        
        # Add creator as participant
        participant = MeetingParticipant(
            meeting_id=meeting.id,
            user_id=current_user.id
        )
        db.session.add(participant)
        db.session.commit()
        
        flash('Meeting created successfully!', 'success')
        return redirect(url_for('dashboard'))
    except Exception as e:
        db.session.rollback()
        flash('Failed to create meeting. Please try again.', 'error')
        app.logger.error(f"Create meeting error: {e}")
        return redirect(url_for('dashboard'))

@app.route('/join_meeting', methods=['GET', 'POST'])
def join_meeting():
    """Join a meeting by ID"""
    if request.method == 'GET':
        # Handle direct meeting link access
        meeting_id = request.args.get('id')
        if meeting_id:
            return redirect(url_for('meeting_room', meeting_id=meeting_id))
        # Show join form for anonymous users
        return render_template('join_meeting.html')
    
    # POST request handling
    meeting_id = request.form.get('meeting_id')
    
    if not meeting_id:
        flash('Meeting ID is required', 'error')
        if current_user.is_authenticated:
            return redirect(url_for('dashboard'))
        return render_template('join_meeting.html')
    
    # Clean and validate meeting ID
    meeting_id = meeting_id.strip().replace(' ', '').replace('-', '')
    
    meeting = Meeting.query.filter_by(meeting_id=meeting_id, is_active=True).first()
    
    if not meeting:
        flash('Meeting not found or inactive. Please check the Meeting ID.', 'error')
        if current_user.is_authenticated:
            return redirect(url_for('dashboard'))
        return render_template('join_meeting.html')
    
    # If user is not logged in, require login first
    if not current_user.is_authenticated:
        session['pending_meeting_id'] = meeting_id
        flash('Please log in to join the meeting', 'info')
        return redirect(url_for('login'))
    
    # Check if user is already a participant
    existing_participant = MeetingParticipant.query.filter_by(
        meeting_id=meeting.id,
        user_id=current_user.id
    ).first()
    
    if not existing_participant:
        # Add user as participant
        participant = MeetingParticipant(
            meeting_id=meeting.id,
            user_id=current_user.id
        )
        try:
            db.session.add(participant)
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            flash('Failed to join meeting. Please try again.', 'error')
            app.logger.error(f"Join meeting error: {e}")
            return redirect(url_for('dashboard'))
    
    return redirect(url_for('meeting_room', meeting_id=meeting.meeting_id))

@app.route('/meeting/<meeting_id>')
@login_required
def meeting_room(meeting_id):
    """Meeting room interface"""
    meeting = Meeting.query.filter_by(meeting_id=meeting_id, is_active=True).first()
    
    if not meeting:
        flash('Meeting not found or inactive', 'error')
        return redirect(url_for('dashboard'))
    
    # Check if user is a participant
    participant = MeetingParticipant.query.filter_by(
        meeting_id=meeting.id,
        user_id=current_user.id
    ).first()
    
    if not participant:
        flash('You are not authorized to join this meeting', 'error')
        return redirect(url_for('dashboard'))
    
    # Get all participants
    participants = db.session.query(MeetingParticipant, User).join(User).filter(
        MeetingParticipant.meeting_id == meeting.id
    ).all()
    
    # Get chat messages
    messages = db.session.query(ChatMessage, User).join(User).filter(
        ChatMessage.meeting_id == meeting.id
    ).order_by(ChatMessage.timestamp).all()
    
    return render_template('meeting.html', 
                         meeting=meeting,
                         participants=participants,
                         messages=messages,
                         current_participant=participant)

@app.route('/end_meeting/<meeting_id>', methods=['POST'])
@login_required
def end_meeting(meeting_id):
    """End a meeting (creator only)"""
    meeting = Meeting.query.filter_by(meeting_id=meeting_id, is_active=True).first()
    
    if not meeting:
        flash('Meeting not found', 'error')
        return redirect(url_for('dashboard'))
    
    if meeting.creator_id != current_user.id:
        flash('Only the meeting creator can end the meeting', 'error')
        return redirect(url_for('meeting_room', meeting_id=meeting_id))
    
    meeting.is_active = False
    try:
        db.session.commit()
        
        # Notify all participants via WebSocket
        socketio.emit('meeting_ended', {'message': 'Meeting has been ended by the host'}, 
                     room=meeting_id)
        
        flash('Meeting ended successfully', 'success')
        return redirect(url_for('dashboard'))
    except Exception as e:
        db.session.rollback()
        flash('Failed to end meeting', 'error')
        app.logger.error(f"End meeting error: {e}")
        return redirect(url_for('meeting_room', meeting_id=meeting_id))

# WebSocket Events
@socketio.on('join_meeting')
def on_join_meeting(data):
    """Handle user joining meeting room"""
    meeting_id = data['meeting_id']
    username = data['username']
    
    join_room(meeting_id)
    
    # Store participant info
    if meeting_id not in meeting_participants:
        meeting_participants[meeting_id] = {}
    
    meeting_participants[meeting_id][request.sid] = {
        'username': username,
        'user_id': current_user.id
    }
    
    emit('user_joined', {
        'username': username,
        'message': f'{username} joined the meeting'
    }, room=meeting_id)

@socketio.on('leave_meeting')
def on_leave_meeting(data):
    """Handle user leaving meeting room"""
    meeting_id = data['meeting_id']
    username = data['username']
    
    leave_room(meeting_id)
    
    # Remove participant info
    if meeting_id in meeting_participants and request.sid in meeting_participants[meeting_id]:
        del meeting_participants[meeting_id][request.sid]
    
    emit('user_left', {
        'username': username,
        'message': f'{username} left the meeting'
    }, room=meeting_id)

@socketio.on('send_message')
def on_send_message(data):
    """Handle chat messages"""
    meeting_id = data['meeting_id']
    message_text = data['message']
    
    # Save message to database
    meeting = Meeting.query.filter_by(meeting_id=meeting_id).first()
    if meeting:
        message = ChatMessage(
            meeting_id=meeting.id,
            user_id=current_user.id,
            message=message_text
        )
        
        try:
            db.session.add(message)
            db.session.commit()
            
            # Broadcast message to all participants
            emit('new_message', {
                'username': current_user.username,
                'message': message_text,
                'timestamp': message.timestamp.strftime('%H:%M')
            }, room=meeting_id)
        except Exception as e:
            db.session.rollback()
            app.logger.error(f"Save message error: {e}")

@socketio.on('toggle_audio')
def on_toggle_audio(data):
    """Handle audio toggle"""
    meeting_id = data['meeting_id']
    is_muted = data['is_muted']
    
    # Update participant status in database
    meeting = Meeting.query.filter_by(meeting_id=meeting_id).first()
    if meeting:
        participant = MeetingParticipant.query.filter_by(
            meeting_id=meeting.id,
            user_id=current_user.id
        ).first()
        
        if participant:
            participant.is_muted = is_muted
            try:
                db.session.commit()
                
                # Broadcast status to all participants
                emit('audio_toggled', {
                    'username': current_user.username,
                    'is_muted': is_muted
                }, room=meeting_id)
            except Exception as e:
                db.session.rollback()
                app.logger.error(f"Toggle audio error: {e}")

@socketio.on('toggle_video')
def on_toggle_video(data):
    """Handle video toggle"""
    meeting_id = data['meeting_id']
    is_video_on = data['is_video_on']
    
    # Update participant status in database
    meeting = Meeting.query.filter_by(meeting_id=meeting_id).first()
    if meeting:
        participant = MeetingParticipant.query.filter_by(
            meeting_id=meeting.id,
            user_id=current_user.id
        ).first()
        
        if participant:
            participant.is_video_on = is_video_on
            try:
                db.session.commit()
                
                # Broadcast status to all participants
                emit('video_toggled', {
                    'username': current_user.username,
                    'is_video_on': is_video_on
                }, room=meeting_id)
            except Exception as e:
                db.session.rollback()
                app.logger.error(f"Toggle video error: {e}")

@socketio.on('webrtc_offer')
def on_webrtc_offer(data):
    """Handle WebRTC offer"""
    emit('webrtc_offer', data, room=data['target'])

@socketio.on('webrtc_answer')
def on_webrtc_answer(data):
    """Handle WebRTC answer"""
    emit('webrtc_answer', data, room=data['target'])

@socketio.on('webrtc_ice_candidate')
def on_webrtc_ice_candidate(data):
    """Handle WebRTC ICE candidate"""
    emit('webrtc_ice_candidate', data, room=data['target'])

@socketio.on('start_screen_share')
def on_start_screen_share(data):
    """Handle screen sharing start"""
    meeting_id = data['meeting_id']
    emit('screen_share_started', {
        'username': current_user.username
    }, room=meeting_id)

@socketio.on('stop_screen_share')
def on_stop_screen_share(data):
    """Handle screen sharing stop"""
    meeting_id = data['meeting_id']
    emit('screen_share_stopped', {
        'username': current_user.username
    }, room=meeting_id)

# Admin routes for managing participants
@app.route('/admin/mute_participant', methods=['POST'])
@login_required
def admin_mute_participant():
    """Admin: Mute a participant"""
    meeting_id = request.form.get('meeting_id')
    participant_id = request.form.get('participant_id')
    
    meeting = Meeting.query.filter_by(meeting_id=meeting_id).first()
    if not meeting or meeting.creator_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403
    
    participant = MeetingParticipant.query.get(participant_id)
    if participant and participant.meeting_id == meeting.id:
        participant.is_muted = True
        try:
            db.session.commit()
            
            # Notify participant via WebSocket
            socketio.emit('force_mute', {
                'message': 'You have been muted by the host'
            }, room=meeting_id)
            
            return jsonify({'success': True})
        except Exception as e:
            db.session.rollback()
            return jsonify({'error': 'Failed to mute participant'}), 500
    
    return jsonify({'error': 'Participant not found'}), 404

@app.route('/admin/remove_participant', methods=['POST'])
@login_required
def admin_remove_participant():
    """Admin: Remove a participant from meeting"""
    meeting_id = request.form.get('meeting_id')
    participant_id = request.form.get('participant_id')
    
    meeting = Meeting.query.filter_by(meeting_id=meeting_id).first()
    if not meeting or meeting.creator_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403
    
    participant = MeetingParticipant.query.get(participant_id)
    if participant and participant.meeting_id == meeting.id:
        try:
            # Notify participant before removal
            socketio.emit('removed_from_meeting', {
                'message': 'You have been removed from the meeting by the host'
            }, room=meeting_id)
            
            db.session.delete(participant)
            db.session.commit()
            
            return jsonify({'success': True})
        except Exception as e:
            db.session.rollback()
            return jsonify({'error': 'Failed to remove participant'}), 500
    
    return jsonify({'error': 'Participant not found'}), 404
