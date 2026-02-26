/**
 * viewerClient.js — /show page logic
 *
 * 1. Opens a WebSocket to the signaling server (role=viewer).
 * 2. Waits for a WebRTC offer from /read, answers it, receives the video stream.
 * 3. Listens for hand-landmark data on the DataChannel (or WebSocket fallback).
 * 4. Feeds landmarks through GestureInterpreter → SceneManager each frame.
 */

(() => {
  // DOM refs
  const pipVideo = document.getElementById('pip-video');
  const canvasEl = document.getElementById('three-canvas');
  const statusEl = document.getElementById('status');
  const hudEl    = document.getElementById('hud');

  // ── State ───────────────────────────────────────────────────────────────
  let ws       = null;
  let pc       = null;
  let latestGesture = null;
  let framesReceived = 0;

  // ── 1. Initialise Three.js scene ────────────────────────────────────────
  SceneManager.init(canvasEl);

  // ── 2. WebSocket to signaling server ────────────────────────────────────
  function connectWS() {
    ws = new WebSocket(SG_CONFIG.WS_URL_VIEWER);

    ws.onopen = () => {
      console.log('[viewer] ws connected');
      updateStatus('Waiting for reader…', false);
    };

    ws.onmessage = async (evt) => {
      const msg = JSON.parse(evt.data);

      // Reader has connected and is ready to negotiate
      if (msg.type === 'reader-ready') {
        console.log('[viewer] reader is ready');
        updateStatus('Reader connected — negotiating…', false);
      }

      // ── Signaling: handle offer from reader ───────────────────────────
      if (msg.type === 'offer') {
        console.log('[viewer] received offer');
        await handleOffer(msg.sdp);
      }

      // ICE candidate from reader
      if (msg.type === 'ice-candidate' && msg.candidate) {
        try {
          if (pc) await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
        } catch (e) {
          console.warn('[viewer] ice error', e);
        }
      }

      // ── Landmark data (WebSocket fallback path) ───────────────────────
      if (msg.type === 'landmarks') {
        _processLandmarks(msg.lm);
      }

      // ── Depth placeholder ─────────────────────────────────────────────
      if (msg.type === 'depth') {
        // Future: feed depth info into SceneManager for z-positioning
        console.log('[viewer] depth data received (placeholder)');
      }
    };

    ws.onclose = () => {
      console.log('[viewer] ws closed — reconnecting in 2 s');
      updateStatus('Disconnected — retrying…', false);
      setTimeout(connectWS, 2000);
    };
  }

  // ── 3. Handle WebRTC offer and create answer ───────────────────────────
  async function handleOffer(sdp) {
    pc = new RTCPeerConnection(SG_CONFIG.RTC_CONFIG);

    // When we receive the remote video track, show it in PiP
    pc.ontrack = (evt) => {
      console.log('[viewer] received track:', evt.track.kind);
      if (evt.streams && evt.streams[0]) {
        pipVideo.srcObject = evt.streams[0];
      }
    };

    // DataChannel for landmark data (reader creates it, we listen)
    pc.ondatachannel = (evt) => {
      console.log('[viewer] dataChannel received');
      const dc = evt.channel;
      dc.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'landmarks') {
            _processLandmarks(msg.lm);
          }
        } catch { /* ignore malformed */ }
      };
    };

    // ICE → relay
    pc.onicecandidate = (evt) => {
      if (evt.candidate && ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'ice-candidate',
          candidate: evt.candidate,
        }));
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[viewer] ice state:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        updateStatus('Streaming', true);
      }
    };

    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    ws.send(JSON.stringify({ type: 'answer', sdp: pc.localDescription }));
    console.log('[viewer] answer sent');
  }

  // ── 4. Process incoming landmarks ──────────────────────────────────────
  let _gestureTimeout = null;

  function _processLandmarks(lm) {
    framesReceived++;
    const gesture = GestureInterpreter.interpret(lm);
    if (!gesture) return;

    latestGesture = gesture;
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

  // ── Go ─────────────────────────────────────────────────────────────────
  connectWS();
})();
