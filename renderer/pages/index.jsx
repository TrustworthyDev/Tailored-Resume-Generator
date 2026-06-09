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
  { id: "generate", label: "Generate" },
  { id: "tracker", label: "Tracker" },
];

export default function Home() {
  const [tab, setTab] = useState("applications");
  const [licensed, setLicensed] = useState(null); // null = checking

  useEffect(() => {
    api().licenseStatus().then((s) => setLicensed(!!(s && s.activated)));
  }, []);

  if (licensed === null) return <div className="app" />; // brief check
  if (!licensed) return <Activation onActivated={() => setLicensed(true)} />;

  return (
    <div className="app">
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
        {tab === "generate" && <ResumeGenerator />}
        {tab === "tracker" && <Tracker />}
      </main>
    </div>
  );
}
