// SQLite persistence layer using sql.js (SQLite compiled to WebAssembly).
// A real .sqlite file is kept on disk in the app's userData directory and
// re-written after every mutation. No native build tools required.

const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");

let db = null;
let dbPath = null;
let SQL = null; // the loaded sql.js module, reused to re-open DBs on import

// Full schema (idempotent). Used on first init and after a database import so
// an imported file always has every table this app expects.
const SCHEMA = `
    CREATE TABLE IF NOT EXISTS api_keys (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT,
      api_key    TEXT,
      provider   TEXT,
      model      TEXT,
      kind       TEXT DEFAULT 'v1',
      is_active  INTEGER DEFAULT 0,
      sort_order INTEGER,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT,
      title     TEXT,
      email     TEXT,
      phone     TEXT,
      address   TEXT,
      country   TEXT,
      linkedin  TEXT,
      portfolio TEXT,
      main_stack TEXT,
      additional_info TEXT,
      birth_date TEXT,
      password    TEXT,
      recovery    TEXT,
      resume_link TEXT,
      cover_letter_link TEXT,
      time_zone   TEXT,
      sort_order INTEGER,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS instructions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT,
      body       TEXT,
      is_active  INTEGER DEFAULT 0,
      sort_order INTEGER,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS work_history (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id   INTEGER,
      role_name    TEXT,
      company_name TEXT,
      location     TEXT,
      work_duration TEXT,
      created_at   TEXT
    );

    CREATE TABLE IF NOT EXISTS education (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER,
      university TEXT,
      location   TEXT,
      degree     TEXT,
      period     TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS projects (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id  INTEGER,
      title       TEXT,
      link        TEXT,
      description TEXT,
      created_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS applications (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER,
      role       TEXT,
      company    TEXT,
      country    TEXT,
      position   TEXT,
      request_id TEXT,
      job_description TEXT,
      resume_content  TEXT,
      gpt_url    TEXT,
      job_link   TEXT,
      location        TEXT,
      industry        TEXT,
      salary_range    TEXT,
      employment_type TEXT,
      match_role    TEXT,
      match_company TEXT,
      match_account TEXT,
      applied_at TEXT,
      pdf_path   TEXT
    );

    CREATE TABLE IF NOT EXISTS job_posts (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      url          TEXT,
      role         TEXT,
      company      TEXT,
      country      TEXT,
      location     TEXT,
      salary_range TEXT,
      industry     TEXT,
      employment_type TEXT,
      job_description TEXT,
      raw_text     TEXT,
      source       TEXT,
      created_at   TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      start_time TEXT,
      end_time   TEXT
    );

    CREATE TABLE IF NOT EXISTS prefs (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS proxy (
      id       INTEGER PRIMARY KEY CHECK (id = 1),
      url      TEXT,
      port     TEXT,
      username TEXT,
      password TEXT,
      enabled  INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS proxies (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT,
      url       TEXT,
      port      TEXT,
      username  TEXT,
      password  TEXT,
      is_active INTEGER DEFAULT 0,
      created_at TEXT
    );
`;

async function initDb(userDataDir) {
  SQL = await initSqlJs({
    locateFile: (file) =>
      path.join(__dirname, "..", "node_modules", "sql.js", "dist", file),
  });

  dbPath = path.join(userDataDir, "careerva.sqlite");

  if (fs.existsSync(dbPath)) {
    db = new SQL.Database(fs.readFileSync(dbPath));
  } else {
    db = new SQL.Database();
  }
  // Remember what we just read, so the schema work below isn't mistaken for
  // another process's write and reloaded away.
  stampFile();

  db.run(SCHEMA);

  migrate();
  persist();
  return db;
}

// Bring databases created by earlier versions up to the multi-account schema.
function migrate() {
  // Ensure work_history has an account_id column.
  const cols = all("PRAGMA table_info(work_history)");
  if (!cols.some((c) => c.name === "account_id")) {
    db.run("ALTER TABLE work_history ADD COLUMN account_id INTEGER");
  }

  // Ensure accounts has a sort_order column (for drag-and-drop ranking).
  const acctCols = all("PRAGMA table_info(accounts)");
  if (!acctCols.some((c) => c.name === "sort_order")) {
    db.run("ALTER TABLE accounts ADD COLUMN sort_order INTEGER");
  }
  db.run("UPDATE accounts SET sort_order = id WHERE sort_order IS NULL");

  // Ensure accounts has a main_stack column (identification note, not in resume).
  if (!acctCols.some((c) => c.name === "main_stack")) {
    db.run("ALTER TABLE accounts ADD COLUMN main_stack TEXT");
  }

  // Ensure accounts has an additional_info column (free-text extras fed to the AI:
  // certifications, languages, awards, notes — anything not covered by the other tabs).
  if (!acctCols.some((c) => c.name === "additional_info")) {
    db.run("ALTER TABLE accounts ADD COLUMN additional_info TEXT");
  }

  // Ensure accounts has a birth_date column (YYYY-MM-DD) — the person's age is
  // computed from it and shown in the generator's "View info" modal.
  if (!acctCols.some((c) => c.name === "birth_date")) {
    db.run("ALTER TABLE accounts ADD COLUMN birth_date TEXT");
  }

  // Ensure api_keys has a provider column (multi-provider support).
  const keyCols = all("PRAGMA table_info(api_keys)");
  if (!keyCols.some((c) => c.name === "provider")) {
    db.run("ALTER TABLE api_keys ADD COLUMN provider TEXT");
  }
  db.run("UPDATE api_keys SET provider = 'gemini' WHERE provider IS NULL OR provider = ''");

  // Ensure api_keys has a model column (per-key model choice).
  if (!keyCols.some((c) => c.name === "model")) {
    db.run("ALTER TABLE api_keys ADD COLUMN model TEXT");
  }

  // Ensure api_keys has a kind column. Keys are split into 'v1' (direct resume
  // generation: Gemini/OpenAI/Anthropic) and 'v2' (a Gemini key that refines the
  // ChatGPT prompt). Existing keys are all V1.
  if (!keyCols.some((c) => c.name === "kind")) {
    db.run("ALTER TABLE api_keys ADD COLUMN kind TEXT DEFAULT 'v1'");
  }
  db.run("UPDATE api_keys SET kind = 'v1' WHERE kind IS NULL OR kind = ''");

  // Ensure api_keys has a sort_order column (drag-and-drop ranking).
  if (!keyCols.some((c) => c.name === "sort_order")) {
    db.run("ALTER TABLE api_keys ADD COLUMN sort_order INTEGER");
  }
  // Backfill any missing order, preserving the current newest-first view.
  const apiMax = get(
    "SELECT COALESCE(MAX(sort_order), -1) AS m FROM api_keys WHERE sort_order IS NOT NULL"
  );
  let apiNext = (apiMax ? apiMax.m : -1) + 1;
  all("SELECT id FROM api_keys WHERE sort_order IS NULL ORDER BY id DESC").forEach((r) => {
    db.run("UPDATE api_keys SET sort_order = ? WHERE id = ?", [apiNext++, r.id]);
  });

  // Ensure instructions has a sort_order column (drag-and-drop ranking).
  const instrCols = all("PRAGMA table_info(instructions)");
  if (!instrCols.some((c) => c.name === "sort_order")) {
    db.run("ALTER TABLE instructions ADD COLUMN sort_order INTEGER");
  }
  db.run("UPDATE instructions SET sort_order = id WHERE sort_order IS NULL");

  // Migrate the old single proxy row into the multi-proxy table.
  const proxiesCount = get("SELECT COUNT(*) AS c FROM proxies");
  if (proxiesCount && proxiesCount.c === 0) {
    const old = get(
      "SELECT url, port, username, password, enabled FROM proxy WHERE id = 1"
    );
    if (old && old.url && old.url.trim()) {
      insert(
        `INSERT INTO proxies (url, port, username, password, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [old.url, old.port, old.username, old.password, old.enabled ? 1 : 0, new Date().toISOString()]
      );
    }
  }

  // Ensure applications has account_id / role / country (resume-generation log).
  const appCols = all("PRAGMA table_info(applications)");
  [
    ["account_id", "INTEGER"],
    ["role", "TEXT"],
    ["country", "TEXT"],
    ["pdf_path", "TEXT"],
    ["request_id", "TEXT"], // V2 handshake id, shown in the history
    ["job_description", "TEXT"], // stored with the application for reference
    ["resume_content", "TEXT"],  // the generated resume markdown
    ["gpt_url", "TEXT"],         // the ChatGPT conversation URL — "Open GPT" reopens it
    ["job_link", "TEXT"],        // the original job-post URL, opened from the history
    // Extracted job-post details (Generate V3), stored so the history's
    // "View Job Content" can show the whole posting without re-fetching it.
    ["location", "TEXT"],
    ["industry", "TEXT"],
    ["salary_range", "TEXT"],
    ["employment_type", "TEXT"],
    // Dedicated duplicate-detection index fields: the canonical job title +
    // company extracted from the JD by Gemini, plus the account name. Matching
    // uses THESE, so display role/company can differ (e.g. from the reply)
    // without breaking duplicate detection.
    ["match_role", "TEXT"],
    ["match_company", "TEXT"],
    ["match_account", "TEXT"],
  ].forEach(([col, type]) => {
    if (!appCols.some((c) => c.name === col)) {
      db.run(`ALTER TABLE applications ADD COLUMN ${col} ${type}`);
    }
  });

  // Account fields the Markdown record format carries that the resume itself
  // never uses. Deliberately NOT part of the AI prompt payload, which whitelists
  // its fields — a stored password must never travel to a model.
  [
    ["password", "TEXT"],
    ["recovery", "TEXT"],
    ["resume_link", "TEXT"],
    ["cover_letter_link", "TEXT"],
    ["time_zone", "TEXT"],
  ].forEach(([col, type]) => {
    if (!acctCols.some((c) => c.name === col)) {
      db.run(`ALTER TABLE accounts ADD COLUMN ${col} ${type}`);
    }
  });

  // Ensure proxies has a name column (a label, so several proxies on the same
  // host:port are told apart by something other than their username).
  const proxyCols = all("PRAGMA table_info(proxies)");
  if (!proxyCols.some((c) => c.name === "name")) {
    db.run("ALTER TABLE proxies ADD COLUMN name TEXT");
  }

  // Migrate the old single instruction pref into the instructions table.
  const instrCount = get("SELECT COUNT(*) AS c FROM instructions");
  if (instrCount && instrCount.c === 0) {
    const pref = get("SELECT value FROM prefs WHERE key = 'resume_instruction'");
    if (pref && pref.value && pref.value.trim()) {
      insert(
        "INSERT INTO instructions (name, body, is_active, created_at) VALUES (?, ?, 1, ?)",
        ["Default", pref.value, new Date().toISOString()]
      );
    }
  }

  // If an old single personal_info row exists and no accounts do yet,
  // promote it to the first account and attach orphan work history to it.
  const hasPersonal = get(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='personal_info'"
  );
  const acctCount = get("SELECT COUNT(*) AS c FROM accounts");
  if (hasPersonal && acctCount && acctCount.c === 0) {
    const pi = get("SELECT * FROM personal_info WHERE id = 1");
    if (pi && (pi.name || pi.email)) {
      const id = insert(
        `INSERT INTO accounts (name, title, email, phone, address, country, linkedin, portfolio, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          pi.name || "",
          pi.title || "",
          pi.email || "",
          pi.phone || "",
          pi.address || "",
          "",
          pi.linkedin || "",
          pi.portfolio || "",
          new Date().toISOString(),
        ]
      );
      db.run("UPDATE work_history SET account_id = ? WHERE account_id IS NULL", [id]);
    }
  }
}

// ---- Multi-instance safety --------------------------------------------------
// Several copies of the app can be open at once, and each one holds the whole
// database in memory and rewrites the ENTIRE file on every change. Left alone,
// whichever copy saved last would wipe everything the other had done since it
// started. So we fingerprint the file after each of our own writes, and re-read
// it before any query if the fingerprint no longer matches — meaning another
// copy wrote in the meantime. Every mutation persists immediately, so our memory
// and the file agree except in that window; re-reading then applying our
// statement on top gives each copy's work a chance to land.
let fileStamp = "";

function stampFile() {
  try {
    const st = fs.statSync(dbPath);
    // Size as well as mtime: two writes inside the same millisecond are
    // indistinguishable by timestamp alone.
    fileStamp = `${st.mtimeMs}:${st.size}`;
  } catch (_) {
    fileStamp = "";
  }
}

function syncFromDisk() {
  if (!db || !dbPath) return;
  let st = null;
  try { st = fs.statSync(dbPath); } catch (_) { return; } // no file yet — nothing to sync
  const now = `${st.mtimeMs}:${st.size}`;
  if (now === fileStamp) return;
  let fresh = null;
  try { fresh = new SQL.Database(fs.readFileSync(dbPath)); } catch (_) { return; }
  const previous = db;
  db = fresh;
  fileStamp = now;
  try { previous.close(); } catch (_) {}
}

function persist() {
  if (!db || !dbPath) return;
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
  stampFile();
}

// Absolute path of the on-disk SQLite file (used by the export feature).
function getDbPath() {
  return dbPath;
}

// A standalone .sqlite holding ONLY the application history — every column of
// every row, plus the accounts the entries point at so the file reads on its
// own. Separate from the Settings → Database backup, which copies everything
// (API keys, proxies, prompts, personal data). Returns the file's bytes.
function exportApplicationsDb() {
  syncFromDisk();
  const out = new SQL.Database();
  out.run(SCHEMA); // same shape, so an exported file is a valid Careerva database

  const copy = (table) => {
    const rows = query(`SELECT * FROM ${table}`);
    if (!rows.length) return 0;
    const cols = Object.keys(rows[0]);
    const sql = `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
    rows.forEach((r) => {
      const stmt = out.prepare(sql);
      stmt.bind(cols.map((c) => (r[c] === undefined ? null : r[c])));
      stmt.step();
      stmt.free();
    });
    return rows.length;
  };

  const applications = copy("applications");
  copy("accounts"); // names/stacks the history refers to
  const bytes = Buffer.from(out.export());
  try { out.close(); } catch (_) {}
  return { bytes, count: applications };
}

// Replace the live database with the contents of an imported .sqlite file.
// Throws if the bytes are not a valid SQLite database. This machine's license
// key is preserved so importing another machine's backup can't deactivate the
// app.
function importDb(buffer) {
  const license = get("SELECT value FROM prefs WHERE key = 'license_key'");
  const keep = license ? license.value : null;

  const next = new SQL.Database(buffer);
  next.exec("SELECT name FROM sqlite_master LIMIT 1"); // throws if not a real DB
  db = next;
  // Pin the fingerprint to the file as it stands now, so the schema/migration
  // work below can't be mistaken for a foreign write and reload the import away.
  stampFile();

  db.run(SCHEMA); // make sure every expected table exists
  migrate();      // bring an older imported schema up to date
  if (keep) {
    run(
      `INSERT INTO prefs (key, value) VALUES ('license_key', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [keep]
    );
  }
  persist();
}

// Raw query against the current connection, with no disk check. Used where a
// sync would be wrong (see insert).
function query(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function all(sql, params = []) {
  syncFromDisk();
  return query(sql, params);
}

function get(sql, params = []) {
  return all(sql, params)[0] || null;
}

function run(sql, params = []) {
  syncFromDisk();
  const stmt = db.prepare(sql);
  stmt.bind(params);
  stmt.step();
  stmt.free();
  persist();
}

function insert(sql, params = []) {
  syncFromDisk();
  const stmt = db.prepare(sql);
  stmt.bind(params);
  stmt.step();
  stmt.free();
  // Read the id BEFORE persisting: db.export() resets last_insert_rowid(), so
  // asking afterwards always returned 0. And no syncFromDisk in between — the
  // id belongs to this connection, and a reload would swap it out.
  const rows = query("SELECT last_insert_rowid() AS id");
  persist();
  return rows[0] ? rows[0].id : null;
}

// Merge the application history out of an exported .sqlite. Entries already
// here are skipped — identified by their unique generation id (request_id), and
// for older entries that have none, by account + role + company + date. Rows are
// re-pointed at the local account of the same name, creating it if it's missing,
// because account ids differ between databases.
function importApplications(filePath) {
  syncFromDisk();
  let src;
  try {
    src = new SQL.Database(fs.readFileSync(filePath));
    src.exec("SELECT name FROM sqlite_master LIMIT 1");
  } catch (_) {
    return { ok: false, error: "That file isn't a readable SQLite database." };
  }
  if (!srcHasTable(src, "applications")) {
    try { src.close(); } catch (_) {}
    return { ok: false, error: "That database has no application history in it." };
  }

  const rows = srcAll(src, "SELECT * FROM applications ORDER BY id");
  const srcAccounts = srcHasTable(src, "accounts")
    ? srcAll(src, "SELECT * FROM accounts")
    : [];
  try { src.close(); } catch (_) {}

  const norm = (v) => String(v == null ? "" : v).trim().toLowerCase();
  const signature = (r) =>
    [norm(r.match_account), norm(r.role), norm(r.company), norm(r.applied_at)].join("|");

  const existing = all("SELECT * FROM applications");
  const seenIds = new Set(existing.map((r) => norm(r.request_id)).filter(Boolean));
  const seenSigs = new Set(existing.map(signature));

  // Local accounts by name, so imported entries land under the right person.
  const localAccounts = all("SELECT id, name FROM accounts");
  const byName = new Map(localAccounts.map((a) => [norm(a.name), a.id]));
  const srcAccountById = new Map(srcAccounts.map((a) => [a.id, a]));

  const columns = all("PRAGMA table_info(applications)")
    .map((c) => c.name)
    .filter((c) => c !== "id"); // let the local table assign its own ids

  let imported = 0;
  let skipped = 0;
  let accountsCreated = 0;

  rows.forEach((r) => {
    const rid = norm(r.request_id);
    if (rid ? seenIds.has(rid) : seenSigs.has(signature(r))) { skipped++; return; }

    // Resolve the owning account by name.
    let accountId = null;
    const srcAcc = srcAccountById.get(r.account_id);
    const accName = norm(srcAcc && srcAcc.name) || norm(r.match_account);
    if (accName) {
      if (byName.has(accName)) accountId = byName.get(accName);
      else if (srcAcc) {
        accountId = insert(
          `INSERT INTO accounts (name, title, email, phone, address, country, linkedin,
             portfolio, main_stack, additional_info, birth_date, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [srcAcc.name ?? null, srcAcc.title ?? null, srcAcc.email ?? null, srcAcc.phone ?? null,
           srcAcc.address ?? null, srcAcc.country ?? null, srcAcc.linkedin ?? null,
           srcAcc.portfolio ?? null, srcAcc.main_stack ?? null, srcAcc.additional_info ?? null,
           srcAcc.birth_date ?? null, srcAcc.created_at ?? new Date().toISOString()]
        );
        byName.set(accName, accountId);
        accountsCreated++;
      }
    }

    const values = columns.map((c) => {
      if (c === "account_id") return accountId;
      return r[c] === undefined ? null : r[c];
    });
    insert(
      `INSERT INTO applications (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
      values
    );
    if (rid) seenIds.add(rid);
    seenSigs.add(signature(r));
    imported++;
  });

  return { ok: true, imported, skipped, accountsCreated, total: rows.length };
}

// ---- Selective import (merge specific rows from another .sqlite file) -------

// Friendly labels for known preference keys (raw key shown for anything else).
const PREF_LABELS = {
  download_location: "Download folder",
  resume_style: "Resume style",
  resume_accent: "Content color",
  resume_name_color: "Name color",
  resume_font: "Resume font",
  resume_font_size: "Font size",
  auto_preview: "Auto-preview on paste",
  auto_generate: "Auto-generate",
  open_preview_after: "Open preview modal",
  cover_letter: "Cover letter toggle",
  style_order: "Resume style order",
  selected_account_id: "Selected account",
  gen_jd: "Last job description",
};
const prefLabel = (key) => PREF_LABELS[key] || key;

// Read helpers that run against an arbitrary (source) database handle.
function srcAll(src, sql, params = []) {
  const stmt = src.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}
const srcGet = (src, sql, params = []) => srcAll(src, sql, params)[0] || null;
const srcHasTable = (src, name) =>
  srcAll(src, "SELECT name FROM sqlite_master WHERE type='table' AND name=?", [name]).length > 0;

const nextOrder = (table) => {
  const r = get(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM ${table}`);
  return (r ? r.m : -1) + 1;
};

// Inspect a .sqlite file and return its importable contents grouped by type.
function scanFile(filePath) {
  const src = new SQL.Database(fs.readFileSync(filePath));
  try {
    const groups = [];
    if (srcHasTable(src, "api_keys")) {
      groups.push({
        id: "api_keys", label: "API Keys",
        items: srcAll(src, "SELECT * FROM api_keys ORDER BY id").map((r) => ({
          id: r.id,
          label:
            (r.name || "(unnamed)") +
            ` · ${r.kind === "v2" ? "V2" : "V1"}` +
            (r.provider ? ` ${r.provider}` : ""),
        })),
      });
    }
    if (srcHasTable(src, "accounts")) {
      groups.push({
        id: "accounts", label: "Accounts",
        items: srcAll(src, "SELECT * FROM accounts ORDER BY id").map((r) => ({
          id: r.id, label: (r.name || "(unnamed)") + (r.main_stack ? ` (${r.main_stack})` : ""),
        })),
      });
    }
    if (srcHasTable(src, "instructions")) {
      groups.push({
        id: "instructions", label: "Prompts",
        items: srcAll(src, "SELECT * FROM instructions ORDER BY id").map((r) => ({
          id: r.id, label: r.name || "(untitled)",
        })),
      });
    }
    if (srcHasTable(src, "proxies")) {
      groups.push({
        id: "proxies", label: "Proxies",
        items: srcAll(src, "SELECT * FROM proxies ORDER BY id").map((r) => ({
          id: r.id,
          label: r.name || [r.url, r.port].filter(Boolean).join(":") || "(proxy)",
        })),
      });
    }
    if (srcHasTable(src, "prefs")) {
      groups.push({
        id: "prefs", label: "Settings",
        items: srcAll(src, "SELECT key, value FROM prefs ORDER BY key")
          .filter((r) => r.key !== "license_key")
          .map((r) => ({ id: r.key, label: prefLabel(r.key) })),
      });
    }
    return groups.filter((g) => g.items.length);
  } finally {
    try { src.close(); } catch (_) {}
  }
}

// Merge only the user-selected rows from `filePath` into the live database.
// Rows are inserted as NEW records (no id clashes); prefs are upserted by key.
// The license key is never touched.
function importSelected(filePath, selection = {}) {
  const src = new SQL.Database(fs.readFileSync(filePath));
  const nowIso = new Date().toISOString();
  const counts = { api_keys: 0, accounts: 0, instructions: 0, proxies: 0, prefs: 0 };
  const ids = (k) => (Array.isArray(selection[k]) ? selection[k].map(Number) : []);
  try {
    if (srcHasTable(src, "api_keys")) {
      ids("api_keys").forEach((id) => {
        const r = srcGet(src, "SELECT * FROM api_keys WHERE id = ?", [id]);
        if (!r) return;
        // Preserve the model and V1/V2 kind so imported API (V2) keys stay V2.
        insert(
          `INSERT INTO api_keys (name, api_key, provider, model, kind, is_active, sort_order, created_at)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
          [r.name ?? null, r.api_key ?? null, r.provider ?? "gemini", r.model ?? null,
           r.kind === "v2" ? "v2" : "v1", nextOrder("api_keys"), r.created_at ?? nowIso]
        );
        counts.api_keys++;
      });
    }
    if (srcHasTable(src, "accounts")) {
      ids("accounts").forEach((id) => {
        const a = srcGet(src, "SELECT * FROM accounts WHERE id = ?", [id]);
        if (!a) return;
        insert(
          `INSERT INTO accounts (name, title, email, phone, address, country, linkedin, portfolio, main_stack, additional_info, sort_order, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [a.name ?? null, a.title ?? null, a.email ?? null, a.phone ?? null, a.address ?? null,
           a.country ?? null, a.linkedin ?? null, a.portfolio ?? null, a.main_stack ?? null,
           a.additional_info ?? null, nextOrder("accounts"), a.created_at ?? nowIso]
        );
        // sql.js resets last_insert_rowid() on export, so read the new id back.
        const maxRow = get("SELECT MAX(id) AS id FROM accounts");
        const newId = maxRow ? maxRow.id : null;
        if (srcHasTable(src, "work_history")) {
          srcAll(src, "SELECT * FROM work_history WHERE account_id = ?", [id]).forEach((w) =>
            insert(
              `INSERT INTO work_history (account_id, role_name, company_name, location, work_duration, created_at)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [newId, w.role_name ?? null, w.company_name ?? null, w.location ?? null, w.work_duration ?? null, w.created_at ?? nowIso]
            ));
        }
        if (srcHasTable(src, "education")) {
          srcAll(src, "SELECT * FROM education WHERE account_id = ?", [id]).forEach((ed) =>
            insert(
              `INSERT INTO education (account_id, university, location, degree, period, created_at)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [newId, ed.university ?? null, ed.location ?? null, ed.degree ?? null, ed.period ?? null, ed.created_at ?? nowIso]
            ));
        }
        if (srcHasTable(src, "projects")) {
          srcAll(src, "SELECT * FROM projects WHERE account_id = ?", [id]).forEach((p) =>
            insert(
              `INSERT INTO projects (account_id, title, link, description, created_at)
               VALUES (?, ?, ?, ?, ?)`,
              [newId, p.title ?? null, p.link ?? null, p.description ?? null, p.created_at ?? nowIso]
            ));
        }
        counts.accounts++;
      });
    }
    if (srcHasTable(src, "instructions")) {
      ids("instructions").forEach((id) => {
        const r = srcGet(src, "SELECT * FROM instructions WHERE id = ?", [id]);
        if (!r) return;
        insert(
          `INSERT INTO instructions (name, body, is_active, sort_order, created_at)
           VALUES (?, ?, 0, ?, ?)`,
          [r.name ?? null, r.body ?? null, nextOrder("instructions"), r.created_at ?? nowIso]
        );
        counts.instructions++;
      });
    }
    if (srcHasTable(src, "proxies")) {
      ids("proxies").forEach((id) => {
        const r = srcGet(src, "SELECT * FROM proxies WHERE id = ?", [id]);
        if (!r) return;
        insert(
          `INSERT INTO proxies (name, url, port, username, password, is_active, created_at)
           VALUES (?, ?, ?, ?, ?, 0, ?)`,
          [r.name ?? null, r.url ?? null, r.port ?? null, r.username ?? null, r.password ?? null, r.created_at ?? nowIso]
        );
        counts.proxies++;
      });
    }
    if (srcHasTable(src, "prefs")) {
      (Array.isArray(selection.prefs) ? selection.prefs : []).forEach((key) => {
        if (key === "license_key") return;
        const r = srcGet(src, "SELECT value FROM prefs WHERE key = ?", [key]);
        if (!r) return;
        run(
          `INSERT INTO prefs (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          [key, r.value ?? null]
        );
        counts.prefs++;
      });
    }
    persist();
    return counts;
  } finally {
    try { src.close(); } catch (_) {}
  }
}

module.exports = {
  initDb, all, get, run, insert, getDbPath, importDb, scanFile, importSelected,
  exportApplicationsDb, importApplications,
};
