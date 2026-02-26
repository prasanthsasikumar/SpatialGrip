/**
 * handTracker.js — Pluggable hand-tracking wrapper
 *
 * Currently uses MediaPipe Hands.  To swap models, implement the same
 * interface (`init`, `onResults` callback) and replace the body of this file.
 *
 * Public API (attached to window.HandTracker):
 *   HandTracker.init(videoEl, canvasEl, onLandmarks)
 *     → Starts the camera, feeds frames to MediaPipe, calls onLandmarks(data)
 *       where data = { landmarks, handedness, worldLandmarks }
 */

// eslint-disable-next-line no-unused-vars
const HandTracker = (() => {
  let _hands = null;
  let _camera = null;
  let _drawCtx = null;
  let _canvasEl = null;

  /**
   * Initialise the tracker.
   * @param {HTMLVideoElement}  videoEl      — camera <video>
   * @param {HTMLCanvasElement} canvasEl     — overlay canvas for debug drawing
   * @param {Function}          onLandmarks — callback(landmarkPayload)
   */
  async function init(videoEl, canvasEl, onLandmarks) {
    _canvasEl = canvasEl;
    _drawCtx = canvasEl.getContext('2d');

    // ── MediaPipe Hands setup ───────────────────────────────────────────
    _hands = new Hands({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`,
    });

    _hands.setOptions({
      maxNumHands: SG_CONFIG.HAND_TRACKING.maxNumHands,
      modelComplexity: SG_CONFIG.HAND_TRACKING.modelComplexity,
      minDetectionConfidence: SG_CONFIG.HAND_TRACKING.minDetectionConfidence,
      minTrackingConfidence: SG_CONFIG.HAND_TRACKING.minTrackingConfidence,
    });

    _hands.onResults((results) => {
      _drawDebug(results);
      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        onLandmarks({
          landmarks: results.multiHandLandmarks[0],          // 21 normalised points
          worldLandmarks: results.multiHandWorldLandmarks
            ? results.multiHandWorldLandmarks[0]
            : null,
          handedness: results.multiHandedness
            ? results.multiHandedness[0]
            : null,
        });
      }
    });

    // ── Camera helper (handles requestAnimationFrame loop) ──────────────
    _camera = new Camera(videoEl, {
      onFrame: async () => {
        await _hands.send({ image: videoEl });
      },
      width: SG_CONFIG.CAMERA_CONSTRAINTS.video.width.ideal,
      height: SG_CONFIG.CAMERA_CONSTRAINTS.video.height.ideal,
      facingMode: 'environment',
    });
    await _camera.start();
  }

  /**
   * Draw landmarks + connectors on the overlay canvas (debug aid).
   */
  function _drawDebug(results) {
    if (!_drawCtx || !_canvasEl) return;
    const w = _canvasEl.clientWidth;
    const h = _canvasEl.clientHeight;
    _canvasEl.width = w;
    _canvasEl.height = h;
    _drawCtx.clearRect(0, 0, w, h);

    if (results.multiHandLandmarks) {
      for (const landmarks of results.multiHandLandmarks) {
        drawConnectors(_drawCtx, landmarks, HAND_CONNECTIONS, {
          color: 'rgba(0,255,200,0.4)',
          lineWidth: 2,
        });
        drawLandmarks(_drawCtx, landmarks, {
          color: 'rgba(0,255,200,0.8)',
          lineWidth: 1,
          radius: 3,
        });
      }
    }
  }

  // ── Depth estimation placeholder ────────────────────────────────────────
  // When SG_CONFIG.DEPTH_ENABLED is true, you could run an additional model
  // (e.g. MiDaS via TF.js) on each frame and include z-depth in the payload.
  // function estimateDepth(frame) { /* TODO */ }

  return { init };
})();
