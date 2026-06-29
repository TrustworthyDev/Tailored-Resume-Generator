import { useEffect, useState } from "react";
import { api } from "../lib/api";
import Settings from "../components/Settings";
import Instructions from "../components/Instructions";
import AccountManagement from "../components/AccountManagement";
import ResumeGenerator from "../components/ResumeGenerator";
import Applications from "../components/Applications";
import Tracker from "../components/Tracker";
import Activation from "../components/Activation";

const TABS = [
  { id: "applications", label: "Applications" },
  { id: "settings", label: "Settings" },
  { id: "prompts", label: "Prompts" },
  { id: "account", label: "Accounts" },
  { id: "generate", label: "Generate V1" },
  { id: "generate2", label: "Generate V2" },
  { id: "tracker", label: "Tracker" },
];

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
  const [toast, setToast] = useState(null); // { message, type }
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    api().licenseStatus().then((s) => setLicensed(!!(s && s.activated)));
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
        <nav>
          {TABS.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? "nav active" : "nav"}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="content">
        {tab === "settings" && <Settings />}
        {tab === "prompts" && <Instructions />}
        {tab === "account" && <AccountManagement />}
        {tab === "applications" && <Applications />}
        {tab === "generate" && <ResumeGenerator variant="v1" />}
        {tab === "generate2" && <ResumeGenerator variant="v2" />}
        {tab === "tracker" && <Tracker />}
      </main>

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
