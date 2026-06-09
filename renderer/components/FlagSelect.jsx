import { useEffect, useRef, useState } from "react";
import { countryFlag } from "../lib/flags";

// A themed dropdown whose options can show a country flag before the label.
export default function FlagSelect({ value, onChange, options, placeholder }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const opts = options || [];
  const selected = opts.find((o) => String(o.value) === String(value));

  return (
    <div className={"flagselect" + (open ? " open" : "")} ref={ref}>
      <button
        type="button"
        className="input flagselect-btn"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="flagselect-label">
          {selected ? (
            <>
              {selected.country ? (
                <span className="flag">{countryFlag(selected.country)}</span>
              ) : null}
              {selected.name}
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
          {opts.map((o) => (
            <button
              type="button"
              key={o.value}
              className={
                "flagselect-opt" + (String(o.value) === String(value) ? " active" : "")
              }
              onClick={() => { onChange(String(o.value)); setOpen(false); }}
            >
              {o.country ? <span className="flag">{countryFlag(o.country)}</span> : null}
              <span className="flagselect-optname">{o.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
