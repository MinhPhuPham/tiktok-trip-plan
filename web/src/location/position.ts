/** The device's last position. It lives in memory only: never logged, sent or stored. */
export interface UserFix {
  lat: number;
  lng: number;
  /** Metres (95% confidence radius). */
  accuracy: number;
  /** Degrees clockwise from north while moving; null when standing still or unknown. */
  heading: number | null;
}

/** Below this speed coords.heading is noise (or NaN). */
const MOVING_MPS = 1;
const EARTH_RADIUS_M = 6_371_008.8;

export function toUserFix({ coords }: Pick<GeolocationPosition, "coords">): UserFix {
  const { latitude, longitude, accuracy, heading, speed } = coords;
  const moving = heading != null && Number.isFinite(heading) && speed != null && speed >= MOVING_MPS;
  return { lat: latitude, lng: longitude, accuracy, heading: moving ? heading : null };
}

/** Straight-line (great-circle) distance in metres. */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "80 m", "450 m", "1.2 km", "14 km": as precise as a straight line deserves (same style as km()). */
export function formatDistance(meters: number): string {
  if (meters < 995) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  if (meters < 9950) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters / 1000)} km`;
}
