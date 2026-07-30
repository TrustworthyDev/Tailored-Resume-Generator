import { useEffect, useState } from "react";
import { api } from "../lib/api";

// Apply a theme to the document root so the CSS variables switch immediately.
export function applyTheme(theme) {
  const t = theme === "light" ? "light" : "dark";
  try { document.documentElement.setAttribute("data-theme", t); } catch (_) {}
}

const OPTIONS = [
  { id: "dark", label: "Dark", hint: "Default — easy on the eyes in low light." },
  { id: "light", label: "Light", hint: "Bright, high-contrast for daylight." },
];

export default function Appearance() {
  const [theme, setTheme] = useState("dark");

  useEffect(() => {
    api().getPref("theme").then((r) => {
      const t = r && r.value === "light" ? "light" : "dark";
      setTheme(t);
      applyTheme(t);
    });
  }, []);

  const choose = (t) => {
    setTheme(t);
    applyTheme(t);
    api().setPref("theme", t);
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Appearance</h2>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Choose how the app looks. This changes the interface only — generated
        resumes always render on white paper.
      </p>

      <div className="theme-choices">
        {OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            className={"theme-card" + (theme === o.id ? " active" : "")}
            onClick={() => choose(o.id)}
          >
            <span className={"theme-swatch theme-swatch-" + o.id} aria-hidden="true" />
            <span className="theme-card-text">
              <strong>{o.label}</strong>
              <span className="muted small">{o.hint}</span>
            </span>
            {theme === o.id && <span className="theme-check">✓</span>}
          </button>
        ))}
      </div>
    </section>
  );
}
