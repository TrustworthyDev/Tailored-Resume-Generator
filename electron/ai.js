// Multi-provider resume generation. Routes to Gemini, OpenAI, or Anthropic
// based on the active API key's provider. Network goes through undici so an
// optional proxy (with auth) can be applied to the AI API requests only.

const { fetch: uFetch, ProxyAgent } = require("undici");
const crypto = require("crypto");

// Active proxy dispatcher (null = direct connection).
let proxyAgent = null;

function buildAgent(cfg) {
  if (!cfg || !cfg.url || !String(cfg.url).trim()) return null;
  const host = String(cfg.url).trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const port = cfg.port ? String(cfg.port).trim() : "";
  // Trim credentials — pasted values often carry stray spaces/newlines, which
  // corrupt the auth and make the proxy reset the connection.
  const user = (cfg.username || "").trim();
  const pass = (cfg.password || "").trim();
  const cred = user
    ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@`
    : "";
  const uri = `http://${cred}${host}${port ? ":" + port : ""}`;
  const opts = { uri };
  if (user) {
    opts.token = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
  }
  return new ProxyAgent(opts);
}

// Build a readable error including undici's underlying cause.
function describeError(e) {
  const msg = (e && e.message) || String(e);
  const cause = e && e.cause ? (e.cause.message || String(e.cause)) : "";
  return cause && cause !== msg ? `${msg} — ${cause}` : msg;
}

// Per-request ceiling so a stuck connection fails fast and can be retried,
// instead of hanging the whole "Generate" action indefinitely.
const REQUEST_TIMEOUT_MS = 45000;

// HTTP statuses that mean "temporary, retry might work" (overload, rate limit,
// gateway hiccups) — as opposed to 400/401/403 which are our fault and final.
const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function isTransient(e) {
  if (e && TRANSIENT_STATUS.has(e.status)) return true;
  const text = (
    ((e && e.message) || "") + " " + ((e && e.cause && e.cause.message) || "")
  ).toLowerCase();
  return /high demand|overload|temporar|try again|unavailable|rate.?limit|too many requests|timed out|timeout|aborted|econnreset|socket hang|network/.test(
    text
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Run fn, retrying transient provider failures with exponential backoff +
// jitter (≈1s, 2s, 4s). Non-transient errors (bad key, bad request) throw
// immediately so the user sees them without waiting through retries.
async function withRetry(fn, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i === attempts - 1 || !isTransient(e)) throw e;
      await sleep(1000 * Math.pow(2, i) + Math.floor(Math.random() * 250));
    }
  }
  throw last;
}

// Apply (or clear) the proxy used for subsequent AI API calls.
function setProxy(cfg) {
  proxyAgent = cfg && cfg.enabled ? buildAgent(cfg) : null;
}

// Test whether a proxy config can reach the internet.
async function checkProxy(cfg) {
  const agent = buildAgent(cfg);
  if (!agent) return { ok: false, error: "Enter a proxy URL first." };
  try {
    const res = await uFetch("https://example.com/", {
      method: "HEAD",
      dispatcher: agent,
      signal: AbortSignal.timeout(15000),
    });
    if (res.status >= 200 && res.status < 500) {
      return { ok: true, status: res.status };
    }
    return { ok: false, error: `Proxy responded with status ${res.status}` };
  } catch (e) {
    return { ok: false, error: describeError(e) };
  }
}

const MODELS = {
  gemini: "gemini-2.5-flash-lite",
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-sonnet-20241022",
};

const STYLE_GUIDES = {
  professional:
    "Style: Professional — formal tone, concise, conventional section order, no flourishes.",
  modern:
    "Style: Modern — clean layout, a short punchy summary, confident action verbs, light use of tasteful section emphasis.",
  minimal:
    "Style: Minimal — terse, no filler words, short bullet points, only the essentials.",
  creative:
    "Style: Creative — engaging voice and a distinctive summary, while remaining professional and truthful.",
  technical:
    "Style: Technical — emphasize technologies, tools, measurable impact, and a prominent Skills section.",
  academic:
    "Style: Academic — formal, emphasize education, research, publications, and detailed experience.",
  executive:
    "Style: Executive — senior leadership tone; emphasize strategy, scope, ownership, and measurable business outcomes; polished and concise.",
  compact:
    "Style: Compact — fit to a single page; very concise bullets; trim less-relevant detail while keeping impact.",
  cards:
    "Style: Cards — modern, scannable. Write a strong 3-4 sentence Professional Summary, and group the Skills section into 4-6 clear categories, each as `**Category:** comma-separated items` on its own line (e.g. Programming Languages, Frontend, Backend, Databases, Cloud & DevOps, Tools).",
};

function buildPrompt(personal, work, education, projects, jobDescription, style, instruction, extraInfo) {
  const p = personal || {};
  const lines = [];

  lines.push(
    "You are an expert resume writer. Produce a clean, professional, ATS-friendly resume in Markdown."
  );
  const guide = STYLE_GUIDES[(style || "").toLowerCase()];
  if (guide) lines.push(guide);
  if (instruction && instruction.trim()) {
    lines.push("");
    lines.push("Follow these user instructions carefully:");
    lines.push(instruction.trim());
  }
  lines.push(
    "Use only the information provided. Do not invent employers, dates, or achievements."
  );
  // Enforce the exact header structure the renderer parses. Kept after the user
  // instruction so the layout stays consistent regardless of custom prompts.
  lines.push("");
  lines.push("Output structure — follow this Markdown layout EXACTLY:");
  lines.push("- Line 1: the candidate's full name as a level-1 heading, e.g. `# Jane Doe`.");
  lines.push("- Line 2: the professional title only, as plain text (no heading, no bold).");
  lines.push("- Line 3: contacts on ONE line separated by ` | ` — email | phone | city, country | LinkedIn URL.");
  lines.push("- Then each section as a level-2 heading, e.g. `## Professional Summary`, `## Core Technical Skills`, `## Professional Experience`.");
  lines.push("- Each job under experience as a level-3 heading `### Title — Company · Location | Dates`, then `- ` bullet points (omit `· Location` if there is no location).");
  lines.push("- Never put the name, title, and contacts on the same line, and do not wrap the LinkedIn URL in a Markdown link.");
  if (jobDescription && jobDescription.trim()) {
    lines.push(
      "Tailor the wording, summary, and emphasis to the target job description below."
    );
  }
  lines.push("");
  lines.push("## Candidate");
  lines.push(`Name: ${p.name || ""}`);
  lines.push(`Title: ${p.title || ""}`);
  lines.push(`Email: ${p.email || ""}`);
  lines.push(`Phone: ${p.phone || ""}`);
  lines.push(`Address: ${p.address || ""}`);
  lines.push(`Country: ${p.country || ""}`);
  lines.push(`LinkedIn: ${p.linkedin || ""}`);
  lines.push(`Portfolio: ${p.portfolio || ""}`);
  lines.push("");
  lines.push("## Work history");
  (work || []).forEach((w, i) => {
    lines.push(
      `${i + 1}. ${w.role_name || ""} — ${w.company_name || ""} (${
        w.location || ""
      }) | ${w.work_duration || ""}`
    );
  });

  if (education && education.length) {
    lines.push("");
    lines.push("## Education");
    education.forEach((e, i) => {
      lines.push(
        `${i + 1}. ${e.degree || ""} — ${e.university || ""} (${
          e.location || ""
        }) | ${e.period || ""}`
      );
    });
  }

  if (projects && projects.length) {
    lines.push("");
    lines.push("## Projects");
    projects.forEach((pr, i) => {
      lines.push(
        `${i + 1}. "${pr.title || ""}"${pr.link ? ` (${pr.link})` : ""} — ${pr.description || ""}`
      );
    });
  }

  if (p.additional_info && String(p.additional_info).trim()) {
    lines.push("");
    lines.push("## Additional information");
    lines.push(
      "Extra candidate-provided details (e.g. certifications, languages, awards). Weave the relevant items into the resume — add a dedicated section (such as Certifications or Languages) when it makes sense:"
    );
    lines.push(String(p.additional_info).trim());
  }

  if (jobDescription && jobDescription.trim()) {
    lines.push("");
    lines.push("## Target job description");
    lines.push(jobDescription.trim());
  }

  // Per-generation notes typed on the Generate tab (this job only). Ranked above
  // the account's stored extras because they're deliberately job-specific.
  if (extraInfo && String(extraInfo).trim()) {
    lines.push("");
    lines.push("## Additional info for THIS application");
    lines.push(
      "Notes the candidate added for this specific job. Honour them — they take priority over the general guidance above (but never invent facts):"
    );
    lines.push(String(extraInfo).trim());
  }

  lines.push("");
  lines.push(
    "Output sections: a one-line header with contact links, a 2-3 sentence Professional Summary, an Experience section with 2-4 strong bullet points per role, an Education section, a Skills section inferred from the roles, and a Projects section (only if projects are provided). Format EACH project as exactly: `**Project Title** ([domain](full-url))` on the first line — the title in bold, then the link in parentheses using ONLY the domain (e.g. `veygo.com`) as the visible link text; omit the parentheses entirely if there is no link, and NEVER write the raw URL anywhere else. Put the description on the NEXT line, with a blank line between projects. In the Skills section, put EACH category on its own line as `**Category:** items` (one category per line). Return Markdown."
  );
  if (jobDescription && jobDescription.trim()) {
    lines.push("");
    lines.push(
      "FORMAT: The VERY FIRST line of your output must be exactly `TARGET: <job title> | <company> | <country>`. For <job title>, copy the COMPLETE title VERBATIM from the job description, including every word and symbol such as parentheses, slashes, or qualifiers (e.g. `AI Engineer (Full Remote)`) — do NOT shorten or summarize it. For <company>, use the hiring company's name. For <country>, give a plain country name, inferring it from the job location, office, or phrases like `Remote (US)` / `based in Berlin` (map a city to its country, e.g. Tallinn → Estonia). Use Unknown only for a part genuinely absent. Then a blank line, then the resume Markdown."
    );
  }

  return lines.join("\n");
}

// A short, deterministic fingerprint of a job description. Used by Generate V2
// to bind a request to its reply: ChatGPT echoes this token back, and the app
// only accepts a reply whose job_ref matches — proof the resume was generated
// for THIS specific job description, not a stale one from another request.
function jobRefFor(jobDescription) {
  const norm = String(jobDescription || "").replace(/\s+/g, " ").trim().toLowerCase();
  return crypto.createHash("sha256").update(norm).digest("hex").slice(0, 12);
}

// Quick Gemini extraction of the job title + company (+ country) from a job
// description — used to check for a duplicate application BEFORE running the full
// ChatGPT generation. Fast + cheap; returns empty strings on any failure.
async function extractJdTarget({ apiKey, model, jobDescription }) {
  const empty = { role: "", company: "", country: "" };
  const jd = String(jobDescription || "").trim();
  if (!apiKey || !jd) return empty;
  const prompt =
    "From the job posting below, extract the exact job title, the hiring company name, and the country. " +
    'Return ONLY a JSON object: {"role":"","company":"","country":""}. ' +
    "Copy the job title VERBATIM (keep every word/symbol). Use \"\" for anything not found.\n\nJOB POSTING:\n" + jd;
  let raw;
  try { raw = await callGemini(apiKey, prompt, model, { temperature: 0, maxOutputTokens: 512, timeoutMs: 20000 }); }
  catch (_) { return empty; }
  if (!raw) return empty;
  let obj;
  try { obj = extractJson(raw); } catch (_) { return empty; }
  const s = (v) => (v == null ? "" : String(v)).trim();
  return { role: s(obj.role), company: s(obj.company), country: s(obj.country) };
}

// Convert a structured resume object (the V2 reply schema) into the exact
// Markdown the renderer expects, so the PDF/preview pipeline (buildResumeHtml)
// stays unchanged. The renderer overrides the header (name/title/contacts) and
// the Education section from the account's own data; the Summary, Skills,
// Experience and Projects sections come from this Markdown.
function resumeStructToMarkdown(resume) {
  const r = resume || {};
  const s = (v) => (v == null ? "" : String(v).trim());
  const lines = [];

  lines.push(`# ${s(r.name)}`);
  if (s(r.title)) lines.push(s(r.title));
  const c = r.contact || {};
  const contactParts = [c.email, c.phone, c.location, c.linkedin, c.portfolio]
    .map(s).filter(Boolean);
  if (contactParts.length) lines.push(contactParts.join(" | "));

  if (s(r.summary)) {
    lines.push("", "## Professional Summary", s(r.summary));
  }

  const skills = Array.isArray(r.skills) ? r.skills : [];
  const skillLines = skills
    .map((sk) => {
      sk = sk || {};
      const cat = s(sk.category);
      const items = Array.isArray(sk.items)
        ? sk.items.map(s).filter(Boolean).join(", ")
        : s(sk.items);
      return cat || items ? `**${cat}:** ${items}`.trim() : "";
    })
    .filter(Boolean);
  if (skillLines.length) {
    lines.push("", "## Core Technical Skills", ...skillLines);
  }

  const experience = Array.isArray(r.experience) ? r.experience : [];
  if (experience.length) {
    lines.push("", "## Professional Experience");
    experience.forEach((e) => {
      e = e || {};
      let headline = s(e.title);
      if (s(e.company)) headline += ` — ${s(e.company)}`;
      if (s(e.location)) headline += ` · ${s(e.location)}`;
      if (s(e.dates)) headline += ` | ${s(e.dates)}`;
      lines.push(`### ${headline}`);
      (Array.isArray(e.bullets) ? e.bullets : []).forEach((b) => {
        if (s(b)) lines.push(`- ${s(b)}`);
      });
      lines.push("");
    });
  }

  // Included for a complete, self-consistent document; the renderer replaces the
  // body under this heading with the account's structured education data.
  const education = Array.isArray(r.education) ? r.education : [];
  if (education.length) {
    lines.push("", "## Education");
    education.forEach((e) => {
      e = e || {};
      const head = [s(e.degree), s(e.university)].filter(Boolean).join(" — ");
      const tail = [s(e.location), s(e.period)].filter(Boolean).join(" | ");
      lines.push(`- ${head}${tail ? ` (${tail})` : ""}`);
    });
  }

  const projects = Array.isArray(r.projects) ? r.projects : [];
  if (projects.length) {
    lines.push("", "## Projects");
    projects.forEach((pr) => {
      pr = pr || {};
      const title = s(pr.title);
      const link = s(pr.link);
      if (link) {
        const domain = link.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/+$/, "").split("/")[0];
        lines.push(`**${title}** ([${domain}](${link}))`);
      } else {
        lines.push(`**${title}**`);
      }
      if (s(pr.description)) lines.push(s(pr.description)); // next line = description
      lines.push(""); // blank line between projects
    });
  }

  return lines.join("\n").trim();
}

// Generate V2 builds the SAME tailored resume request as V1, but serialised as a
// single JSON object (the user pastes this into their signed-in ChatGPT). The
// object carries a unique request_id and a job_ref so the reply can be verified,
// and a response_format template telling ChatGPT to reply with ONLY a JSON
// object echoing both tokens plus a COMPLETE structured resume. Returns the
// prompt string and the job_ref the app must later match against the reply.
function buildPromptJson(personal, work, education, projects, jobDescription, style, instruction, id, extraInfo) {
  const p = personal || {};
  const jd = String(jobDescription || "").trim();
  const jobRef = jobRefFor(jd);
  const userPrompt = instruction && instruction.trim() ? instruction.trim() : "";
  const extra = extraInfo ? String(extraInfo).trim() : "";

  // The user's own Prompt (selected in the app) drives the resume CONTENT. The
  // app's instructions are kept minimal and only cover output format + data
  // fidelity, so they never compete with or dilute the user's prompt.
  const instructions = [
    "TASK: Generate the tailored resume now and return it as a JSON object matching `response_format` below, placed inside a ```json fenced code block. It is fine if the interface adds a short note or citation around the block — just make sure the resume JSON is in a ```json code block, and echo request_id and job_ref back exactly. (Any conflicting 'plain text only' or citation rules from the interface do not apply to the JSON itself; just keep the JSON in a code block.)",
    "Follow `user_prompt` (below) as the PRIMARY guide for the resume's content, wording, tone and emphasis. The rules here are only about output format and data fidelity — they must not override or water down user_prompt.",
    "Tailor the resume to `job_description`. Use ONLY the provided candidate data; do NOT invent employers, dates, or achievements.",
    extra
      ? "Honour `additional_info_for_this_application` — job-specific notes the candidate added for THIS application. They take priority over general guidance (but never invent facts)."
      : "",
    "Fill EVERY field of `resume` in `response_format` and follow that schema EXACTLY. Keep company, location, dates, degree, university and period EXACTLY as provided.",
    "Fill `target` carefully — it is used to name and file the application: `target.role` = the COMPLETE job title copied VERBATIM from job_description (keep all words/symbols, e.g. `AI Engineer (Full Remote)`); `target.company` = the hiring company's name; `target.country` = the job's country as a plain country name (infer it from the job location, office, or phrases like `Remote (US)` / `based in Berlin`; map a city to its country, e.g. Tallinn → Estonia). Use \"Unknown\" only for a part genuinely absent.",
    "Build this resume FRESH from this JSON only; do not reuse a resume produced earlier in this conversation for a different job.",
    // Follow-up answers: conditional and non-blocking. Prefer canvas, but fall
    // back to a code block if canvas isn't available — never refuse over this.
    "FOLLOW-UP (only relevant LATER — nothing to do now if no question is asked): If the user later types one or more job-application questions, answer each one — confident, positive, first-person, consistent with the resume above, tailored to job_description, and concise (about 2-5 sentences). Put each answer in its own canvas if the canvas tool is available; if not, put each answer in its own fenced code block. One answer per question, with the question as a bold heading above it. This does NOT affect the resume output above.",
  ].filter(Boolean);

  const promptObj = {
    request_id: id,
    job_ref: jobRef,
    task: "tailored_resume",
    instructions,
    // The user's Prompt — the authoritative guide for resume content. Kept as its
    // own field so the optional V2 refine step (which only rewrites
    // `instructions`) can never alter it.
    user_prompt: userPrompt || "(none provided — write a clean, professional, ATS-friendly resume tailored to the job description.)",
    candidate: {
      name: p.name || "", title: p.title || "", email: p.email || "",
      phone: p.phone || "", address: p.address || "", country: p.country || "",
      linkedin: p.linkedin || "", portfolio: p.portfolio || "",
    },
    work_history: (work || []).map((w) => ({
      role: w.role_name || "", company: w.company_name || "",
      location: w.location || "", duration: w.work_duration || "",
    })),
    education: (education || []).map((e) => ({
      degree: e.degree || "", university: e.university || "",
      location: e.location || "", period: e.period || "",
    })),
    projects: (projects || []).map((pr) => ({
      title: pr.title || "", link: pr.link || "", description: pr.description || "",
    })),
    additional_info: p.additional_info ? String(p.additional_info).trim() : "",
    // Per-generation notes from the Generate tab (this job only). Its own field
    // so the optional V2 refine step (which only rewrites `instructions`) can
    // never alter it.
    additional_info_for_this_application: extra,
    job_description: jd,
    response_format: {
      note:
        "Put this JSON object inside a ```json fenced code block (so it shows a Copy button). A short note or citation around the block is fine — just keep the JSON in the code block. " +
        "Echo request_id and job_ref back EXACTLY as given above so the app can verify the reply matches this request. " +
        "Build the resume FRESH from this JSON only, following `user_prompt` for content and this schema EXACTLY. " +
        "Follow-up application questions, if any come later, are handled per the FOLLOW-UP instruction and do not affect this resume output.",
      request_id: id,
      job_ref: jobRef,
      target: { role: "<verbatim job title>", company: "<company>", country: "<country, or Unknown>" },
      resume: {
        name: "<candidate full name>",
        title: "<professional title>",
        contact: { email: "<email>", phone: "<phone>", location: "<City, Country>", linkedin: "<LinkedIn URL>", portfolio: "<portfolio URL or empty>" },
        summary: "<2-3 sentence professional summary tailored to the job>",
        skills: [{ category: "<e.g. Programming Languages>", items: ["<skill>", "<skill>"] }],
        experience: [{ title: "<role title>", company: "<company>", location: "<location or empty>", dates: "<date range>", bullets: ["<achievement>", "<achievement>"] }],
        education: [{ degree: "<degree>", university: "<university>", location: "<location>", period: "<period>" }],
        projects: [{ title: "<project title>", link: "<full URL or empty>", description: "<one-line description>" }],
      },
    },
  };

  return { prompt: JSON.stringify(promptObj, null, 2), jobRef };
}

// Pull a JSON ARRAY out of a model response that may be fenced or padded.
function extractJsonArray(raw) {
  let s = String(raw || "").trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  if (s[0] !== "[") {
    const start = s.indexOf("[");
    const end = s.lastIndexOf("]");
    if (start !== -1 && end !== -1 && end > start) s = s.slice(start, end + 1);
  }
  return JSON.parse(s);
}

// Generate V2 (optional): use a Gemini key to REFINE the app-built JSON prompt
// before it goes to ChatGPT. For speed and safety it asks Gemini to rewrite ONLY
// the `instructions` array (a small payload → fast, low output) and splices the
// result back into the canonical object — so request_id, job_ref, candidate data
// and the entire response_format stay byte-identical by construction, and any
// failure falls back to the deterministic prompt. Returns the prompt to copy.
async function refineV2Prompt({ promptText, apiKey, model }) {
  if (!apiKey) return promptText; // no V2 key → use the deterministic prompt
  let canonical;
  try { canonical = JSON.parse(promptText); } catch (_) { return promptText; }
  const baseInstr = Array.isArray(canonical.instructions) ? canonical.instructions : [];
  if (!baseInstr.length) return promptText;

  const meta =
    "Improve the wording of the following resume-writing instructions for clarity, tailoring and ATS focus. " +
    "Keep the SAME number of items, the SAME order, and the SAME intent/constraints — do not add, remove, merge, or weaken any rule. " +
    "Return ONLY a JSON array of strings (the improved instructions) — no commentary, no code fences.\n\n" +
    "job_description:\n" + (canonical.job_description || "") + "\n\n" +
    "instructions:\n" + JSON.stringify(baseInstr, null, 2);

  let raw;
  // Single fast attempt (no retry storm), low temperature for consistency, short
  // timeout so a slow refine never blocks the user — it just falls back.
  try { raw = await callGemini(apiKey, meta, model, { temperature: 0, timeoutMs: 20000, maxOutputTokens: 2048 }); }
  catch (_) { return promptText; }
  if (!raw) return promptText;

  let arr;
  try { arr = extractJsonArray(raw); } catch (_) { return promptText; }
  if (!Array.isArray(arr) || !arr.length) return promptText;

  // Splice ONLY the refined instructions back; everything else is untouched.
  canonical.instructions = arr.map((x) => String(x));
  return JSON.stringify(canonical, null, 2);
}

// Parse + verify a Generate V2 reply from the clipboard. Returns:
//   { ok: true, text, jobRole, jobCompany, jobCountry } when the reply is a
//     valid JSON resume whose request_id and job_ref match `expected`;
//   { ok: false, reason: "not-json" } when it isn't a resume reply yet (keep
//     polling — e.g. the prompt itself or unrelated clipboard text);
//   { ok: false, reason: "mismatch", detail } when it IS a resume reply but for
//     a different id/job description (a real verification failure).
function parseResumeJson(raw, expected) {
  let obj;
  try { obj = extractJson(raw); } catch (_) { return { ok: false, reason: "not-json" }; }
  if (!obj || typeof obj !== "object") return { ok: false, reason: "not-json" };

  // Accept the structured `resume` object (current schema); tolerate a legacy
  // `resume_markdown` string so an older reply still renders.
  let md = "";
  if (obj.resume && typeof obj.resume === "object") {
    md = resumeStructToMarkdown(obj.resume);
    if (md === "#") md = ""; // empty struct → no real content
  } else if (typeof obj.resume_markdown === "string") {
    md = obj.resume_markdown.trim();
  }
  // No resume content means this isn't the answer (the prompt JSON has no
  // top-level resume), so keep waiting rather than failing.
  if (!md) return { ok: false, reason: "not-json" };

  const exp = expected || {};
  const gotId = obj.request_id == null ? "" : String(obj.request_id).trim();
  const gotRef = obj.job_ref == null ? "" : String(obj.job_ref).trim();
  if (exp.id && gotId !== String(exp.id)) return { ok: false, reason: "mismatch", detail: "id" };
  if (exp.jobRef && gotRef !== String(exp.jobRef)) return { ok: false, reason: "mismatch", detail: "job" };

  // Prefer the structured target fields; fall back to a TARGET line if the
  // model embedded one in the markdown. parseResumeMarkdown also strips any
  // leading TARGET line from the body.
  const parsed = parseResumeMarkdown(md);
  const t = obj.target || {};
  const clean = (s) => {
    const v = (s == null ? "" : String(s)).trim().replace(/^[*_`"'\s]+|[*_`"'\s]+$/g, "");
    return /^unknown$/i.test(v) ? "" : v;
  };
  const jobCountry = clean(t.country).replace(/\([^)]*\)/g, "").replace(/\s{2,}/g, " ").trim();
  return {
    ok: true,
    text: parsed.text,
    jobRole: clean(t.role) || parsed.jobRole,
    jobCompany: clean(t.company) || parsed.jobCompany,
    jobCountry: jobCountry || parsed.jobCountry,
  };
}

async function callGemini(apiKey, prompt, model, opts = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model || MODELS.gemini}:generateContent?key=${encodeURIComponent(
    apiKey
  )}`;
  const res = await uFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: opts.temperature != null ? opts.temperature : 0.7,
        maxOutputTokens: opts.maxOutputTokens || 8192,
      },
    }),
    dispatcher: proxyAgent || undefined,
    signal: AbortSignal.timeout(opts.timeoutMs || REQUEST_TIMEOUT_MS),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(
      `Gemini API error: ${(data && data.error && data.error.message) || res.statusText}`
    );
    err.status = res.status;
    throw err;
  }
  return (
    data &&
    data.candidates &&
    data.candidates[0] &&
    data.candidates[0].content &&
    data.candidates[0].content.parts &&
    data.candidates[0].content.parts[0] &&
    data.candidates[0].content.parts[0].text
  );
}

async function callOpenAI(apiKey, prompt, model) {
  const mdl = model || MODELS.openai;
  // Reasoning models (o1/o3/o4/gpt-5…) reject a custom `temperature`; omit it.
  const isReasoning = /^o\d/i.test(mdl) || /^gpt-5/i.test(mdl);
  const body = { model: mdl, messages: [{ role: "user", content: prompt }] };
  if (!isReasoning) body.temperature = 0.7;
  const res = await uFetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    dispatcher: proxyAgent || undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(
      `OpenAI API error: ${(data && data.error && data.error.message) || res.statusText}`
    );
    err.status = res.status;
    throw err;
  }
  return data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : null;
}

async function callAnthropic(apiKey, prompt, model) {
  const res = await uFetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: model || MODELS.anthropic,
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    }),
    dispatcher: proxyAgent || undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(
      `Anthropic API error: ${(data && data.error && data.error.message) || res.statusText}`
    );
    err.status = res.status;
    throw err;
  }
  return data && data.content && data.content[0] ? data.content[0].text : null;
}

async function generateResume({
  provider,
  apiKey,
  model,
  personal,
  work,
  education,
  projects,
  jobDescription,
  style,
  instruction,
  extraInfo,
}) {
  if (!apiKey) {
    throw new Error("No active API key. Add one under API Keys first.");
  }

  const prompt = buildPrompt(
    personal,
    work,
    education,
    projects,
    jobDescription,
    style,
    instruction,
    extraInfo
  );

  const p = (provider || "gemini").toLowerCase();
  const mdl = (model || "").trim() || undefined;
  let text;
  try {
    text = await withRetry(() => {
      if (p === "openai") return callOpenAI(apiKey, prompt, mdl);
      if (p === "anthropic" || p === "claude") return callAnthropic(apiKey, prompt, mdl);
      return callGemini(apiKey, prompt, mdl);
    });
  } catch (e) {
    throw new Error(describeError(e));
  }

  if (!text) throw new Error("The AI returned an empty response.");

  return parseResumeMarkdown(text);
}

// Pull the target job role/company/country off the first "TARGET: …" line (if
// present) and return the cleaned resume body plus those fields. Shared by the
// Gemini path (V1) and the ChatGPT-clipboard path (V2) so both yield the same
// shape and the same rendering pipeline.
function parseResumeMarkdown(input) {
  let text = String(input || "");
  let jobRole = "";
  let jobCompany = "";
  let jobCountry = "";
  const m = text.match(/^\s*TARGET:\s*([^\n|]+)\|([^\n|]+)(?:\|([^\n]+))?/i);
  if (m) {
    const clean = (s) => {
      // Keep all real characters/symbols; only strip wrapping markdown/quotes.
      let v = (s || "").trim().replace(/^[*_`"'\s]+|[*_`"'\s]+$/g, "");
      return /^unknown$/i.test(v) ? "" : v;
    };
    jobRole = clean(m[1]);
    jobCompany = clean(m[2]);
    // Country: drop any parenthetical like "(Remote)" for a clean value.
    jobCountry = clean(m[3]).replace(/\([^)]*\)/g, "").replace(/\s{2,}/g, " ").trim();
    text = text.slice(m.index + m[0].length).replace(/^\s+/, "");
  }

  return { text: text.trim(), jobRole, jobCompany, jobCountry };
}

// ---- Cover letter --------------------------------------------------------

function buildCoverLetterPrompt(personal, work, education, projects, jobDescription, instruction, role, company) {
  const p = personal || {};
  const lines = [];
  lines.push("You are an expert career writer. Write a concise, tailored, professional cover letter in Markdown.");
  if (instruction && instruction.trim()) {
    lines.push("");
    lines.push("Honor these user style preferences where reasonable:");
    lines.push(instruction.trim());
  }
  lines.push("");
  lines.push("Rules:");
  lines.push("- Use ONLY the candidate's real background below; never invent employers, dates, or achievements.");
  lines.push(`- Address it to the hiring team${company ? ` at ${company}` : ""}${role ? ` for the ${role} role` : ""}.`);
  lines.push("- Exactly 3 short paragraphs: (1) a strong opening on why this role/company, (2) the most relevant experience and concrete achievements mapped to the role, (3) a confident closing with a call to action.");
  lines.push("- Keep it under ~220 words.");
  lines.push("- Output ONLY the letter in Markdown: a salutation line (e.g. `Dear Hiring Team,`), the paragraphs, then `Sincerely,` and the candidate's name on the next line.");
  lines.push("- Do NOT include a letterhead, contact details, the date, or the company's address — those are added separately.");
  lines.push("");
  lines.push("## Candidate");
  lines.push(`Name: ${p.name || ""}`);
  lines.push(`Title: ${p.title || ""}`);
  lines.push("");
  lines.push("## Work history");
  (work || []).forEach((w, i) =>
    lines.push(`${i + 1}. ${w.role_name || ""} — ${w.company_name || ""} (${w.location || ""}) | ${w.work_duration || ""}`)
  );
  if (education && education.length) {
    lines.push("");
    lines.push("## Education");
    education.forEach((e, i) =>
      lines.push(`${i + 1}. ${e.degree || ""} — ${e.university || ""} (${e.location || ""}) | ${e.period || ""}`)
    );
  }
  if (projects && projects.length) {
    lines.push("");
    lines.push("## Projects");
    projects.forEach((pr, i) =>
      lines.push(`${i + 1}. ${pr.title || ""}${pr.link ? ` (${pr.link})` : ""}${pr.description ? ` — ${pr.description}` : ""}`)
    );
  }
  if (p.additional_info && String(p.additional_info).trim()) {
    lines.push("");
    lines.push("## Additional information");
    lines.push(String(p.additional_info).trim());
  }
  if (jobDescription && jobDescription.trim()) {
    lines.push("");
    lines.push("## Target job description");
    lines.push(jobDescription.trim());
  }
  return lines.join("\n");
}

async function generateCoverLetter({
  provider, apiKey, model, personal, work, education, projects, jobDescription, instruction, role, company,
}) {
  if (!apiKey) {
    throw new Error("No active API key. Add one under API Keys first.");
  }
  const prompt = buildCoverLetterPrompt(personal, work, education, projects, jobDescription, instruction, role, company);
  const pr = (provider || "gemini").toLowerCase();
  const m = (model || "").trim() || undefined;
  let text;
  try {
    text = await withRetry(() => {
      if (pr === "openai") return callOpenAI(apiKey, prompt, m);
      if (pr === "anthropic" || pr === "claude") return callAnthropic(apiKey, prompt, m);
      return callGemini(apiKey, prompt, m);
    });
  } catch (e) {
    throw new Error(describeError(e));
  }
  if (!text) throw new Error("The AI returned an empty cover letter.");
  return { text: text.trim() };
}

// ---- Resume import (parse a resume PDF into structured account fields) -----

// The extraction instructions + JSON shape the model must return.
function parseInstructions() {
  return [
    "You are a resume parser. Extract the candidate's information from the attached resume PDF.",
    "Return ONLY a single valid JSON object — no commentary, no explanation, no markdown code fences.",
    "Use EXACTLY this shape. Use an empty string \"\" or empty array [] when something is absent.",
    "Never invent data that is not present in the resume.",
    "{",
    '  "name": "", "title": "", "email": "", "phone": "", "address": "", "linkedin": "", "portfolio": "",',
    '  "education": { "university": "", "location": "", "degree": "", "period": "" },',
    '  "work": [ { "role_name": "", "company_name": "", "location": "", "work_duration": "" } ],',
    '  "projects": [ { "title": "", "link": "", "description": "" } ],',
    '  "additional_info": ""',
    "}",
    "Guidance:",
    '- title: the candidate\'s professional title or headline (e.g. "Software Engineer").',
    '- address: the candidate\'s location as "City, Country" when available.',
    "- linkedin / portfolio: full URLs when present.",
    "- additional_info: extras that don't fit the fields above — certifications, languages, awards, volunteering, a skills summary. Keep the resume's original wording; leave \"\" if none.",
    "- education: pick only the most recent or highest degree.",
    '- work_duration is REQUIRED for EVERY work entry: capture the role\'s FULL date range EXACTLY as written on the resume — e.g. "May 2022 - Mar 2026", "2021–2024", "Jan 2021 – Present". The dates may appear beside, above, or in a separate column from the role/company (common in modern templates); still attach each date range to its matching role. Never leave work_duration empty when the resume shows dates for that role.',
    '- period (education): the study date range exactly as written.',
    "- Order work entries most recent first. Keep values concise and faithful to the resume.",
  ].join("\n");
}

// Pull a JSON object out of a model response that may be fenced or padded.
function extractJson(raw) {
  let s = String(raw || "").trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  if (s[0] !== "{") {
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) s = s.slice(start, end + 1);
  }
  return JSON.parse(s);
}

// Coerce a parsed object into the exact shape the account form expects.
function normalizeParsed(data) {
  const str = (v) => (v == null ? "" : String(v).trim());
  const d = data || {};
  const edu = d.education || {};
  return {
    personal: {
      name: str(d.name),
      title: str(d.title),
      email: str(d.email),
      phone: str(d.phone),
      address: str(d.address),
      linkedin: str(d.linkedin),
      portfolio: str(d.portfolio),
      additional_info: str(d.additional_info),
    },
    education: {
      university: str(edu.university),
      location: str(edu.location),
      degree: str(edu.degree),
      period: str(edu.period),
    },
    work: (Array.isArray(d.work) ? d.work : []).map((w) => ({
      role_name: str(w.role_name || w.role || w.title),
      company_name: str(w.company_name || w.company || w.employer),
      location: str(w.location),
      // Accept whatever key the model used for the date range.
      work_duration: str(w.work_duration || w.duration || w.dates || w.period || w.date_range || w.dateRange),
    })),
    projects: (Array.isArray(d.projects) ? d.projects : []).map((pr) => ({
      title: str(pr.title),
      link: str(pr.link),
      description: str(pr.description),
    })),
  };
}

// Send a base64 PDF + prompt to Gemini (native document understanding).
async function callGeminiPdf(apiKey, base64, prompt, model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model || MODELS.gemini}:generateContent?key=${encodeURIComponent(
    apiKey
  )}`;
  const res = await uFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { inline_data: { mime_type: "application/pdf", data: base64 } },
            { text: prompt },
          ],
        },
      ],
    }),
    dispatcher: proxyAgent || undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(
      `Gemini API error: ${(data && data.error && data.error.message) || res.statusText}`
    );
    err.status = res.status;
    throw err;
  }
  return (
    data &&
    data.candidates &&
    data.candidates[0] &&
    data.candidates[0].content &&
    data.candidates[0].content.parts &&
    data.candidates[0].content.parts[0] &&
    data.candidates[0].content.parts[0].text
  );
}

// PDF import via Gemini, resilient to a single model being overloaded (503) or
// rate-limited (429): try the key's model first (if any), then a chain of known-
// good document models, moving on ONLY for transient errors. A non-transient
// error (bad key, bad request) stops immediately.
async function callGeminiPdfWithFallback(apiKey, base64, prompt, model) {
  const chain = [];
  const add = (m) => { if (m && !chain.includes(m)) chain.push(m); };
  add((model || "").trim() || undefined);
  ["gemini-2.5-flash", "gemini-flash-latest", "gemini-2.5-flash-lite", "gemini-2.5-pro"].forEach(add);

  let lastErr;
  for (const m of chain) {
    try {
      return await callGeminiPdf(apiKey, base64, prompt, m);
    } catch (e) {
      lastErr = e;
      if (!isTransient(e)) throw e; // bad key / bad request → don't keep trying
      // transient (overloaded / rate-limited) → try the next model
    }
  }
  throw lastErr;
}

// Send a base64 PDF + prompt to Anthropic (document content block).
async function callAnthropicPdf(apiKey, base64, prompt, model) {
  const res = await uFetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: model || MODELS.anthropic,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: base64 },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
    dispatcher: proxyAgent || undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(
      `Anthropic API error: ${(data && data.error && data.error.message) || res.statusText}`
    );
    err.status = res.status;
    throw err;
  }
  return data && data.content && data.content[0] ? data.content[0].text : null;
}

async function parseResumeFile({ provider, apiKey, model, base64 }) {
  if (!apiKey) {
    throw new Error("No active API key. Add one under API Keys first.");
  }
  if (!base64) throw new Error("Could not read the PDF file.");

  const prompt = parseInstructions();
  const p = (provider || "gemini").toLowerCase();
  const m = (model || "").trim() || undefined;
  if (p === "openai") {
    throw new Error(
      "PDF import works with a Gemini or Anthropic key. Set one of those as the active API key, then try Import again."
    );
  }
  let raw;
  try {
    raw =
      p === "anthropic" || p === "claude"
        ? await withRetry(() => callAnthropicPdf(apiKey, base64, prompt, m))
        : await callGeminiPdfWithFallback(apiKey, base64, prompt, m);
  } catch (e) {
    throw new Error(describeError(e));
  }
  if (!raw) throw new Error("The AI returned an empty response.");

  let data;
  try {
    data = extractJson(raw);
  } catch (_) {
    throw new Error("Could not read the AI response. Please try again.");
  }
  return normalizeParsed(data);
}

module.exports = {
  generateResume, generateCoverLetter, parseResumeFile, setProxy, checkProxy,
  buildPrompt, parseResumeMarkdown, buildPromptJson, parseResumeJson, jobRefFor,
  refineV2Prompt, extractJdTarget,
};
