import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { buildResumeHtml, buildCoverLetterHtml } from "../lib/resumeHtml";
import { styleThumb } from "../lib/styleThumbs";
import FlagSelect from "./FlagSelect";

const STYLES = [
  { id: "professional", label: "Professional", accent: "#2f5b8f" },
  { id: "modern", label: "Modern", accent: "#0d9488" },
  { id: "minimal", label: "Minimal", accent: "#6b7280" },
  { id: "creative", label: "Creative", accent: "#7c3aed" },
  { id: "technical", label: "Technical", accent: "#2563eb" },
  { id: "academic", label: "Academic", accent: "#334155" },
  { id: "executive", label: "Executive", accent: "#1f3a5f" },
  { id: "compact", label: "Compact", accent: "#475569" },
  { id: "cards", label: "Cards", accent: "#0d9488" },
];

// Sample accent colors. Selecting one applies it to EVERY template; "Default"
// (empty) lets each template keep its own built-in color.
const PRESET_COLORS = [
  { name: "Blue", value: "#2563eb" },
  { name: "Teal", value: "#0d9488" },
  { name: "Purple", value: "#7c3aed" },
  { name: "Navy", value: "#1f3a5f" },
  { name: "Green", value: "#16a34a" },
  { name: "Crimson", value: "#dc2626" },
  { name: "Orange", value: "#ea580c" },
  { name: "Slate", value: "#475569" },
  { name: "Indigo", value: "#4f46e5" },
  { name: "Sky", value: "#0ea5e9" },
  { name: "Cyan", value: "#0891b2" },
  { name: "Emerald", value: "#059669" },
  { name: "Lime", value: "#65a30d" },
  { name: "Amber", value: "#d97706" },
  { name: "Rose", value: "#e11d48" },
  { name: "Pink", value: "#db2777" },
  { name: "Fuchsia", value: "#c026d3" },
  { name: "Violet", value: "#6d28d9" },
  { name: "Maroon", value: "#9f1239" },
  { name: "Charcoal", value: "#1f2937" },
];

// Font family choices ("" keeps each template's own default).
const FONT_OPTIONS = [
  { value: "", label: "Template default" },
  { value: "Calibri, 'Segoe UI', Arial, sans-serif", label: "Calibri" },
  { value: "Arial, Helvetica, sans-serif", label: "Arial" },
  { value: "'Segoe UI', Arial, sans-serif", label: "Segoe UI" },
  { value: "Georgia, 'Times New Roman', serif", label: "Georgia" },
  { value: "'Times New Roman', Times, serif", label: "Times New Roman" },
  { value: "'Helvetica Neue', Arial, sans-serif", label: "Helvetica" },
  { value: "Verdana, Geneva, sans-serif", label: "Verdana" },
];
const SIZE_OPTIONS = ["", "9", "9.5", "10", "10.5", "11", "11.5", "12"];

export default function ResumeGenerator() {
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState("");
  const [keys, setKeys] = useState([]);
  const [keyId, setKeyId] = useState("");
  const [prompts, setPrompts] = useState([]);
  const [promptId, setPromptId] = useState("");
  const [style, setStyle] = useState("professional");
  const [styles, setStyles] = useState(STYLES);
  const [styleDragIndex, setStyleDragIndex] = useState(null);
  const [accent, setAccent] = useState("");
  const [font, setFont] = useState("");
  const [fontSize, setFontSize] = useState("");
  const [jd, setJd] = useState("");
  const [result, setResult] = useState("");
  const [jobRole, setJobRole] = useState("");
  const [jobCompany, setJobCompany] = useState("");
  const [jobCountry, setJobCountry] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [savedPath, setSavedPath] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [proxyActive, setProxyActive] = useState(false);
  const [autoPreview, setAutoPreview] = useState(false);
  const [autoOnPaste, setAutoOnPaste] = useState(true);
  const [openModalAfterPreview, setOpenModalAfterPreview] = useState(true);
  const [autoGenerate, setAutoGenerate] = useState(false);
  const [coverLetter, setCoverLetter] = useState(true);
  const [prefsReady, setPrefsReady] = useState(false); // toggles render after load
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const pastedRef = useRef(false);

  const clearCache = () => {
    setResult("");
    setJobRole("");
    setJobCompany("");
    setJobCountry("");
    setSavedPath("");
    setSavedAt("");
    api().setPref("gen_saved_path", "");
    api().setPref("gen_saved_at", "");
  };

  useEffect(() => {
    (async () => {
      const [accs, ks, instrs, accPref, stylePref, px, autoPref, accentPref, openModalPref, autoGenPref, jdPref, savedPathPref, savedAtPref, coverPref, styleOrderPref, fontPref, fontSizePref] = await Promise.all([
        api().listAccounts(),
        api().listApiKeys(),
        api().listInstructions(),
        api().getPref("selected_account_id"),
        api().getPref("resume_style"),
        api().getActiveProxy(),
        api().getPref("auto_preview"),
        api().getPref("resume_accent"),
        api().getPref("open_preview_after"),
        api().getPref("auto_generate"),
        api().getPref("gen_jd"),
        api().getPref("gen_saved_path"),
        api().getPref("gen_saved_at"),
        api().getPref("cover_letter"),
        api().getPref("style_order"),
        api().getPref("resume_font"),
        api().getPref("resume_font_size"),
      ]);
      setAccounts(accs || []);
      setKeys(ks || []);
      setPrompts(instrs || []);
      setProxyActive(!!(px && px.enabled));
      if (autoPref && autoPref.value != null) setAutoOnPaste(autoPref.value === "1");

      const activePrompt = (instrs || []).find((p) => p.is_active);
      if (activePrompt) setPromptId(String(activePrompt.id));
      else if (instrs && instrs.length) setPromptId(String(instrs[0].id));

      const savedAcc = accPref && accPref.value;
      const accExists = (accs || []).some((a) => String(a.id) === String(savedAcc));
      if (accExists) setAccountId(String(savedAcc));
      else if (accs && accs.length) setAccountId(String(accs[0].id));

      const active = (ks || []).find((k) => k.is_active);
      if (active) setKeyId(String(active.id));
      else if (ks && ks.length) setKeyId(String(ks[0].id));

      if (stylePref && stylePref.value) setStyle(stylePref.value);
      if (accentPref && accentPref.value) setAccent(accentPref.value);
      if (openModalPref && openModalPref.value != null) setOpenModalAfterPreview(openModalPref.value === "1");
      if (autoGenPref && autoGenPref.value != null) setAutoGenerate(autoGenPref.value === "1");
      if (fontPref && fontPref.value != null) setFont(fontPref.value);
      if (fontSizePref && fontSizePref.value != null) setFontSize(fontSizePref.value);
      if (coverPref && coverPref.value != null) setCoverLetter(coverPref.value === "1");

      if (jdPref && jdPref.value) setJd(jdPref.value);
      if (savedPathPref && savedPathPref.value) setSavedPath(savedPathPref.value);
      if (savedAtPref && savedAtPref.value) setSavedAt(savedAtPref.value);

      if (styleOrderPref && styleOrderPref.value) {
        const order = styleOrderPref.value.split(",");
        const ranked = [...STYLES].sort((a, b) => {
          const ia = order.indexOf(a.id);
          const ib = order.indexOf(b.id);
          return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
        });
        setStyles(ranked);
      }

      // Everything loaded — now the toggles can render with their saved values.
      setPrefsReady(true);
    })();
  }, []);

  const onAccount = (v) => { setAccountId(v); api().setPref("selected_account_id", v); clearCache(); };
  const onKey = (v) => { setKeyId(v); api().setActiveApiKey(Number(v)); clearCache(); };

  const onStyle = (id) => { setStyle(id); api().setPref("resume_style", id); };

  const onStyleDragStart = (i) => (e) => { setStyleDragIndex(i); e.dataTransfer.effectAllowed = "move"; };
  const onStyleDragOver = (i) => (e) => {
    e.preventDefault();
    if (styleDragIndex === null || styleDragIndex === i) return;
    setStyles((arr) => {
      const next = arr.slice();
      const [m] = next.splice(styleDragIndex, 1);
      next.splice(i, 0, m);
      return next;
    });
    setStyleDragIndex(i);
  };
  const onStyleDragEnd = () => {
    setStyleDragIndex(null);
    setStyles((arr) => { api().setPref("style_order", arr.map((s) => s.id).join(",")); return arr; });
  };

  const chooseAccent = (v) => { setAccent(v); api().setPref("resume_accent", v); };
  const onFont = (v) => { setFont(v); api().setPref("resume_font", v); };
  const onFontSize = (v) => { setFontSize(v); api().setPref("resume_font_size", v); };

  const onPrompt = async (v) => {
    setPromptId(v);
    await api().setActiveInstruction(Number(v));
    const fresh = await api().listInstructions();
    setPrompts(fresh || []);
    clearCache();
  };

  const selectedPrompt = prompts.find((p) => String(p.id) === String(promptId));
  const styleObj = STYLES.find((s) => s.id === style);
  const effectiveAccent = accent || (styleObj && styleObj.accent) || "#2f5b8f";
  const accountTitle = () => {
    const a = accounts.find((x) => String(x.id) === String(accountId));
    return (a && a.title) || "";
  };

  const callApi = async () =>
    api().generateResume({
      accountId: Number(accountId),
      jobDescription: jd,
      style,
      instructionId: promptId ? Number(promptId) : undefined,
    });

  // Build + save the PDF (and optional cover letter) from generated content.
  const exportPdf = async (content, role, company, country) => {
    if (!accountId) { setError("Select an account first."); return; }
    if (!content) {
      setError("Click Preview first to generate the content, then Generate to download the PDF.");
      return;
    }
    setLoading(true);
    setError("");
    setSavedPath("");
    try {
      const acc = await api().getAccount(Number(accountId));

      let coverHtml = null;
      if (coverLetter) {
        try {
          const cl = await api().generateCoverLetter({
            accountId: Number(accountId),
            jobDescription: jd,
            instructionId: promptId ? Number(promptId) : undefined,
            role,
            company,
          });
          if (cl && cl.text) {
            coverHtml = buildCoverLetterHtml(cl.text, { ...styleObj, accent: effectiveAccent, font, fontSize }, acc);
          }
        } catch (e) {
          setError(`Cover letter skipped: ${e.message || String(e)}`);
        }
      }

      const exp = await api().exportResumePdf({
        html: buildResumeHtml(content, { ...styleObj, accent: effectiveAccent, font, fontSize }, accountTitle(), acc),
        coverHtml,
        accountId: Number(accountId),
        role,
        company,
        country,
      });
      if (exp && exp.ok) {
        setSavedPath(exp.path);
        setSavedAt(exp.savedAt || "");
        api().setPref("gen_saved_path", exp.path);
        api().setPref("gen_saved_at", exp.savedAt || "");
        copyFolderToClipboard(exp.path);
      } else setError(`PDF failed: ${(exp && exp.error) || "unknown error"}`);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const generate = () => exportPdf(result, jobRole, jobCompany, jobCountry);

  // Preview: call the AI once, cache the content, optionally pop the modal,
  // and optionally chain straight into Generate.
  const preview = async () => {
    if (!accountId) { setError("Select an account first."); return; }
    const px = await api().getActiveProxy();
    if (!px || !px.enabled) {
      setError("Activate a proxy in Proxy Settings first (Set Active). Resume generation runs through the proxy.");
      return;
    }
    setLoading(true);
    setError("");
    setSavedPath("");
    try {
      const res = await callApi();
      setResult(res.text || "");
      setJobRole(res.jobRole || "");
      setJobCompany(res.jobCompany || "");
      setJobCountry(res.jobCountry || "");
      if (openModalAfterPreview) setShowPreview(true);
      if (autoGenerate) {
        await exportPdf(res.text || "", res.jobRole || "", res.jobCompany || "", res.jobCountry || "");
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!autoPreview) return;
    setAutoPreview(false);
    if (jd.trim() && accountId && !loading) preview();
  }, [autoPreview, jd]); // eslint-disable-line react-hooks/exhaustive-deps

  const openFolder = async () => {
    if (!savedPath) { setNotice("Generate a resume first — then Open Folder will reveal the saved PDF."); return; }
    const res = await api().revealPdf(savedPath);
    if (res && !res.ok) setNotice(res.error || "Could not open the folder.");
  };
  const openFile = async () => {
    if (!savedPath) { setNotice("Generate a resume first — then Open File will open the saved PDF."); return; }
    const res = await api().openPdf(savedPath);
    if (res && !res.ok) setNotice(res.error || "Could not open the file.");
  };

  const copyFolderToClipboard = async (filePath) => {
    if (!filePath) return;
    const folder = filePath.replace(/[\\/][^\\/]*$/, "");
    try {
      await navigator.clipboard.writeText(folder);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (_) {}
  };
  const copyLocation = () => copyFolderToClipboard(savedPath);

  const copy = () => navigator.clipboard.writeText(result);

  return (
    <div>
    <div className="resume-layout">
      <section className="card resume-styles">
        <h2>Resume Styles</h2>
        <p className="muted">Pick a template.</p>

        <div className="color-section">
          <span className="field-label">Color Picker</span>
          <div className="swatch-row">
            <button
              type="button"
              className={"swatch swatch-default" + (!accent ? " active" : "")}
              onClick={() => chooseAccent("")}
              title="Each template's own default color"
            >
              Default
            </button>
            {PRESET_COLORS.map((c) => {
              const on = accent.toLowerCase() === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  className={"swatch" + (on ? " active" : "")}
                  style={{ background: c.value }}
                  onClick={() => chooseAccent(c.value)}
                  title={c.name}
                  aria-label={c.name}
                >
                  {on ? "✓" : ""}
                </button>
              );
            })}
          </div>
        </div>

        <div className="font-section grid2">
          <label className="field">
            <span className="field-label">Font</span>
            <select className="input" value={font} onChange={(e) => onFont(e.target.value)}>
              {FONT_OPTIONS.map((f) => (
                <option key={f.label} value={f.value}>{f.label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Size</span>
            <select className="input" value={fontSize} onChange={(e) => onFontSize(e.target.value)}>
              {SIZE_OPTIONS.map((s) => (
                <option key={s || "default"} value={s}>{s ? `${s} pt` : "Default"}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="style-grid">
          {styles.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={
                (style === s.id ? "style-cell active" : "style-cell") +
                (styleDragIndex === i ? " dragging" : "")
              }
              onClick={() => onStyle(s.id)}
              title={`${s.label} — drag to reorder`}
              draggable
              onDragStart={onStyleDragStart(i)}
              onDragOver={onStyleDragOver(i)}
              onDragEnd={onStyleDragEnd}
            >
              <img alt={s.label} src={styleThumb(accent ? { ...s, accent } : s)} />
              {style === s.id && <span className="style-check" aria-label="active">✓</span>}
            </button>
          ))}
        </div>
      </section>

      <section className="card resume-form">
        <div className="card-head">
          <h2>Generate Resume</h2>
          <span className="field-label" style={{ margin: 0 }}>
            Proxy{" "}
            {proxyActive ? (
              <span className="badge live badge-gap">active</span>
            ) : (
              <span className="badge off badge-gap">off</span>
            )}
          </span>
        </div>
        <p className="muted">
          Uses the selected API key and account. Optionally paste a job
          description to tailor the resume.
          {!proxyActive && " Activate a proxy in Proxy Settings to generate."}
        </p>

        <div className="grid2">
          <label className="field">
            <span className="field-label">Account</span>
            <FlagSelect
              value={accountId}
              onChange={onAccount}
              placeholder={accounts.length ? "Select account" : "No accounts — add one first"}
              options={accounts.map((a) => ({
                value: a.id,
                name: (a.name || "(unnamed)") + (a.main_stack ? ` (${a.main_stack})` : ""),
                country: a.country,
              }))}
            />
          </label>

          <label className="field">
            <span className="field-label">Active AI API Key</span>
            <FlagSelect
              value={keyId}
              onChange={onKey}
              placeholder={keys.length ? "Select key" : "No keys — add one first"}
              options={keys.map((k) => ({ value: k.id, name: k.name || "(unnamed key)" }))}
            />
          </label>
        </div>

        <label className="field">
          <span className="field-label">Active Prompt</span>
          <FlagSelect
            value={promptId}
            onChange={onPrompt}
            placeholder={prompts.length ? "Select a prompt" : "No prompts — add in Instructions"}
            options={prompts.map((p) => ({ value: p.id, name: p.name || "(untitled)" }))}
          />
        </label>
        <div className="prompt-preview">
          {selectedPrompt
            ? selectedPrompt.body || "(this prompt is empty)"
            : "Select a prompt to see its content."}
        </div>

        <label className="field">
          <span className="field-label">Job Description</span>
          <textarea
            className="textarea"
            rows={14}
            placeholder="(Optional) Paste a target job description here..."
            value={jd}
            onChange={(e) => {
              setJd(e.target.value);
              api().setPref("gen_jd", e.target.value);
              clearCache();
              // "Auto-preview on paste" is the sole gate for paste-triggered
              // work. Auto-generate only chains AFTER a preview runs (whether
              // that preview was triggered by paste or by clicking Preview).
              if (pastedRef.current && autoOnPaste) setAutoPreview(true);
              pastedRef.current = false;
            }}
            onPaste={() => { pastedRef.current = true; }}
          />
        </label>
        <div className="action-row">
          <div className="action-group">
            {prefsReady && (<>
            <label className="toggle" title="Run Preview automatically when you paste a job description">
              <input
                type="checkbox"
                checked={autoOnPaste}
                onChange={(e) => { setAutoOnPaste(e.target.checked); api().setPref("auto_preview", e.target.checked ? "1" : "0"); }}
              />
              <span className="toggle-track"><span className="toggle-thumb" /></span>
              <span className="toggle-label">Auto-preview on paste</span>
            </label>
            <label className="toggle" title="Automatically generate the PDF right after the content is fetched">
              <input
                type="checkbox"
                checked={autoGenerate}
                onChange={(e) => { setAutoGenerate(e.target.checked); api().setPref("auto_generate", e.target.checked ? "1" : "0"); }}
              />
              <span className="toggle-track"><span className="toggle-thumb" /></span>
              <span className="toggle-label">Auto-generate</span>
            </label>
            <label className="toggle" title="Open the content preview modal after Preview finishes">
              <input
                type="checkbox"
                checked={openModalAfterPreview}
                onChange={(e) => { setOpenModalAfterPreview(e.target.checked); api().setPref("open_preview_after", e.target.checked ? "1" : "0"); }}
              />
              <span className="toggle-track"><span className="toggle-thumb" /></span>
              <span className="toggle-label">Open preview modal</span>
            </label>
            <label className="toggle" title="Also generate a matching cover letter (Cover Letter.pdf) in the same folder">
              <input
                type="checkbox"
                checked={coverLetter}
                onChange={(e) => { setCoverLetter(e.target.checked); api().setPref("cover_letter", e.target.checked ? "1" : "0"); }}
              />
              <span className="toggle-track"><span className="toggle-thumb" /></span>
              <span className="toggle-label">Cover letter</span>
            </label>
            </>)}
          </div>
          <div className="action-group">
            <button className="btn" onClick={preview} disabled={loading}>
              {loading ? "Generating…" : "Preview"}
            </button>
            <button className="btn primary" onClick={generate} disabled={loading}>
              Generate Resume
            </button>
            <button className="btn" onClick={openFolder} disabled={loading || !savedPath}>
              Open Folder
            </button>
            <button className="btn" onClick={openFile} disabled={loading || !savedPath}>
              Open File
            </button>
          </div>
        </div>
        {error && <div className="error">{error}</div>}
        {savedPath && (
          <div className="ok-box saved-box">
            <span className="saved-text">
              Saved PDF to: {savedPath}
              {savedAt && (
                <span className="muted small" style={{ display: "block", marginTop: 4 }}>
                  Generated {savedAt}
                </span>
              )}
            </span>
            <button className="btn small" onClick={copyLocation} title="Copy the folder path to the clipboard">
              {copied ? "Copied ✓" : "Copy Location"}
            </button>
          </div>
        )}
      </section>
    </div>

    {showPreview && (
      <div className="modal-overlay" onClick={() => setShowPreview(false)}>
        <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
          <div className="card-head">
            <h2>Generated Resume</h2>
            <div className="list-actions">
              {result && <button className="btn small" onClick={copy}>Copy</button>}
              <button className="btn small" onClick={() => setShowPreview(false)}>Close</button>
            </div>
          </div>
          {result
            ? <pre className="resume-output">{result}</pre>
            : <p className="muted">No content.</p>}
        </div>
      </div>
    )}

    {notice && (
      <div className="modal-overlay" onClick={() => setNotice("")}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h3 className="modal-title">Not ready yet</h3>
          <p className="muted modal-msg">{notice}</p>
          <div className="modal-actions">
            <button className="btn primary" onClick={() => setNotice("")} autoFocus>OK</button>
          </div>
        </div>
      </div>
    )}
    </div>
  );
}
