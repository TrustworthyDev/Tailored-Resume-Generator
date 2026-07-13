import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { countryFlag } from "../lib/flags";
import ConfirmModal from "./ConfirmModal";

// Local YYYY-MM-DD for a date (or now).
function ymd(d = new Date()) {
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

// Two tabs:
//   • All Applications — every generated resume across all accounts, with a
//     free-text search and an optional day filter.
//   • By Account — pick an account on the left, see its history on the right,
//     also searchable and filterable by day.
export default function Applications() {
  const [tab, setTab] = useState("all"); // "all" | "byAccount"

  const [accounts, setAccounts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [apps, setApps] = useState([]); // selected account's history
  const [allApps, setAllApps] = useState([]); // every application
  const [counts, setCounts] = useState({ total: 0, counts: {} });
  const [confirmReset, setConfirmReset] = useState(false);

  // Independent filters per tab so switching tabs doesn't carry a stale filter.
  const [allQuery, setAllQuery] = useState("");
  const [allDate, setAllDate] = useState(""); // "" = all dates
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [date, setDate] = useState(""); // by-account day filter; "" = all dates

  const [fileMsg, setFileMsg] = useState("");
  const [copiedId, setCopiedId] = useState(null);

  const loadAll = async () => {
    const [c, all] = await Promise.all([
      api().applicationCounts(),
      api().allApplications(),
    ]);
    setCounts(c || { total: 0, counts: {} });
    setAllApps(all || []);
  };

  useEffect(() => {
    api().listAccounts().then((rows) => {
      setAccounts(rows || []);
      if (rows && rows.length) setSelectedId(rows[0].id);
    });
    loadAll();
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

  const doReset = async () => {
    setConfirmReset(false);
    await api().resetApplications();
    setQuery("");
    setResults([]);
    setAllQuery("");
    if (selectedId != null) {
      const r = await api().applicationsByAccount(selectedId);
      setApps(r || []);
    }
    await loadAll();
  };

  const doExport = async () => {
    const r = await api().exportApplications();
    if (r && r.ok) setFileMsg(`Exported ${r.count} application${r.count === 1 ? "" : "s"} to ${r.path}`);
    else if (r && !r.canceled) setFileMsg(r && r.error ? r.error : "Could not export the history.");
  };

  const fmtDate = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleString();
  };

  const openAppFolder = async (p) => {
    const r = await api().revealPdf(p);
    setFileMsg(r && !r.ok ? r.error || "Could not open the folder." : "");
  };
  // Reopen the ChatGPT conversation where this resume was generated (it already
  // contains the app's prompt and the resume result).
  const openGpt = async (a) => {
    setFileMsg("");
    const r = await api().openGptForApplication(a.id);
    if (!(r && r.ok)) setFileMsg((r && r.error) || "Could not open ChatGPT for this application.");
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

  const country = (c) =>
    c ? (
      <>
        <span className="flag">{countryFlag(c)}</span>
        {c}
      </>
    ) : ("—");

  const matchesQuery = (a, q) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return [a.role, a.company, a.account_name, a.country].some((v) =>
      (v || "").toLowerCase().includes(s)
    );
  };

  // One application card — shared by both tabs. showAccount adds the owning
  // account's name (used in the All / search views where it isn't implied).
  const renderApp = (a, showAccount) => {
    const cat = a.account_stack ? <span className="cat-chip">{a.account_stack}</span> : null;
    const meta = [];
    if (a.company) meta.push(<span key="c" className="app-company">{a.company}</span>);
    if (a.country) meta.push(<span key="ct" className="app-country">{country(a.country)}</span>);
    if (showAccount && a.account_name) meta.push(<span key="ac">Account: {a.account_name}{cat}</span>);
    else if (cat) meta.push(<span key="cat">{cat}</span>);
    return (
      <div className="app-card" key={a.id}>
        <div className="app-top">
          <span className="app-role">{a.role || "(untitled role)"}</span>
          <span className="app-date muted">{fmtDate(a.applied_at)}</span>
        </div>
        {a.request_id && (
          <div className="muted small app-reqid" title="Unique generation ID">ID: {a.request_id}</div>
        )}
        {meta.length > 0 && (
          <div className="app-sub">
            {meta.map((m, i) => (
              <span key={i} style={{ display: "inline-flex", alignItems: "center" }}>
                {i > 0 && <span className="sep" style={{ marginRight: 8 }}>·</span>}
                {m}
              </span>
            ))}
          </div>
        )}
        {(a.pdf_path || a.has_gpt) && (
          <div className="app-actions">
            {a.has_gpt ? (
              <button
                className="btn small"
                onClick={() => openGpt(a)}
                title="Reopen the ChatGPT conversation where this resume was generated"
              >
                Open GPT
              </button>
            ) : null}
            {a.pdf_path && (
              <>
                <button className="btn small" onClick={() => copyLocation(a)}>
                  {copiedId === a.id ? "Copied ✓" : "Copy Location"}
                </button>
                <button className="btn small" onClick={() => openAppFolder(a.pdf_path)}>
                  Open Folder
                </button>
                <button className="btn small" onClick={() => openAppFile(a.pdf_path)}>
                  Open File
                </button>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  // ---- All Applications tab data ----
  const allRows = allApps.filter(
    (a) => matchesQuery(a, allQuery) && (!allDate || ymd(new Date(a.applied_at)) === allDate)
  );

  // ---- By Account tab data ----
  const searching = query.trim().length > 0;
  // No date chosen => show the whole account history; a date narrows to that day.
  const dayApps = apps.filter((a) => !date || ymd(new Date(a.applied_at)) === date);
  const rows = searching ? results : dayApps;

  return (
    <div className="stack">
      {/* Tab bar */}
      <div className="resume-tabs apps-tabs">
        <button
          type="button"
          className={"resume-tab" + (tab === "all" ? " active" : "")}
          onClick={() => setTab("all")}
        >
          All Applications
        </button>
        <button
          type="button"
          className={"resume-tab" + (tab === "byAccount" ? " active" : "")}
          onClick={() => setTab("byAccount")}
        >
          By Account
        </button>
        <span className="resume-tabs-spacer" />
        <span className="field-label" style={{ margin: 0 }}>
          Total <span className="badge live badge-gap">{counts.total}</span>
        </span>
      </div>

      {fileMsg && <div className="error">{fileMsg}</div>}

      {tab === "all" ? (
        /* ---------- ALL APPLICATIONS ---------- */
        <section className="card">
          <div className="card-head">
            <h2>All Applications</h2>
            <div className="list-actions">
              <input
                type="date"
                className="input date-input"
                value={allDate}
                max={ymd()}
                onChange={(e) => setAllDate(e.target.value)}
                title="Filter to a single day"
              />
              {allDate && (
                <button className="btn small" onClick={() => setAllDate("")}>
                  All dates
                </button>
              )}
              <button
                className="btn small"
                onClick={doExport}
                disabled={counts.total === 0}
                title="Export the whole history to a CSV file"
              >
                Export
              </button>
              <button
                className="btn small danger"
                onClick={() => setConfirmReset(true)}
                disabled={counts.total === 0}
                title="Delete all application history"
              >
                Reset the History
              </button>
              <span className="muted small">{allRows.length} shown</span>
            </div>
          </div>

          <input
            className="input"
            placeholder="Search by account, role, company, or country…"
            value={allQuery}
            onChange={(e) => setAllQuery(e.target.value)}
          />

          {allRows.length === 0 && (
            <p className="muted" style={{ marginTop: 14 }}>
              {counts.total === 0
                ? "No applications yet — generate a resume to record one."
                : "No applications match the current filter."}
            </p>
          )}

          <div className="app-list">{allRows.map((a) => renderApp(a, true))}</div>
        </section>
      ) : (
        /* ---------- BY ACCOUNT ---------- */
        <div className="account-layout">
          <div className="accounts-panel">
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
                        onChange={(e) => setDate(e.target.value)}
                        title="Filter to a single day"
                      />
                      {date && (
                        <button className="btn small" onClick={() => setDate("")}>
                          All dates
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
                    : date
                    ? "No applications on this day."
                    : "No applications for this account yet — generate a resume to record one."}
                </p>
              )}

              <div className="app-list">{rows.map((a) => renderApp(a, searching))}</div>
            </section>
          </div>
        </div>
      )}

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
