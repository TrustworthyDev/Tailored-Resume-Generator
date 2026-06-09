const { app, BrowserWindow, ipcMain, Notification, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const db = require("./db");
const { generateResume, generateCoverLetter, parseResumeFile, setProxy, checkProxy } = require("./ai");
const license = require("./license");

const isDev = !!process.env.ELECTRON_DEV;

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

function notify(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    center: true,
    title: "Careerva",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

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

  // API keys (multiple; one active key is used for resume generation)
  ipcMain.handle("apikeys:list", () =>
    db.all(
      "SELECT id, name, api_key, provider, is_active FROM api_keys ORDER BY sort_order ASC, id ASC"
    )
  );

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
    const provider = (d.provider || "gemini").trim().toLowerCase();
    if (!key) return { ok: false, error: "Key is required." };
    // First key added becomes active automatically.
    const existing = db.get("SELECT COUNT(*) AS c FROM api_keys");
    const active = existing && existing.c > 0 ? 0 : 1;
    const maxRow = db.get("SELECT COALESCE(MAX(sort_order), -1) AS m FROM api_keys");
    const nextOrder = (maxRow ? maxRow.m : -1) + 1;
    const id = db.insert(
      "INSERT INTO api_keys (name, api_key, provider, is_active, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [name, key, provider, active, nextOrder, nowIso()]
    );
    return { ok: true, id };
  });

  ipcMain.handle("apikeys:update", (_e, d) => {
    const name = (d.name || "").trim();
    const key = (d.api_key || "").trim();
    const provider = (d.provider || "gemini").trim().toLowerCase();
    if (!key) return { ok: false, error: "Key is required." };
    db.run(
      "UPDATE api_keys SET name = ?, api_key = ?, provider = ? WHERE id = ?",
      [name, key, provider, d.id]
    );
    return { ok: true };
  });

  ipcMain.handle("apikeys:delete", (_e, id) => {
    const wasActive = db.get("SELECT is_active FROM api_keys WHERE id = ?", [id]);
    db.run("DELETE FROM api_keys WHERE id = ?", [id]);
    // If we removed the active key, promote the most recent remaining one.
    if (wasActive && wasActive.is_active) {
      const next = db.get("SELECT id FROM api_keys ORDER BY id DESC LIMIT 1");
      if (next) db.run("UPDATE api_keys SET is_active = 1 WHERE id = ?", [next.id]);
    }
    return { ok: true };
  });

  ipcMain.handle("apikeys:setActive", (_e, id) => {
    db.run("UPDATE api_keys SET is_active = 0");
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
         country = ?, linkedin = ?, portfolio = ?, main_stack = ? WHERE id = ?`,
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
      "SELECT id, role, company, country, applied_at, pdf_path FROM applications WHERE account_id = ? ORDER BY id DESC",
      [accountId]
    )
  );

  // Search applications by account name, role, or company.
  ipcMain.handle("applications:search", (_e, query) => {
    const like = `%${(query || "").trim().toLowerCase()}%`;
    return db.all(
      `SELECT ap.id, ap.role, ap.company, ap.country, ap.applied_at, ap.pdf_path,
              ac.name AS account_name
       FROM applications ap
       LEFT JOIN accounts ac ON ac.id = ap.account_id
       WHERE LOWER(IFNULL(ac.name, '')) LIKE ?
          OR LOWER(IFNULL(ap.role, '')) LIKE ?
          OR LOWER(IFNULL(ap.company, '')) LIKE ?
       ORDER BY ap.id DESC`,
      [like, like, like]
    );
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
      const dup = db.get(
        `SELECT id, pdf_path FROM applications
         WHERE account_id = ? AND LOWER(company) = LOWER(?) AND LOWER(role) = LOWER(?) LIMIT 1`,
        [d.accountId, recCompany, recRole]
      );
      const isDuplicate = !!dup && !!recCompany && !!recRole;

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
      if (isDuplicate) {
        notify(
          "Duplicate application",
          `Updated the existing "${recRole}" at ${recCompany} — no new entry created.`
        );
        db.run(
          "UPDATE applications SET pdf_path = ?, country = ?, applied_at = ? WHERE id = ?",
          [savedFile, recCountry, nowIso(), dup.id]
        );
      } else {
        db.insert(
          `INSERT INTO applications (account_id, role, company, country, position, applied_at, pdf_path)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [d.accountId, recRole, recCompany, recCountry, recRole, nowIso(), savedFile]
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

  // Resume generation
  ipcMain.handle("resume:generate", async (_e, payload) => {
    const keyRow =
      db.get("SELECT api_key, provider FROM api_keys WHERE is_active = 1 LIMIT 1") ||
      db.get("SELECT api_key, provider FROM api_keys ORDER BY id DESC LIMIT 1");
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
      personal,
      work,
      education,
      projects,
      jobDescription: payload && payload.jobDescription,
      style: payload && payload.style,
      instruction: instrRow && instrRow.body,
    });
    return out; // { text, jobRole, jobCompany }
  });

  // Cover letter generation (same account data, addressed to the JD's company).
  ipcMain.handle("coverletter:generate", async (_e, payload) => {
    const keyRow =
      db.get("SELECT api_key, provider FROM api_keys WHERE is_active = 1 LIMIT 1") ||
      db.get("SELECT api_key, provider FROM api_keys ORDER BY id DESC LIMIT 1");
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
      db.get("SELECT api_key, provider FROM api_keys WHERE is_active = 1 LIMIT 1") ||
      db.get("SELECT api_key, provider FROM api_keys ORDER BY id DESC LIMIT 1");
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > 15 * 1024 * 1024) {
        return { ok: false, error: "That PDF is larger than 15 MB. Please use a smaller file." };
      }
      const base64 = fs.readFileSync(filePath).toString("base64");
      const data = await parseResumeFile({
        apiKey: keyRow && keyRow.api_key,
        provider: keyRow && keyRow.provider,
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
    migrateLegacyData();
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
