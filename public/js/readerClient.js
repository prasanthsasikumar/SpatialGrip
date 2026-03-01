/**
 * readerClient.js — /read page logic
 *
 * Architecture (v4 — data-only):
 * 1. Gets room code from URL (?room=XXXX) or prompts user.
 * 2. Starts the camera, runs hand tracking locally.
 * 3. Sends hand-tracking data to the viewer via PeerJS data connection.
 *
 * NO video is sent to the viewer.
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
  let peer = null;
  let dataConn = null;
  let roomCode = null;
  let cameraStream = null;

  // ── 1. Start camera (needed for local hand tracking) ───────────────────
  updateStatus('Starting camera…', false);

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

  // Optional: debug hand overlay on the reader side
  _initHandOverlay(videoEl, canvasEl);

  // ── 2. Room code handling ───────────────────────────────────────────────
  const urlRoom = SG_CONFIG.getRoomFromURL();
  if (urlRoom) {
    roomCode = urlRoom.toUpperCase();
    roomEl.value = roomCode;
    startConnection();
  } else {
    roomUI.style.display = 'flex';
  }

  joinBtn.addEventListener('click', () => {
    const val = roomEl.value.trim().toUpperCase();
    if (val.length < 4) { alert('Enter the room code shown on /show'); return; }
    roomCode = val;
    startConnection();
  });

  roomEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinBtn.click();
  });

  // ── 3. Connect to viewer — data connection only (no video) ─────────────
  function startConnection() {
    roomUI.style.display = 'none';
    updateStatus(`Joining room ${roomCode}…`, false);

    const myId     = SG_CONFIG.peerIdReader(roomCode);
    const viewerId = SG_CONFIG.peerIdViewer(roomCode);

    peer = new Peer(myId, SG_CONFIG.PEER_CONFIG);

    peer.on('open', (id) => {
      console.log('[reader] peer open:', id);

      // Open a data connection to the viewer (no video stream)
      console.log('[reader] connecting data channel to viewer:', viewerId);
      dataConn = peer.connect(viewerId, { reliable: true });

      dataConn.on('open', () => {
        console.log('[reader] data connection open');
        updateStatus('Connected ✓', true);

        // Send a hello message to confirm the channel works
        dataConn.send({ type: 'hello', message: 'hello' });
        console.log('[reader] sent hello');
      });

      dataConn.on('close', () => {
        console.log('[reader] data connection closed');
        updateStatus('Disconnected', false);
      });

      dataConn.on('error', (err) => {
        console.error('[reader] data connection error:', err);
      });
    });

    peer.on('error', (err) => {
      console.error('[reader] peer error:', err);
      if (err.type === 'peer-unavailable') {
        updateStatus(`Viewer not found — is /show open with code ${roomCode}?`, false);
      } else if (err.type === 'unavailable-id') {
        updateStatus('Another reader already connected with this code', false);
      } else {
        updateStatus(`Error: ${err.type}`, false);
      }
    });

    peer.on('disconnected', () => {
      console.log('[reader] disconnected — reconnecting…');
      updateStatus('Reconnecting…', false);
      peer.reconnect();
    });
  }

  // ── Debug hand overlay + data sending ──────────────────────────────────
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

        // Send hand data to viewer via PeerJS
        const now = Date.now();
        if (dataConn && dataConn.open && results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
          if (now - _lastSendTime >= SG_CONFIG.LANDMARK_INTERVAL) {
            _lastSendTime = now;
            const payload = {
              type: 'hand',
              landmarks: results.multiHandLandmarks[0].map(p => ({ x: p.x, y: p.y, z: p.z })),
              handedness: results.multiHandedness ? results.multiHandedness[0] : null,
              timestamp: now,
            };
            dataConn.send(payload);
          }
        }
      });
      async function loop() {
        if (videoEl.readyState >= 2) {
          try { await hands.send({ image: videoEl }); } catch (_) {}
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
