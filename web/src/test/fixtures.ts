import { TRIP_SCHEMA_VERSION } from "../data/load";
import { DEFAULT_CATEGORY_COLORS, DEFAULT_CATEGORY_INK } from "../data/palette";
import type { MapDay, MapLabels, MapPlace, MapStop, TripData } from "../data/types";

const labels = (lang: "en" | "vi"): MapLabels => ({
  ui: {
    plan: lang === "en" ? "Plan" : "Lịch trình",
    places: lang === "en" ? "Places" : "Địa điểm",
    place_count: lang === "en" ? "{n} places" : "{n} địa điểm",
    stops: "{n} stops",
    count: "{shown} of {total} places",
    language: "Language",
    show_list: "Show list",
    hide_list: "Hide list",
    offline: "You are offline.",
    online: "Back online.",
    undo: "Undo",
  },
  categories: { food: "Food", cafe: "Cafe", attraction: "Attraction", other: "Other" },
  directions: { N: "North", E: "East" },
  no_direction: "No direction",
  priorities: { must: "Must go", high: "High", medium: "Medium", low: "Low" },
  day: lang === "en" ? "Day {day}" : "Ngày {day}",
  best_time: "Best time",
  heuristic: "estimate",
  source: "Source",
  directions_link: "Directions",
  leg: "{n} min",
  no_plan: "No plan yet.",
  twelve_hour: lang === "en",
  day_units: lang === "en" ? ["day", "days"] : ["ngày", "ngày"],
  stop_kinds: { start: "Start", end: "End", rest: "Rest" },
  tags: { local: lang === "en" ? "Local favourite" : "Quán địa phương" },
  tags_title: "Tags",
  best_time_why: "",
  kinds: { viewpoint: "Viewpoint" },
  unplaced_codes: { too_far: "Too far" },
});

export function makePlace(id: string, patch: Partial<MapPlace> = {}): MapPlace {
  return {
    id,
    name: `Place ${id}`,
    category: "food",
    address: `${id} Street`,
    lat: 10.77,
    lng: 106.7,
    sector: "N",
    color: "#0072B2",
    distance_km: 1,
    zone: null,
    priority: "medium",
    stars: "★★",
    rating: 4.5,
    rating_count: 100,
    price: "",
    must_try: [],
    videos: [],
    maps_url: "https://maps.google.com/?cid=1",
    hours: { en: "", vi: "", periods: [] },
    best: { en: "", vi: "" },
    best_source: null,
    best_why: { en: "", vi: "" },
    best_time: null,
    tags: [],
    preference: null,
    day: null,
    stop: null,
    ...patch,
  };
}

export function makeStop(kind: string, ref: string | null, patch: Partial<MapStop> = {}): MapStop {
  return {
    kind,
    ref,
    slot: null,
    arrive: "08:00",
    depart: "09:00",
    travel_min_to_next: 10,
    number: null,
    name: { en: "", vi: "" },
    activity: { en: "", vi: "" },
    time: { en: "", vi: "" },
    reason: "",
    reason_vi: "",
    lat: 10.77,
    lng: 106.7,
    maps_url: "",
    ...patch,
  };
}

export function makeDay(day: number, stops: MapStop[]): MapDay {
  return { day, color: "#E69F00", areas: "N", span: { en: "", vi: "" }, directions: [], stops };
}

export function makeTrip(patch: Partial<TripData> = {}): TripData {
  const places = [
    makePlace("a", { name: "Phở Gia Truyền", priority: "must", tags: ["local"], must_try: ["phở bò"] }),
    makePlace("b", { name: "Cà phê Đá", category: "cafe", sector: "E", priority: "high", distance_km: 2.5 }),
    makePlace("c", { name: "Bảo tàng", category: "attraction", sector: "UNASSIGNED", priority: null, distance_km: 0.4 }),
  ];
  return {
    schema_version: TRIP_SCHEMA_VERSION,
    site_name: "TwLP-Trips",
    city: "Đà Lạt",
    summary: { en: "3 days · Driving", vi: "3 ngày · Lái xe" },
    generated: { en: "Oct 20, 2026", vi: "20/10/2026" },
    center: {
      lat: 10.776,
      lng: 106.7,
      kind: "hotel",
      name: { en: "Hotel", vi: "Khách sạn" },
      source: { en: "hotel", vi: "khách sạn" },
      maps_url: "https://maps.google.com/?q=hotel",
    },
    sectors: ["N", "E"],
    sector_colors: { N: "#0072B2", E: "#009E73", UNASSIGNED: "#9e9e9e" },
    sector_ink: { N: "#ffffff" },
    category_colors: { ...DEFAULT_CATEGORY_COLORS },
    category_ink: { ...DEFAULT_CATEGORY_INK },
    center_color: "#222222",
    rings: [],
    rays: [],
    places,
    nearby: [{ id: "n1", name: "Lookout", kind: "viewpoint", kind_label: { en: "Viewpoint", vi: "Điểm ngắm" }, lat: 10.8, lng: 106.8, rating: null, maps_url: "" }],
    days: [
      makeDay(1, [
        makeStop("start", null),
        makeStop("place", "a", { number: 1, arrive: "09:00", depart: "10:00" }),
        makeStop("nearby", "n1", { number: 2, arrive: "11:00", depart: "11:30" }),
        makeStop("end", null, { arrive: "18:00" }),
      ]),
    ],
    day_colors: ["#E69F00", "#56B4E9"],
    day_ink: ["#000000", "#000000"],
    unplaced: [{ ref: "b", name: "Cà phê Đá", reason: "", code: "too_far", reason_text: { en: "Too far", vi: "Quá xa" } }],
    basemaps: [],
    default_basemap: "openfreemap",
    google: null,
    labels: { en: labels("en"), vi: labels("vi") },
    rest_name: { en: "Rest at the hotel", vi: "Nghỉ ở khách sạn" },
    config: {
      dayStart: "08:00",
      dayEnd: "21:00",
      rhythm: [],
      serviceMinutes: {},
      nearbyServiceMinutes: 30,
      restMinutes: 90,
      restMinMinutes: 30,
      restAtCenter: true,
      targetPlacesPerDay: 6,
      travelmode: "driving",
      tripDays: 3,
      maxPlacesPerDay: null,
      maxNearbyPerDay: 2,
      dated: false,
    },
    travel: null,
    roads: {},
    roads_enabled: false,
    roads_endpoint: "",
    roads_profile: "",
    media: {},
    preferences: { must_go: ["Phở Gia Truyền"], removed: [] },
    tripWeekdays: [5, 6, 0],
    tripDates: [null, null, null],
    ...patch,
  };
}

/** Day 1: a (9:00), b (10:15), a rest, nearby n1 (11:45); at 10:30 the next stop is b. */
export function threeVisitTrip(): TripData {
  return makeTrip({
    days: [
      makeDay(1, [
        makeStop("start", null),
        makeStop("place", "a", { arrive: "09:00", depart: "10:00", travel_min_to_next: 7 }),
        makeStop("place", "b", { arrive: "10:15", depart: "11:00", travel_min_to_next: 12 }),
        makeStop("rest", null, { arrive: "11:15", depart: "11:30" }),
        makeStop("nearby", "n1", { arrive: "11:45", depart: "12:15" }),
        makeStop("end", null, { arrive: "18:00" }),
      ]),
    ],
  });
}

/** makeTrip with place a closing at 8:10: Day 1 reaches it about 8:03 and needs 30 min, a "closed" problem. */
export function closingTrip(patch: Partial<TripData> = {}): TripData {
  const base = makeTrip(patch);
  const periods = Array.from({ length: 7 }, (_, day) => ({ day, open: "06:00", close: "08:10" }));
  return {
    ...base,
    places: base.places.map((p) => (p.id === "a" ? { ...p, hours: { en: "6:00–8:10", vi: "6:00–8:10", periods } } : p)),
  };
}
