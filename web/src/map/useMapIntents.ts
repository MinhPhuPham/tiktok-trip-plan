import { useEffect } from "react";
import { DOM_IDS } from "../app/ids";
import { prefersReducedMotion } from "../app/viewport";
import { getTripPlan, useTripModel } from "../data/hooks";
import { useTripStoreApi } from "../state/hooks";
import type { MapIntent } from "../state/store";
import { ROW_HOVER_DELAY_MS } from "../state/useRowHover";
import L from "./leaflet";
import { drawnHover, FLY_ZOOM, watch, type MapHandle } from "./mapCore";
import { centringPan, overlayShift, type MapOverlays } from "./overlayShift";
import { fitAll } from "./useLeafletMap";

const CARD_MARGIN = 28;
const FLY_SECONDS = 0.45;
/** The camera follows a row only after the pointer rests this long (the pin highlight comes at ROW_HOVER_DELAY_MS). */
const CENTRE_SETTLE_MS = 250;
const CENTRE_SECONDS = 0.35;
/** A hovered pin this close to the visible centre stays put. */
const CENTRE_TOLERANCE = 24;

const openCard = (): HTMLElement | null => {
  const card = document.getElementById(DOM_IDS.card);
  return card && !card.hidden ? card : null;
};

/** What covers the map: the open card, and on phones the part of the map under the open sheet. */
function overlays(map: L.Map, phone: boolean, withSheet: boolean): MapOverlays {
  const card = openCard();
  const panel = phone && withSheet ? document.getElementById(DOM_IDS.panel) : null;
  const sheet = panel ? Math.max(0, map.getContainer().getBoundingClientRect().bottom - panel.getBoundingClientRect().top) : 0;
  return { card: card && { width: card.offsetWidth, height: card.offsetHeight }, sheet };
}

/**
 * Performs the store's one-shot camera requests (fly to a place, fit a day, fit all), keeps the
 * selected pin out from under the place card while the card grows, and centres a hovered row's
 * pin in the visible part of the map once the pointer settles.
 */
export function useMapIntents(handle: MapHandle | null): void {
  const model = useTripModel();
  const store = useTripStoreApi();

  useEffect(() => {
    if (!handle) return undefined;
    const { map } = handle;
    let flying = false;
    let centring = false;
    let frame = 0;
    let centreTimer: number | undefined;
    let landing: (() => void) | null = null;

    const stopCentring = () => {
      window.clearTimeout(centreTimer);
      if (centring) map.stop();
      centring = false;
    };
    const centringDone = () => {
      centring = false;
    };
    map.on("moveend", centringDone);

    /* Marks a camera intent as running until its moveend (Leaflet fires one even for an instant move). */
    const intentMove = (move: () => void, after?: () => void) => {
      stopCentring();
      if (landing) map.off("moveend", landing);
      flying = true;
      const done = () => {
        flying = false;
        landing = null;
        after?.();
      };
      landing = done;
      map.once("moveend", done);
      move();
    };

    const keepPinClear = () => {
      const { selected, phone } = store.getState();
      const card = openCard();
      const target = model.target(selected);
      if (flying || !card || !target) return;
      const pin = map.latLngToContainerPoint([target.item.lat, target.item.lng]);
      const box = map.getContainer().getBoundingClientRect();
      const rect = card.getBoundingClientRect();
      const left = rect.left - box.left - CARD_MARGIN;
      const right = rect.right - box.left + CARD_MARGIN;
      const top = rect.top - box.top - CARD_MARGIN;
      const bottom = rect.bottom - box.top + CARD_MARGIN;
      if (pin.x < left || pin.x > right || pin.y < top || pin.y > bottom) return;
      const animate = !prefersReducedMotion();
      if (phone) map.panBy([0, pin.y - top], { animate });
      else map.panBy([pin.x - right, 0], { animate });
    };

    const flyToPoint = (lat: number, lng: number) => {
      const zoom = Math.max(map.getZoom(), FLY_ZOOM);
      const { phone } = store.getState();
      const shift = overlayShift(phone, overlays(map, phone, false));
      const target = map.unproject(map.project([lat, lng], zoom).add(shift), zoom);
      const instant = prefersReducedMotion() || (map.getCenter().distanceTo(target) < 5 && map.getZoom() === zoom);
      intentMove(
        () => (instant ? map.setView(target, zoom, { animate: false }) : map.flyTo(target, zoom, { duration: FLY_SECONDS })),
        keepPinClear,
      );
    };

    const perform = (intent: MapIntent) => {
      if (intent.type === "fitAll") {
        intentMove(() => fitAll(map, model, store, intent.animate));
      } else if (intent.type === "fitDay") {
        const day = getTripPlan(model, store.getState().plan).dayByNumber.get(intent.day);
        if (!day?.stops.length) return;
        const bounds = L.latLngBounds(day.stops.map((s) => [s.lat, s.lng]));
        intentMove(() => map.fitBounds(bounds, { padding: [56, 56], maxZoom: 16, animate: !prefersReducedMotion() }));
      } else {
        const target = model.target(intent.id);
        if (target) flyToPoint(target.item.lat, target.item.lng);
      }
    };

    /* Intents arrive with the state change that opens the card; act after React has drawn it. */
    const stopIntents = watch(
      store,
      (s) => s.mapIntent,
      (intent, previous) => {
        if (!intent || previous === undefined) return;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => perform(intent));
      },
    );

    /* Same zoom, own position even inside a cluster; the open card's place is already placed by its fly. */
    const centreOn = (id: string) => {
      const { selected, phone } = store.getState();
      const target = model.target(id);
      if (!target || flying || id === selected) return;
      const pin = map.latLngToContainerPoint([target.item.lat, target.item.lng]);
      const size = map.getSize();
      const shift = overlayShift(phone, overlays(map, phone, true));
      const offset = centringPan([pin.x, pin.y], [size.x, size.y], shift, CENTRE_TOLERANCE);
      if (!offset) return;
      const animate = !prefersReducedMotion();
      map.panBy(offset, { animate, duration: CENTRE_SECONDS });
      centring = animate;
    };

    /* A new row stops the pan toward the previous one; leaving the list lets it finish, never pans back. */
    const stopHover = watch(
      store,
      (s) => drawnHover(model, s),
      (id, previous) => {
        if (previous === undefined) return;
        if (id == null) {
          window.clearTimeout(centreTimer);
          return;
        }
        stopCentring();
        centreTimer = window.setTimeout(() => centreOn(id), CENTRE_SETTLE_MS - ROW_HOVER_DELAY_MS);
      },
    );

    /* The card grows after it opens (photos, language): keep the selected pin beside it. */
    let observed: HTMLElement | null = null;
    let clearFrame = 0;
    let cardFrame = 0;
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(clearFrame);
      clearFrame = requestAnimationFrame(keepPinClear);
    });
    const stopSelected = watch(
      store,
      (s) => s.selected,
      () => {
        cancelAnimationFrame(cardFrame);
        cardFrame = requestAnimationFrame(() => {
          const card = openCard();
          if (card === observed) return;
          if (observed) resize.unobserve(observed);
          observed = card;
          if (card) resize.observe(card);
        });
      },
    );

    return () => {
      stopIntents();
      stopHover();
      stopSelected();
      window.clearTimeout(centreTimer);
      map.off("moveend", centringDone);
      resize.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(clearFrame);
      cancelAnimationFrame(cardFrame);
      if (landing) map.off("moveend", landing);
    };
  }, [handle, model, store]);
}
