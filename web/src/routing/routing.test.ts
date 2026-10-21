import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodePolyline, encodePolyline, type LatLng, type LegEnd } from "../map/polyline";
import fixture from "./__fixtures__/osrm-dalat-day.json";
import { coordText, legCacheKey, memoryLegStore, samePoint } from "./legCache";
import { chunkSpans, fetchDayRoute, mergeSteps, parseRoute, routeBase, routeUrl } from "./osrm";
import { createRoadRouter, EDIT_DEBOUNCE_MS, type RoadRouterOptions } from "./router";
import { backoffMs, createThrottle } from "./throttle";
import { routingBase } from "./useRoadGeometry";

const BASE = "https://routing.example/routed-car";

/** The four stops of the recorded answer (Đà Lạt: hotel, two places, back towards the hotel). */
const DALAT: LegEnd[] = [
  { kind: "start", ref: null, lat: 11.938328, lng: 108.459122 },
  { kind: "place", ref: "a", lat: 11.940209, lng: 108.50794 },
  { kind: "place", ref: "b", lat: 11.941613, lng: 108.512823 },
  { kind: "place", ref: "c", lat: 11.937546, lng: 108.464125 },
];

const stop = (ref: string, lat: number, lng: number): LegEnd => ({ kind: "place", ref, lat, lng });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** The waypoints of a route URL as [lat, lng]. */
function waypointsOf(url: string): LatLng[] {
  const path = new URL(url).pathname.split("/driving/")[1] ?? "";
  return path.split(";").map((pair) => {
    const [lng, lat] = pair.split(",").map(Number);
    return [lat ?? 0, lng ?? 0];
  });
}

/** A fake OSRM: every leg is one step through a point beside the straight line. */
function syntheticRoute(url: string) {
  const points = waypointsOf(url);
  const legs = points.slice(1).map((to, i) => {
    const from = points[i] ?? to;
    const bend: LatLng = [(from[0] + to[0]) / 2 + 0.001, (from[1] + to[1]) / 2];
    return { duration: 60 * (i + 1), distance: 500, steps: [{ geometry: encodePolyline([from, bend, to]) }, { geometry: encodePolyline([to]) }] };
  });
  return { code: "Ok", routes: [{ legs }] };
}

interface FakeServer {
  fetcher: typeof fetch;
  urls: string[];
  times: number[];
  signals: AbortSignal[];
}

function fakeServer(answer: (url: string) => Response | Promise<Response> = (url) => json(syntheticRoute(url))): FakeServer {
  const server: FakeServer = {
    urls: [],
    times: [],
    signals: [],
    fetcher: (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      server.urls.push(url);
      server.times.push(Date.now());
      if (init?.signal) server.signals.push(init.signal);
      return Promise.resolve(answer(url));
    },
  };
  return server;
}

describe("OSRM answers", () => {
  it("builds the request URL like the Python client, lng first", () => {
    expect(routeBase("https://routing.openstreetmap.de/", "/routed-car/")).toBe("https://routing.openstreetmap.de/routed-car");
    expect(routeBase("https://osrm.local", "")).toBe("https://osrm.local");
    expect(routeUrl(BASE, [[11.9, 108.4], [11.95, 108.5]])).toBe(
      `${BASE}/route/v1/driving/108.400000,11.900000;108.500000,11.950000?overview=false&steps=true&geometries=polyline`,
    );
  });

  it("merges a leg's steps in order and drops the point where two steps meet", () => {
    const first = encodePolyline([[1, 1], [1, 2]]);
    const second = encodePolyline([[1, 2], [2, 2]]);
    expect(mergeSteps([first, second, encodePolyline([[2, 2]])])).toEqual([[1, 1], [1, 2], [2, 2]]);
  });

  it("splits the recorded day route into one road per leg", () => {
    const answer = parseRoute(fixture, 3);
    if (answer.kind !== "ok") throw new Error(answer.kind);
    const legs = fixture.routes[0]?.legs ?? [];
    answer.legs.forEach((leg, i) => {
      const points = decodePolyline(leg.points);
      const steps = legs[i]?.steps ?? [];
      expect(points[0]).toEqual(decodePolyline(steps[0]?.geometry ?? "")[0]);
      expect(points.at(-1)).toEqual(decodePolyline(steps.at(-1)?.geometry ?? "").at(-1));
      expect(points.length).toBeGreaterThan(10);
      expect(points.some((p, j) => j > 0 && p[0] === points[j - 1]?.[0] && p[1] === points[j - 1]?.[1])).toBe(false);
      expect(leg.durationS).toBe(legs[i]?.duration);
      expect(leg.distanceM).toBe(legs[i]?.distance);
    });
    const waypoints = fixture.waypoints.map((w) => [w.location[1], w.location[0]]);
    const [leg0, leg1] = answer.legs;
    expect(decodePolyline(leg0?.points ?? "")[0]?.[0]).toBeCloseTo(waypoints[0]?.[0] ?? 0, 4);
    expect(decodePolyline(leg1?.points ?? "")[0]?.[1]).toBeCloseTo(waypoints[1]?.[1] ?? 0, 4);
  });

  it("tells no route from a broken answer", () => {
    expect(parseRoute({ code: "NoRoute", message: "Impossible route" }, 1)).toEqual({ kind: "no-route" });
    expect(parseRoute({ code: "InvalidQuery" }, 1).kind).toBe("invalid");
    expect(parseRoute({ code: "Ok", routes: [{ legs: [] }] }, 1).kind).toBe("invalid");
    expect(parseRoute("<html>", 1).kind).toBe("invalid");
  });

  it("chunks long days into requests that share their end waypoints", () => {
    expect(chunkSpans(1)).toEqual([]);
    expect(chunkSpans(2)).toEqual([[0, 1]]);
    expect(chunkSpans(100)).toEqual([[0, 99]]);
    expect(chunkSpans(250)).toEqual([
      [0, 99],
      [99, 198],
      [198, 249],
    ]);
  });
});

describe("fetchDayRoute", () => {
  it("sends one request for the day and keys each leg like data.roads", async () => {
    const server = fakeServer(() => json(fixture));
    const legs = await fetchDayRoute(DALAT, { base: BASE, fetcher: server.fetcher });
    expect(server.urls).toHaveLength(1);
    expect([...legs.keys()]).toEqual(["center>a", "a>b", "b>c"]);
    expect(legs.get("a>b")?.durationS).toBe(fixture.routes[0]?.legs[1]?.duration);
    expect(legs.get("a>b")?.from).toEqual([11.940209, 108.50794]);
  });

  it("needs no request between stops at the same point and skips them as waypoints", async () => {
    const server = fakeServer();
    expect(await fetchDayRoute([stop("a", 1, 1), { kind: "rest", ref: "rest", lat: 1, lng: 1 }], { base: BASE, fetcher: server.fetcher })).toEqual(new Map());
    expect(server.urls).toHaveLength(0);
    const legs = await fetchDayRoute([stop("a", 1, 1), stop("b", 1.000001, 1), stop("c", 2, 2)], { base: BASE, fetcher: server.fetcher });
    expect(waypointsOf(server.urls[0] ?? "")).toHaveLength(2);
    expect([...legs.keys()]).toEqual(["b>c"]);
  });

  it("chunks more than 100 waypoints into overlapping requests", async () => {
    const server = fakeServer();
    const stops = Array.from({ length: 150 }, (_, i) => stop(`p${i}`, 10 + i * 0.001, 106));
    const legs = await fetchDayRoute(stops, { base: BASE, fetcher: server.fetcher });
    expect(server.urls.map((url) => waypointsOf(url).length)).toEqual([100, 51]);
    expect(waypointsOf(server.urls[1] ?? "")[0]).toEqual(waypointsOf(server.urls[0] ?? "").at(-1));
    expect(legs.size).toBe(149);
    expect([...legs.values()].every((leg) => !leg.noRoute && leg.points)).toBe(true);
  });

  it("narrows a no-route answer down to the leg without a road", async () => {
    const island: LatLng = [5, 5];
    const server = fakeServer((url) =>
      waypointsOf(url).some(([lat]) => lat === island[0])
        ? json({ code: "NoRoute", message: "Impossible route between points" }, 400)
        : json(syntheticRoute(url)),
    );
    const legs = await fetchDayRoute([stop("a", 1, 1), stop("b", 1.1, 1), stop("c", 1.2, 1), stop("x", island[0], island[1])], { base: BASE, fetcher: server.fetcher });
    expect(legs.get("c>x")?.noRoute).toBe(true);
    expect(legs.get("a>b")?.noRoute).toBe(false);
    expect(legs.get("b>c")?.noRoute).toBe(false);
    expect(server.urls.map((url) => waypointsOf(url).length)).toEqual([4, 2, 3, 2, 2]);
  });

  it("fails on server errors so the caller can back off", async () => {
    const server = fakeServer(() => new Response("busy", { status: 503 }));
    await expect(fetchDayRoute(DALAT, { base: BASE, fetcher: server.fetcher })).rejects.toThrow("HTTP 503");
    const broken = fakeServer(() => json({ code: "InvalidUrl" }, 400));
    await expect(fetchDayRoute(DALAT, { base: BASE, fetcher: broken.fetcher })).rejects.toThrow("InvalidUrl");
  });
});

describe("leg cache keys", () => {
  it("rounds both ends to 5 decimals and keeps server and profile apart", () => {
    expect(coordText([11.9383279, 108.4591222])).toBe("11.93833,108.45912");
    expect(coordText([-0.000001, 0])).toBe("0.00000,0.00000");
    expect(legCacheKey(BASE, [11.9383279, 108.4591222], [11.94, 108.5])).toBe(`${BASE}|11.93833,108.45912|11.94000,108.50000`);
    expect(legCacheKey(BASE, [1, 1], [2, 2])).not.toBe(legCacheKey("https://routing.example/routed-foot", [1, 1], [2, 2]));
    expect(samePoint({ lat: 1.000001, lng: 2 }, { lat: 1, lng: 2.000004 })).toBe(true);
    expect(samePoint({ lat: 1.00001, lng: 2 }, { lat: 1, lng: 2 })).toBe(false);
  });

  it("reads the routing server from the export, none for older exports", () => {
    expect(routingBase({ roads_enabled: true, roads_endpoint: "https://routing.openstreetmap.de", roads_profile: "routed-car" })).toBe(
      "https://routing.openstreetmap.de/routed-car",
    );
    expect(routingBase({})).toBeNull();
    expect(routingBase({ roads_enabled: false, roads_endpoint: "https://x.org", roads_profile: "" })).toBeNull();
    expect(routingBase({ roads_enabled: true, roads_endpoint: "javascript:alert(1)", roads_profile: "" })).toBeNull();
  });
});

describe("throttle and backoff", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("lets one call through per interval, in order", async () => {
    const throttle = createThrottle(1000);
    const done: number[] = [];
    const start = Date.now();
    for (let i = 0; i < 3; i++) void throttle().then(() => done.push(Date.now() - start));
    await vi.advanceTimersByTimeAsync(2500);
    expect(done).toEqual([0, 1000, 2000]);
  });

  it("doubles the wait after each failure up to a minute", () => {
    expect([1, 2, 3, 10].map(backoffMs)).toEqual([2000, 4000, 8000, 60_000]);
  });
});

describe("road router", () => {
  const DAY1 = [stop("a", 11.9, 108.4), stop("b", 11.91, 108.41), stop("c", 11.92, 108.42)];
  const DAY2 = [stop("d", 11.8, 108.3), stop("e", 11.81, 108.31)];
  let online: boolean;

  beforeEach(() => {
    vi.useFakeTimers();
    online = true;
  });
  afterEach(() => vi.useRealTimers());

  const router = (server: FakeServer, options: Partial<RoadRouterOptions> = {}) =>
    createRoadRouter({ base: BASE, exported: {}, store: memoryLegStore(), fetcher: server.fetcher, throttle: createThrottle(1000), isOnline: () => online, ...options });

  it("waits for the edits to settle, then asks once per changed day", async () => {
    const server = fakeServer();
    const roads = router(server);
    const changes = vi.fn();
    roads.subscribe(changes);
    roads.request([DAY1.slice(0, 2)]);
    await vi.advanceTimersByTimeAsync(EDIT_DEBOUNCE_MS - 100);
    roads.request([DAY1, DAY2]);
    await vi.advanceTimersByTimeAsync(EDIT_DEBOUNCE_MS - 100);
    expect(server.urls).toHaveLength(0);
    expect(roads.lookup(DAY1[0]!, DAY1[1]!)).toBeNull();
    await vi.advanceTimersByTimeAsync(100);
    expect(server.urls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.urls).toHaveLength(2);
    expect((server.times[1] ?? 0) - (server.times[0] ?? 0)).toBeGreaterThanOrEqual(1000);
    expect(roads.lookup(DAY1[0]!, DAY1[1]!)?.length).toBe(3);
    expect(roads.lookup(DAY2[0]!, DAY2[1]!)?.length).toBe(3);
    expect(roads.getStatus()).toBe("idle");
    expect(changes).toHaveBeenCalledTimes(2);
  });

  it("asks only for the stretch of a day whose legs are unknown", async () => {
    const server = fakeServer();
    const exported = { "a>b": encodePolyline([[11.9, 108.4], [11.91, 108.41]]) };
    const roads = router(server, { exported });
    roads.request([[...DAY1, stop("f", 11.95, 108.45)]]);
    await vi.advanceTimersByTimeAsync(EDIT_DEBOUNCE_MS);
    expect(server.urls).toHaveLength(1);
    expect(waypointsOf(server.urls[0] ?? "")).toEqual([[11.91, 108.41], [11.92, 108.42], [11.95, 108.45]]);
  });

  it("sends nothing when the export and the persistent cache have every leg", async () => {
    const server = fakeServer();
    const exported = { "a>b": encodePolyline([[11.9, 108.4], [11.91, 108.41]]) };
    const cached = { key: legCacheKey(BASE, [11.91, 108.41], [11.92, 108.42]), points: encodePolyline([[11.91, 108.41], [11.915, 108.41], [11.92, 108.42]]), durationS: 90, distanceM: 800, noRoute: false, used: 0 };
    const roads = router(server, { exported, store: memoryLegStore([cached]) });
    roads.request([DAY1]);
    await vi.advanceTimersByTimeAsync(EDIT_DEBOUNCE_MS * 3);
    expect(server.urls).toHaveLength(0);
    expect(roads.lookup(DAY1[1]!, DAY1[2]!)?.length).toBe(3);
    expect(roads.getStatus()).toBe("idle");
  });

  it("stores fetched legs by rounded coordinates for the next visit", async () => {
    const server = fakeServer();
    const store = memoryLegStore();
    router(server, { store }).request([DAY2]);
    await vi.advanceTimersByTimeAsync(EDIT_DEBOUNCE_MS);
    const key = legCacheKey(BASE, [11.8, 108.3], [11.81, 108.31]);
    expect(store.legs.get(key)?.durationS).toBe(60);
    const again = fakeServer();
    const next = router(again, { store });
    next.request([[stop("d2", 11.800001, 108.3), stop("e2", 11.81, 108.310004)]]);
    await vi.advanceTimersByTimeAsync(EDIT_DEBOUNCE_MS * 2);
    expect(again.urls).toHaveLength(0);
  });

  it("aborts the request of a day that a newer edit changed", async () => {
    const server = fakeServer((url) => new Promise<Response>(() => void url));
    const roads = router(server);
    roads.request([DAY1]);
    await vi.advanceTimersByTimeAsync(EDIT_DEBOUNCE_MS);
    expect(server.urls).toHaveLength(1);
    roads.request([DAY2]);
    expect(server.signals[0]?.aborted).toBe(true);
  });

  it("keeps the request of a day the edit did not touch", async () => {
    const server = fakeServer((url) => new Promise<Response>(() => void url));
    const roads = router(server);
    roads.request([DAY1]);
    await vi.advanceTimersByTimeAsync(EDIT_DEBOUNCE_MS);
    roads.request([DAY1, DAY2]);
    expect(server.signals[0]?.aborted).toBe(false);
  });

  it("skips the network offline and resolves when back online", async () => {
    online = false;
    const server = fakeServer();
    const roads = router(server);
    roads.setOnline(false);
    roads.request([DAY2]);
    await vi.advanceTimersByTimeAsync(EDIT_DEBOUNCE_MS * 3);
    expect(server.urls).toHaveLength(0);
    expect(roads.getStatus()).toBe("offline");
    online = true;
    roads.setOnline(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(server.urls).toHaveLength(1);
    expect(roads.getStatus()).toBe("idle");
  });

  it("backs off after a failure and tries again later", async () => {
    let fail = true;
    const server = fakeServer((url) => (fail ? new Response("", { status: 502 }) : json(syntheticRoute(url))));
    const roads = router(server);
    roads.request([DAY2]);
    await vi.advanceTimersByTimeAsync(EDIT_DEBOUNCE_MS);
    expect(roads.getStatus()).toBe("error");
    fail = false;
    await vi.advanceTimersByTimeAsync(backoffMs(1) - 100);
    expect(server.urls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(server.urls).toHaveLength(2);
    expect(roads.getStatus()).toBe("idle");
  });

  it("never fetches without a routing server", async () => {
    const server = fakeServer();
    const roads = router(server, { base: null });
    roads.request([DAY1]);
    await vi.advanceTimersByTimeAsync(EDIT_DEBOUNCE_MS * 2);
    expect(roads.live).toBe(false);
    expect(server.urls).toHaveLength(0);
    expect(roads.lookup(DAY1[0]!, DAY1[1]!)).toBeNull();
    expect(roads.lookup(DAY1[0]!, { ...DAY1[0]!, kind: "rest" })).toEqual([]);
  });
});
