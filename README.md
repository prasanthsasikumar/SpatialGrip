# SpatialGrip

**Stream your phone's camera to a laptop browser and manipulate 3D objects with hand gestures — in real time.**

> Part of the [SpatialLens](https://spatiallens.flowsxr.com) project by FlowsXR.

---

## How It Works

| Phone (`/read`) | Laptop (`/show`) |
|---|---|
| Opens rear camera | Displays live video (PiP) |
| Runs MediaPipe hand tracking | Renders 3D scene (Three.js) |
| Sends video via WebRTC | Maps gestures → move / rotate / scale |
| Sends landmarks via DataChannel | Pinch glow feedback on object |

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
SpatialLens/
├── server.js                     # Express + WebSocket signaling server
├── package.json
├── vercel.json                   # Vercel deployment config
├── api/
│   └── index.js                  # Serverless function entry point
└── public/
    ├── read.html                 # Phone / wearable camera page
    ├── show.html                 # Laptop 3D viewer page
    └── js/
        ├── config.js             # Shared constants & tuning
        ├── handTracker.js        # Pluggable MediaPipe wrapper
        ├── gestureInterpreter.js # Landmarks → gesture commands
        ├── sceneManager.js       # Three.js scene management
        ├── readerClient.js       # /read WebRTC + landmark sender
        └── viewerClient.js       # /show WebRTC + gesture consumer
```

---

## Deployment

### Vercel (static hosting + serverless)

This project is configured for Vercel with `vercel.json` and `api/index.js`.

```bash
npm i -g vercel
vercel --prod
```

**⚠️ Important: WebSocket Limitation**

Vercel's serverless functions **do not support persistent WebSocket connections**. The WebRTC signaling handshake requires WebSockets to exchange offer/answer/ICE messages between devices.

**Options for production:**

| Approach | Pros | Cons |
|---|---|---|
| **Vercel + external signaling** | Free static hosting, scalable | Need a separate signaling server |
| **Railway / Render / Fly.io** | Full WebSocket support, one deploy | Small monthly cost (free tiers available) |
| **Vercel + Ably/Pusher** | Managed signaling, no server | Adds a third-party dependency |

For the simplest path, deploy the full app (Express + WS) to **[Railway](https://railway.app)** or **[Render](https://render.com)** which support WebSockets natively, then point your custom domain there.

If you want Vercel specifically for `spatiallens.flowsxr.com`, the static pages will serve correctly — you just need to point your signaling WebSocket URL to a separate always-on server.

### Custom Domain Setup (Vercel)

1. Add `spatiallens.flowsxr.com` in Vercel Dashboard → Project → Settings → Domains
2. Add a CNAME record in your DNS provider:
   - **Host:** `spatiallens`
   - **Value:** `cname.vercel-dns.com`
3. Wait for DNS propagation and SSL provisioning

---

## Tech Stack

- **[Express.js](https://expressjs.com/)** — HTTP server & static file serving
- **[ws](https://github.com/websockets/ws)** — WebSocket signaling server
- **[WebRTC](https://webrtc.org/)** — Peer-to-peer video streaming
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
  // return true/false or a value
  return allFingersCurled(landmarks);
});
```

### Enable Depth Estimation

Set `SG_CONFIG.DEPTH_ENABLED = true` in `config.js` and wire a depth model (e.g. MiDaS via TensorFlow.js) into the `handTracker.js` frame loop. The `depth` message type is already plumbed through the signaling server.

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
