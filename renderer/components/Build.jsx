import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useDbChanged } from "../lib/useDbChanged";
import { buildResumeHtml, PAGE_FOOTER_STYLES } from "../lib/resumeHtml";
import { STYLES, hasSavedLook, rankStyles } from "../lib/resumeStyles";
import FlagSelect from "./FlagSelect";
import ResumeStylesPanel from "./ResumeStylesPanel";

// Build: turn a resume JSON reply from ChatGPT into a resume - pick the account
// and the look (the same Resume Styles panel as Generate), preview it as real
// PDF pages, and save it wherever you like. Unlike Generate, nothing is
// extracted, sent to ChatGPT or filed in the history.
export default function Build() {
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState("");
  const [styles, setStyles] = useState(STYLES);
  const [styleDragIndex, setStyleDragIndex] = useState(null);
  const [style, setStyle] = useState("modern");
  const [accent, setAccent] = useState("");
  const [nameColor, setNameColor] = useState("");
  const [font, setFont] = useState("");
  const [fontSize, setFontSize] = useState("");
  const [json, setJson] = useState("");
  const [parsed, setParsed] = useState(null); // { text, jobRole, jobCompany, jobCountry }
  const [view, setView] = useState("build"); // "build" | "preview" sub-tab
  const [pdfUrl, setPdfUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedTo, setSavedTo] = useState("");
  const urlRef = useRef("");

  const toast = (message, type = "alert") =>
    window.dispatchEvent(new CustomEvent("app-notify", { detail: { message, type } }));

  // Start from the look Generate uses; choices made here don't change Generate's
  // (the template order is shared, as it is everywhere).
  useEffect(() => {
    (async () => {
      const [accs, acc, st, ac, nc, fo, fs, order, draft] = await Promise.all([
        api().listAccounts(),
        api().getPref("build_account_id"),
        api().getPref("resume_style"),
        api().getPref("resume_accent"),
        api().getPref("resume_name_color"),
        api().getPref("resume_font"),
        api().getPref("resume_font_size"),
        api().getPref("style_order"),
        api().getPref("build_json"),
      ]);
      setAccounts(accs || []);
      const saved = acc && acc.value;
      if ((accs || []).some((a) => String(a.id) === String(saved))) setAccountId(String(saved));
      else if (accs && accs.length) setAccountId(String(accs[0].id));
      if (st && st.value && STYLES.some((s) => s.id === st.value)) setStyle(st.value);
      if (ac && ac.value) setAccent(ac.value);
      if (nc && nc.value) setNameColor(nc.value);
      if (fo && fo.value != null) setFont(fo.value);
      if (fs && fs.value != null) setFontSize(fs.value);
      if (order && order.value) setStyles(rankStyles(order.value));
      if (draft && draft.value) setJson(draft.value);
    })();
    return () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); };
  }, []);
  useDbChanged(() => api().listAccounts().then((a) => setAccounts(a || [])));

  // An account with a saved look (Accounts → Set Resume) brings it along.
  const onAccount = async (v) => {
    setAccountId(String(v));
    api().setPref("build_account_id", String(v));
    const acc = await api().getAccount(Number(v));
    if (!hasSavedLook(acc)) return;
    const st = (acc.resume_style || "").trim();
    if (st && STYLES.some((s) => s.id === st)) setStyle(st);
    if ((acc.resume_accent || "").trim()) setAccent(acc.resume_accent.trim());
    if ((acc.resume_name_color || "").trim()) setNameColor(acc.resume_name_color.trim());
    if ((acc.resume_font || "").trim()) setFont(acc.resume_font.trim());
    if ((acc.resume_font_size || "").trim()) setFontSize(acc.resume_font_size.trim());
  };

  // ---- The Resume Styles panel's handlers (as in Generate) -------------------
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
    if (styleDragIndex === null) return;
    setStyleDragIndex(null);
    const order = styles.map((s) => s.id).join(",");
    api()
      .setPref("style_order", order)
      .then(() => api().getPref("style_order"))
      .then((pref) => { if (pref && pref.value) setStyles(rankStyles(pref.value)); });
  };
  // Cards puts the name on a coloured header, so there the two can't match.
  const colorLock = style === "cards";
  const chooseAccent = (v) => {
    if (colorLock && v && nameColor && v.toLowerCase() === nameColor.toLowerCase()) {
      toast("On the Cards style the name sits on a coloured header — pick a different Content colour.", "warning");
      return;
    }
    setAccent(v);
  };
  const chooseNameColor = (v) => {
    if (colorLock && v && accent && v.toLowerCase() === accent.toLowerCase()) {
      toast("On the Cards style the name sits on a coloured header — pick a different Name colour.", "warning");
      return;
    }
    setNameColor(v);
  };

  // The resume page for the current reply, account and look, plus its footer.
  const makeHtml = async (content) => {
    const acc = await api().getAccount(Number(accountId));
    const edu = await api().listEducation(Number(accountId));
    const styleObj = STYLES.find((s) => s.id === style) || STYLES[0];
    const html = buildResumeHtml(
      content,
      { ...styleObj, accent: accent || styleObj.accent || "#2f5b8f", head: accent, nameColor, font, fontSize },
      (acc && acc.title) || "",
      acc,
      edu
    );
    const footerLabel = PAGE_FOOTER_STYLES.has(style) && acc && acc.name ? `${acc.name} Resume` : "";
    return { html, footerLabel, acc };
  };

  // Render the PDF preview for parsed content.
  const preview = async (content) => {
    const { html, footerLabel } = await makeHtml(content);
    const res = await api().buildPdf({ html, footerLabel });
    if (!res || !res.ok) { setError((res && res.error) || "Couldn't render the preview."); return false; }
    const bytes = Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = url;
    setPdfUrl(url);
    return true;
  };

  const build = async () => {
    setError("");
    setSavedTo("");
    if (!json.trim()) { setError("Paste the resume JSON reply from ChatGPT first."); setView("build"); return; }
    if (!accountId) { setError("Select an account first — its name and contacts go in the header."); setView("build"); return; }
    setBusy(true);
    try {
      const res = await api().buildParse(json);
      if (!res || !res.ok) {
        setParsed(null);
        setError((res && res.error) || "Couldn't read that reply.");
        setView("build");
        return;
      }
      setParsed(res);
      if (await preview(res.text)) setView("preview"); // jump to the preview, as Generate does
    } finally {
      setBusy(false);
    }
  };

  // A built resume follows changes to the account and the look straight away.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    if (!parsed) return;
    const t = setTimeout(() => { preview(parsed.text).catch(() => {}); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, style, accent, nameColor, font, fontSize]);

  const saveAs = async () => {
    if (!parsed) return;
    setError("");
    setBusy(true);
    try {
      const { html, footerLabel, acc } = await makeHtml(parsed.text);
      const fileName = [
        (acc && acc.name) || "",
        [parsed.jobRole, parsed.jobCompany ? `(${parsed.jobCompany})` : ""].filter(Boolean).join(" "),
      ].filter(Boolean).join(" - ");
      const res = await api().buildSaveAs({ html, footerLabel, fileName });
      if (res && res.ok) { setSavedTo(res.path); toast("Resume saved.", "success"); }
      else if (res && !res.canceled) setError(res.error || "Couldn't save the PDF.");
    } finally {
      setBusy(false);
    }
  };

  const onJson = (v) => {
    setJson(v);
    api().setPref("build_json", v);
  };

  const target =
    parsed && (parsed.jobRole || parsed.jobCompany) ? (
      <div className="jobpost-meta">
        {parsed.jobRole ? <span className="jobpost-chip"><b>Role:</b> {parsed.jobRole}</span> : null}
        {parsed.jobCompany ? <span className="jobpost-chip"><b>Company:</b> {parsed.jobCompany}</span> : null}
        {parsed.jobCountry ? <span className="jobpost-chip"><b>Country:</b> {parsed.jobCountry}</span> : null}
      </div>
    ) : null;

  return (
    <div className="resume-layout">
      <ResumeStylesPanel
        styles={styles}
        style={style}
        styleDragIndex={styleDragIndex}
        accent={accent}
        nameColor={nameColor}
        font={font}
        fontSize={fontSize}
        colorLock={colorLock}
        onStyle={setStyle}
        chooseAccent={chooseAccent}
        chooseNameColor={chooseNameColor}
        onFont={setFont}
        onFontSize={setFontSize}
        onStyleDragStart={onStyleDragStart}
        onStyleDragOver={onStyleDragOver}
        onStyleDragEnd={onStyleDragEnd}
      />

      <section className="card resume-form">
        <div className="resume-tabs">
          <button
            type="button"
            className={"resume-tab" + (view === "build" ? " active" : "")}
            onClick={() => setView("build")}
          >
            Build Resume
          </button>
          <button
            type="button"
            className={"resume-tab" + (view === "preview" ? " active" : "")}
            onClick={() => setView("preview")}
          >
            Preview Resume
          </button>
        </div>

        {view === "build" && (
          <>
            <div className="field">
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
            </div>

            <label className="field jd-field">
              <span className="field-label field-label-row">
                <span>Resume JSON <span className="req">(required)</span></span>
                <span className="muted small">the whole reply from ChatGPT — text around the JSON is fine</span>
              </span>
              <textarea
                className="textarea build-json"
                spellCheck={false}
                placeholder={'{ "request_id": "…", "resume": { … } }'}
                value={json}
                onChange={(e) => onJson(e.target.value)}
              />
            </label>

            {target}
            {error && <div className="error">{error}</div>}

            <div className="action-row">
              <div className="action-group">
                <span className="muted small">Builds the resume from the reply and shows it in Preview Resume.</span>
              </div>
              <div className="action-group">
                <button className="btn primary" onClick={build} disabled={busy}>
                  {busy ? "Building…" : "Build Resume"}
                </button>
              </div>
            </div>
          </>
        )}

        {view === "preview" && (
          <>
            <div className="action-row preview-actions">
              <div className="action-group">
                <button className="btn primary" onClick={build} disabled={busy}>
                  {busy ? "Building…" : "Build Resume"}
                </button>
                <button className="btn" onClick={saveAs} disabled={busy || !parsed} title="Save the PDF wherever you like">
                  Save as…
                </button>
              </div>
            </div>
            {savedTo && <div className="muted small saved-inline">Saved to {savedTo}</div>}
            {error && <div className="error">{error}</div>}
            <div className="resume-viewer-wrap">
              {pdfUrl ? (
                <iframe className="resume-viewer" title="Resume PDF" src={pdfUrl + "#toolbar=1&navpanes=0&view=FitH"} />
              ) : (
                <div className="resume-viewer-empty muted">
                  Paste a resume JSON reply in Build Resume and press Build Resume to see it here as real PDF pages.
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
