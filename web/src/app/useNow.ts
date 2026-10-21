import { useEffect, useState } from "react";

const MINUTE_MS = 60_000;

/** The current time, refreshed every minute (next stop, open now). */
export function useNow(intervalMs: number = MINUTE_MS): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
