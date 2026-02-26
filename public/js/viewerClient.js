/**
 * viewerClient.js — /show page logic
 *
 * Architecture (v4 — data-only):
 * 1. Generates a room code and registers as a PeerJS peer.
 * 2. Displays the code + QR so the phone can connect.
 * 3. Receives hand-tracking DATA from /read via PeerJS data connection.
 * 4. Feeds data through GestureInterpreter → SceneManager.
 *
 * NO video is received — hand tracking runs on the reader side.
 */

(() => {
  // DOM refs
  const canvasEl = document.getElementById('three-canvas');
  const statusEl = document.getElementById('status');
  const hudEl    = document.getElementById('hud');
  const roomCodeEl  = document.getElementById('room-code');
  const roomPanel   = document.getElementById('room-panel');
  const qrEl        = document.getElementById('qr-code');

  // ── State ───────────────────────────────────────────────────────────────
  let peer = null;

  // ── 1. Initialise Three.js scene ────────────────────────────────────────
  SceneManager.init(canvasEl);

  // ── 2. Generate room code + register PeerJS ─────────────────────────────
  const roomCode = SG_CONFIG.getRoomFromURL() || SG_CONFIG.generateRoomCode();
  const myId = SG_CONFIG.peerIdViewer(roomCode);

  roomCodeEl.textContent = roomCode;

  const joinURL = `${location.origin}/read?room=${roomCode}`;

  if (qrEl) {
    qrEl.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(joinURL)}&bgcolor=000000&color=ffffff`;
    qrEl.alt = joinURL;
    qrEl.title = joinURL;
  }

  updateStatus(`Room: ${roomCode} — waiting for reader…`, false);

  peer = new Peer(myId, SG_CONFIG.PEER_CONFIG);

  peer.on('open', (id) => {
    console.log('[viewer] peer open:', id);
    updateStatus(`Room: ${roomCode} — scan QR or enter code on phone`, false);
  });

  // ── 3. Receive data connection from reader ──────────────────────────────
  peer.on('connection', (conn) => {
    console.log('[viewer] incoming data connection from reader');
    updateStatus('Reader connecting…', false);

    conn.on('open', () => {
      console.log('[viewer] data connection open');
      if (roomPanel) roomPanel.classList.add('connected');
      updateStatus('Connected ✓', true);
    });

    conn.on('data', (data) => {
      console.log('[viewer] received data:', data);
    });

    conn.on('close', () => {
      console.log('[viewer] data connection closed');
      updateStatus(`Room: ${roomCode} — reader disconnected`, false);
      if (roomPanel) roomPanel.classList.remove('connected');
    });

    conn.on('error', (err) => console.error('[viewer] data connection error:', err));
  });

  peer.on('error', (err) => {
    console.error('[viewer] peer error:', err);
    if (err.type === 'unavailable-id') {
      updateStatus('Another viewer already has this room code — refresh to get a new one', false);
    } else {
      updateStatus(`Error: ${err.type}`, false);
    }
  });

  peer.on('disconnected', () => {
    console.log('[viewer] peer disconnected — reconnecting…');
    updateStatus('Reconnecting…', false);
    peer.reconnect();
  });

  // ── Helpers ────────────────────────────────────────────────────────────
  function updateStatus(text, ok) {
    statusEl.innerHTML = `<span class="dot"></span>${text}`;
    statusEl.className = ok ? 'connected' : '';
  }
})();
