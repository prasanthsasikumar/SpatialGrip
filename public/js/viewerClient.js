/**
 * viewerClient.js — /show page logic
 *
 * Architecture (v3 — local hand tracking):
 * 1. Generates a room code and registers as a PeerJS peer.
 * 2. Displays the code + QR so the phone can connect.
 * 3. Receives video call from /read.
 * 4. Runs MediaPipe Hands LOCALLY on the received video stream.
 * 5. Feeds landmarks through GestureInterpreter → SceneManager.
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

  // Hidden canvas — we draw video frames onto this and feed IT to MediaPipe.
  // MediaPipe Hands has issues consuming <video> elements with remote WebRTC
  // streams (wrong dimensions, readyState quirks).  Drawing to a canvas first
  // normalises the input.
  const _mpCanvas = document.createElement('canvas');
  const _mpCtx    = _mpCanvas.getContext('2d');

  // ── State ───────────────────────────────────────────────────────────────
  let peer = null;
  let hands = null;
  let trackingActive = false;
  let framesReceived = 0;
  let _gestureTimeout = null;

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

  // ── 3. Receive video call from reader ───────────────────────────────────
  peer.on('call', (call) => {
    console.log('[viewer] incoming call from reader');
    updateStatus('Reader connecting…', false);

    // Answer with NO stream — keep SDP simple; recvonly is fine.
    call.answer();

    call.on('stream', (remoteStream) => {
      const tracks = remoteStream.getTracks();
      console.log('[viewer] received remote stream, tracks:', tracks.length);
      tracks.forEach((t, i) => {
        console.log(`  track[${i}]: kind=${t.kind} enabled=${t.enabled} muted=${t.muted} readyState=${t.readyState}`);
      });

      pipVideo.srcObject = remoteStream;
      pipVideo.play()
        .then(() => console.log('[viewer] pipVideo.play() OK'))
        .catch(e => console.warn('[viewer] pipVideo.play() fail:', e.message));

      if (roomPanel) roomPanel.classList.add('connected');
      updateStatus('Streaming ✓ — waiting for video frames…', true);

      _startHandTracking(pipVideo);
    });

    call.on('close', () => {
      console.log('[viewer] call closed');
      trackingActive = false;
      updateStatus(`Room: ${roomCode} — reader disconnected`, false);
      if (roomPanel) roomPanel.classList.remove('connected');
    });

    call.on('error', (err) => console.error('[viewer] call error:', err));
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

  // ── 4. Hand tracking ───────────────────────────────────────────────────

  async function _startHandTracking(videoEl) {
    if (trackingActive) return;

    // ── 4a. Init MediaPipe Hands (only once) ────────────────────────────
    if (!hands) {
      console.log('[viewer] initialising MediaPipe Hands…');
      hands = new Hands({
        locateFile: (file) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`,
      });
      hands.setOptions({
        maxNumHands: SG_CONFIG.HAND_TRACKING.maxNumHands,
        modelComplexity: SG_CONFIG.HAND_TRACKING.modelComplexity,
        minDetectionConfidence: SG_CONFIG.HAND_TRACKING.minDetectionConfidence,
        minTrackingConfidence: SG_CONFIG.HAND_TRACKING.minTrackingConfidence,
      });
      hands.onResults(_onHandResults);
    }

    // ── 4b. Wait for video to have decodable frames ─────────────────────
    console.log('[viewer] waiting for video frames…');
    await _waitForVideoReady(videoEl);

    // ── 4c. Start the tracking loop ─────────────────────────────────────
    trackingActive = true;
    console.log('[viewer] hand tracking active');
    updateStatus('Streaming ✓ — hand tracking active', true);
    _trackingLoop(videoEl);
  }

  /**
   * Poll until the <video> has decoded at least one frame.
   */
  function _waitForVideoReady(videoEl) {
    return new Promise((resolve) => {
      let n = 0;
      const poll = () => {
        n++;
        if (n <= 5 || n % 20 === 0) {
          console.log(`[viewer] video poll #${n}: readyState=${videoEl.readyState}, size=${videoEl.videoWidth}x${videoEl.videoHeight}, paused=${videoEl.paused}`);
        }
        if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
          console.log(`[viewer] video ready: ${videoEl.videoWidth}x${videoEl.videoHeight}`);
          resolve();
        } else {
          if (videoEl.paused) videoEl.play().catch(() => {});
          setTimeout(poll, 250);
        }
      };
      // Also resolve on events
      videoEl.addEventListener('playing', () => setTimeout(poll, 50), { once: true });
      videoEl.addEventListener('loadeddata', () => setTimeout(poll, 50), { once: true });
      poll();
    });
  }

  /**
   * Tracking loop — draws the video onto a canvas, then sends the canvas
   * to MediaPipe.  This avoids MediaPipe's issues with remote <video>
   * elements (dimension mismatches, CORS-tainted pixels, etc.).
   */
  let _framesSent = 0;
  let _consecutiveErrors = 0;

  async function _trackingLoop(videoEl) {
    if (!trackingActive) return;

    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;

    if (vw > 0 && vh > 0) {
      // Resize the offscreen canvas to match the actual video dimensions
      if (_mpCanvas.width !== vw || _mpCanvas.height !== vh) {
        _mpCanvas.width = vw;
        _mpCanvas.height = vh;
        console.log(`[viewer] offscreen canvas sized: ${vw}x${vh}`);
      }

      try {
        _mpCtx.drawImage(videoEl, 0, 0, vw, vh);
        await hands.send({ image: _mpCanvas });
        _framesSent++;
        _consecutiveErrors = 0;
        if (_framesSent <= 3 || _framesSent % 300 === 0) {
          console.log(`[viewer] frames→MediaPipe: ${_framesSent}, hands detected: ${framesReceived}`);
        }
      } catch (err) {
        _consecutiveErrors++;
        if (_consecutiveErrors <= 3 || _consecutiveErrors % 100 === 0) {
          console.warn(`[viewer] tracking error #${_consecutiveErrors}:`, err.message || err);
        }
      }
    }

    requestAnimationFrame(() => _trackingLoop(videoEl));
  }

  // ── 5. Process hand results ────────────────────────────────────────────

  function _onHandResults(results) {
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      const lm = results.multiHandLandmarks[0];
      framesReceived++;
      if (framesReceived <= 3 || framesReceived % 200 === 0) {
        console.log(`[viewer] hand #${framesReceived}`);
      }

      const gesture = GestureInterpreter.interpret(lm);
      if (!gesture) return;

      SceneManager.applyGesture(gesture);

      const obj = SceneManager.getObject();
      if (obj) obj._hasGesture = true;
      clearTimeout(_gestureTimeout);
      _gestureTimeout = setTimeout(() => { if (obj) obj._hasGesture = false; }, 500);

      _updateHUD(gesture);
    }
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
