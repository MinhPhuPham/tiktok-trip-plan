import { useEffect, useRef } from "react";

const SPEAK_DELAY_MS = 50;

/**
 * One stable polite region. The text is cleared first and set a tick later so a repeated
 * message is read again; `seq` marks a new message, and each one is spoken once (the effect
 * re-runs when <Activity> shows the panel again).
 */
export function LiveRegion({ text, seq }: { text: string; seq: number }) {
  const region = useRef<HTMLDivElement>(null);
  const spoken = useRef(0);
  useEffect(() => {
    const node = region.current;
    if (!seq || seq === spoken.current || !node) return;
    node.textContent = "";
    const timer = window.setTimeout(() => {
      node.textContent = text;
      spoken.current = seq;
    }, SPEAK_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [text, seq]);
  return <div ref={region} className="pe-live sr-only" aria-live="polite" aria-atomic="true" />;
}
