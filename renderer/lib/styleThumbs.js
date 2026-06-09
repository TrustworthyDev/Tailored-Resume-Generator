// Distinct SVG thumbnails that mirror each style's actual template layout.
const G = "#c9ced6";
const R = "#dfe3ea";
const rc = (x, y, w, h, c, r = 1) =>
  `<rect x='${x}' y='${y}' width='${w}' height='${h}' rx='${r}' fill='${c}'/>`;

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
  let inner = "";

  switch (id) {
    case "modern":
      inner += rc(20, 22, 120, 16, "#16203a", 2);
      inner += rc(20, 44, 200, 3, a);
      inner += rc(20, 52, 80, 6, G);
      inner += sections(80, a);
      break;
    case "minimal":
      inner += rc(20, 24, 100, 14, "#222", 2);
      inner += rc(20, 46, 70, 6, G);
      inner += sections(82, "#9aa1ad");
      break;
    case "creative":
      inner += rc(16, 16, 208, 52, a, 6);
      inner += rc(28, 28, 110, 14, "#ffffff", 2);
      inner += rc(28, 48, 90, 6, "#ffffffaa");
      inner += sections(88, a);
      break;
    case "technical":
      inner += rc(20, 20, 7, 40, a, 1);
      inner += rc(34, 24, 110, 14, "#13233f", 2);
      inner += rc(34, 46, 70, 6, G);
      inner += sections(80, a, { tick: true });
      break;
    case "academic":
      inner += rc(60, 20, 120, 15, "#1f2937", 2);
      inner += rc(72, 42, 96, 6, G);
      inner += rc(20, 58, 200, 1, "#bbbbbb");
      inner += sections(72, "#33485f", { rule: true });
      break;
    case "executive":
      inner += rc(12, 12, 216, 54, "#16233b", 0);
      inner += rc(26, 26, 120, 15, "#ffffff", 2);
      inner += rc(26, 46, 90, 6, "#c7d2e0");
      inner += sections(84, "#16233b", { rule: true });
      break;
    case "compact": {
      inner += rc(20, 16, 110, 12, "#1f2937", 2);
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
      inner += rc(20, 18, 110, 14, "#1b3a5e", 2);
      inner += rc(20, 36, 84, 6, a);
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
      inner += rc(20, yy + 20, 90, 6, "#1b3a5e");
      inner += rc(180, yy + 20, 40, 5, G);
      for (let i = 0; i < 2; i++) inner += rc(20, yy + 32 + i * 8, 200, 4, G);
      break;
    }
    default: // professional
      inner += rc(20, 20, 7, 42, a, 1);
      inner += rc(36, 24, 100, 16, a, 3);
      inner += rc(36, 46, 70, 6, G);
      inner += sections(82, a, { rule: true });
  }

  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 240 320'><rect width='240' height='320' fill='#ffffff'/>${inner}</svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg);
}
