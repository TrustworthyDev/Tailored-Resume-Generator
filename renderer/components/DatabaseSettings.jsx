import { useEffect, useState } from "react";
import { api } from "../lib/api";

// Share one database with other RGenerator apps on this PC, back up (export)
// the whole database, or selectively import individual items (API keys,
// accounts, prompts, proxies, settings) from another .sqlite file.
export default function DatabaseSettings() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [scan, setScan] = useState(null); // { filePath, groups, own }
  const [selected, setSelected] = useState({}); // { groupId: { itemId: true } }
  const [loc, setLoc] = useState(null); // { shared, folder, path, historyPath, ownPath, ownExists }

  useEffect(() => { api().databaseLocation().then(setLoc); }, []);

  // While sharing: which apps are connected to the folder, refreshed as they come and go.
  const [apps, setApps] = useState([]);
  useEffect(() => {
    if (!loc || !loc.shared) return;
    const read = () => api().connectedApps().then((r) => setApps(Array.isArray(r) ? r : []));
    read();
    const t = setInterval(read, 3000);
    return () => clearInterval(t);
  }, [loc]);

  const reset = () => { setMsg(""); setErr(""); };

  // Run a sharing action. A switch reloads the window from the main process,
  // so only a refusal or an error ever comes back here to show.
  const sharingAction = async (call, ok) => {
    setBusy(true); reset(); setScan(null); setSelected({});
    try {
      const r = await call();
      if (r && r.ok) setMsg(ok(r));
      else if (!(r && r.canceled)) setErr((r && r.error) || "That didn't work.");
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const shareDb = () => sharingAction(() => api().shareDatabase(), (r) => `Now sharing ${r.folder} — reloading…`);
  const useSharedDb = () => sharingAction(() => api().useSharedDatabase(), (r) => `Now using ${r.folder} — reloading…`);
  const stopSharing = () => sharingAction(() => api().stopSharingDatabase(), () => "Stopped sharing — reloading…");
  const mergeOwnHistory = () =>
    sharingAction(
      () => api().mergeOwnHistory(),
      (r) => `Merged ${r.imported} application(s) from this app's own database` +
        (r.skipped ? `; ${r.skipped} were already there` : "") +
        (r.accountsCreated ? `; ${r.accountsCreated} account(s) added for them` : "") + "."
    );

  // Same pick-and-import panel as "Import selected data", fed from this app's
  // own database instead of a file the user picks.
  const chooseOwn = async () => {
    setBusy(true); reset(); setScan(null); setSelected({});
    try {
      const r = await api().scanOwnDatabase();
      if (r && r.ok) {
        if (!r.groups || !r.groups.length) setErr("This app's own database has nothing to merge.");
        else setScan({ filePath: r.filePath, groups: r.groups, own: true });
      } else {
        setErr((r && r.error) || "Could not read this app's own database.");
      }
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

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

  const exportTwo = async () => {
    setBusy(true); reset();
    try {
      const r = await api().exportTwoDatabaseFiles();
      if (r && r.ok) setMsg(`Exported settings.sqlite and history.sqlite to: ${r.folder}`);
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
        Share one database with other RGenerator apps on this PC, back up
        everything to a <strong>.sqlite</strong> file, or import selected items
        (accounts, API keys, prompts, proxies and settings) from another backup.
      </p>

      <label className="field">
        <span className="field-label">Shared database</span>
        <span className="muted small">
          Several RGenerator apps on this PC can use one database kept in a
          folder outside all of them, as two files: <strong>settings.sqlite</strong> (accounts,
          API keys, prompts, proxies, resume styles) and <strong>history.sqlite</strong> (application
          history). Each app keeps its own ChatGPT login, connection choice,
          selected account and generator drafts.
        </span>
      </label>
      {loc && (loc.shared ? (
        <>
          <div className="muted small db-location">
            Shared folder: <strong>{loc.folder}</strong>
          </div>
          <div className="muted small db-location">
            Settings: <strong>{loc.path}</strong><br />
            History: <strong>{loc.historyPath}</strong>
          </div>
          <div className="muted small db-location">
            Connected now:{" "}
            <strong>
              {apps.length ? apps.map((a) => a.name + (a.self ? " (this app)" : "")).join(", ") : "…"}
            </strong>
          </div>
          <div className="muted small db-location">
            To add another app: open its Settings → Database → <strong>Use a Shared Database…</strong> and pick this folder.
          </div>
          <div className="row">
            <button className="btn" onClick={useSharedDb} disabled={busy}>Use Another Shared Folder…</button>
            <button className="btn" onClick={stopSharing} disabled={busy}>Stop Sharing</button>
          </div>
          {loc.ownExists && (
            <>
              <span className="muted small db-location">
                This app's own database is kept as a backup. Bring any of it into the shared one:
              </span>
              <div className="row">
                <button className="btn" onClick={chooseOwn} disabled={busy}>Merge From This App's Own Database…</button>
                <button className="btn" onClick={mergeOwnHistory} disabled={busy}>Merge This App's Application History</button>
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <div className="muted small db-location">
            This app's own database: <strong>{loc.path}</strong>
          </div>
          <div className="row">
            <button className="btn primary" onClick={shareDb} disabled={busy}>Export to Shared Folder (2 Files)…</button>
            <button className="btn" onClick={useSharedDb} disabled={busy}>Use a Shared Database…</button>
          </div>
        </>
      ))}

      <label className="field" style={{ marginTop: 16 }}>
        <span className="field-label">Export</span>
        <span className="muted small">
          Save a full copy of your database as one file, or as the two files
          settings.sqlite and history.sqlite in a folder you choose. A copy is a
          backup: apps don't switch over to it.
        </span>
      </label>
      <div className="row">
        <button className="btn primary" onClick={exportDb} disabled={busy}>
          {busy && !scan ? "Working…" : "Export Database"}
        </button>
        <button className="btn" onClick={exportTwo} disabled={busy}>Export 2 Files…</button>
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
          <div className="import-src muted small">
            From: {scan.own ? "this app's own database" : scan.filePath}
          </div>

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
