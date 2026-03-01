/**
 * gestureInterpreter.js — Converts raw hand landmarks into gesture commands
 *
 * Interaction model (pinch-to-manipulate):
 *   • Pinch (thumb + index close) = grab / activate manipulation
 *   • While pinching, drag LEFT / RIGHT  → rotate object around Y axis
 *   • While pinching, drag UP / DOWN      → scale object up / down
 *   • Release pinch                       → stop manipulating, keep current state
 *
 * Public API (window.GestureInterpreter):
 *   GestureInterpreter.interpret(landmarks)
 *     → { rotationDelta, scaleDelta, pinching, mode, pinchDistance }
 *
 *   GestureInterpreter.registerGesture(name, fn)
 *   GestureInterpreter.reset()
 */

// eslint-disable-next-line no-unused-vars
const GestureInterpreter = (() => {
  const G = () => SG_CONFIG.GESTURE;   // live reference so config can be hot-reloaded

  // ── MediaPipe landmark indices ──────────────────────────────────────────
  const THUMB_TIP = 4;
  const INDEX_TIP = 8;
  const WRIST     = 0;

  // ── Pinch state machine ─────────────────────────────────────────────────
  let _wasPinching = false;
  let _pinchAnchor = null;          // {x, y} at pinch start (normalised)
  let _smoothHand  = null;          // smoothed hand position

  // Custom gesture registry
  const _customGestures = {};

  // ── Helpers ─────────────────────────────────────────────────────────────
  function dist2d(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function smooth(prev, curr, alpha) { return prev + alpha * (curr - prev); }

  /**
   * Main interpretation entry point.
   * @param {Array} lm — array of 21 normalised landmarks [{x,y,z}, …]
   * @returns {Object}  gesture command
   */
  function interpret(lm) {
    if (!lm || lm.length < 21) return null;

    const cfg = G();
    const alpha = cfg.SMOOTHING;

    // Pinch detection (thumb ↔ index distance)
    const pinchDist = dist2d(lm[THUMB_TIP], lm[INDEX_TIP]);
    const pinching = pinchDist < cfg.PINCH_THRESHOLD;

    // Use the midpoint of thumb-tip and index-tip as the "grab point"
    const grabX = (lm[THUMB_TIP].x + lm[INDEX_TIP].x) / 2;
    const grabY = (lm[THUMB_TIP].y + lm[INDEX_TIP].y) / 2;

    // Smooth the hand position to reduce jitter
    if (!_smoothHand) {
      _smoothHand = { x: grabX, y: grabY };
    } else {
      _smoothHand.x = smooth(_smoothHand.x, grabX, alpha);
      _smoothHand.y = smooth(_smoothHand.y, grabY, alpha);
    }

    let rotationDelta = 0;   // delta rotation this frame (radians)
    let scaleDelta = 0;      // delta scale this frame
    let mode = 'idle';       // 'idle' | 'grabbing'

    if (pinching) {
      if (!_wasPinching) {
        // ── Just started pinching — record anchor position ──────────────
        _pinchAnchor = { x: _smoothHand.x, y: _smoothHand.y };
        mode = 'grabbing';
      } else if (_pinchAnchor) {
        // ── Ongoing pinch — compute delta from anchor ───────────────────
        mode = 'grabbing';
        const dx = _smoothHand.x - _pinchAnchor.x;   // normalised: -1…1
        const dy = _smoothHand.y - _pinchAnchor.y;

        // Left/right movement → rotation around Y
        rotationDelta = -dx * cfg.ROTATE_SCALE;       // mirror so natural

        // Up/down movement → scale change
        scaleDelta = -dy * cfg.MOVE_SCALE;             // up = bigger

        // Update anchor to make it incremental (continuous drag)
        _pinchAnchor.x = _smoothHand.x;
        _pinchAnchor.y = _smoothHand.y;
      }
    } else {
      // Released — reset anchor
      _pinchAnchor = null;
    }

    _wasPinching = pinching;

    const result = {
      rotationDelta,
      scaleDelta,
      pinching,
      mode,
      pinchDistance: pinchDist,
      handPosition: { x: _smoothHand.x, y: _smoothHand.y },
    };

    // Run any registered custom gesture recognisers
    for (const [name, fn] of Object.entries(_customGestures)) {
      result[name] = fn(lm, result);
    }

    return result;
  }

  /**
   * Reset internal state (e.g. on disconnect).
   */
  function reset() {
    _wasPinching = false;
    _pinchAnchor = null;
    _smoothHand  = null;
  }

  /**
   * Register a custom gesture. `fn(landmarks, currentResult) → value`
   */
  function registerGesture(name, fn) {
    _customGestures[name] = fn;
  }

  return { interpret, registerGesture, reset };
})();
