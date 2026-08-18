// The resume look: templates, the two colour palettes, and the font choices.
//
// Shared, because these are picked in two places now — the generator's own
// controls, and the "Set Resume" tab where an account stores the look it should
// be generated with. One list so the two can never drift apart.

export const STYLES = [
  { id: "ats", label: "ATS-Safe", accent: "#333333" },
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
  { id: "banded", label: "Banded", accent: "#4b5563" },
  { id: "darkheader", label: "Dark Header", accent: "#1f1f1f" },
  { id: "ribbon", label: "Ribbon", accent: "#8b2635" },
  { id: "formal", label: "Formal", accent: "#111111" },
];

// Sample colors. The Content picker applies one to EVERY template's borders,
// category headings and backgrounds; the Name picker recolors the name + title.
// "Default" (empty) lets each template keep its own built-in colors.
export const PRESET_COLORS = [
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
export const FONT_OPTIONS = [
  { value: "", label: "Template default" },
  // ATS-recommended sans-serif (fall back to a system sans if not installed)
  { value: "'Open Sans', Arial, Helvetica, sans-serif", label: "Open Sans" },
  { value: "Roboto, Arial, Helvetica, sans-serif", label: "Roboto" },
  { value: "Lato, 'Segoe UI', Arial, sans-serif", label: "Lato" },
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

export const SIZE_OPTIONS = ["", "8", "8.5", "9", "9.5", "10", "10.5", "11", "11.5", "12"];

// The account columns that carry a saved look, and the generator state each one
// feeds. Used by both screens so the mapping is written down once.
export const RESUME_LOOK_FIELDS = [
  "resume_style",
  "resume_accent",
  "resume_name_color",
  "resume_font",
  "resume_font_size",
];

// The generator lets the templates be dragged into a preferred order, stored as
// the `style_order` pref. Every list of templates ranks them through this, so
// the order is the same wherever they are shown. Ids missing from the saved
// order (a template added later) fall to the end, keeping their own order.
export function rankStyles(orderCsv) {
  const order = String(orderCsv || "").split(",").filter(Boolean);
  if (!order.length) return [...STYLES];
  return [...STYLES].sort((a, b) => {
    const ia = order.indexOf(a.id);
    const ib = order.indexOf(b.id);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
}

// Has this account had a look saved at all? An account with nothing set must not
// blank the generator's current selection when it is picked.
export function hasSavedLook(account) {
  if (!account) return false;
  return RESUME_LOOK_FIELDS.some((k) => (account[k] || "").trim() !== "");
}
