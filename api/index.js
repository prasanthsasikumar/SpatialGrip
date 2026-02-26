/**
 * api/index.js — Vercel serverless function entry point
 *
 * Serves the Express routes in a serverless context.
 *
 * NOTE: Vercel serverless functions do NOT support WebSocket connections.
 * The signaling server (WebSocket relay in server.js) will not work here.
 * Static pages and HTTP routes work fine.
 *
 * For full functionality (WebRTC signaling), deploy the complete app to
 * a platform that supports WebSockets (Railway, Render, Fly.io) or
 * pair this Vercel deployment with an external signaling service.
 */

const express = require('express');
const path = require('path');

const app = express();

// Serve static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Route helpers
app.get('/read', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'read.html'));
});

app.get('/show', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'show.html'));
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', platform: 'vercel', websockets: false });
});

module.exports = app;
