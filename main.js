// main.js
const { app, BrowserWindow, ipcMain } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"), // ✅ Load preload script
    },
  });

  win.loadFile("index.html");
  win.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
  createWindow();

  // Configure auto-updater
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // IPC: Send version to renderer
  ipcMain.handle("get-app-version", () => app.getVersion());

  // IPC: Trigger update check
  ipcMain.on("check-for-updates", () => {
    autoUpdater.checkForUpdatesAndNotify();
  });

  // IPC: Restart app after update
  ipcMain.on("restart-app", () => {
    autoUpdater.quitAndInstall();
  });

  // Forward auto-updater events to renderer
  autoUpdater.on("update-available", () => {
    BrowserWindow.getAllWindows()[0]?.webContents.send("update-available");
  });

  autoUpdater.on("update-downloaded", () => {
    BrowserWindow.getAllWindows()[0]?.webContents.send("update-downloaded");
  });

  autoUpdater.on("error", (err) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send(
      "update-error",
      err.message,
    );
  });

  // Initial check (optional)
  autoUpdater.checkForUpdatesAndNotify();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
