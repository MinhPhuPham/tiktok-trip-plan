import { prefersReducedMotion } from "../app/viewport";
import {
  DRAG_SLOP_PX,
  openProgress,
  pickDetent,
  releaseVelocity,
  rubberBand,
  SETTLE_EASE,
  SETTLE_MS,
  settleEase,
  sheetOffsets,
  type DragSample,
  type SheetDetent,
  type SheetOffsets,
} from "../lib/sheetSnap";

export interface SheetParts {
  panel: HTMLElement;
  peek: HTMLElement;
  head: HTMLElement;
  body: HTMLElement;
}

export interface SheetDrag {
  /** Moves the sheet to a detent the store chose (animated unless `instant`); no-op when already there. */
  show: (detent: SheetDetent, instant?: boolean) => void;
  dispose: () => void;
}

/** Pixels the list scrolls on per px/ms of upward release speed after a drag handed over to it. */
const FLING_SCROLL_MS = 300;
const SAMPLE_LIMIT = 12;

type Gesture = {
  id: number;
  /** "body": the list, which only drags the sheet where it cannot scroll that way. */
  region: "grab" | "body";
  x0: number;
  y0: number;
  phase: "pending" | "drag" | "native";
  origin: number;
  finger: number;
  scroll0: number;
  y: number;
  scroll: number;
  samples: DragSample[];
};

const MATRIX = /^matrix(3d)?\((.+)\)$/;

/** Current translateY of an element, mid-transition included. */
function liveTranslateY(node: HTMLElement): number {
  const match = MATRIX.exec(getComputedStyle(node).transform);
  if (!match) return 0;
  const values = (match[2] ?? "").split(",").map(Number);
  return values[match[1] ? 13 : 5] ?? 0;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * The phone sheet's drag: it follows the finger 1:1 (written once per frame on the compositor),
 * resists past either end, and on release settles at the detent its velocity projects to with an
 * ease that starts at the release speed. Inside the list it only takes over where the list cannot
 * scroll that way (at the top, or upward at half), so ordinary scrolling stays native.
 * Publishes the collapsed height as --peek (bottom safe area included).
 */
export function createSheetDrag(parts: SheetParts, onRelease: (detent: SheetDetent) => void, initial: SheetDetent): SheetDrag {
  const { panel, peek, head, body } = parts;
  let offsets: SheetOffsets = { full: 0, half: 0, peek: 0 };
  let rest = initial;
  let hasPeek = false;
  let gesture: Gesture | null = null;
  let frame = 0;
  let suppressClick = false;

  const setTransition = (ms: number, ease: string) => {
    panel.style.transition = ms ? `transform ${ms}ms ${ease}` : "none";
    const fade = ms ? `opacity ${ms}ms ${ease}, visibility 0s linear` : "none";
    peek.style.transition = fade;
    head.style.transition = fade;
  };

  const paint = (y: number) => {
    panel.style.transform = `translate3d(0, ${y}px, 0)`;
    const progress = openProgress(offsets, y);
    peek.style.opacity = String(clamp01(1 - 2 * progress));
    peek.style.visibility = progress >= 1 ? "hidden" : "";
    head.style.opacity = hasPeek ? String(clamp01(2 * progress - 1)) : "";
  };

  const measure = () => {
    const safeBottom = parseFloat(getComputedStyle(panel).paddingBottom) || 0;
    hasPeek = peek.offsetHeight > 0;
    const edge = hasPeek ? peek : head.firstElementChild;
    if (!(edge instanceof HTMLElement)) return;
    const peekHeight = edge.offsetTop + edge.offsetHeight + safeBottom;
    document.documentElement.style.setProperty("--peek", `${Math.round(peekHeight)}px`);
    offsets = sheetOffsets({ sheetHeight: panel.offsetHeight, peekHeight, viewportHeight: window.innerHeight });
    panel.style.setProperty("--sheet-cut", `${offsets.half}px`);
  };

  const settle = (detent: SheetDetent, velocity: number, instant: boolean) => {
    const from = liveTranslateY(panel);
    const to = offsets[detent];
    rest = detent;
    if (instant || prefersReducedMotion()) setTransition(0, SETTLE_EASE);
    else setTransition(SETTLE_MS, settleEase(to - from, velocity));
    paint(to);
  };

  const relayout = () => {
    measure();
    if (gesture?.phase === "drag") return;
    setTransition(0, SETTLE_EASE);
    paint(offsets[rest]);
  };

  const claimable = (dy: number): boolean => {
    const atTop = body.scrollTop <= 0;
    if (rest === "full") return dy > 0 && atTop;
    if (rest === "half") return dy < 0 || (dy > 0 && atTop);
    return false;
  };

  const write = () => {
    frame = 0;
    if (gesture?.phase !== "drag") return;
    paint(gesture.y);
    if (gesture.region === "body" && body.scrollTop !== gesture.scroll) body.scrollTop = gesture.scroll;
  };

  const track = (g: Gesture, event: PointerEvent) => {
    g.samples.push({ t: event.timeStamp, y: event.clientY });
    if (g.samples.length > SAMPLE_LIMIT) g.samples.shift();
    const raw = g.origin + event.clientY - g.finger;
    if (g.region === "body" && raw < 0) {
      g.y = 0;
      g.scroll = g.scroll0 - raw;
    } else {
      g.y = rubberBand(raw, 0, offsets.peek, panel.offsetHeight);
      g.scroll = g.scroll0;
    }
    if (!frame) frame = requestAnimationFrame(write);
  };

  const begin = (g: Gesture, event: PointerEvent) => {
    const y = liveTranslateY(panel);
    Object.assign(g, { phase: "drag", origin: y, finger: event.clientY, scroll0: body.scrollTop, y, scroll: body.scrollTop });
    g.samples = [{ t: event.timeStamp, y: event.clientY }];
    try {
      panel.setPointerCapture(event.pointerId);
    } catch {
      /* the pointer already ended */
    }
    panel.classList.add("is-dragging");
    setTransition(0, SETTLE_EASE);
    paint(y);
  };

  const end = (event: PointerEvent, cancelled: boolean) => {
    const g = gesture;
    if (!g || event.pointerId !== g.id) return;
    gesture = null;
    if (g.phase !== "drag") return;
    cancelAnimationFrame(frame);
    frame = 0;
    panel.classList.remove("is-dragging");
    suppressClick = true;
    const velocity = cancelled ? 0 : releaseVelocity(g.samples, event.timeStamp);
    const handedToList = g.region === "body" && g.scroll > g.scroll0;
    const target = handedToList ? "full" : pickDetent(offsets, g.y, velocity);
    settle(target, velocity, false);
    if (handedToList && velocity < 0) {
      body.scrollBy({ top: -velocity * FLING_SCROLL_MS, behavior: prefersReducedMotion() ? "instant" : "smooth" });
    }
    onRelease(target);
  };

  const onPointerDown = (event: PointerEvent) => {
    suppressClick = false;
    if (gesture || !event.isPrimary || event.button !== 0 || !(event.target instanceof Node)) return;
    const region = body.contains(event.target) ? "body" : "grab";
    if (region === "body" && event.pointerType === "mouse") return;
    gesture = {
      id: event.pointerId,
      region,
      x0: event.clientX,
      y0: event.clientY,
      phase: "pending",
      origin: 0,
      finger: 0,
      scroll0: 0,
      y: 0,
      scroll: 0,
      samples: [],
    };
  };

  const onPointerMove = (event: PointerEvent) => {
    const g = gesture;
    if (!g || event.pointerId !== g.id || g.phase === "native") return;
    if (g.phase === "pending") {
      const dx = event.clientX - g.x0;
      const dy = event.clientY - g.y0;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < DRAG_SLOP_PX) return;
      if (Math.abs(dx) > Math.abs(dy) || (g.region === "body" && !claimable(dy))) {
        g.phase = "native";
        return;
      }
      begin(g, event);
    }
    track(g, event);
  };

  /* Pointer events come first: a claimed gesture's touchmove is cancelled so the list does not scroll too. */
  const onTouchMove = (event: TouchEvent) => {
    const g = gesture;
    if (!g || !event.cancelable) return;
    if (g.phase === "drag") {
      event.preventDefault();
      return;
    }
    const touch = event.touches[0];
    if (g.phase !== "pending" || g.region !== "body" || !touch) return;
    const dx = touch.clientX - g.x0;
    const dy = touch.clientY - g.y0;
    if (dy !== 0 && Math.abs(dy) >= Math.abs(dx) && claimable(dy)) event.preventDefault();
  };

  const onPointerUp = (event: PointerEvent) => end(event, false);
  const onPointerCancel = (event: PointerEvent) => end(event, true);

  const onClickCapture = (event: MouseEvent) => {
    if (!suppressClick || event.detail === 0) return;
    suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  };

  const observer = new ResizeObserver(relayout);
  for (const node of [panel, peek, head]) observer.observe(node);
  window.addEventListener("resize", relayout, { passive: true });
  panel.addEventListener("pointerdown", onPointerDown);
  panel.addEventListener("pointermove", onPointerMove);
  panel.addEventListener("pointerup", onPointerUp);
  panel.addEventListener("pointercancel", onPointerCancel);
  panel.addEventListener("touchmove", onTouchMove, { passive: false });
  panel.addEventListener("click", onClickCapture, true);
  measure();
  settle(initial, 0, true);

  return {
    show: (detent, instant = false) => {
      if (detent === rest || gesture?.phase === "drag") return;
      settle(detent, 0, instant);
    },
    dispose: () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", relayout);
      panel.removeEventListener("pointerdown", onPointerDown);
      panel.removeEventListener("pointermove", onPointerMove);
      panel.removeEventListener("pointerup", onPointerUp);
      panel.removeEventListener("pointercancel", onPointerCancel);
      panel.removeEventListener("touchmove", onTouchMove);
      panel.removeEventListener("click", onClickCapture, true);
      panel.classList.remove("is-dragging");
      for (const node of [panel, peek, head]) {
        for (const prop of ["transform", "transition", "opacity", "visibility", "--sheet-cut"]) node.style.removeProperty(prop);
      }
    },
  };
}
