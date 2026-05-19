const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Serve static files from "public" directory
app.use(express.static('public'));
// Fallback for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Store room participants
const rooms = new Map();

// Simple signaling + chat + video-sync
io.on('connection', socket => {
  console.log('socket connected', socket.id);

  socket.on('join-room', roomId => {
    // Leave previous room if any
    if (socket.roomId) {
      socket.leave(socket.roomId);
      if (rooms.has(socket.roomId)) {
        const room = rooms.get(socket.roomId);
        room.delete(socket.id);
        if (room.size === 0) {
          rooms.delete(socket.roomId);
        }
      }
    }
    
    socket.join(roomId);
    socket.roomId = roomId;
    
    // Track room participants
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    rooms.get(roomId).add(socket.id);
    
    // Notify others
    socket.to(roomId).emit('user-joined', socket.id);
    
    // Send existing users to new user
    const clients = Array.from(rooms.get(roomId) || []).filter(id => id !== socket.id);
    socket.emit('existing-users', clients);
    
    console.log(`User ${socket.id} joined room ${roomId}, participants: ${clients.length + 1}`);
  });

  socket.on('offer', ({ target, sdp }) => {
    io.to(target).emit('offer', { from: socket.id, sdp });
  });

  socket.on('answer', ({ target, sdp }) => {
    io.to(target).emit('answer', { from: socket.id, sdp });
  });

  socket.on('ice-candidate', ({ target, candidate }) => {
    io.to(target).emit('ice-candidate', { from: socket.id, candidate });
  });

  socket.on('chat-message', ({ room, message, name }) => {
    io.to(room).emit('chat-message', { 
      id: socket.id, 
      message: message.slice(0, 500), // Limit message length
      name: name?.slice(0, 50) || 'Anonymous', 
      ts: Date.now() 
    });
  });

  socket.on('video-sync', ({ room, cmd }) => {
    socket.to(room).emit('video-sync', cmd);
  });

  socket.on('disconnect', () => {
    if (socket.roomId) {
      socket.to(socket.roomId).emit('user-left', socket.id);
      if (rooms.has(socket.roomId)) {
        rooms.get(socket.roomId).delete(socket.id);
        if (rooms.get(socket.roomId).size === 0) {
          rooms.delete(socket.roomId);
        }
      }
      console.log(`User ${socket.id} left room ${socket.roomId}`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));