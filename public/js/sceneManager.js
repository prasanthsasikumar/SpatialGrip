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

    // ── Default object: rounded-edge cube ─────────────────────────────────
    const geo = new THREE.BoxGeometry(1.2, 1.2, 1.2, 4, 4, 4);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x00ccff,
      metalness: 0.3,
      roughness: 0.4,
      wireframe: false,
    });
    _object = new THREE.Mesh(geo, mat);
    _scene.add(_object);

    // ── Subtle grid helper (visual anchor) ────────────────────────────────
    const grid = new THREE.GridHelper(20, 40, 0x222222, 0x111111);
    grid.position.y = -2;
    _scene.add(grid);

    // ── Handle resize ─────────────────────────────────────────────────────
    window.addEventListener('resize', _onResize);

    // ── Render loop ───────────────────────────────────────────────────────
    _animate();
  }

  /**
   * Apply gesture data to the 3D object.
   * @param {Object} g — output of GestureInterpreter.interpret()
   */
  function applyGesture(g) {
    if (!g || !_object) return;

    // Position
    _object.position.x = g.position.x;
    _object.position.y = g.position.y;

    // Rotation
    _object.rotation.x = g.rotation.x;
    _object.rotation.y = g.rotation.y;
    _object.rotation.z = g.rotation.z;

    // Scale (uniform)
    const s = g.scale;
    _object.scale.set(s, s, s);

    // Visual feedback: glow on pinch
    if (_object.material) {
      _object.material.emissive = g.pinching
        ? new THREE.Color(0xff4400)
        : new THREE.Color(0x000000);
      _object.material.emissiveIntensity = g.pinching ? 0.6 : 0;
    }
  }

  /**
   * Replace the interactive object with a custom mesh.
   */
  function setObject(mesh) {
    if (_object) _scene.remove(_object);
    _object = mesh;
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
    }

    _renderer.render(_scene, _camera);
  }

  function _onResize() {
    _camera.aspect = window.innerWidth / window.innerHeight;
    _camera.updateProjectionMatrix();
    _renderer.setSize(window.innerWidth, window.innerHeight);
  }

  return { init, applyGesture, getObject, setObject };
})();
