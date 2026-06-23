const { app, BrowserWindow, Menu, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

let mainWindow;
let pythonProcess;
const isDev = process.argv.includes("--dev");

function killPort8000() {
  if (process.platform !== "win32") return;
  try {
    const { execSync } = require("child_process");
    const out = execSync("netstat -ano | findstr :8000 | findstr LISTENING", { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] });
    const pids = new Set();
    for (const line of out.trim().split("\n")) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid)) pids.add(pid);
    }
    for (const pid of pids) {
      try { execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" }); } catch { /* ignore */ }
    }
  } catch { /* port free */ }
}

function startBackend() {
  const backendPath = path.join(__dirname, "..", "backend");
  const pythonCmd = process.platform === "win32" ? "python" : "python3";

  killPort8000();

  pythonProcess = spawn(
    pythonCmd,
    ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000"],
    { cwd: backendPath, shell: true }
  );
  pythonProcess.stdout.on("data", (d) => console.log(`[Backend] ${d}`));
  pythonProcess.stderr.on("data", (d) => console.error(`[Backend] ${d}`));
  pythonProcess.on("error", (err) => console.error("[Backend] failed to start:", err.message));
  pythonProcess.on("exit", (code) => {
    if (code !== null && code !== 0) console.error(`[Backend] exited with code ${code}`);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 720,
    title: "Entracte POS",
    backgroundColor: "#F7F7F7",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
    autoHideMenuBar: true,
  });
  Menu.setApplicationMenu(null);
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());
  if (isDev) mainWindow.webContents.openDevTools();
}

ipcMain.handle("get-printers", async () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return [];
  const list = await win.webContents.getPrintersAsync();

  function detectPageSize(p) {
    const name = `${p.displayName || ""} ${p.name || ""} ${p.description || ""}`.toLowerCase();
    const opts = p.options || {};
    const paper = String(opts.paperSize || opts.PaperSize || opts.paper || "").toLowerCase();
    const thermal = /receipt|thermal|pos|tm-t|tm t|star tsp|bixolon|80mm|58mm|roll|escpos/i;
    if (thermal.test(name) || thermal.test(paper)) return "receipt";
    if (/letter|8\.5/.test(name) || paper === "1" || paper.includes("letter")) return "letter";
    if (/a4/.test(name) || paper === "9" || paper.includes("a4")) return "a4";
    return p.isDefault ? "a4" : "receipt";
  }

  return list.map((p) => ({
    name: p.name,
    displayName: p.displayName || p.name,
    isDefault: p.isDefault,
    pageSize: detectPageSize(p),
    description: p.description || "",
  }));
});

ipcMain.handle("save-file", async (event, { content, defaultName, filters }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: defaultName,
    filters: filters || [
      { name: "Word Document", extensions: ["doc"] },
      { name: "HTML", extensions: ["html"] },
    ],
  });
  if (canceled || !filePath) return { ok: false };
  fs.writeFileSync(filePath, content, "utf8");
  return { ok: true, path: filePath };
});

ipcMain.handle("get-asset-data-url", async (_event, filename) => {
  const safe = path.basename(filename || "");
  const filePath = path.join(__dirname, "renderer", safe);
  if (!fs.existsSync(filePath)) return null;
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(safe).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "application/octet-stream";
  return `data:${mime};base64,${buf.toString("base64")}`;
});

ipcMain.handle("save-pdf", async (event, { html, fullHtml, defaultName }) => {
  const parent = BrowserWindow.fromWebContents(event.sender);
  const pdfWin = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  const doc = fullHtml || `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
  await pdfWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(doc)}`);
  await new Promise((r) => setTimeout(r, 800));
  const pdf = await pdfWin.webContents.printToPDF({ printBackground: true, marginsType: 1 });
  pdfWin.destroy();
  const { canceled, filePath } = await dialog.showSaveDialog(parent, {
    defaultPath: defaultName || "quotation.pdf",
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (canceled || !filePath) return { ok: false };
  fs.writeFileSync(filePath, pdf);
  return { ok: true, path: filePath };
});

app.whenReady().then(() => {
  startBackend();
  setTimeout(createWindow, 2500);
});

app.on("window-all-closed", () => {
  if (pythonProcess) pythonProcess.kill();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
