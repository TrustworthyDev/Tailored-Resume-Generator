import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { buildResumeHtml, buildCoverLetterHtml } from "../lib/resumeHtml";
import { styleThumb } from "../lib/styleThumbs";
import { modelTiny, providerLabel } from "../lib/aiModels";
import { friendlyError } from "../lib/errors";
import { ageFromBirthDate } from "../lib/age";
import FlagSelect from "./FlagSelect";
import ConfirmModal from "./ConfirmModal";

const STYLES = [
  { id: "modern", label: "Modern", accent: "#0d9488" },
  { id: "minimal", label: "Minimal", accent: "#6b7280" },
  { id: "creative", label: "Creative", accent: "#7c3aed" },
  { id: "technical", label: "Technical", accent: "#2563eb" },
  { id: "academic", label: "Academic", accent: "#334155" },
  { id: "compact", label: "Compact", accent: "#475569" },
  { id: "cards", label: "Cards", accent: "#0d9488" },
  { id: "timeline", label: "Timeline", accent: "#2563eb" },
  { id: "classic", label: "Classic", accent: "#1f2937" },
  { id: "centered", label: "Centered", accent: "#14b8a6" },
  { id: "highlight", label: "Highlight", accent: "#c2410c" },
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

// `active` = this generator's tab is the one on screen. V2 stays mounted for the
// whole session (its ChatGPT WebView pre-warms in the background), so it uses
// this to refresh lists that would otherwise go stale — see the effect below.
export default function ResumeGenerator({ variant = "v1", active = true }) {
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
  const [extraInfo, setExtraInfo] = useState(""); // per-generation notes fed into the prompt
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
  const [chatHome, setChatHome] = useState(""); // V2: saved ChatGPT Project Home URL (used for auto-navigation)
  const [connMode, setConnMode] = useState("direct"); // V2 browser: "direct" (local IP) | "proxy"
  const [proxyList, setProxyList] = useState([]); // V2: proxies to choose from
  const [chatProxyId, setChatProxyId] = useState(""); // V2: chosen proxy id
  const [showPromptModal, setShowPromptModal] = useState(false); // view active prompt content
  const [showInfo, setShowInfo] = useState(false); // "View info" modal (account + target job)
  const [dupConfirm, setDupConfirm] = useState(null); // { role, company } when confirming a duplicate
  const dupResolveRef = useRef(null); // resolves the duplicate-confirm promise
  const [chatUa, setChatUa] = useState(""); // V2: user-agent for the embedded ChatGPT webview
  const webviewRef = useRef(null); // V2: the embedded ChatGPT <webview>
  const chatRetriedRef = useRef(false); // V2: guard the one-time proxy→direct retry
  const lastChatUrlRef = useRef(""); // V2: last URL loaded into the webview
  const lastPromptRef = useRef(""); // V2: last prompt, for auto-send / manual re-send
  const lastReqIdRef = useRef(""); // V2: last request_id, for auto-copying the reply
  const autoSentIdRef = useRef(""); // V2: request_id already auto-sent (single-fire guard)
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
      const [accs, ks, instrs, accPref, stylePref, px, autoPref, accentPref, nameColorPref, openModalPref, autoGenPref, jdPref, savedPathPref, savedAtPref, coverPref, styleOrderPref, fontPref, fontSizePref, extraPref] = await Promise.all([
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
        api().getPref("gen_extra_info"),
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
      if (extraPref && extraPref.value) setExtraInfo(extraPref.value);
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

  // The lists above load once on mount, but V2 never unmounts (it stays alive so
  // its ChatGPT WebView keeps pre-warming). Without this, a prompt/account/key
  // added on another tab wouldn't show up here until an app restart. Re-fetch
  // whenever this tab is opened, keeping the current selection when it's still
  // valid and repairing it when it isn't (e.g. the item was deleted).
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    (async () => {
      const [accs, ks, instrs] = await Promise.all([
        api().listAccounts(),
        api().listApiKeys(isV2 ? "v2" : "v1"),
        api().listInstructions(),
      ]);
      if (cancelled) return;
      const keep = (list, cur, pickActive) => {
        if ((list || []).some((x) => String(x.id) === String(cur))) return cur;
        const act = pickActive ? (list || []).find((x) => x.is_active) : null;
        if (act) return String(act.id);
        return list && list.length ? String(list[0].id) : "";
      };
      setAccounts(accs || []);
      setAccountId((cur) => keep(accs, cur, false));
      setKeys(ks || []);
      setKeyId((cur) => keep(ks, cur, true));
      setPrompts(instrs || []);
      setPromptId((cur) => keep(instrs, cur, true));
    })();
    return () => { cancelled = true; };
  }, [active, isV2]);

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

  // V2: prepare the embedded ChatGPT webview session (UA + proxy) so the tab
  // renders with the right user-agent from the start.
  useEffect(() => {
    if (!isV2) return;
    api().chatgptSessionInfo().then((r) => setChatUa((r && r.ua) || ""));
  }, [isV2]);

  // V2: load the saved ChatGPT Project Home URL + the browser connection choice.
  useEffect(() => {
    if (!isV2) return;
    api().getChatgptHome().then((r) => { setChatHome((r && r.url) || ""); });
    (async () => {
      const [modePref, pidPref, list] = await Promise.all([
        api().getPref("chat_conn_mode"),
        api().getPref("chat_proxy_id"),
        api().listProxies(),
      ]);
      setProxyList(list || []);
      if (modePref && modePref.value) setConnMode(modePref.value);
      if (pidPref && pidPref.value) setChatProxyId(String(pidPref.value));
    })();
    // Update the displayed home when saved from inside the embedded browser.
    const off = api().onChatgptHomeChanged
      ? api().onChatgptHomeChanged((url) => { setChatHome(url || ""); })
      : null;
    return () => { if (typeof off === "function") off(); };
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

  // Name and Content may share a colour on every style EXCEPT "cards", whose
  // coloured header would hide a same-coloured name — there the clash is blocked.
  const colorLock = style === "cards";
  const chooseAccent = (v) => {
    if (colorLock && v && nameColor && v.toLowerCase() === nameColor.toLowerCase()) {
      toast("On the Cards style the name sits on a coloured header — pick a different Content colour.", "warning");
      return;
    }
    setAccent(v); api().setPref("resume_accent", v); if (!result) toast(NO_CONTENT_MSG, "warning");
  };
  const chooseNameColor = (v) => {
    if (colorLock && v && accent && v.toLowerCase() === accent.toLowerCase()) {
      toast("On the Cards style the name sits on a coloured header — pick a different Name colour.", "warning");
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
      extraInfo,
    });

  // Ask the user to confirm generating another resume for a company + title they
  // already have an application for. Resolves true (proceed) / false (cancel).
  const confirmDuplicate = (role, company) =>
    new Promise((resolve) => {
      dupResolveRef.current = resolve;
      setDupConfirm({ role, company });
    });

  // Build + save the PDF (and optional cover letter) from generated content.
  // opts.skipCover: re-render the resume only (used by the live color regen so
  // it never makes a fresh AI cover-letter call on every colour pick).
  // Returns true when saved, false when cancelled/blocked.
  const exportPdf = async (content, role, company, country, jdValue, opts = {}) => {
    const useJd = typeof jdValue === "string" ? jdValue : jd;
    if (!accountId) { if (!opts.skipCover) setError("Select an account first."); return false; }
    if (!content) {
      if (!opts.skipCover) setError("Click Preview first to generate the content, then Generate to download the PDF.");
      return false;
    }
    // On a real generation (not a colour/font re-render): if the same company +
    // job title already exists in the history, confirm before saving another.
    if (!opts.skipCover && !opts.skipDupCheck) {
      // Match on the index fields (Gemini JD extraction when available, else the
      // display role/company) so this agrees with what gets stored.
      const recRole = ((opts.matchRole || role) || "").trim();
      const recCompany = ((opts.matchCompany || company) || "").trim();
      if (recRole && recCompany) {
        const dup = await api().findDuplicateApplication(Number(accountId), recRole, recCompany);
        if (dup && dup.exists) {
          const proceed = await confirmDuplicate(recRole, recCompany);
          if (!proceed) { toast("Kept your existing resume — nothing new saved.", "info"); return false; }
        }
      }
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
        // Dedicated duplicate-detection index: the Gemini JD extraction (V2) so
        // matching is stable regardless of what the reply/display shows. Falls
        // back to role/company when no target was extracted (e.g. V1).
        matchRole: opts.matchRole || role,
        matchCompany: opts.matchCompany || company,
        // V2 handshake id, recorded on the application history entry (empty for V1).
        requestId: opts.requestId || "",
        // Stored on the application: JD + resume for reference, and the ChatGPT
        // conversation URL so "Open GPT" can reopen that exact thread.
        jobDescription: useJd,
        resumeContent: content,
        gptUrl: opts.gptUrl || "",
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
        if (!opts.skipCover) {
          copyFolderToClipboard(exp.path);
          // Windows notification (account + company + role + success). Not on colour re-renders.
          try { api().notifyResumeDone({ account: (acc && acc.name) || "", role: role || jobRole, company: company || jobCompany }); } catch (_) {}
        }
        return true;
      } else if (!opts.skipCover) setError(`Couldn't save the PDF — ${friendlyError({ message: (exp && exp.error) || "unknown error" })}`);
      return false;
    } catch (e) {
      if (!opts.skipCover) setError(friendlyError(e));
      return false;
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
      // Open the ChatGPT tab IMMEDIATELY, in parallel with the Gemini prompt
      // build. reuse:true starts a fresh chat inside the already-loaded tab
      // (no full SPA reload) when possible, falling back to a full load.
      const openPromise = openChatTab({ reuse: true });
      const { id, prompt, copied, jobRef, target } = await api().chatgptBuildPrompt({
        accountId: Number(accountId),
        jobDescription: useJd,
        style,
        instructionId: promptId ? Number(promptId) : undefined,
        extraInfo,
      });
      const opened = await openPromise; // { reused } — reused tab vs cold first load
      // Duplicate guard BEFORE the (slow) ChatGPT round-trip. Gemini already
      // extracted the target role/company from the JD while building the prompt,
      // so we can catch an existing application (same Account + Company + Title)
      // now and skip the whole generation if the user doesn't want a re-do.
      if (target && target.company && target.role) {
        let dup = null;
        try { dup = await api().findDuplicateApplication(Number(accountId), target.role, target.company); } catch (_) {}
        if (dup && dup.exists) {
          const proceed = await confirmDuplicate(target.role, target.company);
          if (!proceed) { setLoading(false); return; }
        }
      }
      // The JSON prompt is copied natively in the main process (more reliable
      // than navigator.clipboard here); fall back to the renderer copy if that
      // fails.
      let onClipboard = !!copied;
      if (!onClipboard) {
        try { await navigator.clipboard.writeText(prompt); onClipboard = true; } catch (_) {}
      }
      // The tab was already opened + loading in parallel above. Auto-send the
      // prompt (inject → wait for Send to enable → click); the clipboard copy
      // remains a fallback if the auto-send can't find ChatGPT's composer.
      lastPromptRef.current = prompt;
      lastReqIdRef.current = id;
      // Name the chat "Company - Job Title" from the Gemini target (already
      // known now) so it's set the moment the conversation is created — the
      // original name, not a later rename over ChatGPT's auto-title.
      const chatLabel = [ (target && target.company) || "", (target && target.role) || "" ].filter(Boolean).join(" - ");
      autoSendOnLoad(prompt, id, !!(opened && opened.reused), chatLabel);
      setV2Waiting(true);
      toast(
        onClipboard
          ? "Sending your prompt to ChatGPT automatically… then copy the whole reply."
          : "Couldn't copy the prompt automatically — copy it manually from the preview, then paste into ChatGPT.",
        onClipboard ? "info" : "warning"
      );
      // Wait for the verified reply on the clipboard before building anything —
      // the resume is never generated until the matching content is copied back.
      const res = await api().awaitChatgptClipboard(id, prompt, jobRef);
      setV2Waiting(false);
      if (!res || !res.ok) {
        if (res && res.canceled) return;
        setView("generate"); // show the error on the generate tab
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
      // Display uses the values ChatGPT reported in its reply. Duplicate
      // matching uses the Gemini JD extraction (target) via dedicated index
      // columns, kept separate so display and matching never interfere.
      const hasTarget = !!(target && target.company && target.role);
      setResult(res.text || "");
      setJobRole(res.jobRole || "");
      setJobCompany(res.jobCompany || "");
      setJobCountry(res.jobCountry || (target && target.country) || "");
      if (openModalAfterPreview) setShowPreview(true);
      if (res.text) {
        // Capture the ChatGPT conversation URL from the webview for "Open GPT".
        let gptUrl = "";
        try { gptUrl = webviewRef.current ? webviewRef.current.getURL() : ""; } catch (_) {}
        if (!/^https?:\/\//i.test(gptUrl)) gptUrl = res.gptUrl || "";
        setView("preview");
        // Fallback naming: when there was no Gemini target, we couldn't name the
        // chat at send time, so name it now from the reply's company/role.
        if (!hasTarget) {
          const fb = [res.jobCompany || "", res.jobRole || ""].filter(Boolean).join(" - ");
          if (fb) { try { renameChat(fb); } catch (_) {} }
        }
        // Skip the late duplicate prompt only when the early check actually ran
        // (target present). Without a Gemini target, let exportPdf run its own
        // check so V2 still catches duplicates. Pass the Gemini target as the
        // dedicated match index so storage + matching stay consistent.
        const saved = await exportPdf(res.text || "", res.jobRole || "", res.jobCompany || "", res.jobCountry || "", useJd, {
          requestId: id,
          gptUrl,
          skipDupCheck: hasTarget,
          matchRole: hasTarget ? target.role : "",
          matchCompany: hasTarget ? target.company : "",
        });
        if (saved) toast("Resume generated from your ChatGPT reply.", "success");
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

  // Load a URL into the embedded ChatGPT webview (remembering it for reloads).
  const loadWebview = (url) => {
    const wv = webviewRef.current;
    if (!wv || !url) return;
    lastChatUrlRef.current = url;
    try { wv.loadURL(url); } catch (_) { try { wv.src = url; } catch (__) {} }
  };

  // Start a fresh chat INSIDE the already-loaded ChatGPT tab using its own
  // in-app navigation — no full page reload, no SPA re-download, no re-auth.
  // Prefers navigating back to the saved Project Home link (keeps that project's
  // context); otherwise clicks ChatGPT's "New chat" button. Returns true on
  // success so the caller can fall back to a full load if the DOM has changed.
  const startFreshChat = async (homeUrl) => {
    const wv = webviewRef.current;
    if (!wv) return false;
    let homePath = "/";
    try { if (homeUrl) homePath = new URL(homeUrl).pathname || "/"; } catch (_) {}
    const js =
      "(async () => {" +
      "  const sleep = ms => new Promise(r=>setTimeout(r,ms));" +
      "  const homePath = " + JSON.stringify(homePath) + ";" +
      "  const clickIt = (el) => { if(!el) return false; try{ el.scrollIntoView&&el.scrollIntoView(); }catch(e){} try{ el.click(); }catch(e){ return false; } return true; };" +
      // A Project Home is saved: the new chat MUST be created INSIDE that
      // project (its scoped composer), never a generic new chat that leaves the
      // project. So get back onto the project home PAGE itself.
      "  if (homePath && homePath !== '/') {" +
      "    const cur = location.pathname || '';" +
      // Already on the project home page → its composer is ready, reuse it.
      "    if (cur === homePath) return true;" +
      // Otherwise click the project's sidebar link (client-side) to return to it.
      "    const pm = homePath.match(/\\/g\\/([^/]+)/); const projId = pm ? pm[1] : '';" +
      "    let link = document.querySelector('a[href=\"'+homePath+'\"]');" +
      "    if (!link && projId) link = Array.from(document.querySelectorAll('a')).find(a => (a.getAttribute('href')||'').indexOf(projId) !== -1);" +
      "    if (clickIt(link)) {" +
      // Wait until the URL actually lands on the project home page.
      "      for (let i=0;i<20;i++){ if((location.pathname||'')===homePath) return true; await sleep(150); }" +
      "      if ((location.pathname||'').indexOf(projId) !== -1) return true;" +
      "    }" +
      // Couldn't confirm we're in the project → let the caller do a full load
      // of the Project Home URL (correct, just slower). NEVER a generic chat.
      "    return false;" +
      "  }" +
      // No Project Home set: a plain new chat is correct.
      "  let nb = document.querySelector('[data-testid=\"create-new-chat-button\"]');" +
      "  if (!nb) nb = Array.from(document.querySelectorAll('a,button')).find(x => { const t=((x.getAttribute('data-testid')||'')+' '+(x.getAttribute('aria-label')||'')+' '+(x.getAttribute('href')||'')).toLowerCase(); return /new.?chat|create-new-chat/.test(t); });" +
      "  if (clickIt(nb)) { await sleep(250); return true; }" +
      "  return false;" +
      "})();";
    try { return await wv.executeJavaScript(js, true); } catch (_) { return false; }
  };

  // Switch to the embedded ChatGPT tab. opts.reuse: when the tab is already
  // loaded on ChatGPT, start a fresh chat in-place (fast) instead of a full
  // reload. opts.url: load an explicit URL (full load). Default = full reload.
  const openChatTab = async (opts = {}) => {
    const { reuse = false, url = "" } = typeof opts === "string" ? { url: opts } : opts;
    setView("chatgpt");
    // Fast path: reuse the already-loaded tab and start a fresh chat client-side.
    if (reuse && !url) {
      const wv = webviewRef.current;
      try {
        let cur = "";
        try { cur = wv && !wv.isLoading() ? (wv.getURL() || "") : ""; } catch (_) {}
        if (/^https?:\/\/(chatgpt\.com|chat\.openai\.com)/i.test(cur)) {
          const ok = await startFreshChat(chatHome || "");
          if (ok) return { reused: true };
        }
      } catch (_) {}
    }
    // Cold path: full load of the Project Home (or an explicit url).
    chatRetriedRef.current = false;
    const info = await api().chatgptSessionInfo(); // applies proxy, returns home
    const target = /^https?:\/\//i.test(url || "") ? url : (info && info.homeUrl) || "https://chatgpt.com/";
    loadWebview(target);
    return { reused: false };
  };

  // Inject the prompt into ChatGPT's composer, wait for the Send button to enable,
  // then click it — so the user doesn't have to paste + send by hand. Returns a
  // short status string; falls back silently (the prompt is still on the clipboard
  // and in the box) if ChatGPT's DOM has changed.
  const autoSend = async (promptText) => {
    const wv = webviewRef.current;
    if (!wv || !promptText) return "no-webview";
    const js =
      "(async () => {" +
      "  const text = " + JSON.stringify(String(promptText)) + ";" +
      "  const sleep = (ms) => new Promise(r => setTimeout(r, ms));" +
      "  const findEditor = () => document.querySelector('#prompt-textarea')" +
      "    || document.querySelector('div.ProseMirror[contenteditable=\"true\"]')" +
      "    || document.querySelector('main [contenteditable=\"true\"]')" +
      "    || document.querySelector('form textarea');" +
      "  const hasText = (el) => el && ((el.tagName==='TEXTAREA' ? el.value : el.textContent) || '').trim().length > 0;" +
      "  const findSend = () => {" +
      "    const direct = document.querySelector('button[data-testid=\"send-button\"],#composer-submit-button,button[data-testid=\"composer-send-button\"],button[aria-label=\"Send prompt\"]');" +
      "    if (direct && !direct.disabled && direct.getAttribute('aria-disabled')!=='true') return direct;" +
      "    const btns = Array.from(document.querySelectorAll('button'));" +
      "    return btns.find(b => { const t=((b.getAttribute('data-testid')||'')+' '+(b.getAttribute('aria-label')||'')+' '+(b.id||'')).toLowerCase(); return /send/.test(t) && !b.disabled && b.getAttribute('aria-disabled')!=='true'; }) || null;" +
      "  };" +
      // Fire the click EXACTLY ONCE. The pointer/mouse down+up prime ChatGPT's
      // button state; then a single native click() sends. (Dispatching a synthetic
      // 'click' AND calling el.click() would double-send.)
      "  const realClick = (el) => { const o={bubbles:true,cancelable:true,view:window};" +
      "    try{ el.dispatchEvent(new PointerEvent('pointerdown',o)); }catch(e){}" +
      "    el.dispatchEvent(new MouseEvent('mousedown',o));" +
      "    try{ el.dispatchEvent(new PointerEvent('pointerup',o)); }catch(e){}" +
      "    el.dispatchEvent(new MouseEvent('mouseup',o));" +
      "    try{ el.click(); }catch(e){ el.dispatchEvent(new MouseEvent('click',o)); } };" +
      "  const pressEnter = (el) => { el.focus(); ['keydown','keypress','keyup'].forEach(type => el.dispatchEvent(new KeyboardEvent(type,{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}))); };" +
      "  let editor = null;" +
      "  for (let i=0;i<60;i++){ editor = findEditor(); if (editor) break; await sleep(200); }" +
      "  if (!editor) return 'no-editor';" +
      "  editor.focus();" +
      "  const editorText = () => (editor.tagName==='TEXTAREA' ? editor.value : editor.textContent) || '';" +
      // Wipe whatever is already in the box. ChatGPT's ProseMirror editor won't
      // reliably replace a selection on insert, so any leftover characters break
      // the paste — clear it to empty FIRST, then insert the fresh prompt.
      "  const clearEditor = () => {" +
      "    editor.focus();" +
      "    if (editor.tagName === 'TEXTAREA') {" +
      "      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;" +
      "      setter.call(editor, '');" +
      "      editor.dispatchEvent(new Event('input',{bubbles:true}));" +
      "    } else {" +
      "      const sel = window.getSelection(); sel.removeAllRanges();" +
      "      const range = document.createRange(); range.selectNodeContents(editor); sel.addRange(range);" +
      "      try { document.execCommand('selectAll', false, null); } catch(e){}" +
      "      try { document.execCommand('delete', false, null); } catch(e){}" +
      "      if (editorText().trim().length) { editor.innerHTML=''; }" +
      "      editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'deleteContentBackward'}));" +
      "    }" +
      "  };" +
      "  const insertText = () => {" +
      "    editor.focus();" +
      "    if (editor.tagName === 'TEXTAREA') {" +
      "      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;" +
      "      setter.call(editor, text);" +
      "      editor.dispatchEvent(new Event('input',{bubbles:true}));" +
      "    } else {" +
      "      const sel = window.getSelection(); sel.removeAllRanges();" +
      "      const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false); sel.addRange(range);" +
      "      document.execCommand('insertText', false, text);" +
      "      editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));" +
      "    }" +
      "  };" +
      // Clear → insert, and verify the box now holds exactly the prompt (ignoring
      // whitespace the editor may reflow). Retry a few times if it didn't take.
      "  try {" +
      "    const want = text.replace(/\\s+/g,'');" +
      "    for (let attempt=0; attempt<3; attempt++) {" +
      "      clearEditor(); await sleep(40);" +
      "      insertText(); await sleep(60);" +
      "      if (editorText().replace(/\\s+/g,'') === want) break;" +
      "    }" +
      "  } catch(e){ return 'insert-error'; }" +
      "  let btn = null;" +
      "  for (let i=0;i<60;i++){ btn = findSend(); if (btn) break; await sleep(200); }" +
      // Send ONCE, then wait up to ~3s to confirm it actually went (the composer
      // clears on send). Only escalate to a fallback if it clearly did NOT send,
      // so a single generation never produces two messages / two chats.
      "  const waitSent = async () => { for(let i=0;i<15;i++){ if(!hasText(editor)) return true; await sleep(200); } return !hasText(editor); };" +
      "  if (btn) { realClick(btn); if (await waitSent()) return 'sent'; }" +
      "  pressEnter(editor); if (await waitSent()) return 'sent';" +
      "  if (btn) { realClick(btn); if (await waitSent()) return 'sent'; }" +
      "  return hasText(editor) ? 'not-sent' : 'sent';" +
      "})();";
    try { return await wv.executeJavaScript(js, true); } catch (_) { return "error"; }
  };

  // Rename the current ChatGPT conversation to "Company - Job Title" using
  // ChatGPT's own backend (a same-origin fetch with the session token). This is
  // far more robust than driving the sidebar rename menu, and survives DOM
  // changes. No-ops silently if there's no conversation id / token yet.
  const renameChat = async (label) => {
    const wv = webviewRef.current;
    if (!wv || !label) return "no-label";
    const js =
      "(async () => {" +
      "  const label = " + JSON.stringify(String(label)) + ";" +
      "  const sleep = ms => new Promise(r=>setTimeout(r,ms));" +
      // Wait briefly for the conversation id to appear in the URL after sending.
      "  let id=''; for(let i=0;i<20;i++){ const m=location.pathname.match(/\\/c\\/([^/?#]+)/); if(m){ id=m[1]; break; } await sleep(300); }" +
      "  if(!id) return 'no-id';" +
      "  let tok=''; try{ const s=await fetch('/api/auth/session',{credentials:'include'}).then(r=>r.json()); tok=(s&&s.accessToken)||''; }catch(e){}" +
      "  if(!tok) return 'no-token';" +
      // ChatGPT auto-generates a title after the first reply; set ours a moment
      // later so it wins, then confirm it stuck.
      "  const put = async () => { try{ const r=await fetch('/backend-api/conversation/'+id,{method:'PATCH',credentials:'include',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},body:JSON.stringify({title:label})}); return r.ok; }catch(e){ return false; } };" +
      "  let ok=await put(); await sleep(1200); await put();" +
      "  return ok ? 'ok' : 'failed';" +
      "})();";
    try { return await wv.executeJavaScript(js, true); } catch (_) { return "error"; }
  };

  // Wait for the completed resume-JSON reply (request_id matches, valid JSON with
  // a `resume` object), click its code-block Copy button, and also place the JSON
  // on the clipboard directly so the reply watcher reliably picks it up.
  const autoCopyReply = async (reqId) => {
    const wv = webviewRef.current;
    if (!wv || !reqId) return;
    const js =
      "(async () => {" +
      "  const reqId = " + JSON.stringify(String(reqId)) + ";" +
      "  const sleep = ms => new Promise(r=>setTimeout(r,ms));" +
      "  const complete = (pre) => { const t=(pre.textContent||'').trim(); if(!t.includes(reqId)) return null; let o; try{o=JSON.parse(t);}catch(e){return null;} return (o && String(o.request_id||'')===reqId && o.resume && typeof o.resume==='object') ? t : null; };" +
      "  const findCopyBtn = (pre) => { let node=pre; for(let up=0;up<6&&node;up++){ node=node.parentElement; if(!node) break; let b=node.querySelector('button[aria-label*=\"opy\"],button[data-testid*=\"copy\"]'); if(!b){ b=Array.from(node.querySelectorAll('button')).find(x=>/copy/i.test(((x.textContent||'')+' '+(x.getAttribute('aria-label')||'')))); } if(b) return b; } return null; };" +
      "  for (let i=0;i<900;i++){" +
      "    let text=null, target=null; const pres=document.querySelectorAll('pre');" +
      "    for(const p of pres){ const t=complete(p); if(t){ text=t; target=p; } }" +
      "    if(text && target){ const b=findCopyBtn(target); if(b){ try{ b.click(); }catch(e){} } return text; }" +
      "    await sleep(400);" +
      "  }" +
      "  return '';" +
      "})();";
    let text = "";
    try { text = await wv.executeJavaScript(js, true); } catch (_) {}
    if (text && typeof text === "string" && text.trim()) {
      try { await api().clipboardWrite(text); } catch (_) {}
    }
  };

  // Auto-send the prompt once the ChatGPT page has finished loading, then watch
  // for the reply and auto-copy it.
  const autoSendOnLoad = (promptText, reqId, reused, chatLabel) => {
    const wv = webviewRef.current;
    if (!wv) return;
    // First time the WebView opens ChatGPT (cold full load), give it a 5s
    // settle before injecting. A reused warm tab needs no wait.
    const delay = reused ? 0 : 5000;
    let started = false;
    const run = () => {
      if (started) return;
      // Hard single-fire guard across the whole generation: even if a stale
      // did-finish-load fires or autoSendOnLoad is somehow invoked twice for the
      // same request_id, the prompt is auto-sent exactly once.
      if (autoSentIdRef.current === reqId) return;
      started = true;
      autoSentIdRef.current = reqId;
      wv.removeEventListener("did-finish-load", handler);
      // autoSend() also polls internally for ChatGPT's composer to mount, so
      // this works whether the page just finished loading or loaded earlier.
      setTimeout(async () => {
        const r = await autoSend(promptText);
        if (r !== "sent") {
          toast("Couldn't auto-send — paste the prompt (Ctrl+V) in the ChatGPT tab and send it.", "warning");
        }
        // Set the chat's name right after the message is sent (the conversation
        // now exists) so it shows as the original name before ChatGPT auto-titles.
        if (chatLabel) { try { renameChat(chatLabel); } catch (_) {} }
        // Whether auto-sent or sent manually, watch for the reply and copy it.
        autoCopyReply(reqId);
      }, delay);
    };
    const handler = () => run();
    wv.addEventListener("did-finish-load", handler);
    // The page may have ALREADY finished loading (it was kicked off in parallel
    // with the Gemini call), in which case did-finish-load won't fire again —
    // detect that and run immediately.
    try {
      const cur = wv.getURL() || "";
      if (!wv.isLoading() && cur && cur !== "about:blank") run();
    } catch (_) {}
  };

  // Save whatever page the embedded ChatGPT tab is currently showing as Project Home.
  const saveCurrentPageAsHome = async () => {
    let url = "";
    try { url = webviewRef.current ? webviewRef.current.getURL() : ""; } catch (_) {}
    const r = await api().saveChatgptHome((url || "").trim());
    if (r && r.ok) { setChatHome(r.url); toast("Saved as Project Home.", "success"); }
    else toast((r && r.error) || "Open a ChatGPT page in the tab first.", "warning");
  };

  // Once the webview is ready, load ChatGPT (Project Home) automatically so the
  // tab is never blank; and auto-retry on the local IP if a proxied load fails
  // (ChatGPT/Cloudflare frequently blocks proxy IPs).
  useEffect(() => {
    if (!isV2) return;
    const wv = webviewRef.current;
    if (!wv) return;
    const onReady = async () => {
      let cur = "";
      try { cur = wv.getURL() || ""; } catch (_) {}
      if (!cur || cur === "about:blank") {
        try { await api().chatgptSessionInfo(); } catch (_) {} // apply proxy first
        const r = await api().getChatgptHome();
        loadWebview((r && r.url) || "https://chatgpt.com/");
      }
    };
    const onFail = async (e) => {
      if (!e || e.isMainFrame === false || e.errorCode === -3) return;
      if (chatRetriedRef.current) return;
      chatRetriedRef.current = true;
      try { await api().chatgptSessionDirect(); } catch (_) {}
      loadWebview(lastChatUrlRef.current || "https://chatgpt.com/");
    };
    wv.addEventListener("dom-ready", onReady);
    wv.addEventListener("did-fail-load", onFail);
    return () => {
      try { wv.removeEventListener("dom-ready", onReady); } catch (_) {}
      try { wv.removeEventListener("did-fail-load", onFail); } catch (_) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isV2, chatUa]);

  // V2 browser connection: local IP (direct) or a chosen proxy. Takes effect the
  // next time the ChatGPT window opens (Generate opens a fresh one).
  const chooseConnMode = (mode) => {
    setConnMode(mode);
    api().setPref("chat_conn_mode", mode);
    // Default the proxy selection to the active one the first time Proxy is picked.
    if (mode === "proxy" && !chatProxyId && proxyList.length) {
      const active = proxyList.find((p) => p.is_active) || proxyList[0];
      const id = String(active.id);
      setChatProxyId(id);
      api().setPref("chat_proxy_id", id);
    }
  };
  const chooseChatProxy = (id) => {
    setChatProxyId(id);
    api().setPref("chat_proxy_id", id);
  };
  const proxyLabel = (p) => [p.url, p.port].filter(Boolean).join(":") || `Proxy ${p.id}`;

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
                  disabled={colorLock && taken && !on}
                  title={colorLock && taken ? `${c.name} — used by the Content picker (Cards style)` : c.name}
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
              disabled={colorLock && accent.toLowerCase() === "#ffffff" && nameColor.toLowerCase() !== "#ffffff"}
              title={colorLock && accent.toLowerCase() === "#ffffff" ? "White — used by the Content picker (Cards style)" : "White"}
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
                  disabled={colorLock && taken && !on}
                  title={colorLock && taken ? `${c.name} — used by the Name picker (Cards style)` : c.name}
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
              disabled={colorLock && nameColor.toLowerCase() === "#ffffff" && accent.toLowerCase() !== "#ffffff"}
              title={colorLock && nameColor.toLowerCase() === "#ffffff" ? "White — used by the Name picker (Cards style)" : "White"}
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
          {isV2 && (
            <button
              type="button"
              className={"resume-tab" + (view === "chatgpt" ? " active" : "")}
              onClick={() => setView("chatgpt")}
            >
              ChatGPT
            </button>
          )}
          <button
            type="button"
            className={"resume-tab" + (view === "preview" ? " active" : "")}
            onClick={() => setView("preview")}
          >
            Preview Resume
          </button>
          {/* Only meaningful once a resume exists — it reports the target job too. */}
          {result && (
            <button
              type="button"
              className="resume-tab"
              onClick={() => setShowInfo(true)}
              title="Show this account's personal info and the target job"
            >
              View info
            </button>
          )}
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

        {view === "generate" && (
        <>
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

        {/* Active Prompt with the V2 Browser Connection directly to its right. */}
        <div className={isV2 ? "grid2" : ""}>
          <div className="field">
            <span className="field-label field-label-row">
              Active Prompt
              <button
                type="button"
                className="btn small"
                onClick={() => setShowPromptModal(true)}
                disabled={!selectedPrompt}
                title="View this prompt's content"
              >
                View
              </button>
            </span>
            <FlagSelect
              value={promptId}
              onChange={onPrompt}
              placeholder={prompts.length ? "Select a prompt" : "No prompts — add in Instructions"}
              options={prompts.map((p) => ({ value: p.id, name: p.name || "(untitled)" }))}
            />
          </div>

          {isV2 && (
            <div className="field">
              <span className="field-label field-label-row">
                Browser Connection
                <span className="muted small">
                  {connMode === "proxy" ? "Routing through a proxy" : "Using this computer's IP"} · applies on the next open
                </span>
              </span>
              <div className="conn-box">
                {connMode === "proxy" && (
                  <select
                    className="input conn-proxy-select"
                    value={chatProxyId}
                    onChange={(e) => chooseChatProxy(e.target.value)}
                  >
                    {proxyList.length === 0 && <option value="">No proxies — add one in Settings → Proxy</option>}
                    {proxyList.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {proxyLabel(p)}{p.is_active ? " (active)" : ""}
                      </option>
                    ))}
                  </select>
                )}
                <label className="toggle" title="Toggle between your local IP and a proxy">
                  <input
                    type="checkbox"
                    checked={connMode === "proxy"}
                    onChange={(e) => chooseConnMode(e.target.checked ? "proxy" : "direct")}
                  />
                  <span className="toggle-track"><span className="toggle-thumb" /></span>
                  <span className="toggle-label">{connMode === "proxy" ? "Proxy" : "Local IP"}</span>
                </label>
              </div>
            </div>
          )}
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

        <label className="field">
          <span className="field-label field-label-row">
            Additional Info
            <span className="muted small">optional · added to the prompt for this job</span>
          </span>
          <textarea
            className="textarea"
            rows={4}
            placeholder="Notes for this application — e.g. emphasise Kubernetes, mention relocation to Lisbon, target a 2-page resume…"
            value={extraInfo}
            onChange={(e) => {
              const v = e.target.value;
              setExtraInfo(v);
              api().setPref("gen_extra_info", v);
              clearCache(); // the prompt changed — don't reuse a cached result
            }}
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
                In the ChatGPT tab: paste the prompt (Ctrl+V), send it, then
                select &amp; copy the entire reply. This page detects it automatically.
              </span>
            </div>
            <button className="btn small" onClick={cancelV2}>Cancel</button>
            <button className="btn small" onClick={() => setView("chatgpt")}>Open ChatGPT tab</button>
          </div>
        )}
        {error && <div className="error">{error}</div>}
        </>
        )}
        {view === "preview" && (
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
        {isV2 && chatUa && (
          <div
            className="chat-embed"
            style={
              view === "chatgpt"
                ? { display: "flex" }
                // Keep the WebView laid out (off-screen) instead of display:none so
                // it stays attached and pre-warmed; snaps into the card when active.
                : { display: "flex", position: "absolute", left: "-99999px", top: 0, width: "1000px", height: "700px", pointerEvents: "none" }
            }
          >
            <div className="chat-embed-bar">
              <span className="muted small">
                Paste the prompt (Ctrl+V), send it, then select &amp; copy the whole reply — the app detects it automatically.
              </span>
              <span className="resume-tabs-spacer" />
              <button
                className="btn small"
                onClick={async () => { await autoSend(lastPromptRef.current); autoCopyReply(lastReqIdRef.current); }}
                disabled={!lastPromptRef.current}
                title="Type the last prompt into ChatGPT, send it, and auto-copy the reply"
              >
                Send prompt
              </button>
              <button className="btn small" onClick={() => openChatTab()} title="Reload the ChatGPT tab at your Project Home">Reload</button>
              <button className="btn small" onClick={saveCurrentPageAsHome} title="Save the current page as your Project Home">Save as Project Home</button>
            </div>
            <webview
              ref={webviewRef}
              className="chat-webview"
              partition="persist:chatgpt"
              useragent={chatUa}
              allowpopups="true"
              webpreferences="backgroundThrottling=false"
              src="about:blank"
            />
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

    {showPromptModal && (
      <div className="modal-overlay" onClick={() => setShowPromptModal(false)}>
        <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
          <div className="card-head">
            <h2>{selectedPrompt ? (selectedPrompt.name || "Prompt") : "Prompt"}</h2>
            <div className="list-actions">
              <button className="btn small" onClick={() => setShowPromptModal(false)}>Close</button>
            </div>
          </div>
          {selectedPrompt && selectedPrompt.body
            ? <pre className="resume-output">{selectedPrompt.body}</pre>
            : <p className="muted">This prompt is empty.</p>}
        </div>
      </div>
    )}

    {showInfo && (
      <div className="modal-overlay" onClick={() => setShowInfo(false)}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="card-head">
            <h2>View info</h2>
            <div className="list-actions">
              <button className="btn small" onClick={() => setShowInfo(false)}>Close</button>
            </div>
          </div>

          <div className="info-section">Project Info</div>
          <div className="info-grid">
            <div className="info-k">Company</div><div className="info-v">{jobCompany || "—"}</div>
            <div className="info-k">Job Title</div><div className="info-v">{jobRole || "—"}</div>
            <div className="info-k">Country</div><div className="info-v">{jobCountry || "—"}</div>
          </div>

          <div className="info-section">Personal Info</div>
          {acctInfo ? (
            <div className="info-grid">
              <div className="info-k">Name</div><div className="info-v">{acctInfo.name || "—"}</div>
              <div className="info-k">Title</div><div className="info-v">{acctInfo.title || "—"}</div>
              <div className="info-k">DOB</div>
              <div className="info-v">
                {acctInfo.birth_date || <span className="muted">Not set (Accounts → Personal)</span>}
              </div>
              <div className="info-k">Age</div>
              <div className="info-v">{ageFromBirthDate(acctInfo.birth_date) || "—"}</div>
              <div className="info-k">Email</div><div className="info-v">{acctInfo.email || "—"}</div>
              <div className="info-k">Phone</div><div className="info-v">{acctInfo.phone || "—"}</div>
              <div className="info-k">Address</div><div className="info-v">{acctInfo.address || "—"}</div>
              <div className="info-k">Country</div><div className="info-v">{acctInfo.country || "—"}</div>
              <div className="info-k">LinkedIn</div><div className="info-v">{acctInfo.linkedin || "—"}</div>
              <div className="info-k">Portfolio</div><div className="info-v">{acctInfo.portfolio || "—"}</div>
            </div>
          ) : (
            <p className="muted">Select an account to see its details.</p>
          )}
        </div>
      </div>
    )}

    <ConfirmModal
      open={!!dupConfirm}
      title="Already applied to this role?"
      message={
        dupConfirm
          ? `You already have an application for "${dupConfirm.role}"${dupConfirm.company ? ` at ${dupConfirm.company}` : ""}. Generate a new resume for it (this overwrites the existing one)?`
          : ""
      }
      confirmLabel="Generate anyway"
      onConfirm={() => { const r = dupResolveRef.current; dupResolveRef.current = null; setDupConfirm(null); if (r) r(true); }}
      onCancel={() => { const r = dupResolveRef.current; dupResolveRef.current = null; setDupConfirm(null); if (r) r(false); }}
    />

    </div>
  );
}
