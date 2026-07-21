import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { detectCountry, countryFlag } from "../lib/flags";
import { friendlyError } from "../lib/errors";
import { ageFromBirthDate } from "../lib/age";
import Field from "./Field";

const EMPTY_ROLE = {
  role_name: "",
  company_name: "",
  location: "",
  work_duration: "",
};

const EMPTY_PROJECT = { title: "", link: "", description: "" };

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
  }, [accountId]);

  const setI = (k) => (v) => {
    setInfo((f) => ({ ...f, [k]: v }));
    setSaved(false);
  };

  const setRole = (i, k) => (e) => {
    const val = e.target.value;
    setRoles((rs) => rs.map((r, idx) => (idx === i ? { ...r, [k]: val } : r)));
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
          <button className="btn small" onClick={runImport} disabled={importing}>
            {importing ? "Importing…" : "Import from PDF"}
          </button>
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
                      <input className="input" placeholder="e.g. 2021–2024"
                        value={r.work_duration || ""} onChange={setRole(i, "work_duration")} />
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
