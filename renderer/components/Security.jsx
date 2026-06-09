import { useEffect, useState } from "react";
import { api } from "../lib/api";

export default function Security() {
  const [status, setStatus] = useState({ activated: false, machineId: "", key: "" });
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState(null); // { type, text }

  const refresh = () => api().licenseStatus().then((s) => s && setStatus(s));
  useEffect(() => { refresh(); }, []);

  const apply = async () => {
    setMsg(null);
    const r = await api().activateLicense(key);
    if (r && r.ok) { setMsg({ type: "ok", text: "Activated for this machine." }); setKey(""); refresh(); }
    else setMsg({ type: "warn", text: (r && r.error) || "Invalid key." });
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Security</h2>
        {status.activated ? (
          <span className="badge live">activated</span>
        ) : (
          <span className="badge off">not activated</span>
        )}
      </div>
      <p className="muted">
        Careerva is locked to this machine. Activation uses a license key
        generated for the Machine ID below.
      </p>

      <label className="field">
        <span className="field-label">Machine ID</span>
        <div className="row" style={{ marginTop: 0 }}>
          <input className="input" value={status.machineId} readOnly />
          <button className="btn" onClick={() => navigator.clipboard.writeText(status.machineId)}>Copy</button>
        </div>
      </label>

      {status.activated && status.key && (
        <label className="field">
          <span className="field-label">Active License Key</span>
          <div className="row" style={{ marginTop: 0 }}>
            <input className="input" value={status.key} readOnly />
            <button className="btn" onClick={() => navigator.clipboard.writeText(status.key)}>Copy</button>
          </div>
        </label>
      )}

      <label className="field">
        <span className="field-label">
          {status.activated ? "Replace License Key" : "License Key"}
        </span>
        <input className="input" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
          value={key} onChange={(e) => { setKey(e.target.value); setMsg(null); }} />
      </label>

      {msg && <div className={msg.type === "warn" ? "error" : "ok-box"}>{msg.text}</div>}

      <div className="row">
        <button className="btn primary" onClick={apply} disabled={!key.trim()}>
          {status.activated ? "Replace Key" : "Activate"}
        </button>
      </div>
    </section>
  );
}
