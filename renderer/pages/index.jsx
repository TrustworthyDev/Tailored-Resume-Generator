import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import Settings from "../components/Settings";
import Instructions from "../components/Instructions";
import AccountManagement from "../components/AccountManagement";
import ResumeGenerator from "../components/ResumeGenerator";
import Applications from "../components/Applications";
import Activation from "../components/Activation";
import ConfirmModal from "../components/ConfirmModal";
import { applyTheme } from "../components/Appearance";

const TABS = [
  { id: "applications", label: "Applications" },
  { id: "settings", label: "Settings" },
  { id: "prompts", label: "Prompts" },
  { id: "account", label: "Accounts" },
  { id: "generate3", label: "Generate" },
];

// Generate jobs that can run side by side. Each keeps its own ChatGPT tab
// alive, so the number is capped to keep memory in check.
const MAX_JOBS = 10;

// Where a job stands, from the status it reports.
const isRunning = (st) => !!(st && (st.busy || st.attention));
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
  // ({ busy, attention, done, company }) for the job tabs.
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
      if (r && r.value != null) {
        const list = String(r.value)
          .split(",")
          .map(Number)
          .filter((n) => Number.isInteger(n) && n >= 1);
        const uniq = [...new Set(list)].sort((x, y) => x - y).slice(0, MAX_JOBS);
        const wanted = Number(a && a.value);
        setJobs(uniq);
        setActiveJob(uniq.includes(wanted) ? wanted : uniq.length ? uniq[0] : null);
        // No job means no ChatGPT tab warming up - nothing to wait for.
        if (!uniq.length) setBooting(false);
      }
      jobsLoadedRef.current = true;
    });
  }, []);

  const saveJobs = (list) => {
    setJobs(list);
    api().setPref("gen_slots", list.join(","));
  };
  const addJob = async () => {
    if (jobs.length >= MAX_JOBS) return;
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
  // Start never touches a job that's open: every link gets a brand-new tab.
  // At the limit, room is made by closing finished jobs - those whose resume
  // path was copied (filed) first, then the other finished ones, oldest first.
  // The finished jobs Start may close, in that order:
  const closableFinished = () => {
    const done = jobs.filter((n) => isFinished(jobStatus[n]));
    const copied = done.filter((n) => jobStatus[n].mark === "copied");
    return [...copied, ...done.filter((n) => !copied.includes(n))];
  };
  const slotCount = Math.max(0, MAX_JOBS - jobs.length) + closableFinished().length;

  // Start: a new tab per pasted link, each extracting its link straight away.
  // Links beyond the free slots stay in the box for the next Start.
  const startBatch = async () => {
    const links = parseJobLinks(batchText);
    if (!links.length) {
      notify("Paste job-post links first — one per line, e.g. a column copied from Google Sheets.", "warning");
      return;
    }
    const empty = Math.max(0, MAX_JOBS - jobs.length);
    const finished = closableFinished();
    const room = empty + finished.length;
    if (!room) {
      notify("Every job is still working. Start again once one has finished.", "warning");
      return;
    }
    const take = links.slice(0, room);
    const rest = links.slice(room);
    // Close only as many finished jobs as the new tabs need.
    const closing = finished.slice(0, Math.max(0, take.length - empty));
    closing.forEach((n) => api().clearJobPrefs(n));
    const list = jobs.filter((n) => !closing.includes(n));
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
    if (closing.length) {
      const drop = (prev) => {
        const copy = { ...prev };
        closing.forEach((n) => { delete copy[n]; });
        return copy;
      };
      setJobStatus(drop);
      setStartRequests(drop);
    }
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
        ? `Started ${take.length} job${take.length > 1 ? "s" : ""}. ${rest.length} link${rest.length > 1 ? "s are" : " is"} left in the box — press Start again when a job has finished.`
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
    if (!keep.includes(activeJob)) setActiveJob(keep.length ? keep[0] : null);
    const running = keep.filter((n) => isRunning(jobStatus[n])).length;
    notify(running ? `Cleared. ${running} running job${running > 1 ? "s" : ""} kept.` : "Cleared all jobs.", "success");
  };
  const clearableCount = jobs.filter((n) => !isRunning(jobStatus[n])).length;

  // Any job can be closed, except while it's running.
  const closeJob = (n) => {
    if (jobStatus[n] && jobStatus[n].busy) return;
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
    if (activeJob === n) setActiveJob(next.filter((x) => x < n).pop() || next[0] || null);
    api().clearJobPrefs(n);
  };
  const runningJobs = Object.values(jobStatus).filter((s) => s && s.busy).length;
  const waitingJobs = Object.values(jobStatus).filter((s) => s && s.attention).length;

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
              {t.id === "generate3" && (runningJobs > 0 || waitingJobs > 0) && (
                <span
                  className={"nav-badge" + (waitingJobs ? " attention" : "")}
                  title={
                    (waitingJobs ? `${waitingJobs} job${waitingJobs > 1 ? "s" : ""} waiting for your answer · ` : "") +
                    `${runningJobs} job${runningJobs !== 1 ? "s" : ""} generating`
                  }
                >
                  {waitingJobs ? "!" : runningJobs}
                </span>
              )}
            </button>
          ))}
        </nav>
      </aside>

      <main className="content">
        {/* Generate V3: the Jobs column on the left, the job on screen beside
            it. Every job stays mounted from startup so its embedded ChatGPT
            WebView pre-warms in the background (loads Project Home once) and
            keeps running across tab and job switches; this container is always
            rendered (it only changes class) so they never remount. A job that
            isn't on screen is parked off-screen but still laid out — display:none
            would detach Electron's webview guest and stop it loading. On screen,
            display:contents makes the wrapper transparent so layout matches a
            direct child. */}
        <div className={tab === "generate3" ? "gen-v3" : "gen-v3 parked"}>
          {tab === "generate3" && (
            <aside className="job-rail" aria-label="Jobs">
              <div className="job-rail-title">Jobs</div>
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
                disabled={!batchCount || !slotCount}
                title={
                  slotCount
                    ? `${slotCount} free slot${slotCount > 1 ? "s" : ""} — each link opens a new job and is extracted`
                    : "Every job is still working — Start frees up as each one finishes"
                }
              >
                Start ({slotCount})
              </button>
              {batchCount > 0 && (
                <div className="muted small job-links-note">
                  {batchCount} link{batchCount > 1 ? "s" : ""}
                  {batchCount > slotCount ? ` · ${slotCount} start now` : ""}
                </div>
              )}
              <div className="job-rail-sep" />
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
                      ) : st.done ? (
                        <span
                          className="job-tab-flag done"
                          title={st.mark === "copied" ? "Resume generated · path copied" : "Resume generated"}
                        >
                          ✓
                        </span>
                      ) : null}
                    </button>
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
                  </div>
                );
              })}
              {jobs.length < MAX_JOBS && (
                <button type="button" className="job-tab-add" onClick={addJob} title="Open another job to generate in parallel">
                  + New job
                </button>
              )}
              <button
                type="button"
                className="btn job-clear"
                onClick={() => setConfirmClear(true)}
                disabled={!clearableCount}
                title="Close every job that isn't running"
              >
                Clear
              </button>
            </aside>
          )}
          <div className="gen-v3-jobs">
            {tab === "generate3" && !jobs.length && (
              <div className="card jobs-empty muted">
                No jobs open. Paste job-post links in the Jobs column and press Start, or open one with + New job.
              </div>
            )}
            {jobs.map((n) => {
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
                    multi={jobs.length > 1}
                    active={shown}
                    onStatus={onJobStatus}
                    startRequest={startRequests[n]}
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
