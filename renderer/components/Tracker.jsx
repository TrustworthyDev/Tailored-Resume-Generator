import { useEffect, useState } from "react";
import { api } from "../lib/api";

// Start/End a counting session; shows today's application total.
export default function Tracker() {
  const [active, setActive] = useState(false);
  const [count, setCount] = useState(0);

  const refresh = async () => {
    const s = await api().getActiveSession();
    setActive(!!(s && s.active));
    const c = await api().getTodayCount();
    setCount((c && c.count) || 0);
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, []);

  const start = async () => { await api().startSession(); refresh(); };
  const end = async () => { await api().endSession(); refresh(); };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Tracker</h2>
        {active ? (
          <span className="badge live">session active</span>
        ) : (
          <span className="badge off">no session</span>
        )}
      </div>
      <p className="muted">
        Start a session while you apply; the count below reflects applications
        recorded today.
      </p>

      <div className="total-box" style={{ marginTop: 14 }}>
        <span className="muted small">Applications today</span>
        <strong className="total-num">{count}</strong>
      </div>

      <div className="row">
        {!active ? (
          <button className="btn primary" onClick={start}>Start</button>
        ) : (
          <button className="btn danger" onClick={end}>End</button>
        )}
      </div>
    </section>
  );
}
