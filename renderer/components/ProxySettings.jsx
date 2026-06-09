import { useEffect, useState } from "react";
import { api } from "../lib/api";
import ConfirmModal from "./ConfirmModal";

const EMPTY = { url: "", port: "", username: "", password: "" };

export default function ProxySettings() {
  const [proxies, setProxies] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [testMsg, setTestMsg] = useState(null); // form test result
  const [busy, setBusy] = useState(false);
  const [checkingId, setCheckingId] = useState(null);
  const [checkMsg, setCheckMsg] = useState({}); // id -> { type, text }
  const [confirmId, setConfirmId] = useState(null);

  const load = async () => {
    const rows = await api().listProxies();
    setProxies(rows || []);
    if (!rows || rows.length === 0) setShowForm(true);
  };
  useEffect(() => { load(); }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setError("");
    const res = await api().addProxy(form);
    if (!res || !res.ok) { setError((res && res.error) || "Could not save proxy."); return; }
    setForm(EMPTY);
    setShowForm(false);
    setTestMsg(null);
    load();
  };

  const test = async () => {
    setBusy(true);
    setTestMsg(null);
    const r = await api().checkProxy(form);
    setBusy(false);
    if (r && r.ok) setTestMsg({ type: "ok", text: `Proxy works${r.ip ? ` — exit IP ${r.ip}` : ""}.` });
    else setTestMsg({ type: "warn", text: (r && r.error) || "Proxy check failed." });
  };

  // Test an existing saved proxy in the list.
  const check = async (p) => {
    setCheckingId(p.id);
    setCheckMsg((m) => ({ ...m, [p.id]: null }));
    const r = await api().checkProxy({ url: p.url, port: p.port, username: p.username, password: p.password });
    setCheckingId(null);
    setCheckMsg((m) => ({
      ...m,
      [p.id]: r && r.ok
        ? { type: "ok", text: `Working${r.ip ? ` — exit IP ${r.ip}` : ""}` }
        : { type: "warn", text: (r && r.error) || "Not reachable" },
    }));
  };

  const setActive = async (id) => { await api().setActiveProxy(id); load(); };
  const disable = async () => { await api().disableProxy(); load(); };
  const doDelete = async () => {
    const id = confirmId;
    setConfirmId(null);
    if (id == null) return;
    await api().deleteProxy(id);
    load();
  };

  const anyActive = proxies.some((p) => p.is_active);
  const confirmTarget = proxies.find((p) => p.id === confirmId);

  return (
    <section className="card">
      <div className="card-head">
        <h2>Proxies</h2>
        <div className="list-actions">
          {anyActive && <button className="btn small" onClick={disable}>Disable</button>}
          <button className="btn primary" onClick={() => { setForm(EMPTY); setShowForm(true); setTestMsg(null); }}>
            + Add New
          </button>
        </div>
      </div>
      <p className="muted">
        Resume generation runs through the active proxy. One proxy can be active
        at a time.
      </p>

      {showForm && (
        <div className="subcard">
          <div className="grid2">
            <label className="field">
              <span className="field-label">Host / URL</span>
              <input className="input" placeholder="e.g. 1.2.3.4 or proxy.example.com"
                value={form.url} onChange={set("url")} />
            </label>
            <label className="field">
              <span className="field-label">Port</span>
              <input className="input" placeholder="e.g. 8080" value={form.port} onChange={set("port")} />
            </label>
            <label className="field">
              <span className="field-label">Username (optional)</span>
              <input className="input" value={form.username} onChange={set("username")} />
            </label>
            <label className="field">
              <span className="field-label">Password (optional)</span>
              <input className="input" type="password" value={form.password} onChange={set("password")} />
            </label>
          </div>
          {error && <div className="error">{error}</div>}
          {testMsg && <div className={testMsg.type === "warn" ? "error" : "ok-box"}>{testMsg.text}</div>}
          <div className="row">
            <button className="btn primary" onClick={save}>Save</button>
            <button className="btn" onClick={test} disabled={busy || !form.url.trim()}>
              {busy ? "Testing…" : "Test"}
            </button>
            {proxies.length > 0 && (
              <button className="btn" onClick={() => { setShowForm(false); setError(""); setTestMsg(null); }}>Cancel</button>
            )}
          </div>
        </div>
      )}

      <div className="list">
        {proxies.map((p) => (
          <div className={p.is_active ? "list-item active-row" : "list-item"} key={p.id}>
            <div className="instr-info">
              <strong>{p.url}{p.port ? `:${p.port}` : ""}</strong>
              {p.is_active ? <span className="badge live badge-gap">active</span> : null}
              {p.username ? <div className="muted small">user: {p.username}</div> : null}
              {checkMsg[p.id] && (
                <div className="small" style={{ marginTop: 4, color: checkMsg[p.id].type === "ok" ? "var(--ok)" : "#ff9a9a" }}>
                  {checkMsg[p.id].text}
                </div>
              )}
            </div>
            <div className="list-actions">
              {!p.is_active && <button className="btn small" onClick={() => setActive(p.id)}>Set active</button>}
              <button className="btn small" onClick={() => check(p)} disabled={checkingId === p.id}>
                {checkingId === p.id ? "Checking…" : "Check"}
              </button>
              <button className="btn small danger" onClick={() => setConfirmId(p.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>

      <ConfirmModal
        open={confirmId != null}
        title="Delete proxy?"
        message={`"${confirmTarget ? confirmTarget.url : "This proxy"}" will be removed. This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={doDelete}
        onCancel={() => setConfirmId(null)}
      />
    </section>
  );
}
