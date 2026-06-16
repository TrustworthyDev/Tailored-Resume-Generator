import { useEffect, useRef, useState } from "react";
import { countryFlag } from "../lib/flags";

// A themed dropdown whose options can show a country flag before the label.
export default function FlagSelect({ value, onChange, options, placeholder }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const activeRef = useRef(null); // the currently-selected option, for scroll-into-view

  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // When the menu opens, bring the current selection into view so it's visible
  // even when the list is long enough to scroll.
  useEffect(() => {
    if (open && activeRef.current) {
      activeRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [open]);

  const opts = options || [];
  const selected = opts.find((o) => String(o.value) === String(value));

  return (
    <div className={"flagselect" + (open ? " open" : "")} ref={ref}>
      <button
        type="button"
        className="input flagselect-btn"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}
      >
        <span className="flagselect-label">
          {selected ? (
            <>
              {selected.country ? (
                <span className="flag">{countryFlag(selected.country)}</span>
              ) : null}
              <span className="flagselect-name">{selected.name}</span>
            </>
          ) : (
            <span className="muted">{placeholder || "Select"}</span>
          )}
        </span>
        <span className="flagselect-caret">▾</span>
      </button>

      {open && (
        <div className="flagselect-menu">
          {opts.length === 0 && <div className="flagselect-empty">No options</div>}
          {opts.map((o) => {
            const isActive = String(o.value) === String(value);
            return (
            <button
              type="button"
              key={o.value}
              ref={isActive ? activeRef : null}
              className={"flagselect-opt" + (isActive ? " active" : "")}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false); onChange(String(o.value)); }}
            >
              {o.country ? <span className="flag">{countryFlag(o.country)}</span> : null}
              <span className="flagselect-optname">{o.name}</span>
            </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
