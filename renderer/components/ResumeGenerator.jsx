import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { buildResumeHtml, buildCoverLetterHtml } from "../lib/resumeHtml";
import { styleThumb } from "../lib/styleThumbs";
import { modelTiny, providerLabel } from "../lib/aiModels";
import { friendlyError } from "../lib/errors";
import FlagSelect from "./FlagSelect";

const STYLES = [
  { id: "modern", label: "Modern", accent: "#0d9488" },
  { id: "minimal", label: "Minimal", accent: "#6b7280" },
  { id: "creative", label: "Creative", accent: "#7c3aed" },
  { id: "technical", label: "Technical", accent: "#2563eb" },
  { id: "academic", label: "Academic", accent: "#334155" },
  { id: "compact", label: "Compact", accent: "#475569" },
  { id: "cards", label: "Cards", accent: "#0d9488" },
];

// Sample colors. The Content picker applies one to EVERY template's borders,
// category headings and backgrounds; the Name picker recolors the name + title.
// "Default" (empty) lets each template keep its own built-in colors.
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
  { name: "Rose", value: "#e11d48" },
  { name: "Pink", value: "#db2777" },
  { name: "Charcoal", value: "#1f2937" },
];

// Font family choices ("" keeps each template's own default).
const FONT_OPTIONS = [
  { value: "", label: "Template default" },
  // Sans-serif
  { value: "Calibri, 'Segoe UI', Arial, sans-serif", label: "Calibri" },
  { value: "'Segoe UI', Arial, sans-serif", label: "Segoe UI" },
  { value: "Arial, Helvetica, sans-serif", label: "Arial" },
  { value: "'Helvetica Neue', Arial, sans-serif", label: "Helvetica" },
  { value: "Verdana, Geneva, sans-serif", label: "Verdana" },
  { value: "Tahoma, Geneva, sans-serif", label: "Tahoma" },
  { value: "'Trebuchet MS', Tahoma, sans-serif", label: "Trebuchet MS" },
  { value: "Candara, 'Segoe UI', sans-serif", label: "Candara" },
  { value: "Corbel, 'Segoe UI', sans-serif", label: "Corbel" },
  { value: "'Century Gothic', 'Apple SD Gothic Neo', sans-serif", label: "Century Gothic" },
  { value: "'Franklin Gothic Book', 'Arial Narrow', sans-serif", label: "Franklin Gothic" },
  { value: "'Lucida Sans', 'Lucida Grande', sans-serif", label: "Lucida Sans" },
  // Serif
  { value: "Georgia, 'Times New Roman', serif", label: "Georgia" },
  { value: "'Times New Roman', Times, serif", label: "Times New Roman" },
  { value: "Cambria, Georgia, serif", label: "Cambria" },
  { value: "Constantia, Georgia, serif", label: "Constantia" },
  { value: "'Palatino Linotype', 'Book Antiqua', Palatino, serif", label: "Palatino" },
  { value: "'Book Antiqua', Palatino, Georgia, serif", label: "Book Antiqua" },
  { value: "Garamond, 'EB Garamond', Georgia, serif", label: "Garamond" },
];
const SIZE_OPTIONS = ["", "9", "9.5", "10", "10.5", "11", "11.5", "12"];

// Shown when the user tweaks a style/colour/font but hasn't generated a resume.
const NO_CONTENT_MSG = "There is no resume content yet. Please generate a resume first.";

export default function ResumeGenerator({ variant = "v1" }) {
  const isV2 = variant === "v2";
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState("");
  const [keys, setKeys] = useState([]);
  const [keyId, setKeyId] = useState("");
  const [prompts, setPrompts] = useState([]);
  const [promptId, setPromptId] = useState("");
  const [style, setStyle] = useState("modern");
  const [styles, setStyles] = useState(STYLES);
  const [styleDragIndex, setStyleDragIndex] = useState(null);
  const [accent, setAccent] = useState("");
  const [nameColor, setNameColor] = useState("");
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
  const [autoOnPaste, setAutoOnPaste] = useState(true);
  const [openModalAfterPreview, setOpenModalAfterPreview] = useState(true);
  const [autoGenerate, setAutoGenerate] = useState(false);
  const [coverLetter, setCoverLetter] = useState(true);
  const [prefsReady, setPrefsReady] = useState(false); // toggles render after load
  const [copied, setCopied] = useState(false);
  const [acctInfo, setAcctInfo] = useState(null); // contact info for the live viewer
  const [eduRows, setEduRows] = useState([]); // structured education for the resume
  const [view, setView] = useState("generate"); // "generate" | "preview" sub-tab
  const [pickersOpen, setPickersOpen] = useState(true); // colors & font section expanded
  const [pdfUrl, setPdfUrl] = useState(""); // blob URL of the saved PDF for inline viewing
  const [v2Waiting, setV2Waiting] = useState(false); // V2: waiting for the ChatGPT reply on the clipboard
  const pastedRef = useRef(false);
  const busyRef = useRef(false); // guards overlapping PDF renders

  // Brief in-app toast, shown by the single global toast in the app shell.
  const toast = (message, type = "alert") =>
    window.dispatchEvent(new CustomEvent("app-notify", { detail: { message, type } }));

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
      const [accs, ks, instrs, accPref, stylePref, px, autoPref, accentPref, nameColorPref, openModalPref, autoGenPref, jdPref, savedPathPref, savedAtPref, coverPref, styleOrderPref, fontPref, fontSizePref] = await Promise.all([
        api().listAccounts(),
        api().listApiKeys(isV2 ? "v2" : "v1"),
        api().listInstructions(),
        api().getPref("selected_account_id"),
        api().getPref("resume_style"),
        api().getActiveProxy(),
        api().getPref("auto_preview"),
        api().getPref("resume_accent"),
        api().getPref("resume_name_color"),
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

      if (stylePref && stylePref.value && STYLES.some((s) => s.id === stylePref.value)) setStyle(stylePref.value);
      if (accentPref && accentPref.value) setAccent(accentPref.value);
      if (nameColorPref && nameColorPref.value) setNameColor(nameColorPref.value);
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

  // Keep the selected account's contact info handy so the live resume viewer
  // renders the same authoritative header the exported PDF uses.
  useEffect(() => {
    if (!accountId) { setAcctInfo(null); setEduRows([]); return; }
    let cancelled = false;
    api().getAccount(Number(accountId)).then((a) => { if (!cancelled) setAcctInfo(a || null); });
    api().listEducation(Number(accountId)).then((rows) => { if (!cancelled) setEduRows(rows || []); });
    return () => { cancelled = true; };
  }, [accountId]);

  // V2: if the user leaves this tab while a clipboard watch is running, stop it.
  useEffect(() => {
    return () => { if (isV2) api().cancelChatgptClipboard(); };
  }, [isV2]);

  // Load the saved PDF's bytes into a blob URL so the preview tab can render the
  // real, paginated PDF inline. Re-runs on each new generation (savedAt changes).
  useEffect(() => {
    let revoked = false;
    let url = "";
    if (!savedPath) { setPdfUrl(""); return; }
    (async () => {
      try {
        const res = await api().readPdf(savedPath);
        if (revoked) return;
        if (res && res.ok && res.base64) {
          const bytes = Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0));
          url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
          setPdfUrl(url);
        } else {
          setPdfUrl("");
        }
      } catch (_) {
        if (!revoked) setPdfUrl("");
      }
    })();
    return () => { revoked = true; if (url) URL.revokeObjectURL(url); };
  }, [savedPath, savedAt]);

  // Re-render the resume PDF automatically when the user changes the style, a
  // colour, or the font (debounced; cover letter untouched so there's no AI
  // call/cost). Lets the preview track template/colour choices live.
  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => {
      if (!busyRef.current) exportPdf(result, jobRole, jobCompany, jobCountry, jd, { skipCover: true });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accent, nameColor, style, font, fontSize]);

  const onAccount = (v) => { setAccountId(v); api().setPref("selected_account_id", v); clearCache(); };
  const onKey = (v) => { setKeyId(v); api().setActiveApiKey(Number(v)); clearCache(); };

  const onStyle = (id) => { setStyle(id); api().setPref("resume_style", id); if (!result) toast(NO_CONTENT_MSG, "warning"); };

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

  const chooseAccent = (v) => {
    if (v && nameColor && v.toLowerCase() === nameColor.toLowerCase()) {
      toast("That colour is already used by the Name picker — choose a different one.", "warning");
      return;
    }
    setAccent(v); api().setPref("resume_accent", v); if (!result) toast(NO_CONTENT_MSG, "warning");
  };
  const chooseNameColor = (v) => {
    if (v && accent && v.toLowerCase() === accent.toLowerCase()) {
      toast("That colour is already used by the Content picker — choose a different one.", "warning");
      return;
    }
    setNameColor(v); api().setPref("resume_name_color", v); if (!result) toast(NO_CONTENT_MSG, "warning");
  };
  const onFont = (v) => { setFont(v); api().setPref("resume_font", v); if (!result) toast(NO_CONTENT_MSG, "warning"); };
  const onFontSize = (v) => { setFontSize(v); api().setPref("resume_font_size", v); if (!result) toast(NO_CONTENT_MSG, "warning"); };

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

  // Live, fully-styled preview of the generated resume — same HTML the PDF uses,
  // so it reflects the chosen style, colors and fonts in real time.
  const previewHtml = result
    ? buildResumeHtml(
        result,
        { ...styleObj, accent: effectiveAccent, head: accent, nameColor, font, fontSize },
        accountTitle(),
        acctInfo,
        eduRows
      )
    : "";

  const callApi = async (jdValue) =>
    api().generateResume({
      accountId: Number(accountId),
      jobDescription: jdValue,
      style,
      instructionId: promptId ? Number(promptId) : undefined,
    });

  // Build + save the PDF (and optional cover letter) from generated content.
  // opts.skipCover: re-render the resume only (used by the live color regen so
  // it never makes a fresh AI cover-letter call on every colour pick).
  const exportPdf = async (content, role, company, country, jdValue, opts = {}) => {
    const useJd = typeof jdValue === "string" ? jdValue : jd;
    if (!accountId) { if (!opts.skipCover) setError("Select an account first."); return; }
    if (!content) {
      if (!opts.skipCover) setError("Click Preview first to generate the content, then Generate to download the PDF.");
      return;
    }
    busyRef.current = true;
    setLoading(true);
    setError("");
    if (!opts.skipCover) setSavedPath("");
    try {
      const acc = await api().getAccount(Number(accountId));
      const edu = await api().listEducation(Number(accountId));

      let coverHtml = null;
      if (coverLetter && !opts.skipCover && !isV2) {
        try {
          const cl = await api().generateCoverLetter({
            accountId: Number(accountId),
            jobDescription: useJd,
            instructionId: promptId ? Number(promptId) : undefined,
            role,
            company,
          });
          if (cl && cl.text) {
            coverHtml = buildCoverLetterHtml(cl.text, { ...styleObj, accent: effectiveAccent, head: accent, nameColor, font, fontSize }, acc);
          }
        } catch (e) {
          setError(`Cover letter skipped — ${friendlyError(e)}`);
        }
      }

      const exp = await api().exportResumePdf({
        html: buildResumeHtml(content, { ...styleObj, accent: effectiveAccent, head: accent, nameColor, font, fontSize }, accountTitle(), acc, edu),
        coverHtml,
        accountId: Number(accountId),
        role,
        company,
        country,
        // Colour/style/font re-render: overwrite the existing file in place
        // rather than creating a new folder.
        overwritePath: opts.skipCover && savedPath ? savedPath : undefined,
      });
      if (exp && exp.ok) {
        setSavedPath(exp.path);
        setSavedAt(exp.savedAt || "");
        api().setPref("gen_saved_path", exp.path);
        api().setPref("gen_saved_at", exp.savedAt || "");
        setView("preview"); // jump to the Preview Resume tab once generated
        if (!opts.skipCover) copyFolderToClipboard(exp.path);
      } else if (!opts.skipCover) setError(`Couldn't save the PDF — ${friendlyError({ message: (exp && exp.error) || "unknown error" })}`);
    } catch (e) {
      if (!opts.skipCover) setError(friendlyError(e));
    } finally {
      setLoading(false);
      busyRef.current = false;
    }
  };

  const generate = () => exportPdf(result, jobRole, jobCompany, jobCountry, jd);

  // Preview: call the AI once, cache the content, optionally pop the modal,
  // and optionally chain straight into Generate.
  const preview = async (jdValue) => {
    const useJd = typeof jdValue === "string" ? jdValue : jd;
    // The job description is mandatory — this app only produces resumes tailored
    // to a specific job posting.
    if (!useJd || !useJd.trim()) {
      toast("Job description is required. Paste the target job description to generate a tailored resume.", "danger");
      return;
    }
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
      const res = await callApi(useJd);
      setResult(res.text || "");
      setJobRole(res.jobRole || "");
      setJobCompany(res.jobCompany || "");
      setJobCountry(res.jobCountry || "");
      if (openModalAfterPreview) setShowPreview(true);
      // "Generate Resume" now does the full flow: fetch the content, then
      // immediately build + save the PDF and show it in the Preview tab.
      if (res.text) {
        setView("preview");
        await exportPdf(res.text || "", res.jobRole || "", res.jobCompany || "", res.jobCountry || "", useJd);
      }
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  };

  // Generate V2: build the same prompt, hand it to the user's signed-in ChatGPT
  // in the embedded browser, and wait for the reply to arrive on the clipboard
  // (recognised by the unique handshake id). Then render exactly like V1.
  const previewV2 = async (jdValue) => {
    const useJd = typeof jdValue === "string" ? jdValue : jd;
    if (!useJd || !useJd.trim()) {
      toast("Job description is required. Paste the target job description to generate a tailored resume.", "danger");
      return;
    }
    if (!accountId) { setError("Select an account first."); return; }
    setLoading(true);
    setError("");
    setSavedPath("");
    try {
      const { id, prompt, copied, jobRef } = await api().chatgptBuildPrompt({
        accountId: Number(accountId),
        jobDescription: useJd,
        style,
        instructionId: promptId ? Number(promptId) : undefined,
      });
      // The JSON prompt is copied natively in the main process (more reliable
      // than navigator.clipboard here); fall back to the renderer copy if that
      // fails.
      let onClipboard = !!copied;
      if (!onClipboard) {
        try { await navigator.clipboard.writeText(prompt); onClipboard = true; } catch (_) {}
      }
      await api().openChatgpt();
      setV2Waiting(true);
      toast(
        onClipboard
          ? "Prompt copied. In ChatGPT: paste (Ctrl+V), send, then copy the whole reply."
          : "Couldn't copy the prompt automatically — copy it manually from the preview, then paste into ChatGPT.",
        onClipboard ? "info" : "warning"
      );
      // Wait for the verified reply on the clipboard before building anything —
      // the resume is never generated until the matching content is copied back.
      const res = await api().awaitChatgptClipboard(id, prompt, jobRef);
      setV2Waiting(false);
      if (!res || !res.ok) {
        if (res && res.canceled) return;
        if (res && res.closed) {
          setError("Stopped — the ChatGPT window was closed before a reply arrived. Click Generate Resume to try again.");
          return;
        }
        setError(
          res && res.timeout
            ? "Timed out waiting for the ChatGPT reply. Click Generate Resume to try again."
            : res && res.mismatch
            ? (res.detail === "job"
                ? "That reply was generated for a different job description. Re-send this prompt in ChatGPT and copy the new reply."
                : "That reply doesn't match this request. Re-send this prompt in ChatGPT and copy the new reply.")
            : "Could not read the ChatGPT reply from the clipboard. Make sure you copied the whole answer."
        );
        return;
      }
      setResult(res.text || "");
      setJobRole(res.jobRole || "");
      setJobCompany(res.jobCompany || "");
      setJobCountry(res.jobCountry || "");
      if (openModalAfterPreview) setShowPreview(true);
      if (res.text) {
        setView("preview");
        await exportPdf(res.text || "", res.jobRole || "", res.jobCompany || "", res.jobCountry || "", useJd);
        toast("Resume generated from your ChatGPT reply.", "success");
      }
    } catch (e) {
      setV2Waiting(false);
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  };

  // Route the Generate action to the Gemini API (V1) or ChatGPT browser (V2).
  const runGenerate = (jdValue) => (isV2 ? previewV2(jdValue) : preview(jdValue));

  const cancelV2 = async () => {
    await api().cancelChatgptClipboard();
    setV2Waiting(false);
    setLoading(false);
  };

  const openFolder = async () => {
    if (!savedPath) { toast("Generate a resume first — then Open Folder will reveal the saved PDF.", "warning"); return; }
    const res = await api().revealPdf(savedPath);
    if (res && !res.ok) toast(res.error || "Could not open the folder.", "danger");
  };
  const openFile = async () => {
    if (!savedPath) { toast("Generate a resume first — then Open File will open the saved PDF.", "warning"); return; }
    const res = await api().openPdf(savedPath);
    if (res && !res.ok) toast(res.error || "Could not open the file.", "danger");
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
  const copyLocation = () => {
    copyFolderToClipboard(savedPath);
    setView("generate");
    toast("Folder path copied to clipboard.", "success");
  };

  const copy = () => navigator.clipboard.writeText(result);

  return (
    <div>
    <div className="resume-layout">
      <section className="card resume-styles">
        <div className="styles-head">
          <h2>Resume Styles</h2>
          <button
            type="button"
            className="section-collapse"
            onClick={() => setPickersOpen((o) => !o)}
            title={pickersOpen ? "Hide colors & font" : "Show colors & font"}
          >
            Colors &amp; Font {pickersOpen ? "▾" : "▸"}
          </button>
        </div>

        {pickersOpen && (
        <div className="styles-pickers">
        <div className="color-section">
          <span className="field-label">Name Color Picker</span>
          <div className="swatch-row">
            <button
              type="button"
              className={"swatch swatch-default" + (!nameColor ? " active" : "")}
              onClick={() => chooseNameColor("")}
              title="Each template's own default name & title color"
            >
              Default
            </button>
            {PRESET_COLORS.map((c) => {
              const on = nameColor.toLowerCase() === c.value;
              const taken = !!accent && accent.toLowerCase() === c.value; // used by Content
              return (
                <button
                  key={c.value}
                  type="button"
                  className={"swatch" + (on ? " active" : "")}
                  style={{ background: c.value }}
                  onClick={() => chooseNameColor(c.value)}
                  disabled={taken && !on}
                  title={taken ? `${c.name} — already used by the Content picker` : c.name}
                  aria-label={c.name}
                >
                  {on ? "✓" : ""}
                </button>
              );
            })}
            <button
              type="button"
              className={"swatch swatch-white" + (nameColor.toLowerCase() === "#ffffff" ? " active" : "")}
              style={{ background: "#ffffff" }}
              onClick={() => chooseNameColor("#ffffff")}
              disabled={accent.toLowerCase() === "#ffffff" && nameColor.toLowerCase() !== "#ffffff"}
              title={accent.toLowerCase() === "#ffffff" ? "White — already used by the Content picker" : "White"}
              aria-label="White"
            >
              {nameColor.toLowerCase() === "#ffffff" ? "✓" : ""}
            </button>
            <label className="swatch swatch-custom" title="Custom color">
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(nameColor) ? nameColor : "#3366ff"}
                onChange={(e) => chooseNameColor(e.target.value)}
              />
            </label>
          </div>
        </div>

        <div className="color-section">
          <span className="field-label">Content Color Picker</span>
          <div className="swatch-row">
            <button
              type="button"
              className={"swatch swatch-default" + (!accent ? " active" : "")}
              onClick={() => chooseAccent("")}
              title="Each template's own default content color"
            >
              Default
            </button>
            {PRESET_COLORS.map((c) => {
              const on = accent.toLowerCase() === c.value;
              const taken = !!nameColor && nameColor.toLowerCase() === c.value; // used by Name
              return (
                <button
                  key={c.value}
                  type="button"
                  className={"swatch" + (on ? " active" : "")}
                  style={{ background: c.value }}
                  onClick={() => chooseAccent(c.value)}
                  disabled={taken && !on}
                  title={taken ? `${c.name} — already used by the Name picker` : c.name}
                  aria-label={c.name}
                >
                  {on ? "✓" : ""}
                </button>
              );
            })}
            <button
              type="button"
              className={"swatch swatch-white" + (accent.toLowerCase() === "#ffffff" ? " active" : "")}
              style={{ background: "#ffffff" }}
              onClick={() => chooseAccent("#ffffff")}
              disabled={nameColor.toLowerCase() === "#ffffff" && accent.toLowerCase() !== "#ffffff"}
              title={nameColor.toLowerCase() === "#ffffff" ? "White — already used by the Name picker" : "White"}
              aria-label="White"
            >
              {accent.toLowerCase() === "#ffffff" ? "✓" : ""}
            </button>
            <label className="swatch swatch-custom" title="Custom color">
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(accent) ? accent : "#3366ff"}
                onChange={(e) => chooseAccent(e.target.value)}
              />
            </label>
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
        </div>
        )}

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
              <img alt={s.label} src={styleThumb({ ...s, ...(accent ? { accent, head: accent } : {}), ...(nameColor ? { nameColor } : {}) })} />
              {style === s.id && <span className="style-check" aria-label="active">✓</span>}
            </button>
          ))}
        </div>
      </section>

      <section className="card resume-form">
        <div className="resume-tabs">
          <button
            type="button"
            className={"resume-tab" + (view === "generate" ? " active" : "")}
            onClick={() => setView("generate")}
          >
            Generate Resume
          </button>
          <button
            type="button"
            className={"resume-tab" + (view === "preview" ? " active" : "")}
            onClick={() => setView("preview")}
          >
            Preview Resume
          </button>
          <span className="resume-tabs-spacer" />
          <span className="field-label" style={{ margin: 0 }}>
            Proxy{" "}
            {proxyActive ? (
              <span className="badge live badge-gap">active</span>
            ) : (
              <span className="badge off badge-gap">off</span>
            )}
          </span>
        </div>

        {view === "generate" ? (
        <>
        <p className="muted">
          {isV2 ? (
            <>
              Builds the tailored prompt, then hands it to your signed-in ChatGPT
              in an embedded browser. Paste it (Ctrl+V), send, and copy the reply —
              the app picks it up automatically. You can then type any extra
              application questions straight into ChatGPT; it answers each
              positively, aligned with the resume, in a copyable code block. A job
              description is required. If an active Gemini key is set in Settings →
              API (V2), it refines the prompt first; otherwise the built-in prompt
              is used.
            </>
          ) : (
            <>
              Generates a resume tailored to the job description below using the
              selected account, prompt and API key. A job description is required.
              {!proxyActive && " Activate a proxy in Proxy Settings to generate."}
            </>
          )}
        </p>

        <div className="grid2">
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

          <div className="field">
            <span className="field-label">{isV2 ? "Prompt Refiner Key (Gemini, optional)" : "Active AI API Key"}</span>
            <FlagSelect
              value={keyId}
              onChange={onKey}
              placeholder={
                keys.length
                  ? "Select key"
                  : isV2
                  ? "No V2 keys — add in Settings → API (V2)"
                  : "No keys — add one first"
              }
              options={keys.map((k) => ({
                value: k.id,
                name: `${k.name || "(unnamed key)"} - ${providerLabel(k.provider)} ( ${modelTiny(k.provider, k.model)} )`,
              }))}
            />
          </div>
        </div>

        <div className="field">
          <span className="field-label">Active Prompt</span>
          <FlagSelect
            value={promptId}
            onChange={onPrompt}
            placeholder={prompts.length ? "Select a prompt" : "No prompts — add in Instructions"}
            options={prompts.map((p) => ({ value: p.id, name: p.name || "(untitled)" }))}
          />
        </div>
        <div className="prompt-preview">
          {selectedPrompt
            ? selectedPrompt.body || "(this prompt is empty)"
            : "Select a prompt to see its content."}
        </div>

        <label className="field jd-field">
          <span className="field-label">Job Description <span className="req">(required)</span></span>
          <textarea
            className="textarea"
            rows={14}
            placeholder="Paste the target job description here (required)…"
            value={jd}
            onChange={(e) => {
              const v = e.target.value;
              setJd(v);
              api().setPref("gen_jd", v);
              clearCache();
              // "Auto-preview on paste" is the sole gate for paste-triggered
              // work. Run it with the EXACT pasted text (not state) so the very
              // first request never uses a stale/previous JD.
              if (pastedRef.current && autoOnPaste && v.trim() && accountId && !loading) {
                runGenerate(v);
              }
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
            <label className="toggle" title="Open the content preview modal after Preview finishes">
              <input
                type="checkbox"
                checked={openModalAfterPreview}
                onChange={(e) => { setOpenModalAfterPreview(e.target.checked); api().setPref("open_preview_after", e.target.checked ? "1" : "0"); }}
              />
              <span className="toggle-track"><span className="toggle-thumb" /></span>
              <span className="toggle-label">Open preview modal</span>
            </label>
            {!isV2 && (
            <label className="toggle" title="Also generate a matching cover letter (Cover Letter.pdf) in the same folder">
              <input
                type="checkbox"
                checked={coverLetter}
                onChange={(e) => { setCoverLetter(e.target.checked); api().setPref("cover_letter", e.target.checked ? "1" : "0"); }}
              />
              <span className="toggle-track"><span className="toggle-thumb" /></span>
              <span className="toggle-label">Cover letter</span>
            </label>
            )}
            </>)}
          </div>
          <div className="action-group">
            <button className="btn primary" onClick={() => runGenerate()} disabled={loading}>
              {loading ? (isV2 ? "Waiting for ChatGPT…" : "Generating…") : "Generate Resume"}
            </button>
          </div>
        </div>
        {isV2 && v2Waiting && (
          <div className="v2-wait">
            <span className="spinner small" />
            <div className="v2-wait-text">
              <strong>Waiting for your ChatGPT reply…</strong>
              <span className="muted small">
                In the ChatGPT window: paste the prompt (Ctrl+V), send it, then
                select &amp; copy the entire reply. This page detects it automatically.
              </span>
            </div>
            <button className="btn small" onClick={cancelV2}>Cancel</button>
            <button className="btn small" onClick={() => api().openChatgpt()}>Open ChatGPT</button>
          </div>
        )}
        {error && <div className="error">{error}</div>}
        </>
        ) : (
        <>
        <div className="action-row preview-actions">
          <div className="action-group">
            <button className="btn primary" onClick={() => runGenerate()} disabled={loading}>
              {loading ? (isV2 ? "Waiting for ChatGPT…" : "Generating…") : "Generate Resume"}
            </button>
            <button className="btn" onClick={openFolder} disabled={loading || !savedPath}>
              Open Folder
            </button>
            <button className="btn" onClick={openFile} disabled={loading || !savedPath}>
              Open File
            </button>
            {savedPath && (
              <button className="btn" onClick={copyLocation} title="Copy the folder path to the clipboard">
                {copied ? "Copied ✓" : "Copy Location"}
              </button>
            )}
          </div>
        </div>
        {savedPath && (
          <div className="muted small saved-inline">
            Saved to {savedPath}{savedAt ? ` · ${savedAt}` : ""}
          </div>
        )}
        {error && <div className="error">{error}</div>}

        <div className="resume-viewer-wrap">
          {pdfUrl ? (
            <iframe className="resume-viewer" title="Resume PDF" src={pdfUrl + "#toolbar=1&navpanes=0&view=FitH"} />
          ) : result ? (
            <iframe className="resume-viewer" title="Resume preview" srcDoc={previewHtml} />
          ) : (
            <div className="resume-viewer-empty muted">
              Generate a resume to see it here as real, paginated PDF pages.
            </div>
          )}
        </div>
        </>
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

    </div>
  );
}
