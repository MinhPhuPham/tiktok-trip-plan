/* Generated from trip.schema.json by npm run gen:types. Do not edit. */

export interface MapData {
  schema_version: number;
  site_name: string;
  city: string;
  summary: {
    [k: string]: string;
  };
  generated: {
    [k: string]: string;
  };
  center: MapCenter | null;
  sectors: string[];
  sector_colors: {
    [k: string]: string;
  };
  sector_ink: {
    [k: string]: string;
  };
  category_colors: {
    [k: string]: string;
  };
  category_ink: {
    [k: string]: string;
  };
  center_color: string;
  rings: MapRing[];
  rays: MapRay[];
  places: MapPlace[];
  nearby: MapNearby[];
  days: MapDay[];
  day_colors: string[];
  day_ink: string[];
  unplaced: MapUnplaced[];
  basemaps: Basemap[];
  default_basemap: string;
  google: GoogleBasemap | null;
  labels: {
    [k: string]: MapLabels;
  };
  rest_name: {
    [k: string]: string;
  };
  config: MapPlanConfig;
  travel: MapTravel | null;
  roads: {
    [k: string]: string;
  };
  roads_enabled: boolean;
  roads_endpoint: string;
  roads_profile: string;
  media: {
    [k: string]: MediaItem[];
  };
  preferences: MapPreferences;
  tripWeekdays: number[];
  tripDates: (string | null)[];
}
/**
 * This interface was referenced by `MapData`'s JSON-Schema
 * via the `definition` "MapCenter".
 */
export interface MapCenter {
  lat: number;
  lng: number;
  kind: string;
  name: {
    [k: string]: string;
  };
  source: {
    [k: string]: string;
  };
  maps_url: string;
}
/**
 * This interface was referenced by `MapData`'s JSON-Schema
 * via the `definition` "MapRing".
 */
export interface MapRing {
  km: number;
  label: string;
  lat: number;
  lng: number;
}
/**
 * This interface was referenced by `MapData`'s JSON-Schema
 * via the `definition` "MapRay".
 */
export interface MapRay {
  sector: string;
  color: string;
  lat: number;
  lng: number;
}
/**
 * This interface was referenced by `MapData`'s JSON-Schema
 * via the `definition` "MapPlace".
 */
export interface MapPlace {
  id: string;
  name: string;
  category: string;
  address: string;
  lat: number;
  lng: number;
  sector: string;
  color: string;
  distance_km: number | null;
  zone: string | null;
  priority: string | null;
  stars: string;
  rating: number | null;
  rating_count: number | null;
  price: string;
  must_try: string[];
  videos: string[];
  maps_url: string;
  hours: MapHours;
  best: {
    [k: string]: string;
  };
  best_source: string | null;
  best_why: {
    [k: string]: string;
  };
  best_time: MapBestTime | null;
  tags: string[];
  preference: string | null;
  day: number | null;
  stop: number | null;
}
/**
 * Display text per language plus the raw periods the plan editor checks arrivals against.
 *
 * This interface was referenced by `MapData`'s JSON-Schema
 * via the `definition` "MapHours".
 */
export interface MapHours {
  en: string;
  vi: string;
  periods: OpeningPeriod[];
}
/**
 * This interface was referenced by `MapData`'s JSON-Schema
 * via the `definition` "OpeningPeriod".
 */
export interface OpeningPeriod {
  /**
   * 0=Monday ... 6=Sunday
   */
  day: number;
  open: string;
  close: string | null;
}
/**
 * This interface was referenced by `MapData`'s JSON-Schema
 * via the `definition` "MapBestTime".
 */
export interface MapBestTime {
  hours: string | null;
  days: string | null;
  months: string | null;
  deadline: string | null;
  source: string;
}
/**
 * This interface was referenced by `MapData`'s JSON-Schema
 * via the `definition` "MapNearby".
 */
export interface MapNearby {
  id: string;
  name: string;
  kind: string;
  kind_label: {
    [k: string]: string;
  };
  lat: number;
  lng: number;
  rating: number | null;
  maps_url: string;
}
/**
 * This interface was referenced by `MapData`'s JSON-Schema
 * via the `definition` "MapDay".
 */
export interface MapDay {
  day: number;
  color: string;
  areas: string;
  span: {
    [k: string]: string;
  };
  directions: string[];
  stops: MapStop[];
}
/**
 * This interface was referenced by `MapData`'s JSON-Schema
 * via the `definition` "MapStop".
 */
export interface MapStop {
  kind: string;
  ref: string | null;
  slot: string | null;
  arrive: string;
  depart: string;
  travel_min_to_next: number | null;
  number: number | null;
  name: {
    [k: string]: string;
  };
  activity: {
    [k: string]: string;
  };
  time: {
    [k: string]: string;
  };
  reason: string;
  reason_vi: string;
  lat: number;
  lng: number;
  maps_url: string;
}
/**
 * This interface was referenced by `MapData`'s JSON-Schema
 * via the `definition` "MapUnplaced".
 */
export interface MapUnplaced {
  ref: string;
  name: string;
  reason: string;
  code: string | null;
  reason_text: {
    [k: string]: string;
  };
}
/**
 * This interface was referenced by `MapData`'s JSON-Schema
 * via the `definition` "Basemap".
 */
export interface Basemap {
  id: "google" | "openfreemap" | "esri_streets" | "esri_satellite" | "osm";
  name: string;
  kind: "raster" | "vector";
  url: string;
  attribution: string;
  max_zoom: number;
  subdomains: string;
  labels_url: string | null;
  retina: boolean;
}
/**
 * This interface was referenced by `MapData`'s JSON-Schema
 * via the `definition` "GoogleBasemap".
 */
export interface GoogleBasemap {
  name: string;
  src: string;
}
/**
 * labels[lang] in trip.json: the map chrome (`ui`) plus the shared trip vocabulary.
 *
 * This interface was referenced by `MapData`'s JSON-Schema
 * via the `definition` "MapLabels".
 */
export interface MapLabels {
  ui: {
    [k: string]: string;
  };
  categories: {
    [k: string]: string;
  };
  directions: {
    [k: string]: string;
  };
  no_direction: string;
  priorities: {
    [k: string]: string;
  };
  day: string;
  best_time: string;
  heuristic: string;
  source: string;
  directions_link: string;
  leg: string;
  no_plan: string;
  twelve_hour: boolean;
  day_units: string[];
  stop_kinds: {
    [k: string]: string;
  };
  tags: {
    [k: string]: string;
  };
  tags_title: string;
  best_time_why: string;
  kinds: {
    [k: string]: string;
  };
  unplaced_codes: {
    [k: string]: string;
  };
}
/**
 * The plan rules the in-browser editor needs, serialised with camelCase keys.
 *
 * This interface was referenced by `MapData`'s JSON-Schema
 * via the `definition` "MapPlanConfig".
 */
export interface MapPlanConfig {
  dayStart: string;
  dayEnd: string;
  rhythm: MapRhythmSlot[];
  serviceMinutes: {
    [k: string]: number;
  };
  nearbyServiceMinutes: number;
  restMinutes: number;
  restMinMinutes: number;
  restAtCenter: boolean;
  targetPlacesPerDay: number;
  travelmode: string;
  tripDays: number;
  maxPlacesPerDay: number | null;
  maxNearbyPerDay: number;
  dated: boolean;
}
/**
 * This interface was referenced by `MapData`'s JSON-Schema
 * via the `definition` "MapRhythmSlot".
 */
export interface MapRhythmSlot {
  id: string;
  start: string;
  end: string;
  name_en: string;
  name_vi: string;
  categories: string[];
}
/**
 * data/plan/travel_minutes.csv: ids = "center", place ids, nearby ids; minutes[from][to].
 *
 * This interface was referenced by `MapData`'s JSON-Schema
 * via the `definition` "MapTravel".
 */
export interface MapTravel {
  ids: string[];
  minutes: number[][];
}
/**
 * One preview image of a place in output/media/index.json; `src` is relative to output/.
 *
 * This interface was referenced by `MapData`'s JSON-Schema
 * via the `definition` "MediaItem".
 */
export interface MediaItem {
  src: string;
  kind: "frame" | "photo";
  caption: string;
  source_url: string | null;
  attributions: MediaAttribution[];
}
/**
 * A photo author Google requires to be shown with the photo (display name, profile link).
 *
 * This interface was referenced by `MapData`'s JSON-Schema
 * via the `definition` "MediaAttribution".
 */
export interface MediaAttribution {
  name: string;
  uri: string | null;
}
/**
 * input/preferences.yaml as read by the export; the map adds hidden places to `removed`.
 *
 * This interface was referenced by `MapData`'s JSON-Schema
 * via the `definition` "MapPreferences".
 */
export interface MapPreferences {
  must_go: string[];
  removed: string[];
}
