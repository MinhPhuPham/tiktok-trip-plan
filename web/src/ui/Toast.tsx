import { useEffect, useRef, useState } from "react";
import { DOM_IDS, focusById } from "../app/ids";
import { selectToast, useTripActions, useTripStore } from "../state/hooks";
import type { Toast as ToastData } from "../state/store";

const ANNOUNCE_DELAY_MS = 30;

/**
 * The live region stays mounted; a new message is set a tick after clearing so screen readers
 * announce a repeat. The timer pauses while the pointer or focus is on the toast.
 */
export function Toast() {
  const toast = useTripStore(selectToast);
  const { hideToast } = useTripActions();
  const [shown, setShown] = useState<ToastData | null>(null);
  const timer = useRef(0);
  const remaining = useRef(0);
  const startedAt = useRef(0);

  useEffect(() => {
    const wait = window.setTimeout(() => setShown(toast), toast ? ANNOUNCE_DELAY_MS : 0);
    return () => window.clearTimeout(wait);
  }, [toast]);

  useEffect(() => {
    if (!shown) return;
    remaining.current = shown.durationMs;
    startedAt.current = Date.now();
    timer.current = window.setTimeout(() => hideToast(shown.id), remaining.current);
    return () => window.clearTimeout(timer.current);
  }, [shown, hideToast]);

  const hold = () => {
    window.clearTimeout(timer.current);
    remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
  };
  const release = () => {
    if (!shown) return;
    window.clearTimeout(timer.current);
    startedAt.current = Date.now();
    const { id } = shown;
    timer.current = window.setTimeout(() => hideToast(id), Math.max(remaining.current, 1500));
  };

  const runAction = () => {
    const action = shown?.action;
    hideToast(shown?.id);
    action?.run();
    const active = document.activeElement;
    const lost = !active || active === document.body || document.getElementById(DOM_IDS.toast)?.contains(active);
    if (lost && !focusById(DOM_IDS.cardTitle)) focusById(DOM_IDS.map);
  };

  const visible = Boolean(shown && toast && shown.id === toast.id);
  return (
    <div
      id={DOM_IDS.toast}
      className={visible ? "toast is-shown" : "toast"}
      role="status"
      aria-live="polite"
      data-plain={shown?.action ? undefined : ""}
      onPointerEnter={hold}
      onPointerLeave={release}
      onFocus={hold}
      onBlur={release}
    >
      <span>{visible ? shown?.message : ""}</span>
      {visible && shown?.action ? (
        <button type="button" className="toast-action" onClick={runAction}>
          {shown.action.label}
        </button>
      ) : null}
    </div>
  );
}
