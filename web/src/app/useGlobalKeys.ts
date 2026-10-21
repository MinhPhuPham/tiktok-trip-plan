import { useEffect } from "react";
import { isTypingTarget } from "../lib/dom";
import { useTripStoreApi } from "../state/hooks";
import { DOM_IDS, focusById } from "./ids";

const hasText = (node: Element | null): boolean =>
  (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) && node.value !== "";

/**
 * Escape closes the layers popover, else the card, else collapses the open phone sheet (focus to
 * its handle); "/" jumps to the place search.
 */
export function useGlobalKeys(): void {
  const store = useTripStoreApi();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const dialogOpen = Boolean(document.querySelector("dialog[open]"));
      const { layersOpen, selected, phone, sheetOpen, editing, actions } = store.getState();
      if (event.key === "Escape") {
        if (event.defaultPrevented || dialogOpen) return;
        if (layersOpen) {
          actions.setLayersOpen(false);
          focusById(DOM_IDS.layersButton);
        } else if (selected) {
          actions.closeCard();
        } else if (phone && sheetOpen && !editing && !hasText(document.activeElement)) {
          actions.setSheetOpen(false);
          focusById(DOM_IDS.sheetToggle);
        }
        return;
      }
      const plainSlash = event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing;
      if (!plainSlash || isTypingTarget(document.activeElement) || dialogOpen) return;
      event.preventDefault();
      actions.setTab("places");
      if (phone) actions.setSheetOpen(true);
      requestAnimationFrame(() => focusById(DOM_IDS.search));
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [store]);
}
