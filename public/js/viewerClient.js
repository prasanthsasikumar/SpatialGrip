/**
 * viewerClient.js — /show page logic (Socket.IO version)
 *
 * 1. Generates a room code and creates a Socket.IO room.
 * 2. Displays the code + QR so the phone can connect.
 * 3. Receives hand-tracking data from /read via Socket.IO.
 * 4. Feeds data through GestureInterpreter → SceneManager.
 */

(() => {
  // DOM refs
  const canvasEl = document.getElementById('three-canvas');
  const statusEl = document.getElementById('status');
  const hudEl    = document.getElementById('hud');
  const roomCodeEl  = document.getElementById('room-code');
  const roomPanel   = document.getElementById('room-panel');
  const qrEl        = document.getElementById('qr-code');

  // ── 1. Initialise Three.js scene ────────────────────────────────────────
  SceneManager.init(canvasEl);

  // ── 2. Generate room code + connect Socket.IO ───────────────────────────
  const roomCode = SG_CONFIG.getRoomFromURL() || SG_CONFIG.generateRoomCode();

  roomCodeEl.textContent = roomCode;

  const joinURL = `${location.origin}/read?room=${roomCode}`;

  if (qrEl) {
    qrEl.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(joinURL)}&bgcolor=000000&color=ffffff`;
    qrEl.alt = joinURL;
    qrEl.title = joinURL;
  }

  updateStatus(`Room: ${roomCode} — connecting…`, false);

  const socket = io({ transports: ['websocket', 'polling'] });

  socket.on('connect', () => {
    console.log('[viewer] socket connected:', socket.id);

    // Create the room on the server
    socket.emit('create-room', roomCode, (resp) => {
      if (resp && resp.ok) {
        console.log('[viewer] room created:', roomCode);
        updateStatus(`Room: ${roomCode} — scan QR or enter code on phone`, false);
      } else {
        console.error('[viewer] room create failed:', resp);
        updateStatus('Failed to create room', false);
      }
    });
  });

  // ── 3. Receive hand data from reader ────────────────────────────────────
  let _msgCount = 0;

  socket.on('hand', (data) => {
    _msgCount++;

    // Update hand skeleton visualisation
    SceneManager.updateHandLandmarks(data.landmarks);

    // Run gesture interpretation on the landmarks
    const gesture = GestureInterpreter.interpret(data.landmarks);
    if (gesture) {
      SceneManager.applyGesture(gesture);

      // Update HUD with gesture state
      if (hudEl) {
        hudEl.innerHTML = [
          `Mode: ${gesture.mode}`,
          `Pinch: ${gesture.pinching ? '✊' : '✋'}  dist: ${gesture.pinchDistance.toFixed(3)}`,
          `Rot Δ: ${gesture.rotationDelta.toFixed(4)}`,
          `Scale Δ: ${gesture.scaleDelta.toFixed(4)}`,
          `Msgs: ${_msgCount}`,
        ].join('<br>');
      }
    }
  });

  // ── 4. Reader connect / disconnect events ───────────────────────────────
  socket.on('reader-connected', ({ id }) => {
    console.log('[viewer] reader connected:', id);
    if (roomPanel) roomPanel.classList.add('connected');
    updateStatus('Connected ✓', true);
  });

  socket.on('reader-disconnected', ({ id }) => {
    console.log('[viewer] reader disconnected:', id);
    GestureInterpreter.reset();
    updateStatus(`Room: ${roomCode} — reader disconnected`, false);
    if (roomPanel) roomPanel.classList.remove('connected');
  });

  socket.on('disconnect', (reason) => {
    console.log('[viewer] socket disconnected:', reason);
    updateStatus('Disconnected — reconnecting…', false);
    if (roomPanel) roomPanel.classList.remove('connected');
  });

  socket.on('reconnect', () => {
    console.log('[viewer] reconnected — re-creating room');
    socket.emit('create-room', roomCode, (resp) => {
      if (resp && resp.ok) {
        updateStatus(`Room: ${roomCode} — waiting for reader…`, false);
      }
    });
  });

  // ── Helpers ────────────────────────────────────────────────────────────
  function updateStatus(text, ok) {
    statusEl.innerHTML = `<span class="dot"></span>${text}`;
    statusEl.className = ok ? 'connected' : '';
  }
})();
