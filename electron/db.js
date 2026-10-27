// SQLite persistence layer using sql.js (SQLite compiled to WebAssembly).
// A real .sqlite file is kept on disk in the app's userData directory and
// re-written after every mutation. No native build tools required.

const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");

let db = null;
let dbPath = null;
let SQL = null; // the loaded sql.js module, reused to re-open DBs on import

// A shared database is two files: settings and history (see "Settings and
// history files" below). An app's own database is one file, and these are null.
let historyPath = null; // the shared history.sqlite
let historyDb = null;   // the sql.js database holding it, attached to db as "history"

// Settings tables: everything except the application history (idempotent).
const SETTINGS_SCHEMA = `
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

// Application history tables. An app's own database keeps them beside the
// settings tables; a shared database keeps them in a file of their own.
const HISTORY_TABLES = ["applications", "job_posts"];
const HISTORY_SCHEMA = `
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
`;

// Full schema (idempotent). Used on first init and after a database import so
// an imported file always has every table this app expects.
const SCHEMA = SETTINGS_SCHEMA + HISTORY_SCHEMA;

// The history tables, created in the attached history file of a shared database.
const ATTACHED_HISTORY_SCHEMA = HISTORY_SCHEMA.replace(
  /CREATE TABLE IF NOT EXISTS /g,
  "CREATE TABLE IF NOT EXISTS history."
);

// Opens the app's own database in userDataDir, or the file at opts.filePath —
// a database shared with other apps on this PC (see openAt for the options).
async function initDb(userDataDir, opts = {}) {
  if (!SQL) {
    SQL = await initSqlJs({
      locateFile: (file) =>
        path.join(__dirname, "..", "node_modules", "sql.js", "dist", file),
    });
  }
  // Kept in step with DB_FILE in main.js, which migrates it across renames.
  openAt(opts.filePath || path.join(userDataDir, "rgenerator.sqlite"), opts);
  return db;
}

// Switch to the database at filePath, creating it if it doesn't exist.
//   opts.historyPath: keep the application history in this second file
//   opts.seedFrom:    a one-file database to start from when filePath doesn't
//                     exist yet (sharing an app's own database); its history
//                     moves into opts.historyPath
//   opts.shared:      save under the lock (other apps use these files too)
//   opts.watch:       notice other apps' saves
// The schema work runs under the lock, after reading the files, so a shared
// database another app is saving to can't be overwritten with a stale copy.
// On failure the previous database stays open.
function openAt(filePath, opts = {}) {
  if (depth > 0) throw new Error("Can't switch databases in the middle of a save.");
  const before = { db, historyDb, dbPath, historyPath, fileStamp, historyStamp, savedSettings, savedHistory, locking };
  stopWatching();
  db = historyDb = null;
  dbPath = filePath;
  historyPath = opts.historyPath || null;
  fileStamp = historyStamp = "";
  savedSettings = savedHistory = null;
  locking = !!opts.shared;
  opening = true;
  try {
    transaction(() => {
      touch(); // reads the files that exist
      if (!db) {
        if (historyPath && fs.existsSync(historyPath)) {
          throw new Error(`Found ${path.basename(historyPath)} without ${path.basename(dbPath)} in ${path.dirname(dbPath)}.`);
        }
        connect(opts.seedFrom ? fs.readFileSync(opts.seedFrom) : null, null);
      }
      ensureSchema();
      dirty = true;
    });
  } catch (e) {
    closeConnection();
    ({ db, historyDb, dbPath, historyPath, fileStamp, historyStamp, savedSettings, savedHistory, locking } = before);
    if (watchWanted) startWatching();
    throw e;
  } finally {
    opening = false;
  }
  try { if (before.db) before.db.close(); } catch (_) {}
  try { if (before.historyDb) before.historyDb.close(); } catch (_) {}
  watchWanted = !!opts.watch;
  if (watchWanted) startWatching();
  return db;
}

// Every table this app expects, in the right file, brought up to date. A
// shared database keeps the history tables in its history file — including any
// the settings file arrived with.
function ensureSchema() {
  if (historyDb) {
    db.run(SETTINGS_SCHEMA);
    moveHistoryOut();
    db.run(ATTACHED_HISTORY_SCHEMA);
  } else {
    db.run(SCHEMA);
  }
  migrate();
}

// Bring databases created by earlier versions up to the multi-account schema.
function migrate() {
  // Ensure work_history has an account_id column.
  const cols = all("PRAGMA table_info(work_history)");
  if (!cols.some((c) => c.name === "account_id")) {
    db.run("ALTER TABLE work_history ADD COLUMN account_id INTEGER");
  }

  // Explicit position of each role within its account, newest job first. Written
  // from the parsed dates whenever roles are saved, so every reader gets the
  // same order without sorting for itself. Existing rows are numbered on the
  // first run — see backfillWorkOrder() in main.js.
  if (!cols.some((c) => c.name === "sort_order")) {
    db.run("ALTER TABLE work_history ADD COLUMN sort_order INTEGER");
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
    // When its resume path was copied to file the application (empty = never).
    ["path_copied_at", "TEXT"],
    // The earlier application for the same account + company + role, when this
    // one repeats it. Every generation is kept as its own application.
    ["duplicate_of", "INTEGER"],
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
    // The look this account's resumes are generated with — template, the two
    // colours, font family and size. Empty means "no preference", in which case
    // the generator keeps whatever is selected there.
    ["resume_style", "TEXT"],
    ["resume_accent", "TEXT"],
    ["resume_name_color", "TEXT"],
    ["resume_font", "TEXT"],
    ["resume_font_size", "TEXT"],
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
// Several apps can use one database file at once (a database shared between
// apps on this PC), and each one holds the whole database in memory and
// rewrites the ENTIRE file on every change. Left alone, whichever app saved
// last would wipe everything the other had done since it started. So:
//   - we fingerprint the file after each of our own writes, and re-read it
//     before any query if the fingerprint no longer matches — meaning another
//     app wrote in the meantime;
//   - every change runs as a transaction: take the lock file, re-read the
//     database if another app changed it, apply the change, save, release. A
//     transaction can hold several statements (a read, then a write that
//     depends on it) and saves once, at its end;
//   - a save writes a temp file and renames it over the database, so a reader
//     sees the old file or the new one, never a half-written one.
// The lock is only taken for a shared database: an app's own database belongs
// to that app alone (one process per data folder), so it saves without one.
let fileStamp = "";
let historyStamp = "";
let savedSettings = null; // the bytes last read or written, so an unchanged
let savedHistory = null;  // file isn't rewritten
let locking = false;     // true for a shared database
let depth = 0;           // nesting of transaction() calls
let dirty = false;       // a statement ran since the transaction began
let touched = false;     // this transaction has taken the lock and re-read the file
let lockToken = null;    // set while we hold the lock
let opening = false;     // inside openAt: a missing history file is created, not an error

const LOCK_WAIT_MS = 5000;   // how long a save waits for another app's save
const LOCK_STALE_MS = 10000; // a lock this old was left behind by a crash
const LOCK_RETRY_MS = 50;

// Block this thread for ms. Saves are synchronous, so waiting for the lock is too.
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const stampOf = (st) => `${st.mtimeMs}:${st.size}`; // size too: two saves can share a millisecond

function stampFiles() {
  try { fileStamp = stampOf(fs.statSync(dbPath)); } catch (_) { fileStamp = ""; }
  historyStamp = "";
  if (historyPath) try { historyStamp = stampOf(fs.statSync(historyPath)); } catch (_) {}
}

// A file's bytes and their fingerprint, read through one handle so a save
// landing in between can't pair the old fingerprint with the new contents.
function readStamped(file) {
  const fd = fs.openSync(file, "r");
  try {
    const stamp = stampOf(fs.fstatSync(fd));
    return { bytes: fs.readFileSync(fd), stamp };
  } finally {
    fs.closeSync(fd);
  }
}

// Re-read the files if another app changed them since we last read or wrote
// them. strict: throw when they can't be read, instead of carrying on with
// what's in memory — a save must never write over a change it couldn't load.
// Returns true when it reloaded.
function reload(strict) {
  if (!dbPath) return false;
  let st, hst = null;
  try { st = fs.statSync(dbPath); } catch (e) {
    if (e.code === "ENOENT" || !strict) return false; // no file yet — nothing to read
    throw e;
  }
  if (historyPath) {
    try { hst = fs.statSync(historyPath); } catch (e) {
      // Missing is normal only while opening: the history file gets created.
      if (!(e.code === "ENOENT" && opening)) {
        if (!strict) return false;
        throw e.code === "ENOENT" ? new Error(`The history file is missing: ${historyPath}`) : e;
      }
    }
  }
  const same = db && stampOf(st) === fileStamp && (!historyPath || (hst && stampOf(hst) === historyStamp));
  if (same) return false;
  try {
    const settings = readStamped(dbPath);
    const history = hst ? readStamped(historyPath) : null;
    connect(settings.bytes, history && history.bytes);
    fileStamp = settings.stamp;
    savedSettings = settings.bytes;
    historyStamp = history ? history.stamp : "";
    savedHistory = history ? history.bytes : null;
    return true;
  } catch (e) {
    if (strict) throw e;
    return false;
  }
}

// Reads re-check the file. Inside a transaction, the first read or write takes
// the lock and re-reads; after that the database in memory is current.
function syncFromDisk() {
  if (depth > 0) return touch();
  reload(false);
}

const lockPath = () => dbPath + ".lock";

function lockIsStale(file) {
  try {
    if (Date.now() - fs.statSync(file).mtimeMs > LOCK_STALE_MS) return true;
    const info = JSON.parse(fs.readFileSync(file, "utf8"));
    if (info && info.pid && info.pid !== process.pid) {
      try { process.kill(info.pid, 0); } catch (e) { return e.code === "ESRCH"; } // its app is gone
    }
  } catch (_) {} // being written or removed right now — not stale
  return false;
}

function acquireLock() {
  const file = lockPath();
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  let lastCode = "";
  for (;;) {
    try {
      const fd = fs.openSync(file, "wx"); // fails if the lock file exists
      try {
        fs.writeSync(fd, JSON.stringify({ pid: process.pid, token, at: new Date().toISOString() }));
      } finally {
        fs.closeSync(fd);
      }
      lockToken = token;
      return;
    } catch (e) {
      // EEXIST = another app holds it. EPERM/EACCES/EBUSY = Windows is still
      // deleting the previous lock file, or a scanner has it open.
      if (!["EEXIST", "EPERM", "EACCES", "EBUSY"].includes(e.code)) throw e;
      lastCode = e.code;
    }
    if (lastCode === "EEXIST" && lockIsStale(file)) {
      try { fs.unlinkSync(file); } catch (_) {}
      continue;
    }
    if (Date.now() > deadline) {
      const err = new Error(
        "The shared database is busy — another app is saving to it. Please try again." +
          (lastCode === "EEXIST" ? "" : ` (${lastCode})`)
      );
      err.code = "DB_BUSY";
      throw err;
    }
    pause(LOCK_RETRY_MS);
  }
}

function releaseLock() {
  const file = lockPath();
  const token = lockToken;
  lockToken = null;
  try {
    // Only remove our own lock: after a long stall another app may have
    // judged ours stale and taken over.
    const info = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!info || info.token !== token) return;
    fs.unlinkSync(file);
  } catch (_) {}
}

// The first database access inside a transaction: take the lock, then re-read
// the file if another app changed it. Lazy, so a transaction that never
// touches the database (most IPC handlers wrapped in main.js) costs nothing.
function touch() {
  if (depth === 0 || touched) return;
  if (locking) acquireLock();
  try {
    // A file another app is replacing can be briefly unreadable; retry before
    // giving up, and never save over what couldn't be read.
    for (let i = 0; ; i++) {
      try { reload(true); break; } catch (e) {
        if (i >= 5) throw e;
        pause(100);
      }
    }
  } catch (e) {
    if (lockToken) releaseLock();
    throw e;
  }
  touched = true;
}

function end() {
  if (--depth > 0) return;
  try {
    if (touched && dirty) persist();
  } finally {
    touched = false;
    dirty = false;
    if (lockToken) releaseLock();
  }
}

// Run fn as one unit: its reads see the latest saved data, no other app can
// save in between, and its changes are written once when it returns. Nests:
// only the outermost call locks and saves. An async fn is covered up to its
// first await; anything after saves statement by statement.
function transaction(fn) {
  depth++;
  try {
    return fn();
  } finally {
    end();
  }
}

// Replace target with bytes in one step: write a temp file, rename it over.
function writeAtomic(target, bytes) {
  const tmp = target + ".tmp";
  fs.writeFileSync(tmp, bytes);
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(tmp, target);
      return;
    } catch (e) {
      if (!["EPERM", "EACCES", "EBUSY"].includes(e.code)) throw e;
      if (i >= 20) {
        // A scanner kept the file open for over a second. Write in place
        // rather than lose the change; the lock still keeps other apps out.
        fs.writeFileSync(target, bytes);
        try { fs.unlinkSync(tmp); } catch (_) {}
        return;
      }
      pause(50);
    }
  }
}

// Write the files whose contents changed. A save that only added history
// leaves the settings file alone, and the other way round.
function persist() {
  if (!db || !dbPath) return;
  const settings = Buffer.from(db.export());
  if (historyDb) attachHistory(); // export() reopens the connection without it
  if (!savedSettings || !settings.equals(savedSettings)) {
    writeAtomic(dbPath, settings);
    savedSettings = settings;
  }
  if (historyDb) {
    const history = Buffer.from(historyDb.export());
    if (!savedHistory || !history.equals(savedHistory)) {
      writeAtomic(historyPath, history);
      savedHistory = history;
    }
  }
  stampFiles();
}

// ---- Settings and history files ---------------------------------------------
// A shared database is two files in one folder: settings.sqlite (accounts, API
// keys, prompts, proxies, settings) and history.sqlite (application history and
// saved job posts). Each is opened as its own sql.js database, and the history
// one is ATTACHed to the settings connection as "history". SQLite looks an
// unqualified table name up in every attached file, so every existing query —
// including the ones joining history to accounts — runs unchanged. (Only a
// CREATE INDEX on a history table would need the "history." prefix.)

// sql.js keeps each database in a file of its own inside its in-memory
// filesystem, named by the database's `filename`; attaching that file is how
// one connection reaches both.
function attachHistory() {
  db.run(`ATTACH DATABASE '${historyDb.filename}' AS history`);
}

function openBytes(bytes) {
  // A copy: sql.js keeps a Node Buffer's memory as its file, so later writes
  // would change `bytes` too — and savedSettings/savedHistory along with them.
  const d = bytes ? new SQL.Database(new Uint8Array(bytes)) : new SQL.Database();
  try {
    d.exec("SELECT name FROM sqlite_master LIMIT 1"); // throws if not a database
  } catch (e) {
    try { d.close(); } catch (_) {}
    throw e;
  }
  return d;
}

function closeConnection() {
  try { if (db) db.close(); } catch (_) {}               // first: it holds the attachment
  try { if (historyDb) historyDb.close(); } catch (_) {}
  db = historyDb = null;
}

// Replace the open database with settingsBytes (null = empty) — plus, for a
// shared database, historyBytes (null = empty) attached as "history".
function connect(settingsBytes, historyBytes) {
  const nextDb = openBytes(settingsBytes);
  let nextHistory = null;
  try {
    if (historyPath) {
      nextHistory = openBytes(historyBytes);
      nextDb.run(`ATTACH DATABASE '${nextHistory.filename}' AS history`);
    }
  } catch (e) {
    try { nextDb.close(); } catch (_) {}
    try { if (nextHistory) nextHistory.close(); } catch (_) {}
    throw e;
  }
  closeConnection();
  db = nextDb;
  historyDb = nextHistory;
}

// Move history tables found in the settings file into the history file: an
// app's own database being shared, a shared file from before the split, or an
// imported backup. Rows keep their ids, so their links to accounts hold.
function moveHistoryOut(conn = db) {
  let moved = false;
  HISTORY_TABLES.forEach((t) => {
    const own = srcAll(conn, "SELECT sql FROM main.sqlite_master WHERE type = 'table' AND name = ?", [t])[0];
    if (!own) return;
    const there = srcAll(conn, "SELECT 1 FROM history.sqlite_master WHERE type = 'table' AND name = ?", [t])[0];
    if (!there) {
      // Recreate it exactly — every column it gained over the years — then copy.
      conn.run(own.sql.replace(/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`[]?\w+["`\]]?/i, `CREATE TABLE history.${t}`));
      conn.run(`INSERT INTO history.${t} SELECT * FROM main.${t}`);
    } else {
      const names = (schema) => srcAll(conn, `PRAGMA ${schema}.table_info(${t})`).map((c) => c.name);
      const theirs = new Set(names("history"));
      const cols = names("main").filter((c) => theirs.has(c)).join(", ");
      conn.run(`INSERT INTO history.${t} (${cols}) SELECT ${cols} FROM main.${t} WHERE id NOT IN (SELECT id FROM history.${t})`);
    }
    conn.run(`DROP TABLE main.${t}`);
    moved = true;
  });
  if (moved) conn.run("VACUUM main"); // give the space back: the settings file is saved most
}

// The database as the two files of a shared folder — { settings, history } —
// for a backup copy. Works from an app's own one-file database too.
function exportTwoFiles() {
  const out = openBytes(exportAll());
  const history = new SQL.Database();
  try {
    out.run(`ATTACH DATABASE '${history.filename}' AS history`);
    moveHistoryOut(out);
    out.run(ATTACHED_HISTORY_SCHEMA); // empty history tables when there was no history
    out.run("DETACH DATABASE history");
    return { settings: Buffer.from(out.export()), history: Buffer.from(history.export()) };
  } finally {
    try { out.close(); } catch (_) {}
    try { history.close(); } catch (_) {}
  }
}

// The whole database as one file — settings and history together, the shape
// of an app's own database and of a backup.
function exportAll() {
  return transaction(() => {
    touch();
    const settings = Buffer.from(db.export());
    if (!historyDb) return settings;
    attachHistory(); // export() reopens the connection without it
    const out = openBytes(settings);
    try {
      out.run(`ATTACH DATABASE '${historyDb.filename}' AS history`);
      HISTORY_TABLES.forEach((t) => {
        const stmt = out.prepare("SELECT sql FROM history.sqlite_master WHERE type = 'table' AND name = ?");
        stmt.bind([t]);
        const sql = stmt.step() ? stmt.getAsObject().sql : null;
        stmt.free();
        if (!sql) return;
        out.run(sql); // stored without a schema name, so it lands in the copy
        out.run(`INSERT INTO main.${t} SELECT * FROM history.${t}`);
      });
      out.run("DETACH DATABASE history");
      return Buffer.from(out.export());
    } finally {
      try { out.close(); } catch (_) {}
    }
  });
}

// ---- Noticing other apps' saves ---------------------------------------------
// Reads already reload a changed file, but a screen that's just sitting there
// wouldn't know to read again. For a shared database we watch the file and tell
// main.js, which tells the window.
let watchWanted = false;
let watcher = null;
let watchTimer = null;
let pollTimer = null;
let changeListener = null;

function onExternalChange(fn) {
  changeListener = fn;
}

function checkExternal() {
  if (depth > 0) return; // mid-save: our own write, or about to be re-read anyway
  if (reload(false) && changeListener) {
    try { changeListener(); } catch (_) {}
  }
}

function startWatching() {
  stopWatching();
  if (!dbPath) return;
  const names = [dbPath, historyPath].filter(Boolean).map((p) => path.basename(p).toLowerCase());
  try {
    // The folder, not the files: a save renames a new file into place, which
    // a watch on the old file would never see.
    watcher = fs.watch(path.dirname(dbPath), (_event, file) => {
      if (file && !names.includes(String(file).toLowerCase())) return;
      clearTimeout(watchTimer);
      watchTimer = setTimeout(checkExternal, 50); // just long enough to see the whole save
    });
    watcher.on("error", () => { try { watcher.close(); } catch (_) {} watcher = null; });
  } catch (_) {
    watcher = null;
  }
  // Safety net for events the watcher misses.
  pollTimer = setInterval(checkExternal, 2000);
  if (pollTimer.unref) pollTimer.unref();
}

function stopWatching() {
  clearTimeout(watchTimer);
  clearInterval(pollTimer);
  watchTimer = pollTimer = null;
  if (watcher) try { watcher.close(); } catch (_) {}
  watcher = null;
}

// Is filePath a database this app can use? Checked before switching to it.
function looksLikeAppDb(filePath) {
  let src;
  try {
    src = new SQL.Database(fs.readFileSync(filePath));
    return srcHasTable(src, "accounts") && srcHasTable(src, "prefs");
  } catch (_) {
    return false;
  } finally {
    try { if (src) src.close(); } catch (_) {}
  }
}

// Absolute path of the on-disk SQLite file — the settings file of a shared
// database.
function getDbPath() {
  return dbPath;
}

// The shared history file, or null for a one-file database.
function getHistoryPath() {
  return historyPath;
}

// A standalone .sqlite holding ONLY the application history — every column of
// every row, plus the accounts the entries point at so the file reads on its
// own. Separate from the Settings → Database backup, which copies everything
// (API keys, proxies, prompts, personal data). Returns the file's bytes.
function exportApplicationsDb() {
  syncFromDisk();
  const out = new SQL.Database();
  out.run(SCHEMA); // same shape, so an exported file is a valid RGenerator database

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
// app. For a shared database the backup's history replaces the history file.
function importDb(buffer) {
  openBytes(buffer).close(); // throws if not a real DB, before anything changes
  transaction(() => {
    const license = get("SELECT value FROM prefs WHERE key = 'license_key'");
    const keep = license ? license.value : null;
    connect(buffer, null);

    ensureSchema();
    if (keep) {
      run(
        `INSERT INTO prefs (key, value) VALUES ('license_key', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [keep]
      );
    }
    dirty = true;
  });
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

function exec(sql, params) {
  touch();
  const stmt = db.prepare(sql);
  stmt.bind(params || []);
  stmt.step();
  stmt.free();
  dirty = true;
}

function run(sql, params = []) {
  transaction(() => exec(sql, params));
}

// Several statements as ONE unit: read the file once, apply them all, write it
// once. persist() rewrites the entire database — 8MB and growing — so a loop of
// run() calls to renumber a list costs that once per row, and leaves the file in
// a half-renumbered state in between. Takes [[sql, params], …].
function runMany(statements) {
  const list = (statements || []).filter(Boolean);
  if (!list.length) return;
  transaction(() => list.forEach(([sql, params]) => exec(sql, params)));
}

function insert(sql, params = []) {
  return transaction(() => {
    exec(sql, params);
    // Read the id BEFORE the save: db.export() resets last_insert_rowid(), so
    // asking afterwards always returned 0. And no reload in between — the id
    // belongs to this connection, and a reload would swap it out.
    const rows = query("SELECT last_insert_rowid() AS id");
    return rows[0] ? rows[0].id : null;
  });
}

// Merge the application history out of an exported .sqlite. Entries already
// here are skipped — identified by their unique generation id (request_id), and
// for older entries that have none, by account + role + company + date. Rows are
// re-pointed at the local account of the same name, creating it if it's missing,
// because account ids differ between databases. One transaction: the duplicate
// check and the inserts see the same data, and the file is written once.
function importApplications(filePath) {
  return transaction(() => mergeApplications(filePath));
}

function mergeApplications(filePath) {
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
// The license key is never touched. Written to the file once, at the end.
function importSelected(filePath, selection = {}) {
  return transaction(() => mergeSelected(filePath, selection));
}

function mergeSelected(filePath, selection) {
  const src = new SQL.Database(fs.readFileSync(filePath));
  const nowIso = new Date().toISOString();
  const counts = { api_keys: 0, accounts: 0, instructions: 0, proxies: 0, prefs: 0 };
  const ids = (k) => (Array.isArray(selection[k]) ? selection[k].map(Number) : []);
  try {
    if (srcHasTable(src, "api_keys")) {
      ids("api_keys").forEach((id) => {
        const r = srcGet(src, "SELECT * FROM api_keys WHERE id = ?", [id]);
        if (!r) return;
        // Preserve the model; every key joins the one API list.
        insert(
          `INSERT INTO api_keys (name, api_key, provider, model, kind, is_active, sort_order, created_at)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
          [r.name ?? null, r.api_key ?? null, r.provider ?? "gemini", r.model ?? null,
           "v2", nextOrder("api_keys"), r.created_at ?? nowIso]
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
    return counts;
  } finally {
    try { src.close(); } catch (_) {}
  }
}

module.exports = {
  initDb, all, get, run, runMany, insert, getDbPath, importDb, scanFile, importSelected,
  exportApplicationsDb, importApplications,
  openAt, transaction, exportAll, exportTwoFiles, getHistoryPath, looksLikeAppDb, onExternalChange,
};
