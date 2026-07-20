const { app, BrowserWindow, ipcMain, Notification, dialog, shell, clipboard, session, screen } = require("electron");
const path = require("path");
const fs = require("fs");
const db = require("./db");
const {
  generateResume, generateCoverLetter, parseResumeFile, setProxy, checkProxy,
  buildPromptJson, parseResumeJson, refineV2Prompt, extractJdTarget,
} = require("./ai");
const license = require("./license");

const isDev = !!process.env.ELECTRON_DEV;

// Give the UNPACKED build its own userData (database + ChatGPT session), separate
// from the INSTALLED app, so testing the unpacked exe never touches real data.
// electron-builder puts the unpacked exe in a "win-unpacked" folder; the NSIS
// install goes elsewhere. This MUST run before any userData path is read
// (crash logging, DB init), i.e. here at module load.
let isUnpackedBuild = false;
try {
  const exeDir = path.basename(path.dirname(process.execPath)).toLowerCase();
  isUnpackedBuild = app.isPackaged && exeDir === "win-unpacked";
  if (isUnpackedBuild) {
    const devData = path.join(app.getPath("appData"), "Careerva (Unpacked)");
    fs.mkdirSync(devData, { recursive: true });
    app.setPath("userData", devData);
  }
} catch (_) {}

// Write startup/runtime failures to a log next to the app so packaged builds
// are diagnosable (GUI binaries don't print to a console).
function logCrash(where, err) {
  try {
    const line = `[${new Date().toISOString()}] ${where}: ${
      (err && err.stack) || err
    }\n`;
    fs.appendFileSync(path.join(app.getPath("userData"), "careerva.log"), line);
  } catch (_) {}
}
process.on("uncaughtException", (e) => logCrash("uncaughtException", e));
process.on("unhandledRejection", (e) => logCrash("unhandledRejection", e));
let mainWindow = null;

// One-time migration: the app was renamed from "TailorApply" to "Careerva",
// which changes the userData folder. If this machine has data from the old
// name and none yet under the new one, copy the database over so nothing is
// lost. Runs once — after the new DB exists it's a no-op.
function migrateLegacyData() {
  try {
    const newDir = app.getPath("userData");
    const newDb = path.join(newDir, "careerva.sqlite");
    if (fs.existsSync(newDb)) return; // already migrated, or fresh install
    const oldDb = path.join(app.getPath("appData"), "TailorApply", "tailorapply.sqlite");
    if (!fs.existsSync(oldDb)) return; // nothing from the old name to bring over
    fs.mkdirSync(newDir, { recursive: true });
    fs.copyFileSync(oldDb, newDb);
  } catch (e) {
    logCrash("migrateLegacyData", e);
  }
}

function todayStr() {
  // Local YYYY-MM-DD
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

function nowIso() {
  return new Date().toISOString();
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
    title: "Careerva",
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

function registerIpc() {
  // License / activation (machine-locked)
  ipcMain.handle("license:status", () => {
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

  ipcMain.handle("license:activate", (_e, key) => {
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
  ipcMain.handle("apikeys:list", (_e, kind) => {
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
  ipcMain.handle("apikeys:reorder", (_e, ids) => {
    (ids || []).forEach((id, i) => {
      db.run("UPDATE api_keys SET sort_order = ? WHERE id = ?", [i, id]);
    });
    return { ok: true };
  });

  ipcMain.handle("apikeys:add", (_e, d) => {
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

  ipcMain.handle("apikeys:update", (_e, d) => {
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

  ipcMain.handle("apikeys:delete", (_e, id) => {
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

  ipcMain.handle("apikeys:setActive", (_e, id) => {
    // Active is per-kind: clear only this key's group, then activate it.
    const row = db.get("SELECT kind FROM api_keys WHERE id = ?", [id]);
    const kind = (row && row.kind) || "v1";
    db.run("UPDATE api_keys SET is_active = 0 WHERE kind = ?", [kind]);
    db.run("UPDATE api_keys SET is_active = 1 WHERE id = ?", [id]);
    return { ok: true };
  });

  // Accounts (each account = one person with personal info + many work histories)
  ipcMain.handle("accounts:list", () =>
    db.all(
      "SELECT id, name, title, country, main_stack FROM accounts ORDER BY sort_order ASC, id ASC"
    )
  );

  ipcMain.handle("accounts:get", (_e, id) =>
    db.get("SELECT * FROM accounts WHERE id = ?", [id])
  );

  ipcMain.handle("accounts:create", (_e, d) => {
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
  ipcMain.handle("accounts:reorder", (_e, ids) => {
    (ids || []).forEach((id, i) => {
      db.run("UPDATE accounts SET sort_order = ? WHERE id = ?", [i, id]);
    });
    return { ok: true };
  });

  ipcMain.handle("accounts:save", (_e, d) => {
    db.run(
      `UPDATE accounts SET name = ?, title = ?, email = ?, phone = ?, address = ?,
         country = ?, linkedin = ?, portfolio = ?, main_stack = ?, additional_info = ?,
         birth_date = ? WHERE id = ?`,
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
        d.id,
      ]
    );
    return { ok: true };
  });

  ipcMain.handle("accounts:delete", (_e, id) => {
    db.run("DELETE FROM work_history WHERE account_id = ?", [id]);
    db.run("DELETE FROM education WHERE account_id = ?", [id]);
    db.run("DELETE FROM projects WHERE account_id = ?", [id]);
    db.run("DELETE FROM applications WHERE account_id = ?", [id]);
    db.run("DELETE FROM accounts WHERE id = ?", [id]);
    return { ok: true };
  });

  // Projects (scoped to an account)
  ipcMain.handle("projects:list", (_e, accountId) =>
    db.all(
      "SELECT * FROM projects WHERE account_id = ? ORDER BY id ASC",
      [accountId]
    )
  );

  ipcMain.handle("projects:replaceAll", (_e, d) => {
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
  ipcMain.handle("applications:counts", () => {
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
  ipcMain.handle("applications:byAccount", (_e, accountId) =>
    db.all(
      `SELECT ap.id, ap.role, ap.company, ap.country, ap.request_id, ap.applied_at, ap.pdf_path,
              ap.gpt_url, (CASE WHEN IFNULL(ap.gpt_url,'') <> '' THEN 1 ELSE 0 END) AS has_gpt,
              ac.main_stack AS account_stack
       FROM applications ap
       LEFT JOIN accounts ac ON ac.id = ap.account_id
       WHERE ap.account_id = ? ORDER BY ap.id DESC`,
      [accountId]
    )
  );

  // Every application across all accounts (with the owning account's name),
  // most recent first — feeds the "All Applications" tab.
  ipcMain.handle("applications:all", () =>
    db.all(
      `SELECT ap.id, ap.role, ap.company, ap.country, ap.request_id, ap.applied_at, ap.pdf_path,
              ap.gpt_url, (CASE WHEN IFNULL(ap.gpt_url,'') <> '' THEN 1 ELSE 0 END) AS has_gpt,
              ac.name AS account_name, ac.main_stack AS account_stack
       FROM applications ap
       LEFT JOIN accounts ac ON ac.id = ap.account_id
       ORDER BY ap.id DESC`
    )
  );

  // Search applications by account name, role, or company.
  ipcMain.handle("applications:search", (_e, query) => {
    const like = `%${(query || "").trim().toLowerCase()}%`;
    return db.all(
      `SELECT ap.id, ap.role, ap.company, ap.country, ap.request_id, ap.applied_at, ap.pdf_path,
              ap.gpt_url, (CASE WHEN IFNULL(ap.gpt_url,'') <> '' THEN 1 ELSE 0 END) AS has_gpt,
              ac.name AS account_name, ac.main_stack AS account_stack
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

  // Does an application already exist for this account + company + role? Used to
  // confirm before generating another resume for the same company and job title.
  ipcMain.handle("applications:findDuplicate", (_e, accountId, role, company) => {
    const r = (role || "").trim();
    const c = (company || "").trim();
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
  ipcMain.handle("applications:export", async () => {
    try {
      const rows = db.all(
        `SELECT ap.applied_at, ac.name AS account_name, ac.main_stack AS account_stack,
                ap.role, ap.company, ap.country, ap.request_id, ap.pdf_path
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
      const header = ["Applied At", "Account", "Stack", "Role", "Company", "Country", "Unique ID", "PDF Path"];
      const lines = [header.map(esc).join(",")];
      rows.forEach((r) => {
        lines.push([
          r.applied_at, r.account_name, r.account_stack, r.role,
          r.company, r.country, r.request_id, r.pdf_path,
        ].map(esc).join(","));
      });
      // BOM so Excel opens UTF-8 correctly.
      fs.writeFileSync(res.filePath, "﻿" + lines.join("\r\n"), "utf8");
      return { ok: true, path: res.filePath, count: rows.length };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  });

  // Education (scoped to an account)
  ipcMain.handle("education:list", (_e, accountId) =>
    db.all(
      "SELECT * FROM education WHERE account_id = ? ORDER BY id DESC",
      [accountId]
    )
  );

  ipcMain.handle("education:replaceAll", (_e, d) => {
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

  // Work history (scoped to an account)
  ipcMain.handle("work:list", (_e, accountId) =>
    db.all(
      "SELECT * FROM work_history WHERE account_id = ? ORDER BY id DESC",
      [accountId]
    )
  );

  ipcMain.handle("work:add", (_e, d) => {
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
    return { id };
  });

  ipcMain.handle("work:update", (_e, d) => {
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
    return { ok: true };
  });

  ipcMain.handle("work:delete", (_e, id) => {
    db.run("DELETE FROM work_history WHERE id = ?", [id]);
    return { ok: true };
  });

  // Replace all work history for an account in one shot (used by the single
  // "Save" action on the account form).
  ipcMain.handle("work:replaceAll", (_e, d) => {
    const accountId = d.accountId;
    db.run("DELETE FROM work_history WHERE account_id = ?", [accountId]);
    (d.rows || []).forEach((r) => {
      const empty =
        !(r.role_name || "").trim() &&
        !(r.company_name || "").trim() &&
        !(r.location || "").trim() &&
        !(r.work_duration || "").trim();
      if (empty) return;
      db.insert(
        `INSERT INTO work_history (account_id, role_name, company_name, location, work_duration, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          accountId,
          r.role_name || "",
          r.company_name || "",
          r.location || "",
          r.work_duration || "",
          nowIso(),
        ]
      );
    });
    return { ok: true };
  });

  // Instructions (multiple named prompts; one active is used for generation)
  ipcMain.handle("instructions:list", () =>
    db.all(
      "SELECT id, name, body, is_active FROM instructions ORDER BY sort_order ASC, id ASC"
    )
  );

  ipcMain.handle("instructions:add", (_e, d) => {
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

  ipcMain.handle("instructions:reorder", (_e, ids) => {
    (ids || []).forEach((id, i) => {
      db.run("UPDATE instructions SET sort_order = ? WHERE id = ?", [i, id]);
    });
    return { ok: true };
  });

  ipcMain.handle("instructions:update", (_e, d) => {
    db.run("UPDATE instructions SET name = ?, body = ? WHERE id = ?", [
      (d.name || "Untitled").trim(),
      d.body || "",
      d.id,
    ]);
    return { ok: true };
  });

  ipcMain.handle("instructions:delete", (_e, id) => {
    const wasActive = db.get("SELECT is_active FROM instructions WHERE id = ?", [id]);
    db.run("DELETE FROM instructions WHERE id = ?", [id]);
    if (wasActive && wasActive.is_active) {
      const next = db.get("SELECT id FROM instructions ORDER BY id DESC LIMIT 1");
      if (next) db.run("UPDATE instructions SET is_active = 1 WHERE id = ?", [next.id]);
    }
    return { ok: true };
  });

  ipcMain.handle("instructions:setActive", (_e, id) => {
    db.run("UPDATE instructions SET is_active = 0");
    db.run("UPDATE instructions SET is_active = 1 WHERE id = ?", [id]);
    return { ok: true };
  });

  // Download location (where generated resume PDFs are saved)
  ipcMain.handle("location:get", () => {
    const row = db.get("SELECT value FROM prefs WHERE key = 'download_location'");
    return { path: (row && row.value) || app.getPath("downloads") };
  });

  ipcMain.handle("location:choose", async () => {
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

  ipcMain.handle("location:open", async () => {
    const row = db.get("SELECT value FROM prefs WHERE key = 'download_location'");
    const dir = (row && row.value) || app.getPath("downloads");
    const err = await shell.openPath(dir);
    return { ok: !err, error: err || undefined };
  });

  // Export the whole SQLite database to a user-chosen .sqlite file.
  ipcMain.handle("db:export", async () => {
    try {
      const res = await dialog.showSaveDialog(mainWindow, {
        title: "Export database",
        defaultPath: "careerva-backup.sqlite",
        filters: [{ name: "SQLite Database", extensions: ["sqlite"] }],
      });
      if (res.canceled || !res.filePath) return { canceled: true };
      const src = db.getDbPath();
      if (!src || !fs.existsSync(src)) return { ok: false, error: "No database file found." };
      fs.copyFileSync(src, res.filePath);
      return { ok: true, path: res.filePath };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  });

  // Inspect a .sqlite file (chosen by the user) and return its importable
  // contents grouped by type, so the renderer can let the user pick items.
  ipcMain.handle("db:scan", async () => {
    try {
      const res = await dialog.showOpenDialog(mainWindow, {
        title: "Choose a database to import from",
        properties: ["openFile"],
        filters: [{ name: "SQLite Database", extensions: ["sqlite", "sqlite3", "db"] }],
      });
      if (res.canceled || !res.filePaths.length) return { canceled: true };
      const filePath = res.filePaths[0];
      return { ok: true, filePath, groups: db.scanFile(filePath) };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  });

  // Merge only the selected items from a previously-scanned .sqlite file.
  ipcMain.handle("db:importSelected", async (_e, payload) => {
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
  ipcMain.handle("db:import", async () => {
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

  // Proxies (multiple; one active is applied to AI API requests).
  function applyActiveProxy() {
    const active = db.get(
      "SELECT url, port, username, password FROM proxies WHERE is_active = 1 LIMIT 1"
    );
    setProxy(active ? { ...active, enabled: true } : null);
  }

  ipcMain.handle("proxy:list", () =>
    db.all(
      "SELECT id, url, port, username, password, is_active FROM proxies ORDER BY id DESC"
    )
  );

  // Currently active proxy (for the resume-build gating/badge).
  ipcMain.handle("proxy:active", () => {
    const row = db.get(
      "SELECT id, url, port FROM proxies WHERE is_active = 1 LIMIT 1"
    );
    return { enabled: !!row, proxy: row || null };
  });

  ipcMain.handle("proxy:add", (_e, d) => {
    if (!d || !(d.url || "").trim()) return { ok: false, error: "Proxy URL is required." };
    const existing = db.get("SELECT COUNT(*) AS c FROM proxies WHERE is_active = 1");
    const active = existing && existing.c > 0 ? 0 : 1; // first proxy becomes active
    const id = db.insert(
      `INSERT INTO proxies (url, port, username, password, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
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

  ipcMain.handle("proxy:setActive", (_e, id) => {
    db.run("UPDATE proxies SET is_active = 0");
    db.run("UPDATE proxies SET is_active = 1 WHERE id = ?", [id]);
    applyActiveProxy();
    return { ok: true };
  });

  ipcMain.handle("proxy:disable", () => {
    db.run("UPDATE proxies SET is_active = 0");
    setProxy(null);
    return { ok: true };
  });

  ipcMain.handle("proxy:delete", (_e, id) => {
    const wasActive = db.get("SELECT is_active FROM proxies WHERE id = ?", [id]);
    db.run("DELETE FROM proxies WHERE id = ?", [id]);
    if (wasActive && wasActive.is_active) setProxy(null); // dropped active → direct
    return { ok: true };
  });

  // Test any proxy config without saving it.
  ipcMain.handle("proxy:check", async (_e, d) => checkProxy(d));

  // Preferences (persist UI selections across restarts)
  ipcMain.handle("prefs:get", (_e, key) => {
    const row = db.get("SELECT value FROM prefs WHERE key = ?", [key]);
    return { value: row ? row.value : null };
  });

  ipcMain.handle("prefs:set", (_e, d) => {
    db.run(
      `INSERT INTO prefs (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [d.key, d.value == null ? null : String(d.value)]
    );
    return { ok: true };
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
  ipcMain.handle("resume:preview", async (_e, html) => {
    await htmlWindow(html, true);
    return { ok: true };
  });

  // Render the styled resume to a PDF and save it to the chosen location.
  ipcMain.handle("resume:exportPdf", async (_e, d) => {
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
          "SELECT role_name, company_name FROM work_history WHERE account_id = ? ORDER BY id DESC LIMIT 1",
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
             match_role = COALESCE(NULLIF(?, ''), match_role),
             match_company = COALESCE(NULLIF(?, ''), match_company),
             match_account = COALESCE(NULLIF(?, ''), match_account)
           WHERE id = ?`,
          [savedFile, recCountry, nowIso(), recRequestId, recJd, recResume, recGptUrl,
           matchRole, matchCompany, matchAccount, dup.id]
        );
      } else {
        db.insert(
          `INSERT INTO applications (account_id, role, company, country, position, request_id, job_description, resume_content, gpt_url, match_role, match_company, match_account, applied_at, pdf_path)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [d.accountId, recRole, recCompany, recCountry, recRole, recRequestId, recJd, recResume, recGptUrl,
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
  ipcMain.handle("pdf:reveal", (_e, filePath) => {
    if (!filePath) return { ok: false, error: "No file to open." };
    if (!fs.existsSync(filePath)) return { ok: false, error: "The file no longer exists." };
    shell.showItemInFolder(filePath);
    return { ok: true };
  });

  // Open a saved resume PDF directly in the OS default PDF viewer.
  ipcMain.handle("pdf:open", async (_e, filePath) => {
    if (!filePath) return { ok: false, error: "No file to open." };
    if (!fs.existsSync(filePath)) return { ok: false, error: "The file no longer exists." };
    const err = await shell.openPath(filePath);
    return { ok: !err, error: err || undefined };
  });

  // Read a saved PDF's bytes (base64) so the renderer can show it inline in the
  // built-in PDF viewer (real, paginated A4 pages) via a blob URL.
  ipcMain.handle("pdf:read", (_e, filePath) => {
    try {
      if (!filePath || !fs.existsSync(filePath)) return { ok: false };
      return { ok: true, base64: fs.readFileSync(filePath).toString("base64") };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  });

  // Resume generation
  ipcMain.handle("resume:generate", async (_e, payload) => {
    const keyRow =
      db.get("SELECT api_key, provider, model FROM api_keys WHERE kind = 'v1' AND is_active = 1 LIMIT 1") ||
      db.get("SELECT api_key, provider, model FROM api_keys WHERE kind = 'v1' ORDER BY id DESC LIMIT 1");
    const accountId = payload && payload.accountId;
    const personal = accountId
      ? db.get("SELECT * FROM accounts WHERE id = ?", [accountId])
      : null;
    const work = accountId
      ? db.all(
          "SELECT * FROM work_history WHERE account_id = ? ORDER BY id ASC",
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
  let clipWatch = null; // { timer, resolve }
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
    const row = db.get("SELECT value FROM prefs WHERE key = 'chatgpt_home_url'");
    const v = row && row.value ? String(row.value).trim() : "";
    return v || CHAT_HOME_DEFAULT;
  }

  // Route the embedded ChatGPT browser per the V2 connection choice:
  //   chat_conn_mode = "direct" → local IP (no proxy)
  //   chat_conn_mode = "proxy"  → the proxy chosen in chat_proxy_id
  //                               (falls back to the active proxy if unset)
  // Applied to the persistent chat session, so the ChatGPT page and its OAuth
  // pop-ups all use the same connection.
  async function applyChatProxy() {
    const ses = session.fromPartition(CHAT_PARTITION);
    const modeRow = db.get("SELECT value FROM prefs WHERE key = 'chat_conn_mode'");
    const mode = modeRow && modeRow.value ? modeRow.value : "direct";

    let active = null;
    if (mode === "proxy") {
      const idRow = db.get("SELECT value FROM prefs WHERE key = 'chat_proxy_id'");
      const pid = idRow && idRow.value ? Number(idRow.value) : null;
      if (pid) {
        active = db.get("SELECT url, port, username, password FROM proxies WHERE id = ?", [pid]);
      }
      if (!active) {
        active = db.get("SELECT url, port, username, password FROM proxies WHERE is_active = 1 LIMIT 1");
      }
    }

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
  ipcMain.handle("chatgpt:buildPrompt", async (_e, payload) => {
    const accountId = payload && payload.accountId;
    const personal = accountId ? db.get("SELECT * FROM accounts WHERE id = ?", [accountId]) : null;
    if (!personal) throw new Error("Select an account to build a resume for.");
    const work = db.all("SELECT * FROM work_history WHERE account_id = ? ORDER BY id ASC", [accountId]);
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
    let copied = false;
    try { clipboard.writeText(prompt); copied = true; } catch (_) {}
    return { id, prompt, copied, jobRef, refined, target };
  });

  // Prepare the persistent ChatGPT session for the embedded <webview> tab:
  // set the UA and apply the current browser-connection proxy, then return what
  // the renderer needs to configure and load the webview.
  ipcMain.handle("chatgpt:sessionInfo", async () => {
    try { session.fromPartition(CHAT_PARTITION).setUserAgent(CHAT_UA); } catch (_) {}
    try { await applyChatProxy(); } catch (_) {}
    return { ua: CHAT_UA, partition: CHAT_PARTITION, homeUrl: chatHomeUrl(), proxied: chatProxyKey && chatProxyKey !== "direct" };
  });

  // Fallback for the embedded webview: drop the proxy and use the local IP
  // (ChatGPT/Cloudflare frequently blocks proxy IPs). The renderer reloads after.
  ipcMain.handle("chatgpt:sessionDirect", async () => {
    try { await session.fromPartition(CHAT_PARTITION).setProxy({ mode: "direct" }); } catch (_) {}
    chatProxyKey = "direct";
    chatProxyAuth = null;
    return { ok: true };
  });

  // Write text to the system clipboard from the renderer (used to reliably place
  // the auto-captured ChatGPT reply JSON on the clipboard for the reply watcher).
  ipcMain.handle("clipboard:write", (_e, text) => {
    try { clipboard.writeText(String(text == null ? "" : text)); return { ok: true }; }
    catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
  });

  // Windows system notification when a resume finishes generating. Clicking it
  // brings the app window to the front.
  ipcMain.handle("notify:resumeDone", (_e, d) => {
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
  ipcMain.handle("chatgpt:open", (_e, opts) => openChatWindow(opts));

  async function openChatWindow(opts) {
    const fresh = !!(opts && opts.fresh);
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
      width: 1180, height: 860, title: "ChatGPT — Careerva V2",
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
    // the location can be saved from inside the browser window itself.
    win.webContents.on("did-finish-load", () => {
      let url = "";
      try { url = win.webContents.getURL() || ""; } catch (_) {}
      if (!/^https?:\/\//i.test(url)) return; // skip the local error page
      win.webContents.executeJavaScript(CHAT_SAVE_BUTTON_JS).catch(() => {});
    });
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
      if (clipWatch) { clipWatch.resolve({ ok: false, closed: true }); clipWatch = null; }
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
      const html =
        "<html><body style=\"font-family:Segoe UI,Arial,sans-serif;background:#111;color:#eee;padding:40px;line-height:1.5\">" +
        "<h2>Couldn't load ChatGPT</h2>" +
        `<p>The page failed to load (${errorDesc || "network error"}).</p>` +
        "<p>Check your internet connection (and the active proxy in <b>Settings → Proxy</b> if you're using one), then reopen this window.</p>" +
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
  ipcMain.handle("application:openGpt", async (_e, id) => {
    const ap = db.get("SELECT gpt_url FROM applications WHERE id = ?", [id]);
    if (!ap) return { ok: false, error: "Application not found." };
    const url = (ap.gpt_url || "").trim();
    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, error: "No ChatGPT conversation was saved for this application (generated before this feature, or the reply was pasted from elsewhere). Re-generate it to enable Open GPT." };
    }
    await openChatWindow({ fresh: true, url });
    return { ok: true };
  });

  // Save the current embedded-browser page (or an explicit URL) as the ChatGPT
  // "Project Home" the browser opens at from now on.
  ipcMain.handle("chatgpt:saveHome", (_e, url) => {
    let target = String(url || "").trim();
    if (!target && chatWin && !chatWin.isDestroyed()) {
      try { target = chatWin.webContents.getURL() || ""; } catch (_) {}
    }
    target = target.trim();
    if (!/^https?:\/\//i.test(target)) {
      return { ok: false, error: "Open the ChatGPT page you want (e.g. your Project) first, then save it as Project Home." };
    }
    db.run(
      `INSERT INTO prefs (key, value) VALUES ('chatgpt_home_url', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [target]
    );
    return { ok: true, url: target };
  });

  // Current saved Project Home ("" = the default ChatGPT site).
  ipcMain.handle("chatgpt:getHome", () => {
    const row = db.get("SELECT value FROM prefs WHERE key = 'chatgpt_home_url'");
    return { url: row && row.value ? row.value : "", default: CHAT_HOME_DEFAULT };
  });

  // Clear the saved Project Home (revert to the default ChatGPT site).
  ipcMain.handle("chatgpt:clearHome", () => {
    db.run("DELETE FROM prefs WHERE key = 'chatgpt_home_url'");
    return { ok: true };
  });

  // Called from the in-browser "Save as Project Home" button: save the URL the
  // embedded browser is currently showing.
  ipcMain.handle("chatgpt:saveHomeFromBrowser", () => {
    if (!chatWin || chatWin.isDestroyed()) return { ok: false };
    let url = "";
    try { url = chatWin.webContents.getURL() || ""; } catch (_) {}
    url = url.trim();
    if (!/^https?:\/\//i.test(url)) return { ok: false };
    db.run(
      `INSERT INTO prefs (key, value) VALUES ('chatgpt_home_url', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [url]
    );
    notify("Project Home saved", url);
    // Let the app update its displayed Project Home value.
    if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send("chatgpt:homeChanged", url);
    }
    return { ok: true, url };
  });

  // Is the user already signed in (so V2 won't make them log in again)?
  ipcMain.handle("chatgpt:signedIn", async () => {
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
  ipcMain.handle("chatgpt:awaitClipboard", (_e, id, promptText, jobRef) => {
    if (clipWatch) { clipWatch.resolve({ ok: false, canceled: true }); clipWatch = null; }
    const promptTrim = String(promptText || "").trim();
    const startedAt = Date.now();
    const TIMEOUT_MS = 15 * 60 * 1000;

    return new Promise((resolve) => {
      let last = "";
      const finish = (result) => {
        clearInterval(timer);
        clipWatch = null;
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
            // A real resume reply, but for a different id/job description: stop
            // and report it rather than rendering the wrong resume.
            if (res.reason === "mismatch") {
              finish({ ok: false, mismatch: true, detail: res.detail });
              return;
            }
            // "not-json" → not the reply yet; keep polling.
          }
        }
        if (Date.now() - startedAt > TIMEOUT_MS) finish({ ok: false, timeout: true });
      }, 600);
      clipWatch = { timer, resolve: (r) => finish(r) };
    });
  });

  // Stop waiting for the clipboard reply (user cancelled / left the tab).
  ipcMain.handle("chatgpt:cancelClipboard", () => {
    if (clipWatch) { clipWatch.resolve({ ok: false, canceled: true }); clipWatch = null; }
    return { ok: true };
  });

  // Cover letter generation (same account data, addressed to the JD's company).
  ipcMain.handle("coverletter:generate", async (_e, payload) => {
    const keyRow =
      db.get("SELECT api_key, provider, model FROM api_keys WHERE kind = 'v1' AND is_active = 1 LIMIT 1") ||
      db.get("SELECT api_key, provider, model FROM api_keys WHERE kind = 'v1' ORDER BY id DESC LIMIT 1");
    const accountId = payload && payload.accountId;
    const personal = accountId
      ? db.get("SELECT * FROM accounts WHERE id = ?", [accountId])
      : null;
    if (!personal) throw new Error("Select an account to build a cover letter for.");
    const work = db.all(
      "SELECT * FROM work_history WHERE account_id = ? ORDER BY id ASC",
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
  ipcMain.handle("resume:importFile", async () => {
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
  ipcMain.handle("app:add", (_e, d) => {
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

  ipcMain.handle("app:todayCount", () => {
    const row = db.get(
      "SELECT COUNT(*) AS c FROM applications WHERE substr(applied_at, 1, 10) = ?",
      [todayStr()]
    );
    return { count: row ? row.c : 0 };
  });

  ipcMain.handle("app:todayList", () =>
    db.all(
      "SELECT * FROM applications WHERE substr(applied_at, 1, 10) = ? ORDER BY id DESC",
      [todayStr()]
    )
  );

  ipcMain.handle("app:listAll", () =>
    db.all("SELECT * FROM applications ORDER BY id DESC")
  );

  ipcMain.handle("app:delete", (_e, id) => {
    db.run("DELETE FROM applications WHERE id = ?", [id]);
    return { ok: true };
  });

  // Wipe ALL application history across every account.
  ipcMain.handle("app:resetAll", () => {
    db.run("DELETE FROM applications");
    return { ok: true };
  });

  // Sessions (start/end counting)
  ipcMain.handle("session:start", () => {
    const active = db.get("SELECT id FROM sessions WHERE end_time IS NULL");
    if (active) return { ok: true, id: active.id, alreadyActive: true };
    const id = db.insert(
      "INSERT INTO sessions (start_time, end_time) VALUES (?, NULL)",
      [nowIso()]
    );
    return { ok: true, id };
  });

  ipcMain.handle("session:end", () => {
    db.run(
      "UPDATE sessions SET end_time = ? WHERE end_time IS NULL",
      [nowIso()]
    );
    return { ok: true };
  });

  ipcMain.handle("session:active", () => {
    const row = db.get(
      "SELECT id, start_time FROM sessions WHERE end_time IS NULL ORDER BY id DESC LIMIT 1"
    );
    return { active: !!row, session: row || null };
  });
}

app.whenReady().then(async () => {
  try {
    // Attribute Windows toast notifications to this app (and use its icon).
    try { app.setAppUserModelId("com.careerva.app"); } catch (_) {}
    // The unpacked build is a separate sandbox — don't pull in legacy data.
    if (!isUnpackedBuild) migrateLegacyData();
    await db.initDb(app.getPath("userData"));
    // Re-apply the active proxy before any API calls.
    const activeProxy = db.get(
      "SELECT url, port, username, password FROM proxies WHERE is_active = 1 LIMIT 1"
    );
    if (activeProxy) setProxy({ ...activeProxy, enabled: true });
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

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
