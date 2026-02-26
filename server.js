/**
 * SpatialGrip — Express + WebSocket signaling server
 *
 * Roles
 *   /read  → phone / wearable (camera sender)
 *   /show  → laptop browser   (3D viewer)
 *
 * The server does three things:
 *   1. Serves static files from /public
 *   2. Runs a lightweight WebSocket signaling relay so /read and /show
 *      can negotiate a WebRTC peer connection.
 *   3. Relays hand-landmark data from /read → /show over a secondary
 *      WebSocket channel (fallback when DataChannel isn't available).
 */

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);

// ─── Static files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// Convenience redirects
app.get('/read', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'read.html')));
app.get('/show', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'show.html')));

// ─── WebSocket signaling ──────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });

/**
 * Simple room model: one "reader" and one "viewer" at a time.
 * Messages are JSON with a `type` field that the server uses to relay.
 */
let reader = null;   // ws connection from /read
let viewer = null;   // ws connection from /show

wss.on('connection', (ws, req) => {
  const url = req.url || '';

  // Identify role from query-string  ?role=reader|viewer
  const role = new URL(req.url, `http://${req.headers.host}`).searchParams.get('role');

  if (role === 'reader') {
    reader = ws;
    console.log('[signaling] reader connected');
    // If the viewer is already waiting, tell both sides to start
    if (viewer && viewer.readyState === 1) {
      viewer.send(JSON.stringify({ type: 'reader-ready' }));
      ws.send(JSON.stringify({ type: 'viewer-ready' }));  // tell reader to send offer
    }
  } else if (role === 'viewer') {
    viewer = ws;
    console.log('[signaling] viewer connected');
    if (reader && reader.readyState === 1) {
      ws.send(JSON.stringify({ type: 'reader-ready' }));    // tell viewer reader exists
      reader.send(JSON.stringify({ type: 'viewer-ready' })); // tell reader to send offer
    }
  }

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // ── Signaling relay (offer / answer / ice) ──────────────────────────
    if (['offer', 'answer', 'ice-candidate'].includes(msg.type)) {
      const target = (ws === reader) ? viewer : reader;
      if (target && target.readyState === 1) {
        target.send(JSON.stringify(msg));
      }
      return;
    }

    // ── Hand-landmark relay (fallback path) ─────────────────────────────
    if (msg.type === 'landmarks') {
      if (viewer && viewer.readyState === 1) {
        viewer.send(JSON.stringify(msg));
      }
      return;
    }

    // ── Depth-estimation placeholder relay ──────────────────────────────
    if (msg.type === 'depth') {
      if (viewer && viewer.readyState === 1) {
        viewer.send(JSON.stringify(msg));
      }
      return;
    }
  });

  ws.on('close', () => {
    if (ws === reader) { reader = null; console.log('[signaling] reader disconnected'); }
    if (ws === viewer) { viewer = null; console.log('[signaling] viewer disconnected'); }
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  SpatialGrip running on:`);
  console.log(`    Local:   http://localhost:${PORT}`);

  // Print LAN address so the phone can connect
  const nets = require('os').networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`    Network: http://${net.address}:${PORT}`);
      }
    }
  }

  console.log(`\n  Open /read on your phone and /show on your laptop.\n`);
});
