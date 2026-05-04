// preload.js
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  onUpdateAvailable: (callback) => ipcRenderer.on("update-available", callback),
  onUpdateDownloaded: (callback) =>
    ipcRenderer.on("update-downloaded", callback),
  onUpdateError: (callback) =>
    ipcRenderer.on("update-error", (_, err) => callback(err)),
  checkForUpdates: () => ipcRenderer.send("check-for-updates"),
  restartApp: () => ipcRenderer.send("restart-app"),
});
