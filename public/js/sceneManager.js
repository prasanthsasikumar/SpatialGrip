/**
 * sceneManager.js — Three.js scene for /show
 *
 * Sets up the renderer, camera, lighting and a default cube.
 * Exposes methods so viewerClient.js can feed gesture commands in each frame.
 *
 * Public API (window.SceneManager):
 *   SceneManager.init(canvasEl)
 *   SceneManager.applyGesture(gesture)   — from GestureInterpreter
 *   SceneManager.getObject()             — ref to the interactive mesh
 *   SceneManager.setObject(mesh)         — swap the 3D object
 */

// eslint-disable-next-line no-unused-vars
const SceneManager = (() => {
  let _renderer, _scene, _camera, _object;
  let _ambientLight, _pointLight;
  let _rafId;

  // Hand landmark visualisation
  const _handSpheres = [];           // 21 small spheres for each landmark
  const _handLines = [];             // line segments for hand connections
  let _handGroup = null;             // group containing all hand visuals
  let _handVisible = false;
  let _handTimeout = null;

  // MediaPipe hand connections (pairs of landmark indices)
  const HAND_CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,4],         // thumb
    [0,5],[5,6],[6,7],[7,8],         // index
    [5,9],[9,10],[10,11],[11,12],    // middle
    [9,13],[13,14],[14,15],[15,16],  // ring
    [13,17],[17,18],[18,19],[19,20], // pinky
    [0,17],                          // palm base
  ];

  /**
   * Bootstrap the Three.js scene.
   * @param {HTMLCanvasElement} canvasEl
   */
  function init(canvasEl) {
    // ── Renderer ──────────────────────────────────────────────────────────
    _renderer = new THREE.WebGLRenderer({
      canvas: canvasEl,
      antialias: true,
      alpha: true,
    });
    _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    _renderer.setSize(window.innerWidth, window.innerHeight);
    _renderer.setClearColor(0x000000, 1);

    // ── Scene ─────────────────────────────────────────────────────────────
    _scene = new THREE.Scene();

    // ── Camera ────────────────────────────────────────────────────────────
    _camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.1,
      100,
    );
    _camera.position.set(0, 0, 6);

    // ── Lights ────────────────────────────────────────────────────────────
    _ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    _scene.add(_ambientLight);

    _pointLight = new THREE.PointLight(0xffffff, 1.0, 50);
    _pointLight.position.set(5, 5, 5);
    _scene.add(_pointLight);

    // ── Default object (loaded externally via GLB or fallback cube) ──────
    // The default GLB model is loaded from show.html's module script.
    // A simple placeholder is created here so _object is never null.
    const geo = new THREE.BoxGeometry(1.2, 1.2, 1.2, 4, 4, 4);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x00ccff,
      metalness: 0.3,
      roughness: 0.4,
      wireframe: false,
    });
    _object = new THREE.Mesh(geo, mat);
    _object.visible = false;   // hidden until GLB loads (or shown as fallback)
    _scene.add(_object);

    // ── Subtle grid helper (visual anchor) ────────────────────────────────
    const grid = new THREE.GridHelper(20, 40, 0x222222, 0x111111);
    grid.position.y = -2;
    _scene.add(grid);
    // ── Hand landmark spheres + connection lines ──────────────────────────
    _handGroup = new THREE.Group();
    _handGroup.visible = false;
    _scene.add(_handGroup);

    const sphereGeo = new THREE.SphereGeometry(0.04, 8, 8);
    const sphereMat = new THREE.MeshBasicMaterial({ color: 0x00ffcc });
    for (let i = 0; i < 21; i++) {
      const sphere = new THREE.Mesh(sphereGeo, sphereMat.clone());
      _handGroup.add(sphere);
      _handSpheres.push(sphere);
    }

    // Finger-tip spheres get a distinct colour
    const tipIndices = [4, 8, 12, 16, 20];
    tipIndices.forEach(i => {
      _handSpheres[i].material.color.set(0xff4488);
      _handSpheres[i].scale.setScalar(1.4);
    });

    // Connection lines
    const lineMat = new THREE.LineBasicMaterial({ color: 0x00ffcc, opacity: 0.6, transparent: true });
    for (const [a, b] of HAND_CONNECTIONS) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(), new THREE.Vector3()
      ]);
      const line = new THREE.Line(geo, lineMat);
      line.userData = { a, b };
      _handGroup.add(line);
      _handLines.push(line);
    }
    // ── Handle resize ─────────────────────────────────────────────────────
    window.addEventListener('resize', _onResize);

    // ── Render loop ───────────────────────────────────────────────────────
    _animate();
  }

  // ── Accumulated object transform (persists across pinch gestures) ────
  let _objRotY = 0;
  let _objScale = 1.0;

  /**
   * Apply gesture data to the 3D object.
   * Uses delta-based manipulation: pinch + drag to rotate / scale.
   * @param {Object} g — output of GestureInterpreter.interpret()
   */
  function applyGesture(g) {
    if (!g || !_object) return;

    _object._hasGesture = true;

    if (g.mode === 'grabbing') {
      // Accumulate deltas
      _objRotY  += g.rotationDelta;
      _objScale += g.scaleDelta;
      _objScale  = Math.max(SG_CONFIG.GESTURE.SCALE_MIN, Math.min(SG_CONFIG.GESTURE.SCALE_MAX, _objScale));
    }

    // Apply accumulated transform
    _object.rotation.y = _objRotY;
    const s = _objScale;
    _object.scale.set(s, s, s);

    // Visual feedback: glow on pinch (works for both plain meshes and GLB groups)
    const emissiveColor = g.pinching ? new THREE.Color(0xff4400) : new THREE.Color(0x000000);
    const emissiveIntensity = g.pinching ? 0.6 : 0;
    _object.traverse((child) => {
      if (child.isMesh && child.material) {
        child.material.emissive          = emissiveColor;
        child.material.emissiveIntensity = emissiveIntensity;
      }
    });
  }

  /**
   * Replace the interactive object with a custom mesh.
   * Resets accumulated gesture state so the new object starts neutral.
   */
  function setObject(mesh) {
    if (_object) _scene.remove(_object);
    _object = mesh;
    _object._hasGesture = false;
    _objRotY  = 0;
    _objScale = 1.0;
    _scene.add(_object);
  }

  function getObject() {
    return _object;
  }

  // ── Internals ──────────────────────────────────────────────────────────
  function _animate() {
    _rafId = requestAnimationFrame(_animate);

    // Idle rotation when no gesture data is flowing
    if (_object && !_object._hasGesture) {
      _object.rotation.y += 0.004;
      _object.rotation.x += 0.002;
    } else if (_object && _object._hasGesture) {
      // Keep the accumulated rotation from gestures
      _object.rotation.y = _objRotY;
    }

    _renderer.render(_scene, _camera);
  }

  function _onResize() {
    _camera.aspect = window.innerWidth / window.innerHeight;
    _camera.updateProjectionMatrix();
    _renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /**
   * Update hand landmark positions from received data.
   * @param {Array} landmarks — 21 normalised {x,y,z} points
   */
  function updateHandLandmarks(landmarks) {
    if (!landmarks || landmarks.length < 21 || !_handGroup) return;

    _handGroup.visible = true;
    _handVisible = true;

    // Map normalised [0,1] coords to world space
    const SCALE = 8;   // spread factor
    for (let i = 0; i < 21; i++) {
      const lm = landmarks[i];
      // Rear camera: x increases left→right from the user's POV — no mirror needed
      _handSpheres[i].position.set(
        (lm.x - 0.5) * SCALE,
        -(lm.y - 0.5) * SCALE,
        -(lm.z || 0) * SCALE
      );
    }

    // Update connection lines
    for (const line of _handLines) {
      const posA = _handSpheres[line.userData.a].position;
      const posB = _handSpheres[line.userData.b].position;
      const positions = line.geometry.attributes.position.array;
      positions[0] = posA.x; positions[1] = posA.y; positions[2] = posA.z;
      positions[3] = posB.x; positions[4] = posB.y; positions[5] = posB.z;
      line.geometry.attributes.position.needsUpdate = true;
    }

    // Auto-hide hand after 500ms of no data
    clearTimeout(_handTimeout);
    _handTimeout = setTimeout(() => {
      _handGroup.visible = false;
      _handVisible = false;
    }, 500);
  }

  return { init, applyGesture, getObject, setObject, updateHandLandmarks };
})();

// Expose to ES-module scripts (e.g. GLB uploader in show.html)
window.SceneManager = SceneManager;
