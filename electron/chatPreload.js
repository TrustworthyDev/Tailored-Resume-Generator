// Preload for the embedded ChatGPT browser window. Exposes a tiny bridge so an
// injected in-page button can save the current page as the Project Home.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("careerva", {
  saveHome: () => ipcRenderer.invoke("chatgpt:saveHomeFromBrowser"),
});
