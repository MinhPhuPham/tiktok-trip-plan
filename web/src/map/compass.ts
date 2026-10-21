import { safeColor } from "../lib/color";
import type { MapCenter, MapRay, MapRing } from "../data/types";
import type { LatLng } from "./polyline";

export interface CompassRing {
  center: LatLng;
  radiusM: number;
  labelAt: LatLng;
  label: string;
}

export interface CompassRay {
  line: [LatLng, LatLng];
  color: string;
  ink: string;
  /** The compass letters of the sector ("NE"), for the end label. */
  label: string;
}

export interface CompassShapes {
  rings: CompassRing[];
  rays: CompassRay[];
}

const NOT_COMPASS = /[^A-Z]/g;

/** Distance rings and direction rays around the center; null without a center. */
export function compassShapes(
  center: Pick<MapCenter, "lat" | "lng"> | null,
  rings: readonly MapRing[],
  rays: readonly MapRay[],
  inkOf: (sector: string) => string,
): CompassShapes | null {
  if (!center) return null;
  const origin: LatLng = [center.lat, center.lng];
  return {
    rings: rings
      .filter((ring) => Number.isFinite(ring.km) && ring.km > 0)
      .map((ring) => ({ center: origin, radiusM: ring.km * 1000, labelAt: [ring.lat, ring.lng], label: `${Number(ring.km)} km` })),
    rays: rays.map((ray) => ({
      line: [origin, [ray.lat, ray.lng]],
      color: safeColor(ray.color),
      ink: inkOf(ray.sector),
      label: ray.sector.replace(NOT_COMPASS, ""),
    })),
  };
}
