// Secure bridge between the renderer (Next.js) and the main process.
// Only the explicit methods below are exposed on window.api.

const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld("api", {
  // License / activation
  licenseStatus: () => invoke("license:status"),
  activateLicense: (key) => invoke("license:activate", key),

  // API keys (multiple)
  listApiKeys: (kind) => invoke("apikeys:list", kind),
  addApiKey: (data) => invoke("apikeys:add", data),
  updateApiKey: (data) => invoke("apikeys:update", data),
  deleteApiKey: (id) => invoke("apikeys:delete", id),
  setActiveApiKey: (id) => invoke("apikeys:setActive", id),
  reorderApiKeys: (ids) => invoke("apikeys:reorder", ids),

  // Accounts (people)
  listAccounts: () => invoke("accounts:list"),
  getAccount: (id) => invoke("accounts:get", id),
  createAccount: (data) => invoke("accounts:create", data),
  saveAccount: (data) => invoke("accounts:save", data),
  deleteAccount: (id) => invoke("accounts:delete", id),
  reorderAccounts: (ids) => invoke("accounts:reorder", ids),

  // Instructions (multiple prompts; one active)
  listInstructions: () => invoke("instructions:list"),
  addInstruction: (data) => invoke("instructions:add", data),
  updateInstruction: (data) => invoke("instructions:update", data),
  deleteInstruction: (id) => invoke("instructions:delete", id),
  setActiveInstruction: (id) => invoke("instructions:setActive", id),
  reorderInstructions: (ids) => invoke("instructions:reorder", ids),

  // Work history (scoped to an account)
  listWorkHistory: (accountId) => invoke("work:list", accountId),
  addWorkHistory: (data) => invoke("work:add", data),
  updateWorkHistory: (data) => invoke("work:update", data),
  deleteWorkHistory: (id) => invoke("work:delete", id),
  replaceWorkHistory: (accountId, rows) =>
    invoke("work:replaceAll", { accountId, rows }),

  // Education (scoped to an account)
  listEducation: (accountId) => invoke("education:list", accountId),
  replaceEducation: (accountId, rows) =>
    invoke("education:replaceAll", { accountId, rows }),

  // Projects (scoped to an account)
  listProjects: (accountId) => invoke("projects:list", accountId),
  replaceProjects: (accountId, rows) =>
    invoke("projects:replaceAll", { accountId, rows }),

  // Preferences (persisted selections)
  getPref: (key) => invoke("prefs:get", key),
  setPref: (key, value) => invoke("prefs:set", { key, value }),

  // Proxies (multiple; one active)
  listProxies: () => invoke("proxy:list"),
  addProxy: (data) => invoke("proxy:add", data),
  deleteProxy: (id) => invoke("proxy:delete", id),
  setActiveProxy: (id) => invoke("proxy:setActive", id),
  disableProxy: () => invoke("proxy:disable"),
  getActiveProxy: () => invoke("proxy:active"),
  checkProxy: (data) => invoke("proxy:check", data),

  // Download location
  getDownloadLocation: () => invoke("location:get"),
  chooseDownloadLocation: () => invoke("location:choose"),
  openDownloadLocation: () => invoke("location:open"),

  // Database backup / restore
  exportDatabase: () => invoke("db:export"),
  importDatabase: () => invoke("db:import"),
  scanDatabase: () => invoke("db:scan"),
  importSelectedDatabase: (payload) => invoke("db:importSelected", payload),

  // Resume
  generateResume: (data) => invoke("resume:generate", data),
  generateCoverLetter: (data) => invoke("coverletter:generate", data),

  // Generate V2 — ChatGPT-in-a-browser via a clipboard handshake.
  chatgptBuildPrompt: (data) => invoke("chatgpt:buildPrompt", data),
  openChatgpt: (opts) => invoke("chatgpt:open", opts),
  chatgptSessionInfo: () => invoke("chatgpt:sessionInfo"),
  chatgptSessionDirect: () => invoke("chatgpt:sessionDirect"),
  clipboardWrite: (text) => invoke("clipboard:write", text),
  saveChatgptHome: (url) => invoke("chatgpt:saveHome", url),
  getChatgptHome: () => invoke("chatgpt:getHome"),
  clearChatgptHome: () => invoke("chatgpt:clearHome"),
  chatgptSignedIn: () => invoke("chatgpt:signedIn"),
  awaitChatgptClipboard: (id, prompt, jobRef) => invoke("chatgpt:awaitClipboard", id, prompt, jobRef),
  cancelChatgptClipboard: () => invoke("chatgpt:cancelClipboard"),
  importResumeFile: () => invoke("resume:importFile"),
  previewResume: (html) => invoke("resume:preview", html),
  exportResumePdf: (data) => invoke("resume:exportPdf", data),
  revealPdf: (filePath) => invoke("pdf:reveal", filePath),
  openPdf: (filePath) => invoke("pdf:open", filePath),
  readPdf: (filePath) => invoke("pdf:read", filePath),

  // Applications & tracking
  addApplication: (data) => invoke("app:add", data),
  listAllApplications: () => invoke("app:listAll"),
  applicationsByAccount: (accountId) => invoke("applications:byAccount", accountId),
  allApplications: () => invoke("applications:all"),
  applicationCounts: () => invoke("applications:counts"),
  searchApplications: (query) => invoke("applications:search", query),
  exportApplications: () => invoke("applications:export"),
  openGptForApplication: (id) => invoke("application:openGpt", id),
  deleteApplication: (id) => invoke("app:delete", id),
  resetApplications: () => invoke("app:resetAll"),
  startSession: () => invoke("session:start"),
  endSession: () => invoke("session:end"),
  getActiveSession: () => invoke("session:active"),
  getTodayCount: () => invoke("app:todayCount"),
  listTodayApplications: () => invoke("app:todayList"),

  // In-app notifications (the main process forwards messages here instead of
  // showing a native OS notification). Returns an unsubscribe function.
  onAppNotify: (cb) => {
    const handler = (_e, body) => cb(body);
    ipcRenderer.on("app:notify", handler);
    return () => ipcRenderer.removeListener("app:notify", handler);
  },

  // Fired when the Project Home is saved from inside the embedded browser.
  onChatgptHomeChanged: (cb) => {
    const handler = (_e, url) => cb(url);
    ipcRenderer.on("chatgpt:homeChanged", handler);
    return () => ipcRenderer.removeListener("chatgpt:homeChanged", handler);
  },
});
