/**
 * config.js — Shared constants for SpatialGrip
 *
 * Works in both local (node server.js) and hosted (Vercel) modes.
 * Signaling uses PeerJS cloud — no WebSocket server required.
 */

// eslint-disable-next-line no-unused-vars
const SG_CONFIG = (() => {
  /**
   * Generate a short alphanumeric room code.
   * Used as a PeerJS ID prefix so reader + viewer find each other.
   */
  function generateRoomCode(len = 6) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous 0/O/1/I
    let code = '';
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    for (let i = 0; i < len; i++) code += chars[arr[i] % chars.length];
    return code;
  }

  /**
   * Read ?room=XXXX from the URL, or return null.
   */
  function getRoomFromURL() {
    return new URLSearchParams(location.search).get('room');
  }

  return Object.freeze({
    // ── Room helpers ────────────────────────────────────────────────────
    generateRoomCode,
    getRoomFromURL,

    // ── PeerJS ──────────────────────────────────────────────────────────
    // Uses the free PeerJS cloud signaling server (0.peerjs.com)
    // No custom WebSocket server needed — works on Vercel, GitHub Pages, etc.
    PEER_CONFIG: {
      debug: 1,   // 0 = none, 1 = errors, 2 = warnings, 3 = all
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      },
    },

    // PeerJS peer ID conventions:
    //   Viewer:  "sg-<ROOM>-viewer"
    //   Reader:  "sg-<ROOM>-reader"
    peerIdViewer: (room) => `sg-${room}-viewer`,
    peerIdReader: (room) => `sg-${room}-reader`,

    // ── Camera constraints (rear camera preferred) ──────────────────────
    CAMERA_CONSTRAINTS: {
      video: {
        facingMode: { ideal: 'environment' },
        width:  { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      },
      audio: false,
    },

    // ── MediaPipe Hands options ─────────────────────────────────────────
    HAND_TRACKING: {
      maxNumHands: 1,
      modelComplexity: 1,       // 0 = lite, 1 = full
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.5,
    },

    // ── Gesture tuning ──────────────────────────────────────────────────
    GESTURE: {
      PINCH_THRESHOLD: 0.06,    // normalised distance thumb↔index
      SMOOTHING: 0.35,          // exponential smoothing factor (0–1)
      MOVE_SCALE: 4.0,          // world-units per normalised hand-move
      ROTATE_SCALE: Math.PI,    // radians per unit tilt
      SCALE_MIN: 0.3,
      SCALE_MAX: 3.0,
    },

    // ── Extensibility: depth estimation placeholder ─────────────────────
    DEPTH_ENABLED: false,       // flip to true when depth model is wired

    // ── Landmark send rate (ms) — throttle to save bandwidth ────────────
    LANDMARK_INTERVAL: 33,      // ~30 fps
  });
})();
