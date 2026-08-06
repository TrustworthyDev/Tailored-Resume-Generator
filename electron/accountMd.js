// The plain-text record format for one account:
//
//   Full Name
//   @Tech Stack
//
//   ### Info
//   Link:       …
//   DOB:        …
//   …
//
//   ### Education
//   <degree>
//   <university>
//   <location>
//   <period>
//
//   ### Summary
//   <free text>
//
//   ### Work History
//   # <role>
//   <company> | <location> | <period>
//
// Round-trips through toMarkdown / parseMarkdown without losing a field.

const s = (v) => (v == null ? "" : String(v).trim());

// "Label:" lines, in the order they appear in the file, mapped to account columns.
const INFO_FIELDS = [
  ["Link", "portfolio"],
  ["DOB", "birth_date"],
  ["Address", "address"],
  ["Email", "email"],
  ["Password", "password"],
  ["Recovery", "recovery"],
  ["Linkedin", "linkedin"],
  ["Resume", "resume_link"],
  ["Cover Letter", "cover_letter_link"],
  ["Time Zone", "time_zone"],
  ["Phone", "phone"],
];

// Pad the labels into a column so the file stays readable by eye.
const LABEL_WIDTH = 12;

function toMarkdown(account, education, work) {
  const a = account || {};
  const lines = [];

  lines.push(s(a.name));
  if (s(a.main_stack)) lines.push(`@${s(a.main_stack)}`);
  lines.push("");

  lines.push("### Info");
  INFO_FIELDS.forEach(([label, key]) => {
    const pad = `${label}:`.padEnd(LABEL_WIDTH, " ");
    const value = s(a[key]);
    // Trailing spaces on an empty value read as noise — trim the whole line.
    lines.push(value ? `${pad}${value}` : `${label}:`);
  });
  lines.push("");

  lines.push("### Education");
  const eduList = Array.isArray(education) ? education : education ? [education] : [];
  eduList
    .filter((e) => e && (s(e.degree) || s(e.university) || s(e.location) || s(e.period)))
    .forEach((e, i) => {
      if (i) lines.push("");
      [e.degree, e.university, e.location, e.period].map(s).forEach((v) => {
        if (v) lines.push(v);
      });
    });
  lines.push("");

  lines.push("### Summary");
  if (s(a.additional_info)) lines.push(s(a.additional_info));
  lines.push("");

  lines.push("### Work History");
  (Array.isArray(work) ? work : []).forEach((w, i) => {
    w = w || {};
    const role = s(w.role_name || w.role);
    const meta = [w.company_name || w.company, w.location, w.work_duration || w.duration]
      .map(s)
      .filter(Boolean)
      .join(" | ");
    if (!role && !meta) return;
    if (i) lines.push("");
    lines.push(`# ${role}`);
    if (meta) lines.push(meta);
    lines.push("");
  });

  return lines.join("\n").replace(/\n{4,}/g, "\n\n\n").trimEnd() + "\n";
}

// Split the body into "### Heading" sections, keeping anything before the first
// heading under "" (the name / @stack preamble).
function splitSections(text) {
  const out = { "": [] };
  let current = "";
  String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .forEach((line) => {
      const m = line.match(/^\s*###\s+(.+?)\s*$/);
      if (m) {
        current = m[1].toLowerCase();
        if (!out[current]) out[current] = [];
        return;
      }
      (out[current] = out[current] || []).push(line);
    });
  return out;
}

// Group lines into blocks separated by one or more blank lines.
function blocks(lines) {
  const out = [];
  let cur = [];
  (lines || []).forEach((raw) => {
    const line = s(raw);
    if (!line) {
      if (cur.length) { out.push(cur); cur = []; }
      return;
    }
    cur.push(line);
  });
  if (cur.length) out.push(cur);
  return out;
}

function parseMarkdown(text) {
  const sections = splitSections(text);
  const personal = {};

  // Preamble: the first non-empty line is the name, an @line is the tech stack.
  (sections[""] || []).forEach((raw) => {
    const line = s(raw);
    if (!line) return;
    if (line.startsWith("@")) {
      if (!personal.main_stack) personal.main_stack = line.slice(1).trim();
    } else if (!personal.name) {
      personal.name = line;
    }
  });

  // Info: "Label: value". Longest label first so "Cover Letter" wins over "Cover".
  const labels = [...INFO_FIELDS].sort((a, b) => b[0].length - a[0].length);
  (sections.info || []).forEach((raw) => {
    const line = s(raw);
    if (!line) return;
    const hit = labels.find((l) => new RegExp(`^${l[0]}\\s*:`, "i").test(line));
    if (!hit) return;
    const value = line.slice(line.indexOf(":") + 1).trim();
    if (value) personal[hit[1]] = value;
  });

  // Education: degree / university / location / period, one block per entry.
  const education = blocks(sections.education).map((b) => ({
    degree: b[0] || "",
    university: b[1] || "",
    location: b[2] || "",
    period: b[3] || "",
  }));

  // Summary → the account's Additional Information.
  const summary = (sections.summary || []).map(s).filter(Boolean).join("\n").trim();
  if (summary) personal.additional_info = summary;

  // Work History: "# Role" then "Company | Location | Period".
  const work = [];
  (sections["work history"] || []).forEach((raw) => {
    const line = s(raw);
    if (!line) return;
    if (line.startsWith("#")) {
      work.push({ role_name: line.replace(/^#+\s*/, "").trim(), company_name: "", location: "", work_duration: "" });
      return;
    }
    const entry = work[work.length - 1];
    if (!entry || entry.company_name || entry.location || entry.work_duration) return;
    const parts = line.split("|").map(s);
    entry.company_name = parts[0] || "";
    entry.location = parts[1] || "";
    entry.work_duration = parts[2] || "";
  });

  return {
    personal,
    // The form edits a single education entry; extras are kept for callers that want them.
    education: education[0] || {},
    educationAll: education,
    work,
    projects: [],
  };
}

module.exports = { toMarkdown, parseMarkdown, INFO_FIELDS };
