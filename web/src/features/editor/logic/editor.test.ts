// Fixture mirrors tests/test_plan_agent.py, so the TS clock and checks match the Python ones.
import { FALLBACK_COLOR, inkFor } from "../../../lib/color";
import { fold } from "../../../lib/format";
import { estimateMinutes, haversineKm, openingFit, openingIntervals, parseHourRange } from "./clock";
import { buildContext, travelBetween, weekdayOf } from "./context";
import { computePlan, validatePlan } from "./coverage";
import { FALLBACK_LABELS } from "./labels";
import { insertIndex, pickSlot } from "./placement";
import { editableDays, toPlanJson } from "./planJson";
import { matchesQuery } from "./text";
import { computeTimes, validateDay } from "./timing";
import type { EditDay, EditorData, EditorNode, EditorPlace, EditorSpot, HoursLike, Issue, RhythmSlot, UnplacedEntry } from "./types";

const CENTER = { lat: 10.7769, lng: 106.7009, name: { en: "Hotel", vi: "Hotel" } };
const KM_LAT = 1 / 111.195;
const MIN_PER_KM = 3;

const RHYTHM: RhythmSlot[] = (
  [
    ["sunrise", "04:30", "07:00", ["attraction"]],
    ["breakfast", "07:00", "08:30", ["food"]],
    ["morning", "08:30", "11:30", ["attraction", "other"]],
    ["lunch", "11:30", "13:00", ["food"]],
    ["rest", "13:00", "14:30", []],
    ["cafe", "14:30", "17:30", ["cafe"]],
    ["dinner", "17:30", "19:30", ["food"]],
    ["evening", "19:30", "22:00", ["attraction", "other"]],
  ] as const
).map(([id, start, end, categories]) => ({ id, start, end, categories, name_en: id, name_vi: id }));

type FixturePlace = EditorPlace & { km: number };
type FixtureSpot = EditorSpot & { km: number };

const sat = (open: string, close: string | null): HoursLike => ({ periods: [{ day: 5, open, close }] });
const place = (id: string, km: number, category: string, hours: HoursLike | null = null, sector = "N"): FixturePlace => ({
  id,
  name: `Place ${id}`,
  category,
  lat: CENTER.lat + km * KM_LAT,
  lng: CENTER.lng,
  hours,
  sector,
  zone: `${sector}-1`,
  priority: null,
  tags: [],
  km,
});

const PLACES: FixturePlace[] = [
  place("hill", 2, "attraction"),
  place("pho", 3, "food", sat("06:00", "11:00")),
  place("lunch", 1, "food"),
  place("cafe", 4, "cafe"),
  place("dinner", -2, "food", sat("16:00", "22:00"), "S"),
  place("far", 30, "attraction"),
  place("monday", 1.5, "other", { periods: [{ day: 0, open: "08:00", close: "17:00" }] }),
];
const SPOT: FixtureSpot = { id: "osm:node/7", name: "Lake walk", lat: CENTER.lat - 3 * KM_LAT, lng: CENTER.lng, zone: "S-1", km: -3 };

function fakeTravel(points: readonly { id: string; km: number }[]) {
  const ids = points.map((p) => p.id);
  const minutes = points.map((a) => points.map((b) => Math.ceil(Math.abs(a.km - b.km) * MIN_PER_KM - 1e-9)));
  return { ids, minutes };
}

interface Overrides {
  config?: EditorData["config"];
  travel?: EditorData["travel"];
}

function fixture(overrides: Overrides = {}): EditorData & { places: FixturePlace[]; config: NonNullable<EditorData["config"]> } {
  const config = {
    dayStart: "04:00",
    dayEnd: "22:00",
    rhythm: RHYTHM,
    serviceMinutes: { food: 45, cafe: 45, attraction: 75, other: 30 },
    nearbyServiceMinutes: 45,
    restMinutes: 60,
    tripDays: 2,
    ...overrides.config,
  };
  return {
    city: "Test",
    center: CENTER,
    places: PLACES,
    nearby: [SPOT],
    travel: overrides.travel ?? fakeTravel([{ id: "center", km: 0 }, ...PLACES, SPOT]),
    config,
    tripWeekdays: [5, 5],
  };
}

interface FixturePlan {
  days: { stops: { ref: string; slot?: string | null; reason?: string; reason_vi?: string }[] }[];
  unplaced: UnplacedEntry[];
}

const GOOD_PLAN: FixturePlan = {
  days: [
    {
      stops: [
        { ref: "hill", slot: "sunrise", reason: "clouds at dawn" },
        { ref: "pho", slot: "breakfast", reason: "phở after sunrise" },
        { ref: "lunch", slot: "lunch", reason: "near the hotel" },
        { ref: "rest", slot: "rest", reason: "nap" },
        { ref: "cafe", slot: "cafe", reason: "view" },
      ],
    },
    {
      stops: [
        { ref: "dinner", slot: "dinner", reason: "lẩu" },
        { ref: "osm:node/7", slot: "evening", reason: "walk after dinner" },
      ],
    },
  ],
  unplaced: [
    { ref: "far", reason: "too far" },
    { ref: "monday", reason: "closed on Saturday" },
  ],
};

/** Node's fs at test time; the app's tsconfig has no Node types and Vite may not serve files outside web/. */
async function readRepoFile(path: string): Promise<string> {
  const spec = "node:fs/promises";
  const fs = (await import(/* @vite-ignore */ spec)) as { readFile(url: URL, encoding: "utf8"): Promise<string> };
  const here = import.meta.url;
  return fs.readFile(new URL(`../../../../../${path}`, here), "utf8");
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const rules = (issues: readonly Issue[], level?: Issue["level"]) =>
  issues.filter((i) => !level || i.level === level).map((i) => i.rule);
const node = (ctx: ReturnType<typeof buildContext>, ref: string) => ctx.nodes.get(ref) as EditorNode;
const stopsOf = (plan: FixturePlan, day: number) => (plan.days[day] as EditDay).stops;

describe("plan editor core", () => {
  it("computeTimes matches test_collect_computes_the_clock (day 1)", () => {
    const ctx = buildContext(fixture());
    const day = computeTimes(ctx, 1, stopsOf(GOOD_PLAN, 0));
    const timeline = day.stops.map((s) => [s.kind, s.ref, s.arrive, s.depart, s.travel_min_to_next]);
    expect(timeline).toEqual([
      ["start", null, "04:24", "04:24", 6],
      ["place", "hill", "04:30", "05:45", 3],
      ["place", "pho", "07:00", "07:45", 6],
      ["place", "lunch", "11:30", "12:15", 3],
      ["rest", null, "12:18", "14:30", 12],
      ["place", "cafe", "14:42", "15:27", 12],
      ["end", null, "15:39", "15:39", null],
    ]);
    expect(day.total_minutes).toBe(15 * 60 + 39 - (4 * 60 + 24));
    expect(day.stops.map((s) => s.slot)).toEqual([null, "sunrise", "breakfast", "lunch", "rest", "cafe", null]);
    expect(day.stops[1]?.reason).toBe("clouds at dawn");
    expect(day.stops[4]?.name).toBe("");
    expect(day.zone_ids).toEqual(["N-1"]);
  });

  it("computeTimes matches the Python clock for day 2 and flags the long wait", () => {
    const ctx = buildContext(fixture());
    const day = computeTimes(ctx, 2, stopsOf(GOOD_PLAN, 1));
    expect(day.stops.map((s) => [s.kind, s.arrive, s.depart])).toEqual([
      ["start", "17:24", "17:24"],
      ["place", "17:30", "18:15"],
      ["nearby", "19:30", "20:15"],
      ["end", "20:24", "20:24"],
    ]);
    const wait = day.issues.find((i) => i.rule === "long_wait");
    expect(wait?.level).toBe("warning");
    expect(wait?.params.n).toBe(72);
    expect(wait?.index).toBe(1);
  });

  it("the good plan has no hard violation", () => {
    const ctx = buildContext(fixture());
    const plan = computePlan(ctx, GOOD_PLAN.days, GOOD_PLAN.unplaced);
    expect(rules(plan.issues, "error")).toEqual([]);
  });

  it("validateDay and validatePlan report the violations of test_violations_keep_old_routes", () => {
    const ctx = buildContext(fixture({ config: { dayEnd: "20:00" } }));
    const bad = clone(GOOD_PLAN);
    bad.days[0]?.stops.push({ ref: "monday", slot: "evening", reason: "x" });
    bad.days[0]?.stops.push({ ref: "gp:nope", slot: "evening", reason: "x" });
    bad.days[1]?.stops.unshift({ ref: "pho", slot: "breakfast", reason: "again" });
    bad.unplaced = [{ ref: "far", reason: "too far" }];

    const day1 = validateDay(ctx, 1, stopsOf(bad, 0));
    expect(rules(day1, "error")).toContain("closed");
    expect(rules(day1, "error")).toContain("unknown_ref");
    const day2 = validateDay(ctx, 2, stopsOf(bad, 1));
    expect(rules(day2, "error")).toContain("day_end");

    const coverage = validatePlan(ctx, bad.days, bad.unplaced);
    const duplicate = coverage.find((i) => i.rule === "duplicate");
    expect(duplicate?.ref).toBe("pho");
    expect(duplicate?.params.n).toBe(2);
    expect(rules(coverage)).not.toContain("missing_place");
  });

  it("validatePlan flags missing places, too many days and must-go places left out", () => {
    const data = fixture();
    data.places = PLACES.map((p) => (p.id === "far" ? { ...p, priority: "must" } : p));
    const ctx = buildContext(data);
    const plan = clone(GOOD_PLAN);
    expect(rules(validatePlan(ctx, plan.days, plan.unplaced))).toEqual(["must_unplaced"]);
    plan.unplaced = [];
    plan.days.push({ stops: [{ ref: "far", slot: "morning" }] });
    const issues = validatePlan(ctx, plan.days, plan.unplaced);
    expect(rules(issues).sort()).toEqual(["missing_place", "too_many_days"]);
    expect(issues.find((i) => i.rule === "missing_place")?.ref).toBe("monday");
  });

  it("a pair missing from the matrix falls back to the 18 km/h x1.3 estimate", () => {
    const ctx = buildContext(fixture({ travel: { ids: [], minutes: [] } }));
    const leg = travelBetween(ctx, "center", "cafe");
    const km = haversineKm(CENTER.lat, CENTER.lng, CENTER.lat + 4 * KM_LAT, CENTER.lng);
    expect(leg.estimated).toBe(true);
    expect(leg.min).toBe(Math.ceil(((km * 1.3) / 18) * 60 - 1e-9));
    expect(leg.min).toBe(18);
    expect(estimateMinutes(CENTER, { lat: CENTER.lat + 4 * KM_LAT, lng: CENTER.lng })).toBe(18);
    const day = computeTimes(ctx, 1, [{ ref: "cafe", slot: "cafe" }]);
    expect(day.stops[0]?.travel_min_to_next).toBe(18);
    expect(day.stops[0]?.travel_estimated).toBe(true);
  });

  it("opening intervals: overnight periods, 24 hours and unknown hours", () => {
    const night = { periods: [{ day: 4, open: "18:00", close: "02:00" }] };
    expect(openingIntervals(night, 4)).toEqual([[18 * 60, 1440]]);
    expect(openingIntervals(night, 5)).toEqual([[0, 120]]);
    expect(openingIntervals(night, 6)).toEqual([]);
    expect(openingIntervals({ periods: [{ day: 0, open: "00:00", close: null }] }, 3)).toEqual([[0, 1440]]);
    expect(openingIntervals(null, 2)).toBeNull();
    expect(openingFit(sat("06:00", "11:00"), 5, 10 * 60 + 30, 45)).toEqual({ arrive: null, closedDay: false });
    expect(openingFit(sat("06:00", "11:00"), 2, 420, 45)).toEqual({ arrive: null, closedDay: true });
  });

  it("hour ranges parse like routing/windows.parse_hour_range", () => {
    expect(parseHourRange("17:00-20:00")).toEqual([1020, 1200]);
    expect(parseHourRange("17h-20h")).toEqual([1020, 1200]);
    expect(parseHourRange("7–9")).toEqual([420, 540]);
    expect(parseHourRange("22:00 to 02:00")).toEqual([1320, 1440]);
    expect(parseHourRange("evening")).toBeNull();
  });

  it("best time, deadline, slot category and opposite directions", () => {
    const data = fixture();
    data.places = PLACES.map((p) =>
      p.id === "hill" ? { ...p, best_time: { hours: "05:00-06:00", deadline: "04:20", source: "comments" } } : p,
    );
    const ctx = buildContext(data);
    const day = computeTimes(ctx, 1, [
      { ref: "hill", slot: "sunrise" },
      { ref: "dinner", slot: "cafe" },
    ]);
    for (const rule of ["best_time", "deadline", "directions", "slot_category", "long_wait"]) {
      expect(rules(day.issues), rule).toContain(rule);
    }
    expect(day.stops[2]?.arrive).toBe("16:00");
    const heuristic = buildContext({
      ...data,
      places: data.places.map((p) => (p.best_time ? { ...p, best_time: { ...p.best_time, source: "heuristic" } } : p)),
    });
    expect(rules(validateDay(heuristic, 1, [{ ref: "hill", slot: "sunrise" }]))).not.toContain("best_time");
  });

  it("weekdays past the trip continue the dates, or stay on the default weekday", () => {
    const dated = buildContext({ ...fixture(), tripWeekdays: [5, 6], config: { ...fixture().config, dated: true } });
    expect(weekdayOf(dated, 2)).toBe(0);
    const undated = buildContext({ ...fixture(), tripWeekdays: [5, 5] });
    expect(weekdayOf(undated, 4)).toBe(5);
  });

  it("toPlanJson matches planning/schema.py and drops the times", () => {
    const json = toPlanJson(
      [
        {
          stops: [
            { ref: "hill", slot: "sunrise", reason: " dawn " },
            { ref: "rest", slot: "rest", reason: "" },
          ],
        },
        { stops: [] },
      ],
      [{ ref: "far", reason: "too far" }],
    );
    expect(json).toEqual({
      days: [
        {
          day: 1,
          stops: [
            { ref: "hill", slot: "sunrise", reason: "dawn" },
            { ref: "rest", slot: "rest" },
          ],
        },
        { day: 2, stops: [] },
      ],
      unplaced: [{ ref: "far", reason: "too far" }],
    });
  });

  it("editableDays strips start and end and maps rest stops back to 'rest'", () => {
    const ctx = buildContext(fixture());
    const timed = GOOD_PLAN.days.map((d, i) => computeTimes(ctx, i + 1, d.stops));
    const days = editableDays(timed);
    expect(toPlanJson(days, GOOD_PLAN.unplaced).days).toEqual(toPlanJson(GOOD_PLAN.days, []).days);
  });

  it("pickSlot and insertIndex keep the rhythm order", () => {
    const ctx = buildContext(fixture());
    const stops = stopsOf(GOOD_PLAN, 0);
    expect(pickSlot(ctx, node(ctx, "dinner"), stops)).toBe("dinner");
    expect(insertIndex(ctx, stops, "dinner")).toBe(stops.length);
    expect(pickSlot(ctx, node(ctx, "rest"), stops)).toBe("rest");
    expect(insertIndex(ctx, stops, "morning")).toBe(2);
    expect(pickSlot(ctx, node(ctx, "osm:node/7"), [])).toBe("morning");
  });

  it("fold matches the shell: accents stripped, đ to d, lower case", () => {
    expect(fold("Bánh Mì Phượng")).toBe("banh mi phuong");
    expect(fold("Đà Lạt")).toBe("da lat");
    expect(fold("BÚN BÒ HUẾ")).toBe("bun bo hue");
    expect(fold(null)).toBe("");
  });

  it("search is accent-insensitive in both directions and needs every word", () => {
    const haystack = fold("Bún bò Huế Đông Ba 12 Lê Lợi");
    for (const query of ["bun", "bún", "BUN BO", "dong ba", "đông", "  hue  ", ""]) {
      expect(matchesQuery(haystack, query), query).toBe(true);
    }
    expect(matchesQuery(fold("Banh mi"), "bánh")).toBe(true);
    expect(matchesQuery(haystack, "bun cha")).toBe(false);
    expect(matchesQuery(haystack, "bánh")).toBe(false);
  });

  it("day number ink follows WCAG contrast", () => {
    expect(inkFor("#2563eb")).toBe("#ffffff");
    expect(inkFor("#d97706")).toBe("#000000");
    expect(inkFor("#65a30d")).toBe("#000000");
    expect(inkFor("#7c3aed")).toBe("#ffffff");
    expect(inkFor("bad")).toBe(inkFor(FALLBACK_COLOR));
  });

  it("every editor label has an English and a Vietnamese map_ui entry", async () => {
    const i18nSource = await readRepoFile("src/tiktok_trip/export/i18n.py");
    const split = i18nSource.indexOf("\nVI = Labels(");
    const blocks = [i18nSource.slice(0, split), i18nSource.slice(split)];
    expect(split).toBeGreaterThan(0);
    for (const key of Object.keys(FALLBACK_LABELS)) {
      for (const block of blocks) expect(block.includes(`"${key}":`), key).toBe(true);
    }
  });

  it("the clock is unchanged by an undo round trip through toPlanJson", () => {
    const ctx = buildContext(fixture());
    const before = GOOD_PLAN.days.map((d, i) => computeTimes(ctx, i + 1, d.stops));
    const snapshot = clone(GOOD_PLAN.days);
    const edited = clone(GOOD_PLAN.days);
    edited[0]?.stops.splice(2, 1);
    expect(computeTimes(ctx, 1, (edited[0] as EditDay).stops).stops).not.toEqual(before[0]?.stops);
    const restored = snapshot.map((d, i) => computeTimes(ctx, i + 1, d.stops));
    expect(restored).toEqual(before);
    expect(toPlanJson(snapshot, GOOD_PLAN.unplaced)).toEqual(toPlanJson(GOOD_PLAN.days, GOOD_PLAN.unplaced));
  });

  it("reason_vi and the unplaced code survive editableDays and toPlanJson", () => {
    const plan: FixturePlan = {
      days: [
        {
          stops: [
            { ref: "hill", slot: "sunrise", reason: "clouds at dawn", reason_vi: "săn mây lúc bình minh" },
            { ref: "rest", slot: "rest", reason: "", reason_vi: "" },
          ],
        },
      ],
      unplaced: [
        { ref: "far", code: "too_far", reason: "45 min away" },
        { ref: "monday", code: "closed", reason: "" },
      ],
    };
    const ctx = buildContext(fixture());
    const timed = plan.days.map((d, i) => computeTimes(ctx, i + 1, d.stops));
    expect(timed[0]?.stops[1]?.reason_vi).toBe("săn mây lúc bình minh");
    const json = toPlanJson(editableDays(timed), plan.unplaced);
    expect(json).toEqual({
      days: [
        {
          day: 1,
          stops: [
            { ref: "hill", slot: "sunrise", reason: "clouds at dawn", reason_vi: "săn mây lúc bình minh" },
            { ref: "rest", slot: "rest" },
          ],
        },
      ],
      unplaced: [
        { ref: "far", code: "too_far", reason: "45 min away" },
        { ref: "monday", code: "closed", reason: "" },
      ],
    });
    expect(toPlanJson(json.days.map((d) => ({ stops: d.stops })), json.unplaced)).toEqual(json);
  });
});
