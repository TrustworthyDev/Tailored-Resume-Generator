import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import Settings from "../components/Settings";
import Instructions from "../components/Instructions";
import AccountManagement from "../components/AccountManagement";
import ResumeGenerator from "../components/ResumeGenerator";
import Applications from "../components/Applications";
import Activation from "../components/Activation";
import About from "../components/About";
import ConfirmModal from "../components/ConfirmModal";
import { applyTheme } from "../components/Appearance";

const TABS = [
  { id: "applications", label: "Applications" },
  { id: "settings", label: "Settings" },
  { id: "prompts", label: "Prompts" },
  { id: "account", label: "Accounts" },
  { id: "generate3", label: "Generate" },
  { id: "about", label: "About" },
];

// Jobs that can run at the same time - extracting, generating, waiting for an
// answer, or just handed a link by Start. The number of job tabs is not limited:
// a job only holds a ChatGPT page while it runs, so idle tabs cost little.
const MAX_THREADS = 20;

// Where a job stands, from the status it reports.
const isRunning = (st) => !!(st && (st.busy || st.pending));
// Finished = its resume is generated and nothing is running in it.
const isFinished = (st) => !isRunning(st) && !!(st && st.done);

// Every job-post link in pasted text. A Google Sheets column pastes as one cell
// per line (several columns as tab-separated cells), so links are picked out of
// the text rather than read line by line. Duplicates are dropped.
function parseJobLinks(text) {
  const found = String(text || "").match(/https?:\/\/[^\s"'<>]+/gi) || [];
  const clean = found.map((u) => u.replace(/[),.;]+$/, ""));
  return [...new Set(clean)];
}

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
  // ({ busy, done, company, … }) for the job tabs.
  const [jobs, setJobs] = useState([1]);
  const [activeJob, setActiveJob] = useState(1);
  const [jobStatus, setJobStatus] = useState({});
  // The job on screen is saved too, so a restart opens the same one. Only once
  // the saved jobs have loaded - before that, the defaults would overwrite it.
  const jobsLoadedRef = useRef(false);
  useEffect(() => {
    if (jobsLoadedRef.current) api().setPref("gen_active_job", activeJob == null ? "" : String(activeJob));
  }, [activeJob]);
  const onJobStatus = useCallback((n, st) => setJobStatus((prev) => ({ ...prev, [n]: st })), []);
  // Links pasted into the Jobs column, and the link each new job was handed by
  // Start ({ [job]: { url, token } }).
  const [batchText, setBatchText] = useState("");
  const [startRequests, setStartRequests] = useState({});
  const [confirmClear, setConfirmClear] = useState(false); // Clear's confirmation
  // A job-tab button for a job to run ({ [job]: { type, token } }).
  const [commands, setCommands] = useState({});
  const sendCommand = (n, type) => setCommands((prev) => ({ ...prev, [n]: { type, token: `${Date.now()}-${type}` } }));
  // The job whose Copy Location was just pressed - its icon shows a tick briefly.
  const [copiedJob, setCopiedJob] = useState(null);
  const copyJobLocation = (n) => {
    sendCommand(n, "copyPath");
    setCopiedJob(n);
    setTimeout(() => setCopiedJob((cur) => (cur === n ? null : cur)), 1500);
  };
  // The one job whose ChatGPT tab loads at startup (for the startup overlay and
  // a quick first run); every other job loads its own when it runs.
  const [bootJob, setBootJob] = useState(null);
  const notify = (message, type = "alert") => setToast({ message, type });

  useEffect(() => {
    api().licenseStatus().then((s) => setLicensed(!!(s && s.activated)));
    api().profileInfo().then((p) => {
      setProfile((p && p.profile) || "");
      setSharedDb((p && p.sharedDatabase) || "");
    });
    // Apply the saved theme as early as possible so the UI never flashes the
    // wrong palette before Settings is opened.
    api().getPref("theme").then((r) => applyTheme(r && r.value));
    api().getPref("gen_batch_links").then((r) => setBatchText((r && r.value) || ""));
    // Reopen the jobs that were open last time, on the one that was on screen.
    // Never saved = a first start, which opens Job 1; saved empty = every job
    // was closed, so none. Each job restores its own state (link, description,
    // resume, colour) itself.
    Promise.all([api().getPref("gen_slots"), api().getPref("gen_active_job")]).then(([r, a]) => {
      let first = 1;
      // Job 0 is always there, so the app can also open on it.
      if (r && r.value != null) {
        const list = String(r.value)
          .split(",")
          .map(Number)
          .filter((n) => Number.isInteger(n) && n >= 1);
        const uniq = [...new Set(list)].sort((x, y) => x - y);
        const wanted = Number(a && a.value);
        first = a && a.value !== "" && [0, ...uniq].includes(wanted) ? wanted : uniq.length ? uniq[0] : 0;
        setJobs(uniq);
        setActiveJob(first);
      }
      setBootJob(first);
      jobsLoadedRef.current = true;
    });
  }, []);

  const saveJobs = (list) => {
    setJobs(list);
    api().setPref("gen_slots", list.join(","));
  };
  const addJob = async () => {
    if (!freeThreads) return;
    // Numbered after every open job, so the new tab is added at the end of the
    // list rather than slotted into a gap left by a closed one.
    const n = Math.max(0, ...jobs) + 1;
    // Anything left under this number (say, from a crash) is not this job's.
    await api().clearJobPrefs(n);
    saveJobs([...jobs, n].sort((a, b) => a - b));
    setActiveJob(n);
  };
  const onBatchText = (v) => {
    setBatchText(v);
    api().setPref("gen_batch_links", v);
  };
  // Threads in use, and free. Finished, idle and stopped (yellow) jobs don't
  // use one, so a thread frees up as each job finishes.
  const runningCount = [0, ...jobs].filter((n) => isRunning(jobStatus[n])).length;
  const freeThreads = Math.max(0, MAX_THREADS - runningCount);

  // Start: a new tab per pasted link, each extracting its link straight away -
  // as many as there are free threads. Existing tabs are never touched. Links
  // beyond the free threads stay in the box for the next Start.
  const startBatch = async () => {
    const links = parseJobLinks(batchText);
    if (!links.length) {
      notify("Paste job-post links first — one per line, e.g. a column copied from Google Sheets.", "warning");
      return;
    }
    if (!freeThreads) {
      notify(`All ${MAX_THREADS} threads are busy. Start again once a job has finished.`, "warning");
      return;
    }
    const take = links.slice(0, freeThreads);
    const rest = links.slice(freeThreads);
    const list = [...jobs];
    // New tabs are numbered after every open job, so they read as new.
    let next = Math.max(0, ...jobs) + 1;
    const started = [];
    for (const url of take) {
      const n = next++;
      // Anything left under this number (say, from a crash) is not this job's.
      await api().clearJobPrefs(n);
      list.push(n);
      started.push([n, url]);
    }
    saveJobs(list.sort((a, b) => a - b));
    const stamp = Date.now();
    setStartRequests((prev) => {
      const next = { ...prev };
      started.forEach(([n, url]) => { next[n] = { url, token: `${stamp}-${n}` }; });
      return next;
    });
    setActiveJob(started[0][0]);
    onBatchText(rest.join("\n"));
    notify(
      rest.length
        ? `Started ${take.length} job${take.length > 1 ? "s" : ""}. ${rest.length} link${rest.length > 1 ? "s are" : " is"} left in the box — press Start again when a thread frees up.`
        : `Started ${take.length} job${take.length > 1 ? "s" : ""} — extracting each job post.`,
      rest.length ? "warning" : "success"
    );
  };
  const batchCount = parseJobLinks(batchText).length;

  // Clear: close every job that isn't running.
  const clearJobs = () => {
    setConfirmClear(false);
    const keep = jobs.filter((n) => isRunning(jobStatus[n]));
    jobs.filter((n) => !keep.includes(n)).forEach((n) => api().clearJobPrefs(n));
    saveJobs(keep);
    setJobStatus((prev) => {
      const next = {};
      keep.forEach((n) => { if (prev[n]) next[n] = prev[n]; });
      return next;
    });
    setStartRequests((prev) => {
      const next = {};
      keep.forEach((n) => { if (prev[n]) next[n] = prev[n]; });
      return next;
    });
    if (activeJob !== 0 && !keep.includes(activeJob)) setActiveJob(keep.length ? keep[0] : 0);
    const running = keep.filter((n) => isRunning(jobStatus[n])).length;
    notify(running ? `Cleared. ${running} running job${running > 1 ? "s" : ""} kept.` : "Cleared all jobs.", "success");
  };
  const clearableCount = jobs.filter((n) => !isRunning(jobStatus[n])).length;

  // Any job can be closed, except while it's running.
  const closeJob = (n) => {
    if (isRunning(jobStatus[n])) return;
    const next = jobs.filter((x) => x !== n);
    saveJobs(next);
    setJobStatus((prev) => {
      const copy = { ...prev };
      delete copy[n];
      return copy;
    });
    setStartRequests((prev) => {
      const copy = { ...prev };
      delete copy[n];
      return copy;
    });
    setCommands((prev) => {
      const copy = { ...prev };
      delete copy[n];
      return copy;
    });
    if (activeJob === n) setActiveJob(next.filter((x) => x < n).pop() ?? next[0] ?? 0);
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
    <div className={"app" + (sidebarOpen ? "" : " sidebar-collapsed")}>
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
                <span className="nav-badge" title={`${runningJobs} job${runningJobs !== 1 ? "s" : ""} generating`}>
                  {runningJobs}
                </span>
              )}
            </button>
          ))}
        </nav>
      </aside>

      <main className="content">
        {/* Generate: the Jobs column on the left, the job on screen beside it.
            Every job stays mounted, so a run keeps going across tab and job
            switches; this container is always rendered (it only changes class)
            so they never remount. A job that isn't on screen is parked - still
            laid out, since display:none would detach Electron's webview guest
            and stop it loading. On screen, display:contents makes the wrapper
            transparent so layout matches a direct child. */}
        <div className={tab === "generate3" ? "gen-v3" : "gen-v3 parked"}>
          {tab === "generate3" && (
            <aside className="job-rail" aria-label="Jobs">
              <div className="job-rail-head">
                <div className="job-rail-title">
                  Jobs
                  <span className="job-rail-count" title={`${runningCount} of ${MAX_THREADS} threads in use`}>
                    {runningCount}/{MAX_THREADS} running
                  </span>
                </div>
                <textarea
                  className="textarea job-links"
                  rows={4}
                  wrap="off"
                  spellCheck={false}
                  placeholder="Paste job-post links, one per line (e.g. a Google Sheets column)"
                  value={batchText}
                  onChange={(e) => onBatchText(e.target.value)}
                />
                <button
                  type="button"
                  className="btn primary job-start"
                  onClick={startBatch}
                  disabled={!batchCount || !freeThreads}
                  title={
                    freeThreads
                      ? `${freeThreads} free thread${freeThreads > 1 ? "s" : ""} — each link opens a new job and is extracted`
                      : `All ${MAX_THREADS} threads are busy — Start frees up as each job finishes`
                  }
                >
                  Start ({freeThreads})
                </button>
                {batchCount > 0 && (
                  <div className="muted small job-links-note">
                    {batchCount} link{batchCount > 1 ? "s" : ""}
                    {batchCount > freeThreads ? ` · ${freeThreads} start now` : ""}
                  </div>
                )}
              </div>
              <div className="job-list">
                {/* Job 0: the original every new job is copied from. Always
                    here - no buttons, not closed by × or Clear. */}
                {(() => {
                  const st = jobStatus[0] || {};
                  return (
                    <div className={"job-tab job-tab-base" + (activeJob === 0 ? " active" : "")}>
                      <div className="job-tab-row">
                        <button
                          type="button"
                          className="job-tab-main"
                          onClick={() => setActiveJob(0)}
                          title="Job 0 — the original: new jobs copy its account and Additional Info"
                        >
                          {st.busy ? <span className="spinner small job-tab-spinner" title="Generating" /> : null}
                          <span className="job-tab-text">
                            <span className="job-tab-name">Job 0</span>
                            <span className="job-tab-company">{st.company || "Original"}</span>
                          </span>
                        </button>
                      </div>
                    </div>
                  );
                })()}
                {jobs.map((n) => {
                  const st = jobStatus[n] || {};
                  return (
                    <div
                      key={n}
                      className={
                        "job-tab" +
                        (n === activeJob ? " active" : "") +
                        (st.mark === "copied" ? " copied" : st.mark === "extracted" ? " extracted" : st.mark === "failed" ? " failed" : "")
                      }
                    >
                      <div className="job-tab-row">
                        <button
                          type="button"
                          className="job-tab-main"
                          onClick={() => setActiveJob(n)}
                          title={st.company ? `Job ${n} — ${st.company}` : `Job ${n}`}
                        >
                          {/* Status first, ahead of the job's name. */}
                          {st.busy ? (
                            <span className="spinner small job-tab-spinner" title="Generating" />
                          ) : st.done ? (
                            <span
                              className="job-tab-flag done"
                              title={st.mark === "copied" ? "Resume generated · path copied" : "Resume generated"}
                            >
                              ✓
                            </span>
                          ) : null}
                          <span className="job-tab-text">
                            <span className="job-tab-name">Job {n}</span>
                            {st.company && <span className="job-tab-company">{st.company}</span>}
                          </span>
                        </button>
                        {/* A finished job: its resume and folder, a click away. */}
                        {isFinished(st) && (
                          <>
                            <button
                              type="button"
                              className="job-tab-icon"
                              onClick={() => copyJobLocation(n)}
                              title={copiedJob === n ? "Copied" : "Copy Location"}
                              aria-label={`Copy job ${n}'s resume location`}
                            >
                              {copiedJob === n ? (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              ) : (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                </svg>
                              )}
                            </button>
                            <button
                              type="button"
                              className="job-tab-icon"
                              onClick={() => sendCommand(n, "openFile")}
                              title="Open Resume"
                              aria-label={`Open job ${n}'s resume`}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                <polyline points="14 2 14 8 20 8" />
                                <line x1="8" y1="13" x2="16" y2="13" />
                                <line x1="8" y1="17" x2="13" y2="17" />
                              </svg>
                            </button>
                          </>
                        )}
                        {/^https?:\/\//i.test(st.link || "") && (
                          <button
                            type="button"
                            className="job-tab-icon"
                            onClick={() => api().openExternalLink(st.link)}
                            title={`Open the job post — ${st.link}`}
                            aria-label={`Open job ${n}'s job post`}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                              <polyline points="15 3 21 3 21 9" />
                              <line x1="10" y1="14" x2="21" y2="3" />
                            </svg>
                          </button>
                        )}
                        <button
                          type="button"
                          className="job-tab-close"
                          onClick={() => closeJob(n)}
                          disabled={isRunning(st)}
                          title={isRunning(st) ? "Can't close a job while it's running" : "Close this job"}
                          aria-label={`Close job ${n}`}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Pinned to the foot of the column, below the scrolling jobs. */}
              <div className="job-rail-foot">
                <button
                  type="button"
                  className="job-tab-add"
                  onClick={addJob}
                  disabled={!freeThreads}
                  title={freeThreads ? "Open another job to generate in parallel" : `All ${MAX_THREADS} threads are busy`}
                >
                  + New job
                </button>
                <button
                  type="button"
                  className="btn job-clear"
                  onClick={() => setConfirmClear(true)}
                  disabled={!clearableCount}
                  title="Close every job that isn't running"
                >
                  Clear
                </button>
              </div>
            </aside>
          )}
          <div className="gen-v3-jobs">
            {[0, ...jobs].map((n) => {
              const shown = tab === "generate3" && n === activeJob;
              return (
                <div
                  key={n}
                  style={
                    shown
                      ? { display: "contents" }
                      // Parked inside the window, invisible and unclickable, rather than
                      // off-screen: Chromium all but stops a page that sits off-screen,
                      // which stalled every job's ChatGPT tab once Generate wasn't open.
                      : { position: "fixed", left: 0, top: 0, width: "1280px", height: "860px", overflow: "hidden", opacity: 0, zIndex: -1, pointerEvents: "none" }
                  }
                  aria-hidden={!shown}
                >
                  <ResumeGenerator
                    job={n}
                    multi={jobs.length > 0}
                    active={shown}
                    onStatus={onJobStatus}
                    startRequest={startRequests[n]}
                    command={commands[n]}
                    prewarm={n === bootJob}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {tab === "settings" && <Settings />}
        {tab === "prompts" && <Instructions />}
        {tab === "account" && <AccountManagement />}
        {tab === "applications" && <Applications />}
        {tab === "about" && <About />}
      </main>

      <ConfirmModal
        open={confirmClear}
        title="Clear jobs?"
        message="Every job that isn't running is closed. Running jobs keep going. Saved resumes stay in Applications."
        confirmLabel="Clear"
        onConfirm={clearJobs}
        onCancel={() => setConfirmClear(false)}
      />

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
