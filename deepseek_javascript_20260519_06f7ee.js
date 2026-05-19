// WebRTC mesh + chat + screen-share + video sync (client)
const socket = io();

// UI elements
const joinBtn = document.getElementById('join-btn');
const leaveBtn = document.getElementById('leave-btn');
const roomInput = document.getElementById('room-id');
const localVideo = document.getElementById('localVideo');
const peersDiv = document.getElementById('peers');
const messagesDiv = document.getElementById('messages');
const chatInput = document.getElementById('chat-input');
const sendChatBtn = document.getElementById('send-chat');
const nameInput = document.getElementById('name');
const participantCountSpan = document.getElementById('participant-count');
const connectionStatus = document.getElementById('connection-status');

const toggleCameraBtn = document.getElementById('toggle-camera');
const toggleMicBtn = document.getElementById('toggle-mic');
const shareScreenBtn = document.getElementById('share-screen');

const sharedVideo = document.getElementById('sharedVideo');
const videoUrlInput = document.getElementById('video-url');
const loadUrlBtn = document.getElementById('load-url');
const playUrlBtn = document.getElementById('play-url');
const pauseUrlBtn = document.getElementById('pause-url');
const seekUrlBtn = document.getElementById('seek-url');
const seekTimeInput = document.getElementById('seek-time');
const shareUrlBtn = document.getElementById('share-url-btn');
const videoErrorDiv = document.getElementById('video-error');

let localStream = null;
let screenStream = null;
let pcs = {}; // peerId -> RTCPeerConnection
let isHostingSync = false;
let roomId = null;
let currentPeers = new Set();

const configuration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ],
  iceCandidatePoolSize: 10
};

// Connection status
socket.on('connect', () => {
  console.log('Connected to signaling server');
  connectionStatus.textContent = '✅ Connected';
  connectionStatus.className = 'status connected';
});

socket.on('disconnect', () => {
  console.log('Disconnected from server');
  connectionStatus.textContent = '❌ Disconnected';
  connectionStatus.className = 'status disconnected';
  alert('Disconnected from server. Please refresh the page.');
});

async function startLocalMedia() {
  try {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    toggleCameraBtn.textContent = '📷 Turn Camera Off';
    toggleMicBtn.textContent = '🎤 Mute';
    return true;
  } catch (e) {
    console.error('getUserMedia error', e);
    alert('Camera/Mic access is needed for video calls. You can still watch shared videos.');
    localStream = null;
    return false;
  }
}

async function makePeerConnection(peerId, createOffer = false) {
  if (pcs[peerId]) return pcs[peerId];

  const pc = new RTCPeerConnection(configuration);
  pcs[peerId] = pc;

  // Add local tracks if available
  if (localStream) {
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
  }

  // Create video element for remote peer
  const wrapper = document.createElement('div');
  wrapper.className = 'peer';
  wrapper.id = `peer-${peerId}`;
  
  const video = document.createElement('video');
  video.id = `video-${peerId}`;
  video.autoplay = true;
  video.playsInline = true;
  video.muted = false;
  
  const label = document.createElement('div');
  label.textContent = `Peer: ${peerId.slice(0, 8)}`;
  
  wrapper.appendChild(video);
  wrapper.appendChild(label);
  peersDiv.appendChild(wrapper);

  pc.ontrack = event => {
    if (video.srcObject !== event.streams[0]) {
      video.srcObject = event.streams[0];
    }
  };

  pc.onicecandidate = event => {
    if (event.candidate) {
      socket.emit('ice-candidate', { target: peerId, candidate: event.candidate });
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log(`ICE connection state for ${peerId}: ${pc.iceConnectionState}`);
    if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
      cleanupPeer(peerId);
    }
  };

  pc.onconnectionstatechange = () => {
    console.log(`Connection state for ${peerId}: ${pc.connectionState}`);
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      cleanupPeer(peerId);
    }
  };

  if (createOffer) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { target: peerId, sdp: pc.localDescription });
  }

  return pc;
}

function cleanupPeer(peerId) {
  if (pcs[peerId]) {
    pcs[peerId].close();
    delete pcs[peerId];
  }
  const peerElement = document.getElementById(`peer-${peerId}`);
  if (peerElement) {
    peerElement.remove();
  }
  currentPeers.delete(peerId);
  updateParticipantCount();
}

function updateParticipantCount() {
  participantCountSpan.textContent = currentPeers.size;
}

// Signaling handlers
socket.on('existing-users', clients => {
  console.log('Existing users:', clients);
  clients.forEach(async id => {
    if (!pcs[id]) {
      currentPeers.add(id);
      await makePeerConnection(id, true);
    }
  });
  updateParticipantCount();
});

socket.on('user-joined', async id => {
  console.log('User joined:', id);
  if (!pcs[id] && id !== socket.id) {
    currentPeers.add(id);
    await makePeerConnection(id, true);
    updateParticipantCount();
  }
});

socket.on('offer', async ({ from, sdp }) => {
  console.log('Received offer from:', from);
  if (!pcs[from]) {
    currentPeers.add(from);
    await makePeerConnection(from, false);
  }
  const pc = pcs[from];
  if (pc && pc.signalingState !== 'stable') {
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { target: from, sdp: pc.localDescription });
  }
});

socket.on('answer', async ({ from, sdp }) => {
  console.log('Received answer from:', from);
  const pc = pcs[from];
  if (pc && pc.signalingState === 'have-local-offer') {
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  }
});

socket.on('ice-candidate', async ({ from, candidate }) => {
  const pc = pcs[from];
  if (pc && pc.remoteDescription) {
    try {
      await pc.addIceCandidate(candidate);
    } catch (e) {
      console.warn('Error adding ice candidate', e);
    }
  }
});

socket.on('user-left', id => {
  console.log('User left:', id);
  cleanupPeer(id);
});

// Chat functionality
function addChatMessage(name, message, timestamp) {
  const el = document.createElement('div');
  el.className = 'message';
  const time = new Date(timestamp).toLocaleTimeString();
  el.textContent = `[${time}] ${name}: ${message}`;
  messagesDiv.appendChild(el);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
  
  // Keep only last 200 messages
  while (messagesDiv.children.length > 200) {
    messagesDiv.removeChild(messagesDiv.firstChild);
  }
}

sendChatBtn.onclick = () => {
  const text = chatInput.value.trim();
  if (!text || !roomId) return;
  const name = nameInput.value.trim() || 'Guest';
  socket.emit('chat-message', { room: roomId, message: text, name });
  addChatMessage('You', text, Date.now());
  chatInput.value = '';
};

chatInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    sendChatBtn.click();
  }
});

socket.on('chat-message', ({ message, name, ts }) => {
  addChatMessage(name, message, ts);
});

// Room management
joinBtn.onclick = async () => {
  if (!roomInput.value.trim()) {
    alert('Enter a room id.');
    return;
  }
  
  if (roomId) {
    alert('Already in a room! Click Leave Room first.');
    return;
  }
  
  roomId = roomInput.value.trim();
  roomInput.disabled = true;
  joinBtn.disabled = true;
  leaveBtn.style.display = 'inline-block';
  
  const mediaStarted = await startLocalMedia();
  if (!mediaStarted) {
    // Continue without camera/mic
  }
  
  socket.emit('join-room', roomId);
  console.log('Joined room:', roomId);
};

leaveBtn.onclick = () => {
  // Cleanup all peers
  Object.keys(pcs).forEach(peerId => {
    cleanupPeer(peerId);
  });
  
  // Stop local stream
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
    localVideo.srcObject = null;
  }
  
  if (screenStream) {
    screenStream.getTracks().forEach(track => track.stop());
    screenStream = null;
  }
  
  // Reset UI
  roomId = null;
  roomInput.disabled = false;
  joinBtn.disabled = false;
  leaveBtn.style.display = 'none';
  isHostingSync = false;
  shareUrlBtn.classList.remove('active');
  shareUrlBtn.textContent = '🎬 Host Sync';
  
  // Disconnect and reconnect socket to leave room
  socket.disconnect();
  setTimeout(() => {
    socket.connect();
  }, 100);
};

// Toggle camera/mic
toggleCameraBtn.onclick = () => {
  if (!localStream) {
    alert('No camera access. Refresh and allow permissions.');
    return;
  }
  const videoTrack = localStream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.enabled = !videoTrack.enabled;
    toggleCameraBtn.textContent = videoTrack.enabled ? '📷 Turn Camera Off' : '📷 Turn Camera On';
  }
};

toggleMicBtn.onclick = () => {
  if (!localStream) {
    alert('No microphone access. Refresh and allow permissions.');
    return;
  }
  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = !audioTrack.enabled;
    toggleMicBtn.textContent = audioTrack.enabled ? '🎤 Mute' : '🎤 Unmute';
  }
};

// Screen share
shareScreenBtn.onclick = async () => {
  if (!roomId) {
    alert('Join a room first.');
    return;
  }
  
  if (screenStream) {
    // Stop screen sharing and revert to camera
    screenStream.getTracks().forEach(track => track.stop());
    screenStream = null;
    
    for (const peerId of Object.keys(pcs)) {
      const pc = pcs[peerId];
      const senders = pc.getSenders();
      for (const sender of senders) {
        if (sender.track && sender.track.kind === 'video' && localStream) {
          const newTrack = localStream.getVideoTracks()[0];
          if (newTrack) {
            await sender.replaceTrack(newTrack);
          }
        }
      }
    }
    localVideo.srcObject = localStream;
    shareScreenBtn.textContent = '🖥️ Share Screen';
    return;
  }
  
  try {
    const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    screenStream = displayStream;
    const displayTrack = displayStream.getVideoTracks()[0];
    
    // Replace video tracks for all peers
    for (const peerId of Object.keys(pcs)) {
      const pc = pcs[peerId];
      const senders = pc.getSenders();
      for (const sender of senders) {
        if (sender.track && sender.track.kind === 'video') {
          await sender.replaceTrack(displayTrack);
        }
      }
    }
    
    localVideo.srcObject = displayStream;
    shareScreenBtn.textContent = '⏹️ Stop Sharing';
    
    displayTrack.onended = async () => {
      if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
        
        for (const peerId of Object.keys(pcs)) {
          const pc = pcs[peerId];
          const senders = pc.getSenders();
          for (const sender of senders) {
            if (sender.track && sender.track.kind === 'video' && localStream) {
              const newTrack = localStream.getVideoTracks()[0];
              if (newTrack) {
                await sender.replaceTrack(newTrack);
              }
            }
          }
        }
        localVideo.srcObject = localStream;
        shareScreenBtn.textContent = '🖥️ Share Screen';
      }
    };
  } catch (e) {
    console.error('screen share failed', e);
    alert('Screen share failed or was cancelled.');
  }
};

// Video URL sync with error handling
loadUrlBtn.onclick = () => {
  const url = videoUrlInput.value.trim();
  if (!url) {
    alert('Enter video URL (mp4, webm, etc.)');
    return;
  }
  
  videoErrorDiv.style.display = 'none';
  sharedVideo.src = url;
  
  sharedVideo.onerror = () => {
    videoErrorDiv.textContent = `Failed to load video: ${sharedVideo.error?.message || 'Unknown error'}. Check URL and CORS.`;
    videoErrorDiv.style.display = 'block';
    console.error('Video load error:', sharedVideo.error);
  };
  
  sharedVideo.onloadeddata = () => {
    videoErrorDiv.style.display = 'none';
    console.log('Video loaded successfully');
  };
};

playUrlBtn.onclick = () => {
  if (!sharedVideo.src) {
    alert('Load a URL first');
    return;
  }
  sharedVideo.play().catch(e => {
    console.error('Play failed:', e);
    alert('Cannot play video. Check if URL is valid and accessible.');
  });
  
  if (isHostingSync && roomId) {
    socket.emit('video-sync', { room: roomId, cmd: { type: 'play', time: sharedVideo.currentTime } });
  }
};

pauseUrlBtn.onclick = () => {
  sharedVideo.pause();
  if (isHostingSync && roomId) {
    socket.emit('video-sync', { room: roomId, cmd: { type: 'pause', time: sharedVideo.currentTime } });
  }
};

seekUrlBtn.onclick = () => {
  let seekTime = parseFloat(seekTimeInput.value);
  if (isNaN(seekTime)) {
    seekTime = 30;
  }
  sharedVideo.currentTime = Math.max(0, Math.min(seekTime, sharedVideo.duration || seekTime));
  if (isHostingSync && roomId) {
    socket.emit('video-sync', { room: roomId, cmd: { type: 'seek', time: sharedVideo.currentTime } });
  }
};

// Video sync receiver with throttling
let lastSyncTime = 0;

socket.on('video-sync', cmd => {
  if (!sharedVideo.src) return;
  if (isHostingSync) return; // Don't sync if we're the host
  
  const now = Date.now();
  if (now - lastSyncTime < 100) return; // Throttle
  lastSyncTime = now;
  
  if (cmd.type === 'play') {
    const targetTime = cmd.time || 0;
    const diff = Math.abs(sharedVideo.currentTime - targetTime);
    if (diff > 0.5) {
      sharedVideo.currentTime = targetTime;
    }
    sharedVideo.play().catch(e => console.log('Auto-play failed:', e));
  } else if (cmd.type === 'pause') {
    sharedVideo.pause();
    if (typeof cmd.time === 'number') {
      const diff = Math.abs(sharedVideo.currentTime - cmd.time);
      if (diff > 0.5) {
        sharedVideo.currentTime = cmd.time;
      }
    }
  } else if (cmd.type === 'seek') {
    sharedVideo.currentTime = cmd.time;
  }
});

// Host sync toggle
shareUrlBtn.onclick = () => {
  isHostingSync = !isHostingSync;
  if (isHostingSync) {
    shareUrlBtn.classList.add('active');
    shareUrlBtn.textContent = '🎬 Hosting Sync (ON)';
    alert('You are now the sync host. Your playback controls will be sent to others.');
  } else {
    shareUrlBtn.classList.remove('active');
    shareUrlBtn.textContent = '🎬 Host Sync';
  }
};

// Add sample video URL placeholder
videoUrlInput.placeholder = "Try: https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4";

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }
  if (screenStream) {
    screenStream.getTracks().forEach(track => track.stop());
  }
  Object.keys(pcs).forEach(peerId => {
    if (pcs[peerId]) {
      pcs[peerId].close();
    }
  });
});

console.log('Client loaded, waiting for room join...');