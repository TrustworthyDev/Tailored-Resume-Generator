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
      // Name, role title, then the technology line; contacts bracketed by two
      // coloured double rules with an icon leading each item; section headings
      // centred between rules that run out to both edges.
      const rule = head || "#111111";
      inner += rc(70, 16, 100, 14, nameC || "#111111", 2);   // centered name
      inner += rc(62, 36, 116, 6, titleC || "#333333");      // centered role title
      inner += rc(50, 47, 140, 5, titleC || "#555555");      // centered tech line
      inner += rc(20, 58, 200, 2, rule);                     // double rule (thick)
      inner += rc(20, 62, 200, 1, rule);                     // double rule (thin)
      for (let i = 0; i < 4; i++) {                          // contacts, with icons
        const x = 28 + i * 49;
        inner += rc(x, 69, 6, 6, rule, 1);                   // icon
        inner += rc(x + 9, 70.5, 30, 4, G);                  // text
      }
      inner += rc(20, 82, 200, 2, rule);                     // second double rule
      inner += rc(20, 86, 200, 1, rule);
      let y = 98;
      for (let k = 0; k < 3; k++) {
        inner += rc(20, y + 3, 62, 1.5, head || "#111111");  // rule to the label
        inner += rc(90, y, 60, 8, head || "#111111");        // centred heading
        inner += rc(158, y + 3, 62, 1.5, head || "#111111"); // rule to the edge
        inner += rc(20, y + 16, 112, 6, "#111111");          // role | stack
        inner += rc(20, y + 25, 70, 4, "#666666");           // company
        for (let i = 0; i < 3; i++) {
          inner += `<circle cx='24' cy='${y + 37 + i * 7}' r='1.6' fill='#333333'/>`;
          inner += rc(30, y + 35 + i * 7, 180, 3.5, G);
        }
        y += 62;
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
        inner += rc(75, y + 15, 90, 6, a);                        // role | stack (accent)
        inner += rc(85, y + 25, 70, 4, "#555555");                // company - country | dates
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
        // The heading band is tinted from the Name picker, matching the template.
        inner += rc(20, y, 62, 12, nameC ? nameC + "26" : "#ece7e1", 1);
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
      // Centered uppercase name inside a box ruled on all four sides, a centered
      // summary, and section labels reversed out of solid boxes.
      inner += `<rect x='16' y='16' width='208' height='42' rx='1' fill='none' stroke='${a}' stroke-width='2'/>`;
      inner += rc(66, 24, 108, 14, nameC || "#111111", 1);       // centered name
      inner += rc(84, 43, 72, 5, titleC || "#555555");           // centered title
      inner += rc(52, 64, 136, 4, G);                            // centered contacts
      inner += rc(40, 74, 160, 4, G);                            // centered summary
      inner += rc(56, 82, 128, 4, G);
      let y = 98;
      for (let k = 0; k < 3; k++) {
        inner += rc(16, y + 5, 58, 2, a);                        // rule to the label
        inner += rc(78, y, 84, 12, a, 1);                        // solid label box
        inner += rc(88, y + 4, 64, 4, "#ffffff");
        inner += rc(166, y + 5, 58, 2, a);                       // rule to the edge
        inner += rc(84, y + 19, 72, 6, a);                       // role | stack (accent, bold)
        inner += rc(76, y + 29, 88, 5, "#555555");               // company · location (unweighted)
        inner += rc(94, y + 38, 52, 4, "#666666");               // dates
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
      // section bands with "Role | Stack" over "Company | Location | Dates".
      const band = head ? head + "33" : "#e9eaf3";
      inner += `<rect x='16' y='14' width='208' height='48' rx='6' fill='${band}'/>`;
      inner += rc(78, 22, 84, 14, nameC || "#1b1f27", 2);        // centered name
      inner += rc(92, 41, 56, 5, titleC || "#7a8090");           // centered title
      inner += rc(60, 52, 120, 4, G);                            // centered contacts
      let y = 74;
      for (let k = 0; k < 4; k++) {
        inner += rc(16, y, 208, 12, band, 2);                    // full-width band
        inner += rc(96, y + 4, 48, 5, nameC || "#1b1f27");       // centered label (name colour)
        inner += rc(20, y + 20, 108, 6, "#1b1f27");              // Role | Stack
        inner += rc(20, y + 30, 88, 4, G);                       // Company | Location | Dates
        for (let i = 0; i < 3; i++) {
          inner += `<circle cx='26' cy='${y + 43 + i * 8}' r='1.6' fill='#555555'/>`;
          inner += rc(32, y + 41 + i * 8, 188, 3.5, G);
        }
        y += 60;
      }
      break;
    }
    case "network": {
      // Faint node network at the top, navy name, teal title, summary lines, the
      // navy contact bar with its lighter layer, then icon headings, the rail
      // with teal dots, and the three-colour divider.
      const navy = head ? darken(head, 0.55) : "#1e3448";
      const net = [[60, 14, 140, 40], [140, 40, 200, 20], [200, 20, 222, 58], [100, 60, 160, 70]];
      net.forEach(([x1, y1, x2, y2]) => { inner += `<line x1='${x1}' y1='${y1}' x2='${x2}' y2='${y2}' stroke='#eceef1' stroke-width='1'/>`; });
      [[60, 14, 4], [140, 40, 6], [200, 20, 4], [222, 58, 8], [160, 70, 5], [100, 60, 3]].forEach(([x, y, r]) => { inner += `<circle cx='${x}' cy='${y}' r='${r}' fill='#eef0f3'/>`; });
      inner += rc(16, 16, 92, 13, nameC || navy, 2);               // name
      inner += rc(16, 34, 70, 6, titleC || a);                      // title (teal)
      for (let i = 0; i < 3; i++) inner += rc(16, 46 + i * 7, i === 2 ? 150 : 206, 3.5, G);
      inner += rc(20, 77, 200, 7, "#c8d0d8", 2);                    // lighter layer
      inner += rc(16, 70, 208, 11, navy, 3);                        // contact bar
      inner += rc(56, 74, 128, 3, "#ffffffaa");
      let y = 98;
      for (let k = 0; k < 2; k++) {
        if (k) { inner += rc(16, y - 10, 66, 2.5, a + "99", 1); inner += rc(87, y - 10, 66, 2.5, "#c9cbce", 1); inner += rc(158, y - 10, 66, 2.5, "#c6d9ea", 1); }
        inner += `<circle cx='22' cy='${y + 4}' r='6' fill='${navy}'/>`;  // icon circle
        inner += rc(32, y + 1, 64, 6, navy);                         // heading
        inner += rc(21, y + 10, 1.6, k ? 34 : 88, navy);             // rail
        const entries = k ? 1 : 2;
        for (let e = 0; e < entries; e++) {
          const ey = y + 16 + e * 44;
          inner += `<circle cx='21.8' cy='${ey + 2}' r='2.6' fill='${a}'/>`;
          inner += rc(30, ey, 70, 5, "#14181e");                     // role
          inner += rc(30, ey + 8, 44, 4, G);                         // company
          inner += rc(30, ey + 15, 30, 3.5, G);                      // dates
          inner += rc(30, ey + 22, 44, 3.5, a);                      // label
          for (let i = 0; i < 2; i++) inner += rc(30, ey + 29 + i * 6, 186, 3, G);
        }
        y += k ? 62 : 112;
      }
      inner += rc(16, y - 6, 66, 2.5, a + "99", 1); inner += rc(87, y - 6, 66, 2.5, "#c9cbce", 1); inner += rc(158, y - 6, 66, 2.5, "#c6d9ea", 1);
      inner += `<circle cx='22' cy='${y + 8}' r='6' fill='${navy}'/>`;
      inner += rc(32, y + 5, 70, 6, navy);
      for (let r2 = 0; r2 < 2; r2++) {
        inner += rc(16, y + 18 + r2 * 16, 60, 4.5, "#14181e"); inner += rc(16, y + 25 + r2 * 16, 90, 3, G);
        inner += rc(124, y + 18 + r2 * 16, 60, 4.5, "#14181e"); inner += rc(124, y + 25 + r2 * 16, 90, 3, G);
      }
      break;
    }
    case "nexus": {
      // Serif name and summary over faint grey nodes, the full-width contact
      // band, plain headings, label/items skills, and ticked role blocks.
      const ink = head || "#1a1a1a";
      [[150, 14, 172, 40], [172, 40, 214, 26], [214, 26, 236, 62], [172, 40, 196, 76]].forEach(([x1, y1, x2, y2]) => { inner += `<line x1='${x1}' y1='${y1}' x2='${x2}' y2='${y2}' stroke='#ececec' stroke-width='1'/>`; });
      [[150, 14, 3], [172, 40, 6], [214, 26, 4], [236, 62, 7], [196, 76, 5]].forEach(([x, y, r]) => { inner += `<circle cx='${x}' cy='${y}' r='${r}' fill='#ebebeb'/>`; });
      inner += rc(16, 16, 90, 12, nameC || "#111", 2);
      inner += rc(16, 33, 64, 5.5, titleC || "#444");
      for (let i = 0; i < 4; i++) inner += rc(16, 44 + i * 6, i === 3 ? 120 : 208, 3, G);
      inner += rc(0, 74, 240, 20, ink, 0);
      [[16, 79], [128, 79], [16, 87], [128, 87]].forEach(([x, y]) => { inner += rc(x, y, 4, 4, "#fff", 1); inner += rc(x + 7, y + 0.6, 50, 2.6, "#ffffffaa"); });
      inner += rc(16, 104, 60, 6, "#111");
      for (let i = 0; i < 4; i++) { inner += rc(16, 116 + i * 8, 26, 3.5, "#111"); inner += rc(52, 116 + i * 8, i % 2 ? 120 : 160, 3, G); }
      inner += rc(16, 156, 72, 6, "#111");
      let y = 168;
      for (let e = 0; e < 2; e++) {
        inner += rc(0, y + 2, 12, 1.4, ink, 0);
        inner += rc(16, y, 76, 5, "#111");
        inner += rc(16, y + 8, 46, 5, "#333");
        inner += rc(16, y + 16, 26, 2.6, "#777"); inner += rc(190, y + 16, 34, 2.6, "#999");
        for (let i = 0; i < 4; i++) { inner += `<circle cx='18.5' cy='${y + 24.5 + i * 7}' r='1.6' fill='none' stroke='${ink}' stroke-width='0.8'/>`; inner += rc(24, y + 23 + i * 7, i === 3 ? 140 : 196, 3, G); }
        y += 60;
      }
      break;
    }
    case "slate": {
      // Light name, gold title and summary beside a slate contact card; then
      // icon-tile headings with gold / slate / gold bars, a two-column skills
      // grid, and roles with gold dates over gold square bullets.
      const dark = "#2b313b";
      inner += `<path d='M0 8 30 34 0 60M22 0 58 30 22 60M110 70 140 46 170 70' fill='none' stroke='#eeeeee' stroke-width='1'/>`;
      inner += rc(14, 18, 92, 12, nameC || dark, 2);                  // name
      inner += rc(14, 35, 62, 5.5, titleC || a);                      // title
      for (let i = 0; i < 5; i++) inner += rc(14, 46 + i * 6, i === 4 ? 90 : 128, 3, G);
      inner += rc(152, 14, 74, 64, dark, 4);                          // contact card
      for (let i = 0; i < 4; i++) { inner += rc(160, 22 + i * 14, 8, 8, "#ffffff", 2); inner += rc(173, 25 + i * 14, 44, 2.6, "#ffffffaa"); }
      const heading = (y, w) => {
        inner += rc(14, y - 1, 8, 10, a + "88", 2);
        inner += rc(17, y - 2, 8, 12, a, 2);
        inner += rc(20, y - 3, 13, 14, dark, 3);
        inner += rc(38, y + 1, w, 6, dark);
        const x0 = 38 + w + 10, seg = (226 - x0 - 8) / 3;
        [a, dark, a].forEach((c, i) => { inner += rc(x0 + i * (seg + 4), y + 2.5, seg, 2.6, c, 1.3); });
      };
      heading(96, 60);
      for (let r2 = 0; r2 < 3; r2++) {
        const yy = 112 + r2 * 13;
        inner += rc(16, yy, 30, 3.5, "#14181e"); inner += rc(52, yy, 58, 3, G); inner += rc(52, yy + 5, 40, 3, G);
        inner += rc(124, yy, 30, 3.5, "#14181e"); inner += rc(160, yy, 58, 3, G); inner += rc(160, yy + 5, 44, 3, G);
      }
      heading(160, 70);
      let y = 175;
      for (let e = 0; e < 2; e++) {
        inner += rc(16, y, 76, 5.5, "#14181e");
        inner += rc(16, y + 8, 40, 4.5, "#4a4f57");
        inner += rc(16, y + 16, 30, 3, a);
        for (let i = 0; i < 4; i++) { inner += rc(17, y + 23 + i * 7, 3.4, 3.4, a, 0.8); inner += rc(24, y + 23.4 + i * 7, i === 3 ? 140 : 196, 3, G); }
        y += 56;
      }
      inner += `<path d='M150 320 180 292 210 320M180 292 210 264 240 292' fill='none' stroke='#eeeeee' stroke-width='1'/>`;
      break;
    }
    case "spectrum": {
      // Fixed colours: the left band in one colour per section, a heavy name and
      // title with the contacts stacked right, and hairline headings that start
      // in the section's colour.
      const cols = ["#c676b0", "#7e56a1", "#5873b6", "#d9a466", "#e5e56b", "#bddca8"];
      const band = [[0, 54], [54, 92], [92, 152], [152, 262], [262, 300], [300, 320]];
      band.forEach(([y0, y1], i) => { inner += rc(0, y0, 10, y1 - y0, cols[i], 0); });
      inner += rc(24, 20, 110, 15, "#1d1d1d", 1);                     // name
      inner += rc(24, 40, 78, 6, "#2b2b2b");                            // title
      for (let i = 0; i < 4; i++) inner += rc(174 - (i % 2) * 14, 18 + i * 6, 50 + (i % 2) * 14, 3, G);
      const heading = (y, w, c) => {
        inner += rc(24, y, w, 5.5, "#2b2b2b");
        inner += rc(24 + w + 10, y + 2.5, 216 - w - 24, 0.8, "#a8a8a8", 0);
        inner += rc(24 + w + 10, y + 1.8, 52, 2.2, c, 0);
      };
      heading(60, 38, cols[1]);
      for (let i = 0; i < 3; i++) inner += rc(24, 72 + i * 6, i === 2 ? 120 : 196, 3, G);
      heading(98, 34, cols[2]);
      inner += rc(24, 110, 60, 4, "#2b2b2b"); for (let i = 0; i < 2; i++) inner += rc(24, 118 + i * 6, 190, 3, G);
      inner += rc(24, 134, 50, 4, "#2b2b2b"); inner += rc(24, 142, 150, 3, G);
      heading(158, 46, cols[3]);
      let y = 170;
      for (let e = 0; e < 2; e++) {
        inner += rc(24, y, 92, 4.5, "#1d1d1d"); inner += rc(176, y, 44, 4.5, "#1d1d1d");
        for (let i = 0; i < 3; i++) { inner += `<circle cx='29' cy='${y + 11.5 + i * 7}' r='1.2' fill='#2b2b2b'/>`; inner += rc(34, y + 10 + i * 7, i === 2 ? 130 : 182, 3, G); }
        y += 44;
      }
      heading(268, 40, cols[4]);
      inner += rc(24, 280, 120, 4.5, "#1d1d1d"); inner += rc(176, 280, 44, 4.5, "#1d1d1d");
      heading(302, 54, cols[5]);
      break;
    }
    case "diamond": {
      // Light name, teal title, summary lines and a centred contact row; then
      // diamond-badge headings with a pale rule, a two-column skills grid, and
      // roles with italic dates over hollow-diamond bullets.
      const teal = titleC || (head ? darken(head, 0.62) : "#1d5a6e");
      const soft = a + "55";
      const ink = head ? darken(head, 0.5) : "#1f3c5a";
      const diamond = (cx, cy, r, fill, stroke) =>
        `<rect x='${cx - r}' y='${cy - r}' width='${r * 2}' height='${r * 2}' rx='${r * 0.25}' transform='rotate(45 ${cx} ${cy})' fill='${fill}'${stroke ? ` stroke='${stroke}' stroke-width='1'` : ""}/>`;
      const heading = (y, w) => {
        inner += diamond(23, y + 3, 5, a);
        inner += diamond(23, y + 3, 2.2, "none", "#fff");
        inner += rc(33, y, w, 6, "#14181e");
        inner += rc(33 + w + 12, y + 2.5, 186 - w - 12, 1.4, soft);
        inner += diamond(33 + w + 12, y + 3.2, 2, soft);
        inner += diamond(219, y + 3.2, 2, soft);
      };
      inner += rc(16, 16, 96, 13, nameC || "#2a2e35", 2);         // name
      inner += rc(16, 34, 74, 6, teal);                              // title
      for (let i = 0; i < 4; i++) inner += rc(16, 46 + i * 6, i === 3 ? 140 : 208, 3, G);
      for (let i = 0; i < 4; i++) { inner += rc(36 + i * 46, 76, 5, 5, ink, 1); inner += rc(44 + i * 46, 77, 30, 3, G); }
      heading(94, 66);
      for (let r2 = 0; r2 < 3; r2++) {
        const yy = 108 + r2 * 13;
        inner += rc(16, yy, 30, 3.5, "#14181e"); inner += rc(52, yy, 58, 3, G); inner += rc(52, yy + 5, 40, 3, G);
        inner += rc(124, yy, 30, 3.5, "#14181e"); inner += rc(160, yy, 58, 3, G); inner += rc(160, yy + 5, 44, 3, G);
      }
      heading(156, 74);
      let y = 170;
      for (let e = 0; e < 2; e++) {
        inner += rc(16, y, 76, 5.5, "#14181e");                    // role
        inner += rc(16, y + 8, 40, 4.5, "#4a4f57");                // company
        inner += rc(16, y + 16, 34, 3, teal);                      // dates
        for (let i = 0; i < 4; i++) {
          inner += diamond(19, y + 25 + i * 7, 1.8, "none", a);
          inner += rc(25, y + 23.5 + i * 7, i === 3 ? 140 : 195, 3, G);
        }
        y += 56;
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
