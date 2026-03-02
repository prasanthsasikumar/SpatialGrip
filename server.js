/**
 * SpatialGrip — Server with Socket.IO relay
 *
 * Serves static files from /public and relays hand-tracking data between
 * /read (phone) and /show (laptop) via Socket.IO rooms.
 *
 * Architecture:
 *   1. Viewer (/show) creates a room → gets a room code.
 *   2. Reader (/read) joins that room.
 *   3. Reader sends hand data → server relays to the room → viewer receives.
 *
 * Usage:  node server.js
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  // Optimise for low-latency small messages
  pingInterval: 10000,
  pingTimeout: 5000,
  maxHttpBufferSize: 1e6,       // 1 MB — plenty for hand data
});

// ─── Static files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// Convenience routes so /read and /show work without .html
app.get('/read', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'read.html')));
app.get('/show', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'show.html')));

// ─── Room tracking ────────────────────────────────────────────────────────────
const rooms = new Map();  // roomCode → { viewer: socketId, readers: Set<socketId> }

io.on('connection', (socket) => {
  console.log(`[io] connected: ${socket.id}`);

  // ── Viewer creates / joins a room ─────────────────────────────────────
  socket.on('create-room', (roomCode, ack) => {
    socket.join(roomCode);
    rooms.set(roomCode, { viewer: socket.id, readers: new Set() });
    socket.data.room = roomCode;
    socket.data.role = 'viewer';
    console.log(`[io] viewer ${socket.id} created room ${roomCode}`);
    if (typeof ack === 'function') ack({ ok: true });
  });

  // ── Reader joins an existing room ─────────────────────────────────────
  socket.on('join-room', (roomCode, ack) => {
    const room = rooms.get(roomCode);
    if (!room) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Room not found' });
      return;
    }
    socket.join(roomCode);
    room.readers.add(socket.id);
    socket.data.room = roomCode;
    socket.data.role = 'reader';
    console.log(`[io] reader ${socket.id} joined room ${roomCode}`);

    // Notify viewer that a reader connected
    io.to(room.viewer).emit('reader-connected', { id: socket.id });

    if (typeof ack === 'function') ack({ ok: true });
  });

  // ── Hand data relay (reader → viewer) ─────────────────────────────────
  // Use volatile emit — if the viewer is busy, drop the frame rather than
  // queueing.  This keeps latency low for real-time hand tracking.
  socket.on('hand', (data) => {
    const roomCode = socket.data.room;
    if (!roomCode) return;
    socket.volatile.to(roomCode).emit('hand', data);
  });

  // ── Generic message relay (for future use) ────────────────────────────
  socket.on('msg', (data) => {
    const roomCode = socket.data.room;
    if (!roomCode) return;
    socket.to(roomCode).emit('msg', data);
  });

  // ── Disconnect cleanup ────────────────────────────────────────────────
  socket.on('disconnect', (reason) => {
    const roomCode = socket.data.room;
    const role = socket.data.role;
    console.log(`[io] ${role || 'unknown'} ${socket.id} disconnected (${reason})`);

    if (roomCode && rooms.has(roomCode)) {
      const room = rooms.get(roomCode);
      if (role === 'viewer') {
        // Viewer left — tear down the room
        io.to(roomCode).emit('room-closed');
        rooms.delete(roomCode);
      } else if (role === 'reader') {
        room.readers.delete(socket.id);
        io.to(roomCode).emit('reader-disconnected', { id: socket.id });
      }
    }
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  SpatialGrip running on:`);
  console.log(`    Local:   http://localhost:${PORT}`);

  const nets = require('os').networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`    Network: http://${net.address}:${PORT}`);
      }
    }
  }

  console.log(`\n  Open /show on your laptop, /read on your phone.`);
  console.log(`  Connected via Socket.IO — works on any browser.\n`);
});
