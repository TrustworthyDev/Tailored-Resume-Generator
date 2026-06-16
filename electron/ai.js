// Multi-provider resume generation. Routes to Gemini, OpenAI, or Anthropic
// based on the active API key's provider. Network goes through undici so an
// optional proxy (with auth) can be applied to the AI API requests only.

const { fetch: uFetch, ProxyAgent } = require("undici");

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

function buildPrompt(personal, work, education, projects, jobDescription, style, instruction) {
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

  if (jobDescription && jobDescription.trim()) {
    lines.push("");
    lines.push("## Target job description");
    lines.push(jobDescription.trim());
  }

  lines.push("");
  lines.push(
    "Output sections: a one-line header with contact links, a 2-3 sentence Professional Summary, an Experience section with 2-4 strong bullet points per role, an Education section, a Skills section inferred from the roles, and a Projects section (only if projects are provided). Format EACH project as exactly: `**Project Title** ([domain](full-url))` on the first line — the title in bold, then the link in parentheses using ONLY the domain (e.g. `veygo.com`) as the visible link text; omit the parentheses entirely if there is no link, and NEVER write the raw URL anywhere else. Put the description on the NEXT line, with a blank line between projects. In the Skills section, put EACH category on its own line as `**Category:** items` (one category per line). Return Markdown."
  );
  if (jobDescription && jobDescription.trim()) {
    lines.push("");
    lines.push(
      "FORMAT: The VERY FIRST line of your output must be exactly `TARGET: <job title> | <company> | <country>`. For <job title>, copy the COMPLETE title VERBATIM from the job description, including every word and symbol such as parentheses, slashes, or qualifiers (e.g. `AI Engineer (Full Remote)`) — do NOT shorten or summarize it. Use Unknown for any part not found. Then a blank line, then the resume Markdown."
    );
  }

  return lines.join("\n");
}

async function callGemini(apiKey, prompt, model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model || MODELS.gemini}:generateContent?key=${encodeURIComponent(
    apiKey
  )}`;
  const res = await uFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    dispatcher: proxyAgent || undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      `Gemini API error: ${(data && data.error && data.error.message) || res.statusText}`
    );
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
  const res = await uFetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || MODELS.openai,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    }),
    dispatcher: proxyAgent || undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      `OpenAI API error: ${(data && data.error && data.error.message) || res.statusText}`
    );
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
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      `Anthropic API error: ${(data && data.error && data.error.message) || res.statusText}`
    );
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
    instruction
  );

  const p = (provider || "gemini").toLowerCase();
  const mdl = (model || "").trim() || undefined;
  let text;
  try {
    if (p === "openai") text = await callOpenAI(apiKey, prompt, mdl);
    else if (p === "anthropic" || p === "claude") text = await callAnthropic(apiKey, prompt, mdl);
    else text = await callGemini(apiKey, prompt, mdl);
  } catch (e) {
    throw new Error(describeError(e));
  }

  if (!text) throw new Error("The AI returned an empty response.");

  // Pull the target job role/company/country off the first line (if present).
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
    if (pr === "openai") text = await callOpenAI(apiKey, prompt, m);
    else if (pr === "anthropic" || pr === "claude") text = await callAnthropic(apiKey, prompt, m);
    else text = await callGemini(apiKey, prompt, m);
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
    '  "projects": [ { "title": "", "link": "", "description": "" } ]',
    "}",
    "Guidance:",
    '- title: the candidate\'s professional title or headline (e.g. "Software Engineer").',
    '- address: the candidate\'s location as "City, Country" when available.',
    "- linkedin / portfolio: full URLs when present.",
    "- education: pick only the most recent or highest degree.",
    '- work_duration / period: the date range exactly as written (e.g. "2021–2024" or "Jan 2021 – Present").',
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
    },
    education: {
      university: str(edu.university),
      location: str(edu.location),
      degree: str(edu.degree),
      period: str(edu.period),
    },
    work: (Array.isArray(d.work) ? d.work : []).map((w) => ({
      role_name: str(w.role_name),
      company_name: str(w.company_name),
      location: str(w.location),
      work_duration: str(w.work_duration),
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
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      `Gemini API error: ${(data && data.error && data.error.message) || res.statusText}`
    );
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
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      `Anthropic API error: ${(data && data.error && data.error.message) || res.statusText}`
    );
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
  let raw;
  try {
    if (p === "openai") {
      throw new Error(
        "PDF import works with a Gemini or Anthropic key. Set one of those as the active API key, then try Import again."
      );
    } else if (p === "anthropic" || p === "claude") {
      raw = await callAnthropicPdf(apiKey, base64, prompt, m);
    } else {
      raw = await callGeminiPdf(apiKey, base64, prompt, m);
    }
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

module.exports = { generateResume, generateCoverLetter, parseResumeFile, setProxy, checkProxy };
