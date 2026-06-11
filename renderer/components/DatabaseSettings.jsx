import { useState } from "react";
import { api } from "../lib/api";

// Back up (export) the whole database, or selectively import individual items
// (API keys, accounts, prompts, proxies, settings) from another .sqlite file.
export default function DatabaseSettings() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [scan, setScan] = useState(null); // { filePath, groups }
  const [selected, setSelected] = useState({}); // { groupId: { itemId: true } }

  const reset = () => { setMsg(""); setErr(""); };

  const exportDb = async () => {
    setBusy(true); reset();
    try {
      const r = await api().exportDatabase();
      if (r && r.ok) setMsg(`Database exported to: ${r.path}`);
      else if (!(r && r.canceled)) setErr((r && r.error) || "Export failed.");
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const chooseSource = async () => {
    setBusy(true); reset(); setScan(null); setSelected({});
    try {
      const r = await api().scanDatabase();
      if (r && r.ok) {
        if (!r.groups || !r.groups.length) setErr("That database has no importable data.");
        else setScan({ filePath: r.filePath, groups: r.groups });
      } else if (!(r && r.canceled)) {
        setErr((r && r.error) || "Could not read that file.");
      }
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const isChecked = (gid, iid) => !!(selected[gid] && selected[gid][iid]);
  const toggleItem = (gid, iid) =>
    setSelected((s) => ({ ...s, [gid]: { ...s[gid], [iid]: !(s[gid] && s[gid][iid]) } }));
  const groupAllChecked = (g) => g.items.every((it) => isChecked(g.id, it.id));
  const toggleGroup = (g) => {
    const turnOn = !groupAllChecked(g);
    setSelected((s) => {
      const next = { ...(s[g.id] || {}) };
      g.items.forEach((it) => { next[it.id] = turnOn; });
      return { ...s, [g.id]: next };
    });
  };

  const buildSelection = () => {
    const out = {};
    (scan ? scan.groups : []).forEach((g) => {
      const picked = g.items.filter((it) => isChecked(g.id, it.id)).map((it) => it.id);
      if (picked.length) out[g.id] = picked;
    });
    return out;
  };
  const selectedCount = scan
    ? scan.groups.reduce((n, g) => n + g.items.filter((it) => isChecked(g.id, it.id)).length, 0)
    : 0;

  const importSelected = async () => {
    const selection = buildSelection();
    setBusy(true); reset();
    try {
      const r = await api().importSelectedDatabase({ filePath: scan.filePath, selection });
      if (r && r.ok) {
        const c = r.counts || {};
        const parts = [
          c.accounts && `${c.accounts} account(s)`,
          c.api_keys && `${c.api_keys} API key(s)`,
          c.instructions && `${c.instructions} prompt(s)`,
          c.proxies && `${c.proxies} prox(ies)`,
          c.prefs && `${c.prefs} setting(s)`,
        ].filter(Boolean);
        setScan(null);
        setSelected({});
        setMsg(`Imported ${parts.join(", ") || "nothing"} — reloading…`);
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setErr((r && r.error) || "Import failed.");
      }
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Database</h2>
      </div>
      <p className="muted">
        Back up everything to a <strong>.sqlite</strong> file, or import selected
        items (accounts, API keys, prompts, proxies and settings) from another
        backup.
      </p>

      <label className="field">
        <span className="field-label">Export</span>
        <span className="muted small">Save a full copy of your database to a file you choose.</span>
      </label>
      <div className="row">
        <button className="btn primary" onClick={exportDb} disabled={busy}>
          {busy && !scan ? "Working…" : "Export Database"}
        </button>
      </div>

      <label className="field" style={{ marginTop: 16 }}>
        <span className="field-label">Import selected data</span>
        <span className="muted small">
          Pick a backup, then tick exactly which items to bring in. Items are
          added alongside your current data; settings are overwritten. Your
          activation stays on this machine.
        </span>
      </label>

      {!scan ? (
        <div className="row">
          <button className="btn" onClick={chooseSource} disabled={busy}>
            {busy ? "Reading…" : "Choose Database…"}
          </button>
        </div>
      ) : (
        <div className="import-panel">
          <div className="import-src muted small">From: {scan.filePath}</div>

          {scan.groups.map((g) => (
            <div key={g.id} className="import-group">
              <label className="import-group-head">
                <input
                  type="checkbox"
                  checked={groupAllChecked(g)}
                  onChange={() => toggleGroup(g)}
                />
                <strong>{g.label}</strong>
                <span className="muted small">({g.items.length})</span>
              </label>
              <div className="import-items">
                {g.items.map((it) => (
                  <label key={String(it.id)} className="import-item">
                    <input
                      type="checkbox"
                      checked={isChecked(g.id, it.id)}
                      onChange={() => toggleItem(g.id, it.id)}
                    />
                    <span>{it.label}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}

          <div className="row">
            <button className="btn primary" onClick={importSelected} disabled={busy || !selectedCount}>
              {busy ? "Importing…" : `Import Selected (${selectedCount})`}
            </button>
            <button className="btn" onClick={() => { setScan(null); setSelected({}); }} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {msg && <div className="ok-box" style={{ marginTop: 12 }}>{msg}</div>}
      {err && <div className="error" style={{ marginTop: 12 }}>{err}</div>}
    </section>
  );
}
