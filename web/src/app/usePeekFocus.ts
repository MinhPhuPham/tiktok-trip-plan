import { useEffect, useEffectEvent } from "react";
import { useTripActions, useTripStoreApi } from "../state/hooks";

/** Left alone this long, a peek row goes back to where it starts and its pin lets go. */
export const PEEK_IDLE_RESET_MS = 120_000;

/**
 * The phone peek row's tie to the map: the browsed place's pin lights like a hovered list row until
 * the row moves on, unmounts or idles (`onIdle`). The returned `show` moves to a stepped place: the
 * open card follows it, else the map flies there.
 */
export function usePeekFocus(focusId: string | null, onIdle: () => void): (id: string) => void {
  const store = useTripStoreApi();
  const { openCard, requestMap } = useTripActions();
  const idle = useEffectEvent(onIdle);

  useEffect(() => {
    if (!focusId) return undefined;
    store.getState().actions.setHovered(focusId);
    const timer = window.setTimeout(() => idle(), PEEK_IDLE_RESET_MS);
    return () => {
      window.clearTimeout(timer);
      const { hovered, actions } = store.getState();
      if (hovered === focusId) actions.setHovered(null);
    };
  }, [focusId, store]);

  return (id: string) => {
    if (store.getState().selected) openCard(id);
    else requestMap({ type: "fly", id });
  };
}
