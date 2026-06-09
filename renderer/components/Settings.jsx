import { useState } from "react";
import ApiKeys from "./ApiKeys";
import ProxySettings from "./ProxySettings";
import LocationSettings from "./LocationSettings";
import Security from "./Security";

const TABS = [
  { id: "api", label: "API" },
  { id: "proxy", label: "Proxy" },
  { id: "folder", label: "Folder" },
  { id: "security", label: "Security" },
];

export default function Settings() {
  const [tab, setTab] = useState("api");

  return (
    <div className="settings-layout">
      <div className="settings-nav">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "subnav active" : "subnav"}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="settings-body">
        {tab === "api" && <ApiKeys />}
        {tab === "proxy" && <ProxySettings />}
        {tab === "folder" && <LocationSettings />}
        {tab === "security" && <Security />}
      </div>
    </div>
  );
}
