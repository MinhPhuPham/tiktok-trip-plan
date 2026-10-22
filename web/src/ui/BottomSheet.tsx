import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { classes } from "../lib/css";
import { stepDetent, type SheetDetent } from "../lib/sheetSnap";
import { createSheetDrag, type SheetDrag } from "./sheetDrag";

interface BottomSheetProps {
  /** Phone layout: a sheet at the bottom; otherwise a plain side panel. */
  phone: boolean;
  detent: SheetDetent;
  /** A drag or an arrow key chose a detent. */
  onDetentChange: (detent: SheetDetent) => void;
  /** The handle's tap: collapse, or reopen at the last open detent. */
  onToggle: () => void;
  /** Accessible name of the handle ("Show list" / "Hide list, half height"). */
  toggleLabel: string;
  /** Announced politely when the detent changes ("List at half height"). */
  status: string;
  /** id of the body the handle controls. */
  bodyId: string;
  handleId?: string;
  /** id of the heading that names the panel. */
  labelId?: string;
  id?: string;
  className?: string;
  /** Rendered first and never inert (a phone's screen-reader-only heading). */
  title?: ReactNode;
  /** Shown while collapsed (the open tab's peek row); fades out as the head fades in. */
  peek?: ReactNode;
  /** Header and tabs: inert while collapsed. */
  head: ReactNode;
  children: ReactNode;
}

const STEP_KEYS: Readonly<Record<string, -1 | 1>> = { ArrowUp: -1, ArrowDown: 1 };

/**
 * Side panel on desktop, draggable bottom sheet on phones with three detents: peek (handle and
 * peek row), half and full. Header and list are inert at the peek. The drag itself lives in
 * sheetDrag.ts and never re-renders React.
 */
export function BottomSheet({
  phone,
  detent,
  onDetentChange,
  onToggle,
  toggleLabel,
  status,
  bodyId,
  handleId,
  labelId,
  id,
  className,
  title,
  peek,
  head,
  children,
}: BottomSheetProps) {
  const panel = useRef<HTMLElement>(null);
  const handle = useRef<HTMLButtonElement>(null);
  const peekBox = useRef<HTMLDivElement>(null);
  const headBox = useRef<HTMLDivElement>(null);
  const bodyBox = useRef<HTMLDivElement>(null);
  const live = useRef<HTMLParagraphElement>(null);
  const announced = useRef(detent);
  const current = useRef(detent);
  const release = useRef(onDetentChange);
  const drag = useRef<SheetDrag | null>(null);
  const away = phone && detent === "peek";

  useLayoutEffect(() => {
    release.current = onDetentChange;
  });

  useLayoutEffect(() => {
    current.current = detent;
    drag.current?.show(detent);
  }, [detent]);

  useLayoutEffect(() => {
    const [p, k, h, b] = [panel.current, peekBox.current, headBox.current, bodyBox.current];
    if (!phone || !p || !k || !h || !b) return undefined;
    const controller = createSheetDrag({ panel: p, peek: k, head: h, body: b }, (d) => release.current(d), current.current);
    drag.current = controller;
    return () => {
      controller.dispose();
      drag.current = null;
    };
  }, [phone]);

  useEffect(() => {
    if (!phone || announced.current === detent) return;
    announced.current = detent;
    if (live.current) live.current.textContent = status;
  }, [phone, detent, status]);

  useEffect(() => {
    if (!away) return;
    const active = document.activeElement;
    const lost = [headBox.current, bodyBox.current].some((part) => part && active && part.contains(active));
    if (lost) handle.current?.focus({ preventScroll: true });
  }, [away]);

  const onHandleKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = STEP_KEYS[event.key];
    if (!step || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    const next = stepDetent(detent, step);
    if (next !== detent) onDetentChange(next);
  };

  return (
    <aside ref={panel} id={id} className={classes("panel", className)} aria-labelledby={labelId} data-sheet={phone ? detent : undefined}>
      {title}
      <button
        ref={handle}
        id={handleId}
        className="sheet-handle"
        type="button"
        aria-expanded={!away}
        aria-controls={bodyId}
        onClick={onToggle}
        onKeyDown={phone ? onHandleKey : undefined}
      >
        <span aria-hidden="true" />
        <b className="sr-only">{toggleLabel}</b>
      </button>
      <div ref={peekBox} className="sheet-peek">
        {peek}
      </div>
      <div ref={headBox} className="sheet-head" inert={away} aria-hidden={away || undefined}>
        {head}
      </div>
      <div ref={bodyBox} className="panel-body" id={bodyId} inert={away} aria-hidden={away || undefined}>
        {children}
      </div>
      <p ref={live} className="sr-only" aria-live="polite" />
    </aside>
  );
}
