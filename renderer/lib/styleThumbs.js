// Distinct SVG thumbnails that mirror each style's actual template layout.
const G = "#c9ced6";
const R = "#dfe3ea";
const rc = (x, y, w, h, c, r = 1) =>
  `<rect x='${x}' y='${y}' width='${w}' height='${h}' rx='${r}' fill='${c}'/>`;

// Darker shade of a hex (used for the title bar, which is darker than the name).
function darken(hex, f = 0.7) {
  const h = String(hex || "").replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(h)) return hex;
  const n = parseInt(h, 16);
  const ch = (s) => Math.round(((n >> s) & 255) * f).toString(16).padStart(2, "0");
  return "#" + ch(16) + ch(8) + ch(0);
}

function sections(startY, accent, opts = {}) {
  let s = "";
  let y = startY;
  for (let k = 0; k < 3; k++) {
    s += rc(20, y, 80, 8, accent);
    if (opts.rule) s += rc(20, y + 12, 200, 1, R);
    for (let i = 0; i < 3; i++) {
      if (opts.tick) s += rc(20, y + 20 + i * 9, 6, 5, accent);
      s += rc(opts.tick ? 30 : 20, y + 20 + i * 9, opts.tick ? 176 : 200, 5, G);
    }
    y += 54;
  }
  return s;
}

export function styleThumb(style) {
  const a = (style && style.accent) || "#2f5b8f";
  const id = (style && style.id) || "professional";
  // The Content picker (head, empty for "Default") recolors only the themeable
  // bars — section headings (categories), dividers, and header backgrounds. The
  // Name picker recolors the name bar (nameC) and title bars (titleC, darker).
  const head = (style && style.head) || null;
  const nameC = (style && style.nameColor) || null;
  const titleC = nameC ? darken(nameC, 0.7) : null;
  let inner = "";

  switch (id) {
    case "modern":
      inner += rc(20, 22, 120, 16, nameC || "#16203a", 2);
      inner += rc(20, 44, 200, 3, a);
      inner += rc(20, 52, 80, 6, titleC || G);
      inner += sections(80, a);
      break;
    case "minimal":
      inner += rc(20, 24, 100, 14, nameC || "#222", 2);
      inner += rc(20, 46, 70, 6, titleC || G);
      inner += sections(82, a);
      break;
    case "creative":
      inner += rc(16, 16, 208, 52, a, 6);
      inner += rc(28, 28, 110, 14, nameC || "#ffffff", 2);
      inner += rc(28, 48, 90, 6, titleC || "#ffffffaa");
      inner += sections(88, a);
      break;
    case "technical":
      inner += rc(20, 20, 7, 40, a, 1);
      inner += rc(34, 24, 110, 14, nameC || "#13233f", 2);
      inner += rc(34, 46, 70, 6, titleC || G);
      inner += sections(80, a, { tick: true });
      break;
    case "academic":
      inner += rc(60, 20, 120, 15, nameC || "#1f2937", 2);
      inner += rc(72, 42, 96, 6, titleC || G);
      inner += rc(20, 58, 200, 1, head || "#bbbbbb");
      inner += sections(72, head || "#33485f", { rule: true });
      break;
    case "executive":
      inner += rc(12, 12, 216, 54, head || "#16233b", 0);
      inner += rc(26, 26, 120, 15, nameC || "#ffffff", 2);
      inner += rc(26, 46, 90, 6, titleC || "#c7d2e0");
      inner += sections(84, head || "#16233b", { rule: true });
      break;
    case "compact": {
      inner += rc(20, 16, 110, 12, nameC || "#1f2937", 2);
      inner += rc(20, 32, 200, 2, a);
      let y = 46;
      for (let k = 0; k < 4; k++) {
        inner += rc(20, y, 70, 6, a);
        for (let i = 0; i < 3; i++) inner += rc(20, y + 10 + i * 6, 200, 3.5, G);
        y += 40;
      }
      break;
    }
    case "cards": {
      inner += rc(20, 18, 110, 14, nameC || "#1b3a5e", 2);
      inner += rc(20, 36, 84, 6, titleC || a);
      inner += rc(150, 18, 70, 4, G);
      inner += rc(160, 26, 60, 4, G);
      inner += rc(155, 34, 65, 4, G);
      inner += rc(20, 50, 200, 2, a);
      inner += `<rect x='20' y='60' width='200' height='38' rx='4' fill='none' stroke='${a}' stroke-width='1.5'/>`;
      inner += rc(28, 66, 60, 5, a);
      for (let i = 0; i < 2; i++) inner += rc(28, 78 + i * 8, 184, 4, G);
      inner += rc(20, 108, 70, 6, a);
      inner += rc(20, 118, 200, 1.5, a);
      let yy = 126;
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 3; c++) {
          const x = 20 + c * 68;
          inner += `<rect x='${x}' y='${yy}' width='62' height='32' rx='3' fill='#f2f4f7' stroke='#e2e6ec'/>`;
          inner += rc(x + 5, yy + 5, 34, 4, a);
          inner += rc(x + 5, yy + 13, 50, 3, G);
          inner += rc(x + 5, yy + 19, 44, 3, G);
        }
        yy += 38;
      }
      inner += rc(20, yy + 2, 70, 6, a);
      inner += rc(20, yy + 12, 200, 1.5, a);
      inner += rc(20, yy + 20, 90, 6, "#333333");
      inner += rc(180, yy + 20, 40, 5, G);
      for (let i = 0; i < 2; i++) inner += rc(20, yy + 32 + i * 8, 200, 4, G);
      break;
    }
    case "timeline": {
      inner += rc(20, 18, 120, 15, nameC || "#1a1a1a", 2);   // name
      inner += rc(20, 38, 96, 6, titleC || a);               // title (accent)
      inner += rc(20, 50, 150, 4, G);                        // contacts
      inner += rc(20, 66, 54, 7, a);                         // SUMMARY heading
      inner += rc(20, 77, 200, 1, head || R);
      inner += rc(20, 84, 200, 4, G);
      inner += rc(20, 92, 188, 4, G);
      inner += rc(20, 106, 66, 7, a);                        // EXPERIENCE heading
      inner += rc(20, 117, 200, 1, head || R);
      const lx = 74;
      inner += rc(lx, 126, 1.6, 150, R);                     // vertical timeline line
      let y = 128;
      for (let k = 0; k < 3; k++) {
        inner += rc(30, y, 40, 5, "#333333");                // date
        inner += rc(40, y + 8, 30, 4, G);                    // location
        inner += `<circle cx='${lx + 0.8}' cy='${y + 3}' r='4' fill='#1f2937'/>`;
        inner += rc(86, y, 70, 6, "#333333");                // role
        inner += rc(86, y + 9, 45, 5, a);                    // company (accent)
        for (let i = 0; i < 3; i++) inner += rc(86, y + 18 + i * 7, 130, 3.5, G);
        y += 48;
      }
      break;
    }
    case "classic": {
      inner += rc(70, 20, 100, 14, nameC || "#111111", 2);   // centered name
      inner += rc(55, 40, 130, 6, titleC || "#333333");      // centered title
      inner += rc(20, 54, 200, 2, "#111111");                // double rule (thick)
      inner += rc(20, 58, 200, 1, "#111111");                // double rule (thin)
      inner += rc(64, 64, 112, 4, G);                        // centered contacts
      inner += rc(20, 80, 80, 8, head || "#111111");         // Summary heading
      inner += rc(20, 92, 200, 4, G);
      inner += rc(20, 100, 188, 4, G);
      inner += rc(20, 114, 60, 8, head || "#111111");        // Skills heading
      for (let i = 0; i < 3; i++) {
        inner += `<circle cx='24' cy='${129 + i * 8}' r='1.6' fill='#333333'/>`;
        inner += rc(30, 127 + i * 8, 190, 3.5, G);
      }
      inner += rc(20, 158, 92, 8, head || "#111111");        // Experience heading
      let y = 172;
      for (let k = 0; k < 2; k++) {
        inner += rc(20, y, 112, 6, "#111111");               // Role, Dates (bold)
        inner += rc(20, y + 9, 70, 4, "#666666");            // Company (italic)
        for (let i = 0; i < 3; i++) {
          inner += `<circle cx='24' cy='${y + 21 + i * 7}' r='1.6' fill='#333333'/>`;
          inner += rc(30, y + 19 + i * 7, 180, 3.5, G);
        }
        y += 52;
      }
      break;
    }
    case "centered": {
      inner += rc(58, 16, 124, 18, nameC || "#111111", 2);        // big centered name
      // Professional title in an outlined box.
      inner += `<rect x='72' y='42' width='96' height='15' rx='1' fill='none' stroke='${a}' stroke-width='1.5'/>`;
      inner += rc(82, 47, 76, 5, titleC || "#555555");
      inner += rc(20, 65, 200, 13, "#efefef", 1);                 // grey contact band
      inner += rc(46, 70, 148, 4, G);
      let y = 92;
      for (let k = 0; k < 3; k++) {
        // Centered section heading flanked by short rules.
        inner += rc(40, y + 3, 26, 2, a);
        inner += rc(90, y, 60, 7, a);
        inner += rc(174, y + 3, 26, 2, a);
        inner += rc(75, y + 15, 90, 6, "#1a1a1a");                // company – location
        inner += rc(85, y + 25, 70, 4, a);                        // role, dates (accent)
        for (let i = 0; i < 3; i++) {
          inner += `<circle cx='26' cy='${y + 37 + i * 8}' r='1.6' fill='#555555'/>`;
          inner += rc(32, y + 35 + i * 8, 188, 3.5, G);
        }
        y += 70;
      }
      break;
    }
    case "ats": {
      // Single column, left-aligned, black name, underlined section headings,
      // bold role + company lines, plain disc bullets — a clean ATS-safe look.
      inner += rc(20, 18, 120, 15, nameC || "#000000", 1);         // bold black name
      inner += rc(20, 38, 80, 5, titleC || "#1a1a1a");             // bold title
      inner += rc(20, 50, 150, 4, "#555555");                      // contacts
      inner += rc(20, 60, 200, 1.5, "#333333");                    // header rule
      let y = 72;
      for (let k = 0; k < 3; k++) {
        inner += rc(20, y, 70, 7, "#000000");                      // uppercase heading
        inner += rc(20, y + 11, 200, 1, "#444444");                // heading underline
        inner += rc(20, y + 18, 96, 6, "#000000");                 // bold role title
        inner += rc(20, y + 28, 76, 5, "#1a1a1a");                 // bold company · dates
        for (let i = 0; i < 3; i++) {
          inner += `<circle cx='25' cy='${y + 40 + i * 8}' r='1.6' fill='#1a1a1a'/>`;
          inner += rc(31, y + 38 + i * 8, 189, 3.5, G);
        }
        y += 66;
      }
      break;
    }
    case "highlight": {
      inner += rc(20, 18, 118, 16, nameC || "#1a1a1a", 2);        // bold uppercase name
      inner += rc(20, 40, 74, 5, titleC || a);                    // accent subtitle
      for (let i = 0; i < 3; i++) inner += rc(150, 18 + i * 9, 70, 4, G); // stacked contacts (right)
      inner += rc(20, 54, 200, 1, a);                             // rule under header
      let y = 66;
      for (let k = 0; k < 4; k++) {
        inner += rc(20, y, 62, 12, "#ece7e1", 1);                 // shaded heading band
        inner += rc(25, y + 4, 44, 5, "#1a1a1a");
        inner += rc(20, y + 19, 96, 6, a);                        // accent role/degree title
        inner += rc(20, y + 29, 76, 4, G);                        // company · dates
        for (let i = 0; i < 3; i++) {
          inner += `<circle cx='26' cy='${y + 41 + i * 8}' r='2' fill='none' stroke='${a}' stroke-width='1'/>`;
          inner += rc(32, y + 39 + i * 8, 188, 3.5, G);
        }
        y += 62;
      }
      break;
    }
    case "darkheader": {
      // Dark full-width header (name left, contacts stacked right), a grey
      // summary band, then plain uppercase labels over bold role entries.
      inner += rc(0, 0, 240, 58, a, 0);                          // dark header band
      inner += rc(16, 14, 96, 14, nameC || "#ffffff", 2);        // name (white)
      inner += rc(16, 33, 60, 5, titleC || "#d9d9d9");           // title
      for (let i = 0; i < 3; i++) inner += rc(150, 14 + i * 9, 74, 4, "#e0e0e0");
      inner += rc(0, 58, 240, 30, "#ebebeb", 0);                 // grey summary band
      inner += rc(70, 66, 100, 4, "#8b8f96");
      inner += rc(50, 75, 140, 4, "#8b8f96");
      let y = 100;
      for (let k = 0; k < 3; k++) {
        inner += rc(16, y, 66, 6, "#1a1a1a");                    // uppercase label
        inner += rc(16, y + 14, 84, 6, "#1a1a1a");               // bold role title
        inner += rc(16, y + 25, 60, 4, "#8b8f96");               // italic company
        inner += rc(178, y + 25, 46, 4, "#8b8f96");              // dates (right)
        for (let i = 0; i < 3; i++) {
          inner += `<circle cx='22' cy='${y + 39 + i * 8}' r='1.6' fill='#555555'/>`;
          inner += rc(28, y + 37 + i * 8, 192, 3.5, G);
        }
        y += 72;
      }
      break;
    }
    case "ribbon": {
      // Name reversed out of a colour ribbon, contacts beneath, then coloured
      // section headings over matching rules.
      inner += rc(16, 14, 208, 26, a, 1);                        // colour ribbon
      inner += rc(24, 21, 92, 13, nameC || "#ffffff", 2);        // name (white)
      inner += rc(16, 46, 78, 5, titleC || "#5a6070");           // title
      inner += rc(16, 56, 160, 4, G);                            // contacts
      let y = 74;
      for (let k = 0; k < 3; k++) {
        inner += rc(16, y, 62, 7, a);                            // heading (accent)
        inner += rc(16, y + 11, 208, 1.2, a);                    // accent rule
        inner += rc(16, y + 19, 80, 6, "#1a1a1a");               // role title
        inner += rc(180, y + 19, 44, 4, "#6a7280");              // dates (right)
        inner += rc(16, y + 29, 96, 4, "#3a4250");               // company line
        for (let i = 0; i < 3; i++) {
          inner += `<circle cx='22' cy='${y + 43 + i * 8}' r='1.6' fill='#555555'/>`;
          inner += rc(28, y + 41 + i * 8, 192, 3.5, G);
        }
        y += 76;
      }
      break;
    }
    case "formal": {
      // Centered uppercase name bracketed by rules, a centered summary, and
      // section labels reversed out of solid boxes.
      inner += rc(16, 16, 208, 2, a);                            // rule above
      inner += rc(66, 25, 108, 14, nameC || "#111111", 1);       // centered name
      inner += rc(84, 44, 72, 5, titleC || "#555555");           // centered title
      inner += rc(16, 56, 208, 2, a);                            // rule below
      inner += rc(52, 64, 136, 4, G);                            // centered contacts
      inner += rc(40, 74, 160, 4, G);                            // centered summary
      inner += rc(56, 82, 128, 4, G);
      let y = 98;
      for (let k = 0; k < 3; k++) {
        inner += rc(78, y, 84, 12, a, 1);                        // solid label box
        inner += rc(88, y + 4, 64, 4, "#ffffff");
        inner += rc(90, y + 19, 60, 5, "#333333");               // centered role
        inner += rc(76, y + 28, 88, 5, "#111111");               // centered org (bold)
        inner += rc(94, y + 37, 52, 4, "#666666");               // centered dates
        for (let i = 0; i < 3; i++) {
          inner += `<circle cx='24' cy='${y + 51 + i * 8}' r='1.6' fill='#555555'/>`;
          inner += rc(30, y + 49 + i * 8, 190, 3.5, G);
        }
        y += 74;
      }
      break;
    }
    case "banded": {
      // Centered name/title in a tinted rounded panel, then full-width centered
      // section bands with "Title | Org" over "Dates | Location" entries.
      const band = head ? head + "33" : "#e9eaf3";
      inner += `<rect x='16' y='14' width='208' height='48' rx='6' fill='${band}'/>`;
      inner += rc(78, 22, 84, 14, nameC || "#1b1f27", 2);        // centered name
      inner += rc(92, 41, 56, 5, titleC || "#7a8090");           // centered title
      inner += rc(60, 52, 120, 4, G);                            // centered contacts
      let y = 74;
      for (let k = 0; k < 4; k++) {
        inner += rc(16, y, 208, 12, band, 2);                    // full-width band
        inner += rc(96, y + 4, 48, 5, "#1b1f27");                // centered label
        inner += rc(20, y + 20, 108, 6, "#1b1f27");              // Title | Org
        inner += rc(20, y + 30, 72, 4, G);                       // Dates | Location
        for (let i = 0; i < 3; i++) {
          inner += `<circle cx='26' cy='${y + 43 + i * 8}' r='1.6' fill='#555555'/>`;
          inner += rc(32, y + 41 + i * 8, 188, 3.5, G);
        }
        y += 60;
      }
      break;
    }
    default: // professional
      inner += rc(20, 20, 7, 42, a, 1);
      inner += rc(36, 24, 100, 16, nameC || "#1f2937", 3);
      inner += rc(36, 46, 70, 6, titleC || G);
      inner += sections(82, a, { rule: true });
  }

  // width/height are explicit so the <img> gets a real 240x320 intrinsic ratio
  // (without them Chrome falls back to its default replaced-element ratio and
  // the thumbnail renders squashed).
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='320' viewBox='0 0 240 320'><rect width='240' height='320' fill='#ffffff'/>${inner}</svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg);
}
