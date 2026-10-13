import { useEffect, useRef } from "react";
import { api } from "./api";

// Call `reload` whenever another app saves to the shared database, so a screen
// that's already open shows the new data. Only lists re-read — a form being
// edited keeps what the user typed.
export function useDbChanged(reload) {
  const latest = useRef(reload);
  latest.current = reload;
  useEffect(() => {
    const off = api().onDbChanged(() => latest.current());
    return () => {
      if (typeof off === "function") off();
    };
  }, []);
}
