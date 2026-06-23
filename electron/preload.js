const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getPrinters: () => ipcRenderer.invoke("get-printers"),
  getAssetDataUrl: (filename) => ipcRenderer.invoke("get-asset-data-url", filename),
  saveFile: (opts) => ipcRenderer.invoke("save-file", opts),
  savePdf: (opts) => ipcRenderer.invoke("save-pdf", opts),
});
