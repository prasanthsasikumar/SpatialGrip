/**
 * readerClient.js — /read page logic
 *
 * Architecture (v3 — video-only):
 * 1. Gets room code from URL (?room=XXXX) or prompts user.
 * 2. Starts the camera, optionally draws debug landmark overlay.
 * 3. Sends the camera stream to the viewer via PeerJS call.
 *
 * Hand tracking for 3D control happens on the VIEWER side.
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
  let mediaConn = null;
  let roomCode = null;
  let cameraStream = null;

  // ── 1. Start camera directly (no Camera utility) ───────────────────────
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

  // Optional: debug hand overlay (doesn't affect the stream)
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

  // ── 3. Connect to viewer — video call only ─────────────────────────────
  function startConnection() {
    roomUI.style.display = 'none';
    updateStatus(`Joining room ${roomCode}…`, false);

    const myId     = SG_CONFIG.peerIdReader(roomCode);
    const viewerId = SG_CONFIG.peerIdViewer(roomCode);

    peer = new Peer(myId, SG_CONFIG.PEER_CONFIG);

    peer.on('open', (id) => {
      console.log('[reader] peer open:', id);

      if (!cameraStream || !cameraStream.active) {
        console.error('[reader] no camera stream!');
        updateStatus('Error: no camera stream', false);
        return;
      }

      // Send the raw camera stream directly — no cloning needed
      console.log('[reader] calling viewer:', viewerId,
        'stream active:', cameraStream.active,
        'tracks:', cameraStream.getTracks().map(t => `${t.kind}:${t.readyState}`).join(', '));
      mediaConn = peer.call(viewerId, cameraStream);

      mediaConn.on('stream', () => {
        console.log('[reader] call established (stream event)');
      });

      mediaConn.on('close', () => {
        console.log('[reader] call closed');
        updateStatus('Call ended', false);
      });

      mediaConn.on('error', (err) => {
        console.error('[reader] call error:', err);
      });

      updateStatus('Streaming ✓', true);
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

  // ── Debug hand overlay (optional, non-interfering) ─────────────────────
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
