import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { countryFlag } from "../lib/flags";
import ConfirmModal from "./ConfirmModal";

// Local YYYY-MM-DD for a date (or now).
function ymd(d = new Date()) {
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

// Account list on the left; the selected account's generated-resume history on
// the right, filtered to a chosen day. A search box filters across accounts
// (and all dates) by name / role / company.
export default function Applications() {
  const [accounts, setAccounts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [apps, setApps] = useState([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [counts, setCounts] = useState({ total: 0, counts: {} });
  const [confirmReset, setConfirmReset] = useState(false);
  const [date, setDate] = useState(ymd()); // selected day; defaults to today

  const reload = async () => {
    const c = await api().applicationCounts();
    setCounts(c || { total: 0, counts: {} });
    if (selectedId != null) {
      const r = await api().applicationsByAccount(selectedId);
      setApps(r || []);
    }
  };

  const doReset = async () => {
    setConfirmReset(false);
    await api().resetApplications();
    setQuery("");
    setResults([]);
    await reload();
  };

  useEffect(() => {
    api().listAccounts().then((rows) => {
      setAccounts(rows || []);
      if (rows && rows.length) setSelectedId(rows[0].id);
    });
    api().applicationCounts().then((c) => c && setCounts(c));
  }, []);

  useEffect(() => {
    if (selectedId == null) { setApps([]); return; }
    api().applicationsByAccount(selectedId).then((rows) => setApps(rows || []));
  }, [selectedId]);

  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults([]); return; }
    api().searchApplications(q).then((rows) => setResults(rows || []));
  }, [query]);

  const fmtDate = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleString();
  };

  const [fileMsg, setFileMsg] = useState("");
  const [copiedId, setCopiedId] = useState(null);
  const openAppFolder = async (p) => {
    const r = await api().revealPdf(p);
    setFileMsg(r && !r.ok ? r.error || "Could not open the folder." : "");
  };
  const openAppFile = async (p) => {
    const r = await api().openPdf(p);
    setFileMsg(r && !r.ok ? r.error || "Could not open the file." : "");
  };
  const copyLocation = async (a) => {
    const folder = (a.pdf_path || "").replace(/[\\/][^\\/]*$/, "");
    if (!folder) return;
    await navigator.clipboard.writeText(folder);
    setCopiedId(a.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const searching = query.trim().length > 0;
  // History view shows only the selected day's applications; search ignores it.
  const dayApps = apps.filter((a) => ymd(new Date(a.applied_at)) === date);
  const rows = searching ? results : dayApps;
  const isToday = date === ymd();

  const country = (c) =>
    c ? (
      <>
        <span className="flag">{countryFlag(c)}</span>
        {c}
      </>
    ) : ("—");

  return (
    <div className="account-layout">
      {/* Account list */}
      <div className="accounts-panel">
        <div className="total-box">
          <span className="muted small">Total Applications</span>
          <strong className="total-num">{counts.total}</strong>
        </div>
        <div className="accounts-head">
          <span className="panel-title">Accounts</span>
        </div>
        <div className="accounts-list">
          {accounts.length === 0 && (
            <p className="muted small" style={{ padding: "8px 4px" }}>No accounts yet.</p>
          )}
          {accounts.map((a) => (
            <div
              key={a.id}
              className={
                a.id === selectedId && !searching ? "account-item active" : "account-item"
              }
              onClick={() => { setSelectedId(a.id); setQuery(""); }}
            >
              <div className="account-meta">
                <strong>
                  {a.name || "(unnamed)"}
                  {a.main_stack ? ` (${a.main_stack})` : ""}
                </strong>
                <span className="muted small">{country(a.country)}</span>
              </div>
              <span className="count-badge">{counts.counts[a.id] || 0}</span>
            </div>
          ))}
        </div>
      </div>

      {/* History / search results */}
      <div className="account-detail">
        <section className="card">
          <div className="card-head">
            <h2>{searching ? "Search Results" : "Application History"}</h2>
            <div className="list-actions">
              {!searching && (
                <>
                  <input
                    type="date"
                    className="input date-input"
                    value={date}
                    max={ymd()}
                    onChange={(e) => setDate(e.target.value || ymd())}
                    title="Show applications from this day"
                  />
                  {!isToday && (
                    <button className="btn small" onClick={() => setDate(ymd())}>
                      Today
                    </button>
                  )}
                  <button
                    className="btn small danger"
                    onClick={() => setConfirmReset(true)}
                    disabled={counts.total === 0}
                    title="Delete all application history"
                  >
                    Reset the History
                  </button>
                </>
              )}
              <span className="muted small">{rows.length} total</span>
            </div>
          </div>

          <input
            className="input"
            placeholder="Search by account, role, or company…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          {!searching && !selectedId && (
            <p className="muted" style={{ marginTop: 14 }}>Select an account.</p>
          )}
          {rows.length === 0 && (searching || selectedId) && (
            <p className="muted" style={{ marginTop: 14 }}>
              {searching
                ? "No matches."
                : isToday
                ? "No applications today yet — generate a resume to record one."
                : "No applications on this day."}
            </p>
          )}

          {fileMsg && <div className="error">{fileMsg}</div>}

          <div className="app-list">
            {rows.map((a) => (
              <div className="app-card" key={a.id}>
                <div className="app-role">{a.role || "(untitled role)"}</div>
                <div className="app-meta">
                  <span className="app-company">{a.company || "—"}</span>
                  <span className="app-country">{country(a.country)}</span>
                  <span className="muted">{fmtDate(a.applied_at)}</span>
                </div>
                {searching && a.account_name && (
                  <div className="muted small" style={{ marginTop: 6 }}>
                    Account: {a.account_name}
                  </div>
                )}
                {a.pdf_path && (
                  <div className="app-actions">
                    <button className="btn small" onClick={() => copyLocation(a)}>
                      {copiedId === a.id ? "Copied ✓" : "Copy Location"}
                    </button>
                    <button className="btn small" onClick={() => openAppFolder(a.pdf_path)}>
                      Open Folder
                    </button>
                    <button className="btn small" onClick={() => openAppFile(a.pdf_path)}>
                      Open File
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>

      <ConfirmModal
        open={confirmReset}
        title="Reset application history?"
        message={`This permanently deletes ALL application history (${counts.total} ${
          counts.total === 1 ? "application" : "applications"
        } across all accounts). This cannot be undone.`}
        confirmLabel="Reset"
        onConfirm={doReset}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}
