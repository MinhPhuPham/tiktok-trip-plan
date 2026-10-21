import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { classes } from "../lib/css";

interface BottomSheetProps {
  /** Phone layout: a sheet at the bottom; otherwise a plain side panel. */
  phone: boolean;
  open: boolean;
  onToggle: () => void;
  /** Accessible name of the handle ("Show list" / "Hide list"). */
  toggleLabel: string;
  /** id of the body the handle controls. */
  bodyId: string;
  handleId?: string;
  id?: string;
  className?: string;
  /** Always visible while collapsed (the "Next stop" row). */
  peek?: ReactNode;
  /** Header and tabs: off screen and inert while collapsed. */
  head: ReactNode;
  children: ReactNode;
}

/**
 * Side panel on desktop, bottom sheet on phones. Collapsed, the sheet shows the handle and the
 * peek row; the rest is inert. Open, the peek row is hidden. The collapsed height is published as
 * --peek on <html> (the map area ends there), measured only while collapsed.
 */
export function BottomSheet({
  phone,
  open,
  onToggle,
  toggleLabel,
  bodyId,
  handleId,
  id,
  className,
  peek,
  head,
  children,
}: BottomSheetProps) {
  const handle = useRef<HTMLButtonElement>(null);
  const peekBox = useRef<HTMLDivElement>(null);
  const headBox = useRef<HTMLDivElement>(null);
  const bodyBox = useRef<HTMLDivElement>(null);
  const away = phone && !open;

  useLayoutEffect(() => {
    if (!away) return;
    const measure = () => {
      const peekRow = peekBox.current;
      const edge = peekRow && peekRow.offsetHeight > 0 ? peekRow : headBox.current?.firstElementChild;
      if (edge instanceof HTMLElement) {
        document.documentElement.style.setProperty("--peek", `${edge.offsetTop + edge.offsetHeight}px`);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const node of [peekBox.current, headBox.current]) if (node) observer.observe(node);
    return () => observer.disconnect();
  }, [away]);

  useEffect(() => {
    if (!away) return;
    const active = document.activeElement;
    const lost = [headBox.current, bodyBox.current].some((part) => part && active && part.contains(active));
    if (lost) handle.current?.focus({ preventScroll: true });
  }, [away]);

  return (
    <aside id={id} className={classes("panel", open && "is-open", className)}>
      <button
        ref={handle}
        id={handleId}
        className="sheet-handle"
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
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
    </aside>
  );
}
