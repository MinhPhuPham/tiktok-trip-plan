import type { LatLng, LeafletMouseEvent, Map as LeafletMap } from "leaflet";

/** Half of a 44 px touch target: a finger tap this close to a pin, cluster or spot reaches it. */
export const FINGER_REACH_PX = 22;

/** A drawn pin, cluster or spot; `fire("click", …, true)` runs the same handlers as a tap on it. */
export interface Reachable {
  getLatLng(): LatLng;
  fire(type: string, data?: object, propagate?: boolean): unknown;
}

export type ReachSource = () => Iterable<Reachable>;

export interface FingerReach {
  /** Registers the drawn targets of one layer; returns the unregister. */
  add: (source: ReachSource) => () => void;
  /**
   * For a finger tap that hit no target (empty map, a route line): clicks the nearest drawn target
   * within FINGER_REACH_PX and returns true. Mouse clicks and keyboard activation are left alone.
   */
  claim: (event: LeafletMouseEvent) => boolean;
}

function fromFinger(event: MouseEvent): boolean {
  if (event.detail === 0) return false;
  if ("pointerType" in event && typeof event.pointerType === "string" && event.pointerType) return event.pointerType !== "mouse";
  return typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
}

/**
 * Pins are drawn 20-34 px and spots 12 px, under a fingertip's spread: taps just beside them used to
 * land on the map (closing the card) or on a route line running into the stop (switching to the
 * day). The drawn shapes keep first claim on a tap; this only resolves taps that miss them all.
 */
export function createFingerReach(map: LeafletMap): FingerReach {
  const sources = new Set<ReachSource>();
  return {
    add: (source) => {
      sources.add(source);
      return () => sources.delete(source);
    },
    claim: (event) => {
      if (!fromFinger(event.originalEvent)) return false;
      const tap = event.containerPoint;
      let best: Reachable | null = null;
      let bestDistance = FINGER_REACH_PX;
      for (const source of sources) {
        for (const target of source()) {
          const distance = map.latLngToContainerPoint(target.getLatLng()).distanceTo(tap);
          if (distance <= bestDistance) {
            best = target;
            bestDistance = distance;
          }
        }
      }
      if (!best) return false;
      const latlng = best.getLatLng();
      best.fire(
        "click",
        { latlng, layerPoint: map.latLngToLayerPoint(latlng), containerPoint: map.latLngToContainerPoint(latlng), originalEvent: event.originalEvent },
        true,
      );
      return true;
    },
  };
}
