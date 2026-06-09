import { useEffect, useState } from "react";
import { api } from "../lib/api";

// Where generated resume PDFs are saved.
export default function LocationSettings() {
  const [path, setPath] = useState("");

  const load = () => api().getDownloadLocation().then((r) => setPath((r && r.path) || ""));
  useEffect(() => { load(); }, []);

  const choose = async () => {
    const r = await api().chooseDownloadLocation();
    if (r && r.path) setPath(r.path);
  };

  const open = () => api().openDownloadLocation();

  return (
    <section className="card">
      <div className="card-head">
        <h2>Download Folder</h2>
      </div>
      <p className="muted">
        Generated resumes (and cover letters) are saved here, grouped by
        account and job.
      </p>

      <label className="field">
        <span className="field-label">Current folder</span>
        <input className="input" value={path} readOnly />
      </label>

      <div className="row">
        <button className="btn primary" onClick={choose}>Choose Folder</button>
        <button className="btn" onClick={open}>Open Folder</button>
      </div>
    </section>
  );
}
