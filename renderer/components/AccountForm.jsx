import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { detectCountry, countryFlag } from "../lib/flags";
import { friendlyError } from "../lib/errors";
import { ageFromBirthDate } from "../lib/age";
import { styleThumb } from "../lib/styleThumbs";
import { buildResumeHtml } from "../lib/resumeHtml";
import { STYLES, PRESET_COLORS, FONT_OPTIONS, SIZE_OPTIONS, rankStyles } from "../lib/resumeStyles";
import Field from "./Field";

const EMPTY_ROLE = {
  role_name: "",
  company_name: "",
  location: "",
  work_duration: "",
};

const EMPTY_PROJECT = { title: "", link: "", description: "" };

// The resume's on-screen page geometry: A4 at 96dpi, matching the `.page`
// max-width the generated HTML lays itself out in. The preview renders at this
// size and is then scaled down to fit, so what's on screen is the real page
// proportions rather than a reflowed narrow copy.
const PAGE_W = 794;
const PAGE_H = 1123;
// Below this the text is too small to judge a template by, so the pane scrolls
// instead of shrinking further.
const MIN_SCALE = 0.3;

// One account = personal info + education + work history + projects + extras.
// The form is organised into five tabs; a collapsible "View" panel below shows
// a read-only summary of everything that has been entered.
export default function AccountForm({ accountId, onSaved }) {
  const [info, setInfo] = useState({});
  const [roles, setRoles] = useState([]);
  const [edu, setEdu] = useState({});
  const [projects, setProjects] = useState([]);
  const [saved, setSaved] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [tab, setTab] = useState("personal");
  // The most recent resume generated for this account, so "Set Resume" previews
  // a style against real content rather than a mock-up.
  const [lastResume, setLastResume] = useState(null);
  // Fit-to-view state for that preview: the whole resume is scaled down to sit
  // inside the pane, rather than rendering full size and scrolling.
  const stageRef = useRef(null);
  const frameRef = useRef(null);
  const [fit, setFit] = useState({ scale: 1, docH: PAGE_H });
  // Templates in the order they are arranged in Generate Resume, so the two
  // grids read the same way round.
  const [orderedStyles, setOrderedStyles] = useState(STYLES);

  // Re-read on every visit to the tab: the ranking is set in Generate Resume,
  // and reading it once at mount would show a stale order after a reorder there.
  useEffect(() => {
    if (tab !== "setresume") return;
    api().getPref("style_order").then((p) => {
      if (p && p.value) setOrderedStyles(rankStyles(p.value));
    });
  }, [tab]);
  // Which View sections are expanded. Personal is open by default.
  const [openViews, setOpenViews] = useState({ personal: true });

  useEffect(() => {
    if (!accountId) return;
    setSaved(false);
    setTab("personal");
    api().getAccount(accountId).then((d) => setInfo(d || {}));
    api().listWorkHistory(accountId).then((rows) => setRoles(rows || []));
    api().listEducation(accountId).then((rows) => setEdu((rows && rows[0]) || {}));
    api().listProjects(accountId).then((rows) => setProjects(rows || []));
    setLastResume(null);
    api().lastResumeForAccount(accountId).then((r) => setLastResume(r || null));
  }, [accountId]);

  // The resume as it would really look: the account's last generated content,
  // rendered through the same builder the PDF uses, with whatever template,
  // colours and font are currently selected on this tab. Re-renders as those
  // change, so a choice can be judged against actual content.
  const styleObj =
    STYLES.find((s) => s.id === info.resume_style) ||
    STYLES.find((s) => s.id === "modern") ||
    STYLES[0];
  // Scale so a whole PAGE fits the pane — the zoomed-out page view a PDF viewer
  // gives you. Fitting the entire document was the first attempt and it does not
  // work: a real resume here runs to about three A4 pages, which at this pane
  // size lands around 0.23 scale — a column of unreadable grey. One page fitted,
  // scrolling to the next, keeps the text legible and the proportions true.
  const measure = useCallback((docH) => {
    const el = stageRef.current;
    if (!el) return;
    const availW = el.clientWidth;
    const availH = el.clientHeight;
    if (!availW || !availH) return;
    const h = Math.max(docH || PAGE_H, PAGE_H);
    // Never magnify past 1:1 — a short resume should not be blown up.
    const scale = Math.max(MIN_SCALE, Math.min(1, availW / PAGE_W, availH / PAGE_H));
    setFit((f) => (f.scale === scale && f.docH === h ? f : { scale, docH: h }));
  }, []);

  // The iframe holds our own srcDoc, so its document is readable — ask it how
  // tall the resume actually came out.
  const onFrameLoad = useCallback(() => {
    let h = PAGE_H;
    try {
      const d = frameRef.current && frameRef.current.contentDocument;
      if (d && d.body) h = Math.max(d.body.scrollHeight, d.documentElement.scrollHeight, PAGE_H);
    } catch (_) {}
    measure(h);
  }, [measure]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure(fit.docH));
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, fit.docH, tab, lastResume]);

  const previewHtml =
    lastResume && lastResume.resume_content
      ? buildResumeHtml(
          lastResume.resume_content,
          {
            ...styleObj,
            accent: info.resume_accent || styleObj.accent,
            head: info.resume_accent || "",
            nameColor: info.resume_name_color || "",
            font: info.resume_font || "",
            fontSize: info.resume_font_size || "",
          },
          info.title || "",
          info,
          edu && Object.keys(edu).length ? [edu] : []
        )
      : "";

  const setI = (k) => (v) => {
    setInfo((f) => ({ ...f, [k]: v }));
    setSaved(false);
  };

  // Set Resume choices save the instant they are clicked, rather than waiting
  // for the Save button — which sits below a tall preview and is easy to miss,
  // and which would also commit unfinished edits from the other tabs. Only the
  // five look columns are written.
  const setLook = (k) => (v) => {
    // Computed outside the state updater: a click is a discrete event, and an
    // updater can be invoked more than once, which would duplicate the write.
    const next = { ...info, [k]: v };
    setInfo(next);
    if (!accountId) return;
    api().saveAccountLook({
      id: accountId,
      resume_style: next.resume_style || "",
      resume_accent: next.resume_accent || "",
      resume_name_color: next.resume_name_color || "",
      resume_font: next.resume_font || "",
      resume_font_size: next.resume_font_size || "",
    });
  };

  const setRole = (i, k) => (e) => {
    const val = e.target.value;
    setRoles((rs) => rs.map((r, idx) => (idx === i ? { ...r, [k]: val } : r)));
    setSaved(false);
  };

  // Work duration is stored as one "Start - End" string, but edited as two
  // separate fields. Split on the first dash / en-dash / "to".
  const splitDuration = (s) => {
    const parts = String(s || "").split(/\s*(?:–|—|-|\bto\b)\s*/i);
    return { start: (parts[0] || "").trim(), end: (parts.slice(1).join(" - ") || "").trim() };
  };
  const joinDuration = (start, end) =>
    [String(start || "").trim(), String(end || "").trim()].filter(Boolean).join(" - ");
  const setRoleDate = (i, which) => (e) => {
    const val = e.target.value;
    setRoles((rs) =>
      rs.map((r, idx) => {
        if (idx !== i) return r;
        const { start, end } = splitDuration(r.work_duration);
        const work_duration = which === "start" ? joinDuration(val, end) : joinDuration(start, val);
        return { ...r, work_duration };
      })
    );
    setSaved(false);
  };

  const addRole = () => {
    setRoles((rs) => [...rs, { ...EMPTY_ROLE }]);
    setSaved(false);
  };

  const removeRole = (i) => {
    setRoles((rs) => rs.filter((_, idx) => idx !== i));
    setSaved(false);
  };

  const setEduField = (k) => (v) => {
    setEdu((s) => ({ ...s, [k]: v }));
    setSaved(false);
  };

  const setProject = (i, k) => (e) => {
    const val = e.target.value;
    setProjects((ps) => ps.map((p, idx) => (idx === i ? { ...p, [k]: val } : p)));
    setSaved(false);
  };

  const addProject = () => {
    setProjects((ps) => [...ps, { ...EMPTY_PROJECT }]);
    setSaved(false);
  };

  const removeProject = (i) => {
    setProjects((ps) => ps.filter((_, idx) => idx !== i));
    setSaved(false);
  };

  const save = async () => {
    // Country (used for the flag in lists/dropdowns) is derived from the address.
    const country = detectCountry(info.address);
    await api().saveAccount({ ...info, country, id: accountId });
    await api().replaceWorkHistory(accountId, roles);
    await api().replaceEducation(accountId, [edu]);
    await api().replaceProjects(accountId, projects);
    setSaved(true);
    if (onSaved) onSaved();
  };

  // Overwrite the form with the parsed resume. Personal fields are replaced
  // only when the import found a value (so a missed field isn't blanked);
  // education / work / projects sections are replaced wholesale.
  const applyImport = (data) => {
    if (!data) return;
    const p = data.personal || {};
    setInfo((f) => {
      const next = { ...f };
      Object.keys(p).forEach((k) => {
        if (p[k]) next[k] = p[k];
      });
      return next;
    });
    setEdu(data.education || {});
    setRoles(Array.isArray(data.work) ? data.work : []);
    setProjects(Array.isArray(data.projects) ? data.projects : []);
    setSaved(false);
  };

  // Write the account out as a Markdown record — what's on screen, so unsaved
  // edits are included.
  const exportMd = async () => {
    setImportError("");
    const r = await api().exportAccountMd({ personal: info, education: [edu], work: roles });
    if (r && !r.ok && !r.canceled) setImportError(r.error || "Could not export the account.");
  };

  // Read a Markdown record into the form. Fills the same fields the PDF import
  // does; nothing is saved until Save is pressed.
  const importMd = async () => {
    setImportError("");
    const r = await api().importAccountMd();
    if (!r || r.canceled) return;
    if (r.ok) applyImport(r.data);
    else setImportError(r.error || "Could not read that file.");
  };

  // Pick a resume PDF; the active AI key extracts the fields and fills the form.
  const runImport = async () => {
    if (importing) return;
    setImporting(true);
    setImportError("");
    const res = await api().importResumeFile();
    setImporting(false);
    if (!res || res.canceled) return; // user dismissed the file picker
    if (res.ok) applyImport(res.data);
    else setImportError(friendlyError({ message: res.error || "Import failed. Please try again." }));
  };

  const detected = detectCountry(info.address);

  const TABS = [
    { id: "personal", label: "Personal" },
    { id: "education", label: "Education" },
    { id: "work", label: "Work History", count: roles.length },
    { id: "projects", label: "Projects", count: projects.length },
    { id: "additional", label: "Additional Info" },
    { id: "setresume", label: "Set Resume" },
  ];

  const toggleView = (id) =>
    setOpenViews((v) => ({ ...v, [id]: !v[id] }));

  const VIEW_KEYS = ["personal", "education", "work", "projects", "additional"];
  const expandAll = () =>
    setOpenViews(Object.fromEntries(VIEW_KEYS.map((k) => [k, true])));
  const collapseAll = () => setOpenViews({});

  return (
    <div className="stack account-form">
      {/* SECTION 2 — Personal Info Input, organised into five tabs */}
      <section className="card">
        <div className="card-head">
          <h2>Personal Info</h2>
          <div className="list-actions">
            <button className="btn small" onClick={runImport} disabled={importing}>
              {importing ? "Importing…" : "Import from PDF"}
            </button>
            <button className="btn small" onClick={importMd} title="Fill this form from a Markdown account record">
              Import MD
            </button>
            <button className="btn small" onClick={exportMd} title="Save this account as a Markdown record">
              Export MD
            </button>
          </div>
        </div>
        {importError && <div className="error">{importError}</div>}

        <div className="form-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={"form-tab" + (tab === t.id ? " active" : "")}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.count ? <span className="tab-count">{t.count}</span> : null}
            </button>
          ))}
        </div>

        <div className="form-tab-panel">
          {tab === "personal" && (
            <div className="grid2">
              <Field label="Full Name" value={info.name} onChange={setI("name")} />
              <Field label="Tech Stack" value={info.main_stack} onChange={setI("main_stack")}
                placeholder="e.g. C# / .NET — your note, not added to the resume" />
              <Field label="Title" value={info.title} onChange={setI("title")}
                placeholder="e.g. Software Engineer" />
              <Field label="Email" value={info.email} onChange={setI("email")} />
              <Field label="Phone Number" value={info.phone} onChange={setI("phone")} />
              <label className="field">
                <span className="field-label">
                  Date of Birth
                  {ageFromBirthDate(info.birth_date) ? (
                    <span className="detect-flag">{ageFromBirthDate(info.birth_date)} years old</span>
                  ) : null}
                </span>
                <input className="input" type="date" value={info.birth_date || ""}
                  onChange={(e) => setI("birth_date")(e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">
                  Address
                  {detected ? (
                    <span className="detect-flag">
                      <span className="flag">{countryFlag(detected)}</span>{detected}
                    </span>
                  ) : null}
                </span>
                <input className="input" value={info.address || ""}
                  placeholder="e.g. Tallinn, Estonia"
                  onChange={(e) => setI("address")(e.target.value)} />
              </label>
              <Field label="LinkedIn Link" value={info.linkedin} onChange={setI("linkedin")} />
              <Field label="Portfolio / Other Link" value={info.portfolio}
                onChange={setI("portfolio")} />
              {/* Record-keeping fields. Kept out of the resume and out of the AI
                  prompt — they exist so a Markdown record round-trips intact. */}
              <Field label="Resume Link" value={info.resume_link} onChange={setI("resume_link")} />
              <Field label="Cover Letter Link" value={info.cover_letter_link}
                onChange={setI("cover_letter_link")} />
              <Field label="Time Zone" value={info.time_zone} onChange={setI("time_zone")}
                placeholder="e.g. EET" />
              <Field label="Recovery" value={info.recovery} onChange={setI("recovery")}
                placeholder="recovery email or phone" />
              <label className="field">
                <span className="field-label">
                  Password
                  <span className="muted small"> · stored as typed; never sent to the AI</span>
                </span>
                <input className="input" type="password" value={info.password || ""}
                  onChange={(e) => setI("password")(e.target.value)} />
              </label>
            </div>
          )}

          {tab === "education" && (
            <div className="grid2">
              <Field label="University" value={edu.university}
                onChange={setEduField("university")} placeholder="e.g. University of Tartu" />
              <Field label="Location" value={edu.location}
                onChange={setEduField("location")} placeholder="e.g. Tartu, Estonia" />
              <Field label="Degree" value={edu.degree}
                onChange={setEduField("degree")} placeholder="e.g. BSc Computer Science" />
              <Field label="Period" value={edu.period}
                onChange={setEduField("period")} placeholder="e.g. 2016–2020" />
            </div>
          )}

          {tab === "work" && (
            <>
              <div className="tab-head">
                <p className="muted">Add as many roles as you like.</p>
                <button className="btn small primary" onClick={addRole}>+ Add Role</button>
              </div>
              {roles.length === 0 && <p className="muted">No roles yet.</p>}
              {roles.map((r, i) => (
                <div className="role-row" key={i}>
                  <div className="grid2 role-grid">
                    <label className="field">
                      <span className="field-label">Role Name</span>
                      <input className="input" placeholder="e.g. Senior Software Engineer"
                        value={r.role_name || ""} onChange={setRole(i, "role_name")} />
                    </label>
                    <label className="field">
                      <span className="field-label">Company Name</span>
                      <input className="input" placeholder="e.g. Acme Inc."
                        value={r.company_name || ""} onChange={setRole(i, "company_name")} />
                    </label>
                    <label className="field">
                      <span className="field-label">Location</span>
                      <input className="input" placeholder="e.g. Tallinn, Estonia"
                        value={r.location || ""} onChange={setRole(i, "location")} />
                    </label>
                    <label className="field">
                      <span className="field-label">Work Duration</span>
                      <div className="date-range">
                        <input className="input" placeholder="Start (e.g. May 2022)"
                          value={splitDuration(r.work_duration).start}
                          onChange={setRoleDate(i, "start")} />
                        <span className="date-range-sep">–</span>
                        <input className="input" placeholder="End (e.g. Jul 2026 / Present)"
                          value={splitDuration(r.work_duration).end}
                          onChange={setRoleDate(i, "end")} />
                      </div>
                    </label>
                  </div>
                  <button className="x-btn" onClick={() => removeRole(i)} title="Remove role">
                    ×
                  </button>
                </div>
              ))}
            </>
          )}

          {tab === "projects" && (
            <>
              <div className="tab-head">
                <p className="muted">Add as many projects as you like.</p>
                <button className="btn small primary" onClick={addProject}>+ Add Project</button>
              </div>
              {projects.length === 0 && <p className="muted">No projects yet.</p>}
              {projects.map((p, i) => (
                <div className="role-row" key={i}>
                  <div className="role-grid" style={{ flex: 1 }}>
                    <div className="grid2">
                      <label className="field">
                        <span className="field-label">Title</span>
                        <input className="input" placeholder="e.g. AI Resume Builder"
                          value={p.title || ""} onChange={setProject(i, "title")} />
                      </label>
                      <label className="field">
                        <span className="field-label">Link</span>
                        <input className="input" placeholder="e.g. github.com/you/project"
                          value={p.link || ""} onChange={setProject(i, "link")} />
                      </label>
                    </div>
                    <label className="field">
                      <span className="field-label">Description</span>
                      <textarea className="textarea" rows={2}
                        placeholder="What it does, your role, technologies…"
                        value={p.description || ""} onChange={setProject(i, "description")} />
                    </label>
                  </div>
                  <button className="x-btn" onClick={() => removeProject(i)} title="Remove project">
                    ×
                  </button>
                </div>
              ))}
            </>
          )}

          {tab === "additional" && (
            <label className="field">
              <span className="field-label">Additional Information</span>
              <p className="muted small" style={{ margin: "0 0 8px" }}>
                Anything not covered by the other tabs — certifications, languages,
                awards, volunteering, a short skills summary. The AI weaves the
                relevant parts into your resume.
              </p>
              <textarea className="textarea" rows={8}
                placeholder={"e.g.\nCertifications: AWS Solutions Architect (2023)\nLanguages: English (native), Estonian (B2)\nAwards: Hackathon winner, 2022"}
                value={info.additional_info || ""}
                onChange={(e) => setI("additional_info")(e.target.value)} />
            </label>
          )}

          {/* The look this account's resumes are generated with. Picking the
              account in Generate V1–V3 applies everything set here. */}
          {tab === "setresume" && (
            <div className="setresume-split">
              {/* Left: every control — colours, font, then the templates. */}
              <div className="setresume-pane setresume-controls">
              <div className="color-section">
                <span className="field-label">Name Color Picker</span>
                <div className="swatch-row">
                  <button
                    type="button"
                    className={"swatch swatch-default" + (!info.resume_name_color ? " active" : "")}
                    onClick={() => setLook("resume_name_color")("")}
                    title="Each template's own default name & title color"
                  >
                    Default
                  </button>
                  {PRESET_COLORS.map((c) => {
                    const on = (info.resume_name_color || "").toLowerCase() === c.value;
                    return (
                      <button
                        key={c.value}
                        type="button"
                        className={"swatch" + (on ? " active" : "")}
                        style={{ background: c.value }}
                        onClick={() => setLook("resume_name_color")(c.value)}
                        title={c.name}
                        aria-label={c.name}
                      >
                        {on ? "✓" : ""}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className={"swatch swatch-white" + ((info.resume_name_color || "").toLowerCase() === "#ffffff" ? " active" : "")}
                    style={{ background: "#ffffff" }}
                    onClick={() => setLook("resume_name_color")("#ffffff")}
                    title="White"
                    aria-label="White"
                  >
                    {(info.resume_name_color || "").toLowerCase() === "#ffffff" ? "✓" : ""}
                  </button>
                  <label className="swatch swatch-custom" title="Custom color">
                    <input
                      type="color"
                      value={/^#[0-9a-fA-F]{6}$/.test(info.resume_name_color || "") ? info.resume_name_color : "#3366ff"}
                      onChange={(e) => setLook("resume_name_color")(e.target.value)}
                    />
                  </label>
                </div>
              </div>

              <div className="color-section">
                <span className="field-label">Content Color Picker</span>
                <div className="swatch-row">
                  <button
                    type="button"
                    className={"swatch swatch-default" + (!info.resume_accent ? " active" : "")}
                    onClick={() => setLook("resume_accent")("")}
                    title="Each template's own default content color"
                  >
                    Default
                  </button>
                  {PRESET_COLORS.map((c) => {
                    const on = (info.resume_accent || "").toLowerCase() === c.value;
                    return (
                      <button
                        key={c.value}
                        type="button"
                        className={"swatch" + (on ? " active" : "")}
                        style={{ background: c.value }}
                        onClick={() => setLook("resume_accent")(c.value)}
                        title={c.name}
                        aria-label={c.name}
                      >
                        {on ? "✓" : ""}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className={"swatch swatch-white" + ((info.resume_accent || "").toLowerCase() === "#ffffff" ? " active" : "")}
                    style={{ background: "#ffffff" }}
                    onClick={() => setLook("resume_accent")("#ffffff")}
                    title="White"
                    aria-label="White"
                  >
                    {(info.resume_accent || "").toLowerCase() === "#ffffff" ? "✓" : ""}
                  </button>
                  <label className="swatch swatch-custom" title="Custom color">
                    <input
                      type="color"
                      value={/^#[0-9a-fA-F]{6}$/.test(info.resume_accent || "") ? info.resume_accent : "#3366ff"}
                      onChange={(e) => setLook("resume_accent")(e.target.value)}
                    />
                  </label>
                </div>
              </div>

              <div className="font-section grid2">
                <label className="field">
                  <span className="field-label">Font</span>
                  <select className="input" value={info.resume_font || ""}
                    onChange={(e) => setLook("resume_font")(e.target.value)}>
                    {FONT_OPTIONS.map((f) => (
                      <option key={f.label} value={f.value}>{f.label}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">Size</span>
                  <select className="input" value={info.resume_font_size || ""}
                    onChange={(e) => setLook("resume_font_size")(e.target.value)}>
                    {SIZE_OPTIONS.map((s) => (
                      <option key={s || "default"} value={s}>{s ? `${s} pt` : "Default"}</option>
                    ))}
                  </select>
                </label>
              </div>

              <span className="field-label">Resume Style</span>
              <div className="style-grid">
                  {orderedStyles.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={"style-cell" + (info.resume_style === s.id ? " active" : "")}
                      onClick={() => setLook("resume_style")(info.resume_style === s.id ? "" : s.id)}
                      title={info.resume_style === s.id ? `${s.label} — click to clear` : s.label}
                    >
                      <img alt={s.label} src={styleThumb({
                        ...s,
                        ...(info.resume_accent ? { accent: info.resume_accent, head: info.resume_accent } : {}),
                        ...(info.resume_name_color ? { nameColor: info.resume_name_color } : {}),
                      })} />
                      {info.resume_style === s.id && <span className="style-check" aria-label="selected">✓</span>}
                    </button>
                  ))}
              </div>
              </div>

              {/* Right: the account's own last generated resume, rendered with
                  the selections on the left. */}
              <div className="setresume-pane setresume-preview">
                <span className="field-label">
                  Resume Preview
                  {lastResume && (lastResume.role || lastResume.company) ? (
                    <span className="detect-flag">
                      {[lastResume.role, lastResume.company].filter(Boolean).join(" — ")}
                    </span>
                  ) : null}
                </span>
                {previewHtml ? (
                  // The page renders at its true size and is scaled to fit; the
                  // sizer carries the scaled footprint, since a transform leaves
                  // layout size untouched.
                  <div className="setresume-stage" ref={stageRef}>
                    <div
                      className="setresume-sizer"
                      style={{ width: PAGE_W * fit.scale, height: fit.docH * fit.scale }}
                    >
                      <iframe
                        ref={frameRef}
                        className="setresume-page"
                        title="Resume preview"
                        srcDoc={previewHtml}
                        onLoad={onFrameLoad}
                        scrolling="no"
                        style={{
                          width: PAGE_W,
                          height: fit.docH,
                          transform: `scale(${fit.scale})`,
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="resume-viewer-empty muted">
                    No resume has been generated for this account yet. Generate one and the
                    last version appears here, styled with the choices on the left.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="save-bar">
          {saved && <span className="ok">Saved ✓</span>}
          <button className="btn primary" onClick={save}>Save</button>
        </div>
      </section>

      {/* SECTION 3 — collapsible read-only View of everything entered */}
      <section className="card">
        <div className="card-head">
          <h2 style={{ margin: 0 }}>View</h2>
          <div className="list-actions">
            <button className="btn small" onClick={collapseAll}>Collapse All</button>
            <button className="btn small" onClick={expandAll}>Expand All</button>
          </div>
        </div>

        <ViewSection title="Personal" open={!!openViews.personal} onToggle={() => toggleView("personal")}>
          <dl className="view-grid">
            <ViewRow label="Full Name" value={info.name} />
            <ViewRow label="Title" value={info.title} />
            <ViewRow label="Email" value={info.email} />
            <ViewRow label="Phone" value={info.phone} />
            <ViewRow label="Age" value={
              ageFromBirthDate(info.birth_date)
                ? `${ageFromBirthDate(info.birth_date)} (born ${info.birth_date})`
                : null
            } />
            <ViewRow label="Address" value={
              info.address ? (
                <>
                  {detected && <span className="flag">{countryFlag(detected)}</span>}
                  {info.address}
                </>
              ) : null
            } />
            <ViewRow label="LinkedIn" value={info.linkedin} />
            <ViewRow label="Portfolio" value={info.portfolio} />
            <ViewRow label="Tech Stack" value={info.main_stack} />
          </dl>
        </ViewSection>

        <ViewSection title="Education" open={!!openViews.education} onToggle={() => toggleView("education")}>
          {edu && (edu.university || edu.degree || edu.location || edu.period) ? (
            <dl className="view-grid">
              <ViewRow label="University" value={edu.university} />
              <ViewRow label="Degree" value={edu.degree} />
              <ViewRow label="Location" value={edu.location} />
              <ViewRow label="Period" value={edu.period} />
            </dl>
          ) : (
            <p className="muted small">Nothing added yet.</p>
          )}
        </ViewSection>

        <ViewSection title="Work History" count={roles.length}
          open={!!openViews.work} onToggle={() => toggleView("work")}>
          {roles.length === 0 ? (
            <p className="muted small">Nothing added yet.</p>
          ) : (
            <ul className="view-list">
              {roles.map((r, i) => (
                <li key={i}>
                  <strong>{r.role_name || "(role)"}</strong>
                  {r.company_name ? ` — ${r.company_name}` : ""}
                  <span className="muted small">
                    {[r.location, r.work_duration].filter(Boolean).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </ViewSection>

        <ViewSection title="Projects" count={projects.length}
          open={!!openViews.projects} onToggle={() => toggleView("projects")}>
          {projects.length === 0 ? (
            <p className="muted small">Nothing added yet.</p>
          ) : (
            <ul className="view-list">
              {projects.map((p, i) => (
                <li key={i}>
                  <strong>{p.title || "(project)"}</strong>
                  {p.link ? <span className="muted small">{p.link}</span> : null}
                  {p.description ? <div className="muted small">{p.description}</div> : null}
                </li>
              ))}
            </ul>
          )}
        </ViewSection>

        <ViewSection title="Additional Info" open={!!openViews.additional} onToggle={() => toggleView("additional")}>
          {info.additional_info && info.additional_info.trim() ? (
            <p className="view-text">{info.additional_info}</p>
          ) : (
            <p className="muted small">Nothing added yet.</p>
          )}
        </ViewSection>
      </section>

      {/* Progress modal while the resume PDF is being read by the AI */}
      {importing && (
        <div className="modal-overlay">
          <div className="modal modal-progress">
            <h3 className="modal-title">Importing from PDF</h3>
            <div className="spinner" />
            <p className="muted modal-msg">
              Reading your resume and filling in the form. This can take a few
              seconds…
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// A collapsible View section with a clickable header and chevron.
function ViewSection({ title, count, open, onToggle, children }) {
  return (
    <div className={"view-section" + (open ? " open" : "")}>
      <button className="view-section-head" onClick={onToggle} aria-expanded={open}>
        <span className="view-chevron">{open ? "▾" : "▸"}</span>
        <span className="view-section-title">{title}</span>
        {count ? <span className="tab-count">{count}</span> : null}
      </button>
      {open && <div className="view-section-body">{children}</div>}
    </div>
  );
}

// A single label/value row in a View section; hidden when the value is empty.
function ViewRow({ label, value }) {
  const empty =
    value == null || (typeof value === "string" && value.trim() === "");
  return (
    <>
      <dt>{label}</dt>
      <dd className={empty ? "muted" : ""}>{empty ? "—" : value}</dd>
    </>
  );
}
