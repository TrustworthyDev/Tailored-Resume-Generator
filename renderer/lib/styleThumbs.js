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
    default: // professional
      inner += rc(20, 20, 7, 42, a, 1);
      inner += rc(36, 24, 100, 16, nameC || "#1f2937", 3);
      inner += rc(36, 46, 70, 6, titleC || G);
      inner += sections(82, a, { rule: true });
  }

  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 240 320'><rect width='240' height='320' fill='#ffffff'/>${inner}</svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg);
}
