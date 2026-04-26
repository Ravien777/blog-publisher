const { app, BrowserWindow } = require("electron");

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.loadFile("index.html");
  win.setMenuBarVisibility(false); // Menu bar visibility
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  app.quit();
});
