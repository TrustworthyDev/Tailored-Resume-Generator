const { app, BrowserWindow, ipcMain, Notification, dialog, shell, clipboard, session, screen, webContents } = require("electron");
const path = require("path");
const fs = require("fs");
const db = require("./db");
const {
  generateResume, generateCoverLetter, parseResumeFile, setProxy, checkProxy,
  buildPromptJson, parseResumeJson, refineV2Prompt, extractJdTarget, extractJobPost,
  RETIRED_GEMINI_MODELS,
} = require("./ai");
const license = require("./license");
const accountMd = require("./accountMd");
const { sortRoles } = require("./workOrder");
const execFileAsync = require("util").promisify(require("child_process").execFile);

const isDev = !!process.env.ELECTRON_DEV;

// ---- Data profile (what makes several copies of the app able to run at once) --
//
// A profile is one userData folder: the database, the signed-in ChatGPT session,
// the prefs and the logs. Two processes CANNOT share one — a Chromium profile
// directory takes process-wide locks (the second copy loses the ChatGPT login),
// and an app's own database is saved without the lock a shared one uses. (The
// database alone CAN be shared between profiles: see "Shared database" below.)
//
// So each simultaneous copy needs its own: pass --profile=<name> (or set
// RGENERATOR_PROFILE). Builds that are meant to coexist with an install take a
// default name of their own, because otherwise they resolve to the SAME
// %APPDATA%\RGenerator as the installed app: the unpacked exe lives in a
// "win-unpacked" folder, and the portable exe unpacks into a temp folder, where
// electron-builder hands it PORTABLE_EXECUTABLE_DIR.
//
// MUST run before any userData path is read (crash logging, DB init), i.e. here
// at module load.
const PROFILE_ROOT = "RGenerator Profiles";

// --profile=Two, --profile:Two, --profile Two, or RGENERATOR_PROFILE=Two.
function readProfileArg() {
  const args = process.argv.slice(1).map((a) => String(a));
  for (const a of args) {
    const m = /^--profile[=:](.+)$/i.exec(a);
    if (m) return m[1];
  }
  const flag = args.findIndex((a) => /^--profile$/i.test(a));
  if (flag > -1 && args[flag + 1] && !args[flag + 1].startsWith("-")) return args[flag + 1];
  return process.env.RGENERATOR_PROFILE || "";
}

// A folder name Windows will accept, whatever was typed on the command line.
function safeProfileName(raw) {
  return String(raw || "").replace(/[^A-Za-z0-9 _-]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
}

let profileName = ""; // "" = the default profile (the installed app's own data)
// The profile shown in the window title and sidebar: only one the user named
// with --profile. The automatic "Unpacked" / "Portable" data folders stay unlabelled.
let shownProfile = "";
let isUnpackedBuild = false;
try {
  const exeDir = path.basename(path.dirname(process.execPath)).toLowerCase();
  isUnpackedBuild = app.isPackaged && exeDir === "win-unpacked";
  const isPortableBuild = app.isPackaged && !!process.env.PORTABLE_EXECUTABLE_DIR;
  const named = safeProfileName(readProfileArg());
  profileName = named || (isUnpackedBuild ? "Unpacked" : isPortableBuild ? "Portable" : "");
  shownProfile = named;
  if (profileName) {
    // The unpacked build keeps the folder it has always used, so an existing
    // unpacked database and ChatGPT login are not orphaned by this change.
    const dir =
      !named && isUnpackedBuild
        ? path.join(app.getPath("appData"), "RGenerator (Unpacked)")
        : path.join(app.getPath("appData"), PROFILE_ROOT, profileName);
    fs.mkdirSync(dir, { recursive: true });
    app.setPath("userData", dir);
  }
} catch (_) {}

// One process per profile. Electron's lock is scoped to the userData folder, so
// copies running different profiles are unaffected — but a second copy pointed at
// a profile already in use is exactly the case that corrupts it, and that one
// hands its window over to the instance that owns the profile instead.
const gotProfileLock = app.requestSingleInstanceLock();
if (!gotProfileLock) {
  app.quit();
}

// Write startup/runtime failures to a log next to the app so packaged builds
// are diagnosable (GUI binaries don't print to a console).
function logCrash(where, err) {
  try {
    const line = `[${new Date().toISOString()}] ${where}: ${
      (err && err.stack) || err
    }\n`;
    fs.appendFileSync(path.join(app.getPath("userData"), "rgenerator.log"), line);
  } catch (_) {}
}
process.on("uncaughtException", (e) => logCrash("uncaughtException", e));

// ---- Connection (one choice for the whole app) ------------------------------
// The user picks Local IP or Proxy once, in the generator. That choice governs
// EVERY network path: the AI API requests, the embedded ChatGPT browser, and the
// V3 job-post reader. Previously the API calls always followed the "active"
// proxy while only the browser followed this selector, so picking Local IP still
// sent the API traffic through the proxy.
//   chat_conn_mode = "direct" → this computer's IP
//   chat_conn_mode = "proxy"  → chat_proxy_id, falling back to the active proxy
// Returns the proxy row to use, or null for a direct connection.
function resolveConnection() {
  const mode = getPref("chat_conn_mode") || "direct";
  if (mode !== "proxy") return null;
  const proxyId = getPref("chat_proxy_id");
  const pid = proxyId ? Number(proxyId) : null;
  let row = pid
    ? db.get("SELECT name, url, port, username, password FROM proxies WHERE id = ?", [pid])
    : null;
  if (!row) {
    row = db.get(
      "SELECT name, url, port, username, password FROM proxies WHERE is_active = 1 LIMIT 1"
    );
  }
  return row && String(row.url || "").trim() ? row : null;
}

// Point the AI API requests (undici) at the resolved connection. Cheap to call
// repeatedly — the ProxyAgent is only rebuilt when the target actually changes.
let apiConnKey = null;
function applyApiConnection() {
  const conn = resolveConnection();
  const key = conn
    ? `${conn.url}|${conn.port || ""}|${conn.username || ""}|${conn.password || ""}`
    : "direct";
  if (key === apiConnKey) return;
  apiConnKey = key;
  setProxy(conn ? { ...conn, enabled: true } : null);
}

// First run after upgrading: the connection mode didn't exist, and the API calls
// followed whichever proxy was active. Seed the mode from that so an existing
// setup keeps behaving the same instead of silently switching to direct.
function seedConnectionMode() {
  if (getPref("chat_conn_mode")) return;
  const active = db.get("SELECT id FROM proxies WHERE is_active = 1 LIMIT 1");
  setPref("chat_conn_mode", active ? "proxy" : "direct");
}
process.on("unhandledRejection", (e) => logCrash("unhandledRejection", e));
let mainWindow = null;

// The app's database file, inside whatever userData folder the product name
// resolves to. Kept in step with db.js.
const DB_FILE = "rgenerator.sqlite";

// Every IPC handler's synchronous part runs as one database transaction. With a
// database shared between apps, a read followed by a write that depends on it
// (the next sort position, then the insert) can't have another app's save land
// in between, and the handler's writes reach the file in one save. Work after
// an `await` runs outside it, each statement saving on its own.
function handle(channel, fn) {
  ipcMain.handle(channel, (...args) => db.transaction(() => fn(...args)));
}

// ---- Per-app settings ----------------------------------------------------------
// Settings that belong to this copy of the app rather than to the data: the
// network route and ChatGPT page that go with this app's own ChatGPT login, and
// whatever the generator is working on right now. They live in a small JSON
// file in this app's data folder, so apps sharing one database don't overwrite
// each other's drafts — and typing in the generator no longer rewrites the
// whole database on every keystroke. Everything else stays in the database.
const LOCAL_PREFS_FILE = "local-prefs.json";
const LOCAL_PREF_KEYS = new Set([
  "chat_conn_mode", "chat_proxy_id", "chatgpt_home_url",
  "selected_account_id",
  "gen_jd", "gen_v3_jd", "gen_result", "gen_v3_result", "gen_v3_meta",
  "gen_job_link", "gen_job_company", "gen_job_role", "gen_job_country", "gen_extra_info",
  "gen_saved_path", "gen_saved_at", "gen_mark_state",
]);

// { prefs: {key: value}, sharedFolder: "C:\\RGenerator Shared", movedFromDatabase: true }
let localPrefs = {};

const localPrefsPath = () => path.join(app.getPath("userData"), LOCAL_PREFS_FILE);

function loadLocalPrefs() {
  try {
    localPrefs = JSON.parse(fs.readFileSync(localPrefsPath(), "utf8")) || {};
  } catch (_) {
    localPrefs = {};
  }
  if (!localPrefs.prefs || typeof localPrefs.prefs !== "object") localPrefs.prefs = {};
}

function saveLocalPrefs() {
  const file = localPrefsPath();
  const text = JSON.stringify(localPrefs, null, 2);
  try {
    fs.writeFileSync(file + ".tmp", text);
    fs.renameSync(file + ".tmp", file);
  } catch (_) {
    try { fs.writeFileSync(file, text); } catch (e) { logCrash("saveLocalPrefs", e); }
  }
}

function getPref(key) {
  if (LOCAL_PREF_KEYS.has(key)) {
    const v = localPrefs.prefs[key];
    return v == null ? null : String(v);
  }
  const row = db.get("SELECT value FROM prefs WHERE key = ?", [key]);
  return row ? row.value : null;
}

function setPref(key, value) {
  const v = value == null ? null : String(value);
  if (LOCAL_PREF_KEYS.has(key)) {
    localPrefs.prefs[key] = v;
    saveLocalPrefs();
    return;
  }
  db.run(
    `INSERT INTO prefs (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, v]
  );
}

function deletePref(key) {
  if (LOCAL_PREF_KEYS.has(key)) {
    delete localPrefs.prefs[key];
    saveLocalPrefs();
    return;
  }
  db.run("DELETE FROM prefs WHERE key = ?", [key]);
}

// Imports leave per-app settings out: in the database nothing would read them.
function withoutLocalPrefs(groups) {
  return groups
    .map((g) => (g.id === "prefs" ? { ...g, items: g.items.filter((it) => !LOCAL_PREF_KEYS.has(it.id)) } : g))
    .filter((g) => g.items.length);
}

// First start after per-app settings existed: bring this app's values across
// from its own database, so a draft or a chosen connection isn't lost.
function moveLocalPrefsOutOfDatabase() {
  if (localPrefs.movedFromDatabase) return;
  // Only ever from this app's own database: a shared one holds another app's.
  if (!sharedFolder()) {
    try {
      db.all("SELECT key, value FROM prefs").forEach((r) => {
        if (LOCAL_PREF_KEYS.has(r.key) && localPrefs.prefs[r.key] == null) {
          localPrefs.prefs[r.key] = r.value;
        }
      });
    } catch (e) {
      logCrash("moveLocalPrefsOutOfDatabase", e);
    }
  }
  localPrefs.movedFromDatabase = true;
  saveLocalPrefs();
}

// ---- Shared database -------------------------------------------------------------
// Several apps on this PC (the installed app, the unpacked exe, profiles) can use
// one database kept in a folder outside all of them, as two files:
//   settings.sqlite — accounts, API keys, prompts, proxies, settings
//   history.sqlite  — application history and saved job posts
// Each app stores the folder in its own local-prefs.json; no folder = the app's
// own one-file database, as before. The ChatGPT login and per-app settings always
// stay in the app's own folder.
const SHARED_SETTINGS_FILE = "settings.sqlite";
const SHARED_HISTORY_FILE = "history.sqlite";
const ownDbPath = () => path.join(app.getPath("userData"), DB_FILE);
const sharedFolder = () => localPrefs.sharedFolder || "";
const sharedFiles = (folder) => ({
  settings: path.join(folder, SHARED_SETTINGS_FILE),
  history: path.join(folder, SHARED_HISTORY_FILE),
});

// The previous version shared ONE file. Where a folder still holds one (named in
// legacyFile, else rgenerator.sqlite), it's split into the two on first open.
function legacySharedFile(folder, legacyFile) {
  if (fs.existsSync(sharedFiles(folder).settings)) return null;
  const file = legacyFile || path.join(folder, DB_FILE);
  return fs.existsSync(file) ? file : null;
}

// Open the shared database in folder. seedFrom: a one-file database to start it
// from (sharing this app's own). A legacy one-file shared database is converted
// and then renamed, so apps still on the old version ask for the database
// instead of writing to a copy nobody reads any more.
async function openShared(folder, { seedFrom, legacyFile } = {}) {
  const files = sharedFiles(folder);
  const legacy = seedFrom ? null : legacySharedFile(folder, legacyFile);
  await db.initDb(app.getPath("userData"), {
    filePath: files.settings,
    historyPath: files.history,
    shared: true,
    watch: true,
    seedFrom: seedFrom || legacy || undefined,
  });
  if (legacy && fs.existsSync(legacy)) {
    try { fs.renameSync(legacy, legacy + ".before-split"); } catch (e) { logCrash("openShared", e); }
  }
}

// ---- Which apps are connected to the shared folder ----
// Each app keeps a small file in <shared folder>\connected-apps, rewritten every
// few seconds while it runs and removed when it quits or stops sharing. An app
// whose file hasn't been rewritten lately (it crashed) no longer counts.
const PRESENCE_DIR = "connected-apps";
const PRESENCE_EVERY_MS = 5000;
const PRESENCE_FRESH_MS = 15000;
const presenceName = () => profileName || "Installed app";
let presence = null; // { file, timer } while this app is connected

function writePresence() {
  if (!presence) return;
  try {
    fs.mkdirSync(path.dirname(presence.file), { recursive: true });
    fs.writeFileSync(presence.file, JSON.stringify({ name: presenceName(), pid: process.pid, seen: Date.now() }));
  } catch (_) {} // the folder is unreachable right now; the next beat retries
}

// Start, move or stop this app's presence to match the folder it now uses.
function updatePresence() {
  const folder = sharedFolder();
  const file = folder ? path.join(folder, PRESENCE_DIR, `${presenceName().replace(/[^\w -]/g, "")}-${process.pid}.json`) : null;
  if (presence && presence.file === file) return;
  if (presence) {
    clearInterval(presence.timer);
    try { fs.unlinkSync(presence.file); } catch (_) {}
    presence = null;
  }
  if (!file) return;
  presence = { file, timer: setInterval(writePresence, PRESENCE_EVERY_MS) };
  writePresence();
}

// The apps connected to this app's shared folder right now, this one included.
function connectedApps() {
  const folder = sharedFolder();
  if (!folder) return [];
  const dir = path.join(folder, PRESENCE_DIR);
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith(".json")); } catch (_) {}
  const out = [];
  names.forEach((n) => {
    try {
      const info = JSON.parse(fs.readFileSync(path.join(dir, n), "utf8"));
      if (Date.now() - info.seen > PRESENCE_FRESH_MS) {
        if (Date.now() - info.seen > 10 * PRESENCE_FRESH_MS) fs.unlinkSync(path.join(dir, n)); // long gone
        return;
      }
      out.push({ name: info.name, self: info.pid === process.pid && presence && path.basename(presence.file) === n });
    } catch (_) {}
  });
  return out.sort((a, b) => (b.self - a.self) || a.name.localeCompare(b.name));
}

// Open the database at startup: the shared one when this app uses one, else its
// own. A shared database that's missing or unreadable is never replaced with an
// empty one — the user decides. Returns false when they chose to quit.
async function openDatabase() {
  // The previous version stored the shared FILE; its folder is the shared folder.
  const legacyFile = localPrefs.sharedDatabase || "";
  if (legacyFile && !localPrefs.sharedFolder) localPrefs.sharedFolder = path.dirname(legacyFile);
  for (;;) {
    const folder = sharedFolder();
    if (!folder) {
      await db.initDb(app.getPath("userData"));
      return true;
    }
    let problem;
    if (!fs.existsSync(sharedFiles(folder).settings) && !legacySharedFile(folder, legacyFile)) {
      problem = "The shared database was not found. Its folder may have been renamed or moved, or the drive isn't connected.";
    } else {
      try {
        await openShared(folder, { legacyFile });
        if (localPrefs.sharedDatabase) {
          delete localPrefs.sharedDatabase;
          saveLocalPrefs();
        }
        return true;
      } catch (e) {
        logCrash("openDatabase", e);
        problem = `The shared database could not be opened: ${(e && e.message) || e}`;
      }
    }
    const choice = dialog.showMessageBoxSync({
      type: "warning",
      title: "Shared database",
      message: problem,
      detail: folder,
      buttons: ["Find the Folder…", "Use This App's Own Database", "Quit"],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (choice === 0) {
      const picked = dialog.showOpenDialogSync({
        title: "Find the shared database folder",
        defaultPath: folder,
        properties: ["openDirectory"],
      });
      if (picked && picked[0]) {
        localPrefs.sharedFolder = picked[0];
        saveLocalPrefs();
      }
    } else if (choice === 1) {
      delete localPrefs.sharedFolder;
      delete localPrefs.sharedDatabase;
      saveLocalPrefs();
    } else {
      return false;
    }
  }
}

// SQLite's file locking can't be trusted over a network, and sync clients
// (OneDrive and the like) hold, restore or duplicate files behind the app's
// back. Returns a reason to refuse, a reason to warn, or neither.
async function checkSharedLocation(file) {
  const full = path.resolve(file);
  if (full.startsWith("\\\\")) {
    return { refuse: "That folder is on a network share. A shared database must be on this PC's own drive, or it can be damaged." };
  }
  try {
    const drive = full.slice(0, 1);
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-Command", `[System.IO.DriveInfo]::new('${drive}').DriveType`],
      { encoding: "utf8", timeout: 8000, windowsHide: true }
    );
    const type = stdout.trim();
    if (type === "Network") {
      return { refuse: `Drive ${drive}: is a network drive. A shared database must be on this PC's own drive, or it can be damaged.` };
    }
  } catch (_) {} // can't tell — let it through
  const lower = full.toLowerCase();
  const syncRoots = [process.env.OneDrive, process.env.OneDriveConsumer, process.env.OneDriveCommercial]
    .filter(Boolean)
    .map((p) => path.resolve(p).toLowerCase() + path.sep);
  if (syncRoots.some((root) => lower.startsWith(root)) || /\\(onedrive[^\\]*|dropbox|google drive|icloud ?drive)\\/i.test(full)) {
    return { warn: "That folder is synced to the cloud (OneDrive, Dropbox or Google Drive). The sync app can lock the file, bring back an older copy or make conflict copies. A local folder such as C:\\RGenerator Shared is safer." };
  }
  return {};
}

// Show checkSharedLocation's verdict. Returns true when it's fine to go ahead.
async function confirmSharedLocation(file) {
  const verdict = await checkSharedLocation(file);
  if (verdict.refuse) {
    await dialog.showMessageBox(mainWindow, { type: "error", title: "Shared database", message: verdict.refuse, detail: file, buttons: ["OK"], noLink: true });
    return false;
  }
  if (verdict.warn) {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: "warning", title: "Shared database", message: verdict.warn, detail: file,
      buttons: ["Choose Another Folder", "Use It Anyway"], defaultId: 0, cancelId: 0, noLink: true,
    });
    return response === 1;
  }
  return true;
}

// Re-read what was taken from the old database, and show the new one.
function afterDatabaseSwitch(message) {
  updatePresence();
  upgradeRetiredModels(); // the new file may come from an older copy of the app
  apiConnKey = null;      // proxies differ between databases
  applyApiConnection();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.once("did-finish-load", () => {
      setTimeout(() => notify("Database", message), 1000); // once the page listens again
    });
    mainWindow.webContents.reload();
  }
}

// Tell the window another app saved to the shared database, so open screens
// re-read their lists.
function watchSharedDatabase() {
  db.onExternalChange(() => {
    applyApiConnection(); // a proxy edited in the other app
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("db:changed");
  });
}

// Every name this app has shipped under, newest first. Renaming changes the
// userData folder, so a rename would otherwise look like a fresh install with
// an empty database.
const LEGACY_INSTALLS = [
  { dir: "Careerva", db: "careerva.sqlite" },
  { dir: "TailorApply", db: "tailorapply.sqlite" },
];

// Chromium's throwaway directories — regenerated on demand, and by far the
// bulk of a session folder. No reason to copy them during a migration.
const DISPOSABLE_DIRS = new Set([
  "Cache", "Code Cache", "GPUCache", "DawnCache", "ShaderCache",
  "GraphiteDawnCache", "DawnGraphiteCache", "DawnWebGPUCache",
]);

function copyTree(src, dest) {
  let entries;
  try { entries = fs.readdirSync(src, { withFileTypes: true }); } catch (_) { return; }
  try { fs.mkdirSync(dest, { recursive: true }); } catch (_) { return; }
  entries.forEach((entry) => {
    if (entry.isDirectory()) {
      if (DISPOSABLE_DIRS.has(entry.name)) return;
      copyTree(path.join(src, entry.name), path.join(dest, entry.name));
    } else {
      try { fs.copyFileSync(path.join(src, entry.name), path.join(dest, entry.name)); } catch (_) {}
    }
  });
}

// One-time migration after a rename: bring the previous install's database and
// its signed-in ChatGPT session across, so nothing is lost and V2/V3 don't ask
// for a fresh login. Runs once — once the new database exists it's a no-op.
function migrateLegacyData() {
  try {
    const newDir = app.getPath("userData");
    const newDb = path.join(newDir, DB_FILE);
    if (fs.existsSync(newDb)) return; // already migrated, or a genuine fresh install
    const appData = app.getPath("appData");

    const previous = LEGACY_INSTALLS.map((legacy) => ({
      dir: path.join(appData, legacy.dir),
      db: path.join(appData, legacy.dir, legacy.db),
    })).find((candidate) => fs.existsSync(candidate.db));
    if (!previous) return; // nothing from an earlier name to bring over

    fs.mkdirSync(newDir, { recursive: true });
    fs.copyFileSync(previous.db, newDb);
    // The embedded browser's cookies live here; without them the ChatGPT tab
    // would come up signed out after the rename.
    copyTree(path.join(previous.dir, "Partitions"), path.join(newDir, "Partitions"));
  } catch (e) {
    logCrash("migrateLegacyData", e);
  }
}


function nowIso() {
  return new Date().toISOString();
}

// ---- Generate V3: job-post extraction helpers -----------------------------

// Turn an HTML description (as found in schema.org JobPosting) into clean text.
function stripHtml(html) {
  return String(html || "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#0?39;|&rsquo;|&lsquo;|&apos;/gi, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&mdash;/gi, "—")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Read a scalar out of a JSON-LD value that may be a string, {name}, or {"@value"}.
function ldText(v) {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) return v.map(ldText).filter(Boolean).join(", ");
  if (typeof v === "object") return String(v.name || v["@value"] || "").trim();
  return String(v).trim();
}

// Find the first schema.org JobPosting object across the page's JSON-LD blocks.
function parseJobPostingLd(ldArr) {
  const candidates = [];
  (ldArr || []).forEach((raw) => {
    let obj;
    try { obj = JSON.parse(raw); } catch (_) { return; }
    const push = (o) => { if (o && typeof o === "object") candidates.push(o); };
    if (Array.isArray(obj)) obj.forEach(push);
    else { push(obj); if (Array.isArray(obj["@graph"])) obj["@graph"].forEach(push); }
  });
  return candidates.find((c) => {
    const t = c["@type"];
    return t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"));
  }) || null;
}

// Build our structured shape from a schema.org JobPosting (no AI needed).
function buildFromLd(c) {
  const role = ldText(c.title);
  const company = ldText(c.hiringOrganization);
  let location = "", country = "";
  const loc = Array.isArray(c.jobLocation) ? c.jobLocation[0] : c.jobLocation;
  const addr = loc && (loc.address || loc);
  if (addr && typeof addr === "object") {
    location = [addr.addressLocality, addr.addressRegion].map(ldText).filter(Boolean).join(", ");
    country = ldText(addr.addressCountry);
  }
  let salaryRange = "";
  const bs = c.baseSalary;
  if (bs && typeof bs === "object") {
    const val = bs.value && typeof bs.value === "object" ? bs.value : bs;
    const cur = ldText(bs.currency) || ldText(val.currency);
    const min = val.minValue != null ? val.minValue : val.value;
    const max = val.maxValue;
    const unit = ldText(val.unitText);
    const nums = [min, max].filter((x) => x != null && x !== "");
    if (nums.length) {
      salaryRange = (cur ? cur + " " : "") + nums.join("–") + (unit ? " / " + String(unit).toLowerCase() : "");
    }
  }
  const employmentType = ldText(c.employmentType).replace(/_/g, " ");
  const industry = ldText(c.industry);
  const jobDescription = stripHtml(c.description);
  return { role, company, country, location, salaryRange, industry, employmentType, jobDescription };
}

// Local date + time, in two forms: a filesystem-safe one for folder names and
// a readable one for display. e.g. { folder: "2026-06-01 14-30-45",
// display: "2026-06-01 14:30:45" }.
function nowStamp() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString();
  const date = local.slice(0, 10);
  const time = local.slice(11, 19); // HH:MM:SS
  return { folder: `${date} ${time.replace(/:/g, "-")}`, display: `${date} ${time}` };
}

// Show a message inside the app window (a top-right toast) instead of a native
// Windows notification. Falls back silently if the window isn't available.
function notify(title, body) {
  try {
    if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send("app:notify", body || title);
    }
  } catch (_) {}
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    center: true,
    // A named profile in the title is how two or three copies on one desktop are
    // told apart — in the taskbar, and in Alt-Tab.
    title: shownProfile ? `RGenerator — ${shownProfile}` : "RGenerator",
    // Match the app's dark theme so there's no white flash before the UI paints.
    backgroundColor: "#0c0e13",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // Enable Chromium's built-in PDF viewer so the resume preview can render
      // the generated PDF inline as real, paginated pages.
      plugins: true,
      // Allow the embedded <webview> tab that hosts ChatGPT inside the app.
      webviewTag: true,
      // Keep timers/JS at full speed when the app is in the background, so V2
      // generation (auto-send + auto-copy poll loops) finishes even while the
      // user works in other windows.
      backgroundThrottling: false,
    },
  });

  // Open links from the app (including links clicked in the inline PDF/resume
  // preview) in the user's default browser / mail client — like target="_blank".
  // Only http/mailto/tel are intercepted; blob:/data:/file: loads (the preview
  // itself) are left alone.
  const openExternal = (url) => {
    if (/^(https?:|mailto:|tel:)/i.test(url || "")) { shell.openExternal(url); return true; }
    return false;
  };
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  const guardNavigate = (e, url) => { if (openExternal(url)) e.preventDefault(); };
  mainWindow.webContents.on("will-navigate", (e, url) => guardNavigate(e, url));
  mainWindow.webContents.on("will-frame-navigate", (e) => guardNavigate(e, e.url));

  if (isDev) {
    mainWindow.loadURL("http://localhost:3000");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(
      path.join(__dirname, "..", "renderer", "out", "index.html")
    );
  }
}

// ---- IPC handlers ----------------------------------------------------------

// Every read of an account's roles uses this, so the form, the resume, the
// prompt and the cover letter all see the same newest-first order. Rows written
// before sort_order existed fall back to id, keeping them together at the end
// until the next save renumbers them.
const WORK_BY_ACCOUNT =
  "SELECT * FROM work_history WHERE account_id = ? ORDER BY COALESCE(sort_order, 9999) ASC, id ASC";

// Re-derive the newest-first ordering for one account from the dates on its
// roles, and write it back as sort_order. Called after anything that adds,
// edits or replaces a role, so the stored order always matches the dates.
function renumberWork(accountId) {
  const rows = db.all(
    "SELECT id, work_duration FROM work_history WHERE account_id = ? ORDER BY COALESCE(sort_order, 9999) ASC, id ASC",
    [accountId]
  );
  if (!rows.length) return;
  const sorted = sortRoles(rows);
  db.runMany(
    sorted.map((r, i) => ["UPDATE work_history SET sort_order = ? WHERE id = ?", [i, r.id]])
  );
}

// The border mark - a job extracted, or its resume already taken away to file -
// belongs to a single working session. A fresh start of the app is a fresh
// session, so no mark ever carries over into it.
function clearLocationCopied() {
  try {
    setPref("gen_mark_state", "");
  } catch (e) {
    console.log("[prefs] could not clear the copied mark:", (e && e.message) || e);
  }
}

// One-off on startup: number the roles that predate the sort_order column.
function backfillWorkOrder() {
  try {
    const pending = db.all(
      "SELECT DISTINCT account_id FROM work_history WHERE sort_order IS NULL AND account_id IS NOT NULL"
    );
    pending.forEach((r) => renumberWork(r.account_id));
    if (pending.length) console.log(`[work] ordered roles for ${pending.length} account(s)`);
  } catch (e) {
    console.log("[work] could not order existing roles:", (e && e.message) || e);
  }
}

// Point saved Gemini keys at a live model when Google has retired theirs, so the
// API Keys list shows (and edits) the model that's actually called.
function upgradeRetiredModels() {
  try {
    const stale = db.all("SELECT id, model FROM api_keys WHERE provider = 'gemini'")
      .filter((r) => RETIRED_GEMINI_MODELS[(r.model || "").trim()]);
    db.runMany(stale.map((r) => [
      "UPDATE api_keys SET model = ? WHERE id = ?",
      [RETIRED_GEMINI_MODELS[r.model.trim()], r.id],
    ]));
    if (stale.length) console.log(`[keys] upgraded ${stale.length} key(s) off retired Gemini models`);
  } catch (e) {
    console.log("[keys] could not upgrade retired models:", (e && e.message) || e);
  }
}

function registerIpc() {
  // License / activation (machine-locked)
  handle("license:status", () => {
    const row = db.get("SELECT value FROM prefs WHERE key = 'license_key'");
    const stored = row && row.value;
    const activated = !!stored && license.validate(stored);
    return {
      activated,
      machineId: license.formatId(license.machineId()),
      // Only surface the key when it's a valid activation for this machine.
      key: activated ? stored : "",
    };
  });

  handle("license:activate", (_e, key) => {
    if (license.validate(key)) {
      db.run(
        `INSERT INTO prefs (key, value) VALUES ('license_key', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [String(key || "").trim()]
      );
      return { ok: true };
    }
    return { ok: false, error: "Invalid key for this machine." };
  });

  // API keys (multiple; one active key PER KIND is used). Kinds: 'v1' = direct
  // resume generation (Gemini/OpenAI/Anthropic), 'v2' = a Gemini key that
  // refines the ChatGPT prompt. Pass a kind to list only that group.
  handle("apikeys:list", (_e, kind) => {
    const k = kind === "v1" || kind === "v2" ? kind : null;
    return k
      ? db.all(
          "SELECT id, name, api_key, provider, model, kind, is_active FROM api_keys WHERE kind = ? ORDER BY sort_order ASC, id ASC",
          [k]
        )
      : db.all(
          "SELECT id, name, api_key, provider, model, kind, is_active FROM api_keys ORDER BY sort_order ASC, id ASC"
        );
  });

  // Persist a new API-key ranking from drag-and-drop (array of ids in order).
  handle("apikeys:reorder", (_e, ids) => {
    (ids || []).forEach((id, i) => {
      db.run("UPDATE api_keys SET sort_order = ? WHERE id = ?", [i, id]);
    });
    return { ok: true };
  });

  handle("apikeys:add", (_e, d) => {
    const name = (d.name || "").trim();
    const key = (d.api_key || "").trim();
    const kind = d.kind === "v2" ? "v2" : "v1";
    // V2 keys only refine the ChatGPT prompt, which uses Gemini.
    const provider = kind === "v2" ? "gemini" : (d.provider || "gemini").trim().toLowerCase();
    const model = (d.model || "").trim();
    if (!key) return { ok: false, error: "Key is required." };
    // First key added IN THIS KIND becomes active automatically.
    const existing = db.get("SELECT COUNT(*) AS c FROM api_keys WHERE kind = ?", [kind]);
    const active = existing && existing.c > 0 ? 0 : 1;
    const maxRow = db.get("SELECT COALESCE(MAX(sort_order), -1) AS m FROM api_keys");
    const nextOrder = (maxRow ? maxRow.m : -1) + 1;
    const id = db.insert(
      "INSERT INTO api_keys (name, api_key, provider, model, kind, is_active, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [name, key, provider, model, kind, active, nextOrder, nowIso()]
    );
    return { ok: true, id };
  });

  handle("apikeys:update", (_e, d) => {
    const name = (d.name || "").trim();
    const key = (d.api_key || "").trim();
    const row = db.get("SELECT kind FROM api_keys WHERE id = ?", [d.id]);
    const kind = (row && row.kind) === "v2" ? "v2" : "v1";
    const provider = kind === "v2" ? "gemini" : (d.provider || "gemini").trim().toLowerCase();
    const model = (d.model || "").trim();
    if (!key) return { ok: false, error: "Key is required." };
    db.run(
      "UPDATE api_keys SET name = ?, api_key = ?, provider = ?, model = ? WHERE id = ?",
      [name, key, provider, model, d.id]
    );
    return { ok: true };
  });

  handle("apikeys:delete", (_e, id) => {
    const wasActive = db.get("SELECT is_active, kind FROM api_keys WHERE id = ?", [id]);
    db.run("DELETE FROM api_keys WHERE id = ?", [id]);
    // If we removed the active key, promote the most recent remaining one OF THE
    // SAME KIND so each group keeps an active key.
    if (wasActive && wasActive.is_active) {
      const next = db.get(
        "SELECT id FROM api_keys WHERE kind = ? ORDER BY id DESC LIMIT 1",
        [wasActive.kind || "v1"]
      );
      if (next) db.run("UPDATE api_keys SET is_active = 1 WHERE id = ?", [next.id]);
    }
    return { ok: true };
  });

  handle("apikeys:setActive", (_e, id) => {
    // Active is per-kind: clear only this key's group, then activate it.
    const row = db.get("SELECT kind FROM api_keys WHERE id = ?", [id]);
    const kind = (row && row.kind) || "v1";
    db.run("UPDATE api_keys SET is_active = 0 WHERE kind = ?", [kind]);
    db.run("UPDATE api_keys SET is_active = 1 WHERE id = ?", [id]);
    return { ok: true };
  });

  // Accounts (each account = one person with personal info + many work histories)
  handle("accounts:list", () =>
    db.all(
      "SELECT id, name, title, country, main_stack FROM accounts ORDER BY sort_order ASC, id ASC"
    )
  );

  handle("accounts:get", (_e, id) =>
    db.get("SELECT * FROM accounts WHERE id = ?", [id])
  );

  handle("accounts:create", (_e, d) => {
    const maxRow = db.get("SELECT COALESCE(MAX(sort_order), 0) AS m FROM accounts");
    const nextOrder = (maxRow ? maxRow.m : 0) + 1;
    const id = db.insert(
      `INSERT INTO accounts (name, title, email, phone, address, country, linkedin, portfolio, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        (d && d.name) || "New Account",
        "",
        "",
        "",
        "",
        (d && d.country) || "",
        "",
        "",
        nextOrder,
        nowIso(),
      ]
    );
    return { id };
  });

  // Persist a new ranking from drag-and-drop (array of account ids in order).
  // One statement per account, but a SINGLE read-modify-write of the database.
  // As separate run() calls this rewrote the whole 8MB file once per account and
  // left the ranking half-applied in between — so two quick drags could
  // interleave and land a mix of the old and new order.
  handle("accounts:reorder", (_e, ids) => {
    const list = (ids || []).filter((id) => id != null);
    if (!list.length) return { ok: false, error: "no-ids" };
    db.runMany(list.map((id, i) => ["UPDATE accounts SET sort_order = ? WHERE id = ?", [i, id]]));
    // Hand back what is now stored, so the caller can render the saved truth
    // instead of assuming the write landed.
    return { ok: true, accounts: db.all("SELECT id, name, title, country, main_stack FROM accounts ORDER BY sort_order ASC, id ASC") };
  });

  handle("accounts:save", (_e, d) => {
    db.run(
      `UPDATE accounts SET name = ?, title = ?, email = ?, phone = ?, address = ?,
         country = ?, linkedin = ?, portfolio = ?, main_stack = ?, additional_info = ?,
         birth_date = ?, password = ?, recovery = ?, resume_link = ?,
         cover_letter_link = ?, time_zone = ?, resume_style = ?, resume_accent = ?,
         resume_name_color = ?, resume_font = ?, resume_font_size = ? WHERE id = ?`,
      [
        d.name || "",
        d.title || "",
        d.email || "",
        d.phone || "",
        d.address || "",
        d.country || "",
        d.linkedin || "",
        d.portfolio || "",
        d.main_stack || "",
        d.additional_info || "",
        d.birth_date || "",
        d.password || "",
        d.recovery || "",
        d.resume_link || "",
        d.cover_letter_link || "",
        d.time_zone || "",
        // The saved resume look. Empty string = no preference for this account.
        d.resume_style || "",
        d.resume_accent || "",
        d.resume_name_color || "",
        d.resume_font || "",
        d.resume_font_size || "",
        d.id,
      ]
    );
    return { ok: true };
  });

  // Save ONLY the resume look (Set Resume tab). Separate from accounts:save so a
  // template or colour takes effect the moment it is clicked, without also
  // writing whatever half-finished edits are sitting on the other tabs.
  handle("accounts:saveLook", (_e, d) => {
    if (!d || !d.id) return { ok: false, error: "no-account" };
    db.run(
      `UPDATE accounts SET resume_style = ?, resume_accent = ?, resume_name_color = ?,
         resume_font = ?, resume_font_size = ? WHERE id = ?`,
      [
        d.resume_style || "",
        d.resume_accent || "",
        d.resume_name_color || "",
        d.resume_font || "",
        d.resume_font_size || "",
        d.id,
      ]
    );
    return { ok: true };
  });

  handle("accounts:delete", (_e, id) => {
    db.run("DELETE FROM work_history WHERE account_id = ?", [id]);
    db.run("DELETE FROM education WHERE account_id = ?", [id]);
    db.run("DELETE FROM projects WHERE account_id = ?", [id]);
    db.run("DELETE FROM applications WHERE account_id = ?", [id]);
    db.run("DELETE FROM accounts WHERE id = ?", [id]);
    return { ok: true };
  });

  // Projects (scoped to an account)
  handle("projects:list", (_e, accountId) =>
    db.all(
      "SELECT * FROM projects WHERE account_id = ? ORDER BY id ASC",
      [accountId]
    )
  );

  handle("projects:replaceAll", (_e, d) => {
    const accountId = d.accountId;
    db.run("DELETE FROM projects WHERE account_id = ?", [accountId]);
    (d.rows || []).forEach((r) => {
      const empty =
        !(r.title || "").trim() &&
        !(r.link || "").trim() &&
        !(r.description || "").trim();
      if (empty) return;
      db.insert(
        `INSERT INTO projects (account_id, title, link, description, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [accountId, r.title || "", r.link || "", r.description || "", nowIso()]
      );
    });
    return { ok: true };
  });

  // Per-account application counts + total.
  handle("applications:counts", () => {
    const rows = db.all(
      "SELECT account_id, COUNT(*) AS c FROM applications GROUP BY account_id"
    );
    const counts = {};
    let total = 0;
    rows.forEach((r) => {
      counts[r.account_id] = r.c;
      total += r.c;
    });
    return { total, counts };
  });

  // Application history for one account (most recent first).
  handle("applications:byAccount", (_e, accountId) =>
    db.all(
      `SELECT ap.id, ap.role, ap.company, ap.country, ap.request_id, ap.applied_at, ap.pdf_path,
              ap.gpt_url, (CASE WHEN IFNULL(ap.gpt_url,'') <> '' THEN 1 ELSE 0 END) AS has_gpt,
              ap.job_link, (CASE WHEN IFNULL(ap.job_link,'') <> '' THEN 1 ELSE 0 END) AS has_link,
              ac.name AS account_name, ac.main_stack AS account_stack,
              ac.country AS account_country
       FROM applications ap
       LEFT JOIN accounts ac ON ac.id = ap.account_id
       WHERE ap.account_id = ? ORDER BY ap.id DESC`,
      [accountId]
    )
  );

  // The most recent resume actually generated for an account, used to preview a
  // style/colour/font choice against real content on the "Set Resume" tab
  // instead of a mock-up. Rows with no stored text are skipped, so an older
  // application that does have content still gives something to show.
  handle("applications:lastResume", (_e, accountId) =>
    db.get(
      `SELECT resume_content, role, company, applied_at
         FROM applications
        WHERE account_id = ? AND IFNULL(resume_content, '') <> ''
        ORDER BY id DESC LIMIT 1`,
      [accountId]
    ) || null
  );

  // Every application across all accounts (with the owning account's name),
  // most recent first — feeds the "All Applications" tab.
  handle("applications:all", () =>
    db.all(
      `SELECT ap.id, ap.role, ap.company, ap.country, ap.request_id, ap.applied_at, ap.pdf_path,
              ap.gpt_url, (CASE WHEN IFNULL(ap.gpt_url,'') <> '' THEN 1 ELSE 0 END) AS has_gpt,
              ap.job_link, (CASE WHEN IFNULL(ap.job_link,'') <> '' THEN 1 ELSE 0 END) AS has_link,
              ac.name AS account_name, ac.main_stack AS account_stack,
              ac.country AS account_country
       FROM applications ap
       LEFT JOIN accounts ac ON ac.id = ap.account_id
       ORDER BY ap.id DESC`
    )
  );

  // Search applications by account name, role, or company.
  handle("applications:search", (_e, query) => {
    const like = `%${(query || "").trim().toLowerCase()}%`;
    return db.all(
      `SELECT ap.id, ap.role, ap.company, ap.country, ap.request_id, ap.applied_at, ap.pdf_path,
              ap.gpt_url, (CASE WHEN IFNULL(ap.gpt_url,'') <> '' THEN 1 ELSE 0 END) AS has_gpt,
              ap.job_link, (CASE WHEN IFNULL(ap.job_link,'') <> '' THEN 1 ELSE 0 END) AS has_link,
              ac.name AS account_name, ac.main_stack AS account_stack,
              ac.country AS account_country
       FROM applications ap
       LEFT JOIN accounts ac ON ac.id = ap.account_id
       WHERE LOWER(IFNULL(ac.name, '')) LIKE ?
          OR LOWER(IFNULL(ap.role, '')) LIKE ?
          OR LOWER(IFNULL(ap.company, '')) LIKE ?
          OR LOWER(IFNULL(ap.request_id, '')) LIKE ?
       ORDER BY ap.id DESC`,
      [like, like, like, like]
    );
  });

  // Everything recorded about one application's target job — powers the
  // history's "View Job Content" modal. Kept out of the list queries so the
  // (potentially large) description is only loaded when it's actually opened.
  handle("application:jobContent", (_e, id) => {
    const row = db.get(
      `SELECT ap.*, ac.name AS account_name, ac.main_stack AS account_stack,
              ac.country AS account_country
       FROM applications ap
       LEFT JOIN accounts ac ON ac.id = ap.account_id
       WHERE ap.id = ?`,
      [id]
    );
    if (!row) return { ok: false, error: "Application not found." };
    // Older entries (and V1/V2 generations) have no extracted details. Fill the
    // gaps from the cached job post for the same URL when one exists.
    const link = (row.job_link || "").trim();
    if (link && !(row.location || row.industry || row.salary_range || row.employment_type)) {
      const post = db.get(
        "SELECT location, industry, salary_range, employment_type FROM job_posts WHERE url = ? ORDER BY id DESC LIMIT 1",
        [link]
      );
      if (post) {
        row.location = row.location || post.location || "";
        row.industry = row.industry || post.industry || "";
        row.salary_range = row.salary_range || post.salary_range || "";
        row.employment_type = row.employment_type || post.employment_type || "";
      }
    }
    return { ok: true, application: row };
  });

  // Does an application already exist for this account + company + role? Used to
  // confirm before generating another resume for the same company and job title.
  handle("applications:findDuplicate", (_e, d) => {
    const accountId = d && d.accountId;
    const r = ((d && d.role) || "").trim();
    const c = ((d && d.company) || "").trim();
    if (!accountId || !r || !c) return { exists: false };
    // Match on the dedicated index columns (match_company / match_role — the
    // Gemini JD extraction). Fall back to the display columns so applications
    // saved before these columns existed are still detected.
    const row = db.get(
      `SELECT id FROM applications
       WHERE account_id = ?
         AND LOWER(COALESCE(NULLIF(match_company, ''), company)) = LOWER(?)
         AND LOWER(COALESCE(NULLIF(match_role, ''), role)) = LOWER(?)
       LIMIT 1`,
      [accountId, c, r]
    );
    return { exists: !!row, id: row ? row.id : null };
  });

  // Export the whole application history to a CSV file the user picks.
  handle("applications:export", async () => {
    try {
      const rows = db.all(
        `SELECT ap.applied_at, ac.name AS account_name, ac.main_stack AS account_stack,
                ap.role, ap.company, ap.country, ap.location, ap.industry,
                ap.employment_type, ap.salary_range, ap.request_id, ap.job_link,
                ap.gpt_url, ap.pdf_path, ap.job_description
         FROM applications ap
         LEFT JOIN accounts ac ON ac.id = ap.account_id
         ORDER BY ap.id DESC`
      );
      if (!rows.length) return { ok: false, error: "No applications to export." };

      const res = await dialog.showSaveDialog(mainWindow, {
        title: "Export application history",
        defaultPath: "applications.csv",
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (res.canceled || !res.filePath) return { canceled: true };

      // Quote every field so commas/quotes/newlines in values stay intact.
      const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
      const header = [
        "Applied At", "Account", "Stack", "Role", "Company", "Country",
        "Location", "Industry", "Employment Type", "Salary", "Unique ID",
        "Job Link", "ChatGPT URL", "PDF Path", "Job Description",
      ];
      const lines = [header.map(esc).join(",")];
      rows.forEach((r) => {
        lines.push([
          r.applied_at, r.account_name, r.account_stack, r.role,
          r.company, r.country, r.location, r.industry, r.employment_type,
          r.salary_range, r.request_id, r.job_link, r.gpt_url, r.pdf_path,
          r.job_description,
        ].map(esc).join(","));
      });
      // BOM so Excel opens UTF-8 correctly.
      fs.writeFileSync(res.filePath, "﻿" + lines.join("\r\n"), "utf8");
      return { ok: true, path: res.filePath, count: rows.length };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  });

  // Export the application history as its own .sqlite file — every column of
  // every entry, independent of the Settings → Database backup (which carries
  // API keys, proxies, prompts and personal data as well).
  handle("applications:exportDb", async () => {
    try {
      const { bytes, count } = db.exportApplicationsDb();
      if (!count) return { ok: false, error: "No applications to export." };

      const stamp = nowStamp().folder.replace(/[: ]/g, "-");
      const res = await dialog.showSaveDialog(mainWindow, {
        title: "Export application history",
        defaultPath: `rgenerator-applications ${stamp}.sqlite`,
        filters: [{ name: "SQLite Database", extensions: ["sqlite"] }],
      });
      if (res.canceled || !res.filePath) return { canceled: true };

      fs.writeFileSync(res.filePath, bytes);
      return { ok: true, path: res.filePath, count };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  });

  // Merge an exported history back in. Entries already present are skipped, so
  // importing the same file twice is harmless.
  handle("applications:importDb", async () => {
    try {
      const res = await dialog.showOpenDialog(mainWindow, {
        title: "Import application history",
        properties: ["openFile"],
        filters: [{ name: "SQLite Database", extensions: ["sqlite", "sqlite3", "db"] }],
      });
      if (res.canceled || !res.filePaths.length) return { canceled: true };
      return db.importApplications(res.filePaths[0]);
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  });

  // One account as a Markdown record. The renderer sends what's on screen, so
  // unsaved edits export too.
  handle("account:exportMd", async (_e, d) => {
    try {
      const info = (d && d.personal) || {};
      const name = String(info.name || "account").replace(/[<>:"/\\|?*\x00-\x1f]+/g, " ").trim();
      const res = await dialog.showSaveDialog(mainWindow, {
        title: "Export account",
        defaultPath: `${name || "account"}.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (res.canceled || !res.filePath) return { canceled: true };
      const md = accountMd.toMarkdown(info, (d && d.education) || [], (d && d.work) || []);
      fs.writeFileSync(res.filePath, md, "utf8");
      return { ok: true, path: res.filePath };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  });

  // Read a Markdown record into the form — same shape the PDF import returns.
  handle("account:importMd", async () => {
    try {
      const res = await dialog.showOpenDialog(mainWindow, {
        title: "Import account",
        properties: ["openFile"],
        filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
      });
      if (res.canceled || !res.filePaths.length) return { canceled: true };
      const text = fs.readFileSync(res.filePaths[0], "utf8");
      const data = accountMd.parseMarkdown(text);
      if (!data.personal.name && !data.work.length) {
        return { ok: false, error: "That file doesn't look like an account record — no name or work history found." };
      }
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  });

  // Education (scoped to an account)
  handle("education:list", (_e, accountId) =>
    db.all(
      "SELECT * FROM education WHERE account_id = ? ORDER BY id DESC",
      [accountId]
    )
  );

  handle("education:replaceAll", (_e, d) => {
    const accountId = d.accountId;
    db.run("DELETE FROM education WHERE account_id = ?", [accountId]);
    (d.rows || []).forEach((r) => {
      const empty =
        !(r.university || "").trim() &&
        !(r.location || "").trim() &&
        !(r.degree || "").trim() &&
        !(r.period || "").trim();
      if (empty) return;
      db.insert(
        `INSERT INTO education (account_id, university, location, degree, period, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          accountId,
          r.university || "",
          r.location || "",
          r.degree || "",
          r.period || "",
          nowIso(),
        ]
      );
    });
    return { ok: true };
  });

  // Work history (scoped to an account), newest job first — see workOrder.js.
  handle("work:list", (_e, accountId) => db.all(WORK_BY_ACCOUNT, [accountId]));

  handle("work:add", (_e, d) => {
    const id = db.insert(
      `INSERT INTO work_history (account_id, role_name, company_name, location, work_duration, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        d.account_id,
        d.role_name || "",
        d.company_name || "",
        d.location || "",
        d.work_duration || "",
        nowIso(),
      ]
    );
    // A new role slots into place by its dates rather than landing at the end.
    renumberWork(d.account_id);
    return { id };
  });

  handle("work:update", (_e, d) => {
    db.run(
      `UPDATE work_history SET role_name = ?, company_name = ?, location = ?, work_duration = ?
       WHERE id = ?`,
      [
        d.role_name || "",
        d.company_name || "",
        d.location || "",
        d.work_duration || "",
        d.id,
      ]
    );
    // The dates may have moved, so the role may belong somewhere else now.
    const owner = db.get("SELECT account_id FROM work_history WHERE id = ?", [d.id]);
    if (owner && owner.account_id) renumberWork(owner.account_id);
    return { ok: true };
  });

  handle("work:delete", (_e, id) => {
    db.run("DELETE FROM work_history WHERE id = ?", [id]);
    return { ok: true };
  });

  // Replace all work history for an account in one shot (used by the single
  // "Save" action on the account form).
  handle("work:replaceAll", (_e, d) => {
    const accountId = d.accountId;
    db.run("DELETE FROM work_history WHERE account_id = ?", [accountId]);
    // Stored newest job first, whatever order they were typed in.
    sortRoles(d.rows || []).forEach((r, i) => {
      const empty =
        !(r.role_name || "").trim() &&
        !(r.company_name || "").trim() &&
        !(r.location || "").trim() &&
        !(r.work_duration || "").trim();
      if (empty) return;
      db.insert(
        `INSERT INTO work_history (account_id, role_name, company_name, location, work_duration, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          accountId,
          r.role_name || "",
          r.company_name || "",
          r.location || "",
          r.work_duration || "",
          i,
          nowIso(),
        ]
      );
    });
    return { ok: true };
  });

  // Instructions (multiple named prompts; one active is used for generation)
  handle("instructions:list", () =>
    db.all(
      "SELECT id, name, body, is_active FROM instructions ORDER BY sort_order ASC, id ASC"
    )
  );

  handle("instructions:add", (_e, d) => {
    const existing = db.get("SELECT COUNT(*) AS c FROM instructions");
    const active = existing && existing.c > 0 ? 0 : 1;
    const maxRow = db.get("SELECT COALESCE(MAX(sort_order), 0) AS m FROM instructions");
    const nextOrder = (maxRow ? maxRow.m : 0) + 1;
    const id = db.insert(
      "INSERT INTO instructions (name, body, is_active, sort_order, created_at) VALUES (?, ?, ?, ?, ?)",
      [(d.name || "Untitled").trim(), d.body || "", active, nextOrder, nowIso()]
    );
    return { ok: true, id };
  });

  handle("instructions:reorder", (_e, ids) => {
    (ids || []).forEach((id, i) => {
      db.run("UPDATE instructions SET sort_order = ? WHERE id = ?", [i, id]);
    });
    return { ok: true };
  });

  handle("instructions:update", (_e, d) => {
    db.run("UPDATE instructions SET name = ?, body = ? WHERE id = ?", [
      (d.name || "Untitled").trim(),
      d.body || "",
      d.id,
    ]);
    return { ok: true };
  });

  handle("instructions:delete", (_e, id) => {
    const wasActive = db.get("SELECT is_active FROM instructions WHERE id = ?", [id]);
    db.run("DELETE FROM instructions WHERE id = ?", [id]);
    if (wasActive && wasActive.is_active) {
      const next = db.get("SELECT id FROM instructions ORDER BY id DESC LIMIT 1");
      if (next) db.run("UPDATE instructions SET is_active = 1 WHERE id = ?", [next.id]);
    }
    return { ok: true };
  });

  handle("instructions:setActive", (_e, id) => {
    db.run("UPDATE instructions SET is_active = 0");
    db.run("UPDATE instructions SET is_active = 1 WHERE id = ?", [id]);
    return { ok: true };
  });

  // Download location (where generated resume PDFs are saved)
  handle("location:get", () => {
    const row = db.get("SELECT value FROM prefs WHERE key = 'download_location'");
    return { path: (row && row.value) || app.getPath("downloads") };
  });

  handle("location:choose", async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: "Choose download folder",
      properties: ["openDirectory", "createDirectory"],
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    const dir = res.filePaths[0];
    db.run(
      `INSERT INTO prefs (key, value) VALUES ('download_location', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [dir]
    );
    return { path: dir };
  });

  handle("location:open", async () => {
    const row = db.get("SELECT value FROM prefs WHERE key = 'download_location'");
    const dir = (row && row.value) || app.getPath("downloads");
    const err = await shell.openPath(dir);
    return { ok: !err, error: err || undefined };
  });

  // Export the whole SQLite database to a user-chosen .sqlite file — settings
  // and history together, even when they're shared as two files.
  handle("db:export", async () => {
    try {
      const res = await dialog.showSaveDialog(mainWindow, {
        title: "Export database",
        defaultPath: "rgenerator-backup.sqlite",
        filters: [{ name: "SQLite Database", extensions: ["sqlite"] }],
      });
      if (res.canceled || !res.filePath) return { canceled: true };
      fs.writeFileSync(res.filePath, db.exportAll());
      return { ok: true, path: res.filePath };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  });

  // Export the database as its two files — settings.sqlite and history.sqlite —
  // into a folder the user picks: a backup copy. Nothing switches over to them;
  // to have apps work on two files together, share a folder instead.
  handle("db:exportTwo", async () => {
    try {
      const res = await dialog.showOpenDialog(mainWindow, {
        title: "Export settings.sqlite and history.sqlite to…",
        properties: ["openDirectory", "createDirectory"],
      });
      if (res.canceled || !res.filePaths.length) return { canceled: true };
      const folder = res.filePaths[0];
      if (sharedFolder() && path.resolve(folder).toLowerCase() === path.resolve(sharedFolder()).toLowerCase()) {
        return { ok: false, error: "That's the shared folder the apps are using right now. Pick another folder for the copy." };
      }
      const files = sharedFiles(folder);
      if (fs.existsSync(files.settings) || fs.existsSync(files.history)) {
        const { response } = await dialog.showMessageBox(mainWindow, {
          type: "question",
          title: "Export 2 files",
          message: "That folder already has settings.sqlite or history.sqlite. Replace them?",
          detail: folder,
          buttons: ["Replace", "Cancel"],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        });
        if (response !== 0) return { canceled: true };
      }
      const { settings, history } = db.exportTwoFiles();
      fs.writeFileSync(files.settings, settings);
      fs.writeFileSync(files.history, history);
      return { ok: true, folder, settings: files.settings, history: files.history };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  });

  handle("db:connectedApps", () => connectedApps());

  // Inspect a .sqlite file (chosen by the user) and return its importable
  // contents grouped by type, so the renderer can let the user pick items.
  handle("db:scan", async () => {
    try {
      const res = await dialog.showOpenDialog(mainWindow, {
        title: "Choose a database to import from",
        properties: ["openFile"],
        filters: [{ name: "SQLite Database", extensions: ["sqlite", "sqlite3", "db"] }],
      });
      if (res.canceled || !res.filePaths.length) return { canceled: true };
      const filePath = res.filePaths[0];
      return { ok: true, filePath, groups: withoutLocalPrefs(db.scanFile(filePath)) };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  });

  // Merge only the selected items from a previously-scanned .sqlite file.
  handle("db:importSelected", async (_e, payload) => {
    try {
      const filePath = payload && payload.filePath;
      const selection = (payload && payload.selection) || {};
      if (!filePath) return { ok: false, error: "No source database chosen." };
      const counts = db.importSelected(filePath, selection);
      return { ok: true, counts };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  });

  // Import a .sqlite file, replacing the current database, then reload the UI so
  // every view re-reads the imported data. The local license is preserved.
  handle("db:import", async () => {
    try {
      const res = await dialog.showOpenDialog(mainWindow, {
        title: "Import database",
        properties: ["openFile"],
        filters: [{ name: "SQLite Database", extensions: ["sqlite", "sqlite3", "db"] }],
      });
      if (res.canceled || !res.filePaths.length) return { canceled: true };
      const buf = fs.readFileSync(res.filePaths[0]);
      db.importDb(buf);
      if (mainWindow && mainWindow.webContents) mainWindow.webContents.reload();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  });

  // ---- Shared database (Settings → Database) ----

  handle("db:location", () => ({
    shared: !!sharedFolder(),
    folder: sharedFolder(),
    path: db.getDbPath(),
    historyPath: db.getHistoryPath(),
    ownPath: ownDbPath(),
    ownExists: fs.existsSync(ownDbPath()),
  }));

  const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  const OWN_FOLDER_ERROR = "That is this app's own data folder. Pick a separate folder, such as C:\\RGenerator Shared.";
  const JOIN_DETAIL = "This app's own data stays in its folder as a backup. You can merge any of it in afterwards from Settings → Database.";

  // What a folder holds: "current" (settings.sqlite), "legacy" (the previous
  // version's one shared file), "empty", or "invalid" (files this app can't use).
  function folderState(folder) {
    const files = sharedFiles(folder);
    if (fs.existsSync(files.settings)) return db.looksLikeAppDb(files.settings) ? "current" : "invalid";
    if (fs.existsSync(files.history)) return "invalid"; // history without its settings
    const legacy = legacySharedFile(folder);
    if (legacy) return db.looksLikeAppDb(legacy) ? "legacy" : "invalid";
    return "empty";
  }

  async function switchToShared(folder, opts) {
    await openShared(folder, opts);
    localPrefs.sharedFolder = folder;
    delete localPrefs.sharedDatabase;
    saveLocalPrefs();
    afterDatabaseSwitch("This app now uses the shared database.");
    return { ok: true, folder };
  }

  // Start sharing: copy this app's database into a folder the user picks, as
  // settings.sqlite + history.sqlite, and switch to it. A folder that already
  // holds a shared database is offered for joining.
  handle("db:share", async () => {
    if (sharedFolder()) return { ok: false, error: "This app already uses a shared database." };
    const res = await dialog.showOpenDialog(mainWindow, {
      title: "Choose a folder for the shared database",
      properties: ["openDirectory", "createDirectory"],
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    const folder = res.filePaths[0];
    if (samePath(folder, app.getPath("userData"))) return { ok: false, error: OWN_FOLDER_ERROR };
    if (!(await confirmSharedLocation(sharedFiles(folder).settings))) return { canceled: true };
    try {
      const state = folderState(folder);
      if (state === "invalid") return { ok: false, error: "That folder has database files RGenerator can't use. Pick another folder." };
      if (state !== "empty") {
        const { response } = await dialog.showMessageBox(mainWindow, {
          type: "question",
          title: "Shared database",
          message: "This folder already has a shared database. Use it?",
          detail: `${folder}\n\n${JOIN_DETAIL}`,
          buttons: ["Use It", "Cancel"],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
        });
        if (response !== 0) return { canceled: true };
        return await switchToShared(folder);
      }
      return await switchToShared(folder, { seedFrom: db.getDbPath() });
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  });

  // Join a shared database another app already set up: pick its folder.
  handle("db:useShared", async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: "Choose the shared database folder",
      properties: ["openDirectory"],
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    const folder = res.filePaths[0];
    if (samePath(folder, app.getPath("userData"))) return { ok: false, error: OWN_FOLDER_ERROR };
    if (sharedFolder() && samePath(folder, sharedFolder())) return { ok: true, folder };
    const state = folderState(folder);
    if (state === "empty") return { ok: false, error: "There's no shared database in that folder. To create one there, use Export to Shared Folder (2 Files)… instead." };
    if (state === "invalid") return { ok: false, error: "That folder has database files RGenerator can't use." };
    if (!(await confirmSharedLocation(sharedFiles(folder).settings))) return { canceled: true };
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: "question",
      title: "Shared database",
      message: "Switch to the shared database?",
      detail: `${folder}\n\n${JOIN_DETAIL}`,
      buttons: ["Switch", "Cancel"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (response !== 0) return { canceled: true };
    try {
      return await switchToShared(folder);
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  });

  // Stop sharing: copy the shared database — settings and history — into this
  // app's own one-file database and use that. The app's previous own database is
  // kept, renamed, as a backup. Other apps keep using the shared folder.
  handle("db:stopSharing", async () => {
    if (!sharedFolder()) return { ok: false, error: "This app doesn't use a shared database." };
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: "question",
      title: "Stop sharing",
      message: "Stop using the shared database?",
      detail: "This app copies the shared settings and history into its own folder and uses that copy from now on. Other apps keep using the shared folder. This app's previous own database is kept as a backup.",
      buttons: ["Stop Sharing", "Cancel"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (response !== 0) return { canceled: true };
    try {
      const own = ownDbPath();
      const copy = db.exportAll();
      if (fs.existsSync(own)) {
        const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
        fs.renameSync(own, own.replace(/\.sqlite$/, `.before-unshare-${stamp}.sqlite`));
      }
      fs.writeFileSync(own, copy);
      db.openAt(own);
      delete localPrefs.sharedFolder;
      saveLocalPrefs();
      afterDatabaseSwitch("This app now uses its own database again.");
      return { ok: true, path: own };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  });

  // While sharing: list what this app's own database holds, for the same
  // pick-and-import panel as "Import selected data".
  handle("db:scanOwn", () => {
    const own = ownDbPath();
    if (!sharedFolder()) return { ok: false, error: "This app isn't using a shared database." };
    if (!fs.existsSync(own)) return { ok: false, error: "This app has no database of its own to merge." };
    try {
      return { ok: true, filePath: own, groups: withoutLocalPrefs(db.scanFile(own)) };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  });

  // While sharing: merge this app's own application history in. Entries the
  // shared database already has are skipped.
  handle("db:mergeOwnHistory", () => {
    const own = ownDbPath();
    if (!sharedFolder()) return { ok: false, error: "This app isn't using a shared database." };
    if (!fs.existsSync(own)) return { ok: false, error: "This app has no database of its own to merge." };
    return db.importApplications(own);
  });

  // Proxies (multiple; one active). Which one actually gets used — if any — is
  // decided by the connection mode, so every change re-resolves it.
  function applyActiveProxy() {
    applyApiConnection();
  }

  handle("proxy:list", () =>
    db.all(
      "SELECT id, name, url, port, username, password, is_active FROM proxies ORDER BY id DESC"
    )
  );

  // Currently active proxy (for the resume-build gating/badge).
  handle("proxy:active", () => {
    const row = db.get(
      "SELECT id, name, url, port FROM proxies WHERE is_active = 1 LIMIT 1"
    );
    return { enabled: !!row, proxy: row || null };
  });

  handle("proxy:add", (_e, d) => {
    if (!d || !(d.url || "").trim()) return { ok: false, error: "Proxy URL is required." };
    const existing = db.get("SELECT COUNT(*) AS c FROM proxies WHERE is_active = 1");
    const active = existing && existing.c > 0 ? 0 : 1; // first proxy becomes active
    const id = db.insert(
      `INSERT INTO proxies (name, url, port, username, password, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        (d.name || "").trim(),
        (d.url || "").trim(),
        (d.port || "").trim(),
        (d.username || "").trim(),
        (d.password || "").trim(),
        active,
        nowIso(),
      ]
    );
    if (active) applyActiveProxy();
    return { ok: true, id };
  });

  handle("proxy:setActive", (_e, id) => {
    db.run("UPDATE proxies SET is_active = 0");
    db.run("UPDATE proxies SET is_active = 1 WHERE id = ?", [id]);
    applyActiveProxy();
    return { ok: true };
  });

  handle("proxy:disable", () => {
    db.run("UPDATE proxies SET is_active = 0");
    applyApiConnection();
    return { ok: true };
  });

  handle("proxy:delete", (_e, id) => {
    const wasActive = db.get("SELECT is_active FROM proxies WHERE id = ?", [id]);
    db.run("DELETE FROM proxies WHERE id = ?", [id]);
    if (wasActive && wasActive.is_active) applyApiConnection(); // dropped active
    return { ok: true };
  });

  // Test any proxy config without saving it.
  handle("proxy:check", async (_e, d) => checkProxy(d));

  // Preferences (persist UI selections across restarts)
  handle("prefs:get", (_e, key) => ({ value: getPref(key) }));

  handle("prefs:set", (_e, d) => {
    setPref(d.key, d.value);
    // Switching Local IP ⇄ Proxy takes effect immediately for the API requests
    // (the browser session re-applies it the next time a window opens).
    if (d && (d.key === "chat_conn_mode" || d.key === "chat_proxy_id")) {
      applyApiConnection();
    }
    return { ok: true };
  });

  // What the whole app is currently using to reach the network. Drives the
  // generator's badge and its pre-flight check.
  handle("connection:status", () => {
    const mode = getPref("chat_conn_mode") || "direct";
    const conn = resolveConnection();
    return {
      mode,
      // A proxy run with no usable proxy is the one broken combination.
      ok: mode !== "proxy" || !!conn,
      proxy: conn ? { name: conn.name || "", url: conn.url, port: conn.port } : null,
    };
  });

  // Render a styled HTML resume into a hidden/visible BrowserWindow.
  async function htmlWindow(html, show) {
    const win = new BrowserWindow({
      width: 860,
      height: 1080,
      show,
      title: "Resume Preview",
      autoHideMenuBar: true,
      webPreferences: { sandbox: true, contextIsolation: true },
    });
    await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    return win;
  }

  // Preview the styled resume in its own window.
  handle("resume:preview", async (_e, html) => {
    await htmlWindow(html, true);
    return { ok: true };
  });

  // Render the styled resume to a PDF and save it to the chosen location.
  handle("resume:exportPdf", async (_e, d) => {
    const row = db.get("SELECT value FROM prefs WHERE key = 'download_location'");
    const dir = (row && row.value) || app.getPath("downloads");
    let win;
    try {
      win = await htmlWindow(d.html, false);
      const pdf = await win.webContents.printToPDF({
        printBackground: true,
        pageSize: "A4",
        // Use the CSS @page size/margins — gives correct A4 pagination and
        // uniform per-page margins regardless of the window size.
        preferCSSPageSize: true,
      });

      // Live re-render (colour / style / font change): overwrite the already
      // saved PDF in place — no new folder/file, no new application entry.
      if (d.overwritePath) {
        try {
          fs.mkdirSync(path.dirname(d.overwritePath), { recursive: true });
          fs.writeFileSync(d.overwritePath, pdf);
          return { ok: true, path: d.overwritePath, savedAt: nowStamp().display, overwritten: true };
        } catch (err) {
          return { ok: false, error: (err && err.message) || String(err) };
        }
      }

      // Save into a per-person folder; filename = Role + Company.
      const sani = (s) =>
        String(s || "")
          .replace(/[<>:"/\\|?*\x00-\x1f]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      const acct = db.get("SELECT name, main_stack FROM accounts WHERE id = ?", [d.accountId]);
      const person = sani(acct && acct.name) || "Resume";
      const stack = sani(acct && acct.main_stack);
      // Filename uses the target Role + Company from the job description.
      let role = sani(d.role);
      let company = sani(d.company);
      if (!role && !company) {
        // Fall back to the candidate's latest work history if no JD target.
        const work = db.get(
          "SELECT role_name, company_name FROM work_history WHERE account_id = ? ORDER BY COALESCE(sort_order, 9999) ASC, id ASC LIMIT 1",
          [d.accountId]
        );
        role = sani(work && work.role_name);
        company = sani(work && work.company_name);
      }
      // Is this the same company + role for this account as a prior generation?
      const recRole = (d.role || "").trim();
      const recCompany = (d.company || "").trim();
      const recCountry = (d.country || "").trim();
      // Dedicated duplicate-detection index: the Gemini JD extraction when
      // available (matchRole/matchCompany), else the display role/company.
      // The account name is stored alongside for a self-describing record.
      const matchRole = ((d.matchRole || d.role) || "").trim();
      const matchCompany = ((d.matchCompany || d.company) || "").trim();
      const matchAccount = sani(acct && acct.name);
      const dup = db.get(
        `SELECT id, pdf_path FROM applications
         WHERE account_id = ?
           AND LOWER(COALESCE(NULLIF(match_company, ''), company)) = LOWER(?)
           AND LOWER(COALESCE(NULLIF(match_role, ''), role)) = LOWER(?)
         LIMIT 1`,
        [d.accountId, matchCompany, matchRole]
      );
      const isDuplicate = !!dup && !!matchCompany && !!matchRole;

      // For a duplicate, overwrite the existing PDF in place (one resume per
      // company+role) rather than creating a new folder. New applications get a
      // fresh timestamped folder:
      //   <location>/<Account (Stack)>/<Date Time> - <Role> (<Company>)/<Account>.pdf
      const stamp = nowStamp();
      let folder, file;
      if (isDuplicate && dup.pdf_path) {
        file = dup.pdf_path;
        folder = path.dirname(file);
      } else {
        const personFolder = stack ? `${person} (${stack})` : person;
        const label = [role, company ? `(${company})` : ""].filter(Boolean).join(" ");
        const folderName = label ? `${stamp.folder} - ${label}` : stamp.folder;
        folder = path.join(dir, personFolder, folderName);
        file = path.join(folder, `${person}.pdf`);
      }
      fs.mkdirSync(folder, { recursive: true });

      // If the target file is open in another program (EBUSY/EPERM), fall back
      // to a numbered name so the export still succeeds.
      const base = person;
      let savedFile = null;
      for (let i = 1; i <= 50; i++) {
        try {
          fs.writeFileSync(file, pdf);
          savedFile = file;
          break;
        } catch (err) {
          if (["EBUSY", "EPERM", "EACCES"].includes(err.code) && i < 50) {
            file = path.join(folder, `${base} (${i + 1}).pdf`);
            continue;
          }
          throw err;
        }
      }
      if (!savedFile) return { ok: false, error: "Could not write the PDF file." };

      // Optionally render + save the cover letter in the same folder.
      let coverFile = null;
      if (d.coverHtml) {
        let cwin;
        try {
          cwin = await htmlWindow(d.coverHtml, false);
          const coverPdf = await cwin.webContents.printToPDF({
            printBackground: true,
            pageSize: "A4",
            preferCSSPageSize: true,
          });
          let cf = path.join(folder, "Cover Letter.pdf");
          for (let i = 1; i <= 50; i++) {
            try {
              fs.writeFileSync(cf, coverPdf);
              coverFile = cf;
              break;
            } catch (err) {
              if (["EBUSY", "EPERM", "EACCES"].includes(err.code) && i < 50) {
                cf = path.join(folder, `Cover Letter (${i + 1}).pdf`);
                continue;
              }
              throw err;
            }
          }
        } catch (e) {
          logCrash("coverLetter", e); // non-fatal: the resume still saved
        } finally {
          if (cwin) cwin.close();
        }
      }

      // Update the single existing entry for a duplicate; otherwise add a new one.
      const recRequestId = (d.requestId || "").trim();
      const recJd = (d.jobDescription || "").trim();
      const recResume = (d.resumeContent || "").trim();
      const recGptUrl = (d.gptUrl || "").trim();
      const recJobLink = (d.jobLink || "").trim();
      // Generate V3: the details extracted from the job post, stored alongside
      // the description so the history's "View Job Content" is self-contained.
      const recLocation = (d.jobLocation || "").trim();
      const recIndustry = (d.jobIndustry || "").trim();
      const recSalary = (d.salaryRange || "").trim();
      const recEmployment = (d.employmentType || "").trim();
      if (isDuplicate) {
        // Silently update the existing entry (the renderer handles the user-facing
        // duplicate confirmation before it gets here). Keep existing values when
        // this regeneration carries none (e.g. a V1 colour re-render).
        db.run(
          `UPDATE applications SET pdf_path = ?, country = ?, applied_at = ?,
             request_id = COALESCE(NULLIF(?, ''), request_id),
             job_description = COALESCE(NULLIF(?, ''), job_description),
             resume_content = COALESCE(NULLIF(?, ''), resume_content),
             gpt_url = COALESCE(NULLIF(?, ''), gpt_url),
             job_link = COALESCE(NULLIF(?, ''), job_link),
             location = COALESCE(NULLIF(?, ''), location),
             industry = COALESCE(NULLIF(?, ''), industry),
             salary_range = COALESCE(NULLIF(?, ''), salary_range),
             employment_type = COALESCE(NULLIF(?, ''), employment_type),
             match_role = COALESCE(NULLIF(?, ''), match_role),
             match_company = COALESCE(NULLIF(?, ''), match_company),
             match_account = COALESCE(NULLIF(?, ''), match_account)
           WHERE id = ?`,
          [savedFile, recCountry, nowIso(), recRequestId, recJd, recResume, recGptUrl, recJobLink,
           recLocation, recIndustry, recSalary, recEmployment,
           matchRole, matchCompany, matchAccount, dup.id]
        );
      } else {
        db.insert(
          `INSERT INTO applications (account_id, role, company, country, position, request_id, job_description, resume_content, gpt_url, job_link, location, industry, salary_range, employment_type, match_role, match_company, match_account, applied_at, pdf_path)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [d.accountId, recRole, recCompany, recCountry, recRole, recRequestId, recJd, recResume, recGptUrl, recJobLink,
           recLocation, recIndustry, recSalary, recEmployment,
           matchRole, matchCompany, matchAccount, nowIso(), savedFile]
        );
      }
      return { ok: true, path: savedFile, coverPath: coverFile, duplicate: isDuplicate, savedAt: stamp.display };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    } finally {
      if (win) win.close();
    }
  });

  // Reveal a saved resume PDF in the OS file manager (folder opens, file selected).
  handle("pdf:reveal", (_e, filePath) => {
    if (!filePath) return { ok: false, error: "No file to open." };
    if (!fs.existsSync(filePath)) return { ok: false, error: "The file no longer exists." };
    shell.showItemInFolder(filePath);
    return { ok: true };
  });

  // Open a saved resume PDF directly in the OS default PDF viewer.
  handle("pdf:open", async (_e, filePath) => {
    if (!filePath) return { ok: false, error: "No file to open." };
    if (!fs.existsSync(filePath)) return { ok: false, error: "The file no longer exists." };
    const err = await shell.openPath(filePath);
    return { ok: !err, error: err || undefined };
  });

  // Read a saved PDF's bytes (base64) so the renderer can show it inline in the
  // built-in PDF viewer (real, paginated A4 pages) via a blob URL.
  handle("pdf:read", (_e, filePath) => {
    try {
      if (!filePath || !fs.existsSync(filePath)) return { ok: false };
      return { ok: true, base64: fs.readFileSync(filePath).toString("base64") };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  });

  // Resume generation
  handle("resume:generate", async (_e, payload) => {
    const keyRow =
      db.get("SELECT api_key, provider, model FROM api_keys WHERE kind = 'v1' AND is_active = 1 LIMIT 1") ||
      db.get("SELECT api_key, provider, model FROM api_keys WHERE kind = 'v1' ORDER BY id DESC LIMIT 1");
    const accountId = payload && payload.accountId;
    const personal = accountId
      ? db.get("SELECT * FROM accounts WHERE id = ?", [accountId])
      : null;
    const work = accountId
      ? db.all(
          WORK_BY_ACCOUNT,
          [accountId]
        )
      : [];
    const education = accountId
      ? db.all(
          "SELECT * FROM education WHERE account_id = ? ORDER BY id ASC",
          [accountId]
        )
      : [];
    const projects = accountId
      ? db.all(
          "SELECT * FROM projects WHERE account_id = ? ORDER BY id ASC",
          [accountId]
        )
      : [];
    if (!personal) throw new Error("Select an account to build a resume for.");
    // Always apply the selected prompt; fall back to the active one.
    const instrId = payload && payload.instructionId;
    const instrRow =
      (instrId
        ? db.get("SELECT body FROM instructions WHERE id = ?", [instrId])
        : null) || db.get("SELECT body FROM instructions WHERE is_active = 1 LIMIT 1");
    const out = await generateResume({
      apiKey: keyRow && keyRow.api_key,
      provider: keyRow && keyRow.provider,
      model: keyRow && keyRow.model,
      personal,
      work,
      education,
      projects,
      jobDescription: payload && payload.jobDescription,
      style: payload && payload.style,
      instruction: instrRow && instrRow.body,
      extraInfo: payload && payload.extraInfo,
    });
    return out; // { text, jobRole, jobCompany }
  });

  // ---- Generate V2: ChatGPT-in-a-browser via a clipboard handshake ---------
  // V2 builds the SAME resume prompt as V1 but, instead of calling the Gemini
  // API, hands the prompt to the user's signed-in ChatGPT (in an embedded,
  // session-persistent browser). A unique ID wraps the expected reply so the
  // app can recognise it on the clipboard and feed it into the same renderer.

  const CHAT_PARTITION = "persist:chatgpt";
  // A real Chrome UA so Google OAuth doesn't reject the embedded browser as
  // "not secure"; Electron's default UA contains "Electron" and gets blocked.
  const CHAT_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
  let chatWin = null;
  // Every in-flight "waiting for the ChatGPT reply" watcher. A Set rather than a
  // single slot, so starting a second generation (V2 and V3 are both mounted)
  // no longer silently cancels the first one's wait.
  const clipWatches = new Set(); // each { resolve }
  let chatProxyAuth = null; // { username, password } for the embedded browser's proxy
  let chatProxyKey = null;  // last-applied session proxy ("direct" | "host:port") to avoid redundant setProxy calls

  // Injected into the ChatGPT page: a floating button that saves the current
  // page as the Project Home via the preload bridge (window.careerva.saveHome).
  const CHAT_SAVE_BUTTON_JS = `(function(){
    try {
      if (!window.careerva || document.getElementById('careerva-savehome')) return;
      var b = document.createElement('button');
      b.id = 'careerva-savehome';
      var idle = '📌 Save as Project Home';
      b.textContent = idle;
      b.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:10px 14px;border-radius:10px;border:none;background:#4f8cff;color:#fff;font:600 13px Segoe UI,Arial,sans-serif;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.4)';
      b.onclick = async function(){
        b.textContent = 'Saving…';
        try { var r = await window.careerva.saveHome(); b.textContent = (r && r.ok) ? 'Saved ✓' : 'Could not save'; }
        catch(e){ b.textContent = 'Could not save'; }
        setTimeout(function(){ b.textContent = idle; }, 1600);
      };
      document.body.appendChild(b);
    } catch(e){}
  })();`;

  const CHAT_HOME_DEFAULT = "https://chatgpt.com/";
  // The URL the embedded browser opens at — a user-saved ChatGPT "Project Home",
  // or the default ChatGPT site when none is saved.
  function chatHomeUrl() {
    return String(getPref("chatgpt_home_url") || "").trim() || CHAT_HOME_DEFAULT;
  }

  // Route the embedded ChatGPT browser per the V2 connection choice:
  //   chat_conn_mode = "direct" → local IP (no proxy)
  //   chat_conn_mode = "proxy"  → the proxy chosen in chat_proxy_id
  //                               (falls back to the active proxy if unset)
  // Applied to the persistent chat session, so the ChatGPT page and its OAuth
  // pop-ups all use the same connection.
  async function applyChatProxy() {
    const ses = session.fromPartition(CHAT_PARTITION);
    // Same resolver the AI requests use, so the browser and the API can never
    // end up on different connections.
    const active = resolveConnection();
    applyApiConnection();

    if (!active || !String(active.url || "").trim()) {
      chatProxyAuth = null;
      // Skip the (potentially slow) setProxy call when nothing changed.
      if (chatProxyKey !== "direct") {
        try { await ses.setProxy({ mode: "direct" }); } catch (_) {}
        chatProxyKey = "direct";
      }
      return;
    }
    const host = String(active.url).trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    const port = String(active.port || "").trim();
    const server = port ? `${host}:${port}` : host;
    const username = String(active.username || "").trim();
    const password = String(active.password || "").trim();
    chatProxyAuth = username || password ? { username, password } : null;
    if (chatProxyKey !== server) {
      try { await ses.setProxy({ proxyRules: server }); } catch (_) {}
      chatProxyKey = server;
    }
  }

  // Generate V3: load a job-post URL in a hidden browser window (so JS-rendered
  // pages work), scrape its text + any schema.org JobPosting JSON-LD, then have
  // Gemini extract the structured posting. Uses the same session/proxy/UA as the
  // embedded ChatGPT browser.
  handle("jd:fromLink", async (_e, url) => {
    const link = String(url || "").trim();
    if (!/^https?:\/\//i.test(link)) {
      return { ok: false, error: "Enter a valid job-post link starting with http(s)://" };
    }
    const gemKey =
      db.get("SELECT api_key, model FROM api_keys WHERE kind = 'v2' AND is_active = 1 LIMIT 1") ||
      db.get("SELECT api_key, model FROM api_keys WHERE kind = 'v1' AND provider = 'gemini' AND is_active = 1 LIMIT 1") ||
      db.get("SELECT api_key, model FROM api_keys WHERE kind = 'v1' AND provider = 'gemini' ORDER BY id DESC LIMIT 1");
    try { await applyChatProxy(); } catch (_) {}
    let win = null;
    try {
      win = new BrowserWindow({
        show: false,
        webPreferences: {
          partition: CHAT_PARTITION,
          backgroundThrottling: false,
          nodeIntegration: false,
          contextIsolation: true,
        },
      });
      try { win.webContents.setUserAgent(CHAT_UA); } catch (_) {}

      // Job boards sit behind the same bot protection as ChatGPT, so a proxy IP
      // that gets refused fails EVERY link identically. Load through the chosen
      // connection, and if that fails while proxied, retry once on the local IP
      // rather than reporting a bare "couldn't read this page".
      const loadOnce = async () => {
        try {
          await win.loadURL(link);
          return null;
        } catch (e) {
          const desc = (e && (e.message || String(e))) || "network error";
          // Electron prefixes these with the error code, e.g.
          // "ERR_TUNNEL_CONNECTION_FAILED (-111) loading 'https://…'".
          return desc.replace(/\s+loading\s+'[^']*'\s*$/i, "").trim();
        }
      };
      let loadErr = await loadOnce();
      let retriedDirect = false;
      if (loadErr && chatProxyKey && chatProxyKey !== "direct") {
        retriedDirect = true;
        try {
          await session.fromPartition(CHAT_PARTITION).setProxy({ mode: "direct" });
          chatProxyKey = "direct";
          chatProxyAuth = null;
        } catch (_) {}
        loadErr = await loadOnce();
      }
      if (loadErr) {
        return {
          ok: false,
          error:
            `Couldn't load the job post (${loadErr}).` +
            (retriedDirect
              ? " This was retried on your local IP and still failed, so check your internet connection."
              : " Check your internet connection."),
        };
      }
      if (retriedDirect) {
        notify("Proxy couldn't reach the job post", "Read it on your local IP instead.");
      }
      // Adaptive wait: JS-rendered job pages fill the header/body AFTER the
      // initial load, so poll until real content appears (an H1 with text, a
      // JobPosting JSON-LD, or a substantial body) instead of a fixed delay.
      const readyCheck =
        "(() => { try {" +
        "  const h = document.querySelector('h1'); const h1=((h&&(h.innerText||h.textContent))||'').trim();" +
        "  const ld = !!document.querySelector('script[type=\"application/ld+json\"]');" +
        "  const tlen = ((document.body&&document.body.innerText)||'').replace(/\\s+/g,' ').trim().length;" +
        "  return { h1len: h1.length, ld: ld, tlen: tlen };" +
        "} catch(e){ return { h1len:0, ld:false, tlen:0 }; } })()";
      let ready = false;
      for (let i = 0; i < 24; i++) { // up to ~14s
        await new Promise((r) => setTimeout(r, 600));
        let st = null;
        try { st = await win.webContents.executeJavaScript(readyCheck, true); } catch (_) {}
        if (st && ((st.h1len > 0 && st.tlen > 400) || st.ld || st.tlen > 1500)) { ready = true; break; }
      }
      // Brief settle so late-rendered chips (location, employment type) land.
      await new Promise((r) => setTimeout(r, ready ? 500 : 0));
      const scrape =
        "(() => {" +
        "  const out = { title: document.title || '', h1: '', metas: {}, ld: [], text: '' };" +
        "  try { const h = document.querySelector('h1'); out.h1 = h ? ((h.innerText||h.textContent||'').trim()) : ''; } catch(e){}" +
        "  try {" +
        "    const want = ['description','og:title','og:description','og:site_name','twitter:title','twitter:description'];" +
        "    document.querySelectorAll('meta').forEach(m => { const k=((m.getAttribute('property')||m.getAttribute('name')||'')).toLowerCase(); if(want.indexOf(k)!==-1 && !out.metas[k]){ out.metas[k]=(m.getAttribute('content')||'').trim(); } });" +
        "  } catch(e){}" +
        "  try { document.querySelectorAll('script[type=\"application/ld+json\"]').forEach(s => { const t=(s.textContent||'').trim(); if(t) out.ld.push(t); }); } catch(e){}" +
        // Whole visible page (NOT just <main>) — the role title/location often sit
        // in the page header or a sidebar outside <main>.
        "  try { out.text = (document.body.innerText || '').replace(/\\n{3,}/g,'\\n\\n'); } catch(e){}" +
        "  return out;" +
        "})()";
      const data = await win.webContents.executeJavaScript(scrape, true);
      const rawText = (data && data.text ? String(data.text) : "").trim();
      const metas = (data && data.metas) || {};
      const metaText = Object.keys(metas).map((k) => `${k}: ${metas[k]}`).join("\n");

      const empty = {
        role: "", company: "", country: "", location: "", salaryRange: "",
        industry: "", employmentType: "", jobDescription: "",
      };
      let out = empty;
      let source = "none";

      // Layer 1: structured schema.org JobPosting — highest fidelity, no AI.
      const ld = parseJobPostingLd(data && data.ld);
      if (ld) { out = { ...empty, ...buildFromLd(ld) }; source = "structured"; }

      // Layer 2: Gemini fills EVERY still-missing field (role, location, salary…),
      // not just the description — the structured block often omits some of these.
      const coreMissing =
        !out.role || !out.company || !out.country || !out.location ||
        !out.salaryRange || !out.industry || !out.employmentType || !out.jobDescription;
      // Why the detail fields came back empty, when they did. This layer used to
      // swallow its errors, so a dead key or an unreachable API looked exactly
      // like a page that simply had no details to find.
      let aiNote = "";
      if (coreMissing && !(gemKey && gemKey.api_key)) {
        aiNote = "No Gemini key is set, so only the page's own structured data could be read. Add one in Settings → API (V2) to fill in the missing details.";
      }
      if (coreMissing && gemKey && gemKey.api_key) {
        try {
          const g = await extractJobPost({
            apiKey: gemKey.api_key, model: gemKey.model,
            pageText: rawText, jsonLd: (data && data.ld ? data.ld.join("\n") : ""),
            title: data && data.title, h1: data && data.h1, metaText, url: link,
          });
          out = {
            role: out.role || g.role, company: out.company || g.company,
            country: out.country || g.country, location: out.location || g.location,
            salaryRange: out.salaryRange || g.salaryRange, industry: out.industry || g.industry,
            employmentType: out.employmentType || g.employmentType,
            jobDescription: out.jobDescription || g.jobDescription,
          };
          if (g.role || g.jobDescription) source = ld ? "structured+ai" : "ai";
        } catch (e) {
          aiNote = `The AI read of this page failed (${(e && e.message) || e}). Details may be incomplete.`;
        }
      }

      // No-AI heuristics: fill still-empty role/company from the page heading and
      // meta tags (title often reads "Role at Company | Board").
      if (!out.role) out.role = (data && data.h1) || "";
      if (!out.role && metas["og:title"]) out.role = metas["og:title"];
      if (!out.company && metas["og:site_name"]) out.company = metas["og:site_name"];

      // Layer 3: last resort — show the raw page text so you always see something.
      let usedRaw = false;
      if (!out.jobDescription && rawText) {
        out.jobDescription = rawText.slice(0, 20000);
        source = "raw";
        usedRaw = true;
      }

      if (!out.jobDescription) {
        return { ok: false, error: "Couldn't read this page (it may require sign-in or block automated access). Try opening it in the ChatGPT browser tab, sign in, or paste the description manually." };
      }

      // Cache it (their SQLite idea) — url + raw + structured fields.
      try {
        db.insert(
          `INSERT INTO job_posts (url, role, company, country, location, salary_range, industry, employment_type, job_description, raw_text, source, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [link, out.role, out.company, out.country, out.location, out.salaryRange,
           out.industry, out.employmentType, out.jobDescription, rawText.slice(0, 40000), source, nowIso()]
        );
      } catch (_) {}

      return { ok: true, url: link, source, usedRaw, aiNote, ...out };
    } catch (e) {
      return { ok: false, error: (e && e.message) || "Could not load that job post." };
    } finally {
      try { if (win && !win.isDestroyed()) win.close(); } catch (_) {}
    }
  });

  // Supply proxy credentials when the embedded browser's proxy requires auth.
  app.on("login", (event, _webContents, _request, authInfo, callback) => {
    if (authInfo && authInfo.isProxy && chatProxyAuth) {
      event.preventDefault();
      callback(chatProxyAuth.username, chatProxyAuth.password);
    }
  });

  // Build the JSON prompt the user pastes into ChatGPT. It carries a unique
  // request_id and a job_ref (job-description fingerprint) so the reply can be
  // verified as belonging to THIS request and THIS job description. If a V2
  // (Gemini) key is active, the prompt is refined by Gemini before copying.
  handle("chatgpt:buildPrompt", async (_e, payload) => {
    const accountId = payload && payload.accountId;
    const personal = accountId ? db.get("SELECT * FROM accounts WHERE id = ?", [accountId]) : null;
    if (!personal) throw new Error("Select an account to build a resume for.");
    const work = db.all(WORK_BY_ACCOUNT, [accountId]);
    const education = db.all("SELECT * FROM education WHERE account_id = ? ORDER BY id ASC", [accountId]);
    const projects = db.all("SELECT * FROM projects WHERE account_id = ? ORDER BY id ASC", [accountId]);
    const instrId = payload && payload.instructionId;
    const instrRow =
      (instrId ? db.get("SELECT body FROM instructions WHERE id = ?", [instrId]) : null) ||
      db.get("SELECT body FROM instructions WHERE is_active = 1 LIMIT 1");

    // Short unique handshake id (no Math.random dependency at import time).
    const id = (Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36)).slice(-10);
    const { prompt: basePrompt, jobRef } = buildPromptJson(
      personal, work, education, projects,
      payload && payload.jobDescription, payload && payload.style, instrRow && instrRow.body, id,
      payload && payload.extraInfo
    );

    // Optional refinement via the active V2 Gemini key (Settings → API (V2)).
    // refineV2Prompt falls back to basePrompt on any error, and never disturbs
    // the verification fields, so this is always safe.
    const v2Key = db.get(
      "SELECT api_key, model FROM api_keys WHERE kind = 'v2' AND is_active = 1 LIMIT 1"
    );
    let prompt = basePrompt;
    let refined = false;
    if (v2Key && v2Key.api_key) {
      const out = await refineV2Prompt({ promptText: basePrompt, apiKey: v2Key.api_key, model: v2Key.model });
      if (out && out !== basePrompt) { prompt = out; refined = true; }
    }

    // Extract the job title + company from the JD (fast Gemini call) so the app
    // can check for a duplicate application BEFORE the ChatGPT generation. Uses
    // the V2 key if set, otherwise an active/any V1 Gemini key.
    const gemKey =
      (v2Key && v2Key.api_key ? v2Key : null) ||
      db.get("SELECT api_key, model FROM api_keys WHERE kind = 'v1' AND provider = 'gemini' AND is_active = 1 LIMIT 1") ||
      db.get("SELECT api_key, model FROM api_keys WHERE kind = 'v1' AND provider = 'gemini' ORDER BY id DESC LIMIT 1");
    let target = { role: "", company: "", country: "" };
    if (gemKey && gemKey.api_key) {
      try {
        target = await extractJdTarget({
          apiKey: gemKey.api_key, model: gemKey.model,
          jobDescription: payload && payload.jobDescription,
        });
      } catch (_) {}
    }

    // Copy the prompt to the clipboard from the main process. Electron's native
    // clipboard is more reliable than navigator.clipboard in the renderer (which
    // can silently fail on focus/permission), so the prompt is guaranteed to be
    // on the clipboard by the time the renderer gets this reply. The reply
    // watcher ignores a clipboard value equal to the prompt, so this is safe.
    //
    // Not under a profile, though: the clipboard is a single system-wide slot, so
    // copies running side by side would overwrite each other's prompt seconds
    // apart and a manual Ctrl+V would paste whichever finished last. The prompt
    // reaches ChatGPT through trusted input, not the clipboard, so nothing in the
    // run depends on this — and "Copy prompt" in the ChatGPT tab puts THIS
    // instance's prompt there on demand.
    let copied = false;
    const clipboardSkipped = !!profileName;
    if (!clipboardSkipped) {
      try { clipboard.writeText(prompt); copied = true; } catch (_) {}
    }
    return { id, prompt, copied, clipboardSkipped, jobRef, refined, target };
  });

  // Prepare the persistent ChatGPT session for the embedded <webview> tab:
  // set the UA and apply the current browser-connection proxy, then return what
  // the renderer needs to configure and load the webview.
  handle("chatgpt:sessionInfo", async () => {
    try { session.fromPartition(CHAT_PARTITION).setUserAgent(CHAT_UA); } catch (_) {}
    try { await applyChatProxy(); } catch (_) {}
    return { ua: CHAT_UA, partition: CHAT_PARTITION, homeUrl: chatHomeUrl(), proxied: chatProxyKey && chatProxyKey !== "direct" };
  });

  // Fallback for the embedded webview: drop the proxy and use the local IP
  // (ChatGPT/Cloudflare frequently blocks proxy IPs). The renderer reloads after.
  handle("chatgpt:sessionDirect", async () => {
    try { await session.fromPartition(CHAT_PARTITION).setProxy({ mode: "direct" }); } catch (_) {}
    chatProxyKey = "direct";
    chatProxyAuth = null;
    return { ok: true };
  });

  // Write text to the system clipboard from the renderer (used to reliably place
  // the auto-captured ChatGPT reply JSON on the clipboard for the reply watcher).
  handle("clipboard:write", (_e, text) => {
    try { clipboard.writeText(String(text == null ? "" : text)); return { ok: true }; }
    catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
  });

  // Read the clipboard back, so the copy step can tell whether ChatGPT's own
  // Copy button actually put anything there (compare before/after the click).
  handle("clipboard:read", () => {
    try { return { ok: true, text: clipboard.readText() || "" }; }
    catch (e) { return { ok: false, text: "", error: (e && e.message) || String(e) }; }
  });

  // Click a point inside the embedded ChatGPT WebView with a REAL input event.
  //
  // Everything the page script dispatches itself is synthetic: isTrusted false,
  // and it confers no user activation. ChatGPT's Copy handler calls
  // navigator.clipboard.writeText(), which Chromium can refuse without an
  // activation — so a click could land and still copy nothing. sendInputEvent
  // comes from the browser process instead, so the guest sees an ordinary
  // trusted mouse click, indistinguishable from the user's.
  //
  // Coordinates are CSS pixels in the guest's own viewport (what
  // getBoundingClientRect returns there), NOT screen coordinates — the WebView
  // can stay parked off-screen and still receive this.
  handle("chat:sendClick", (_e, d) => {
    try {
      const wc = webContents.fromId(Number(d && d.id));
      if (!wc || wc.isDestroyed()) return { ok: false, error: "no-webcontents" };
      const px = Math.round(Number(d && d.x) || 0);
      const py = Math.round(Number(d && d.y) || 0);
      if (px <= 0 || py <= 0) return { ok: false, error: "bad-coordinates" };
      // Chromium wants the pointer over the target before the press, or the
      // button never reaches its hover/active state and some handlers no-op.
      wc.sendInputEvent({ type: "mouseMove", x: px, y: py });
      wc.sendInputEvent({ type: "mouseDown", x: px, y: py, button: "left", clickCount: 1 });
      wc.sendInputEvent({ type: "mouseUp", x: px, y: py, button: "left", clickCount: 1 });
      return { ok: true, x: px, y: py };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  });

  // Windows system notification when a resume finishes generating. Clicking it
  // brings the app window to the front.
  // Append one line describing what the copy step actually saw in the page, so
  // the DOM can be inspected after a real run instead of guessed at.
  // Which profile this window is running, so the UI can label itself and the
  // generator can tell whether it is sharing the desktop with other copies.
  handle("app:profile", () => ({
    profile: shownProfile,
    dir: app.getPath("userData"),
    multi: !!profileName,
    sharedDatabase: sharedFolder(),
  }));

  handle("log:copyDiag", (_e, line) => {
    try {
      fs.appendFileSync(
        path.join(app.getPath("userData"), "copy-diag.log"),
        `[${new Date().toISOString()}] ${String(line || "")}\n`
      );
    } catch (_) {}
    return { ok: true };
  });

  handle("notify:resumeDone", (_e, d) => {
    try {
      const account = ((d && d.account) || "").trim();
      const role = ((d && d.role) || "").trim();
      const company = ((d && d.company) || "").trim();
      // Four lines: title (with check icon), then Account / Company / Job Title,
      // each on its own new line.
      const body = [account, company, role].filter(Boolean).join("\n") || "Your tailored resume is ready.";
      const n = new Notification({ title: "✅ Resume Prepared", body });
      n.on("click", () => {
        try {
          if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            // Windows blocks a background app from stealing focus; toggling
            // alwaysOnTop forces the window to the very top, then we release it
            // so it behaves normally afterwards.
            mainWindow.setAlwaysOnTop(true);
            mainWindow.focus();
            mainWindow.moveTop();
            mainWindow.setAlwaysOnTop(false);
            try { app.focus({ steal: true }); } catch (_) {}
          }
        } catch (_) {}
      });
      n.show();
    } catch (_) {}
    return { ok: true };
  });

  // Open (or focus) the embedded, session-persistent ChatGPT browser (window).
  // Still used by the Application history "Open GPT".
  handle("chatgpt:open", (_e, opts) => openChatWindow(opts));

  async function openChatWindow(opts) {
    const fresh = !!(opts && opts.fresh);
    const noSaveHome = !!(opts && opts.noSaveHome);
    // A specific URL (e.g. an application's saved conversation) overrides the
    // Project Home for this open.
    const targetUrl = opts && /^https?:\/\//i.test(opts.url || "") ? opts.url : chatHomeUrl();
    const ses = session.fromPartition(CHAT_PARTITION);
    ses.setUserAgent(CHAT_UA);
    // Pick up the latest active proxy each time the browser is opened/focused —
    // but NEVER let a proxy error prevent the window from opening.
    try { await applyChatProxy(); } catch (_) {}

    // Fresh open (used by Generate): close the existing window first so a brand-
    // new one always opens. Detach chatWin before destroying so the old window's
    // "closed" handler is a no-op (see the identity guard below).
    if (fresh && chatWin && !chatWin.isDestroyed()) {
      const old = chatWin;
      chatWin = null;
      try { old.destroy(); } catch (_) {}
    }
    // Not fresh, and one is already open → just focus it.
    if (!fresh && chatWin && !chatWin.isDestroyed()) {
      chatWin.show();
      chatWin.focus();
      return { ok: true };
    }

    // Open on the SAME display as the main app window (multi-monitor setups),
    // centered within that display's work area.
    const winOpts = {
      width: 1180, height: 860, title: "ChatGPT — RGenerator V2",
      autoHideMenuBar: true,
      show: true,
      webPreferences: {
        partition: CHAT_PARTITION, contextIsolation: true, sandbox: true,
        preload: path.join(__dirname, "chatPreload.js"),
      },
    };
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const wa = screen.getDisplayMatching(mainWindow.getBounds()).workArea;
        const w = Math.min(winOpts.width, wa.width);
        const h = Math.min(winOpts.height, wa.height);
        winOpts.width = w;
        winOpts.height = h;
        winOpts.x = Math.round(wa.x + (wa.width - w) / 2);
        winOpts.y = Math.round(wa.y + (wa.height - h) / 2);
      }
    } catch (_) {}
    const win = new BrowserWindow(winOpts);
    chatWin = win;
    win.webContents.setUserAgent(CHAT_UA);
    // Inject a floating "Save as Project Home" button into the ChatGPT page so
    // the location can be saved from inside the browser window itself. Skipped
    // when reopening an application's conversation from the history (noSaveHome).
    if (!noSaveHome) {
      win.webContents.on("did-finish-load", () => {
        let url = "";
        try { url = win.webContents.getURL() || ""; } catch (_) {}
        if (!/^https?:\/\//i.test(url)) return; // skip the local error page
        win.webContents.executeJavaScript(CHAT_SAVE_BUTTON_JS).catch(() => {});
      });
    }
    // Keep OAuth pop-ups (Google sign-in) inside the same persistent session.
    win.webContents.setWindowOpenHandler(() => ({
      action: "allow",
      overrideBrowserWindowOptions: {
        autoHideMenuBar: true,
        webPreferences: { partition: CHAT_PARTITION, contextIsolation: true, sandbox: true },
      },
    }));
    // Closing the CURRENT window aborts any in-flight wait. The identity guard
    // means a superseded (destroyed-on-fresh-open) window never clears state.
    win.on("closed", () => {
      if (chatWin !== win) return;
      chatWin = null;
      [...clipWatches].forEach((w) => w.resolve({ ok: false, closed: true }));
      clipWatches.clear();
    });
    // If the page can't load AND we were routing through a proxy, automatically
    // retry once on the LOCAL IP — ChatGPT/Cloudflare frequently blocks proxy
    // IPs ("Unable to load site"). This keeps V2 working without the user having
    // to hunt through settings. If it still fails, show a readable message.
    let triedDirect = false;
    win.webContents.on("did-fail-load", async (_e2, errorCode, errorDesc, _url, isMainFrame) => {
      if (!isMainFrame || errorCode === -3 /* ERR_ABORTED (redirects) */) return;
      if (!triedDirect && chatProxyKey && chatProxyKey !== "direct") {
        triedDirect = true;
        chatProxyAuth = null;
        try { await ses.setProxy({ mode: "direct" }); chatProxyKey = "direct"; } catch (_) {}
        notify("Proxy couldn't reach ChatGPT", "Retrying on your local IP…");
        try { if (!win.isDestroyed()) win.loadURL(targetUrl); } catch (_) {}
        return;
      }
      const viaProxy = !!(chatProxyKey && chatProxyKey !== "direct");
      const html =
        "<html><body style=\"font-family:Segoe UI,Arial,sans-serif;background:#111;color:#eee;padding:40px;line-height:1.5\">" +
        "<h2>Couldn't load ChatGPT</h2>" +
        `<p>The page failed to load (${errorDesc || "network error"}).</p>` +
        (triedDirect
          ? "<p>This was retried on your local IP and still failed, so the proxy is probably not the cause — check your internet connection.</p>"
          : viaProxy
          ? "<p>The request went through your proxy. ChatGPT sits behind Cloudflare, which often refuses datacenter proxy IPs — test the proxy in <b>Settings → Proxy</b>, or set <b>Connection</b> to <b>Local IP</b>.</p>"
          : "<p>Check your internet connection, then reopen this window.</p>") +
        "</body></html>";
      try { if (!win.isDestroyed()) win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html)); } catch (_) {}
    });
    // Start loading but DON'T await it — the window is already visible and the
    // app can proceed immediately; the page finishes loading in the background.
    win.loadURL(targetUrl).catch(() => {});
    return { ok: true };
  }

  // From the Application history: reopen the exact ChatGPT conversation where
  // this resume was generated (it already contains the app's prompt + the resume
  // result), so the user can continue asking follow-up questions in that thread.
  handle("application:openGpt", async (_e, id) => {
    const ap = db.get("SELECT gpt_url FROM applications WHERE id = ?", [id]);
    if (!ap) return { ok: false, error: "Application not found." };
    const url = (ap.gpt_url || "").trim();
    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, error: "No ChatGPT conversation was saved for this application (generated before this feature, or the reply was pasted from elsewhere). Re-generate it to enable Open GPT." };
    }
    await openChatWindow({ fresh: true, url, noSaveHome: true });
    return { ok: true };
  });

  // Save the current embedded-browser page (or an explicit URL) as the ChatGPT
  // "Project Home" the browser opens at from now on.
  handle("chatgpt:saveHome", (_e, url) => {
    let target = String(url || "").trim();
    if (!target && chatWin && !chatWin.isDestroyed()) {
      try { target = chatWin.webContents.getURL() || ""; } catch (_) {}
    }
    target = target.trim();
    if (!/^https?:\/\//i.test(target)) {
      return { ok: false, error: "Open the ChatGPT page you want (e.g. your Project) first, then save it as Project Home." };
    }
    setPref("chatgpt_home_url", target);
    return { ok: true, url: target };
  });

  // Current saved Project Home ("" = the default ChatGPT site).
  handle("chatgpt:getHome", () => ({ url: getPref("chatgpt_home_url") || "", default: CHAT_HOME_DEFAULT }));

  // Clear the saved Project Home (revert to the default ChatGPT site).
  handle("chatgpt:clearHome", () => {
    deletePref("chatgpt_home_url");
    return { ok: true };
  });

  // Called from the in-browser "Save as Project Home" button: save the URL the
  // embedded browser is currently showing.
  handle("chatgpt:saveHomeFromBrowser", () => {
    if (!chatWin || chatWin.isDestroyed()) return { ok: false };
    let url = "";
    try { url = chatWin.webContents.getURL() || ""; } catch (_) {}
    url = url.trim();
    if (!/^https?:\/\//i.test(url)) return { ok: false };
    setPref("chatgpt_home_url", url);
    notify("Project Home saved", url);
    // Let the app update its displayed Project Home value.
    if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send("chatgpt:homeChanged", url);
    }
    return { ok: true, url };
  });

  // Is the user already signed in (so V2 won't make them log in again)?
  handle("chatgpt:signedIn", async () => {
    try {
      const ses = session.fromPartition(CHAT_PARTITION);
      const cookies = await ses.cookies.get({ domain: "chatgpt.com" });
      const signedIn = cookies.some((c) => /session-token|__Secure-next-auth/i.test(c.name));
      return { signedIn };
    } catch (_) {
      return { signedIn: false };
    }
  });

  // Poll the clipboard until the ChatGPT reply (a JSON object echoing the unique
  // request_id and the job_ref) appears, verify it belongs to this request and
  // job description, then parse it into the same { text, jobRole, … } shape as
  // V1. Only a verified reply resolves ok — so the app never builds the final
  // resume from stale or mismatched clipboard content.
  handle("chatgpt:awaitClipboard", (_e, d) => {
    const id = d && d.id;
    const jobRef = d && d.jobRef;
    const promptTrim = String((d && d.prompt) || "").trim();
    const startedAt = Date.now();
    const TIMEOUT_MS = 15 * 60 * 1000;

    return new Promise((resolve) => {
      let last = "";
      let sawOther = false; // a valid reply, but for a different request
      // `id` and `jobRef` are kept on the watcher so a reply handed straight to
      // chatgpt:submitReply can be matched to it without the clipboard.
      const self = { id: String(id || ""), jobRef };
      const finish = (result) => {
        clearInterval(timer);
        clipWatches.delete(self);
        resolve(result);
      };
      const timer = setInterval(() => {
        let clip = "";
        try { clip = clipboard.readText() || ""; } catch (_) {}
        if (clip && clip !== last) {
          last = clip;
          // The prompt itself is JSON with the same tokens — never treat it as the reply.
          if (clip.trim() !== promptTrim) {
            const res = parseResumeJson(clip, { id, jobRef });
            if (res.ok) {
              // Capture the ChatGPT conversation URL the user is on now, so the
              // application's "Open GPT" can reopen this exact thread later.
              try {
                if (chatWin && !chatWin.isDestroyed()) {
                  const u = chatWin.webContents.getURL() || "";
                  if (/^https?:\/\//i.test(u)) res.gptUrl = u;
                }
              } catch (_) {}
              finish(res); return;
            }
            // A real resume reply, but carrying someone else's request_id. The
            // clipboard is a single system-wide slot: another copy of the app —
            // or another tab in this one — puts its reply there too. Skip it and
            // KEEP WAITING for ours. Aborting here is what made a second app
            // fail with "That reply doesn't match this request" the moment the
            // first one finished.
            if (res.reason === "mismatch") {
              if (!sawOther) {
                sawOther = true;
                notify(
                  "Waiting for this resume",
                  "That reply belongs to a different request — still watching for this one."
                );
              }
              return;
            }
            // "not-json" → not the reply yet; keep polling.
          }
        }
        if (Date.now() - startedAt > TIMEOUT_MS) {
          finish({ ok: false, timeout: true, sawOther });
        }
      }, 600);
      self.resolve = (r) => finish(r);
      clipWatches.add(self);
    });
  });

  // Deliver the reply straight to the run that is waiting for it.
  //
  // The clipboard handshake still works and still runs, but it cannot be relied
  // on alone: it is one system-wide slot, so with two copies of this app open
  // each one's reply can overwrite the other's inside the 600ms polling window.
  // The renderer captures the text in the page itself, so hand it over in
  // process - matched on request_id, which is what keeps two apps apart.
  handle("chatgpt:submitReply", (_e, d) => {
    const id = String((d && d.id) || "");
    const text = String((d && d.text) || "");
    if (!id || !text) return { ok: false, reason: "empty" };
    const watcher = [...clipWatches].find((w) => w.id === id);
    if (!watcher) return { ok: false, reason: "no-watcher" };
    const res = parseResumeJson(text, { id, jobRef: watcher.jobRef });
    if (!res.ok) return { ok: false, reason: res.reason || "not-a-reply" };
    try {
      if (chatWin && !chatWin.isDestroyed()) {
        const u = chatWin.webContents.getURL() || "";
        if (/^https?:\/\//i.test(u)) res.gptUrl = u;
      }
    } catch (_) {}
    watcher.resolve(res);
    return { ok: true };
  });

  // Stop waiting for the clipboard reply (user cancelled / left the tab).
  handle("chatgpt:cancelClipboard", () => {
    [...clipWatches].forEach((w) => w.resolve({ ok: false, canceled: true }));
    clipWatches.clear();
    return { ok: true };
  });

  // Cover letter generation (same account data, addressed to the JD's company).
  handle("coverletter:generate", async (_e, payload) => {
    const keyRow =
      db.get("SELECT api_key, provider, model FROM api_keys WHERE kind = 'v1' AND is_active = 1 LIMIT 1") ||
      db.get("SELECT api_key, provider, model FROM api_keys WHERE kind = 'v1' ORDER BY id DESC LIMIT 1");
    const accountId = payload && payload.accountId;
    const personal = accountId
      ? db.get("SELECT * FROM accounts WHERE id = ?", [accountId])
      : null;
    if (!personal) throw new Error("Select an account to build a cover letter for.");
    const work = db.all(
      WORK_BY_ACCOUNT,
      [accountId]
    );
    const education = db.all(
      "SELECT * FROM education WHERE account_id = ? ORDER BY id ASC",
      [accountId]
    );
    const projects = db.all(
      "SELECT * FROM projects WHERE account_id = ? ORDER BY id ASC",
      [accountId]
    );
    const instrId = payload && payload.instructionId;
    const instrRow =
      (instrId
        ? db.get("SELECT body FROM instructions WHERE id = ?", [instrId])
        : null) || db.get("SELECT body FROM instructions WHERE is_active = 1 LIMIT 1");
    const out = await generateCoverLetter({
      apiKey: keyRow && keyRow.api_key,
      provider: keyRow && keyRow.provider,
      model: keyRow && keyRow.model,
      personal,
      work,
      education,
      projects,
      jobDescription: payload && payload.jobDescription,
      instruction: instrRow && instrRow.body,
      role: payload && payload.role,
      company: payload && payload.company,
    });
    return out; // { text }
  });

  // Pick a resume PDF and parse it into structured account fields (active key).
  handle("resume:importFile", async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: "Select a resume PDF",
      properties: ["openFile"],
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };

    const filePath = res.filePaths[0];
    const keyRow =
      db.get("SELECT api_key, provider, model FROM api_keys WHERE kind = 'v1' AND is_active = 1 LIMIT 1") ||
      db.get("SELECT api_key, provider, model FROM api_keys WHERE kind = 'v1' ORDER BY id DESC LIMIT 1");
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > 15 * 1024 * 1024) {
        return { ok: false, error: "That PDF is larger than 15 MB. Please use a smaller file." };
      }
      const base64 = fs.readFileSync(filePath).toString("base64");
      const data = await parseResumeFile({
        apiKey: keyRow && keyRow.api_key,
        provider: keyRow && keyRow.provider,
        model: keyRow && keyRow.model,
        base64,
      });
      return { ok: true, data, fileName: path.basename(filePath) };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  });

  // Applications
  handle("app:add", (_e, d) => {
    const company = (d.company || "").trim();
    const position = (d.position || "").trim();
    if (!company || !position) {
      return { ok: false, error: "Company and position are required." };
    }

    // Duplicate check: same company AND same position (case-insensitive).
    const dup = db.get(
      `SELECT id FROM applications
       WHERE LOWER(company) = LOWER(?) AND LOWER(position) = LOWER(?)
       LIMIT 1`,
      [company, position]
    );

    if (dup) {
      notify(
        "Duplicate application",
        `You already logged "${position}" at ${company}.`
      );
      return { ok: false, duplicate: true };
    }

    db.insert(
      "INSERT INTO applications (company, position, applied_at) VALUES (?, ?, ?)",
      [company, position, nowIso()]
    );
    return { ok: true };
  });

  handle("app:listAll", () =>
    db.all("SELECT * FROM applications ORDER BY id DESC")
  );

  handle("app:delete", (_e, id) => {
    db.run("DELETE FROM applications WHERE id = ?", [id]);
    return { ok: true };
  });

  // Open an arbitrary http(s) link in the user's default browser (used by the
  // "Open Link" button on an application to reopen the original job post).
  handle("link:openExternal", async (_e, url) => {
    const u = String(url || "").trim();
    if (!/^https?:\/\//i.test(u)) return { ok: false, error: "No valid link saved for this application." };
    try { await shell.openExternal(u); return { ok: true }; }
    catch (e) { return { ok: false, error: (e && e.message) || "Could not open the link." }; }
  });

  // Wipe ALL application history across every account.
  handle("app:resetAll", () => {
    db.run("DELETE FROM applications");
    return { ok: true };
  });

}

// Someone launched this profile again. Bring the copy that owns it forward
// rather than letting a second process open its database.
if (gotProfileLock) {
  app.on("second-instance", () => {
    try {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } catch (_) {}
  });
}

app.whenReady().then(async () => {
  if (!gotProfileLock) return; // another copy already owns this profile
  try {
    // Attribute Windows toast notifications to this app (and use its icon).
    // Each profile is its own app as far as Windows is concerned, so their
    // notifications and taskbar entries don't merge.
    try { app.setAppUserModelId("com.rgenerator.app" + (profileName ? "." + profileName.replace(/\s+/g, "-") : "")); } catch (_) {}
    // A profile is a separate sandbox — don't pull in another install's data.
    if (!profileName) migrateLegacyData();
    loadLocalPrefs();
    if (!(await openDatabase())) {
      app.quit();
      return;
    }
    // Startup housekeeping, saved in one write rather than one per step.
    db.transaction(() => {
      moveLocalPrefsOutOfDatabase();
      // Number any roles saved before ordering existed, so existing accounts read
      // newest-first straight away rather than only after their next save.
      backfillWorkOrder();
      upgradeRetiredModels();
      clearLocationCopied();
      // Settle the connection choice, then apply it before any API calls.
      seedConnectionMode();
    });
    watchSharedDatabase();
    updatePresence();
    applyApiConnection();
    registerIpc();
    createWindow();
  } catch (e) {
    logCrash("whenReady", e);
    throw e;
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Leave the shared folder's list of connected apps.
app.on("will-quit", () => {
  if (presence) try { fs.unlinkSync(presence.file); } catch (_) {}
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
