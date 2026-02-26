/**
 * gestureInterpreter.js — Converts raw hand landmarks into gesture commands
 *
 * Modular design: swap this file (or extend it) to recognise new gestures
 * without touching the rest of the pipeline.
 *
 * Public API (window.GestureInterpreter):
 *   GestureInterpreter.interpret(landmarks)
 *     → { position: {x,y}, rotation: {x,y,z}, scale: number, pinching: bool }
 *
 *   GestureInterpreter.registerGesture(name, fn)
 *     → Extensibility hook: add custom gesture recognisers
 */

// eslint-disable-next-line no-unused-vars
const GestureInterpreter = (() => {
  const G = () => SG_CONFIG.GESTURE;   // live reference so config can be hot-reloaded

  // Smoothed state (exponential moving average)
  let _smoothPos = { x: 0, y: 0 };
  let _smoothRot = { x: 0, y: 0, z: 0 };
  let _smoothScale = 1.0;
  let _initialised = false;

  // Custom gesture registry
  const _customGestures = {};

  // ── MediaPipe landmark indices ──────────────────────────────────────────
  const WRIST        = 0;
  const THUMB_TIP    = 4;
  const INDEX_TIP    = 8;
  const MIDDLE_TIP   = 12;
  const INDEX_MCP    = 5;
  const PINKY_MCP    = 17;

  /**
   * Euclidean distance between two landmark objects {x, y, z?}
   */
  function dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = (a.z || 0) - (b.z || 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * Exponential smoothing helper.
   */
  function smooth(prev, curr, alpha) {
    return prev + alpha * (curr - prev);
  }

  /**
   * Main interpretation entry point.
   * @param {Array} lm — array of 21 normalised landmarks [{x,y,z}, …]
   * @returns {Object}  gesture command
   */
  function interpret(lm) {
    if (!lm || lm.length < 21) return null;

    const cfg = G();

    // ── Position (wrist xy, normalised 0-1 → centred -1…1) ─────────────
    const rawX = -(lm[WRIST].x - 0.5) * 2 * cfg.MOVE_SCALE;   // mirror X
    const rawY = -(lm[WRIST].y - 0.5) * 2 * cfg.MOVE_SCALE;

    // ── Rotation (palm orientation estimate) ────────────────────────────
    // Simple heuristic: angle between INDEX_MCP → PINKY_MCP line
    const palmDx = lm[PINKY_MCP].x - lm[INDEX_MCP].x;
    const palmDy = lm[PINKY_MCP].y - lm[INDEX_MCP].y;
    const rawRotZ = Math.atan2(palmDy, palmDx);                 // roll
    const rawRotX = (lm[MIDDLE_TIP].y - lm[WRIST].y) * cfg.ROTATE_SCALE;  // pitch
    const rawRotY = (lm[MIDDLE_TIP].x - lm[WRIST].x) * cfg.ROTATE_SCALE;  // yaw

    // ── Scale (pinch distance between thumb and index) ──────────────────
    const pinchDist = dist(lm[THUMB_TIP], lm[INDEX_TIP]);
    const pinching = pinchDist < cfg.PINCH_THRESHOLD;
    // Map [0 … 0.3] → [SCALE_MIN … SCALE_MAX]
    const rawScale = mapRange(pinchDist, 0.02, 0.25, cfg.SCALE_MIN, cfg.SCALE_MAX);

    // ── Smooth everything ───────────────────────────────────────────────
    const a = cfg.SMOOTHING;
    if (!_initialised) {
      _smoothPos   = { x: rawX, y: rawY };
      _smoothRot   = { x: rawRotX, y: rawRotY, z: rawRotZ };
      _smoothScale = rawScale;
      _initialised = true;
    } else {
      _smoothPos.x   = smooth(_smoothPos.x,   rawX,    a);
      _smoothPos.y   = smooth(_smoothPos.y,   rawY,    a);
      _smoothRot.x   = smooth(_smoothRot.x,   rawRotX, a);
      _smoothRot.y   = smooth(_smoothRot.y,   rawRotY, a);
      _smoothRot.z   = smooth(_smoothRot.z,   rawRotZ, a);
      _smoothScale    = smooth(_smoothScale,   rawScale, a);
    }

    const result = {
      position: { x: _smoothPos.x, y: _smoothPos.y },
      rotation: { x: _smoothRot.x, y: _smoothRot.y, z: _smoothRot.z },
      scale: clamp(_smoothScale, cfg.SCALE_MIN, cfg.SCALE_MAX),
      pinching,
      pinchDistance: pinchDist,
    };

    // Run any registered custom gesture recognisers
    for (const [name, fn] of Object.entries(_customGestures)) {
      result[name] = fn(lm, result);
    }

    return result;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function mapRange(v, inMin, inMax, outMin, outMax) {
    const t = clamp((v - inMin) / (inMax - inMin), 0, 1);
    return outMin + t * (outMax - outMin);
  }

  /**
   * Register a custom gesture. `fn(landmarks, currentResult) → value`
   * The value will be added to the result object under `name`.
   */
  function registerGesture(name, fn) {
    _customGestures[name] = fn;
  }

  return { interpret, registerGesture };
})();
