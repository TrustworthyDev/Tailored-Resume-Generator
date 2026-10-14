import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import Settings from "../components/Settings";
import Instructions from "../components/Instructions";
import AccountManagement from "../components/AccountManagement";
import ResumeGenerator from "../components/ResumeGenerator";
import Applications from "../components/Applications";
import Activation from "../components/Activation";
import { applyTheme } from "../components/Appearance";

const TABS = [
  { id: "applications", label: "Applications" },
  { id: "settings", label: "Settings" },
  { id: "prompts", label: "Prompts" },
  { id: "account", label: "Accounts" },
  { id: "generate3", label: "Generate V3" },
];

// Generate V3 jobs that can run side by side. Each keeps its own ChatGPT tab
// alive, so the number is capped to keep memory in check.
const MAX_JOBS = 4;

// Icon per notification category (danger | warning | alert | success | info).
const TOAST_ICONS = {
  danger: "⛔",
  warning: "⚠️",
  alert: "🔔",
  success: "✅",
  info: "ℹ️",
};

export default function Home() {
  const [tab, setTab] = useState("applications");
  const [licensed, setLicensed] = useState(null); // null = checking
  // Which data profile this window owns. Shown in the sidebar so two or three
  // copies running side by side are never mistaken for each other.
  const [profile, setProfile] = useState("");
  // Path of the database this app shares with other apps ("" = its own).
  const [sharedDb, setSharedDb] = useState("");
  const [toast, setToast] = useState(null); // { message, type }
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Startup overlay: the embedded ChatGPT tab pre-warms in the background as
  // soon as the app opens, and until it's up the generators can't actually run.
  const [booting, setBooting] = useState(true);
  // Generate V3 jobs: their numbers, the one on screen, and what each is doing
  // ({ busy, attention, done, company }) for the job tabs.
  const [jobs, setJobs] = useState([1]);
  const [activeJob, setActiveJob] = useState(1);
  const [jobStatus, setJobStatus] = useState({});
  const onJobStatus = useCallback((n, st) => setJobStatus((prev) => ({ ...prev, [n]: st })), []);

  useEffect(() => {
    api().licenseStatus().then((s) => setLicensed(!!(s && s.activated)));
    api().profileInfo().then((p) => {
      setProfile((p && p.profile) || "");
      setSharedDb((p && p.sharedDatabase) || "");
    });
    // Apply the saved theme as early as possible so the UI never flashes the
    // wrong palette before Settings is opened.
    api().getPref("theme").then((r) => applyTheme(r && r.value));
    // Reopen the jobs that were open last time (job 1 is always there).
    api().getPref("gen_slots").then((r) => {
      const list = String((r && r.value) || "")
        .split(",")
        .map(Number)
        .filter((n) => Number.isInteger(n) && n >= 1);
      const uniq = [...new Set([1, ...list])].sort((a, b) => a - b).slice(0, MAX_JOBS);
      setJobs(uniq);
    });
  }, []);

  const saveJobs = (list) => {
    setJobs(list);
    api().setPref("gen_slots", list.join(","));
  };
  const addJob = async () => {
    if (jobs.length >= MAX_JOBS) return;
    let n = 2;
    while (jobs.includes(n)) n++;
    // Anything left under this number (say, from a crash) is not this job's.
    await api().clearJobPrefs(n);
    saveJobs([...jobs, n].sort((a, b) => a - b));
    setActiveJob(n);
  };
  // Job 1 always stays; a job that is running can't be closed.
  const closeJob = (n) => {
    if (n === 1 || (jobStatus[n] && jobStatus[n].busy)) return;
    const next = jobs.filter((x) => x !== n);
    saveJobs(next);
    setJobStatus((prev) => {
      const copy = { ...prev };
      delete copy[n];
      return copy;
    });
    if (activeJob === n) setActiveJob(next.filter((x) => x < n).pop() || 1);
    api().clearJobPrefs(n);
  };
  const runningJobs = Object.values(jobStatus).filter((s) => s && s.busy).length;

  // Auto-collapse the sidebar on small windows so the main content fits.
  useEffect(() => {
    const onResize = () => { if (window.innerWidth < 1200) setSidebarOpen(false); };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Single in-app toast. Fed by both the main process (replacing native OS
  // notifications) and in-app components via a window "app-notify" event.
  // A payload may be a plain string or { message, type } where type is one of
  // danger | warning | alert | success | info.
  useEffect(() => {
    const show = (detail) => {
      if (!detail) return;
      if (typeof detail === "string") setToast({ message: detail, type: "alert" });
      else if (detail.message) setToast({ message: String(detail.message), type: detail.type || "alert" });
    };
    const onWin = (e) => show(e.detail);
    window.addEventListener("app-notify", onWin);
    const off = api().onAppNotify ? api().onAppNotify(show) : null;
    return () => {
      window.removeEventListener("app-notify", onWin);
      if (typeof off === "function") off();
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // Close the startup overlay when Generate V3 reports its ChatGPT tab is up.
  // Escape and the Skip button dismiss it too, and a timeout guarantees the app
  // is never held hostage by a tab that won't load.
  useEffect(() => {
    if (!booting) return;
    const done = () => setBooting(false);
    const onKey = (e) => { if (e.key === "Escape") done(); };
    window.addEventListener("chat-ready", done);
    document.addEventListener("keydown", onKey);
    const t = setTimeout(done, 25000);
    return () => {
      window.removeEventListener("chat-ready", done);
      document.removeEventListener("keydown", onKey);
      clearTimeout(t);
    };
  }, [booting]);

  if (licensed === null) return <div className="app" />; // brief check
  if (!licensed) return <Activation onActivated={() => setLicensed(true)} />;

  return (
    <div className={"app" + (sidebarOpen ? "" : " sidebar-collapsed") + (tab === "generate3" ? " has-job-rail" : "")}>
      <button
        className="sidebar-toggle"
        onClick={() => setSidebarOpen((o) => !o)}
        title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
      >
        {sidebarOpen ? "‹" : "›"}
      </button>
      <aside className="sidebar">
        {profile && (
          <div className="profile-badge" title={`Data profile "${profile}" — its own database, ChatGPT session and settings`}>
            {profile}
          </div>
        )}
        {sharedDb && (
          <div className="profile-badge shared-db-badge" title={`Shared database: ${sharedDb}`}>
            Shared database
          </div>
        )}
        <nav>
          {TABS.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? "nav active" : "nav"}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.id === "generate3" && runningJobs > 0 && (
                <span className="nav-badge" title={`${runningJobs} job${runningJobs > 1 ? "s" : ""} generating`}>
                  {runningJobs}
                </span>
              )}
            </button>
          ))}
        </nav>
      </aside>

      {/* Generate V3's jobs, one per row, in a column beside the main sidebar. */}
      {tab === "generate3" && (
        <aside className="job-rail" aria-label="Jobs">
          <div className="job-rail-title">Jobs</div>
          {jobs.map((n) => {
            const st = jobStatus[n] || {};
            return (
              <div key={n} className={"job-tab" + (n === activeJob ? " active" : "")}>
                <button
                  type="button"
                  className="job-tab-main"
                  onClick={() => setActiveJob(n)}
                  title={st.company ? `Job ${n} — ${st.company}` : `Job ${n}`}
                >
                  <span className="job-tab-text">
                    <span className="job-tab-name">Job {n}</span>
                    {st.company && <span className="job-tab-company">{st.company}</span>}
                  </span>
                  {st.attention ? (
                    <span className="job-tab-flag attention" title="Waiting for your answer">!</span>
                  ) : st.busy ? (
                    <span className="spinner small job-tab-spinner" title="Generating" />
                  ) : st.done && n !== activeJob ? (
                    <span className="job-tab-flag done" title="Resume saved">✓</span>
                  ) : null}
                </button>
                {n !== 1 && (
                  <button
                    type="button"
                    className="job-tab-close"
                    onClick={() => closeJob(n)}
                    disabled={!!st.busy}
                    title={st.busy ? "Can't close a job while it's generating" : "Close this job"}
                    aria-label={`Close job ${n}`}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
          {jobs.length < MAX_JOBS && (
            <button type="button" className="job-tab-add" onClick={addJob} title="Open another job to generate in parallel">
              + New job
            </button>
          )}
        </aside>
      )}

      <main className="content">
        {/* Every Generate V3 job stays mounted from startup so its embedded
            ChatGPT WebView pre-warms in the background (loads Project Home once)
            and keeps running across tab and job switches. A job that isn't on
            screen is parked off-screen but still laid out — display:none would
            detach Electron's webview guest and stop it loading. On screen,
            display:contents makes the wrapper transparent so layout matches a
            direct child. */}
        {jobs.map((n) => {
          const shown = tab === "generate3" && n === activeJob;
          return (
            <div
              key={n}
              style={
                shown
                  ? { display: "contents" }
                  : { position: "fixed", left: "-99999px", top: 0, width: "1280px", height: "860px", overflow: "hidden", pointerEvents: "none" }
              }
              aria-hidden={!shown}
            >
              <ResumeGenerator job={n} multi={jobs.length > 1} active={shown} onStatus={onJobStatus} />
            </div>
          );
        })}

        {tab === "settings" && <Settings />}
        {tab === "prompts" && <Instructions />}
        {tab === "account" && <AccountManagement />}
        {tab === "applications" && <Applications />}
      </main>

      {booting && (
        <div className="modal-overlay boot-overlay" role="status" aria-live="polite">
          <div className="modal modal-progress">
            <div className="spinner" />
            <h3 className="modal-title">Starting RGenerator</h3>
            <p className="muted modal-msg">
              Opening the ChatGPT tab in the background. This only happens once per launch.
            </p>
            <div className="modal-actions boot-actions">
              <button className="btn" onClick={() => setBooting(false)}>Skip</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          className={"toast toast-" + (toast.type || "alert")}
          role="alert"
          onClick={() => setToast(null)}
        >
          <span className="toast-icon" aria-hidden="true">{TOAST_ICONS[toast.type] || TOAST_ICONS.alert}</span>
          <span className="toast-msg">{toast.message}</span>
        </div>
      )}
    </div>
  );
}
