// main.js
const { app, BrowserWindow, ipcMain } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"), // ✅ REQUIRED
    },
  });

  win.loadFile("index.html");
  win.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
  createWindow();

  // 🔧 Enable debug logging (remove in production)
  autoUpdater.logger = require("electron-log");
  autoUpdater.logger.transports.file.level = "debug";

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // IPC: Renderer triggers check
  ipcMain.on("check-for-updates", () => {
    autoUpdater.checkForUpdatesAndNotify();
  });

  // IPC: Restart after download
  ipcMain.on("restart-app", () => {
    autoUpdater.quitAndInstall();
  });

  // Forward updater events to renderer
  autoUpdater.on("update-available", () => {
    BrowserWindow.getAllWindows()[0]?.webContents.send("update-available");
  });

  autoUpdater.on("update-downloaded", () => {
    BrowserWindow.getAllWindows()[0]?.webContents.send("update-downloaded");
  });

  autoUpdater.on("error", (err) => {
    const safeMsg = err?.message || err?.toString() || "Unknown update error";
    BrowserWindow.getAllWindows()[0]?.webContents.send("update-error", safeMsg);
  });

  // ✅ Initial check on app launch
  autoUpdater.checkForUpdatesAndNotify();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
