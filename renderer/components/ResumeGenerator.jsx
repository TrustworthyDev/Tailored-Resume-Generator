import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { buildResumeHtml, buildCoverLetterHtml } from "../lib/resumeHtml";
import { styleThumb } from "../lib/styleThumbs";
import { STYLES, PRESET_COLORS, FONT_OPTIONS, SIZE_OPTIONS, hasSavedLook, rankStyles } from "../lib/resumeStyles";
import { modelTiny, providerLabel } from "../lib/aiModels";
import { friendlyError } from "../lib/errors";
import { ageFromBirthDate } from "../lib/age";
import FlagSelect from "./FlagSelect";
import ConfirmModal from "./ConfirmModal";


// Shown when the user tweaks a style/colour/font but hasn't generated a resume.
const NO_CONTENT_MSG = "There is no resume content yet. Please generate a resume first.";

// `active` = this generator's tab is the one on screen. V2 stays mounted for the
// whole session (its ChatGPT WebView pre-warms in the background), so it uses
// this to refresh lists that would otherwise go stale — see the effect below.
// Small copy-to-clipboard control shown beside a value. Flips to a tick briefly
// so the click is acknowledged without shifting anything on screen.
function CopyButton({ label, done, onCopy }) {
  return (
    <button
      type="button"
      className="copy-btn"
      onClick={onCopy}
      title={done ? "Copied" : `Copy ${label}`}
      aria-label={`Copy ${label}`}
    >
      {done ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

export default function ResumeGenerator({ variant = "v1", active = true }) {
  // V3 is "V2 + job-post-link extraction": it reuses the entire ChatGPT
  // generation path, but starts from a link instead of a pasted description.
  const isV3 = variant === "v3";
  const isV2 = variant === "v2" || isV3;
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState("");
  const accountIdRef = useRef("");
  accountIdRef.current = accountId;
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
  // V3 keeps its own persisted Job Description so clearing the box after an
  // Extract never wipes what's typed on the V1/V2 tabs (they share one pref).
  const JD_PREF = isV3 ? "gen_v3_jd" : "gen_jd";
  // The last generated resume text, scoped like the job description it came
  // from, so V3 and V1/V2 never overwrite each other's last result.
  const RESULT_PREF = isV3 ? "gen_v3_result" : "gen_result";
  // Generate V3: extract the job posting from a link.
  const [jobLink, setJobLink] = useState("");
  const [fetchingJd, setFetchingJd] = useState(false);
  const [jobMeta, setJobMeta] = useState(null); // { role, company, country, location, salaryRange, industry, employmentType }
  const jobMetaRef = useRef(null);
  jobMetaRef.current = jobMeta;
  const [v3AutoGen, setV3AutoGen] = useState(false); // V3: auto-run generation right after Extract
  // Refs that always hold the LATEST value, so the async Extract handler reads
  // the current toggle/account even if its closure was created before prefs
  // finished loading on a fresh app open (fixes "auto-gen doesn't fire the first time").
  const v3AutoGenRef = useRef(v3AutoGen);
  v3AutoGenRef.current = v3AutoGen;
  const [result, setResult] = useState("");
  const [jobRole, setJobRole] = useState("");
  const [jobCompany, setJobCompany] = useState("");
  const [jobCountry, setJobCountry] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [savedPath, setSavedPath] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [autoOnPaste, setAutoOnPaste] = useState(true);
  const [openModalAfterPreview, setOpenModalAfterPreview] = useState(true);
  const [autoGenerate, setAutoGenerate] = useState(false);
  const [coverLetter, setCoverLetter] = useState(true);
  const [autoOpenPdf, setAutoOpenPdf] = useState(false); // open the saved PDF in the system viewer
  const [prefsReady, setPrefsReady] = useState(false); // toggles render after load
  const [copied, setCopied] = useState(false);
  // Marks the generated resume as "taken" — set by any Copy Location button, so
  // the form carries a green border until the next Generate Resume clears it.
  // Persisted, since copying the folder is usually followed by leaving the app
  // to file the application.
  const [locationCopied, setLocationCopied] = useState(false);
  const [acctInfo, setAcctInfo] = useState(null); // contact info for the live viewer
  const [eduRows, setEduRows] = useState([]); // structured education for the resume
  const [view, setView] = useState("generate"); // "generate" | "preview" sub-tab
  const [pickersOpen, setPickersOpen] = useState(true); // colors & font section expanded
  const [pdfUrl, setPdfUrl] = useState(""); // blob URL of the saved PDF for inline viewing
  const [v2Waiting, setV2Waiting] = useState(false); // V2: waiting for the ChatGPT reply on the clipboard
  const [chatHome, setChatHome] = useState(""); // V2: saved ChatGPT Project Home URL (used for auto-navigation)
  const [connMode, setConnMode] = useState("direct"); // app-wide: "direct" (local IP) | "proxy"
  const [connStatus, setConnStatus] = useState(null); // { mode, ok, proxy } from the main process
  const connModeRef = useRef("direct"); // latest mode for the webview's failure handler
  connModeRef.current = connMode;
  const [proxyList, setProxyList] = useState([]); // V2: proxies to choose from
  const [chatProxyId, setChatProxyId] = useState(""); // V2: chosen proxy id
  const [showPromptModal, setShowPromptModal] = useState(false); // view active prompt content
  const [showInfo, setShowInfo] = useState(false); // "View info" modal (account + target job)
  const [showSaved, setShowSaved] = useState(false); // post-generation modal with the file actions
  const [copiedField, setCopiedField] = useState(""); // which contact field was just copied
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

  // The V2 instance is the one mounted at startup to pre-warm the ChatGPT tab.
  // It tells the app shell the moment that tab is up (or has definitively
  // failed) so the startup overlay can close. Fires at most once.
  const chatReadySentRef = useRef(false);
  const signalChatReady = () => {
    if (chatReadySentRef.current || variant !== "v2") return;
    chatReadySentRef.current = true;
    window.dispatchEvent(new CustomEvent("chat-ready"));
  };

  // The description a generation runs on: an explicitly passed value (the very
  // text that was just extracted/pasted, avoiding a stale state read) or
  // whatever is currently in the Job Description box.
  const resolveJd = (jdValue) => (typeof jdValue === "string" ? jdValue : jd);

  // Generate V3: everything read from the job post — the details shown as chips
  // under the link, then the description — as one block for the Job Description
  // field. This is what gets sent to the AI and stored on the application.
  const composeJobDescription = (m, description) => {
    const lines = [
      ["Role", m.role],
      ["Company", m.company],
      ["Country", m.country],
      ["Location", m.location],
      ["Salary", m.salaryRange],
      ["Industry", m.industry],
      ["Employment Type", m.employmentType],
      ["Job Link", m.url],
    ]
      .filter(([, v]) => v && String(v).trim())
      .map(([k, v]) => `${k}: ${String(v).trim()}`);
    const body = (description || "").trim();
    if (!lines.length) return body;
    return `${lines.join("\n")}\n\nJob Description:\n${body}`;
  };

  // The target job is persisted alongside the saved path so "View info" still
  // has something to show — and still appears — after the app is closed and
  // reopened. The resume text is kept too — see rememberResult below.
  const rememberTarget = (role, company, country) => {
    setJobRole(role || "");
    setJobCompany(company || "");
    setJobCountry(country || "");
    api().setPref("gen_job_role", role || "");
    api().setPref("gen_job_company", company || "");
    api().setPref("gen_job_country", country || "");
  };

  // The generated resume text is kept alongside the target job. Without it the
  // style, colour and font controls had nothing to re-render after a restart and
  // could only report that there was no resume content — so the last resume can
  // now be restyled at any time, not just in the session that produced it.
  const rememberResult = (text) => {
    setResult(text || "");
    api().setPref(RESULT_PREF, text || "");
  };

  // Drops the cached generation (the resume text and the file it produced).
  // The target job is deliberately NOT cleared here — it is the last job we know
  // about, and blanking it emptied "View info" every time the description was
  // edited or a new link was extracted. It is replaced, never wiped.
  const clearCache = () => {
    setResult("");
    setSavedPath("");
    setSavedAt("");
    api().setPref(RESULT_PREF, "");
    api().setPref("gen_saved_path", "");
    api().setPref("gen_saved_at", "");
  };

  useEffect(() => {
    (async () => {
      const [accs, ks, instrs, accPref, stylePref, px, autoPref, accentPref, nameColorPref, openModalPref, autoGenPref, jdPref, savedPathPref, savedAtPref, coverPref, styleOrderPref, fontPref, fontSizePref, extraPref, jobLinkPref, v3AutoPref] = await Promise.all([
        api().listAccounts(),
        api().listApiKeys(isV2 ? "v2" : "v1"),
        api().listInstructions(),
        api().getPref("selected_account_id"),
        api().getPref("resume_style"),
        api().getConnectionStatus(),
        api().getPref("auto_preview"),
        api().getPref("resume_accent"),
        api().getPref("resume_name_color"),
        api().getPref("open_preview_after"),
        api().getPref("auto_generate"),
        api().getPref(JD_PREF),
        api().getPref("gen_saved_path"),
        api().getPref("gen_saved_at"),
        api().getPref("cover_letter"),
        api().getPref("style_order"),
        api().getPref("resume_font"),
        api().getPref("resume_font_size"),
        api().getPref("gen_extra_info"),
        api().getPref("gen_job_link"),
        api().getPref("v3_auto_generate"),
      ]);
      setAccounts(accs || []);
      setKeys(ks || []);
      setPrompts(instrs || []);
      if (px) setConnStatus(px);
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
      if (jobLinkPref && jobLinkPref.value) setJobLink(jobLinkPref.value);
      if (v3AutoPref && v3AutoPref.value != null) setV3AutoGen(v3AutoPref.value === "1");
      // V3: restore the last extraction's details so the chips under the link
      // (and the values stored on the next application) survive a restart.
      if (isV3) {
        const metaPref = await api().getPref("gen_v3_meta");
        if (metaPref && metaPref.value) {
          try { setJobMeta(JSON.parse(metaPref.value)); } catch (_) {}
        }
      }
      if (savedPathPref && savedPathPref.value) setSavedPath(savedPathPref.value);
      if (savedAtPref && savedAtPref.value) setSavedAt(savedAtPref.value);

      const autoOpenPref = await api().getPref("auto_open_pdf");
      if (autoOpenPref && autoOpenPref.value != null) setAutoOpenPdf(autoOpenPref.value === "1");

      // Whether the last generated resume has already had its location copied.
      const copiedPref = await api().getPref("gen_location_copied");
      if (copiedPref && copiedPref.value != null) setLocationCopied(copiedPref.value === "1");

      // The last target job, so "View info" survives a restart — and the resume
      // text that went with it, so the style/colour/font controls can re-render
      // it straight away instead of reporting that there is nothing to restyle.
      const [rolePref, companyPref, countryPref, resultPref] = await Promise.all([
        api().getPref("gen_job_role"),
        api().getPref("gen_job_company"),
        api().getPref("gen_job_country"),
        api().getPref(RESULT_PREF),
      ]);
      if (rolePref && rolePref.value) setJobRole(rolePref.value);
      if (companyPref && companyPref.value) setJobCompany(companyPref.value);
      if (countryPref && countryPref.value) setJobCountry(countryPref.value);
      if (resultPref && resultPref.value) setResult(resultPref.value);

      if (styleOrderPref && styleOrderPref.value) setStyles(rankStyles(styleOrderPref.value));

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
      // Re-read the selected account's saved look. Without this, a template
      // chosen on that account's Set Resume tab would not show up here until the
      // account was re-selected — the account-change effect never fires when the
      // selection is already the one that was edited.
      const id = accountIdRef.current;
      if (id) {
        const acc = await api().getAccount(Number(id));
        if (!cancelled) applyAccountLook(acc);
      }
      // The ranking lives in one pref but each Generate tab keeps its own copy,
      // so a reorder done on another tab would otherwise not show up here.
      const orderPref = await api().getPref("style_order");
      if (!cancelled && orderPref && orderPref.value) setStyles(rankStyles(orderPref.value));
      // Same for the copied mark: it belongs to the saved resume, which all
      // three Generate tabs share, and it is cleared when the app starts.
      const copiedPref = await api().getPref("gen_location_copied");
      if (!cancelled && copiedPref) setLocationCopied(copiedPref.value === "1");
    })();
    return () => { cancelled = true; };
  }, [active, isV2]);

  // Keep the selected account's contact info handy so the live resume viewer
  // renders the same authoritative header the exported PDF uses.
  useEffect(() => {
    if (!accountId) { setAcctInfo(null); setEduRows([]); return; }
    let cancelled = false;
    api().getAccount(Number(accountId)).then((a) => {
      if (cancelled) return;
      setAcctInfo(a || null);
      applyAccountLook(a);
    });
    api().listEducation(Number(accountId)).then((rows) => { if (!cancelled) setEduRows(rows || []); });
    return () => { cancelled = true; };
  }, [accountId]);

  // Switch the style, colour and font controls to whatever this account has
  // saved on its "Set Resume" tab. Each setting is applied only when the account
  // actually carries one, so an account with nothing set leaves the current
  // selection alone rather than resetting it to defaults. The preview re-renders
  // by itself — the effect below already watches these five values.
  const applyAccountLook = (acc) => {
    if (!hasSavedLook(acc)) return;
    const styleId = (acc.resume_style || "").trim();
    if (styleId && STYLES.some((s) => s.id === styleId)) setStyle(styleId);
    const accentVal = (acc.resume_accent || "").trim();
    if (accentVal) setAccent(accentVal);
    const nameVal = (acc.resume_name_color || "").trim();
    if (nameVal) setNameColor(nameVal);
    const fontVal = (acc.resume_font || "").trim();
    if (fontVal) setFont(fontVal);
    const sizeVal = (acc.resume_font_size || "").trim();
    if (sizeVal) setFontSize(sizeVal);
  };

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

  // The connection choice applies to every generator, so load it on all of them
  // (not just V2 — V1's requests follow it too).
  useEffect(() => {
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
  }, []);

  // V2: the saved ChatGPT Project Home URL.
  useEffect(() => {
    if (!isV2) return;
    api().getChatgptHome().then((r) => { setChatHome((r && r.url) || ""); });
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
      if (!busyRef.current) exportPdf(result, jobRole, jobCompany, jobCountry, resolveJd(), { skipCover: true });
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
    if (styleDragIndex === null) return;
    setStyleDragIndex(null);
    // Same shape as the accounts ranking: write the order, then re-read it and
    // render that, so what is on screen is always what was actually stored.
    const order = styles.map((s) => s.id).join(",");
    api()
      .setPref("style_order", order)
      .then(() => api().getPref("style_order"))
      .then((pref) => { if (pref && pref.value) setStyles(rankStyles(pref.value)); });
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
    const useJd = resolveJd(jdValue);
    const v3Meta = (isV3 && jobMetaRef.current) || {};
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
        country: country || v3Meta.country || "",
        // Dedicated duplicate-detection index: the Gemini JD extraction (V2) so
        // matching is stable regardless of what the reply/display shows. Falls
        // back to role/company when no target was extracted (e.g. V1).
        matchRole: opts.matchRole || role,
        matchCompany: opts.matchCompany || company,
        // The original job-post URL (V2/V3), stored so the history's "Open Link"
        // can reopen it. Empty for V1.
        jobLink: isV2 ? (jobLink || "").trim() : "",
        // V3: the rest of the extracted posting, stored on the application so
        // the history's "View Job Content" shows the full job.
        jobLocation: v3Meta.location || "",
        jobIndustry: v3Meta.industry || "",
        salaryRange: v3Meta.salaryRange || "",
        employmentType: v3Meta.employmentType || "",
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
          // Optionally hand the finished PDF straight to the system viewer.
          if (autoOpenPdf) { try { api().openPdf(exp.path); } catch (_) {} }
          // Land on the saved-resume modal. It replaces the optional preview
          // modal rather than stacking on top of it.
          setShowPreview(false);
          setShowSaved(true);
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

  const generate = () => exportPdf(result, jobRole, jobCompany, jobCountry, resolveJd());

  // Preview: call the AI once, cache the content, optionally pop the modal,
  // and optionally chain straight into Generate.
  const preview = async (jdValue) => {
    const useJd = resolveJd(jdValue);
    // The job description is mandatory — this app only produces resumes tailored
    // to a specific job posting.
    if (!useJd || !useJd.trim()) {
      toast("Job description is required. Paste the target job description to generate a tailored resume.", "danger");
      return;
    }
    if (!accountId) { setError("Select an account first."); return; }
    // Generation runs on whichever connection is selected. Local IP is a valid
    // choice — only a Proxy run with no usable proxy is a problem.
    const conn = await api().getConnectionStatus();
    setConnStatus(conn);
    if (conn && conn.mode === "proxy" && !conn.ok) {
      setError(
        "Connection is set to Proxy, but no proxy is available. Pick one in Settings → Proxy, or switch Connection to Local IP."
      );
      return;
    }
    setLoading(true);
    setError("");
    setSavedPath("");
    try {
      const res = await callApi(useJd);
      rememberResult(res.text || "");
      rememberTarget(res.jobRole, res.jobCompany, res.jobCountry);
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
  // Generate V3: editing the link drops only the detail chips under it, since
  // they describe a URL that is no longer in the box. Everything else — the
  // description, the cached resume, the remembered target — is left alone until
  // Extract is actually clicked.
  const clearExtractedDetails = (nextLink) => {
    const from = jobMetaRef.current;
    if (!from) return;
    if ((nextLink || "").trim() === (from.url || "").trim()) return;
    setJobMeta(null);
    jobMetaRef.current = null;
    api().setPref("gen_v3_meta", "");
  };

  // Generate V3: load the job-post link and extract the full posting. The full
  // clear — description, cached resume, remembered extraction — happens on the
  // Extract CLICK, not while the link is being typed.
  const fetchJobFromLink = async () => {
    const link = (jobLink || "").trim();
    if (!/^https?:\/\//i.test(link)) {
      toast("Paste a job-post link that starts with http:// or https://", "warning");
      return;
    }
    setFetchingJd(true);
    setError("");
    // Drop the whole previous job now that a new read is starting: the detail
    // chips, the description, the remembered extraction and the cached resume.
    setJobMeta(null);
    jobMetaRef.current = null;
    api().setPref("gen_v3_meta", "");
    setJd("");
    api().setPref(JD_PREF, "");
    clearCache();
    try {
      const res = await api().fetchJobPost(link);
      if (!res || !res.ok) {
        setError((res && res.error) || "Could not read that job post.");
        return;
      }
      const meta = {
        role: res.role || "", company: res.company || "", country: res.country || "",
        location: res.location || "", salaryRange: res.salaryRange || "",
        industry: res.industry || "", employmentType: res.employmentType || "",
        url: res.url || link,
        source: res.source || "", usedRaw: !!res.usedRaw,
      };
      setJobMeta(meta);
      jobMetaRef.current = meta;
      api().setPref("gen_v3_meta", JSON.stringify(meta));
      // Fill the Job Description with the details AND the description, so what
      // the AI sees — and what's stored on the application — is the whole job.
      const jdText = composeJobDescription(meta, res.jobDescription || "");
      setJd(jdText);
      api().setPref(JD_PREF, jdText);
      clearCache(); // the cached resume belonged to the previous job
      // Then adopt THIS job as the target, so "View info" is populated from the
      // extraction onwards rather than sitting empty until a resume is built.
      // Generation overwrites these with whatever the reply reports.
      rememberTarget(meta.role, meta.company, meta.country);
      // Read the LATEST toggle/account via refs (not the stale closure) so this
      // works on the very first Extract after a fresh app open.
      const autoGen = v3AutoGenRef.current;
      const acctId = accountIdRef.current;
      // The detail layer reports why it came up empty instead of failing silently.
      if (res.aiNote && !meta.role && !meta.company) toast(res.aiNote, "warning");
      if (res.usedRaw) {
        toast("Couldn't fully parse the page — showing the raw text. Review and trim the Job Description below.", "warning");
      } else if (autoGen && acctId && jdText.trim()) {
        // Auto-generate: run the full workflow immediately (no Generate click).
        toast("Job extracted — generating the resume automatically…", "info");
        setFetchingJd(false);
        runGenerate(jdText);
        return;
      } else {
        toast(
          autoGen && !acctId
            ? "Job extracted. Select an account, then it will auto-generate next time."
            : "Job description extracted from the link. Review it below, then Generate.",
          autoGen && !acctId ? "warning" : "success"
        );
      }
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setFetchingJd(false);
    }
  };

  const previewV2 = async (jdValue) => {
    const useJd = resolveJd(jdValue);
    if (!useJd || !useJd.trim()) {
      toast(
        isV3
          ? "No job posting yet. Paste a job-post link and click Extract (or type a description below)."
          : "Job description is required. Paste the target job description to generate a tailored resume.",
        "danger"
      );
      return;
    }
    if (!accountId) { setError("Select an account first."); return; }
    // Same connection pre-flight as V1 — Local IP is fine, a Proxy run without
    // a usable proxy is not.
    const conn = await api().getConnectionStatus();
    setConnStatus(conn);
    if (conn && conn.mode === "proxy" && !conn.ok) {
      setError(
        "Connection is set to Proxy, but no proxy is available. Pick one in Settings → Proxy, or switch Connection to Local IP."
      );
      return;
    }
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
        // Replies for other requests are skipped, not fatal — so the only way to
        // end up here is a genuine timeout, a cancel, or an unreadable reply.
        setError(
          res && res.timeout
            ? res.sawOther
              ? "Timed out. The replies copied so far belonged to other requests — re-send THIS prompt in ChatGPT and copy its reply."
              : "Timed out waiting for the ChatGPT reply. Click Generate Resume to try again."
            : "Could not read the ChatGPT reply from the clipboard. Make sure you copied the whole answer."
        );
        return;
      }
      // Display uses the values ChatGPT reported in its reply. Duplicate
      // matching uses the Gemini JD extraction (target) via dedicated index
      // columns, kept separate so display and matching never interfere.
      const hasTarget = !!(target && target.company && target.role);
      rememberResult(res.text || "");
      rememberTarget(res.jobRole, res.jobCompany, res.jobCountry || (target && target.country));
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
  // Starting a new resume clears the "taken" marker from the last one.
  const runGenerate = (jdValue) => {
    if (locationCopied) {
      setLocationCopied(false);
      api().setPref("gen_location_copied", "0");
    }
    return isV2 ? previewV2(jdValue) : preview(jdValue);
  };

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

  // Put ChatGPT on its highest reasoning effort before the prompt goes in — a
  // JD-tailored resume is exactly the kind of long, constraint-heavy task that
  // degrades on a fast model. Opens the model picker, takes the Thinking entry
  // if one is offered, then clicks the "High" effort option.
  //
  // This drives ChatGPT's own DOM, which its authors change without notice, so
  // every step is best-effort: each lookup retries briefly, anything unfound is
  // skipped, and the menu is dismissed on the way out. A failure here returns a
  // reason string and never blocks sending — the prompt still goes through on
  // whatever model is already selected.
  const setReasoningHigh = async () => {
    const wv = webviewRef.current;
    if (!wv) return "no-webview";
    const js =
      "(async () => {" +
      "  const sleep = ms => new Promise(r=>setTimeout(r,ms));" +
      "  const vis = (el) => { if(!el) return false; const r=el.getBoundingClientRect(); return r.width>0 && r.height>0; };" +
      "  const realClick = (el) => { const o={bubbles:true,cancelable:true,view:window};" +
      "    try{ el.dispatchEvent(new PointerEvent('pointerdown',o)); }catch(e){}" +
      "    el.dispatchEvent(new MouseEvent('mousedown',o));" +
      "    try{ el.dispatchEvent(new PointerEvent('pointerup',o)); }catch(e){}" +
      "    el.dispatchEvent(new MouseEvent('mouseup',o));" +
      "    try{ el.click(); }catch(e){ el.dispatchEvent(new MouseEvent('click',o)); } };" +
      // 1. Find the model picker first, so it can be excluded from the menu
      // scan below — its own label often reads "GPT-5 Thinking", which would
      // otherwise match the Thinking lookup and re-click the button, closing
      // the menu instead of stepping into it.
      "  const opener = document.querySelector('[data-testid=\"model-switcher-dropdown-button\"]')" +
      "    || Array.from(document.querySelectorAll('button')).filter(vis).find(b => /model|gpt|thinking/i.test(((b.getAttribute('aria-label')||'')+' '+(b.textContent||'')).trim()));" +
      "  if (!opener) return 'no-picker';" +
      // Menu items render as role=menuitem/option/radio depending on the build.
      "  const items = () => Array.from(document.querySelectorAll('[role=\"menuitem\"],[role=\"menuitemradio\"],[role=\"option\"],[data-testid^=\"model-switcher\"]')).filter(el => vis(el) && el !== opener && !opener.contains(el));" +
      "  const byText = (re) => items().find(el => re.test((el.textContent||'').trim()));" +
      "  const waitFor = async (fn, tries) => { for(let i=0;i<tries;i++){ const v=fn(); if(v) return v; await sleep(150); } return null; };" +
      "  realClick(opener);" +
      "  if (!(await waitFor(() => items().length ? true : null, 20))) return 'menu-did-not-open';" +
      // 2. If the effort options aren't on this level, step into the Thinking entry.
      "  let high = byText(/^high$/i);" +
      "  if (!high) {" +
      "    const thinking = byText(/thinking|reasoning/i);" +
      "    if (thinking) { realClick(thinking); await sleep(400); high = await waitFor(() => byText(/^high$/i), 20); }" +
      "  }" +
      // 3. Fall back to a label that merely contains "high" (e.g. "High effort").
      "  if (!high) high = byText(/\\bhigh\\b/i);" +
      "  if (!high) { try{ document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); }catch(e){} return 'no-high-option'; }" +
      "  realClick(high);" +
      "  await sleep(400);" +
      "  try{ document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); }catch(e){}" +
      "  return 'ok';" +
      "})();";
    try { return await wv.executeJavaScript(js, true); } catch (_) { return "error"; }
  };


  // Append what the extraction saw — which container the JSON came out of, how
  // many characters it was, and the page's own shape (block count, CodeMirror
  // line count, total text) — to copy-diag.log in the app's data folder. On a
  // timeout it records whether the request id was ever on the page at all, which
  // separates "the reply never came" from "the reply came but never parsed".
  const logCopyDiag = async (diag) => {
    if (!diag) return;
    try { await api().logCopyDiag(JSON.stringify(diag)); } catch (_) {}
  };

  // Click ChatGPT's Copy button for real, and MEASURE the outcome.
  //
  // The page cannot click it convincingly on its own: every event it dispatches
  // carries isTrusted:false and confers no user activation, so ChatGPT's handler
  // can run, call navigator.clipboard.writeText(), and have Chromium refuse it —
  // a click that looks delivered and copies nothing. sendInputEvent is issued by
  // the main process instead, so the WebView receives an ordinary trusted mouse
  // click at the button's coordinates.
  //
  // Returns what actually happened rather than an assumption: `delivered` comes
  // from a capture-phase listener inside the page, `trusted` from that event's
  // isTrusted flag, and `clipboardChanged` from comparing the clipboard either
  // side of the click — all three recorded before the app writes its own copy.
  const clickCopyButton = async (diag) => {
    const wv = webviewRef.current;
    const aim = diag && diag.aim;
    if (!wv || !aim || !aim.x) return { attempted: false, reason: (diag && diag.button) === "NONE" ? "no-copy-button-found" : "no-coordinates" };
    if (aim.covered) return { attempted: false, reason: "button-covered-by-" + (aim.topmost || "unknown") };

    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const probe = async () => {
      try { return JSON.parse(await wv.executeJavaScript("JSON.stringify(window.__copyProbe||{})", true)) || {}; }
      catch (_) { return {}; }
    };
    const readClip = async () => {
      try { const r = await api().clipboardRead(); return (r && r.text) || ""; } catch (_) { return ""; }
    };

    const before = await probe();
    const clipBefore = await readClip();
    let sent = null;
    try { sent = await api().chatSendClick({ id: wv.getWebContentsId(), x: aim.x, y: aim.y }); }
    catch (e) { sent = { ok: false, error: (e && e.message) || String(e) }; }
    await wait(600);

    let after = await probe();
    let method = "trusted";
    // The real click never reached the button — try dispatching one in the page,
    // so the run still shows whether the handler responds to a synthetic event.
    if ((after.seen || 0) <= (before.seen || 0)) {
      try {
        await wv.executeJavaScript(
          "(() => { const b = window.__copyBtn; if(!b) return false;" +
          " const o = {bubbles:true,cancelable:true,view:window};" +
          " try{ b.dispatchEvent(new PointerEvent('pointerdown',o)); }catch(e){}" +
          " b.dispatchEvent(new MouseEvent('mousedown',o));" +
          " try{ b.dispatchEvent(new PointerEvent('pointerup',o)); }catch(e){}" +
          " b.dispatchEvent(new MouseEvent('mouseup',o));" +
          " try{ b.click(); }catch(e){}" +
          " return true; })();",
          true
        );
      } catch (_) {}
      await wait(400);
      after = await probe();
      method = "synthetic-fallback";
    }
    const clipAfter = await readClip();

    return {
      attempted: true,
      method,
      sendOk: !!(sent && sent.ok),
      sendError: sent && sent.ok ? "" : ((sent && sent.error) || "unknown"),
      delivered: (after.seen || 0) > (before.seen || 0),
      trusted: (after.trusted || 0) > (before.trusted || 0),
      clipboardChanged: clipAfter !== clipBefore,
      clipboardHasReply: clipAfter.indexOf("request_id") > -1,
    };
  };

  // Wait for the completed resume-JSON reply (request_id matches, valid JSON with
  // a `resume` object), read it straight out of the code block, and put THAT text
  // on the system clipboard — the app does the copying, ChatGPT's Copy button is
  // not involved at all.
  //
  // Detection scans TEXT for a balanced JSON object rather than expecting a
  // particular element to parse whole: ChatGPT's <pre> encloses the block header
  // ("JSON" label, Copy button) so its textContent never parses, and the block is
  // rendered by CodeMirror as one div.cm-line per line. Scanning text sidesteps
  // both. The scan accepts nothing that isn't a complete object carrying this
  // run's request_id, so a half-streamed reply can never reach the clipboard.
  // One pass over the ChatGPT tab, up to budgetMs. Resolves as soon as it has
  // either the reply JSON, or a Copy button to click because the DOM text is
  // unreadable — the caller decides what to do next, and can come back for
  // another pass with whatever time is left.
  const scanForReply = async (reqId, budgetMs) => {
    const wv = webviewRef.current;
    if (!wv || !reqId) return { text: "", diag: null };
    const js =
      "(async () => {" +
      "  const reqId = " + JSON.stringify(String(reqId)) + ";" +
      "  const sleep = ms => new Promise(r=>setTimeout(r,ms));" +
      // Balanced-brace scan for the object carrying our request_id. Independent of
      // markup, so header labels and syntax-highlight spans do not matter.
      "  const findJson = (text) => {" +
      "    if(!text) return null;" +
      "    const at = text.indexOf(reqId); if(at < 0) return null;" +
      "    for(let s = text.lastIndexOf('{', at); s >= 0; s = text.lastIndexOf('{', s-1)){" +
      "      let depth=0, inStr=false, esc=false;" +
      "      for(let p=s; p<text.length; p++){" +
      "        const ch = text[p];" +
      "        if(esc){ esc=false; continue; }" +
      "        if(ch === '\\\\'){ esc=true; continue; }" +
      "        if(ch === '\"'){ inStr = !inStr; continue; }" +
      "        if(inStr) continue;" +
      "        if(ch === '{') depth++;" +
      "        else if(ch === '}'){ depth--;" +
      "          if(depth === 0){" +
      "            const cand = text.slice(s, p+1);" +
      "            if(cand.indexOf(reqId) > -1){ try{ const o = JSON.parse(cand); if(o && String(o.request_id||'') === reqId && o.resume && typeof o.resume === 'object') return cand; }catch(e){} }" +
      "            break;" +
      "          }" +
      "        }" +
      "      }" +
      "      if(s === 0) break;" +
      "    }" +
      "    return null;" +
      "  };" +
      // Everywhere a code block can put its text: the classic <pre>/<code>, and
      // CodeMirror's .cm-content, whose lines are plain divs and so would only be
      // reached through the much noisier whole-page text otherwise.
      "  const blocks = () => Array.from(document.querySelectorAll('pre,code,.cm-content'));" +
      // className is an SVGAnimatedString on SVG elements, so read baseVal there.
      "  const label = (el) => { try{ const c = el.className && el.className.baseVal !== undefined ? el.className.baseVal : (el.className || ''); return el.tagName + (c ? '.' + String(c).trim().split(/\\s+/)[0] : ''); }catch(e){ return '?'; } };" +
      "  const pageText = () => { try{ return document.body ? document.body.innerText : ''; }catch(e){ return ''; } };" +
      "  const facts = () => ({ preCount: document.querySelectorAll('pre').length, cmLines: document.querySelectorAll('.cm-line').length, pageChars: pageText().length });" +
      // --- ChatGPT's own Copy button, in the reply's code block ---------------
      // Matched on any attribute ChatGPT has used for it; the control is icon-only,
      // so textContent is usually empty.
      "  const attrs = (b) => ((b.getAttribute('aria-label')||'')+' '+(b.getAttribute('data-testid')||'')+' '+(b.getAttribute('title')||'')+' '+(b.textContent||'')).toLowerCase();" +
      "  const isCopy = (b) => /copy/.test(attrs(b));" +
      // Make the click OBSERVABLE. A capture-phase listener on document sees any
      // click that reaches a copy control before ChatGPT's own handler does, and
      // records whether it was trusted — so "did the button get clicked" becomes a
      // measurement instead of an assumption. Installed once per page.
      "  if(!window.__copyProbe){" +
      "    window.__copyProbe = { seen: 0, trusted: 0, label: '' };" +
      "    document.addEventListener('click', function(e){" +
      "      const b = e.target && e.target.closest ? e.target.closest('button,[role=\"button\"]') : null;" +
      "      if(b && isCopy(b)){ window.__copyProbe.seen++; if(e.isTrusted) window.__copyProbe.trusted++; window.__copyProbe.label = (b.getAttribute('aria-label')||'copy'); }" +
      "    }, true);" +
      "  }" +
      // How close a candidate button is to the block: first by how far up the tree
      // their common ancestor sits, then by distance in document order.
      "  const near = (hit, anchor, order) => {" +
      "    const anc = new Set(); let n = hit;" +
      "    while(n){ anc.add(n); n = n.parentElement; }" +
      "    let up = 0; n = anchor;" +
      "    while(n){ if(anc.has(n)) break; n = n.parentElement; up++; }" +
      "    return up * 10000 + Math.abs(order.indexOf(hit) - order.indexOf(anchor));" +
      "  };" +
      // Walk out from the block one ancestor at a time, stopping at the first level
      // holding a copy control. No depth cap — copy-diag.log showed the live page
      // keeps the button beyond 20 ancestors, which is what defeated the earlier
      // 8- and 15-level walks. When a level holds several, take the one nearest the
      // block; plain document order would hand back the PROMPT's Copy button, which
      // sits above the reply and carries the wrong text.
      "  const findCopyBtn = (start) => {" +
      "    if(!start) return { btn: null, level: -1, hits: 0 };" +
      "    const order = Array.from(document.querySelectorAll('*'));" +
      "    let node = start, level = 0;" +
      "    while(node && node !== document.documentElement){" +
      "      const hits = Array.from(node.querySelectorAll('button,[role=\"button\"]')).filter(isCopy);" +
      "      if(hits.length){ hits.sort((a,b) => near(a,start,order) - near(b,start,order)); return { btn: hits[0], level: level, hits: hits.length }; }" +
      "      node = node.parentElement; level++;" +
      "    }" +
      "    return { btn: null, level: -1, hits: 0 };" +
      "  };" +
      // Where to aim a real mouse click: the button's centre in the guest's own
      // viewport. elementFromPoint confirms the button is the topmost thing at that
      // point — a sticky header or overlay sitting on it would otherwise swallow
      // the click with nothing to show for it.
      "  const aimAt = async (btn) => {" +
      "    if(!btn) return null;" +
      "    try{ btn.scrollIntoView({block:'center', inline:'nearest'}); }catch(e){}" +
      "    await sleep(250);" +
      "    const r = btn.getBoundingClientRect();" +
      "    if(!r.width || !r.height) return { covered: true, reason: 'zero-size' };" +
      "    const x = Math.round(r.left + r.width/2), y = Math.round(r.top + r.height/2);" +
      "    const top = document.elementFromPoint(x, y);" +
      "    const covered = !(top && (top === btn || btn.contains(top) || (top.closest && top.closest('button,[role=\"button\"]') === btn)));" +
      "    return { x: x, y: y, w: Math.round(r.width), h: Math.round(r.height)," +
      "      inView: x > 0 && y > 0 && x < (window.innerWidth||0) && y < (window.innerHeight||0)," +
      // className on an SVG element is an SVGAnimatedString, not a string.
      "      covered: covered, topmost: top ? label(top) : 'none' };" +
      "  };" +
      // Tells the REPLY from the prompt echoed above it. Both carry this run's
      // request_id — the prompt is JSON too — so the id alone proves nothing. Only
      // the reply is building a "resume" object, and that key appears near the top
      // of it, so it is visible long before the block is complete.
      "  const looksLikeReply = (t) => !!t && t.indexOf(reqId) > -1 && t.indexOf('\"resume\"') > -1;" +
      "  const replyBlock = () => { let hit = null; for(const c of blocks()){ if(looksLikeReply(c.textContent||'')) hit = c; } return hit; };" +
      // Everything the caller needs to click the button, attached to a diag object.
      "  const addButton = async (d) => {" +
      // Anchor on the reply's block; only if there is none fall back to any block
      // carrying the id, so a click can never be aimed at the prompt's Copy button.
      "    let anchor = replyBlock();" +
      "    if(!anchor){ for(const c of blocks()){ if((c.textContent||'').indexOf(reqId) > -1) anchor = c; } }" +
      "    const r = findCopyBtn(anchor);" +
      "    window.__copyBtn = r.btn;" + // kept for the synthetic fallback click
      "    d.anchor = anchor ? label(anchor) : 'NONE';" +
      "    d.level = r.level; d.candidates = r.hits;" +
      "    d.button = r.btn ? String(r.btn.getAttribute('aria-label') || r.btn.getAttribute('data-testid') || 'unlabelled').slice(0,40) : 'NONE';" +
      "    d.copyButtonsInPage = Array.from(document.querySelectorAll('button,[role=\"button\"]')).filter(isCopy).length;" +
      "    d.aim = await aimAt(r.btn);" +
      "    return d;" +
      "  };" +
      // Still writing? While a reply streams, ChatGPT shows a stop control in place
      // of send. Nothing is decided until that goes away.
      "  const streaming = () => !!document.querySelector('button[data-testid=\"stop-button\"],button[aria-label*=\"Stop\"],button[aria-label*=\"stop\"]');" +
      "  const deadline = Date.now() + " + Math.max(5000, Number(budgetMs) || 0) + ";" +
      // Six unchanged polls — 2.4s — before calling the reply settled. A reasoning
      // model pauses mid-answer for well over a second, and the old 1.2s window
      // treated those pauses as "finished".
      "  const SETTLE = 6;" +
      "  let idOnPage = false, lastChars = -1, settled = 0;" +
      "  while (Date.now() < deadline) {" +
      // Take the LAST block that yields a valid object: the prompt echoed above
      // carries the same id, and it comes first in document order.
      "    let text = null, from = '';" +
      "    for(const c of blocks()){ const t = findJson(c.textContent||''); if(t){ text = t; from = label(c); } }" +
      // Nothing in a code container — the reply may be rendered as plain text.
      "    if(!text){ const t = findJson(pageText()); if(t){ text = t; from = 'body.innerText'; } }" +
      "    const pt = pageText();" +
      "    if(!idOnPage) idOnPage = pt.indexOf(reqId) > -1;" +
      "    if(pt.length === lastChars) settled++; else { settled = 0; lastChars = pt.length; }" +
      // Complete, verified object straight out of the DOM — the fast path.
      "    if(text){" +
      "      const d = await addButton(facts()); d.source = from; d.chars = text.length;" +
      "      return JSON.stringify({ text: text, diag: d });" +
      "    }" +
      // The REPLY is on the page, has stopped changing, and still will not parse.
      // That is the CodeMirror case: only the lines currently scrolled into view
      // exist in the DOM, so a long block can never be read whole from it. Its
      // Copy button reads the editor's own state, which does hold all of it — so
      // stop scanning and ask the caller to click.
      //
      // Gated on the reply specifically, not on the id: the prompt above carries
      // the id from the moment it is sent, and a slow answer would otherwise be
      // declared "settled" while the page still showed nothing but the prompt.
      "    if(replyBlock() && settled >= SETTLE && !streaming()){" +
      "      const d = await addButton(facts());" +
      "      d.reason = 'dom-text-incomplete'; d.idOnPage = true; d.settled = settled;" +
      "      return JSON.stringify({ text: '', needsCopy: true, diag: d });" +
      "    }" +
      "    await sleep(400);" +
      "  }" +
      // Ran out of time. idOnPage false means the reply never arrived at all;
      // true means it arrived but never settled — still streaming, or the page
      // kept changing under us.
      "  const d = facts(); d.reason = 'no-reply-before-deadline'; d.idOnPage = idOnPage; d.replyOnPage = !!replyBlock(); d.streaming = streaming();" +
      "  return JSON.stringify({ text: '', diag: d });" +
      "})();";
    // The page returns { text, needsCopy, diag }. Tolerate a bare string in case
    // an older script is somehow still resident.
    let raw = "";
    try { raw = await wv.executeJavaScript(js, true); } catch (_) {}
    if (raw && typeof raw === "string" && raw.trim()) {
      try {
        const env = JSON.parse(raw);
        if (env && typeof env === "object" && typeof env.text === "string") {
          return { text: env.text, needsCopy: !!env.needsCopy, diag: env.diag || null };
        }
        return { text: raw, diag: null };
      } catch (_) { return { text: raw, diag: null }; }
    }
    return { text: "", diag: null };
  };

  // Pull the reply out of arbitrary clipboard text: same balanced-brace scan the
  // page does, so ChatGPT's own copy (fenced, with prose around it) is accepted
  // only when it really is this run's complete reply.
  const extractReply = (raw, reqId) => {
    const s = String(raw || "");
    const at = s.indexOf(String(reqId));
    if (at < 0) return "";
    for (let start = s.lastIndexOf("{", at); start >= 0; start = s.lastIndexOf("{", start - 1)) {
      let depth = 0, inStr = false, esc = false;
      for (let p = start; p < s.length; p++) {
        const ch = s[p];
        if (esc) { esc = false; continue; }
        if (ch === "\\") { esc = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === "{") depth++;
        else if (ch === "}") {
          if (--depth === 0) {
            const cand = s.slice(start, p + 1);
            try {
              const o = JSON.parse(cand);
              if (o && String(o.request_id || "") === String(reqId) && o.resume && typeof o.resume === "object") return cand;
            } catch (_) {}
            break;
          }
        }
      }
      if (start === 0) break;
    }
    return "";
  };

  // Watch for the reply and get it onto the clipboard, by whichever route works.
  //
  // Two routes, because either can fail alone. Reading the text out of the DOM is
  // exact but incomplete — CodeMirror keeps only the visible lines, so a long
  // block never appears whole. ChatGPT's Copy button has the whole thing but is
  // driven through the browser and can refuse. So: scan; if the text won't
  // assemble, click Copy for real and read the clipboard back; repeat with the
  // time that's left.
  const autoCopyReply = async (reqId) => {
    const wv = webviewRef.current;
    if (!wv || !reqId) return;
    const deadline = Date.now() + 15 * 60 * 1000;
    // A generous ceiling, not a schedule: the backoff below spaces these out, so
    // a slow answer cannot burn through them while it is still being written.
    const MAX_CLICKS = 15;
    let text = "";
    let diag = null;
    let clicks = 0;

    while (Date.now() < deadline) {
      const left = deadline - Date.now();
      const res = await scanForReply(reqId, Math.min(left, 3 * 60 * 1000));
      if (res.diag) diag = res.diag;
      if (res.text && res.text.trim()) { text = res.text; break; }
      // Scan ran out its budget without the reply settling — try again if the
      // overall deadline allows, otherwise give up. The pause matters: a scan that
      // fails immediately (no WebView) would otherwise spin.
      if (!res.needsCopy) {
        if (Date.now() >= deadline) break;
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }

      // Out of click attempts, but NOT out of time: keep scanning to the deadline
      // rather than ending the run. Breaking here is what turned a slow reply into
      // a failed one — the attempts were spent in the first few seconds.
      if (clicks >= MAX_CLICKS) {
        if (diag) diag.reason = "copy-attempts-exhausted";
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      clicks++;
      // The DOM can't give us the text — click ChatGPT's own Copy button and read
      // back what it put on the clipboard.
      try {
        const click = await clickCopyButton(diag);
        if (diag) { diag.click = click; diag.attempt = clicks; }
      } catch (e) {
        if (diag) diag.click = { attempted: false, reason: (e && e.message) || String(e) };
      }
      let clip = "";
      try { const r = await api().clipboardRead(); clip = (r && r.text) || ""; } catch (_) {}
      const fromClip = extractReply(clip, reqId);
      if (diag) diag.clipboardYieldedReply = !!fromClip;
      logCopyDiag(diag);
      if (fromClip) { text = fromClip; diag = { ...diag, source: "copy-button" }; break; }
      // That click produced nothing usable — usually because the answer is still
      // being written. Back off before trying again (3s, 6s, 12s, 24s, 48s, then
      // once a minute) instead of hammering the button and running out of tries
      // long before a slow reply lands.
      await new Promise((r) => setTimeout(r, Math.min(60000, 3000 * Math.pow(2, clicks - 1))));
    }

    if (text && text.trim()) {
      // The DOM gave up the text without needing the button. Click it anyway —
      // it is what marks the reply as taken in the ChatGPT tab, and the recorded
      // outcome is how we know the click works at all on the live page.
      if (!clicks && diag) {
        try { diag.click = await clickCopyButton(diag); }
        catch (e) { diag.click = { attempted: false, reason: (e && e.message) || String(e) }; }
      }
      // Whatever route produced it, put the canonical JSON on the clipboard from
      // the main process — where neither the page's clipboard permission nor
      // whether the WebView is focused can interfere — for the reply watcher.
      try { await api().clipboardWrite(text); } catch (_) {}
      // In-app only — the single system notification for a run is the one that
      // fires when the PDF itself is finished.
      toast("Resume content is ready — generating the resume now.", "success");
      logCopyDiag(diag);
    } else {
      logCopyDiag(diag || { reason: "script-did-not-return" });
      // Say so rather than leaving "Waiting for your ChatGPT reply…" on screen
      // with no explanation — the user can still finish by copying by hand.
      toast("Couldn't read the reply — select the JSON block in the ChatGPT tab and copy it (Ctrl+C).", "warning");
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
        // Select the high-reasoning model BEFORE the prompt goes in — switching
        // afterwards would not affect a message already sent. Best-effort: if the
        // picker can't be driven, send anyway on whatever model is selected.
        try { await setReasoningHigh(); } catch (_) {}
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
      const why = (e.errorDescription || "").trim() || `error ${e.errorCode}`;
      // A proxied load that fails is almost always the proxy IP being refused
      // (ChatGPT sits behind Cloudflare). Fall back to the local IP once — but
      // SAY so, because silently ignoring the Connection choice is worse than
      // the failure itself.
      if (!chatRetriedRef.current && connModeRef.current === "proxy") {
        chatRetriedRef.current = true;
        try { await api().chatgptSessionDirect(); } catch (_) {}
        toast(
          `The proxy couldn't reach ChatGPT (${why}). Loading on your local IP instead — the resume itself still uses your Connection setting.`,
          "warning"
        );
        loadWebview(lastChatUrlRef.current || "https://chatgpt.com/");
        return;
      }
      toast(
        `Couldn't load ChatGPT (${why}). Test the proxy in Settings → Proxy, or switch Connection to Local IP.`,
        "danger"
      );
      signalChatReady(); // give up quietly — never leave the startup overlay hanging
    };
    // A good load re-arms the retry, so a later failure is handled too instead
    // of the one-shot guard staying latched for the rest of the session.
    const onLoaded = () => {
      chatRetriedRef.current = false;
      // about:blank is the webview's placeholder src — the tab isn't really up
      // until a real page has loaded.
      let cur = "";
      try { cur = wv.getURL() || ""; } catch (_) {}
      if (cur && cur !== "about:blank") signalChatReady();
    };
    // The first load may already have finished before this effect re-ran (the
    // user-agent arrives asynchronously and re-binds these listeners).
    try {
      const cur = wv.getURL() || "";
      if (!wv.isLoading() && cur && cur !== "about:blank") signalChatReady();
    } catch (_) {}
    wv.addEventListener("dom-ready", onReady);
    wv.addEventListener("did-fail-load", onFail);
    wv.addEventListener("did-finish-load", onLoaded);
    return () => {
      try { wv.removeEventListener("dom-ready", onReady); } catch (_) {}
      try { wv.removeEventListener("did-fail-load", onFail); } catch (_) {}
      try { wv.removeEventListener("did-finish-load", onLoaded); } catch (_) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isV2, chatUa]);

  // The app-wide connection: this computer's IP (direct) or a chosen proxy.
  // Whichever is picked is what the AI requests, the ChatGPT browser and the
  // job-post reader all use. API requests switch immediately; an already-open
  // browser window keeps its connection until it is reopened.
  const refreshConn = async () => {
    try { setConnStatus(await api().getConnectionStatus()); } catch (_) {}
  };
  const chooseConnMode = async (mode) => {
    setConnMode(mode);
    connModeRef.current = mode;
    await api().setPref("chat_conn_mode", mode);
    // Default the proxy selection to the active one the first time Proxy is picked.
    if (mode === "proxy" && !chatProxyId && proxyList.length) {
      const active = proxyList.find((p) => p.is_active) || proxyList[0];
      const id = String(active.id);
      setChatProxyId(id);
      await api().setPref("chat_proxy_id", id);
    }
    // Re-apply to the browser session too: a previous failure may have forced it
    // to the local IP, and picking a connection again should restore the choice.
    chatRetriedRef.current = false;
    try { await api().chatgptSessionInfo(); } catch (_) {}
    refreshConn();
  };
  const chooseChatProxy = async (id) => {
    setChatProxyId(id);
    await api().setPref("chat_proxy_id", id);
    chatRetriedRef.current = false;
    try { await api().chatgptSessionInfo(); } catch (_) {}
    refreshConn();
  };
  const proxyLabel = (p) =>
    (p.name && p.name.trim()) || [p.url, p.port].filter(Boolean).join(":") || `Proxy ${p.id}`;

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
  // Flag the form as taken. Every Copy Location button routes through this, so
  // the border appears whichever one was used.
  const markLocationCopied = () => {
    setLocationCopied(true);
    api().setPref("gen_location_copied", "1");
  };
  const copyLocation = () => {
    copyFolderToClipboard(savedPath);
    setView("generate");
    markLocationCopied();
    toast("Folder path copied to clipboard.", "success");
  };
  // Copy one contact value; the modal stays open so several can be taken.
  const copyField = async (field, value) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(String(value));
      setCopiedField(field);
      setTimeout(() => setCopiedField(""), 1500);
    } catch (_) {}
  };

  // Copying is the last thing you'd do here: close the modal and land back on
  // Generate Resume, ready for the next job.
  const copySavedLocation = () => {
    copyFolderToClipboard(savedPath);
    toast("Folder path copied to clipboard.", "success");
    setShowSaved(false);
    setView("generate");
    markLocationCopied();
  };

  const copy = () => navigator.clipboard.writeText(result);

  return (
    <div>
    {/* The green outline marks a resume whose location has been copied — one
        already taken away to file an application. It encloses BOTH panels, the
        styles and the form, and the next Generate Resume clears it. */}
    <div className={"resume-layout" + (locationCopied ? " location-copied" : "")}>
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
          {/* Driven by the remembered target rather than the in-memory resume
              text, so it's still here after the app is closed and reopened. */}
          {(result || jobRole || jobCompany || savedPath) && (
            <button
              type="button"
              className="resume-tab"
              onClick={() => setShowInfo(true)}
              // Mid-generation the target job is still the previous one, so the
              // modal would show stale details. Off limits until it settles.
              disabled={loading || v2Waiting}
              title={
                loading || v2Waiting
                  ? "Available once the resume has finished generating"
                  : "Show this account's personal info and the target job"
              }
            >
              View info
            </button>
          )}
          <span className="resume-tabs-spacer" />
          {/* What every request on this tab actually goes out on. */}
          <span
            className="field-label"
            style={{ margin: 0 }}
            title={
              connMode === "proxy"
                ? connStatus && connStatus.proxy
                  ? `Routing through ${connStatus.proxy.name || [connStatus.proxy.url, connStatus.proxy.port].filter(Boolean).join(":")}`
                  : "Proxy selected, but none is available"
                : "Using this computer's IP"
            }
          >
            Connection{" "}
            {connMode === "proxy" ? (
              connStatus && connStatus.ok === false ? (
                <span className="badge off badge-gap">proxy missing</span>
              ) : (
                <span className="badge live badge-gap">proxy</span>
              )
            ) : (
              <span className="badge live badge-gap">local IP</span>
            )}
          </span>
        </div>

        {view === "generate" && (
        <>
        {isV3 && (
          <div className="jobpost-box">
            <label className="field" style={{ margin: 0 }}>
              <span className="field-label field-label-row">
                Job Post Link
                <span className="muted small">paste the URL — we read the page and extract the job</span>
              </span>
              <div className="jobpost-row">
                <input
                  className="input"
                  type="url"
                  placeholder="https://…  (the job posting page)"
                  value={jobLink}
                  onChange={(e) => { setJobLink(e.target.value); api().setPref("gen_job_link", e.target.value); clearExtractedDetails(e.target.value); }}
                  onKeyDown={(e) => { if (e.key === "Enter" && !fetchingJd) fetchJobFromLink(); }}
                />
                <button
                  className="btn primary"
                  onClick={fetchJobFromLink}
                  disabled={fetchingJd || !jobLink.trim()}
                >
                  {fetchingJd ? "Reading…" : "Extract"}
                </button>
              </div>
            </label>
            {jobMeta && (
              <div className="jobpost-meta">
                {[
                  ["Role", jobMeta.role],
                  ["Company", jobMeta.company],
                  ["Country", jobMeta.country],
                  ["Location", jobMeta.location],
                  ["Salary", jobMeta.salaryRange],
                  ["Industry", jobMeta.industry],
                  ["Type", jobMeta.employmentType],
                ].filter(([, v]) => v).map(([k, v]) => (
                  <span key={k} className="jobpost-chip"><b>{k}:</b> {v}</span>
                ))}
                {jobMeta.source && !jobMeta.usedRaw && (
                  <span className="jobpost-chip" title="How the posting was read">
                    <b>Source:</b> {jobMeta.source === "structured" ? "structured data" : jobMeta.source === "ai" ? "AI-read" : jobMeta.source}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
        {isV2 && !isV3 && (
          <label className="field">
            <span className="field-label field-label-row">
              Job Link
              <span className="muted small">optional · saved with the application to reopen later</span>
            </span>
            <input
              className="input"
              type="url"
              placeholder="https://…  (the job posting URL)"
              value={jobLink}
              onChange={(e) => { setJobLink(e.target.value); api().setPref("gen_job_link", e.target.value); }}
            />
          </label>
        )}
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

          {/* One connection for everything: the AI requests, the ChatGPT
              browser and the job-post reader all follow this choice. */}
          <div className="field">
              <span className="field-label field-label-row">
                Connection
                <span className="muted small">
                  {connMode === "proxy" ? "Routing through a proxy" : "Using this computer's IP"}
                  {isV2 ? " · AI requests switch now, the browser on its next open" : " · used for every request"}
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
        </div>

        <label className="field jd-field">
          <span className="field-label">Job Description <span className="req">(required)</span></span>
          <textarea
            className="textarea"
            rows={14}
            placeholder={
              isV3
                ? "Click Extract above to fill this from the job-post link, or paste a description here…"
                : "Paste the target job description here (required)…"
            }
            value={jd}
            onChange={(e) => {
              const v = e.target.value;
              setJd(v);
              api().setPref(JD_PREF, v);
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
            {prefsReady && isV3 && (
            <label className="toggle" title="When ON, the resume is generated automatically as soon as the job post is extracted — no need to click Generate Resume.">
              <input
                type="checkbox"
                checked={v3AutoGen}
                onChange={(e) => { setV3AutoGen(e.target.checked); api().setPref("v3_auto_generate", e.target.checked ? "1" : "0"); }}
              />
              <span className="toggle-track"><span className="toggle-thumb" /></span>
              <span className="toggle-label">Auto-generate after Extract</span>
            </label>
            )}
            {prefsReady && !isV3 && (<>
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
            {/* Applies to every generator, so it sits outside the V1/V2-only group. */}
            {prefsReady && (
            <label className="toggle" title="When ON, the saved PDF opens in your default viewer as soon as it is generated.">
              <input
                type="checkbox"
                checked={autoOpenPdf}
                onChange={(e) => { setAutoOpenPdf(e.target.checked); api().setPref("auto_open_pdf", e.target.checked ? "1" : "0"); }}
              />
              <span className="toggle-track"><span className="toggle-thumb" /></span>
              <span className="toggle-label">Open PDF after generate</span>
            </label>
            )}
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

    {/* Opens itself as soon as a resume is saved: what was generated, where it
        went, and the actions you'd reach for next. */}
    {showSaved && (
      <div className="modal-overlay" onClick={() => setShowSaved(false)}>
        <div className="modal modal-saved" onClick={(e) => e.stopPropagation()}>
          {/* No Close in the corner — the actions at the bottom carry one. */}
          <div className="card-head">
            <h2>Resume saved</h2>
          </div>

          <div className="info-section">Target Job</div>
          <div className="info-grid">
            <div className="info-k">Company</div><div className="info-v">{jobCompany || "—"}</div>
            <div className="info-k">Job Title</div><div className="info-v">{jobRole || "—"}</div>
            <div className="info-k">Country</div><div className="info-v">{jobCountry || "—"}</div>
          </div>

          {/* The details you retype into an application form, with the two
              awkward ones a click away. */}
          <div className="info-section">Account Info</div>
          <div className="info-grid">
            <div className="info-k">Name</div>
            <div className="info-v">{(acctInfo && acctInfo.name) || "—"}</div>
            <div className="info-k">Email</div>
            <div className="info-v copy-row">
              <span className="copy-text">{(acctInfo && acctInfo.email) || "—"}</span>
              {acctInfo && acctInfo.email ? (
                <CopyButton value={acctInfo.email} label="email" done={copiedField === "email"}
                  onCopy={() => copyField("email", acctInfo.email)} />
              ) : null}
            </div>
            <div className="info-k">LinkedIn</div>
            <div className="info-v copy-row">
              <span className="copy-text">{(acctInfo && acctInfo.linkedin) || "—"}</span>
              {acctInfo && acctInfo.linkedin ? (
                <CopyButton value={acctInfo.linkedin} label="LinkedIn" done={copiedField === "linkedin"}
                  onCopy={() => copyField("linkedin", acctInfo.linkedin)} />
              ) : null}
            </div>
            <div className="info-k">Phone</div>
            <div className="info-v">{(acctInfo && acctInfo.phone) || "—"}</div>
          </div>

          <div className="info-section">File</div>
          <div className="info-grid">
            <div className="info-k">Saved</div><div className="info-v">{savedAt || "—"}</div>
            <div className="info-k">Location</div>
            <div className="info-v saved-path">{savedPath || "—"}</div>
          </div>

          <div className="modal-actions saved-actions">
            <button className="btn" onClick={openFolder} disabled={!savedPath}>Open Folder</button>
            <button className="btn" onClick={openFile} disabled={!savedPath}>Open File</button>
            <button className="btn" onClick={copySavedLocation} disabled={!savedPath}>
              {copied ? "Copied ✓" : "Copy Location"}
            </button>
            <button className="btn primary" onClick={() => setShowSaved(false)}>Close</button>
          </div>
        </div>
      </div>
    )}

    {showInfo && (
      <div className="modal-overlay" onClick={() => setShowInfo(false)}>
        <div className="modal modal-info" onClick={(e) => e.stopPropagation()}>
          {/* Actions live at the bottom right, not in the corner. */}
          <div className="card-head">
            <h2>View info</h2>
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
              <div className="info-k">Email</div>
              <div className="info-v copy-row">
                <span className="copy-text">{acctInfo.email || "—"}</span>
                {acctInfo.email ? (
                  <CopyButton label="email" done={copiedField === "info-email"}
                    onCopy={() => copyField("info-email", acctInfo.email)} />
                ) : null}
              </div>
              <div className="info-k">Phone</div><div className="info-v">{acctInfo.phone || "—"}</div>
              <div className="info-k">Address</div><div className="info-v">{acctInfo.address || "—"}</div>
              <div className="info-k">Country</div><div className="info-v">{acctInfo.country || "—"}</div>
              <div className="info-k">LinkedIn</div>
              <div className="info-v copy-row">
                <span className="copy-text">{acctInfo.linkedin || "—"}</span>
                {acctInfo.linkedin ? (
                  <CopyButton label="LinkedIn" done={copiedField === "info-linkedin"}
                    onCopy={() => copyField("info-linkedin", acctInfo.linkedin)} />
                ) : null}
              </div>
              <div className="info-k">Portfolio</div><div className="info-v">{acctInfo.portfolio || "—"}</div>
            </div>
          ) : (
            <p className="muted">Select an account to see its details.</p>
          )}

          <div className="modal-actions">
            <button
              className="btn"
              onClick={() => { copySavedLocation(); setShowInfo(false); }}
              disabled={!savedPath}
              title={savedPath || "Generate a resume first"}
            >
              Copy Location
            </button>
            <button className="btn primary" onClick={() => setShowInfo(false)}>Close</button>
          </div>
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
