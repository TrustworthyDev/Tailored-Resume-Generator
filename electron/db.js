// SQLite persistence layer using sql.js (SQLite compiled to WebAssembly).
// A real .sqlite file is kept on disk in the app's userData directory and
// re-written after every mutation. No native build tools required.

const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");

let db = null;
let dbPath = null;

async function initDb(userDataDir) {
  const SQL = await initSqlJs({
    locateFile: (file) =>
      path.join(__dirname, "..", "node_modules", "sql.js", "dist", file),
  });

  dbPath = path.join(userDataDir, "careerva.sqlite");

  if (fs.existsSync(dbPath)) {
    db = new SQL.Database(fs.readFileSync(dbPath));
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT,
      api_key    TEXT,
      provider   TEXT,
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
      applied_at TEXT,
      pdf_path   TEXT
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
      url       TEXT,
      port      TEXT,
      username  TEXT,
      password  TEXT,
      is_active INTEGER DEFAULT 0,
      created_at TEXT
    );
  `);

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

  // Ensure api_keys has a provider column (multi-provider support).
  const keyCols = all("PRAGMA table_info(api_keys)");
  if (!keyCols.some((c) => c.name === "provider")) {
    db.run("ALTER TABLE api_keys ADD COLUMN provider TEXT");
  }
  db.run("UPDATE api_keys SET provider = 'gemini' WHERE provider IS NULL OR provider = ''");

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
  ].forEach(([col, type]) => {
    if (!appCols.some((c) => c.name === col)) {
      db.run(`ALTER TABLE applications ADD COLUMN ${col} ${type}`);
    }
  });

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

function persist() {
  if (!db || !dbPath) return;
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function get(sql, params = []) {
  return all(sql, params)[0] || null;
}

function run(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  stmt.step();
  stmt.free();
  persist();
}

function insert(sql, params = []) {
  run(sql, params);
  const row = get("SELECT last_insert_rowid() AS id");
  return row ? row.id : null;
}

module.exports = { initDb, all, get, run, insert };
