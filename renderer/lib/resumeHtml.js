import { marked } from "marked";

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Render a degree with each significant term bold but connective words left at
// normal weight, e.g. "Bachelor's Degree in Computer Science" -> bold
// "Bachelor's Degree", plain "in", bold "Computer Science".
const DEGREE_CONNECTORS = new Set(
  ["in", "of", "and", "the", "for", "with", "a", "an", "&", "-", "–", "—", ","]
);
function formatDegreeHtml(degree) {
  const words = String(degree || "").trim().split(/\s+/).filter(Boolean);
  const parts = [];
  let group = [];
  const flush = () => {
    if (group.length) {
      parts.push(`<strong class="edu-degree">${escapeHtml(group.join(" "))}</strong>`);
      group = [];
    }
  };
  for (const w of words) {
    if (DEGREE_CONNECTORS.has(w.toLowerCase())) { flush(); parts.push(escapeHtml(w)); }
    else group.push(w);
  }
  flush();
  return parts.join(" ");
}

const BASE = `
* { box-sizing: border-box; }
html, body { margin: 0; background: #fff; }
body { color: #23272e; font-size: 10.5pt; line-height: 1.34; }
.page { margin: 0; padding: 0; }
@media screen {
  body { background: #e9ebee; }
  .page { max-width: 794px; margin: 24px auto; padding: 36px 18px; background: #fff; box-shadow: 0 2px 14px rgba(0,0,0,.18); }
}
/* Role titles (job titles) are a fixed medium-black bold across all styles. */
main h3 { font-size: 11pt; margin: 8px 0 1px; color: #333333; font-weight: 700; }
main p { margin: 3px 0; text-align: justify; }
main p.skills { line-height: 1.6; text-align: left; }
main ul { margin: 3px 0 6px; padding-left: 18px; }
main li { margin: 1px 0; text-align: justify; }
/* Tighten the skills section so the first experience entry fits on page 1. */
main h2 + ul { margin-top: 2px; }
/* Body emphasis is NOT bold — only headings and skill categories are. */
main strong { color: #14181e; font-weight: normal; }
main p.skills strong { font-weight: 700; }
main em { color: #5a6573; font-style: italic; }
/* Work-history role line: title (with right-aligned dates) + company·location. */
main h3 { margin-bottom: 0; }
.role-dates { float: right; color: #6a7280; font-weight: normal; font-size: 9.5pt; }
.role-org { color: #6a7280; font-size: 9.5pt; font-weight: normal; margin: 1px 0 5px; }
/* Projects: bold title + (domain) link on one line, description on the next
   with a narrow gap, and space between projects. */
.proj-title { font-weight: 700; color: #14181e; }
/* Clickable project link sits on the title line, normal weight. */
.proj-link { font-weight: 400; }
.proj-link a { font-weight: 400; }
.proj-desc { margin-top: 1px; text-align: justify; }
.project { margin: 0 0 8px; break-inside: avoid; }
/* Contacts must stay on a single row. */
.contacts { font-size: 8.5pt; white-space: nowrap; overflow: hidden; }
.title { margin-top: 4px; font-size: 11pt; color: #5a6573; white-space: nowrap; overflow: hidden; }
/* A role heading is kept with its first bullet (the .kh block never splits);
   the remaining bullets flow to the next page, so headings are never stranded
   and there is no large blank gap. */
main h2, main h3 { break-after: avoid; }
.kh { break-inside: avoid; }
.kh-first { margin-bottom: 0; }
.kh-rest { margin-top: 0; }
main li { break-inside: avoid; }
main p { orphans: 2; widows: 2; }
a { text-decoration: none; }
/* Header contact links follow the contact-line colour (visible on every style,
   including coloured-header templates) instead of the accent. */
.contacts a { color: inherit; }
@page { size: A4; margin: 14mm 8mm; }
`;

// Distinct visual template per style id. `head` is the user-picked color (empty
// for "Default"). It recolors only the THEMEABLE parts — section headings
// (categories), dividers/rules, and header backgrounds — while the candidate's
// NAME (headline) and the job ROLE TITLES keep a fixed dark color so they never
// change with the picker. `accent` already follows the pick for elements that
// were always themed; `head || <default>` themes the rest without altering the
// Default appearance.
function templateCss(id, accent, head) {
  switch (id) {
    case "modern":
      return `body{font-family:"Segoe UI",Arial,sans-serif;}
header{padding-bottom:10px;border-bottom:3px solid ${accent};margin-bottom:16px;}
header h1{margin:0;font-size:26pt;font-weight:700;color:#16203a;letter-spacing:.5px;}
.contacts{margin-top:6px;color:${accent};font-weight:600;}
main h2{font-size:11.5pt;color:${accent};text-transform:uppercase;letter-spacing:1px;margin:18px 0 6px;}
main ul{list-style:none;padding-left:2px;}
main li{position:relative;padding-left:16px;}
main li::before{content:"\\2022";color:${accent};position:absolute;left:0;font-weight:700;}
a{color:${accent};}`;
    case "minimal":
      return `body{font-family:"Helvetica Neue",Arial,sans-serif;color:#2a2f37;}
header{margin-bottom:20px;}
header h1{margin:0;font-size:22pt;font-weight:600;letter-spacing:.5px;color:#111;}
.contacts{margin-top:6px;color:#6b7280;}
main h2{font-size:10pt;color:${head || "#6b7280"};text-transform:uppercase;letter-spacing:2px;border-bottom:1px solid ${head || "#e5e7eb"};padding-bottom:4px;margin:22px 0 8px;font-weight:600;}
main ul{list-style:none;padding-left:2px;}
main li{position:relative;padding-left:14px;}
main li::before{content:"\\2013";color:#9ca3af;position:absolute;left:0;}
a{color:#374151;}`;
    case "creative":
      return `body{font-family:"Segoe UI",Arial,sans-serif;}
header{background:${accent};color:#fff;padding:18px 22px;border-radius:7px;margin-bottom:18px;}
header h1{margin:0;font-size:24pt;color:#fff;}
.title{color:rgba(255,255,255,.9);}
.contacts{margin-top:6px;color:rgba(255,255,255,.88);}
main h2{font-size:11.5pt;color:${accent};text-transform:uppercase;letter-spacing:.8px;border-bottom:2px solid ${accent};padding-bottom:3px;margin:18px 0 8px;}
main ul{list-style:square;}
main li::marker{color:${accent};}
a{color:${accent};}`;
    case "technical":
      return `body{font-family:"Segoe UI",Arial,sans-serif;}
header{border-left:5px solid ${accent};padding-left:16px;margin-bottom:18px;}
header h1{margin:0;font-size:24pt;color:#13233f;}
.contacts{margin-top:6px;color:#5a6573;font-family:Consolas,monospace;font-size:9pt;}
main h2{font-size:11.5pt;color:${accent};text-transform:uppercase;letter-spacing:.6px;margin:18px 0 6px;padding-left:10px;border-left:4px solid ${accent};}
main ul{list-style:none;padding-left:2px;}
main li{position:relative;padding-left:18px;}
main li::before{content:"\\2713";color:${accent};position:absolute;left:0;font-weight:700;}
a{color:${accent};}`;
    case "academic":
      return `body{font-family:Georgia,"Times New Roman",serif;color:#222;}
header{text-align:center;margin-bottom:16px;border-bottom:1px solid ${head || "#ccc"};padding-bottom:12px;}
header h1{margin:0;font-size:24pt;color:#1f2937;letter-spacing:.5px;}
.contacts{margin-top:6px;color:#555;}
main h2{font-size:12pt;color:${head || "#1f2937"};text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid ${head || "#bbb"};padding-bottom:2px;margin:18px 0 8px;}
a{color:${head || "#33485f"};}`;
    case "executive":
      return `body{font-family:Georgia,"Times New Roman",serif;color:#23272e;}
header{background:${head || "#16233b"};color:#fff;padding:20px 22px;margin-bottom:18px;}
header h1{margin:0;font-size:25pt;color:#fff;font-weight:700;}
.title{color:#c7d2e0;}
.contacts{margin-top:6px;color:#c7d2e0;font-family:Arial,sans-serif;}
main h2{font-size:12pt;color:${head || "#16233b"};text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid ${head || "#16233b"};padding-bottom:3px;margin:18px 0 8px;}
main ul{list-style:none;padding-left:2px;}
main li{position:relative;padding-left:16px;}
main li::before{content:"\\25C6";color:${accent};font-size:7pt;position:absolute;left:0;top:3px;}
a{color:${head || "#16233b"};}`;
    case "compact":
      return `body{font-family:"Segoe UI",Arial,sans-serif;font-size:9.5pt;line-height:1.32;}
header{border-bottom:2px solid ${accent};padding-bottom:8px;margin-bottom:12px;}
header h1{margin:0;font-size:20pt;color:#1f2937;}
.contacts{margin-top:4px;color:#5a6573;font-size:8.5pt;}
main h2{font-size:10pt;color:${accent};text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid ${head || "#d8dde4"};padding-bottom:2px;margin:12px 0 5px;}
main ul{margin:3px 0 6px;padding-left:16px;}
main li{margin:1px 0;}
a{color:${accent};}`;
    case "cards":
      return `body{font-family:"Segoe UI",Arial,sans-serif;color:#23272e;}
header{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;column-gap:20px;border-bottom:3px solid ${accent};padding-bottom:12px;margin-bottom:16px;}
header h1{grid-column:1;grid-row:1;margin:0;font-size:24pt;font-weight:700;color:#1b3a5e;letter-spacing:.3px;line-height:1.06;}
.title{grid-column:1;grid-row:2;margin-top:5px;color:${accent};text-transform:uppercase;letter-spacing:2px;font-weight:700;font-size:10pt;white-space:normal;}
.contacts{grid-column:2;grid-row:1/3;align-self:start;justify-self:end;text-align:right;color:#5a6573;font-size:8.5pt;line-height:1.7;white-space:normal;max-width:235px;word-break:break-word;}
main h2{font-size:11pt;color:${head || "#1b3a5e"};text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid ${accent};padding-bottom:3px;margin:16px 0 8px;}
main ul{list-style:none;padding-left:2px;}
main li{position:relative;padding-left:15px;}
main li::before{content:"\\2022";color:${accent};position:absolute;left:0;font-weight:700;}
main h3{font-size:11pt;color:#333333;font-weight:700;margin-bottom:0;}
a{color:${accent};}
.summary-box{border:1.5px solid ${accent};border-radius:9px;padding:2px 16px 12px;margin-bottom:8px;background:${accent}0d;}
.summary-box h2{border:none;color:${accent};margin:10px 0 4px;}
.skills-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin:4px 0 8px;}
.skill-card{border:1px solid #e2e6ec;border-top:2px solid ${accent};border-radius:7px;padding:8px 10px;background:#f7f9fb;break-inside:avoid;}
.skill-cat{color:${accent};text-transform:uppercase;letter-spacing:.5px;font-size:8.5pt;font-weight:700;margin-bottom:3px;}
.skill-items{font-size:9.5pt;color:#3a4250;}
.role-org{color:#6a7280;font-size:9.5pt;font-weight:400;margin:0 0 4px;}
.role-dates{float:right;color:#7a8390;font-weight:400;font-size:9.5pt;}`;
    default: // professional
      return `body{font-family:Calibri,"Segoe UI",Arial,sans-serif;}
header{border-left:5px solid ${accent};padding-left:16px;margin-bottom:18px;}
header h1{margin:0;font-size:25pt;color:#1f2937;font-family:Georgia,serif;}
.contacts{margin-top:6px;color:#5a6573;}
main h2{font-size:12pt;color:${accent};text-transform:uppercase;letter-spacing:.6px;border-bottom:1.5px solid ${accent};padding-bottom:3px;margin:20px 0 8px;}
a{color:${accent};}`;
  }
}

// Strip protocol + www and trailing slash from a URL for compact display.
function shortLink(url) {
  return String(url || "")
    .trim()
    .replace(/^https?:\/\/(www\.)?/i, "")
    .replace(/\/+$/, "");
}

// Multiply each RGB channel by `f` (<1) to produce a darker shade of a hex.
function darkenHex(hex, f = 0.7) {
  const h = String(hex || "").replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(h)) return hex;
  const n = parseInt(h, 16);
  const ch = (shift) => Math.round(((n >> shift) & 255) * f).toString(16).padStart(2, "0");
  return "#" + ch(16) + ch(8) + ch(0);
}

// When the user picks a Name color, recolor the candidate's name (headline) to
// it and the professional title (subtitle) to a darker shade. Job/role titles
// in Experience are intentionally left out — they stay a fixed medium-black
// bold. Appended after the template so these overrides win by cascade order.
function nameTitleCss(nameColor) {
  if (!nameColor) return "";
  const titleColor = darkenHex(nameColor, 0.7);
  return `\nheader h1{color:${nameColor};}\n.title{color:${titleColor};}`;
}

// Normalize an <a> into a clean clickable link: an absolute href plus a short
// label (a bare-URL label is trimmed to its domain so it reads cleanly).
function cleanProjectAnchor(aHtml) {
  const hrefM = aHtml.match(/href="([^"]*)"/i);
  let href = (hrefM ? hrefM[1] : "").trim();
  let label = aHtml.replace(/<[^>]+>/g, "").trim();
  const looksUrl = /^https?:\/\//i.test(label) || /^www\./i.test(label) || /^[^\s/]+\.[a-z]{2,}/i.test(label);
  if (looksUrl) label = shortLink(label);
  if (!href) href = "https://" + label.replace(/^\/+/, "");
  else if (!/^(https?:|mailto:)/i.test(href)) href = "https://" + href.replace(/^\/+/, "");
  return `<a href="${href}">${label || href}</a>`;
}

// Code/file extensions that must NOT be mistaken for a domain (e.g. "Node.js").
const NON_DOMAIN_EXT = /^(js|ts|jsx|tsx|mjs|cjs|py|rb|go|rs|php|java|cs|cpp|css|scss|sass|html|xml|json|yml|yaml|md|sh|bat|sql|env|toml|ini|txt|csv|png|jpg|svg|pdf)$/i;
function looksLikeDomain(s) {
  const t = String(s || "").trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  const m = t.match(/^[^\s/]+\.([a-z]{2,})(?:[/?#]|$)/i);
  return !!m && !NON_DOMAIN_EXT.test(m[1]);
}

// Find the project's link wherever the model put it (right after the title, a
// markdown link/autolink anywhere, or a trailing "(domain)") and return it
// separated from the remaining description text.
function extractProjectLink(rest) {
  // 1) Link directly after the title — parenthesized or bare anchor.
  let m = rest.match(/^\s*\(?\s*(<a\b[^>]*>[\s\S]*?<\/a>)\s*\)?/);
  if (m) return { link: cleanProjectAnchor(m[1]), desc: rest.slice(m[0].length) };
  // 2) Bare "(domain)" directly after the title.
  m = rest.match(/^\s*\(\s*([^()\s<]+)\s*\)/);
  if (m && looksLikeDomain(m[1])) {
    return { link: cleanProjectAnchor(`<a href="">${m[1]}</a>`), desc: rest.slice(m[0].length) };
  }
  // 3) A real link anywhere in the entry (markdown link or autolinked URL).
  m = rest.match(/<a\b[^>]*>[\s\S]*?<\/a>/);
  if (m) return { link: cleanProjectAnchor(m[0]), desc: rest.slice(0, m.index) + rest.slice(m.index + m[0].length) };
  // 4) A trailing "(domain)" at the very end of the entry.
  m = rest.match(/\(\s*([^()\s<]+)\s*\)\s*$/);
  if (m && looksLikeDomain(m[1])) {
    return { link: cleanProjectAnchor(`<a href="">${m[1]}</a>`), desc: rest.slice(0, m.index) };
  }
  return { link: "", desc: rest };
}

// Build the contact line from the account's own fields. Authoritative, so the
// header is always correct even when the model mangles or drops contacts.
function buildContacts(info) {
  if (!info) return "";
  const parts = [
    (info.email || "").trim(),
    (info.phone || "").trim(),
    (info.address || "").trim(),
    shortLink(info.linkedin),
    shortLink(info.portfolio),
  ].filter(Boolean);
  return parts.join("  •  ");
}

// Does a header part look like contact info (so it must NOT become the title)?
function isContactish(s) {
  const t = String(s || "").trim();
  if (!t) return true;
  if (t.includes("@")) return true; // email
  if (/https?:\/\//i.test(t)) return true; // explicit URL
  if (/linkedin\.com|github\.com/i.test(t)) return true; // profile link
  if ((t.match(/\d/g) || []).length >= 7) return true; // phone number
  return false;
}

// Turn a single contact item into a clickable link where it makes sense, so the
// generated PDF's header links actually work when clicked (email → mailto,
// phone → tel, LinkedIn / portfolio / any URL → https).
function linkifyContact(part) {
  const t = String(part || "").trim();
  if (!t) return "";
  const attr = (s) => String(s).replace(/"/g, "%22");
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) {
    return `<a href="mailto:${attr(t)}">${escapeHtml(t)}</a>`;
  }
  if (/^https?:\/\//i.test(t) || /^www\./i.test(t) || /^[^\s/]+\.[a-z]{2,}(?:[/?#]|$)/i.test(t)) {
    const href = /^https?:\/\//i.test(t) ? t : "https://" + t.replace(/^\/+/, "");
    return `<a href="${attr(href)}">${escapeHtml(t)}</a>`;
  }
  if ((t.match(/\d/g) || []).length >= 7 && /^[+()\d\s.\-]+$/.test(t)) {
    return `<a href="tel:${t.replace(/[^\d+]/g, "")}">${escapeHtml(t)}</a>`;
  }
  return escapeHtml(t);
}

// Shared header markup (used by both the resume and the cover letter). For the
// "cards" style the contact items stack vertically on the right. Each contact
// item is linkified so it's clickable in the PDF.
function headerHtml(id, name, title, contacts) {
  if (!name) return "";
  const items = String(contacts || "")
    .split("  •  ")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(linkifyContact);
  const contactsHtml = id === "cards" ? items.join("<br>") : items.join("  •  ");
  return (
    `<header><h1>${escapeHtml(name)}</h1>` +
    `${title ? `<div class="title">${escapeHtml(title)}</div>` : ""}` +
    `${contacts ? `<div class="contacts">${contactsHtml}</div>` : ""}</header>`
  );
}

// Optional font-family / size override (chosen in the UI), appended last so it
// wins over the template defaults.
function fontOverride(style) {
  let css = "";
  if (style && style.font) css += `body{font-family:${style.font};}`;
  if (style && style.fontSize) css += `body{font-size:${style.fontSize}pt;}`;
  return css ? "\n" + css : "";
}

// Convert the AI's Markdown resume into a styled HTML document using the chosen
// style's template. The name + title come from the account (Personal Info); the
// model supplies only the body.
export function buildResumeHtml(markdown, style, fallbackTitle = "", contactInfo = null, education = null) {
  const id = (style && style.id) || "professional";
  const accent = (style && style.accent) || "#2f5b8f";
  const head = (style && style.head) || "";
  const nameColor = (style && style.nameColor) || "";

  const md = (markdown || "").trim();
  const lines = md.split("\n");
  let name = "";
  let title = "";
  let contacts = "";
  let rest = md;

  // The candidate's name is the first meaningful line, whatever its Markdown
  // form (# H1, ## H2, **bold**, or plain text).
  const idx = lines.findIndex(
    (l) => l.trim() !== "" && !/^[-*_]{3,}$/.test(l.trim())
  );
  if (idx !== -1) {
    // Line 1 may pack "Name | Title | contacts…". Take the name, then the first
    // NON-contact part as the title.
    const firstParts = lines[idx]
      .trim()
      .replace(/^#{1,6}\s+/, "")
      .replace(/^\*\*|\*\*$/g, "")
      .replace(/^_+|_+$/g, "")
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    name = firstParts[0] || "";
    for (let j = 1; j < firstParts.length; j++) {
      if (!isContactish(firstParts[j])) { title = firstParts[j]; break; }
    }
    lines.splice(idx, 1);

    while (idx < lines.length) {
      const t = (lines[idx] || "").trim();
      if (t === "") { lines.splice(idx, 1); continue; }
      if (/^#{1,6}\s/.test(t)) break;
      if (/^[-*_]{3,}$/.test(t)) { lines.splice(idx, 1); continue; }
      const cleaned = t.replace(/^\*\*|\*\*$/g, "").replace(/^_+|_+$/g, "");
      if (!title && !isContactish(cleaned)) {
        title = cleaned;
        lines.splice(idx, 1);
        continue;
      }
      if (isContactish(cleaned)) {
        if (!contacts) {
          contacts = cleaned.replace(/\|/g, "  •  ").replace(/^[•\s]+|[•\s]+$/g, "");
        }
        lines.splice(idx, 1);
        continue;
      }
      break;
    }
    rest = lines.join("\n");
  }

  // The header reflects the account's Personal Info, never the model's text.
  if (contactInfo) {
    if (contactInfo.name) name = contactInfo.name;
    title = (contactInfo.title || "").trim();
  }
  const built = buildContacts(contactInfo);
  if (built) contacts = built;
  if (!title && fallbackTitle) title = fallbackTitle;

  let body = marked.parse(rest, { mangle: false, headerIds: false });

  // Put each "**Category:** …" on its own line; for "cards" render a card grid.
  body = body.replace(/<p>([\s\S]*?)<\/p>/g, (m, inner) => {
    const labels = inner.match(/<strong>[^<]*:<\/strong>/g);
    if (!labels || labels.length < 2) return m;
    if (id === "cards") {
      const cards = [];
      inner.replace(
        /<strong>([^<]*?):<\/strong>\s*([\s\S]*?)(?=<strong>|$)/g,
        (mm, nm, items) => {
          cards.push(
            `<div class="skill-card"><div class="skill-cat">${nm.trim()}</div>` +
              `<div class="skill-items">${items.replace(/<br\s*\/?>/gi, "").trim()}</div></div>`
          );
          return mm;
        }
      );
      return `<div class="skills-grid">${cards.join("")}</div>`;
    }
    let first = true;
    const out = inner.replace(/\s*<strong>([^<]*:)<\/strong>/g, (_mm, lbl) => {
      if (first) { first = false; return `<strong>${lbl}</strong>`; }
      return `<br><strong>${lbl}</strong>`;
    });
    return `<p class="skills">${out}</p>`;
  });

  // Split every role heading "Title — Company · Location | Dates" into a title
  // line (with right-aligned dates) and a company·location line below. Applies
  // to ALL styles.
  body = body.replace(/<h3\b([^>]*)>([\s\S]*?)<\/h3>/g, (mm, attr, head) => {
    let main = head;
    let dates = "";
    const d = head.match(/^([\s\S]*?)\s*\|\s*([^|]+)$/);
    if (d) { main = d[1].trim(); dates = d[2].trim(); }
    let roleTitle = main;
    let org = "";
    const o = main.match(/^([\s\S]*?)\s+[—–]\s+([\s\S]+)$/);
    if (o) { roleTitle = o[1].trim(); org = o[2].trim(); }
    const ds = dates ? `<span class="role-dates">${dates}</span>` : "";
    const od = org ? `<div class="role-org">${org}</div>` : "";
    return `<h3${attr}>${roleTitle}${ds}</h3>${od}`;
  });

  // Education: render deterministically from the account's own structured data
  // so it looks identical in every style and never depends on the model's
  // wording or markdown (which was the source of the "sometimes broken" layout).
  // The institution is the bold heading; the degree — including connective words
  // like "in" — stays normal weight on the line below, so nothing in
  // "Bachelor's Degree in Computer Science" renders bold.
  const eduList = (Array.isArray(education) ? education : education ? [education] : [])
    .map((e) => e || {})
    .filter((e) => e.university || e.degree || e.period || e.location);
  if (eduList.length) {
    const eduHtml = eduList
      .map((e) => {
        const uni = (e.university || "").trim();
        const degree = (e.degree || "").trim();
        const loc = (e.location || "").trim();
        const period = (e.period || "").trim();
        const dates = period ? `<span class="role-dates">${escapeHtml(period)}</span>` : "";
        // Primary line: the degree, terms bold with connective words ("in", "of")
        // left normal weight. Falls back to the school name when no degree.
        const primary = degree
          ? formatDegreeHtml(degree)
          : `<strong class="edu-degree">${escapeHtml(uni)}</strong>`;
        // Secondary line: "University - Location" (whichever is present).
        const second = [degree && uni ? uni : "", loc]
          .filter(Boolean)
          .map(escapeHtml)
          .join(" - ");
        const sub = second ? `<div class="role-org edu-org">${second}</div>` : "";
        return `<div class="edu-line">${primary}${dates}</div>${sub}`;
      })
      .join("");
    if (/<h2[^>]*>[^<]*Education[^<]*<\/h2>/i.test(body)) {
      body = body.replace(
        /(<h2[^>]*>[^<]*Education[^<]*<\/h2>)([\s\S]*?)(?=<h2|$)/i,
        (mm, heading) => `${heading}${eduHtml}`
      );
    } else {
      body += `<h2>Education</h2>${eduHtml}`;
    }
  }

  // Cards style additionally boxes the summary section.
  if (id === "cards") {
    body = body.replace(
      /(<h2[^>]*>\s*(?:Professional\s+)?(?:Summary|Profile)\s*<\/h2>)([\s\S]*?)(?=<h2|$)/i,
      (mm, heading, restHtml) => `<div class="summary-box">${heading}${restHtml}</div>`
    );
  }

  // Projects: rebuild the whole section so each project is a bold-title +
  // clickable (domain) line followed by its description on the next line, with
  // space between projects — regardless of how the model grouped them. The
  // boundary between projects is each bold title. (All styles.)
  body = body.replace(
    /(<h2[^>]*>[^<]*Projects?[^<]*<\/h2>)([\s\S]*?)(?=<h2|$)/i,
    (m, heading, rest2) => {
      let raw = rest2;
      // Flatten block wrappers so projects can be re-segmented cleanly.
      raw = raw.replace(/<\/?(p|ul|ol|li)\b[^>]*>/gi, " ").replace(/<br\s*\/?>/gi, " ");
      // Make any relative project links absolute (the model often omits https).
      raw = raw.replace(/<a\s+href="(?!https?:|mailto:)([^"]+)"/gi, '<a href="https://$1"');

      // Each project begins at a bold title (<strong>).
      const chunks = raw.split(/(?=<strong>)/g).map((s) => s.trim()).filter(Boolean);
      if (!chunks.length) return heading + rest2;

      const html = chunks
        .map((part) => {
          // Title = the leading bold run. Without one, treat the chunk as text.
          const sM = part.match(/<strong>[\s\S]*?<\/strong>/);
          if (!sM) {
            return `<li class="project"><div class="proj-desc">${part.trim()}</div></li>`;
          }
          const titleHtml = sM[0].replace(/^<strong>/, '<strong class="proj-title">');
          const after = part.slice(sM.index + sM[0].length).replace(/^(?:\s|[|•:\-–—])+/, "");

          // Pull the project link (wherever the model put it) onto the title
          // line as a single clickable link so the viewer can open it directly.
          const { link, desc: rawDesc } = extractProjectLink(after);
          const desc = rawDesc
            .replace(/\s*<a\b[^>]*>\s*https?:\/\/[^<]*<\/a>/gi, "") // drop leftover bare-URL dupes
            .replace(/^(?:\s|[|•:\-–—])+/, "")
            .replace(/\(\s*\)/g, "")
            .replace(/\s{2,}/g, " ")
            .trim();

          const head = link
            ? `${titleHtml} <span class="proj-link">(${link})</span>`
            : titleHtml;
          return (
            `<li class="project"><div class="proj-head">${head}</div>` +
            (desc ? `<div class="proj-desc">${desc}</div>` : "") +
            `</li>`
          );
        })
        .join("");
      return heading + `<ul class="projects">${html}</ul>`;
    }
  );

  // Keep each role heading (and its org line) with at least its first bullet.
  body = body.replace(
    /<h3\b([^>]*)>([\s\S]*?)<\/h3>\s*(<div class="role-org">[\s\S]*?<\/div>)?\s*<ul>\s*(<li\b[\s\S]*?<\/li>)([\s\S]*?)<\/ul>/g,
    (m, attr, head, org, firstLi, restLis) => {
      const rest3 = restLis && restLis.trim()
        ? `<ul class="kh-rest">${restLis}</ul>`
        : "";
      return `<div class="kh"><h3${attr}>${head}</h3>${org || ""}<ul class="kh-first">${firstLi}</ul></div>${rest3}`;
    }
  );

  const css =
    BASE + "\n" + templateCss(id, accent, head) + nameTitleCss(nameColor) +
    "\nmain h2{margin-top:13px;margin-bottom:5px;}" +
    "\n.edu-line{font-size:11pt;color:#23272e;font-weight:normal;margin:8px 0 0;}" +
    "\n.edu-line .edu-degree{font-weight:700;color:#14181e;}" +
    "\n.edu-org{color:#3a4250;font-weight:normal;margin:1px 0 5px;}" +
    "\n.contacts{overflow-wrap:anywhere;}";

  // Normalize the contact line so LinkedIn shows as a single clean handle.
  if (contacts) {
    contacts = contacts.replace(/\[[^\]]*\]\(([^)\s]+)\)/g, "$1");
    contacts = contacts.replace(
      /\bLinked\s?In\b\s*[:\-–]?\s*(?=https?:\/\/|www\.|linkedin\.com)/gi,
      ""
    );
    contacts = contacts.replace(/https?:\/\/(?:www\.)?(linkedin\.com\/[^\s)]+)/gi, "$1");
  }

  const header = headerHtml(id, name, title, contacts);

  return `<!doctype html>
<html><head><meta charset="utf-8" /><base target="_blank" /><style>${css}${fontOverride(style)}</style></head>
<body><div class="page">
${header}
<main>${body}</main>
</div></body></html>`;
}

// Build a cover letter PDF that shares the resume's header style.
export function buildCoverLetterHtml(coverMarkdown, style, contactInfo = null) {
  const id = (style && style.id) || "professional";
  const accent = (style && style.accent) || "#2f5b8f";
  const head = (style && style.head) || "";
  const nameColor = (style && style.nameColor) || "";
  const name = (contactInfo && contactInfo.name) || "";
  const title = (contactInfo && (contactInfo.title || "").trim()) || "";
  const contacts = buildContacts(contactInfo);

  const header = headerHtml(id, name, title, contacts);

  const body = marked.parse((coverMarkdown || "").trim(), {
    mangle: false,
    headerIds: false,
  });

  const css =
    BASE + "\n" + templateCss(id, accent, head) + nameTitleCss(nameColor) +
    "\n.contacts{overflow-wrap:anywhere;}" +
    "\nmain p{margin:0 0 11px;line-height:1.5;text-align:left;}" +
    fontOverride(style);

  return `<!doctype html>
<html><head><meta charset="utf-8" /><base target="_blank" /><style>${css}</style></head>
<body><div class="page">
${header}
<main>${body}</main>
</div></body></html>`;
}
