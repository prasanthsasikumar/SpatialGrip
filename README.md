# SpatialGrip

**Stream your phone's camera to a laptop browser and manipulate 3D objects with hand gestures — in real time.**

Part of the SpatialGrip project by FlowsXR. Live at **[spatialgrip.flowsxr.com](https://spatialgrip.flowsxr.com)**.

---

## How It Works

| Phone (`/read`) | Laptop (`/show`) |
|---|---|
| Opens rear camera | Renders 3D scene (Three.js) |
| Runs MediaPipe hand tracking locally | Receives landmark data via Socket.IO |
| Sends landmarks to server relay | Maps gestures → move / rotate / scale |

### Gesture Mapping

| Gesture | Effect |
|---|---|
| **Wrist position** | Move object (x, y) |
| **Palm tilt** | Rotate object |
| **Pinch distance** (thumb ↔ index) | Scale object |
| **Pinch detected** | Object glows orange |

---

## Quick Start (Local)

```bash
npm install
node server.js
```

The console prints your LAN IP. Open:

- **`http://<LAN_IP>:3000/read`** on your phone
- **`http://localhost:3000/show`** on your laptop

Both devices must be on the same Wi-Fi network.

> **iOS Safari** requires HTTPS for camera access over the network.  
> Use [ngrok](https://ngrok.com/) or a self-signed cert for local iOS testing.

---

## Project Structure

```
SpatialGrip/
├── server.js                     # Express + Socket.IO relay server
├── package.json
├── render.yaml                   # Render deployment config
└── public/
    ├── index.html                # Landing page
    ├── read.html                 # Phone / wearable camera page
    ├── show.html                 # Laptop 3D viewer page
    └── js/
        ├── config.js             # Shared constants & tuning
        ├── handTracker.js        # Pluggable MediaPipe wrapper
        ├── gestureInterpreter.js # Landmarks → gesture commands
        ├── sceneManager.js       # Three.js scene management
        ├── readerClient.js       # /read — camera + landmark sender
        └── viewerClient.js       # /show — gesture consumer + 3D viewer
```

---

## Deployment

This app is deployed on **[Render](https://render.com)** — it requires a persistent WebSocket connection (Socket.IO) which serverless platforms like Vercel do not support.

Live URL: **https://spatialgrip.flowsxr.com**

### Deploy Your Own

1. Fork this repo
2. Go to [render.com](https://render.com) → **New** → **Web Service**
3. Connect your GitHub repo — Render auto-detects `render.yaml`
4. Click **Deploy**

The `render.yaml` in this repo handles everything:

```yaml
services:
  - type: web
    name: spatialgrip
    runtime: node
    buildCommand: npm install
    startCommand: node server.js
```

> **Free tier note:** Render free spins down after 15 min of inactivity. First request after idle takes ~30 seconds to cold-start.

---

## Tech Stack

- **[Express.js](https://expressjs.com/)** — HTTP server & static file serving
- **[Socket.IO](https://socket.io/)** — WebSocket relay between phone and laptop
- **[MediaPipe Hands](https://google.github.io/mediapipe/solutions/hands)** — Real-time hand landmark detection
- **[Three.js](https://threejs.org/)** — 3D rendering engine

---

## Extensibility

### Swap Hand Tracking Model

Replace the body of `public/js/handTracker.js`. Keep the same interface:

```js
HandTracker.init(videoElement, canvasElement, onLandmarksCallback)
```

### Add Custom Gestures

```js
GestureInterpreter.registerGesture('fist', (landmarks, currentResult) => {
  return allFingersCurled(landmarks);
});
```

### Enable Depth Estimation

Set `SG_CONFIG.DEPTH_ENABLED = true` in `config.js` and wire a depth model (e.g. MiDaS via TensorFlow.js) into the `handTracker.js` frame loop.

### Replace 3D Object

```js
const loader = new THREE.GLTFLoader();
loader.load('model.glb', (gltf) => {
  SceneManager.setObject(gltf.scene);
});
```

---

## Configuration

All tunable parameters live in `public/js/config.js`:

| Parameter | Default | Description |
|---|---|---|
| `PINCH_THRESHOLD` | 0.06 | Normalised distance to detect pinch |
| `SMOOTHING` | 0.35 | EMA factor (0 = no smoothing, 1 = instant) |
| `MOVE_SCALE` | 4.0 | World-units per normalised hand movement |
| `ROTATE_SCALE` | π | Radians per unit palm tilt |
| `LANDMARK_INTERVAL` | 33ms | Throttle rate for sending landmarks (~30fps) |

---

## License

MIT
