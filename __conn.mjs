import path from "path";
import fs from "fs";
import initSqlJs from "./node_modules/sql.js/dist/sql-wasm.js";

const SQL = await initSqlJs({ locateFile: (f) => path.join("node_modules/sql.js/dist", f) });

const profiles = [
  ["installed app", path.join(process.env.APPDATA, "rgenerator", "rgenerator.sqlite")],
  ["unpacked build", path.join(process.env.APPDATA, "RGenerator (Unpacked)", "rgenerator.sqlite")],
];

for (const [label, file] of profiles) {
  console.log("=== " + label + " ===");
  if (!fs.existsSync(file)) { console.log("  (no database)\n"); continue; }
  const db = new SQL.Database(fs.readFileSync(file));
  const one = (sql) => { try { const r = db.exec(sql); return r.length ? r[0].values : []; } catch (e) { return [["ERR: " + e.message]]; } };

  const mode = one("SELECT value FROM prefs WHERE key='chat_conn_mode'");
  const pid = one("SELECT value FROM prefs WHERE key='chat_proxy_id'");
  const proxies = one("SELECT id, name, url, port, is_active FROM proxies");
  const keys = one("SELECT provider, COUNT(*) FROM api_keys GROUP BY provider");

  console.log("  chat_conn_mode: " + (mode.length ? mode[0][0] : "(unset -> direct)"));
  console.log("  chat_proxy_id:  " + (pid.length ? pid[0][0] : "(unset)"));
  console.log("  proxies rows:   " + proxies.length);
  for (const p of proxies) console.log("    id=" + p[0] + " name=" + p[1] + " url=" + p[2] + ":" + p[3] + " active=" + p[4]);
  console.log("  api keys:       " + (keys.length ? keys.map((k) => k[0] + "=" + k[1]).join(", ") : "none"));

  // This mirrors resolveConnection() in main.js.
  const m = mode.length ? String(mode[0][0]) : "direct";
  const usesProxy = m === "proxy" && proxies.length > 0;
  console.log("  => Gemini requests go: " + (usesProxy ? "THROUGH THE PROXY" : "DIRECT from this machine's IP"));
  console.log("");
}
