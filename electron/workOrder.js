// Ordering work history newest-first.
//
// Roles arrive in whatever order they were typed or imported, but a resume reads
// latest job first, always. Rather than asking the user to arrange them, the
// dates are parsed and the rows given an explicit `sort_order` when they are
// saved — so every read (the form, the resume, the prompt) sees the same order
// without each one having to sort for itself.
//
// The stored duration is one free-text "Start - End" string, and both of these
// formats are already in use: "Apr 2023 - May 2026" and "2017.07 - 2019.03".

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

// A job with no end date is the current one, so it must sort above every dated
// role — not below them, which is where an unparseable value would land.
const ONGOING = 9999 * 12;
const ONGOING_WORDS = /^(present|current|now|today|ongoing|to\s*date)$/i;

// One endpoint of a range -> a comparable month number (year * 12 + month).
// Returns null when there is nothing date-like to read.
function monthValue(part) {
  const s = String(part || "").trim();
  if (!s) return null;
  if (ONGOING_WORDS.test(s)) return ONGOING;

  // 2023-04, 2023.04, 2023/04  (also the value an <input type="month"> gives)
  let m = s.match(/^(\d{4})\s*[-./]\s*(\d{1,2})$/);
  if (m) return Number(m[1]) * 12 + Math.min(12, Math.max(1, Number(m[2])));

  // 04/2023, 04.2023, 4-2023
  m = s.match(/^(\d{1,2})\s*[-./]\s*(\d{4})$/);
  if (m) return Number(m[2]) * 12 + Math.min(12, Math.max(1, Number(m[1])));

  // Apr 2023, April 2023, Apr. 2023
  m = s.match(/^([A-Za-z]+)\.?\s+(\d{4})$/);
  if (m && MONTHS[m[1].toLowerCase()]) return Number(m[2]) * 12 + MONTHS[m[1].toLowerCase()];

  // 2023 Apr
  m = s.match(/^(\d{4})\s+([A-Za-z]+)\.?$/);
  if (m && MONTHS[m[2].toLowerCase()]) return Number(m[1]) * 12 + MONTHS[m[2].toLowerCase()];

  // A bare year — treat as mid-year so it sits between that year's months
  // rather than always before them.
  m = s.match(/^(\d{4})$/);
  if (m) return Number(m[1]) * 12 + 6;

  // Anything else: pull out a 4-digit year if one is in there at all.
  m = s.match(/(19|20)\d{2}/);
  if (m) return Number(m[0]) * 12 + 6;

  return null;
}

// Find the separator between the two endpoints. This cannot simply split on
// "-": the hyphen inside "2023-04" is part of the date, not the separator, and
// splitting there turned "2023-04 - 2026-05" into four fragments.
function splitRange(s) {
  // A separator with space around it is unambiguous — "2023-04 - 2026-05".
  let parts = s.split(/\s+(?:–|—|-|to)\s+/i);
  if (parts.length > 1) return parts;
  // An en/em dash is never part of a date, spaced or not.
  parts = s.split(/\s*(?:–|—)\s*/);
  if (parts.length > 1) return parts;
  // Left with a bare hyphen and no spaces ("Apr 2023-May 2026"): it is the
  // separator only if BOTH halves read as dates.
  for (let i = s.indexOf("-"); i > -1; i = s.indexOf("-", i + 1)) {
    const a = s.slice(0, i).trim();
    const b = s.slice(i + 1).trim();
    if (a && b && monthValue(a) != null && monthValue(b) != null) return [a, b];
  }
  return [s];
}

// "Start - End" -> { start, end }. A range with no end reads as ongoing, which
// is how "Apr 2023 -" and "Apr 2023 - Present" both behave.
function parseRange(duration) {
  const s = String(duration || "").trim();
  if (!s) return { start: null, end: null };
  // Trailing separator and nothing after it — the job is still being done.
  const open = /(?:[-–—]|\bto)\s*$/i.test(s);
  const body = open ? s.replace(/(?:[-–—]|\bto)\s*$/i, "").trim() : s;
  const parts = splitRange(body);
  const start = monthValue(parts[0]);
  const end = open ? ONGOING : parts.length > 1 ? monthValue(parts.slice(1).join(" - ")) : null;
  return { start, end };
}

// Sort a list of work-history rows newest-first: by when the job ENDED, then by
// when it started, so two roles ending in the same month keep the longer one
// first. Rows with no readable dates keep their original order, at the bottom.
function sortRoles(rows) {
  return (rows || [])
    .map((r, i) => ({ r, i, ...parseRange(r && r.work_duration) }))
    .sort((a, b) => {
      const ae = a.end == null ? -Infinity : a.end;
      const be = b.end == null ? -Infinity : b.end;
      if (ae !== be) return be - ae;
      const as = a.start == null ? -Infinity : a.start;
      const bs = b.start == null ? -Infinity : b.start;
      if (as !== bs) return bs - as;
      return a.i - b.i; // stable: undated rows stay as typed
    })
    .map((x) => x.r);
}

module.exports = { sortRoles, parseRange, monthValue, ONGOING };
