import { useState } from "react";
import { styleThumb } from "../lib/styleThumbs";
import { PRESET_COLORS, FONT_OPTIONS, SIZE_OPTIONS } from "../lib/resumeStyles";

// The Resume Styles panel - Name and Content colour pickers, font and size, and
// the template grid (drag to reorder). Shared by Generate and Build so the two
// always look and behave the same; each page owns the values and handlers.
export default function ResumeStylesPanel({
  styles, style, styleDragIndex, accent, nameColor, font, fontSize, colorLock,
  onStyle, chooseAccent, chooseNameColor, onFont, onFontSize,
  onStyleDragStart, onStyleDragOver, onStyleDragEnd,
}) {
  const [pickersOpen, setPickersOpen] = useState(true); // colors & font section expanded
  return (
    <section className="card resume-styles">
      <div className="styles-head">
        <h2>Resume Styles</h2>
        <button
          type="button"
          className="section-collapse"
          onClick={() => setPickersOpen((o) => !o)}
          title={pickersOpen ? "Hide colors & font" : "Show colors & font"}
        >
          Colors &amp; Font {pickersOpen ? "▾" : "▸"}
        </button>
      </div>

      {pickersOpen && (
      <div className="styles-pickers">
      <div className="color-section">
        <span className="field-label">Name Color Picker</span>
        <div className="swatch-row">
          <button
            type="button"
            className={"swatch swatch-default" + (!nameColor ? " active" : "")}
            onClick={() => chooseNameColor("")}
            title="Each template's own default name & title color"
          >
            Default
          </button>
          {PRESET_COLORS.map((c) => {
            const on = nameColor.toLowerCase() === c.value;
            const taken = !!accent && accent.toLowerCase() === c.value; // used by Content
            return (
              <button
                key={c.value}
                type="button"
                className={"swatch" + (on ? " active" : "")}
                style={{ background: c.value }}
                onClick={() => chooseNameColor(c.value)}
                disabled={colorLock && taken && !on}
                title={colorLock && taken ? `${c.name} — used by the Content picker (Cards style)` : c.name}
                aria-label={c.name}
              >
                {on ? "✓" : ""}
              </button>
            );
          })}
          <button
            type="button"
            className={"swatch swatch-white" + (nameColor.toLowerCase() === "#ffffff" ? " active" : "")}
            style={{ background: "#ffffff" }}
            onClick={() => chooseNameColor("#ffffff")}
            disabled={colorLock && accent.toLowerCase() === "#ffffff" && nameColor.toLowerCase() !== "#ffffff"}
            title={colorLock && accent.toLowerCase() === "#ffffff" ? "White — used by the Content picker (Cards style)" : "White"}
            aria-label="White"
          >
            {nameColor.toLowerCase() === "#ffffff" ? "✓" : ""}
          </button>
          <label className="swatch swatch-custom" title="Custom color">
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(nameColor) ? nameColor : "#3366ff"}
              onChange={(e) => chooseNameColor(e.target.value)}
            />
          </label>
        </div>
      </div>

      <div className="color-section">
        <span className="field-label">Content Color Picker</span>
        <div className="swatch-row">
          <button
            type="button"
            className={"swatch swatch-default" + (!accent ? " active" : "")}
            onClick={() => chooseAccent("")}
            title="Each template's own default content color"
          >
            Default
          </button>
          {PRESET_COLORS.map((c) => {
            const on = accent.toLowerCase() === c.value;
            const taken = !!nameColor && nameColor.toLowerCase() === c.value; // used by Name
            return (
              <button
                key={c.value}
                type="button"
                className={"swatch" + (on ? " active" : "")}
                style={{ background: c.value }}
                onClick={() => chooseAccent(c.value)}
                disabled={colorLock && taken && !on}
                title={colorLock && taken ? `${c.name} — used by the Name picker (Cards style)` : c.name}
                aria-label={c.name}
              >
                {on ? "✓" : ""}
              </button>
            );
          })}
          <button
            type="button"
            className={"swatch swatch-white" + (accent.toLowerCase() === "#ffffff" ? " active" : "")}
            style={{ background: "#ffffff" }}
            onClick={() => chooseAccent("#ffffff")}
            disabled={colorLock && nameColor.toLowerCase() === "#ffffff" && accent.toLowerCase() !== "#ffffff"}
            title={colorLock && nameColor.toLowerCase() === "#ffffff" ? "White — used by the Name picker (Cards style)" : "White"}
            aria-label="White"
          >
            {accent.toLowerCase() === "#ffffff" ? "✓" : ""}
          </button>
          <label className="swatch swatch-custom" title="Custom color">
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(accent) ? accent : "#3366ff"}
              onChange={(e) => chooseAccent(e.target.value)}
            />
          </label>
        </div>
      </div>

      <div className="font-section grid2">
        <label className="field">
          <span className="field-label">Font</span>
          <select className="input" value={font} onChange={(e) => onFont(e.target.value)}>
            {FONT_OPTIONS.map((f) => (
              <option key={f.label} value={f.value}>{f.label}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Size</span>
          <select className="input" value={fontSize} onChange={(e) => onFontSize(e.target.value)}>
            {SIZE_OPTIONS.map((s) => (
              <option key={s || "default"} value={s}>{s ? `${s} pt` : "Default"}</option>
            ))}
          </select>
        </label>
      </div>
      </div>
      )}

      <div className="style-grid">
        {styles.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className={
              (style === s.id ? "style-cell active" : "style-cell") +
              (styleDragIndex === i ? " dragging" : "")
            }
            onClick={() => onStyle(s.id)}
            title={`${s.label} — drag to reorder`}
            draggable
            onDragStart={onStyleDragStart(i)}
            onDragOver={onStyleDragOver(i)}
            onDragEnd={onStyleDragEnd}
          >
            <img alt={s.label} src={styleThumb({ ...s, ...(accent ? { accent, head: accent } : {}), ...(nameColor ? { nameColor } : {}) })} />
            {style === s.id && <span className="style-check" aria-label="active">✓</span>}
          </button>
        ))}
      </div>
    </section>
  );
}
