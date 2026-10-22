/**
 * The "My location" button's state machine (Google Maps' blue dot, minus compass mode):
 *
 *   off ──tap──▶ locating ──fix──▶ following ──pan──▶ showing ──tap──▶ following ──tap──▶ off
 *   off ──granted (permission already given, page load)──▶ locating (silent) ──fix──▶ showing
 *   any ──denied──▶ denied ──retry──▶ locating        denied ──reset (permission back to "ask")──▶ off
 *   locating ──failed (after the low-accuracy retry)──▶ failed ──tap──▶ locating
 *
 * A tap on "denied" changes nothing: the button explains how to allow location instead of asking again.
 */
export type LocateMode = "off" | "locating" | "showing" | "following" | "denied" | "failed";

/**
 * Why "denied" or "failed": blocked = refused with no prompt (an app or site setting says no, or the
 * permission was already denied), refused = "Don't allow" on the prompt, off = no position at all
 * (Location Services off), timeout = no fix in time.
 */
export type LocateProblem = "blocked" | "refused" | "off" | "timeout";

export interface LocateState {
  mode: LocateMode;
  /** Centre and follow on the first fix: the user asked (a tap), not the silent start on load. */
  follow: boolean;
  problem?: LocateProblem;
}

export type LocateEvent =
  | { type: "tap" }
  | { type: "retry" }
  | { type: "granted" }
  | { type: "fix" }
  | { type: "denied"; problem?: "blocked" | "refused" }
  | { type: "failed"; problem?: "off" | "timeout" }
  | { type: "pan" }
  | { type: "reset" };

export const LOCATE_OFF: LocateState = { mode: "off", follow: false };
const LOCATE_ASKED: LocateState = { mode: "locating", follow: true };
const LOCATE_SILENT: LocateState = { mode: "locating", follow: false };

function onTap(state: LocateState): LocateState {
  switch (state.mode) {
    case "off":
    case "failed":
      return LOCATE_ASKED;
    case "locating":
      return state.follow ? LOCATE_OFF : LOCATE_ASKED;
    case "showing":
      return { mode: "following", follow: true };
    case "following":
      return LOCATE_OFF;
    case "denied":
      return state;
  }
}

export function locateStep(state: LocateState, event: LocateEvent): LocateState {
  switch (event.type) {
    case "tap":
      return onTap(state);
    case "retry":
      return state.mode === "denied" || state.mode === "failed" ? LOCATE_ASKED : state;
    case "granted":
      return state.mode === "off" || state.mode === "denied" ? LOCATE_SILENT : state;
    case "fix":
      return state.mode === "locating" ? { mode: state.follow ? "following" : "showing", follow: state.follow } : state;
    case "denied":
      return state.mode === "denied" ? state : { mode: "denied", follow: false, problem: event.problem ?? "blocked" };
    case "failed":
      if (state.mode !== "locating") return state;
      return state.follow ? { mode: "failed", follow: false, problem: event.problem ?? "timeout" } : LOCATE_OFF;
    case "pan":
      if (state.mode === "following") return { mode: "showing", follow: false };
      return state.mode === "locating" && state.follow ? LOCATE_SILENT : state;
    case "reset":
      return state.mode === "denied" ? LOCATE_OFF : state;
  }
}

/** The browser is asked for positions in these modes (while the page is visible). */
export const isWatching = (mode: LocateMode): boolean => mode === "locating" || mode === "showing" || mode === "following";

/** The blue dot is drawn in these modes. */
export const isDotShown = (mode: LocateMode): boolean => mode === "showing" || mode === "following";
