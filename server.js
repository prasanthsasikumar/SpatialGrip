/**
 * SpatialGrip — Local development server
 *
 * Serves static files from /public.  Signaling is handled by PeerJS cloud
 * (0.peerjs.com), so no WebSocket server is needed.
 *
 * This file is only used for local development (node server.js).
 * On Vercel, the /public folder is served as static files via vercel.json.
 */

const express = require('express');
const path = require('path');

const PORT = process.env.PORT || 3000;
const app = express();

// ─── Static files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// Convenience routes so /read and /show work without .html
app.get('/read', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'read.html')));
app.get('/show', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'show.html')));

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
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

  console.log(`\n  Open /show on your laptop, /read on your phone.`);
  console.log(`  They connect via PeerJS cloud — no WebSocket server needed.\n`);
});
