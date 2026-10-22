import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useDbChanged } from "../lib/useDbChanged";
import ConfirmModal from "./ConfirmModal";

const EMPTY = { name: "", url: "", port: "", username: "", password: "" };

// What to call a proxy in the list: its name if given, else host:port.
const proxyTitle = (p) =>
  (p && p.name && p.name.trim()) || [p && p.url, p && p.port].filter(Boolean).join(":") || "(proxy)";

export default function ProxySettings() {
  const [proxies, setProxies] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null); // null = adding a new proxy
  const [showPassword, setShowPassword] = useState(false); // reveal the Password field as text
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
  useDbChanged(load); // another app saved to the shared database

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const startAdd = () => {
    setShowPassword(false);
    setForm(EMPTY);
    setEditingId(null);
    setShowForm(true);
    setError("");
    setTestMsg(null);
  };
  // Edit opens the form in place of the proxy's row, filled with its details.
  const startEdit = (p) => {
    setShowPassword(false);
    setForm({
      name: p.name || "",
      url: p.url || "",
      port: p.port || "",
      username: p.username || "",
      password: p.password || "",
    });
    setEditingId(p.id);
    setShowForm(true);
    setError("");
    setTestMsg(null);
  };
  const cancelForm = () => {
    setShowPassword(false);
    setShowForm(false);
    setEditingId(null);
    setError("");
    setTestMsg(null);
  };

  const save = async () => {
    setError("");
    const res = editingId != null
      ? await api().updateProxy({ ...form, id: editingId })
      : await api().addProxy(form);
    if (!res || !res.ok) { setError((res && res.error) || "Could not save proxy."); return; }
    // An edited proxy's last check result no longer describes it.
    if (editingId != null) setCheckMsg((m) => ({ ...m, [editingId]: null }));
    setForm(EMPTY);
    setShowForm(false);
    setEditingId(null);
    setShowPassword(false);
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
    if (editingId === id) cancelForm();
    load();
  };

  const anyActive = proxies.some((p) => p.is_active);
  const confirmTarget = proxies.find((p) => p.id === confirmId);

  // The add / edit form: at the top when adding, in place of the row when editing.
  const formCard = (
    <div className="subcard">
      {editingId != null && <div className="field-label" style={{ marginBottom: 8 }}>Edit proxy</div>}
      <label className="field">
        <span className="field-label field-label-row">
          Name
          <span className="muted small">optional · how this proxy is listed and picked</span>
        </span>
        <input className="input" placeholder="e.g. Seller — London residential"
          value={form.name} onChange={set("name")} />
      </label>
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
          <div className="input-with-btn">
            <input
              className="input"
              type={showPassword ? "text" : "password"}
              value={form.password}
              onChange={set("password")}
            />
            <button
              type="button"
              className="input-eye"
              onClick={() => setShowPassword((v) => !v)}
              title={showPassword ? "Hide password" : "Show password"}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
        </label>
      </div>
      {error && <div className="error">{error}</div>}
      {testMsg && <div className={testMsg.type === "warn" ? "error" : "ok-box"}>{testMsg.text}</div>}
      <div className="row">
        <button className="btn primary" onClick={save}>{editingId != null ? "Save changes" : "Save"}</button>
        <button className="btn" onClick={test} disabled={busy || !form.url.trim()}>
          {busy ? "Testing…" : "Test"}
        </button>
        {(proxies.length > 0 || editingId != null) && (
          <button className="btn" onClick={cancelForm}>Cancel</button>
        )}
      </div>
    </div>
  );

  return (
    <section className="card">
      <div className="card-head">
        <h2>Proxies</h2>
        <div className="list-actions">
          {anyActive && <button className="btn small" onClick={disable}>Disable</button>}
          <button className="btn primary" onClick={startAdd}>
            + Add New
          </button>
        </div>
      </div>
      <p className="muted">
        Resume generation runs through the active proxy. One proxy can be active
        at a time.
      </p>

      {showForm && editingId == null && formCard}

      <div className="list">
        {proxies.map((p) =>
          showForm && editingId === p.id ? (
            <div key={p.id}>{formCard}</div>
          ) : (
            <div className={p.is_active ? "list-item active-row" : "list-item"} key={p.id}>
              <div className="instr-info">
                <strong>{proxyTitle(p)}</strong>
                {p.is_active ? <span className="badge live badge-gap">active</span> : null}
                {/* When a name is shown above, the endpoint still needs to be visible. */}
                {p.name && p.name.trim() ? (
                  <div className="muted small">{p.url}{p.port ? `:${p.port}` : ""}</div>
                ) : null}
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
                <button className="btn small" onClick={() => startEdit(p)}>Edit</button>
                <button className="btn small danger" onClick={() => setConfirmId(p.id)}>Delete</button>
              </div>
            </div>
          )
        )}
      </div>

      <ConfirmModal
        open={confirmId != null}
        title="Delete proxy?"
        message={`"${confirmTarget ? proxyTitle(confirmTarget) : "This proxy"}" will be removed. This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={doDelete}
        onCancel={() => setConfirmId(null)}
      />
    </section>
  );
}
