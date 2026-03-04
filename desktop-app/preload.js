/**
 * preload.js — Bridge between main process and renderer
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spatialgrip', {
  start: (config) => ipcRenderer.invoke('start', config),
  stop: () => ipcRenderer.invoke('stop'),
  getStatus: () => ipcRenderer.invoke('get-status'),
  updateSwapHands: (swapHands) => ipcRenderer.invoke('update-swap-hands', swapHands),
  onStatusUpdate: (callback) => ipcRenderer.on('status-update', (_event, data) => callback(data))
});
