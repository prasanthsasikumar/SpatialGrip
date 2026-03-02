/**
 * readerClient.js — /read page logic (Socket.IO version)
 *
 * 1. Gets room code from URL (?room=XXXX) or prompts user.
 * 2. Starts the camera, runs hand tracking locally.
 * 3. Sends hand-tracking data to the viewer via Socket.IO (server relay).
 */

(async () => {
  // DOM refs
  const videoEl  = document.getElementById('video');
  const canvasEl = document.getElementById('overlay');
  const statusEl = document.getElementById('status');
  const roomEl   = document.getElementById('room-input');
  const joinBtn  = document.getElementById('join-btn');
  const roomUI   = document.getElementById('room-ui');

  // ── State ───────────────────────────────────────────────────────────────
  let socket = null;
  let roomCode = null;
  let connected = false;

  // ── 1. Start camera (needed for local hand tracking) ───────────────────
  updateStatus('Starting camera…', false);

  let cameraStream;
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia(
      SG_CONFIG.CAMERA_CONSTRAINTS,
    );
    videoEl.srcObject = cameraStream;
    videoEl.setAttribute('playsinline', '');
    await videoEl.play();

    const tracks = cameraStream.getVideoTracks();
    console.log('[reader] camera started, tracks:', tracks.length);
    tracks.forEach((t) => {
      const s = t.getSettings();
      console.log('  track:', t.label, `${s.width}x${s.height}@${s.frameRate}fps`);
    });

    updateStatus('Camera ready — enter room code', true);
  } catch (err) {
    console.error('[reader] camera error:', err);
    updateStatus('Camera access denied', false);
    return;
  }

  // Start hand tracking overlay + data sending
  _initHandOverlay(videoEl, canvasEl);

  // ── 2. Room code handling ───────────────────────────────────────────────
  const urlRoom = SG_CONFIG.getRoomFromURL();
  if (urlRoom) {
    roomCode = urlRoom.toUpperCase();
    roomEl.value = roomCode;
    joinRoom();
  } else {
    roomUI.style.display = 'flex';
  }

  joinBtn.addEventListener('click', () => {
    const val = roomEl.value.trim().toUpperCase();
    if (val.length < 4) { alert('Enter the room code shown on /show'); return; }
    roomCode = val;
    joinRoom();
  });

  roomEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinBtn.click();
  });

  // ── 3. Connect via Socket.IO and join room ─────────────────────────────
  function joinRoom() {
    roomUI.style.display = 'none';
    updateStatus(`Joining room ${roomCode}…`, false);

    // Connect to the same origin that served this page
    socket = io({ transports: ['websocket', 'polling'] });

    socket.on('connect', () => {
      console.log('[reader] socket connected:', socket.id);

      // Join the room created by the viewer
      socket.emit('join-room', roomCode, (resp) => {
        if (resp && resp.ok) {
          console.log('[reader] joined room', roomCode);
          connected = true;
          updateStatus('Connected ✓', true);
        } else {
          console.error('[reader] join failed:', resp);
          updateStatus(`Room "${roomCode}" not found — is /show open?`, false);
        }
      });
    });

    socket.on('disconnect', (reason) => {
      console.log('[reader] socket disconnected:', reason);
      connected = false;
      updateStatus('Disconnected — reconnecting…', false);
    });

    socket.on('reconnect', () => {
      console.log('[reader] reconnected — re-joining room');
      socket.emit('join-room', roomCode, (resp) => {
        if (resp && resp.ok) {
          connected = true;
          updateStatus('Connected ✓', true);
        }
      });
    });

    socket.on('room-closed', () => {
      console.log('[reader] room closed by viewer');
      connected = false;
      updateStatus('Viewer disconnected — room closed', false);
    });
  }

  // ── Hand tracking overlay + data sending ───────────────────────────────
  let _lastSendTime = 0;

  function _initHandOverlay(videoEl, canvasEl) {
    try {
      const hands = new Hands({
        locateFile: (file) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`,
      });
      hands.setOptions({
        maxNumHands: SG_CONFIG.HAND_TRACKING.maxNumHands,
        modelComplexity: SG_CONFIG.HAND_TRACKING.modelComplexity,
        minDetectionConfidence: SG_CONFIG.HAND_TRACKING.minDetectionConfidence,
        minTrackingConfidence: SG_CONFIG.HAND_TRACKING.minTrackingConfidence,
      });

      const drawCtx = canvasEl.getContext('2d');

      hands.onResults((results) => {
        // Draw debug overlay
        const w = canvasEl.clientWidth;
        const h = canvasEl.clientHeight;
        canvasEl.width = w;
        canvasEl.height = h;
        drawCtx.clearRect(0, 0, w, h);
        if (results.multiHandLandmarks) {
          for (const lm of results.multiHandLandmarks) {
            drawConnectors(drawCtx, lm, HAND_CONNECTIONS, { color: 'rgba(0,255,200,0.4)', lineWidth: 2 });
            drawLandmarks(drawCtx, lm, { color: 'rgba(0,255,200,0.8)', lineWidth: 1, radius: 3 });
          }
        }

        // Send hand data to viewer via Socket.IO
        const now = Date.now();
        if (socket && connected && results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
          if (now - _lastSendTime >= SG_CONFIG.LANDMARK_INTERVAL) {
            _lastSendTime = now;
            socket.volatile.emit('hand', {
              landmarks: results.multiHandLandmarks[0].map(p => ({ x: p.x, y: p.y, z: p.z })),
              handedness: results.multiHandedness ? results.multiHandedness[0] : null,
              timestamp: now,
            });
          }
        }
      });

      // Frame loop — feed video frames to MediaPipe
      let _busy = false;
      async function loop() {
        if (!_busy && videoEl.readyState >= 2) {
          _busy = true;
          try { await hands.send({ image: videoEl }); } catch (e) { console.error('[reader] frame error:', e); }
          _busy = false;
        }
        requestAnimationFrame(loop);
      }
      loop();
      console.log('[reader] hand overlay started');
    } catch (err) {
      console.warn('[reader] hand overlay failed (non-fatal):', err.message);
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────
  function updateStatus(text, ok) {
    statusEl.innerHTML = `<span class="dot"></span>${text}`;
    statusEl.className = ok ? 'connected' : '';
  }
})();
