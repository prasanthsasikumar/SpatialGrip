/**
 * config.js — Shared constants for SpatialGrip
 *
 * Both /read and /show import this file so connection parameters stay in sync.
 */

// eslint-disable-next-line no-unused-vars
const SG_CONFIG = (() => {
  // Derive WebSocket URL from current page location (works over LAN too)
  const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const wsBase = `${wsProtocol}://${location.host}`;

  return Object.freeze({
    // ── WebSocket ───────────────────────────────────────────────────────
    WS_URL_READER: `${wsBase}?role=reader`,
    WS_URL_VIEWER: `${wsBase}?role=viewer`,

    // ── WebRTC ──────────────────────────────────────────────────────────
    RTC_CONFIG: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    },

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
