// preload.js
const { contextBridge, ipcRenderer } = require("electron");

// Expose safe APIs to renderer
contextBridge.exposeInMainWorld("electronAPI", {
  // Auto-update events
  onUpdateAvailable: (callback) => ipcRenderer.on("update-available", callback),
  onUpdateDownloaded: (callback) =>
    ipcRenderer.on("update-downloaded", callback),
  onUpdateError: (callback) => ipcRenderer.on("update-error", callback),

  // Auto-update actions
  restartApp: () => ipcRenderer.send("restart-app"),
  checkForUpdates: () => ipcRenderer.send("check-for-updates"),

  // App metadata
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
});
