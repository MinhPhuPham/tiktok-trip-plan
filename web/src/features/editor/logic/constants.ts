export const DAY_MINUTES = 24 * 60;
export const LONG_LEG_MIN = 40;
export const LONG_WAIT_MIN = 60;
export const MIN_REST_MIN = 30;
export const DEFAULT_REST_MIN = 60;
export const MAX_SECTOR_GAP_DEG = 90;
export const DEFAULT_SERVICE = 30;
export const DEFAULT_NEARBY_SERVICE = 45;
export const DEFAULT_MAX_NEARBY = 3;
export const DEFAULT_WEEKDAY = 5;
export const MAX_DAYS = 7;
export const SECTORS_8 = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
export const EST_SPEED_KMH = 18;
export const DETOUR_FACTOR = 1.3;
export const EARTH_RADIUS_KM = 6371.0088;
/** Issues drawn on the travel leg rather than under the stop. */
export const ON_LEG: ReadonlySet<string> = new Set(["long_wait", "long_leg"]);
export const COLLECT_CMD = "uv run tiktok-trip route --collect && uv run tiktok-trip run --from export";
