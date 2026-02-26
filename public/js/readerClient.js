/**
 * readerClient.js — /read page logic
 *
 * 1. Opens a WebSocket to the signaling server (role=reader).
 * 2. Starts the camera and hand tracker.
 * 3. Creates a WebRTC peer connection and sends the video stream.
 * 4. Sends hand-landmark data over a DataChannel (primary)
 *    and also over the WebSocket (fallback).
 */

(async () => {
  // DOM refs
  const videoEl  = document.getElementById('video');
  const canvasEl = document.getElementById('overlay');
  const statusEl = document.getElementById('status');

  // ── State ───────────────────────────────────────────────────────────────
  let ws = null;
  let pc = null;                    // RTCPeerConnection
  let dataChannel = null;           // RTCDataChannel for landmarks
  let lastLandmarkSend = 0;

  // ── 1. WebSocket to signaling server ────────────────────────────────────
  function connectWS() {
    ws = new WebSocket(SG_CONFIG.WS_URL_READER);

    ws.onopen = () => {
      console.log('[reader] ws connected');
      updateStatus('Connected — waiting for viewer', true);
    };

    ws.onmessage = async (evt) => {
      const msg = JSON.parse(evt.data);

      // The viewer sent us an answer to our offer
      if (msg.type === 'answer') {
        console.log('[reader] received answer');
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      }

      // ICE candidate from viewer
      if (msg.type === 'ice-candidate' && msg.candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
        } catch (e) {
          console.warn('[reader] ice error', e);
        }
      }
    };

    ws.onclose = () => {
      console.log('[reader] ws closed — reconnecting in 2 s');
      updateStatus('Disconnected — retrying…', false);
      setTimeout(connectWS, 2000);
    };
  }

  // ── 2. Get camera stream ────────────────────────────────────────────────
  let localStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia(
      SG_CONFIG.CAMERA_CONSTRAINTS,
    );
    videoEl.srcObject = localStream;
  } catch (err) {
    console.error('[reader] camera error:', err);
    updateStatus('Camera access denied', false);
    return;
  }

  // ── 3. Create WebRTC peer connection ────────────────────────────────────
  function createPeer() {
    pc = new RTCPeerConnection(SG_CONFIG.RTC_CONFIG);

    // Add video tracks to the connection
    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
    }

    // DataChannel for landmark data (low-latency, ordered)
    dataChannel = pc.createDataChannel('landmarks', {
      ordered: true,
      maxRetransmits: 0,
    });
    dataChannel.onopen = () => console.log('[reader] dataChannel open');
    dataChannel.onclose = () => console.log('[reader] dataChannel closed');

    // ICE candidates → relay through signaling
    pc.onicecandidate = (evt) => {
      if (evt.candidate && ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'ice-candidate',
          candidate: evt.candidate,
        }));
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[reader] ice state:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        updateStatus('Streaming', true);
      }
    };
  }

  async function startCall() {
    createPeer();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ws.send(JSON.stringify({ type: 'offer', sdp: pc.localDescription }));
    console.log('[reader] offer sent');
  }

  // ── 4. Start hand tracker ──────────────────────────────────────────────
  HandTracker.init(videoEl, canvasEl, (data) => {
    if (!data || !data.landmarks) return;

    const now = performance.now();
    if (now - lastLandmarkSend < SG_CONFIG.LANDMARK_INTERVAL) return;
    lastLandmarkSend = now;

    // Compact payload: just the 21 landmarks
    const payload = JSON.stringify({
      type: 'landmarks',
      lm: data.landmarks.map((p) => ({
        x: +p.x.toFixed(4),
        y: +p.y.toFixed(4),
        z: +p.z.toFixed(4),
      })),
    });

    // Primary: DataChannel (lowest latency)
    if (dataChannel && dataChannel.readyState === 'open') {
      dataChannel.send(payload);
    }
    // Fallback: WebSocket relay
    else if (ws && ws.readyState === 1) {
      ws.send(payload);
    }
  });

  // ── 5. Connect signaling & wait for viewer ─────────────────────────────
  connectWS();

  // When the server tells us the viewer is ready, initiate the call
  // (handled inside ws.onmessage for 'reader-ready' in the flow below)
  const _origOnMsg = null;
  const _patchViewerReady = () => {
    const origHandler = ws.onmessage;
    ws.onmessage = async (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.type === 'reader-ready') {
        // This message means the viewer is also connected — start the call
        await startCall();
        return;
      }
      origHandler(evt);
    };
  };

  // Patch after ws connects
  const origOnOpen = null;
  const _waitForWS = setInterval(() => {
    if (ws && ws.readyState === 1) {
      clearInterval(_waitForWS);
      _patchViewerReady();
      // If viewer is already connected, the server sent reader-ready on connect
    }
  }, 200);

  // ── Helpers ─────────────────────────────────────────────────────────────
  function updateStatus(text, ok) {
    statusEl.innerHTML = `<span class="dot"></span>${text}`;
    statusEl.className = ok ? 'connected' : '';
  }
})();
