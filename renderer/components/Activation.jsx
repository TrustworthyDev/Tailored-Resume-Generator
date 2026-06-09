import { useEffect, useState } from "react";
import { api } from "../lib/api";

// Full-screen gate shown until the app is activated on this machine.
export default function Activation({ onActivated }) {
  const [machineId, setMachineId] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api().licenseStatus().then((s) => setMachineId((s && s.machineId) || ""));
  }, []);

  const activate = async () => {
    setBusy(true);
    setError("");
    const r = await api().activateLicense(key);
    setBusy(false);
    if (r && r.ok) onActivated();
    else setError((r && r.error) || "Invalid key.");
  };

  const copyId = () => navigator.clipboard.writeText(machineId);

  return (
    <div className="activation-screen">
      <div className="activation-card">
        <div className="brand-row">
          <span className="logo">C</span>
          <h1>Activate Careerva</h1>
        </div>
        <p className="muted">
          This copy must be activated on this machine. Share the Machine ID below
          to obtain a license key, then enter it to unlock the app.
        </p>

        <label className="field">
          <span className="field-label">Machine ID</span>
          <div className="row" style={{ marginTop: 0 }}>
            <input className="input" value={machineId} readOnly />
            <button className="btn" onClick={copyId}>Copy</button>
          </div>
        </label>

        <label className="field">
          <span className="field-label">License Key</span>
          <input
            className="input"
            placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
            value={key}
            onChange={(e) => { setKey(e.target.value); setError(""); }}
            onKeyDown={(e) => e.key === "Enter" && activate()}
          />
        </label>

        {error && <div className="error">{error}</div>}

        <div className="row">
          <button className="btn primary" onClick={activate} disabled={busy || !key.trim()}>
            {busy ? "Activating…" : "Activate"}
          </button>
        </div>
      </div>
    </div>
  );
}
