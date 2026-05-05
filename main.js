// main.js
const { app, BrowserWindow, ipcMain } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const log = require("electron-log");

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadFile("index.html");
  mainWindow.setMenuBarVisibility(false);
}

// Configure logging
log.transports.file.level = "info";
autoUpdater.logger = log;

// Configure auto-updater
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowDowngrade = false;

// Disable automatic check on startup - we'll do it manually after window is ready
autoUpdater.autoCheckForUpdate = false;

function initAutoUpdater() {
  // Only run updater in production
  if (!app.isPackaged) {
    log.info("Auto updater disabled in development mode");
    return;
  }

  log.info("Initializing auto-updater...");

  // Set feed URL explicitly (redundant but ensures clarity)
  autoUpdater.setFeedURL({
    provider: "github",
    owner: "Ravien777",
    repo: "blog-publisher",
  });

  // Event listeners
  autoUpdater.on("checking-for-update", () => {
    log.info("Checking for updates...");
    mainWindow?.webContents.send("checking-for-update");
  });

  autoUpdater.on("update-available", (info) => {
    log.info("Update available:", info);
    mainWindow?.webContents.send("update-available", info);
  });

  autoUpdater.on("update-not-available", (info) => {
    log.info("Update not available:", info);
    mainWindow?.webContents.send("update-not-available", info);
  });

  autoUpdater.on("download-progress", (progressObj) => {
    log.info("Download progress:", progressObj);
    mainWindow?.webContents.send("download-progress", progressObj);
  });

  autoUpdater.on("update-downloaded", (info) => {
    log.info("Update downloaded:", info);
    mainWindow?.webContents.send("update-downloaded", info);
  });

  autoUpdater.on("error", (err) => {
    log.error("Update error:", err);
    mainWindow?.webContents.send(
      "update-error",
      err?.message || "Unknown update error",
    );
  });

  // Perform initial check after a short delay to ensure window is ready
  setTimeout(() => {
    log.info("Performing initial update check...");
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      log.error("Initial update check failed:", err);
    });
  }, 2000);
}

app.whenReady().then(() => {
  createWindow();
  initAutoUpdater();

  // IPC: Renderer triggers check
  ipcMain.handle("check-for-updates", async () => {
    try {
      await autoUpdater.checkForUpdatesAndNotify();
      return { success: true };
    } catch (err) {
      log.error("Manual update check failed:", err);
      return { success: false, error: err.message };
    }
  });

  // IPC: Restart after download
  ipcMain.on("restart-app", () => {
    log.info("Restarting app to install update...");
    autoUpdater.quitAndInstall(false, true);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
