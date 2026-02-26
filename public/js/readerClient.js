/**
 * readerClient.js — /read page logic (PeerJS edition)
 *
 * 1. Gets room code from URL (?room=XXXX) or prompts user.
 * 2. Starts the camera and hand tracker.
 * 3. Connects to the viewer via PeerJS (call for video, dataConnection for landmarks).
 *
 * No custom WebSocket server required — works on Vercel, any static host, or locally.
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
  let peer = null;            // PeerJS Peer instance
  let dataConn = null;        // PeerJS DataConnection for landmarks
  let mediaConn = null;       // PeerJS MediaConnection for video
  let lastLandmarkSend = 0;
  let roomCode = null;

  // ── 1. Get camera stream first ──────────────────────────────────────────
  let localStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia(
      SG_CONFIG.CAMERA_CONSTRAINTS,
    );
    videoEl.srcObject = localStream;
    updateStatus('Camera ready — enter room code', true);
  } catch (err) {
    console.error('[reader] camera error:', err);
    updateStatus('Camera access denied', false);
    return;
  }

  // ── 2. Room code handling ───────────────────────────────────────────────
  // Check URL for ?room=XXXX (e.g. scanned QR code)
  const urlRoom = SG_CONFIG.getRoomFromURL();
  if (urlRoom) {
    roomCode = urlRoom.toUpperCase();
    roomEl.value = roomCode;
    startConnection();
  } else {
    // Show the room code input and wait for user
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

  // ── 3. Connect to viewer via PeerJS ─────────────────────────────────────
  function startConnection() {
    roomUI.style.display = 'none';
    updateStatus(`Joining room ${roomCode}…`, false);

    const myId     = SG_CONFIG.peerIdReader(roomCode);
    const viewerId = SG_CONFIG.peerIdViewer(roomCode);

    peer = new Peer(myId, SG_CONFIG.PEER_CONFIG);

    peer.on('open', (id) => {
      console.log('[reader] peer open:', id);
      updateStatus(`Connected to PeerJS — calling viewer…`, true);

      // ── Call the viewer with our video stream ─────────────────────────
      mediaConn = peer.call(viewerId, localStream);

      mediaConn.on('stream', () => {
        console.log('[reader] media stream acknowledged');
      });

      mediaConn.on('close', () => {
        console.log('[reader] media call closed');
        updateStatus('Call ended', false);
      });

      mediaConn.on('error', (err) => {
        console.error('[reader] media call error:', err);
      });

      // ── Open a data connection for landmarks ──────────────────────────
      dataConn = peer.connect(viewerId, { reliable: false });

      dataConn.on('open', () => {
        console.log('[reader] data connection open');
        updateStatus('Streaming ✓', true);
      });

      dataConn.on('close', () => {
        console.log('[reader] data connection closed');
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
        updateStatus('Another reader is already connected with this code', false);
      } else {
        updateStatus(`Connection error: ${err.type}`, false);
      }
    });

    peer.on('disconnected', () => {
      console.log('[reader] peer disconnected — reconnecting…');
      updateStatus('Disconnected — reconnecting…', false);
      peer.reconnect();
    });
  }

  // ── 4. Start hand tracker ──────────────────────────────────────────────
  HandTracker.init(videoEl, canvasEl, (data) => {
    if (!data || !data.landmarks) return;

    const now = performance.now();
    if (now - lastLandmarkSend < SG_CONFIG.LANDMARK_INTERVAL) return;
    lastLandmarkSend = now;

    // Compact payload: just the 21 landmarks
    const payload = {
      type: 'landmarks',
      lm: data.landmarks.map((p) => ({
        x: +p.x.toFixed(4),
        y: +p.y.toFixed(4),
        z: +p.z.toFixed(4),
      })),
    };

    // Send over PeerJS DataConnection
    if (dataConn && dataConn.open) {
      dataConn.send(payload);
    }
  });

  // ── Helpers ─────────────────────────────────────────────────────────────
  function updateStatus(text, ok) {
    statusEl.innerHTML = `<span class="dot"></span>${text}`;
    statusEl.className = ok ? 'connected' : '';
  }
})();
