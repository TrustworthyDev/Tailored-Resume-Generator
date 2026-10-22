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
/* Left-aligned, never justified. Justification stretches the spaces between
   words, and PDF text extractors read those wide gaps as extra separators —
   which splits phrases an ATS is trying to match. It reads better too. */
main p { margin: 3px 0; text-align: left; }
/* One paragraph per skill category, so margins are zeroed and the 1.6 line
   height alone provides the spacing the single <br>-joined block used to have. */
main p.skills { margin: 0; line-height: 1.6; text-align: left; }
main ul { margin: 3px 0 6px; padding-left: 18px; }
main li { margin: 1px 0; text-align: left; }
/* Tighten the skills section so the first experience entry fits on page 1. */
main h2 + ul { margin-top: 2px; }
/* Body emphasis IS bold. The model marks the job description's technologies in
   the bullets, and those keywords are exactly what a recruiter skims and an ATS
   scores, so they need to stand off the surrounding prose rather than blend in.
   Styles that want a different weight override this per selector. */
main strong { color: #14181e; font-weight: 700; }
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
.proj-desc { margin-top: 1px; text-align: left; }
.project { margin: 0 0 8px; break-inside: avoid; }
/* Contacts and the professional title WRAP rather than clip. They used to be
   nowrap + overflow:hidden, which silently cut off whatever didn't fit — an
   email, a phone number, or the tail of a title like
   "Senior Backend Engineer | Go, MongoDB, Docker, Kubernetes". Text a reader
   can't see is text an ATS scores against a job it can't match. */
.contacts { font-size: 8.5pt; white-space: normal; overflow-wrap: anywhere; }
.title { margin-top: 4px; font-size: 11pt; color: #5a6573; white-space: normal; overflow-wrap: anywhere; }
/* A role heading is kept with its first bullet (the .kh block never splits);
   the remaining bullets flow to the next page, so headings are never stranded
   and there is no large blank gap. */
main h2, main h3 { break-after: avoid; }
.kh { break-inside: avoid; }
.kh-first { margin-bottom: 0; }
.kh-rest { margin-top: 0; }
/* A gap between one role and the next, so where a job ends and the next begins
   is clear without drawing a line across the page. Only an entry that FOLLOWS
   another entry gets it: the first role in a section is preceded by its h2,
   which breaks the adjacency, and education entries follow an h2 or each other
   rather than a bullet list, so they never match. Each selector covers a
   different entry shape — .kh is the generic wrapper, and the centered, formal
   and timeline templates restructure roles into their own blocks. */
main ul + .kh,
main .kh + .kh,
main ul + .ctr-head,
main ul + .fm-head,
main ul + h3,
main .tl-entry + .tl-entry:not(.tl-edu-entry) {
  margin-top: 20px;
}
/* Nothing that carries a sentence may be cut by a page break. A bullet, the
   summary, a skills line, a project description or an education entry that
   doesn't fit at the foot of a page moves to the next one whole. Beyond reading
   badly, a sentence split across the fold comes back from a PDF text extractor
   as two fragments, so an ATS matching a phrase can miss it. orphans/widows stay
   as a fallback for renderers that ignore break-inside. */
main li, main p, .proj-head, .proj-desc, .edu-line, .edu-org, .role-org,
.fm-head, .ctr-head, .bd-meta, .bd-edu, .tl-date, .tl-loc, .tl-company,
.edu-ctr-degree, .edu-ctr-org, .edu-ctr-period { break-inside: avoid; }
main p { orphans: 2; widows: 2; }
a { text-decoration: none; }
/* Header contact links follow the contact-line colour (visible on every style,
   including coloured-header templates) instead of the accent. */
.contacts a { color: inherit; }
/* The line(s) under the role - services and main technologies: smaller than
   the role and lighter than the name and role, in every template. Relative to
   the role, so it scales with each template's own title size. */
.title-sub { display: block; margin-top: 2px; font-size: .8em; font-weight: 400; opacity: .72; }
.title-stack { opacity: .72; }
@page { size: A4; margin: 14mm 8mm; }
`;

// Spectrum style: a fixed palette, never the colour pickers. The header is pink,
// then each section takes the next colour in turn (About, Skills, Experience,
// Education, Volunteer… cycling if there are more).
const SP_HEAD_COLOR = "#c676b0";
const SP_COLORS = ["#7e56a1", "#5873b6", "#d9a466", "#e5e56b", "#bddca8", "#c676b0"];

// Templates whose footer (name + "page of pages") is printed on every page.
export const PAGE_FOOTER_STYLES = new Set(["spectrum"]);

// Distinct visual template per style id. `head` is the user-picked color (empty
// for "Default"). It recolors only the THEMEABLE parts — section headings
// (categories), dividers/rules, and header backgrounds — while the candidate's
// NAME (headline) and the job ROLE TITLES keep a fixed dark color so they never
// change with the picker. `accent` already follows the pick for elements that
// were always themed; `head || <default>` themes the rest without altering the
// Default appearance.
function templateCss(id, accent, head, nameColor) {
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
main h2{font-size:10pt;color:${head || "#6b7280"};text-transform:uppercase;letter-spacing:.8px;border-bottom:1px solid ${head || "#e5e7eb"};padding-bottom:4px;margin:22px 0 8px;font-weight:600;}
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
.title{grid-column:1;grid-row:2;margin-top:5px;color:${accent};text-transform:uppercase;letter-spacing:.8px;font-weight:700;font-size:10pt;white-space:normal;}
.contacts{grid-column:2;grid-row:1/3;align-self:start;justify-self:end;text-align:right;color:#5a6573;font-size:8.5pt;line-height:1.7;white-space:normal;max-width:255px;word-break:break-word;}
.cd-c{display:flex;justify-content:flex-end;align-items:center;gap:7px;}
.cd-c > span{min-width:0;}
.cd-c svg{flex:0 0 auto;width:13px;height:13px;color:${head || "#1b3a5e"};}
.cd-c .nw-in{stroke:#fff;}
main h2{font-size:11pt;color:${head || "#1b3a5e"};text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid ${accent};padding-bottom:3px;margin:16px 0 8px;}
main ul{list-style:none;padding-left:2px;}
main li{position:relative;padding-left:15px;}
main li::before{content:"\\2022";color:${accent};position:absolute;left:0;font-weight:700;}
main h3{font-size:11pt;color:#333333;font-weight:700;margin-bottom:0;}
a{color:${accent};}
.summary-box{border:1.5px solid ${accent};border-radius:9px;padding:2px 16px 12px;margin-bottom:8px;background:${accent}0d;}
.summary-box h2{border:none;color:${accent};margin:10px 0 4px;}
.skills-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin:4px 0 8px;}
.skill-card.skill-card-wide{grid-column:1/-1;}
.skill-card{border:1px solid #e2e6ec;border-top:2px solid ${accent};border-radius:7px;padding:8px 10px;background:#f7f9fb;break-inside:avoid;}
.skill-cat{color:${accent};text-transform:uppercase;letter-spacing:.5px;font-size:8.5pt;font-weight:700;margin-bottom:3px;}
.skill-items{font-size:9.5pt;color:#3a4250;}
.role-org{color:#6a7280;font-size:9.5pt;font-weight:400;margin:0 0 4px;}
.role-dates{float:right;color:#7a8390;font-weight:400;font-size:9.5pt;}`;
    case "timeline":
      return `body{font-family:Calibri,"Segoe UI",Arial,sans-serif;}
header{margin-bottom:14px;}
header h1{margin:0;font-size:26pt;font-weight:800;color:#1a1a1a;letter-spacing:.3px;}
.title{margin-top:3px;color:${accent};font-weight:700;font-size:12.5pt;white-space:normal;}
.contacts{margin-top:6px;color:#5a6573;}
main h2{font-size:12pt;color:${accent};text-transform:uppercase;letter-spacing:1px;border-bottom:1.5px solid ${head || "#d7dde5"};padding-bottom:3px;margin:18px 0 8px;font-weight:700;}
main p.skills strong{color:${accent};}
a{color:${accent};}
/* Timeline experience: date/location on the left, a vertical line with a dot,
   role + blue company + bullets on the right. */
.tl-entry{display:grid;grid-template-columns:118px 1fr;column-gap:16px;margin:0;}
.tl-side{text-align:right;padding-top:1px;}
.tl-date{font-weight:700;color:#333333;font-size:9.5pt;white-space:nowrap;}
.tl-loc{color:#6a7280;font-size:9pt;margin-top:2px;}
.tl-main{border-left:2px solid #d5dae2;padding:0 0 14px 18px;position:relative;}
.tl-main::before{content:"";position:absolute;box-sizing:border-box;left:-6px;top:3px;width:10px;height:10px;border-radius:50%;background:#1f2937;border:2px solid #ffffff;}
.tl-main h3{margin:0 0 1px;}
.tl-company{color:${accent};font-weight:700;font-size:10.5pt;margin:0 0 5px;}
.tl-main ul{margin:3px 0 0;padding-left:16px;}
/* Education entries share the rail. They carry no bullets, so the rail segment
   is shorter. The heading itself stays unweighted so the degree keeps its
   bold-terms / normal-connectives treatment ("**Bachelor's Degree** in
   **Computer Science**") rather than going uniformly bold as an h3. */
.tl-edu{padding-bottom:10px;}
.tl-edu h3{font-weight:400;font-size:11pt;color:#23272e;}
.tl-edu h3 .edu-degree{font-weight:700;color:#14181e;}`;
    case "classic":
      // A traditional, centered serif header (small-caps name + title, double
      // rule) with left bold section headings; each role shows "Role, Dates"
      // bold with the company/location italic below.
      return `body{font-family:Calibri,"Segoe UI",Arial,sans-serif;color:#111;}
header{text-align:center;margin-bottom:16px;}
header h1{margin:0;font-family:Georgia,"Times New Roman",serif;font-variant:small-caps;font-weight:600;font-size:24pt;letter-spacing:1px;color:#111;}
.title{font-family:Georgia,"Times New Roman",serif;font-variant:small-caps;font-weight:600;font-size:12pt;letter-spacing:.5px;color:#111;margin-top:4px;white-space:normal;}
/* The technology list drops to its own line beneath the role title. */
.title-stack{font-family:Georgia,"Times New Roman",serif;font-variant:small-caps;font-weight:600;font-size:10.5pt;letter-spacing:.4px;color:#333;margin-top:1px;white-space:normal;}
/* Contacts sit between two rules, each item led by its matching icon. Both rules
   take the picked content colour so the header reads as one system with the
   section headings; the icons take it too and sit a step larger than their text,
   which is what carries them at print size. */
.contacts{border-top:3px double ${head || accent};border-bottom:3px double ${head || accent};margin-top:8px;padding:8px 0;color:#333;font-size:9pt;text-align:center;display:flex;flex-wrap:wrap;justify-content:center;gap:4px 18px;}
.contact{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;}
.contact svg{width:14px;height:14px;flex:0 0 auto;fill:${head || accent};vertical-align:-2px;}
/* Section headings are flanked by rules that run out to both page edges. */
main h2{display:flex;align-items:center;gap:10px;font-size:13pt;font-weight:700;color:${head || "#111"};text-transform:none;border:none;margin:16px 0 7px;}
main h2::before,main h2::after{content:"";flex:1 1 auto;height:1px;background:currentColor;}
main h3{font-size:11pt;font-weight:700;color:#111;margin:10px 0 0;}
.role-dates{float:right;font-weight:400;color:#6a7280;font-size:9.5pt;}
.role-org{font-style:italic;color:#333;font-size:10pt;margin:0 0 4px;}
main p.skills strong{color:${head || "#111"};}
a{color:${accent};}`;
    case "centered":
      // Big centered serif name, the professional title in an outlined box, a
      // full-width grey contact band, and centered section headings flanked by
      // short rules. Each role shows "Company – Location" bold above an italic
      // accent "Job Title, Dates" line (both centered).
      return `body{font-family:Georgia,"Times New Roman",serif;color:#2b2b2b;}
header{text-align:center;margin-bottom:14px;}
header h1{margin:0;font-family:Georgia,"Times New Roman",serif;font-size:29pt;font-weight:700;color:#111;letter-spacing:.5px;}
.title{display:inline-block;margin-top:10px;padding:4px 16px;border:1px solid ${accent};color:#333;font-family:Arial,Helvetica,sans-serif;font-size:9pt;letter-spacing:.8px;text-transform:uppercase;white-space:normal;}
.contacts{margin-top:12px;padding:7px 10px;background:#efefef;color:#333;font-family:Arial,Helvetica,sans-serif;font-size:8.5pt;text-align:center;white-space:normal;}
main h2{display:flex;align-items:center;justify-content:center;gap:12px;border:none;font-size:11pt;font-weight:700;color:${accent};text-transform:uppercase;letter-spacing:.8px;margin:16px 0 6px;}
main h2::before,main h2::after{content:"";flex:0 0 auto;width:42px;height:2px;background:${accent};}
main ul{list-style:disc;padding-left:26px;}
main li{margin:2px 0;}
/* Centered role block: the role title and its stack lead in the picked content
   colour, then "Company - Country | Dates" as plain metadata beneath. */
.ctr-head{text-align:center;margin:10px 0 4px;break-inside:avoid;break-after:avoid;}
.ctr-role{color:${accent};font-weight:700;font-size:11pt;}
.ctr-org{margin-top:1px;color:#1a1a1a;font-weight:400;font-size:10pt;}
/* Education in the same centered block: degree, the school, then the study
   period last. The period stays a neutral grey — it is metadata, so it is
   deliberately left out of the picked content colour. */
.edu-ctr{margin:9px 0 4px;break-after:auto;}
.edu-ctr-degree{font-size:11pt;color:#1a1a1a;}
.edu-ctr-degree .edu-degree{font-weight:700;color:#1a1a1a;}
.edu-ctr-org{margin-top:1px;color:#3a4250;font-size:10pt;}
.edu-ctr-period{margin-top:1px;color:#5a6573;font-style:italic;font-size:10pt;}
a{color:${accent};}`;
    case "ats":
      // Maximally ATS-safe: single column, left-aligned (never justified),
      // standard sans-serif fonts, high-contrast near-black text, bold name /
      // job titles / company names, simple disc bullets, no colour fills, no
      // columns/tables/icons, generous standard margins. Contact sits in the
      // document body (not a page header/footer).
      return `body{font-family:"Open Sans","Roboto","Lato",Arial,Helvetica,sans-serif;color:#1a1a1a;text-align:left;}
header{margin-bottom:14px;padding-bottom:9px;border-bottom:1.5px solid #333;}
header h1{margin:0;font-size:22pt;font-weight:700;color:#000;letter-spacing:.2px;}
.title{margin-top:3px;font-size:11.5pt;font-weight:700;color:#1a1a1a;}
.contacts{margin-top:6px;color:#1a1a1a;font-size:9.5pt;}
main h2{font-size:11.5pt;font-weight:700;color:#000;text-transform:uppercase;letter-spacing:.3px;border-bottom:1px solid #444;padding-bottom:2px;margin:16px 0 7px;}
main h3{font-size:11pt;font-weight:700;color:#000;margin:9px 0 0;}
.role-dates{float:right;font-weight:700;color:#1a1a1a;font-size:10pt;}
.role-org{font-weight:700;color:#1a1a1a;font-size:10pt;margin:1px 0 5px;}
main p,main li{text-align:left;}
main ul{list-style:disc;padding-left:20px;}
main li{margin:2px 0;}
main strong{color:#000;font-weight:700;}
main em{color:#1a1a1a;font-style:normal;font-weight:700;}
.edu-line .edu-degree{color:#000;}
a{color:#1a1a1a;text-decoration:underline;}
@page{size:A4;margin:18mm;}`;
    case "highlight":
      // Bold uppercase name on the left with the contacts stacked on the right,
      // a rule under the header, and section headings sitting in a shaded band.
      // Role/degree titles take the accent; bullets are hollow circles.
      return `body{font-family:"Segoe UI",Arial,Helvetica,sans-serif;color:#333;}
header{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;column-gap:20px;border-bottom:1px solid ${accent};padding-bottom:12px;margin-bottom:14px;}
header h1{grid-column:1;grid-row:1;margin:0;font-size:24pt;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#1a1a1a;line-height:1.06;}
.title{grid-column:1;grid-row:2;margin-top:6px;color:${accent};text-transform:uppercase;letter-spacing:1px;font-weight:700;font-size:9pt;white-space:normal;}
.contacts{grid-column:2;grid-row:1/3;align-self:start;justify-self:end;text-align:right;color:#333;font-size:8.5pt;line-height:1.7;white-space:normal;max-width:250px;word-break:break-word;}
/* The heading band is tinted from the Name picker — the same colour the name
   and title carry — at low alpha so the dark label text keeps its contrast.
   Falls back to the original warm grey when the picker is on Default. */
main h2{display:inline-block;background:${nameColor ? nameColor + "26" : "#ece7e1"};color:#1a1a1a;font-size:10pt;font-weight:700;text-transform:uppercase;letter-spacing:.8px;border:none;padding:3px 9px;margin:14px 0 7px;}
main h3{color:${accent};font-weight:700;font-size:10.5pt;margin:8px 0 0;}
.role-dates{float:right;color:#6a7280;font-weight:400;font-size:9.5pt;}
.role-org{color:#6a7280;font-size:9.5pt;margin:1px 0 5px;}
main ul{list-style:none;padding-left:18px;}
main li{position:relative;padding-left:14px;}
main li::before{content:"\\25CB";color:${accent};position:absolute;left:0;top:2px;font-size:7pt;}
.edu-line .edu-degree{color:${accent};}
main p.skills strong{color:#1a1a1a;}
a{color:${accent};}`;
    case "darkheader":
      // Full-width dark header band (name left, contacts stacked right), the
      // summary in a grey band beneath it, plain uppercase section labels, and
      // entries whose dates sit on the italic company line.
      return `body{font-family:"Segoe UI",Arial,Helvetica,sans-serif;color:#2b2b2b;}
header{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;column-gap:20px;background:${accent};color:#ffffff;padding:16px 20px;margin-bottom:0;}
header h1{grid-column:1;grid-row:1;margin:0;font-size:22pt;font-weight:700;color:#ffffff;letter-spacing:.3px;line-height:1.12;}
.title{grid-column:1;grid-row:2;margin-top:4px;color:#e4e4e4;font-size:9.5pt;font-weight:600;white-space:normal;}
.contacts{grid-column:2;grid-row:1/3;align-self:start;justify-self:end;text-align:right;color:#f2f2f2;font-size:8.5pt;line-height:1.7;white-space:normal;max-width:230px;word-break:break-word;}
.contacts a{color:#f2f2f2;}
.summary-box{background:#ebebeb;padding:9px 18px 11px;margin:0 0 13px;}
.summary-box h2{color:#4a4a4a;font-size:8pt;font-weight:700;text-transform:uppercase;letter-spacing:.8px;text-align:center;border:none;margin:0 0 4px;padding:0;}
.summary-box p{font-style:italic;font-size:9.5pt;text-align:center;color:#333;margin:0;}
main h2{font-size:9.5pt;font-weight:700;color:#1a1a1a;text-transform:uppercase;letter-spacing:.6px;border:none;margin:14px 0 5px;}
main h3{font-size:10.5pt;font-weight:700;color:#1a1a1a;margin:9px 0 0;}
.role-org{font-style:italic;color:#5a6070;font-size:9.5pt;margin:0 0 4px;}
.role-dates{float:right;font-style:italic;color:#5a6070;font-weight:400;font-size:9.5pt;}
main ul{list-style:disc;padding-left:22px;}
main li{margin:2px 0;}
a{color:${accent};}`;
    case "ribbon":
      // Name reversed out of a full-width colour ribbon, contacts on the line
      // below, and section headings in the same colour over a matching rule.
      return `body{font-family:"Segoe UI",Arial,Helvetica,sans-serif;color:#2b2b2b;}
header{margin-bottom:12px;}
header h1{margin:0;background:${accent};color:#ffffff;font-size:19pt;font-weight:700;padding:9px 14px;letter-spacing:.3px;}
.title{margin-top:7px;color:#3a4250;font-size:10pt;font-weight:600;white-space:normal;}
.contacts{margin-top:6px;color:#2b2b2b;font-size:8.5pt;white-space:normal;}
main h2{font-size:11pt;font-weight:600;color:${accent};text-transform:none;letter-spacing:0;border:none;border-bottom:1.2px solid ${accent};padding-bottom:2px;margin:14px 0 7px;}
main h3{font-size:10.5pt;font-weight:600;color:#1a1a1a;margin:9px 0 0;}
.role-org{color:#3a4250;font-size:10pt;margin:1px 0 4px;}
.role-dates{float:right;color:#3a4250;font-weight:400;font-size:10pt;}
main ul{list-style:disc;padding-left:22px;}
main li{margin:2px 0;}
.edu-line .edu-degree{color:#1a1a1a;}
a{color:${accent};}`;
    case "formal":
      // Traditional serif: centered rules-bracketed name, a centered summary,
      // section labels reversed out of solid boxes, and three centered lines
      // per entry (role, organization, dates) above left-aligned bullets.
      return `body{font-family:Georgia,"Times New Roman",serif;color:#222;}
header{text-align:center;border:2px solid ${accent};padding:10px 16px 9px;margin-bottom:11px;}
header h1{margin:0;font-size:21pt;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#111;}
.title{margin-top:5px;color:#444;font-size:10pt;white-space:normal;}
.contacts{margin-top:7px;color:#222;font-size:8.5pt;white-space:normal;}
/* The label keeps its solid box; the h2 around it is a plain row whose ::before
   and ::after rules run from the left edge up to the label and from the label
   out to the right edge. */
main h2{display:flex;align-items:center;gap:12px;margin:14px 0 7px;background:none;color:inherit;border:none;padding:0;}
main h2::before,main h2::after{content:"";flex:1 1 auto;height:2px;background:${accent};}
.fm-h2{flex:0 0 auto;background:${accent};color:#ffffff;font-size:9.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.8px;padding:3px 14px;}
.summary-box{margin:0 0 4px;}
.summary-box p{text-align:center;margin:0;}
main ul{list-style:disc;padding-left:26px;}
main li{margin:2px 0;}
/* Centered three-line entry head: the role title leads in bold and the picked
   content colour, with the company and its location left unweighted beneath. */
.fm-head{text-align:center;margin:10px 0 3px;break-inside:avoid;break-after:avoid;}
.fm-role{font-size:10.5pt;color:${accent};font-weight:700;}
.fm-org{font-weight:400;font-size:10.5pt;color:#111;}
.fm-dates{font-style:italic;color:#444;font-size:9.5pt;}
/* Education keeps its own weights — the degree leads, then the school, then the
   period last — so the experience treatment above never leaks into it. The
   school line stays unweighted; only the degree carries bold terms. */
.fm-edu-school{font-weight:400;font-size:10.5pt;color:#111;}
.fm-edu-degree{font-size:10.5pt;color:#222;}
.fm-edu-period{font-style:italic;color:#444;font-size:9.5pt;}
a{color:${accent};}`;
    case "banded":
      // Centered name + title inside a soft tinted panel, full-width centered
      // section bands, a tinted summary panel, and entries written as
      // "Role Title | Stack" over "Company | Location | Dates".
      return `body{font-family:"Segoe UI",Arial,Helvetica,sans-serif;color:#2f333b;}
header{background:${head ? head + "1f" : "#e9eaf3"};border-radius:9px;padding:16px 22px 14px;text-align:center;margin-bottom:14px;}
header h1{margin:0;font-size:23pt;font-weight:700;color:#1b1f27;letter-spacing:.2px;}
.title{margin-top:6px;color:#5a6070;font-size:8.5pt;text-transform:uppercase;letter-spacing:.8px;white-space:normal;}
.contacts{margin-top:9px;color:#4a5060;font-size:8.5pt;white-space:normal;}
/* The band stays tinted from the Content picker; the label text takes the Name
   picker, so the headings read with the name rather than against it. */
main h2{display:block;background:${head ? head + "1f" : "#e9eaf3"};color:${nameColor || "#1b1f27"};text-align:center;font-size:10pt;font-weight:700;text-transform:none;letter-spacing:.3px;border:none;border-radius:4px;padding:4px 10px;margin:14px 0 8px;}
.summary-box{background:${head ? head + "12" : "#f0f1f7"};border-radius:6px;padding:1px 14px 9px;margin-bottom:4px;}
.summary-box h2{margin:10px 0 7px;}
main h3{color:#1b1f27;font-weight:700;font-size:10.5pt;margin:9px 0 0;}
/* The thin separator between a title and its organization / dates. */
.bd-sep{color:#9aa1ae;font-weight:400;padding:0 3px;}
.bd-meta{color:#6a7280;font-size:9.5pt;margin:1px 0 5px;}
.bd-org{color:#1b1f27;font-weight:600;}
/* Education sits centered under its band: degree, school, then the period. */
.bd-edu{text-align:center;margin:9px 0 7px;break-inside:avoid;}
.bd-edu-degree{font-size:11pt;color:#1b1f27;}
.bd-edu-degree .edu-degree{font-weight:700;color:#1b1f27;}
.bd-edu-org{margin-top:1px;color:#2f333b;font-size:10pt;}
.bd-edu-period{margin-top:1px;color:#6a7280;font-size:9.5pt;}
main ul{list-style:disc;padding-left:24px;}
main li::marker{color:${accent};}
main p.skills strong{color:#1b1f27;}
a{color:${accent};}`;
    case "network": {
      // Navy and teal over a faint network of nodes at the top of every page:
      // name, teal title and the summary up top, contacts in a navy bar with a
      // lighter layer beneath, section headings led by an icon in a navy circle
      // with a three-colour divider between sections, and experience/education
      // on a navy rail with a teal dot per entry. The Content picker recolours
      // the navy (darkened) and the teal; the Name picker the name and title.
      const navy = head ? darkenHex(head, 0.55) : "#1e3448";
      return `body{font-family:Roboto,"Segoe UI",Arial,sans-serif;color:#23272e;}
.page{position:relative;}
.nw-bg{position:absolute;top:0;left:0;right:0;height:230px;z-index:0;pointer-events:none;}
.nw-bg svg{width:100%;height:100%;display:block;}
.nw-bg line{stroke:#e7e9ec;stroke-width:1.3;}
.nw-bg circle{fill:#eceef1;}
@media print{.nw-bg{position:fixed;}}
header,main{position:relative;z-index:1;}
header{margin-bottom:6px;}
header h1{margin:0;font-size:22pt;font-weight:700;color:${navy};letter-spacing:.2px;line-height:1.15;}
.title{margin-top:2px;font-size:13pt;color:${accent};font-weight:400;}
.nw-summary{margin-top:7px;font-size:10pt;line-height:1.45;color:#1f2329;}
.nw-summary p{margin:0 0 4px;text-align:left;}
.contacts{position:relative;margin:14px 0 22px;background:${navy};color:#fff;border-radius:7px;padding:8px 14px;display:flex;flex-wrap:wrap;justify-content:center;gap:4px 22px;font-size:9pt;}
.contacts::after{content:"";position:absolute;left:10px;right:10px;bottom:-9px;height:14px;background:#c8d0d8;border-radius:0 0 7px 7px;z-index:-1;}
.contacts a{color:#fff;}
.contact{display:inline-flex;align-items:center;gap:7px;white-space:nowrap;}
.contact svg{width:15px;height:15px;flex:0 0 auto;color:#fff;}
.contact .nw-in{stroke:${navy};}
.nw-div{display:flex;gap:4px;margin:18px 0 10px;break-after:avoid;}
.nw-div i{flex:1 1 0;height:5px;border-radius:3px;}
.nw-div i:nth-child(1){background:${accent}99;}
.nw-div i:nth-child(2){background:#c9cbce;}
.nw-div i:nth-child(3){background:${head ? head + "40" : "#c6d9ea"};}
main h2{display:flex;align-items:center;gap:9px;font-size:12.5pt;font-weight:700;color:${navy};text-transform:uppercase;letter-spacing:.2px;border:none;margin:10px 0 0 !important;padding:0;}
.nw-ico{flex:0 0 auto;width:28px;height:28px;border-radius:50%;background:${navy};color:#fff;display:inline-flex;align-items:center;justify-content:center;}
.nw-ico svg{width:17px;height:17px;}
main h2 + :not(.nw-rail){margin-top:8px;}
/* The rail runs down from the heading icon's centre; every entry but the last
   carries it on to the next, and the last keeps a stub up to its own dot. */
.nw-rail{margin:0 0 4px;}
.nw-entry{position:relative;margin-left:13px;padding:8px 0 12px 24px;border-left:2px solid ${navy};}
.nw-entry:last-child{border-left-color:transparent;padding-bottom:2px;}
.nw-entry:last-child::after{content:"";position:absolute;left:-2px;top:0;height:14px;border-left:2px solid ${navy};}
.nw-entry::before{content:"";position:absolute;left:-7.5px;top:13px;width:9px;height:9px;border-radius:50%;background:${accent};border:2px solid #fff;z-index:1;}
.nw-head{break-inside:avoid;break-after:avoid;}
.nw-entry h3{margin:0;font-size:11pt;font-weight:700;color:#14181e;}
.nw-entry h3 .edu-degree{font-weight:700;color:#14181e;}
.nw-company{margin-top:1px;font-size:10.5pt;color:#23272e;display:flex;align-items:center;gap:6px;}
.nw-company svg{width:11px;height:11px;color:${accent};flex:0 0 auto;}
.nw-loc{color:#6a7280;font-size:9.5pt;}
.nw-dates{margin-top:1px;font-size:9.5pt;color:#2b3038;}
.nw-label{margin:7px 0 2px;color:${accent};font-weight:600;font-size:9.5pt;}
main ul{list-style:none;padding-left:0;margin:2px 0 0;}
main li{position:relative;padding-left:12px;margin:2px 0;}
main li::before{content:"";position:absolute;left:1px;top:.55em;width:5px;height:5px;border-radius:50%;background:${accent};}
.nw-skills{display:grid;grid-template-columns:1fr 1fr;column-gap:30px;row-gap:12px;margin:10px 0 2px;}
.nw-skill{break-inside:avoid;}
.nw-skill-wide{grid-column:1/-1;}
.nw-skill-cat{font-weight:700;font-size:10pt;color:#14181e;margin-bottom:2px;}
.nw-skill-items{font-size:9pt;line-height:1.4;color:#23272e;}
.nw-langs{display:grid;grid-template-columns:repeat(3,1fr);gap:10px 24px;margin:10px 0 2px;}
.nw-lang{break-inside:avoid;}
.nw-lang-name{font-weight:700;font-size:10.5pt;color:#14181e;}
.nw-lang-level{font-style:italic;font-size:9.5pt;color:${accent};}
.nw-chips{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 2px;}
.nw-chip{display:inline-flex;align-items:center;gap:6px;border:1.2px solid ${navy};border-radius:6px;padding:3px 9px;font-size:10pt;color:#14181e;break-inside:avoid;}
.nw-chip svg{width:15px;height:15px;color:${navy};}
main p.skills strong{color:#14181e;}
a{color:${accent};}`;
    }
    case "spectrum":
      // A coloured band down the left edge, one colour per section; a bold
      // uppercase name and title with the contacts stacked on the right; light
      // uppercase section headings over a hairline that starts in the section's
      // colour; "Role at Company" with the dates on the right. Fixed colours.
      return `@page{size:A4;margin:10mm 12mm 16mm 0;}
body{font-family:Poppins,Montserrat,"Segoe UI",Arial,sans-serif;color:#2b2b2b;font-size:9.5pt;line-height:1.45;letter-spacing:.15px;}
.page{padding-left:16mm;}
@media screen{.page{padding:30px 34px 30px 76px;overflow:hidden;}}
.sp-sec{position:relative;display:flow-root;padding-top:12px;}
.sp-sec::before{content:"";position:absolute;left:-16mm;width:6.5mm;top:0;bottom:0;background:var(--c);}
@media screen{.sp-sec::before{left:-76px;width:26px;}}
.sp-head{padding:4px 0 16px;margin:0;}
.sp-row{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;margin-top:4px;}
.sp-head h1{margin:0;font-size:30pt;font-weight:700;color:#1d1d1d;text-transform:uppercase;letter-spacing:2.5px;line-height:1.1;}
.sp-head .title{margin-top:4px;font-size:14pt;font-weight:500;color:#1d1d1d;text-transform:uppercase;letter-spacing:1.5px;}
.sp-head .title-sub{font-size:10.5pt;text-transform:none;letter-spacing:.3px;}
.sp-contacts{text-align:right;font-size:9pt;line-height:1.35;color:#5a5a5a;padding-top:2px;flex:0 0 auto;max-width:48%;}
.sp-c{display:flex;justify-content:flex-end;align-items:center;gap:7px;margin:0 0 3px;}
.sp-c > span{min-width:0;overflow-wrap:anywhere;}
.sp-c svg{flex:0 0 auto;width:11px;height:11px;fill:currentColor;}
.sp-contacts a{color:#5a5a5a;}
.sp-sec > h2{display:flex;align-items:center;margin:0 0 8px;padding:0;border:none;font-size:14pt;font-weight:400;color:#1d1d1d;text-transform:uppercase;letter-spacing:1.3px;}
.sp-line{flex:1 1 auto;position:relative;height:1px;background:#9c9c9c;margin-left:24px;}
.sp-line::before{content:"";position:absolute;left:0;top:-1px;width:170px;height:3px;background:var(--c);}
.sp-sec > p{margin:0 0 6px;}
.sp-sub{font-weight:600;font-size:10pt;color:#1d1d1d;margin:8px 0 3px;}
.sp-sub:first-of-type{margin-top:2px;}
.sp-items{margin:0 0 4px !important;}
main h3,.sp-edu{display:block;margin:10px 0 4px;font-size:10.5pt;font-weight:600;color:#1d1d1d;}
.sp-sec > h3:first-of-type,.sp-sec > .kh:first-of-type h3,.sp-sec > .sp-edu:first-of-type{margin-top:2px;}
.role-dates{float:right;color:#1d1d1d;font-weight:600;font-size:10.5pt;}
main ul{margin:2px 0 8px;padding-left:24px;}
main li{margin:3px 0;padding-left:4px;}
main li::marker{color:#2b2b2b;font-size:9pt;}
main ul + .kh,main .kh + .kh,main ul + h3{margin-top:0;}
main strong{font-weight:600;color:#1d1d1d;}
a{color:#2b2b2b;}`;
    case "nexus": {
      // Serif and monochrome over a faint grey network of nodes: the name,
      // title and summary, then a full-width band with the contacts in two
      // columns; plain uppercase section headings; skills as label / items rows;
      // each role opened by a short tick from the page edge, with its dates on
      // the left and location in italics on the right, over ring bullets. The
      // Content picker recolours the band, ticks and bullets (default near-black);
      // the Name picker the name and title.
      const ink = head || "#1a1a1a";
      return `@page{size:A4;margin:12mm 0 14mm 0;}
body{font-family:Lora,Georgia,Cambria,"Times New Roman",serif;color:#1c1c1c;font-size:9pt;line-height:1.38;}
.page{position:relative;padding:0 14mm;}
@media screen{.page{padding:30px 14mm;overflow:hidden;}}
.nx-bg{position:absolute;z-index:0;pointer-events:none;}
.nx-bg svg{display:block;width:100%;height:100%;}
.nx-bg line{stroke:#e9e9e9;stroke-width:1.2;}
.nx-bg circle{fill:#e6e6e6;}
.nx-bg-top{top:0;right:0;width:470px;height:300px;}
.nx-bg-bottom{right:0;bottom:0;width:360px;height:230px;}
@media print{.nx-bg{position:fixed;}}
header,main{position:relative;z-index:1;}
header{margin-bottom:4px;}
header h1{margin:0;font-size:25pt;font-weight:400;color:#111;line-height:1.1;}
.title{margin-top:3px;font-size:13pt;font-weight:400;color:#1c1c1c;}
.nx-summary{margin-top:8px;font-size:9.5pt;line-height:1.4;color:#1c1c1c;}
.nx-summary p{margin:0 0 4px;text-align:left;}
.contacts.nx-band{margin:16px -14mm 0;padding:10px 14mm;background:${ink};color:#ececec;display:grid;grid-template-columns:1fr 1fr;gap:8px 30px;font-size:9.5pt;font-weight:400;}
.nx-band a{color:#ececec;}
.contact{display:inline-flex;align-items:center;gap:9px;min-width:0;overflow-wrap:anywhere;}
.contact svg{flex:0 0 auto;width:16px;height:16px;color:#fff;}
main h2{margin:24px 0 10px !important;padding:0;border:none;font-size:14pt;font-weight:400;color:#111;text-transform:uppercase;letter-spacing:.2px;}
.nx-skills{display:grid;grid-template-columns:118px 1fr;gap:9px 14px;margin:2px 0;}
.nx-skill-cat{font-weight:700;color:#111;}
.nx-entry{position:relative;margin:0 0 4px;}
.nx-entry + .nx-entry{margin-top:20px;}
.nx-entry::before{content:"";position:absolute;left:-14mm;width:calc(14mm - 7px);top:10px;height:1.6px;background:${ink};}
.nx-head{break-inside:avoid;break-after:avoid;}
.nx-entry h3{margin:0;font-size:13pt;font-weight:400;color:#111;line-height:1.2;}
.nx-entry h3 .edu-degree{font-weight:400;color:#111;}
.nx-company{display:flex;justify-content:space-between;align-items:baseline;gap:16px;font-size:13pt;color:#1c1c1c;line-height:1.2;}
.nx-meta{margin-top:4px;font-size:8pt;color:#333;}
.nx-loc{flex:0 0 auto;font-size:8pt;font-style:italic;color:#333;}
main ul{list-style:none;padding-left:0;margin:5px 0 0;}
main li{position:relative;padding-left:13px;margin:3px 0;}
main li::before{content:"";position:absolute;left:1px;top:.42em;width:5px;height:5px;border-radius:50%;border:1.4px solid ${ink};}
main strong{font-weight:700;color:#111;}
main p.skills strong{color:#111;}
a{color:#1c1c1c;}`;
    }
    case "slate": {
      // Dark slate and gold: a light name, gold title and the summary beside a
      // slate contact card (each contact in a white tile); faint chevron line-art
      // in two corners of every page; section headings led by a slate icon tile
      // with gold tabs behind it and followed by gold / slate / gold bars; roles
      // with gold italic dates over gold square bullets. The Content picker
      // recolours the gold; the slate stays. The Name picker the name and title.
      const gold = accent;
      const pale = mixWhite(gold, 0.45);
      const dark = "#2b313b";
      return `body{font-family:Ubuntu,"Open Sans","Segoe UI",Arial,sans-serif;color:#23272e;font-size:9pt;line-height:1.38;}
.page{position:relative;}
.sl-bg{position:absolute;z-index:0;pointer-events:none;}
.sl-bg svg{display:block;width:100%;height:100%;}
.sl-bg-tl{top:0;left:0;width:330px;height:150px;}
.sl-bg-br{right:0;bottom:0;width:330px;height:170px;}
@media print{.sl-bg{position:fixed;}}
header,main{position:relative;z-index:1;}
header{display:flow-root;margin-bottom:6px;}
.sl-left{padding-top:6px;}
header h1{margin:0;font-size:25pt;font-weight:400;color:${dark};letter-spacing:.2px;line-height:1.1;}
.title{margin-top:2px;font-size:12.5pt;font-weight:400;color:${gold};}
.sl-summary{margin-top:9px;font-size:9pt;line-height:1.42;color:#23272e;}
.sl-summary p{margin:0 0 4px;text-align:left;}
.contacts.sl-card{float:right;width:252px;margin:0 0 12px 26px;background:${dark};color:#fff;border-radius:6px;padding:16px;display:flex;flex-direction:column;gap:11px;font-size:9pt;font-weight:400;}
.sl-card a{color:#fff;font-weight:400;}
.sl-c{display:flex;align-items:center;gap:12px;min-width:0;}
.sl-c > span:last-child{min-width:0;overflow-wrap:anywhere;}
.sl-c-ico{flex:0 0 26px;width:26px;height:26px;border-radius:6px;background:#fff;color:${dark};display:inline-flex;align-items:center;justify-content:center;}
.sl-c-ico svg{width:15px;height:15px;}
.sl-c-ico .nw-in{stroke:#fff;}
main h2{display:flex;align-items:center;gap:10px;margin:22px 0 12px !important;padding:0 0 0 14px;border:none;font-size:14pt;font-weight:700;color:${dark};text-transform:uppercase;letter-spacing:.2px;}
.sl-ico{flex:0 0 30px;width:30px;height:30px;border-radius:7px;background:${dark};color:#fff;display:inline-flex;align-items:center;justify-content:center;box-shadow:-9px 0 0 -3px ${gold},-15px 0 0 -5px ${pale};}
.sl-ico svg{width:17px;height:17px;}
.sl-h2-text{flex:0 0 auto;}
.sl-bars{flex:1 1 auto;display:flex;gap:7px;margin-left:28px;}
.sl-bars i{flex:1 1 0;height:5px;border-radius:3px;background:${gold};}
.sl-bars i:nth-child(2){background:${dark};}
.sl-entry{margin:0 0 4px;}
.sl-entry + .sl-entry{margin-top:16px;}
.sl-head{break-inside:avoid;break-after:avoid;}
.sl-entry h3{margin:0;font-size:12pt;font-weight:700;color:#14181e;}
.sl-entry h3 .edu-degree{font-weight:700;color:#14181e;}
.sl-company{margin-top:1px;font-size:12pt;color:#23272e;}
.sl-loc{color:#6a7280;font-size:9.5pt;}
.sl-dates{margin-top:3px;font-size:8.5pt;font-style:italic;color:${gold};}
main ul{list-style:none;padding-left:0;margin:6px 0 0;}
main li{position:relative;padding-left:15px;margin:3px 0;}
main li::before{content:"";position:absolute;left:1px;top:.3em;width:7px;height:7px;border-radius:2px;background:${gold};}
.sl-skills{display:grid;grid-template-columns:1fr 1fr;column-gap:34px;row-gap:16px;margin:4px 0 2px;}
.sl-skill{display:grid;grid-template-columns:118px 1fr;column-gap:10px;break-inside:avoid;}
.sl-skill-wide{grid-column:1/-1;}
.sl-skill-cat{font-weight:700;font-size:9pt;color:#14181e;}
.sl-skill-items{font-size:9pt;line-height:1.42;color:#23272e;}
main p.skills strong{color:#14181e;}
a{color:${gold};}`;
    }
    case "diamond": {
      // Clean and light: a large regular-weight name, a teal title, the summary
      // and a centred row of solid contact icons up top; each section heading
      // led by a diamond badge and followed by a pale rule that ends in small
      // diamonds; skills in two label/items columns; roles as title, company and
      // italic dates over hollow-diamond bullets. The Content picker recolours
      // the badge, rules, bullets and (darkened) the title, dates and icons; the
      // Name picker the name and title.
      const teal = head ? darkenHex(head, 0.62) : "#1d5a6e";
      const soft = mixWhite(accent, 0.7);
      const bullet = mixWhite(accent, 0.5);
      const ink = head ? darkenHex(head, 0.5) : "#1f3c5a";
      return `body{font-family:Ubuntu,"Open Sans","Segoe UI",Arial,sans-serif;color:#23272e;font-size:9pt;line-height:1.38;}
header{margin-bottom:4px;}
header h1{margin:0;font-size:25pt;font-weight:400;color:#16191e;letter-spacing:.2px;line-height:1.1;}
.title{margin-top:3px;font-size:12pt;font-weight:400;color:${teal};}
.dm-summary{margin-top:10px;font-size:9pt;line-height:1.42;color:#23272e;}
.dm-summary p{margin:0 0 4px;text-align:left;}
.contacts{display:flex;flex-wrap:wrap;justify-content:center;gap:4px 34px;margin:16px 0 8px;font-size:9pt;color:#23272e;}
.contacts a{color:#23272e;}
.contact{display:inline-flex;align-items:center;gap:9px;white-space:nowrap;}
.contact svg{width:15px;height:15px;flex:0 0 auto;color:${ink};}
main h2{display:flex;align-items:center;gap:10px;margin:22px 0 12px !important;padding:0;border:none;font-size:14pt;font-weight:700;color:#14181e;text-transform:uppercase;letter-spacing:.3px;}
.dm-badge{flex:0 0 auto;width:22px;height:22px;color:${accent};display:inline-flex;}
.dm-badge svg{width:22px;height:22px;}
.dm-rule{flex:1 1 auto;position:relative;height:2px;background:${soft};margin:0 6px 0 26px;}
.dm-rule::before,.dm-rule::after{content:"";position:absolute;top:50%;width:7px;height:7px;background:${soft};transform:translate(-50%,-50%) rotate(45deg);}
.dm-rule::before{left:0;}
.dm-rule::after{left:100%;}
.dm-entry{margin:0 0 4px;}
.dm-entry + .dm-entry{margin-top:16px;}
.dm-head{break-inside:avoid;break-after:avoid;}
.dm-entry h3{margin:0;font-size:12pt;font-weight:700;color:#14181e;}
.dm-entry h3 .edu-degree{font-weight:700;color:#14181e;}
.dm-company{margin-top:1px;font-size:12pt;color:#23272e;}
.dm-loc{color:#6a7280;font-size:9.5pt;}
.dm-dates{margin-top:3px;font-size:8pt;font-style:italic;color:${teal};}
main ul{list-style:none;padding-left:0;margin:6px 0 0;}
main li{position:relative;padding-left:15px;margin:2px 0;}
main li::before{content:"";position:absolute;left:2px;top:.42em;width:5.5px;height:5.5px;border:1.2px solid ${bullet};transform:rotate(45deg);}
.dm-skills{display:grid;grid-template-columns:1fr 1fr;column-gap:34px;row-gap:16px;margin:4px 0 2px;}
.dm-skill{display:grid;grid-template-columns:118px 1fr;column-gap:10px;break-inside:avoid;}
.dm-skill-wide{grid-column:1/-1;}
.dm-skill-cat{font-weight:700;font-size:9pt;color:#14181e;}
.dm-skill-items{font-size:9pt;line-height:1.42;color:#23272e;}
main p.skills strong{color:#14181e;}
a{color:${teal};}`;
    }
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

// Blend a hex toward white by `t` (0 = unchanged, 1 = white): the pale tints
// some templates draw their rules and bullets in.
function mixWhite(hex, t = 0.5) {
  const h = String(hex || "").replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(h)) return hex;
  const n = parseInt(h, 16);
  const ch = (shift) => Math.round(((n >> shift) & 255) * (1 - t) + 255 * t).toString(16).padStart(2, "0");
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

// A role heading reads "Role | Tech1, Tech2, Tech3 — Company · Location | Dates".
// The role title now carries a pipe of its own, so the trailing pipe segment is
// only the date range when it actually reads as one — otherwise a heading with
// no dates donates its last technology (or the whole company) to the date slot.
function looksLikeDates(s) {
  const t = String(s || "").trim();
  if (!t) return false;
  return /\b(19|20)\d{2}\b/.test(t) || /\b(present|current|now|ongoing)\b/i.test(t);
}

// A trailing legal suffix is part of the company name, never a place.
const CORP_SUFFIX =
  /^(inc|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|holdings|group|gmbh|ag|kg|sa|sas|sarl|bv|nv|ab|as|oy|aps|plc|pty|srl|spa|s\.p\.a|kk|kft|zoo)\.?$/i;

// "Acme Corp, Berlin" -> "Acme Corp · Berlin", so the styles that split the org
// line on a middle dot (timeline, banded, centered) still find the location when
// the model wrote a comma instead.
function normalizeOrg(org) {
  const t = String(org || "").trim();
  if (!t || /[·•]/.test(t)) return t;
  const i = t.lastIndexOf(",");
  if (i === -1) return t;
  const tail = t.slice(i + 1).trim();
  if (!tail || CORP_SUFFIX.test(tail)) return t;
  return t.slice(0, i).trim() + " · " + tail;
}

// Split a role heading into its title, company·location, and dates.
function splitRoleHeading(head) {
  let main = head;
  let dates = "";
  const d = head.match(/^([\s\S]*?)\s*\|\s*([^|]+)$/);
  if (d && looksLikeDates(d[2])) {
    main = d[1].trim();
    dates = d[2].trim();
  }
  let roleTitle = main;
  let org = "";
  // An em/en dash separates the role from the company. A plain hyphen is
  // accepted only as a fallback, and only when the tail carries no pipe — that
  // keeps a hyphenated title ("Senior Engineer - Platform | Go, Docker") from
  // being read as a company.
  const o =
    main.match(/^([\s\S]*?)\s+[—–]\s+([\s\S]+)$/) ||
    main.match(/^([\s\S]*?)\s+-\s+([^|]+)$/);
  if (o) {
    roleTitle = o[1].trim();
    org = normalizeOrg(o[2].trim());
  }
  return { roleTitle, org, dates };
}

// Any section whose heading names a section: matches up to the next h2.
const SECTION_RE = (word) =>
  new RegExp(`<h2[^>]*>[^<]*(?:${word})[^<]*<\\/h2>[\\s\\S]*?(?=<h2|$)`, "i");
const EDUCATION_SECTION = SECTION_RE("Education");
const EXPERIENCE_SECTION = SECTION_RE("Experience|Employment|Work\\s+History|Career");

// Education belongs immediately after the work history, in every style. The
// model puts it wherever it likes — and when it omits the heading entirely the
// section used to be appended to the very end, landing after Projects. Lift it
// out of wherever it sits and re-attach it to the end of the experience section
// so the two always read as one continuous block.
function placeEducation(body, eduHtml) {
  const existing = body.match(EDUCATION_SECTION);
  const heading = existing
    ? (existing[0].match(/<h2[^>]*>[^<]*<\/h2>/i) || ["<h2>Education</h2>"])[0]
    : "<h2>Education</h2>";
  // Drop the model's own Education section from wherever it landed.
  const stripped = existing ? body.replace(EDUCATION_SECTION, "") : body;
  const block = `${heading}${eduHtml}`;
  return EXPERIENCE_SECTION.test(stripped)
    ? stripped.replace(EXPERIENCE_SECTION, (section) => `${section}${block}`)
    : stripped + block;
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

// Contact icons drawn inline so the PDF stays self-contained (no font or remote
// asset) and the text beside each one is still exactly what a parser reads.
const CONTACT_ICONS = {
  email:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 3h13c.28 0 .5.22.5.5v9c0 .28-.22.5-.5.5h-13a.5.5 0 0 1-.5-.5v-9c0-.28.22-.5.5-.5Zm.5 1.4V12h12V4.4L8 8.6 2 4.4ZM12.9 4H3.1L8 7.4 12.9 4Z"/></svg>',
  phone:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.2 1.6c.4 0 .7.2.9.6l1.1 2.3c.2.4.1.9-.2 1.2l-.9.9c.7 1.4 1.8 2.5 3.2 3.2l.9-.9c.3-.3.8-.4 1.2-.2l2.3 1.1c.4.2.6.5.6.9v2.1c0 .7-.6 1.3-1.3 1.2C7.1 13.6 2.4 8.9 1.9 2.9c-.1-.7.5-1.3 1.2-1.3h2.1Z"/></svg>',
  location:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1a5 5 0 0 0-5 5c0 3.6 4.3 8.4 4.5 8.6.3.3.7.3 1 0C8.7 14.4 13 9.6 13 6a5 5 0 0 0-5-5Zm0 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z"/></svg>',
  linkedin:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.1 5.6h2.3V14H3.1V5.6Zm1.2-3.7c.8 0 1.4.6 1.4 1.3s-.6 1.3-1.4 1.3-1.4-.6-1.4-1.3.6-1.3 1.4-1.3ZM7 5.6h2.2v1.2h.03c.3-.6 1.1-1.2 2.2-1.2 2.3 0 2.8 1.5 2.8 3.5V14h-2.3V9.6c0-1 0-2.4-1.4-2.4s-1.6 1.1-1.6 2.3V14H7V5.6Z"/></svg>',
  link:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm4.9 6h-2c-.1-1.5-.5-2.8-1-3.7A5.5 5.5 0 0 1 12.9 7ZM8 2.6c.6.7 1.2 2.1 1.3 4.4H6.7c.1-2.3.7-3.7 1.3-4.4ZM3.1 7a5.5 5.5 0 0 1 3-3.7c-.5.9-.9 2.2-1 3.7h-2Zm0 2h2c.1 1.5.5 2.8 1 3.7A5.5 5.5 0 0 1 3.1 9ZM8 13.4c-.6-.7-1.2-2.1-1.3-4.4h2.6c-.1 2.3-.7 3.7-1.3 4.4Zm1.9-.7c.5-.9.9-2.2 1-3.7h2a5.5 5.5 0 0 1-3 3.7Z"/></svg>',
};

// ---- Network style artwork ----------------------------------------------------
// Line icons (24-unit grid) drawn in currentColor, so CSS decides their colour.
const nwIcon = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

// Section heading icons, chosen by the heading's words (first match wins).
const NW_SECTION_ICONS = [
  [/experience|employment|\bwork\b|career/i, nwIcon('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12.5h18M10 12.5v1.8h4v-1.8"/>')],
  [/skill|technolog|competenc|expertise|stack/i, nwIcon('<circle cx="12" cy="12" r="6.3"/><path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7M10.6 10.2 8.9 12l1.7 1.8M13.4 10.2l1.7 1.8-1.7 1.8"/>')],
  [/education|academic|degree/i, nwIcon('<path d="M2 9.5 12 4.5l10 5-10 5z"/><path d="M6 11.5v4.6c0 1.6 2.7 3.2 6 3.2s6-1.6 6-3.2v-4.6M22 9.5V15"/>')],
  [/language/i, nwIcon('<path d="M3.5 5.5h9M8 3.5v2M5.8 5.5c.6 3.1 2.6 5.6 5.4 7M10.4 5.5c-.8 3.5-3.3 6.3-6.9 7.8"/><path d="M12.5 20.5l4-9.5 4 9.5M13.9 17.3h5.2"/>')],
  [/interest|hobb/i, nwIcon('<path d="M7.5 20.5h10M8.5 20.5c0-3 1-4.4 3.2-6.4-2 .2-3.6-.3-4.4-1.6l4-4.3c.5-1.7 1.6-3.2 3.2-4.2 1.3 2.3 2.5 4.8 2.5 8.4 0 3.6-.7 5.7-1 8.1"/>')],
  [/project|portfolio/i, nwIcon('<path d="M3 7a2 2 0 0 1 2-2h4.2l2 2.2H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>')],
  [/certif|licen/i, nwIcon('<circle cx="12" cy="9" r="5.2"/><path d="m8.6 13.2-1.6 7.8 5-3 5 3-1.6-7.8"/>')],
  [/award|achiev|honou?r|accomplish/i, nwIcon('<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3.3 4M16 6h3a3 3 0 0 1-3.3 4M12 13v4M8.5 21h7M10 17h4"/>')],
  [/publication|research|paper/i, nwIcon('<path d="M4.5 5a2 2 0 0 1 2-2h12.5v15.5H6.5a2 2 0 0 0-2 2z"/><path d="M4.5 20.5a2 2 0 0 1 2-2H19"/>')],
  [/summary|profile|about|objective/i, nwIcon('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.2 3.6-7 8-7s8 2.8 8 7"/>')],
];
const NW_DEFAULT_ICON = nwIcon('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>');
const nwSectionIcon = (heading) => (NW_SECTION_ICONS.find(([re]) => re.test(heading)) || [null, NW_DEFAULT_ICON])[1];

// Contact bar icons (outline, white on the navy bar).
const NW_CONTACT_ICONS = {
  email: nwIcon('<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>'),
  phone: nwIcon('<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18h2"/>'),
  linkedin: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2.5" fill="currentColor"/><path class="nw-in" d="M8 10.5V17M8 7.4v.1M11.6 17v-6.5M11.6 13.2c0-1.6 1-2.7 2.4-2.7s2.2 1 2.2 2.7V17" fill="none" stroke-width="2" stroke-linecap="round"/></svg>',
  link: nwIcon('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.4 2.5 3.5 5.5 3.5 9s-1.1 6.5-3.5 9c-2.4-2.5-3.5-5.5-3.5-9S9.6 5.5 12 3z"/>'),
  location: nwIcon('<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
};

// The small "open" glyph after a company name, as in the template it copies.
const NW_EXTERNAL = nwIcon('<path d="M14 4h6v6M20 4l-8.5 8.5M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>');

// Interest chips get a matching icon where one obviously fits.
const NW_INTEREST_ICONS = [
  [/basketball|football|soccer|tennis|volleyball|baseball|golf|sport|cricket|rugby/i, nwIcon('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3v18M5.7 5.7c3 3 3 9.6 0 12.6M18.3 5.7c-3 3-3 9.6 0 12.6"/>')],
  [/cook|bak|culinar|food|kitchen/i, nwIcon('<path d="M7 14.5a4 4 0 1 1 1.6-7.6 4 4 0 0 1 6.8 0A4 4 0 1 1 17 14.5V19H7z"/><path d="M7 16.5h10"/>')],
  [/hik|run|walk|trek|climb|marathon|fitness|gym|cycl|bik|yoga|swim/i, nwIcon('<circle cx="13.5" cy="4" r="1.8"/><path d="m9 21 2.6-6.2 2.6 2.2V21M11.6 14.8l1.2-5.3 2.9 2.6 2.3.5M12.8 9.5 9.4 10.7l-1 3.1"/>')],
  [/read|book|writ|poetry|literat|blog/i, nwIcon('<path d="M12 6.5C10.5 5 8 4.5 4 4.5v13c4 0 6.5.5 8 2 1.5-1.5 4-2 8-2v-13c-4 0-6.5.5-8 2zM12 6.5v13"/>')],
  [/music|guitar|piano|sing|drum|violin|concert/i, nwIcon('<path d="M9 18V5.5l11-2v12.5"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>')],
  [/photo|film|video|camera|movie|cinema/i, nwIcon('<rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="12" cy="13.5" r="3.5"/><path d="M8.5 7 10 4.5h4L15.5 7"/>')],
  [/gam|chess|esport|puzzle/i, nwIcon('<rect x="2.5" y="7" width="19" height="11" rx="5"/><path d="M7 10.8v3.4M5.3 12.5h3.4M15.5 12h.01M18 13.6h.01"/>')],
  [/travel|explor|trip|adventure/i, nwIcon('<path d="M10.5 13.5 3 11l1.5-1.5 7.5 1L17 5.5a1.8 1.8 0 0 1 2.5 2.5L14.5 13l1 7.5L14 22l-2.5-7.5z"/>')],
];
const NW_INTEREST_DEFAULT = nwIcon('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>');
const nwInterestIcon = (text) => (NW_INTEREST_ICONS.find(([re]) => re.test(text)) || [null, NW_INTEREST_DEFAULT])[1];

// The faint network of lines and nodes behind the top of every page.
const NW_NODES = [
  [300, 8, 6], [262, 40, 10], [330, 98, 8], [182, 92, 15], [424, 46, 11], [470, 28, 5],
  [528, 6, 4], [598, 38, 10], [650, 54, 4], [732, 28, 6], [722, 92, 18], [662, 150, 22],
  [560, 134, 7], [478, 150, 12], [622, 182, 6], [402, 162, 5], [262, 176, 8], [704, 204, 13],
  [96, 30, 7], [40, 120, 5],
];
const NW_EDGES = [
  [0, 1], [1, 3], [1, 2], [2, 4], [4, 5], [5, 6], [4, 7], [7, 8], [8, 9], [8, 10], [7, 11],
  [11, 12], [12, 13], [13, 2], [11, 14], [14, 17], [10, 17], [13, 15], [15, 16], [16, 3],
  [3, 18], [18, 19], [12, 7], [10, 9],
];
const NW_BACKGROUND =
  `<div class="nw-bg" aria-hidden="true"><svg viewBox="0 0 794 230" preserveAspectRatio="xMidYMin slice">` +
  NW_EDGES.map(([a, b]) => `<line x1="${NW_NODES[a][0]}" y1="${NW_NODES[a][1]}" x2="${NW_NODES[b][0]}" y2="${NW_NODES[b][1]}"/>`).join("") +
  NW_NODES.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join("") +
  `</svg></div>`;

// ---- Nexus style artwork --------------------------------------------------------
// The faint grey node network behind the header and the foot of each page —
// the Network template's drawing, in grey.
const nxNetwork = (w, h) =>
  `<svg viewBox="0 0 794 230" preserveAspectRatio="xMaxYMin slice" width="${w}" height="${h}">` +
  NW_EDGES.map(([a, b]) => `<line x1="${NW_NODES[a][0]}" y1="${NW_NODES[a][1]}" x2="${NW_NODES[b][0]}" y2="${NW_NODES[b][1]}"/>`).join("") +
  NW_NODES.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join("") +
  `</svg>`;
const NX_BACKGROUND =
  `<div class="nx-bg nx-bg-top" aria-hidden="true">${nxNetwork(470, 300)}</div>` +
  `<div class="nx-bg nx-bg-bottom" aria-hidden="true">${nxNetwork(360, 230)}</div>`;

// ---- Slate style artwork --------------------------------------------------------
// Faint chevron line-art for the top-left and bottom-right corners of each page.
const slChevrons = (paths, w, h) =>
  `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice"><g fill="none" stroke="#ececec" stroke-width="1.5" stroke-linejoin="round">${paths}</g></svg>`;
const SL_BACKGROUND =
  `<div class="sl-bg sl-bg-tl" aria-hidden="true">` +
  slChevrons(
    '<path d="M-10 18 52 66-10 114"/><path d="M30-6 100 52 30 110"/><path d="M78-6 148 52 78 110"/><path d="M150 0 214 46"/>' +
      '<path d="M214 46 276 0"/><path d="M110 150 172 98 234 150"/><path d="M196 18 252 62 308 18"/>',
    330, 150
  ) +
  `</div><div class="sl-bg sl-bg-br" aria-hidden="true">` +
  slChevrons(
    '<path d="M20 170 82 112 144 170"/><path d="M82 112 144 54 206 112"/><path d="M144 170 206 112 268 170"/><path d="M206 112 268 54 330 112"/>' +
      '<path d="M268 54 330 0"/><path d="M118 92 156 60"/><path d="M240 0 300 40 340 10"/><path d="M268 170 330 112"/>',
    330, 170
  ) +
  `</div>`;

// ---- Diamond style artwork ------------------------------------------------------
// The section badge: a rounded diamond in the accent (currentColor) with a white
// diamond outline inside it.
const DM_BADGE =
  '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  '<rect x="4.6" y="4.6" width="14.8" height="14.8" rx="2.6" transform="rotate(45 12 12)" fill="currentColor"/>' +
  '<rect x="8.3" y="8.3" width="7.4" height="7.4" rx="1" transform="rotate(45 12 12)" fill="none" stroke="#fff" stroke-width="1.7"/></svg>';

// Solid contact icons (currentColor, with white detail).
const DM_CONTACT_ICONS = {
  email:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="1.6" fill="currentColor"/>' +
    '<path d="m3.6 6.6 8.4 6.4 8.4-6.4" fill="none" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  phone:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="1.8" width="11" height="20.4" rx="2.4" fill="currentColor"/>' +
    '<rect x="8.6" y="4.6" width="6.8" height="12.2" rx=".7" fill="#fff"/><circle cx="12" cy="19.3" r="1.1" fill="#fff"/></svg>',
  location:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.8a7.4 7.4 0 0 0-7.4 7.4c0 5.4 7.4 13 7.4 13s7.4-7.6 7.4-13A7.4 7.4 0 0 0 12 1.8Z" fill="currentColor"/>' +
    '<circle cx="12" cy="9.2" r="2.7" fill="#fff"/></svg>',
  linkedin:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="2.5" width="19" height="19" rx="2.6" fill="currentColor"/>' +
    '<path d="M8 10.5V17M8 7.4v.1M11.6 17v-6.5M11.6 13.2c0-1.6 1-2.7 2.4-2.7s2.2 1 2.2 2.7V17" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>',
  link:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"/>' +
    '<path d="M2.6 12h18.8M12 2.4c2.5 2.6 3.6 5.8 3.6 9.6s-1.1 7-3.6 9.6c-2.5-2.6-3.6-5.8-3.6-9.6S9.5 5 12 2.4Z" fill="none" stroke="#fff" stroke-width="1.4"/></svg>',
};

// Which icon belongs beside a contact item. Mirrors linkifyContact's tests, so
// an item that becomes a mailto/tel/https link gets the matching glyph and
// anything left over (a city, an address) reads as a place.
function contactKind(t) {
  const s = String(t || "").trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return "email";
  if (/linkedin\.com/i.test(s)) return "linkedin";
  if ((s.match(/\d/g) || []).length >= 7 && /^[+()\d\s.\-]+$/.test(s)) return "phone";
  if (/^https?:\/\//i.test(s) || /^www\./i.test(s) || /^[^\s/]+\.[a-z]{2,}(?:[/?#]|$)/i.test(s)) return "link";
  return "location";
}

// Shared header markup (used by both the resume and the cover letter). For the
// "cards" and "highlight" styles the contact items stack vertically on the
// right. Each contact item is linkified so it's clickable in the PDF.
// Banded style separator: "Title | Company", "Dates | Location".
const BD_SEP = ' <span class="bd-sep">|</span> ';

const STACKED_CONTACTS = new Set(["cards", "highlight", "darkheader"]);
function headerHtml(id, name, title, contacts, summaryHtml = "", inkColor = "") {
  if (!name) return "";
  const raw = String(contacts || "")
    .split("  •  ")
    .map((s) => s.trim())
    .filter(Boolean);

  // Network: name, title, then the summary (lifted out of the body), then the
  // contacts in a navy bar, each led by its icon. LinkedIn shows just the handle.
  if (id === "network") {
    const contactsHtml = raw
      .map((t) => {
        const kind = contactKind(t);
        const handle = kind === "linkedin" ? t.replace(/^(?:https?:\/\/)?(?:www\.)?linkedin\.com\/(?:in\/)?/i, "").replace(/\/+$/, "") : "";
        const link = handle
          ? `<a href="https://${t.replace(/^https?:\/\//i, "").replace(/"/g, "%22")}">${escapeHtml(handle)}</a>`
          : linkifyContact(t);
        return `<span class="contact">${NW_CONTACT_ICONS[kind] || ""}${link}</span>`;
      })
      .join("");
    return (
      `<header><h1>${escapeHtml(name)}</h1>` +
      `${titleBlock(title)}` +
      `${summaryHtml ? `<div class="nw-summary">${summaryHtml}</div>` : ""}` +
      `${raw.length ? `<div class="contacts">${contactsHtml}</div>` : ""}</header>`
    );
  }

  // Nexus: name, title and the summary (lifted out of the body), then the
  // contacts in a full-width band, two to a row, each with a solid white icon
  // whose detail takes the band's colour.
  if (id === "nexus") {
    const band = inkColor || "#1a1a1a";
    const items = raw
      .map((t) => {
        const icon = (DM_CONTACT_ICONS[contactKind(t)] || "").replace(/#fff/g, band);
        return `<span class="contact">${icon}${linkifyContact(t)}</span>`;
      })
      .join("");
    return (
      `<header><h1>${escapeHtml(name)}</h1>` +
      `${titleBlock(title)}` +
      `${summaryHtml ? `<div class="nx-summary">${summaryHtml}</div>` : ""}` +
      `${raw.length ? `<div class="contacts nx-band">${items}</div>` : ""}</header>`
    );
  }

  // Slate: name, title and the summary (lifted out of the body) on the left; the
  // contacts in a slate card on the right, each in a white icon tile.
  if (id === "slate") {
    const items = raw
      .map((t) => `<div class="sl-c"><span class="sl-c-ico">${NW_CONTACT_ICONS[contactKind(t)] || ""}</span><span>${linkifyContact(t)}</span></div>`)
      .join("");
    // The card comes first and floats right at its own height; the name, title
    // and summary wrap beside it, and a summary longer than the card carries on
    // full-width beneath it.
    return (
      `<header>${raw.length ? `<div class="contacts sl-card">${items}</div>` : ""}` +
      `<div class="sl-left"><h1>${escapeHtml(name)}</h1>` +
      `${titleBlock(title, { stacked: true })}` +
      `${summaryHtml ? `<div class="sl-summary">${summaryHtml}</div>` : ""}</div></header>`
    );
  }

  // Spectrum: name and title on the left, the contacts stacked on the right —
  // place first, then phone, email and links — all on the pink band.
  if (id === "spectrum") {
    const order = { location: 0, phone: 1, email: 2, linkedin: 3, link: 4 };
    const lines = raw
      .map((t, i) => ({ t, k: order[contactKind(t)] ?? 5, i }))
      .sort((a, b) => a.k - b.k || a.i - b.i)
      .map(({ t }) => `<div class="sp-c"><span>${linkifyContact(t)}</span>${CONTACT_ICONS[contactKind(t)] || ""}</div>`)
      .join("");
    // The name has the full first row; under it the role, services and main
    // tech on the left, the contacts on the right with each icon after its text.
    return (
      `<header class="sp-sec sp-head" style="--c:${SP_HEAD_COLOR}"><h1>${escapeHtml(name)}</h1>` +
      `<div class="sp-row"><div>${titleBlock(title, { stacked: true })}</div>` +
      `${raw.length ? `<div class="contacts sp-contacts">${lines}</div>` : ""}</div></header>`
    );
  }

  // Diamond: name, title, the summary (lifted out of the body), then a centred
  // row of contacts, each led by its solid icon.
  if (id === "diamond") {
    const contactsHtml = raw
      .map((t) => `<span class="contact">${DM_CONTACT_ICONS[contactKind(t)] || ""}${linkifyContact(t)}</span>`)
      .join("");
    return (
      `<header><h1>${escapeHtml(name)}</h1>` +
      `${titleBlock(title)}` +
      `${summaryHtml ? `<div class="dm-summary">${summaryHtml}</div>` : ""}` +
      `${raw.length ? `<div class="contacts">${contactsHtml}</div>` : ""}</header>`
    );
  }

  // Classic: the role title and its technology list take separate lines, and the
  // contacts sit between two rules with an icon matching each item.
  if (id === "classic") {
    const { role, sub: stack } = titleParts(title);
    const contactsHtml = raw
      .map(
        (t) =>
          `<span class="contact">${CONTACT_ICONS[contactKind(t)] || ""}` +
          `${linkifyContact(t)}</span>`
      )
      .join("");
    return (
      `<header><h1>${escapeHtml(name)}</h1>` +
      `${role ? `<div class="title">${escapeHtml(role)}</div>` : ""}` +
      `${stack ? `<div class="title-stack">${escapeHtml(stack)}</div>` : ""}` +
      `${raw.length ? `<div class="contacts">${contactsHtml}</div>` : ""}</header>`
    );
  }

  const items = raw.map(linkifyContact);
  // Cards: one contact per line, each with its outline icon on the right.
  const contactsHtml =
    id === "cards"
      ? raw.map((t, i) => `<div class="cd-c"><span>${items[i]}</span>${NW_CONTACT_ICONS[contactKind(t)] || ""}</div>`).join("")
      : STACKED_CONTACTS.has(id)
      ? items.join("<br>")
      : items.join("  •  ");
  return (
    `<header><h1>${escapeHtml(name)}</h1>` +
    // Cards and Highlight: services and main tech each on their own line under
    // the role (the title shares its row with the contacts).
    `${titleBlock(title, { stacked: id === "cards" || id === "highlight" })}` +
    `${contacts ? `<div class="contacts">${contactsHtml}</div>` : ""}</header>`
  );
}

// The professional title on two lines: the role, then whatever follows its
// first "|" (the service and main technologies) — e.g. "Senior Software
// Engineer" over "Angular, TypeScript, AWS | Microservices & API Design". Kept
// in one .title element, so templates that place the title in a grid or style
// it as a box carry both lines.
// opts.stacked: every part on its own line - role, services, main tech - for
// headers where the title sits beside the contact card and has the height.
function titleBlock(title, opts = {}) {
  const { role, sub, parts } = titleParts(title);
  if (!role) return "";
  const lines = opts.stacked ? parts : sub ? [sub] : [];
  return `<div class="title">${escapeHtml(role)}${lines.map((l) => `<span class="title-sub">${escapeHtml(l)}</span>`).join("")}</div>`;
}

// Split a title into the role (before the first "|") and the line under it.
// That line reads service first, tech stack last: segments that are a
// comma-separated list of technologies move behind the others, so
// "Python, SQL, AWS | Data Engineering & Test Automation" becomes
// "Data Engineering & Test Automation | Python, SQL, AWS". Order within each
// group is kept.
function titleParts(title) {
  const full = String(title || "").trim();
  const segs = full.split("|").map((x) => x.trim()).filter(Boolean);
  if (!segs.length) return { role: "", sub: "", parts: [] };
  const rest = segs.slice(1);
  const isStack = (x) => x.includes(",");
  const parts = [...rest.filter((x) => !isStack(x)), ...rest.filter(isStack)];
  return { role: segs[0], sub: parts.join(" | "), parts };
}

// Optional font-family / size override (chosen in the UI), appended last so it
// wins over the template defaults.
function fontOverride(style) {
  let css = "";
  // Apply the chosen font to the header (name + title) too — templates set the
  // header font themselves, so `body` alone wouldn't change it.
  if (style && style.font) css += `body,header h1,.title{font-family:${style.font};}`;
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
    // Line 1 may pack "Name | Title | Tech | contacts…". Take the name, then
    // every NON-contact part as the title, still "|"-separated so the header
    // can put the role and the rest on their own lines.
    const firstParts = lines[idx]
      .trim()
      .replace(/^#{1,6}\s+/, "")
      .replace(/^\*\*|\*\*$/g, "")
      .replace(/^_+|_+$/g, "")
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    name = firstParts[0] || "";
    title = firstParts.slice(1).filter((x) => !isContactish(x)).join(" | ");
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

  // Name + contacts stay authoritative from the account, but the TITLE is the
  // tailored, per-job professional title the model generated — keep it, and only
  // fall back to the account's title when the resume didn't supply one.
  if (contactInfo) {
    if (contactInfo.name) name = contactInfo.name;
    if (!title) title = (contactInfo.title || "").trim();
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
            `<div class="skill-card${/soft\s*skill/i.test(nm) ? " skill-card-wide" : ""}"><div class="skill-cat">${nm.trim()}</div>` +
              `<div class="skill-items">${items.replace(/<br\s*\/?>/gi, "").trim()}</div></div>`
          );
          return mm;
        }
      );
      // Soft Skills spans the whole row and goes last, so it never sits alone
      // in a row of empty slots.
      const wide = (c) => c.includes("skill-card-wide");
      cards.sort((a, b) => wide(a) - wide(b));
      // And the last card of an incomplete row stretches to the end of it, so
      // the grid has no empty slots.
      const narrow = cards.filter((c) => !wide(c)).length;
      const spare = narrow % 3;
      if (spare) {
        const span = spare === 1 ? 3 : 2;
        cards[narrow - 1] = cards[narrow - 1].replace('class="skill-card"', `class="skill-card" style="grid-column:span ${span}"`);
      }
      return `<div class="skills-grid">${cards.join("")}</div>`;
    }
    // Each category becomes its own paragraph rather than one <br>-separated
    // block, so a single category can never be split across a page while the
    // section as a whole still flows. Margins are zeroed in the base CSS, so
    // this lays out exactly as the <br> version did.
    const parts = [];
    const lead = inner.slice(0, inner.indexOf("<strong>")).trim();
    if (lead) parts.push(`<p class="skills">${lead}</p>`);
    inner.replace(
      /<strong>([^<]*?:)<\/strong>\s*([\s\S]*?)(?=<strong>|$)/g,
      (_mm, lbl, items) => {
        const text = items.replace(/<br\s*\/?>/gi, " ").trim();
        parts.push(`<p class="skills"><strong>${lbl}</strong> ${text}</p>`);
        return _mm;
      }
    );
    return parts.length ? parts.join("") : m;
  });

  // Split every role heading "Title — Company · Location | Dates" into a title
  // line (with right-aligned dates) and a company·location line below. Applies
  // to ALL styles.
  body = body.replace(/<h3\b([^>]*)>([\s\S]*?)<\/h3>/g, (mm, attr, head) => {
    const { roleTitle, org, dates } = splitRoleHeading(head);
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
        // Centered style: education matches its centered role blocks — degree,
        // then the period, then the school, all stacked and centered (no
        // right-floated dates, which only work in a left-aligned layout).
        if (id === "centered") {
          return (
            `<div class="ctr-head edu-ctr">` +
            `<div class="edu-ctr-degree">${primary}</div>` +
            (second ? `<div class="edu-ctr-org">${second}</div>` : "") +
            (period ? `<div class="edu-ctr-period">${escapeHtml(period)}</div>` : "") +
            `</div>`
          );
        }
        // Timeline style: education rides the same rail as the work history —
        // period and location on the left, then the line with its dot, then the
        // degree and school on the right.
        if (id === "timeline") {
          const school = degree && uni ? uni : "";
          return (
            `<div class="tl-entry tl-edu-entry">` +
            `<div class="tl-side">` +
            (period ? `<div class="tl-date">${escapeHtml(period)}</div>` : "") +
            (loc ? `<div class="tl-loc">${escapeHtml(loc)}</div>` : "") +
            `</div>` +
            `<div class="tl-main tl-edu"><h3>${primary}</h3>` +
            (school ? `<div class="tl-company">${escapeHtml(school)}</div>` : "") +
            `</div></div>`
          );
        }
        // Network style: education rides the same rail as the work history — the
        // degree, the school (and its location), then the period. data-nw marks
        // the entry as built, so the experience pass below leaves it alone.
        if (id === "network") {
          const school = degree && uni ? uni : "";
          const org = [school ? escapeHtml(school) : "", loc ? `<span class="nw-loc">${escapeHtml(loc)}</span>` : ""]
            .filter(Boolean)
            .join(" · ");
          return (
            `<div class="nw-entry nw-edu"><div class="nw-head"><h3 data-nw>${primary}</h3>` +
            (org ? `<div class="nw-company">${org}</div>` : "") +
            (period ? `<div class="nw-dates">${escapeHtml(period)}</div>` : "") +
            `</div></div><!--nw-->`
          );
        }
        // Nexus style: the same block as a role — degree, school, then the
        // period on the left and the location on the right.
        if (id === "nexus") {
          const school = degree && uni ? uni : "";
          return (
            `<div class="nx-entry nx-edu"><div class="nx-head"><h3 data-nx>${primary}</h3>` +
            (school || loc
              ? `<div class="nx-company"><span>${escapeHtml(school)}</span>${loc ? `<span class="nx-loc">${escapeHtml(loc)}</span>` : ""}</div>`
              : "") +
            (period ? `<div class="nx-meta">${escapeHtml(period)}</div>` : "") +
            `</div></div>`
          );
        }
        // Slate style: the same block as a role — degree, school, then the period.
        if (id === "slate") {
          const school = degree && uni ? uni : "";
          const org = [school ? escapeHtml(school) : "", loc ? `<span class="sl-loc">${escapeHtml(loc)}</span>` : ""]
            .filter(Boolean)
            .join(" · ");
          return (
            `<div class="sl-entry sl-edu"><div class="sl-head"><h3 data-sl>${primary}</h3>` +
            (org ? `<div class="sl-company">${org}</div>` : "") +
            (period ? `<div class="sl-dates">${escapeHtml(period)}</div>` : "") +
            `</div></div>`
          );
        }
        // Spectrum style: one line styled like a role — "School - Degree", the
        // period on the right. A div, not an h3: with no bullets under it, an h3
        // would let the keep-with-first-bullet pass reach into the next section.
        if (id === "spectrum") {
          const label = [uni, degree].filter(Boolean).map(escapeHtml).join(" - ");
          return `<div class="sp-edu">${label}${dates}</div>` + (loc ? `<div class="role-org edu-org">${escapeHtml(loc)}</div>` : "");
        }
        // Diamond style: the same block as a role — the degree, the school (and
        // its location), then the period in italic. data-dm marks it as built.
        if (id === "diamond") {
          const school = degree && uni ? uni : "";
          const org = [school ? escapeHtml(school) : "", loc ? `<span class="dm-loc">${escapeHtml(loc)}</span>` : ""]
            .filter(Boolean)
            .join(" · ");
          return (
            `<div class="dm-entry dm-edu"><div class="dm-head"><h3 data-dm>${primary}</h3>` +
            (org ? `<div class="dm-company">${org}</div>` : "") +
            (period ? `<div class="dm-dates">${escapeHtml(period)}</div>` : "") +
            `</div></div>`
          );
        }
        // Formal style: the same centered three-line block as its experience
        // entries — the degree leads, then the school with its location, then the
        // study period last. With no degree to lead, `primary` already falls back
        // to the school name, so the school line is dropped to avoid repeating it.
        if (id === "formal") {
          const school = [uni, loc].filter(Boolean).map(escapeHtml).join(", ");
          return (
            `<div class="fm-head">` +
            (degree ? `<div class="fm-edu-degree">${primary}</div>` : "") +
            (school && degree ? `<div class="fm-edu-school">${school}</div>` : "") +
            (!degree && school ? `<div class="fm-edu-degree">${school}</div>` : "") +
            (period ? `<div class="fm-edu-period">${escapeHtml(period)}</div>` : "") +
            `</div>`
          );
        }
        // Banded style: education is centered under its section band — the
        // degree, then the school, then the period, each on its own line.
        if (id === "banded") {
          const school = [degree && uni ? uni : "", loc]
            .filter(Boolean)
            .map(escapeHtml)
            .join(", ");
          return (
            `<div class="bd-edu">` +
            `<div class="bd-edu-degree">${primary}</div>` +
            (school ? `<div class="bd-edu-org">${school}</div>` : "") +
            (period ? `<div class="bd-edu-period">${escapeHtml(period)}</div>` : "") +
            `</div>`
          );
        }
        const sub = second ? `<div class="role-org edu-org">${second}</div>` : "";
        return `<div class="edu-line">${primary}${dates}</div>${sub}`;
      })
      .join("");
    body = placeEducation(body, eduHtml);
  } else {
    // No structured education to render, but the model may still have written an
    // Education section of its own. Move it after the work history all the same.
    const own = body.match(EDUCATION_SECTION);
    if (own) {
      const inner = own[0].replace(/^<h2[^>]*>[^<]*<\/h2>/i, "");
      body = placeEducation(body, inner);
    }
  }

  // Styles that wrap the summary section in its own block — an outlined card,
  // a tinted panel, a grey band, or just a centred paragraph.
  if (id === "cards" || id === "banded" || id === "darkheader" || id === "formal") {
    body = body.replace(
      /(<h2[^>]*>\s*(?:Professional\s+)?(?:Summary|Profile)\s*<\/h2>)([\s\S]*?)(?=<h2|$)/i,
      (mm, heading, restHtml) => `<div class="summary-box">${heading}${restHtml}</div>`
    );
  }

  // Projects: rebuild the whole section so each project is a bold-title +
  // clickable (domain) line followed by its description on the next line, with
  // space between projects — regardless of how the model grouped them. (All
  // styles.) Only the project's title is bold: the description's keywords are
  // shown in plain text.
  body = body.replace(
    /(<h2[^>]*>[^<]*Projects?[^<]*<\/h2>)([\s\S]*?)(?=<h2|$)/i,
    (m, heading, rest2) => {
      // Make any relative project links absolute (the model often omits https).
      const absolute = (html) => html.replace(/<a\s+href="(?!https?:|mailto:)([^"]+)"/gi, '<a href="https://$1"');
      const flatten = (html) => html.replace(/<\/?(p|ul|ol|li)\b[^>]*>/gi, " ").replace(/<br\s*\/?>/gi, " ");

      // Each project is its own paragraph (or list item) opening with its bold
      // title, so split there. Splitting at every bold run instead turned each
      // bolded keyword in a description into a "project" of its own.
      const blocks = (rest2.match(/<(p|li)\b[^>]*>[\s\S]*?<\/\1>/gi) || [])
        .map((b) => absolute(flatten(b)).trim())
        .filter(Boolean);
      let chunks = blocks.length && blocks.every((b) => /^<strong>/.test(b)) ? blocks : null;
      // Otherwise (no such structure), fall back to a bold title per project.
      if (!chunks) {
        chunks = absolute(flatten(rest2)).split(/(?=<strong>)/g).map((s) => s.trim()).filter(Boolean);
      }
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
            .replace(/<\/?(?:strong|b)\b[^>]*>/gi, "") // keywords in plain text, not bold
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

  // Timeline style: rebuild each experience entry (role heading + company·location
  // line + bullets) into a two-column row — dates/location on the left, a
  // vertical line with a dot, and the role + blue company + bullets on the right.
  if (id === "timeline") {
    body = body.replace(
      /<h3\b([^>]*)>([\s\S]*?)<\/h3>\s*(?:<div class="role-org">([\s\S]*?)<\/div>)?\s*(<ul\b[\s\S]*?<\/ul>)/g,
      (m, attr, h3inner, org, ul) => {
        const dm = h3inner.match(/<span class="role-dates">([\s\S]*?)<\/span>/);
        const dates = dm ? dm[1].trim() : "";
        const roleTitle = h3inner.replace(/<span class="role-dates">[\s\S]*?<\/span>/, "").trim();
        let company = (org || "").trim();
        let location = "";
        const parts = (org || "").split(/\s*[·•]\s*/);
        if (parts.length > 1) { company = parts[0].trim(); location = parts.slice(1).join(" · ").trim(); }
        const side =
          `<div class="tl-side">${dates ? `<div class="tl-date">${dates}</div>` : ""}` +
          `${location ? `<div class="tl-loc">${location}</div>` : ""}</div>`;
        const main =
          `<div class="tl-main"><h3${attr}>${roleTitle}</h3>` +
          `${company ? `<div class="tl-company">${company}</div>` : ""}${ul}</div>`;
        return `<div class="tl-entry">${side}${main}</div>`;
      }
    );
  }

  // Network style: the summary moves up into the header, roles and degrees ride
  // a rail, skills/languages/interests get their grids and chips, and every
  // section heading gets its icon (and, after the first, the divider).
  let nwSummary = "";
  if (id === "network") {
    body = body.replace(
      /<h2[^>]*>\s*(?:Professional\s+)?(?:Summary|Profile|About(?:\s+Me)?)\s*<\/h2>([\s\S]*?)(?=<h2|$)/i,
      (m, content) => { nwSummary = content.trim(); return ""; }
    );

    // Each role: title, company (with the "open" glyph) and location, dates,
    // the "Accomplishments / Tasks" label, then its bullets.
    body = body.replace(
      /<h3\b(?![^>]*data-nw)([^>]*)>([\s\S]*?)<\/h3>\s*(?:<div class="role-org">([\s\S]*?)<\/div>)?\s*(<ul\b[\s\S]*?<\/ul>)?/g,
      (m, attr, h3inner, org, ul) => {
        const dm = h3inner.match(/<span class="role-dates">([\s\S]*?)<\/span>/);
        const dates = (dm ? dm[1].trim() : "").replace(/\b(\d{1,2})\s*\/\s*(\d{4})\b/g, "$1 / $2");
        const roleTitle = h3inner.replace(/<span class="role-dates">[\s\S]*?<\/span>/, "").trim();
        const parts = (org || "").split(/\s*[·•]\s*/).map((s) => s.trim()).filter(Boolean);
        const company = parts[0] || "";
        const location = parts.slice(1).join(" · ");
        const companyLine = company
          ? `<div class="nw-company">${company}${NW_EXTERNAL}${location ? `<span class="nw-loc">${location}</span>` : ""}</div>`
          : "";
        return (
          `<div class="nw-entry"><div class="nw-head"><h3 data-nw${attr}>${roleTitle}</h3>${companyLine}` +
          (dates ? `<div class="nw-dates">${dates}</div>` : "") +
          (ul ? `<div class="nw-label">Accomplishments / Tasks</div>` : "") +
          `</div>${ul || ""}</div><!--nw-->`
        );
      }
    );
    // Consecutive entries share one rail, so the last can end at its own dot.
    body = body.replace(
      /(?:<div class="nw-entry[^"]*">[\s\S]*?<!--nw-->\s*)+/g,
      (run) => `<div class="nw-rail">${run.replace(/<!--nw-->/g, "")}</div>`
    );

    // Skills: every "Category: items" line becomes a cell in a two-column grid.
    body = body.replace(/(<h2[^>]*>[^<]*(?:Skill|Technolog|Competenc|Expertise)[^<]*<\/h2>)([\s\S]*?)(?=<h2|$)/i, (m, heading, content) => {
      const cells = [];
      content.replace(/<strong>([^<]*?):?\s*<\/strong>:?\s*([\s\S]*?)(?=<strong>|<\/p>|$)/g, (mm, cat, items) => {
        const text = items.replace(/<br\s*\/?>/gi, " ").replace(/<\/?p[^>]*>/gi, "").trim();
        if (cat.trim() && text) {
          cells.push(`<div class="nw-skill${/soft\s*skill/i.test(cat) ? " nw-skill-wide" : ""}"><div class="nw-skill-cat">${cat.trim().replace(/:$/, "")}</div><div class="nw-skill-items">${text}</div></div>`);
        }
        return mm;
      });
      // A full-width category (Soft Skills) goes last, so it never leaves a gap
      // in the two-column rows above it.
      const wide = (c) => c.includes("nw-skill-wide");
      cells.sort((a, b) => wide(a) - wide(b));
      return cells.length >= 2 ? `${heading}<div class="nw-skills">${cells.join("")}</div>` : m;
    });

    // The items of a section, whether written as bullets or as one line.
    const sectionItems = (content) => {
      const lis = content.match(/<li\b[^>]*>[\s\S]*?<\/li>/gi);
      const raw = lis
        ? lis.map((li) => li.replace(/<[^>]+>/g, ""))
        : content.replace(/<br\s*\/?>/gi, ",").replace(/<[^>]+>/g, "").split(/[,;•|]\s*(?![^(]*\))/);
      return raw.map((s) => s.trim()).filter(Boolean);
    };

    // Languages: name in bold, proficiency in italic teal, three to a row.
    body = body.replace(/(<h2[^>]*>[^<]*Languages?[^<]*<\/h2>)([\s\S]*?)(?=<h2|$)/i, (m, heading, content) => {
      const items = sectionItems(content);
      if (!items.length) return m;
      const cells = items.map((it) => {
        const lm = it.match(/^(.+?)\s*(?:\(([^)]*)\)|[—–:]\s*(.+)|\s-\s(.+))$/);
        const nm = lm ? lm[1] : it;
        const level = lm ? (lm[2] || lm[3] || lm[4] || "").trim() : "";
        return `<div class="nw-lang"><div class="nw-lang-name">${escapeHtml(nm)}</div>` +
          (level ? `<div class="nw-lang-level">${escapeHtml(level)}</div>` : "") + `</div>`;
      });
      return `${heading}<div class="nw-langs">${cells.join("")}</div>`;
    });

    // Interests: outlined chips, each with a matching icon where one fits.
    body = body.replace(/(<h2[^>]*>[^<]*(?:Interests?|Hobbies)[^<]*<\/h2>)([\s\S]*?)(?=<h2|$)/i, (m, heading, content) => {
      const items = sectionItems(content);
      if (!items.length) return m;
      const chips = items.map((it) => `<span class="nw-chip">${nwInterestIcon(it)}${escapeHtml(it)}</span>`);
      return `${heading}<div class="nw-chips">${chips.join("")}</div>`;
    });

    // Section headings: an icon in a navy circle; a divider before all but the first.
    let firstHeading = true;
    body = body.replace(/<h2\b([^>]*)>([\s\S]*?)<\/h2>/g, (m, attr, inner) => {
      const divider = firstHeading ? "" : `<div class="nw-div"><i></i><i></i><i></i></div>`;
      firstHeading = false;
      return `${divider}<h2${attr}><span class="nw-ico">${nwSectionIcon(inner.replace(/<[^>]+>/g, ""))}</span><span>${inner}</span></h2>`;
    });
  }

  // Diamond style: the summary moves up into the header, each role becomes a
  // title / company / italic-dates block over its bullets, skills go into two
  // label/items columns, and every heading gets its badge and diamond rule.
  if (id === "diamond") {
    body = body.replace(
      /<h2[^>]*>\s*(?:Professional\s+)?(?:Summary|Profile|About(?:\s+Me)?)\s*<\/h2>([\s\S]*?)(?=<h2|$)/i,
      (m, content) => { nwSummary = content.trim(); return ""; }
    );

    body = body.replace(
      /<h3\b(?![^>]*data-dm)([^>]*)>([\s\S]*?)<\/h3>\s*(?:<div class="role-org">([\s\S]*?)<\/div>)?\s*(<ul\b[\s\S]*?<\/ul>)?/g,
      (m, attr, h3inner, org, ul) => {
        const dm = h3inner.match(/<span class="role-dates">([\s\S]*?)<\/span>/);
        const dates = dm ? dm[1].trim() : "";
        const roleTitle = h3inner.replace(/<span class="role-dates">[\s\S]*?<\/span>/, "").trim();
        const parts = (org || "").split(/\s*[·•]\s*/).map((s) => s.trim()).filter(Boolean);
        const company = parts[0] || "";
        const location = parts.slice(1).join(" · ");
        const companyLine = company
          ? `<div class="dm-company">${company}${location ? ` · <span class="dm-loc">${location}</span>` : ""}</div>`
          : "";
        return (
          `<div class="dm-entry"><div class="dm-head"><h3 data-dm${attr}>${roleTitle}</h3>${companyLine}` +
          (dates ? `<div class="dm-dates">${dates}</div>` : "") +
          `</div>${ul || ""}</div>`
        );
      }
    );

    // Skills: every "Category: items" line becomes a label/items pair, two pairs to a row.
    body = body.replace(/(<h2[^>]*>[^<]*(?:Skill|Technolog|Competenc|Expertise)[^<]*<\/h2>)([\s\S]*?)(?=<h2|$)/i, (m, heading, content) => {
      const cells = [];
      content.replace(/<strong>([^<]*?):?\s*<\/strong>:?\s*([\s\S]*?)(?=<strong>|<\/p>|$)/g, (mm, cat, items) => {
        const text = items.replace(/<br\s*\/?>/gi, " ").replace(/<\/?p[^>]*>/gi, "").trim();
        if (cat.trim() && text) {
          cells.push(`<div class="dm-skill${/soft\s*skill/i.test(cat) ? " dm-skill-wide" : ""}"><div class="dm-skill-cat">${cat.trim().replace(/:$/, "")}:</div><div class="dm-skill-items">${text}</div></div>`);
        }
        return mm;
      });
      // Soft Skills spans both columns and goes last, so it leaves no gap.
      cells.sort((a, b) => a.includes("dm-skill-wide") - b.includes("dm-skill-wide"));
      return cells.length >= 2 ? `${heading}<div class="dm-skills">${cells.join("")}</div>` : m;
    });

    // Section headings: badge, title, then the pale rule with a diamond at each end.
    body = body.replace(
      /<h2\b([^>]*)>([\s\S]*?)<\/h2>/g,
      (m, attr, inner) => `<h2${attr}><span class="dm-badge">${DM_BADGE}</span><span>${inner}</span><span class="dm-rule"></span></h2>`
    );
  }

  // Nexus style: the summary moves up into the header, each role becomes a
  // ticked block (title, company, dates | location) over its bullets, and the
  // skills become label / items rows.
  if (id === "nexus") {
    body = body.replace(
      /<h2[^>]*>\s*(?:Professional\s+)?(?:Summary|Profile|About(?:\s+Me)?)\s*<\/h2>([\s\S]*?)(?=<h2|$)/i,
      (m, content) => { nwSummary = content.trim(); return ""; }
    );
    body = body.replace(
      /<h3\b(?![^>]*data-nx)([^>]*)>([\s\S]*?)<\/h3>\s*(?:<div class="role-org">([\s\S]*?)<\/div>)?\s*(<ul\b[\s\S]*?<\/ul>)?/g,
      (m, attr, h3inner, org, ul) => {
        const dm = h3inner.match(/<span class="role-dates">([\s\S]*?)<\/span>/);
        const dates = dm ? dm[1].trim() : "";
        const roleTitle = h3inner.replace(/<span class="role-dates">[\s\S]*?<\/span>/, "").trim();
        const parts = (org || "").split(/\s*[·•]\s*/).map((s) => s.trim()).filter(Boolean);
        const company = parts[0] || "";
        const location = parts.slice(1).join(" · ");
        return (
          `<div class="nx-entry"><div class="nx-head"><h3 data-nx${attr}>${roleTitle}</h3>` +
          (company || location
            ? `<div class="nx-company"><span>${company}</span>${location ? `<span class="nx-loc">${location}</span>` : ""}</div>`
            : "") +
          (dates ? `<div class="nx-meta">${dates}</div>` : "") +
          `</div>${ul || ""}</div>`
        );
      }
    );
    body = body.replace(/(<h2[^>]*>[^<]*(?:Skill|Technolog|Competenc|Expertise)[^<]*<\/h2>)([\s\S]*?)(?=<h2|$)/i, (m, heading, content) => {
      const cells = [];
      content.replace(/<strong>([^<]*?):?\s*<\/strong>:?\s*([\s\S]*?)(?=<strong>|<\/p>|$)/g, (mm, cat, items) => {
        const text = items.replace(/<br\s*\/?>/gi, " ").replace(/<\/?p[^>]*>/gi, "").trim();
        if (cat.trim() && text) cells.push(`<div class="nx-skill-cat">${cat.trim().replace(/:$/, "")}</div><div class="nx-skill-items">${text}</div>`);
        return mm;
      });
      return cells.length >= 2 ? `${heading}<div class="nx-skills">${cells.join("")}</div>` : m;
    });
  }

  // Slate style: the summary moves up beside the contact card, each role becomes
  // a title / company / gold-dates block over its bullets, skills go into two
  // label/items columns, and every heading gets its icon tile and bars.
  if (id === "slate") {
    body = body.replace(
      /<h2[^>]*>\s*(?:Professional\s+)?(?:Summary|Profile|About(?:\s+Me)?)\s*<\/h2>([\s\S]*?)(?=<h2|$)/i,
      (m, content) => { nwSummary = content.trim(); return ""; }
    );
    body = body.replace(
      /<h3\b(?![^>]*data-sl)([^>]*)>([\s\S]*?)<\/h3>\s*(?:<div class="role-org">([\s\S]*?)<\/div>)?\s*(<ul\b[\s\S]*?<\/ul>)?/g,
      (m, attr, h3inner, org, ul) => {
        const dm = h3inner.match(/<span class="role-dates">([\s\S]*?)<\/span>/);
        const dates = dm ? dm[1].trim() : "";
        const roleTitle = h3inner.replace(/<span class="role-dates">[\s\S]*?<\/span>/, "").trim();
        const parts = (org || "").split(/\s*[·•]\s*/).map((s) => s.trim()).filter(Boolean);
        const company = parts[0] || "";
        const location = parts.slice(1).join(" · ");
        const companyLine = company
          ? `<div class="sl-company">${company}${location ? ` · <span class="sl-loc">${location}</span>` : ""}</div>`
          : "";
        return (
          `<div class="sl-entry"><div class="sl-head"><h3 data-sl${attr}>${roleTitle}</h3>${companyLine}` +
          (dates ? `<div class="sl-dates">${dates}</div>` : "") +
          `</div>${ul || ""}</div>`
        );
      }
    );
    body = body.replace(/(<h2[^>]*>[^<]*(?:Skill|Technolog|Competenc|Expertise)[^<]*<\/h2>)([\s\S]*?)(?=<h2|$)/i, (m, heading, content) => {
      const cells = [];
      content.replace(/<strong>([^<]*?):?\s*<\/strong>:?\s*([\s\S]*?)(?=<strong>|<\/p>|$)/g, (mm, cat, items) => {
        const text = items.replace(/<br\s*\/?>/gi, " ").replace(/<\/?p[^>]*>/gi, "").trim();
        if (cat.trim() && text) {
          cells.push(`<div class="sl-skill${/soft\s*skill/i.test(cat) ? " sl-skill-wide" : ""}"><div class="sl-skill-cat">${cat.trim().replace(/:$/, "")}:</div><div class="sl-skill-items">${text}</div></div>`);
        }
        return mm;
      });
      // Soft Skills spans both columns and goes last, so it leaves no gap.
      cells.sort((a, b) => a.includes("sl-skill-wide") - b.includes("sl-skill-wide"));
      return cells.length >= 2 ? `${heading}<div class="sl-skills">${cells.join("")}</div>` : m;
    });
    body = body.replace(
      /<h2\b([^>]*)>([\s\S]*?)<\/h2>/g,
      (m, attr, inner) =>
        `<h2${attr}><span class="sl-ico">${nwSectionIcon(inner.replace(/<[^>]+>/g, ""))}</span>` +
        `<span class="sl-h2-text">${inner}</span><span class="sl-bars"><i></i><i></i><i></i></span></h2>`
    );
  }

  // Spectrum style: roles read "Role at Company" with the dates on the right; the
  // summary is "About"; skills become a sub-heading per category over its items;
  // and every section is wrapped so it carries its own colour on the left band.
  if (id === "spectrum") {
    body = body.replace(
      /<h3\b(?![^>]*data-sp)([^>]*)>([\s\S]*?)<\/h3>\s*(?:<div class="role-org">([\s\S]*?)<\/div>)?/g,
      (m, attr, h3inner, org) => {
        const dm = h3inner.match(/<span class="role-dates">[\s\S]*?<\/span>/);
        const roleTitle = h3inner.replace(/<span class="role-dates">[\s\S]*?<\/span>/, "").trim();
        const company = ((org || "").split(/\s*[·•]\s*/)[0] || "").trim();
        return `<h3 data-sp${attr}>${roleTitle}${company ? ` at ${company}` : ""}${dm ? dm[0] : ""}</h3>`;
      }
    );
    body = body.replace(
      /<h2([^>]*)>\s*(?:Professional\s+)?(?:Summary|Profile)\s*<\/h2>/i,
      (m, attr) => `<h2${attr}>About</h2>`
    );
    body = body.replace(/(<h2[^>]*>[^<]*(?:Skill|Technolog|Competenc|Expertise)[^<]*<\/h2>)([\s\S]*?)(?=<h2|$)/i, (m, heading, content) =>
      heading +
      content.replace(
        /<p class="skills"><strong>([^<]*?):?\s*<\/strong>:?\s*([\s\S]*?)<\/p>/g,
        (mm, cat, items) => `<div class="sp-sub">${cat.trim().replace(/:$/, "")}</div><p class="sp-items">${items.trim()}</p>`
      )
    );
    let n = 0;
    body = body.replace(/<h2\b[\s\S]*?(?=<h2\b|$)/g, (chunk) => {
      const c = SP_COLORS[n++ % SP_COLORS.length];
      const withLine = chunk.replace(/<h2\b([^>]*)>([\s\S]*?)<\/h2>/, (mm, attr, inner) => `<h2${attr}><span>${inner}</span><span class="sp-line"></span></h2>`);
      return `<section class="sp-sec" style="--c:${c}">${withLine}</section>`;
    });
  }

  // Classic and Ribbon render the company·location line as "Company, Location".
  if (id === "classic" || id === "ribbon") {
    body = body.replace(
      /(<div class="role-org">)([\s\S]*?)(<\/div>)/g,
      (m, a, inner, c) => a + inner.replace(/\s*·\s*/g, ", ") + c
    );
  }

  // Centered style: invert each role heading into a centered two-line block —
  // "Company – Location" in bold on top, then "Job Title, Dates" in accent
  // italic below. Runs before the keep-with-first-bullet pass (which matches
  // <h3>, so it no longer applies here — these entries flow naturally).
  if (id === "centered") {
    body = body.replace(
      /<h3\b[^>]*>([\s\S]*?)<\/h3>\s*(?:<div class="role-org">([\s\S]*?)<\/div>)?/g,
      (m, h3inner, org) => {
        const dm = h3inner.match(/<span class="role-dates">([\s\S]*?)<\/span>/);
        const dates = dm ? dm[1].trim() : "";
        const roleTitle = h3inner
          .replace(/<span class="role-dates">[\s\S]*?<\/span>/, "")
          .trim();
        const orgText = (org || "").trim().replace(/\s*·\s*/g, " - ");
        const orgLine = [orgText, dates].filter(Boolean).join(" | ");
        return (
          `<div class="ctr-head">` +
          (roleTitle ? `<div class="ctr-role">${roleTitle}</div>` : "") +
          (orgLine ? `<div class="ctr-org">${orgLine}</div>` : "") +
          `</div>`
        );
      }
    );
  }

  // Dark Header style: move the dates off the title line and onto the italic
  // company line, so the title stands alone in bold.
  if (id === "darkheader") {
    body = body.replace(
      /<h3\b([^>]*)>([\s\S]*?)<\/h3>\s*(?:<div class="role-org">([\s\S]*?)<\/div>)?/g,
      (m, attr, h3inner, org) => {
        const dm = h3inner.match(/<span class="role-dates">[\s\S]*?<\/span>/);
        const datesSpan = dm ? dm[0] : "";
        const roleTitle = h3inner
          .replace(/<span class="role-dates">[\s\S]*?<\/span>/, "")
          .trim();
        const orgText = (org || "").trim().replace(/\s*·\s*/g, " – ");
        if (!datesSpan && !orgText) return m;
        return (
          `<h3${attr}>${roleTitle}</h3>` +
          `<div class="role-org">${datesSpan}${orgText}</div>`
        );
      }
    );
  }

  // Formal style: replace each role heading with three centered lines —
  // role, organization, then dates — above the bullets.
  if (id === "formal") {
    body = body.replace(
      /<h3\b[^>]*>([\s\S]*?)<\/h3>\s*(?:<div class="role-org">([\s\S]*?)<\/div>)?/g,
      (m, h3inner, org) => {
        const dm = h3inner.match(/<span class="role-dates">([\s\S]*?)<\/span>/);
        const dates = dm ? dm[1].trim() : "";
        const roleTitle = h3inner
          .replace(/<span class="role-dates">[\s\S]*?<\/span>/, "")
          .trim();
        const orgText = (org || "").trim().replace(/\s*·\s*/g, ", ");
        return (
          `<div class="fm-head">` +
          (roleTitle ? `<div class="fm-role">${roleTitle}</div>` : "") +
          (orgText ? `<div class="fm-org">${orgText}</div>` : "") +
          (dates ? `<div class="fm-dates">${dates}</div>` : "") +
          `</div>`
        );
      }
    );
    // The section heading keeps its solid label box, so the label moves into its
    // own element and the h2 becomes the row that carries a rule out to each
    // page edge. Every regex that matches on h2 text has already run by here.
    body = body.replace(
      /<h2\b([^>]*)>([\s\S]*?)<\/h2>/g,
      (m, attr, inner) => `<h2${attr}><span class="fm-h2">${inner}</span></h2>`
    );
  }

  // Banded style: the title line stays exactly as written, and the company joins
  // the dates and location on the line beneath. The company used to be appended
  // to the title with " | " — which broke once role titles themselves started
  // carrying a pipe ("Senior DevOps Engineer | Terraform, Azure, Kubernetes"),
  // leaving one line with two identical separators meaning different things.
  // Keeps the <h3> + .role-org shape so the keep-with-first-bullet pass below
  // still binds the heading to its bullets.
  if (id === "banded") {
    body = body.replace(
      /<h3\b([^>]*)>([\s\S]*?)<\/h3>\s*(?:<div class="role-org">([\s\S]*?)<\/div>)?/g,
      (m, attr, h3inner, org) => {
        const dm = h3inner.match(/<span class="role-dates">([\s\S]*?)<\/span>/);
        const dates = dm ? dm[1].trim() : "";
        const roleTitle = h3inner
          .replace(/<span class="role-dates">[\s\S]*?<\/span>/, "")
          .trim();
        const parts = (org || "")
          .split(/\s*[·•]\s*/)
          .map((s) => s.trim())
          .filter(Boolean);
        const company = parts[0] || "";
        const location = parts.slice(1).join(" · ");
        // Company leads the meta line, weighted so it still reads as the
        // employer rather than as another piece of grey metadata, then its
        // location, then the period.
        const meta = [
          company ? `<span class="bd-org">${company}</span>` : "",
          location,
          dates,
        ]
          .filter(Boolean)
          .join(BD_SEP);
        return (
          `<h3${attr}>${roleTitle}</h3>` +
          (meta ? `<div class="role-org bd-meta">${meta}</div>` : "")
        );
      }
    );
  }

  // Keep each role heading (and its org line) with at least its first bullet.
  // (Timeline entries were already restructured above, so this no longer matches
  // them — they flow naturally.)
  body = body.replace(
    /<h3\b([^>]*)>([\s\S]*?)<\/h3>\s*(<div class="role-org[^"]*">[\s\S]*?<\/div>)?\s*<ul>\s*(<li\b[\s\S]*?<\/li>)([\s\S]*?)<\/ul>/g,
    (m, attr, head, org, firstLi, restLis) => {
      const rest3 = restLis && restLis.trim()
        ? `<ul class="kh-rest">${restLis}</ul>`
        : "";
      return `<div class="kh"><h3${attr}>${head}</h3>${org || ""}<ul class="kh-first">${firstLi}</ul></div>${rest3}`;
    }
  );

  const css =
    BASE + "\n" + templateCss(id, accent, head, nameColor) + (id === "spectrum" ? "" : nameTitleCss(nameColor)) +
    // The name, heavier in every template but Spectrum (already its heaviest).
    // The hairline stroke thickens it even in fonts with no weight above bold.
    (id === "spectrum" ? "" : "\nheader h1{font-weight:800;-webkit-text-stroke:.35px currentColor;}") +
    // Sentences fill every line edge to edge (the last line of each stays
    // short, as it must): bullets, the summary, project descriptions. Skills
    // lists keep left-aligned (they're comma lists, often in narrow columns),
    // and templates that centre their summary keep it centred.
    "\nmain p,main li,.proj-desc,.nw-summary p,.dm-summary p,.sl-summary p,.nx-summary p{text-align:justify;text-justify:inter-word;}" +
    "\nmain p.sp-items{text-align:left;}" +
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

  const header = headerHtml(id, name, title, contacts, nwSummary, head);

  return `<!doctype html>
<html><head><meta charset="utf-8" /><base target="_blank" /><style>${css}${fontOverride(style)}</style></head>
<body><div class="page">${id === "network" ? NW_BACKGROUND : id === "slate" ? SL_BACKGROUND : id === "nexus" ? NX_BACKGROUND : ""}
${header}
<main>${body}</main>
</div></body></html>`;
}
