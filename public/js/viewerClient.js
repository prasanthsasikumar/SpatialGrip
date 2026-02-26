/**
 * viewerClient.js — /show page logic (PeerJS edition)
 *
 * 1. Generates a room code and registers as a PeerJS peer.
 * 2. Displays the code + QR so the phone can connect.
 * 3. Receives video call and data connection from /read.
 * 4. Feeds landmarks through GestureInterpreter → SceneManager each frame.
 *
 * No custom WebSocket server required — works on Vercel or any static host.
 */

(() => {
  // DOM refs
  const pipVideo = document.getElementById('pip-video');
  const canvasEl = document.getElementById('three-canvas');
  const statusEl = document.getElementById('status');
  const hudEl    = document.getElementById('hud');
  const roomCodeEl  = document.getElementById('room-code');
  const roomPanel   = document.getElementById('room-panel');
  const qrEl        = document.getElementById('qr-code');

  // ── State ───────────────────────────────────────────────────────────────
  let peer = null;
  let framesReceived = 0;

  // ── 1. Initialise Three.js scene ────────────────────────────────────────
  SceneManager.init(canvasEl);

  // ── 2. Generate room code + register PeerJS ─────────────────────────────
  const roomCode = SG_CONFIG.getRoomFromURL() || SG_CONFIG.generateRoomCode();
  const myId = SG_CONFIG.peerIdViewer(roomCode);

  // Display room code
  roomCodeEl.textContent = roomCode;

  // Build a join URL for the phone
  const joinURL = `${location.origin}/read?room=${roomCode}`;

  // Generate QR code (using a public QR API — no dependency needed)
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

  // ── 3. Receive video call from reader ───────────────────────────────────
  peer.on('call', (call) => {
    console.log('[viewer] incoming call from reader');
    updateStatus('Reader connecting…', false);

    // Answer with no stream (viewer doesn't send video back)
    call.answer();

    call.on('stream', (remoteStream) => {
      console.log('[viewer] received video stream');
      pipVideo.srcObject = remoteStream;
      updateStatus('Streaming ✓', true);
      // Hide the room panel once connected
      if (roomPanel) roomPanel.classList.add('connected');
    });

    call.on('close', () => {
      console.log('[viewer] call closed');
      updateStatus(`Room: ${roomCode} — reader disconnected`, false);
      if (roomPanel) roomPanel.classList.remove('connected');
    });

    call.on('error', (err) => {
      console.error('[viewer] call error:', err);
    });
  });

  // ── 4. Receive data connection for landmarks ───────────────────────────
  peer.on('connection', (conn) => {
    console.log('[viewer] data connection from reader');

    conn.on('data', (data) => {
      if (data && data.type === 'landmarks') {
        _processLandmarks(data.lm);
      }
    });

    conn.on('close', () => {
      console.log('[viewer] data connection closed');
    });
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

  // ── 5. Process incoming landmarks ──────────────────────────────────────
  let _gestureTimeout = null;

  function _processLandmarks(lm) {
    framesReceived++;
    const gesture = GestureInterpreter.interpret(lm);
    if (!gesture) return;

    SceneManager.applyGesture(gesture);

    // Mark that we're receiving gesture data (stops idle rotation)
    const obj = SceneManager.getObject();
    if (obj) obj._hasGesture = true;

    // If no landmarks for 500 ms, resume idle rotation
    clearTimeout(_gestureTimeout);
    _gestureTimeout = setTimeout(() => {
      if (obj) obj._hasGesture = false;
    }, 500);

    // Update HUD
    _updateHUD(gesture);
  }

  // ── HUD ────────────────────────────────────────────────────────────────
  function _updateHUD(g) {
    hudEl.innerHTML = [
      `pos: ${g.position.x.toFixed(2)}, ${g.position.y.toFixed(2)}`,
      `rot: ${g.rotation.x.toFixed(2)}, ${g.rotation.y.toFixed(2)}, ${g.rotation.z.toFixed(2)}`,
      `scale: ${g.scale.toFixed(2)}`,
      `pinch: ${g.pinching ? 'YES' : 'no'} (${g.pinchDistance.toFixed(3)})`,
      `frames: ${framesReceived}`,
    ].join('<br>');
  }

  // ── Helpers ────────────────────────────────────────────────────────────
  function updateStatus(text, ok) {
    statusEl.innerHTML = `<span class="dot"></span>${text}`;
    statusEl.className = ok ? 'connected' : '';
  }
})();
