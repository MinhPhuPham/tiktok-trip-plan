import type { TripModel } from "../data/model";
import { pinSize } from "../data/priority";
import type { TripDay, TripStop } from "../data/types";
import L from "./leaflet";
import { STOP_CHIP_PANE } from "./mapCore";
import { stopChipHtml } from "./markup";
import { NEARBY_DOT_SIZE } from "./useNearbyLayer";

/** map.css .stop-chip */
const CHIP_SIZE = 20;
/** How far the chip rim reaches past the marker's edge onto it, so it reads as that marker's badge. */
const CHIP_OVERLAP = 1.5;

/** The drawn size of the marker a stop sits on: its place pin, its nearby dot, else the smallest pin. */
export function stopMarkerSize(model: TripModel, stop: TripStop): number {
  const place = stop.ref ? model.placeById.get(stop.ref) : undefined;
  if (place) return pinSize(place.priority);
  return stop.ref && model.nearbyById.has(stop.ref) ? NEARBY_DOT_SIZE : pinSize(null);
}

/**
 * Icon anchor that puts the chip at the marker's top-right, its rim just over the marker's edge:
 * attached to its own marker whatever the size, never over the marker's glyph.
 */
export function stopChipAnchor(markerSize: number): [number, number] {
  const offset = Math.round((markerSize / 2 + CHIP_SIZE / 2 - CHIP_OVERLAP) * Math.SQRT1_2);
  return [CHIP_SIZE / 2 - offset, CHIP_SIZE / 2 + offset];
}

/** The open day's numbered stop chips, in their own click-through pane above every pin and cluster. */
export function stopChipLayer(model: TripModel, day: TripDay): L.LayerGroup {
  const chips = L.layerGroup();
  for (const stop of day.stops) {
    if (stop.number == null) continue;
    L.marker([stop.lat, stop.lng], {
      pane: STOP_CHIP_PANE,
      interactive: false,
      keyboard: false,
      icon: L.divIcon({
        className: "stop-chip-wrap",
        html: stopChipHtml(stop.number, day.color, day.ink),
        iconSize: [CHIP_SIZE, CHIP_SIZE],
        iconAnchor: stopChipAnchor(stopMarkerSize(model, stop)),
      }),
    }).addTo(chips);
  }
  return chips;
}
