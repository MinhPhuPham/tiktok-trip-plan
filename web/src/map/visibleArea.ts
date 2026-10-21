import { DOM_IDS } from "../app/ids";
import { sheetOffsets, type SheetDetent } from "../lib/sheetSnap";
import type { Map as LeafletMap } from "leaflet";
import type { MapOverlays } from "./overlayShift";

export const openCard = (): HTMLElement | null => {
  const card = document.getElementById(DOM_IDS.card);
  return card && !card.hidden ? card : null;
};

/** Pixels of the map under the phone sheet once it rests at `detent` (it may still be moving there). */
export function sheetCover(map: LeafletMap, detent: SheetDetent): number {
  const panel = document.getElementById(DOM_IDS.panel);
  if (!panel || detent === "peek") return 0;
  const peekHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--peek")) || 0;
  const offsets = sheetOffsets({ sheetHeight: panel.offsetHeight, peekHeight, viewportHeight: window.innerHeight });
  const top = window.innerHeight - panel.offsetHeight + offsets[detent];
  return Math.max(0, map.getContainer().getBoundingClientRect().bottom - top);
}

/** What covers the map: the open card, and on phones the open sheet. */
export function mapOverlays(map: LeafletMap, phone: boolean, detent: SheetDetent): MapOverlays {
  const card = openCard();
  return { card: card && { width: card.offsetWidth, height: card.offsetHeight }, sheet: phone ? sheetCover(map, detent) : 0 };
}
