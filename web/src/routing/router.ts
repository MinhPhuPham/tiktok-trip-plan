import { createRoadLookup, decodePolyline, type LatLng, type LegEnd, type RoadLookup } from "../map/polyline";
import { coordText, legCacheKey, samePoint, type CachedLeg, type LegStore } from "./legCache";
import { fetchDayRoute, type RoutedLeg } from "./osrm";
import { backoffMs, isAbortError, osrmThrottle, type Throttle } from "./throttle";

/** idle: every leg has its road; loading: some are being fetched; offline / error: some stay approximate. */
export type RoadStatus = "idle" | "loading" | "offline" | "error";

/** Plan edits come in bursts (drag, then drop): wait this long after the last one. */
export const EDIT_DEBOUNCE_MS = 700;

export interface RoadRouterOptions {
  /** routeBase(endpoint, profile); null turns live routing off (older exports, `roads.enabled: false`). */
  base: string | null;
  /** data.roads: the export's legs, never fetched again. */
  exported: Readonly<Record<string, string>>;
  store: LegStore;
  fetcher?: typeof fetch;
  throttle?: Throttle;
  isOnline?: () => boolean;
  debounceMs?: number;
}

export interface RoadRouter {
  /** False when the export names no routing server: unknown legs then stay straight. */
  readonly live: boolean;
  /** The road between two stops: the export's, else the cached one; null while unknown. */
  lookup: RoadLookup;
  /** The plan's days to draw (stops in order); fetches what is missing after a short pause. */
  request: (days: readonly (readonly LegEnd[])[]) => void;
  setOnline: (online: boolean) => void;
  /** Called whenever roads arrive (from the network or the persistent cache). */
  subscribe: (listener: () => void) => () => void;
  subscribeStatus: (listener: () => void) => () => void;
  getStatus: () => RoadStatus;
  dispose: () => void;
}

interface Job {
  day: string;
  stops: readonly LegEnd[];
}

const point = (stop: LegEnd): LatLng => [stop.lat, stop.lng];
const daySignature = (stops: readonly LegEnd[]): string => stops.map((stop) => coordText(point(stop))).join(";");

/**
 * Road geometry for the plan as edited. Legs come from the export first, then the persistent
 * cache, then one OSRM request per changed day (only the stretch between its first and last
 * unknown leg), paced by the shared throttle, skipped offline and backed off after failures.
 */
export function createRoadRouter(options: RoadRouterOptions): RoadRouter {
  const { base, store } = options;
  const server = base ?? "";
  const fetcher = options.fetcher ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const throttle = options.throttle ?? osrmThrottle;
  const isOnline = options.isOnline ?? (() => navigator.onLine);
  const debounceMs = options.debounceMs ?? EDIT_DEBOUNCE_MS;
  const exported = createRoadLookup(options.exported);
  const known = new Map<string, CachedLeg>();
  const decoded = new Map<string, LatLng[]>();
  /** Keys already looked up in the persistent cache (found or not). */
  const checked = new Set<string>();
  const listeners = new Set<() => void>();
  const statusListeners = new Set<() => void>();
  let days: readonly (readonly LegEnd[])[] = [];
  let status: RoadStatus = "idle";
  let online = true;
  let failures = 0;
  let retryAt = 0;
  let timer: number | undefined;
  let inFlight: { day: string; controller: AbortController } | null = null;
  let running: Promise<void> | null = null;
  let again = false;
  let disposed = false;

  const keyOf = (from: LegEnd, to: LegEnd): string => legCacheKey(server, point(from), point(to));

  const lookup: RoadLookup = (from, to) => {
    if (samePoint(from, to)) return [];
    const road = exported(from, to);
    if (road) return road;
    const key = keyOf(from, to);
    const leg = known.get(key);
    if (!leg) return null;
    if (leg.noRoute) return [];
    let points = decoded.get(key);
    if (!points) decoded.set(key, (points = decodePolyline(leg.points)));
    return points;
  };

  const setStatus = (next: RoadStatus) => {
    if (next === status) return;
    status = next;
    for (const listener of statusListeners) listener();
  };
  const changed = () => {
    for (const listener of listeners) listener();
  };

  const missingLegs = (stops: readonly LegEnd[]): number[] =>
    stops.flatMap((stop, i) => {
      const previous = stops[i - 1];
      return previous && lookup(previous, stop) === null ? [i - 1] : [];
    });

  const pendingJobs = (): Job[] =>
    days.flatMap((stops) => {
      const missing = missingLegs(stops);
      const first = missing[0];
      const last = missing[missing.length - 1];
      if (first === undefined || last === undefined) return [];
      return [{ day: daySignature(stops), stops: stops.slice(first, last + 2) }];
    });

  const isCurrent = (day: string) => days.some((stops) => daySignature(stops) === day);

  async function loadStored(): Promise<void> {
    const keys = new Set<string>();
    for (const stops of days) {
      for (const i of missingLegs(stops)) {
        const from = stops[i];
        const to = stops[i + 1];
        const key = from && to ? keyOf(from, to) : undefined;
        if (key && !checked.has(key)) keys.add(key);
      }
    }
    if (!keys.size) return;
    for (const key of keys) checked.add(key);
    const found = await store.getMany([...keys]);
    for (const [key, leg] of found) known.set(key, leg);
    if (found.size) changed();
  }

  function remember(legs: ReadonlyMap<string, RoutedLeg>): void {
    const used = Date.now();
    const entries: CachedLeg[] = [];
    for (const leg of legs.values()) {
      const key = legCacheKey(server, leg.from, leg.to);
      const entry: CachedLeg = { key, points: leg.points, durationS: leg.durationS, distanceM: leg.distanceM, noRoute: leg.noRoute, used };
      known.set(key, entry);
      decoded.delete(key);
      checked.add(key);
      entries.push(entry);
    }
    void store.putMany(entries).catch(() => undefined);
    changed();
  }

  const connected = () => online && isOnline();

  function schedule(ms: number): void {
    window.clearTimeout(timer);
    if (!disposed) timer = window.setTimeout(() => void run(), ms);
  }

  async function pass(): Promise<void> {
    if (pendingJobs().length) await loadStored();
    const jobs = pendingJobs();
    if (!jobs.length) return setStatus("idle");
    if (!connected()) return setStatus("offline");
    const wait = retryAt - Date.now();
    if (wait > 0) {
      setStatus("error");
      return schedule(wait);
    }
    setStatus("loading");
    for (const job of jobs) {
      if (disposed) return;
      if (!connected()) return setStatus("offline");
      if (!isCurrent(job.day) || !missingLegs(job.stops).length) continue;
      const controller = new AbortController();
      inFlight = { day: job.day, controller };
      try {
        const legs = await fetchDayRoute(job.stops, { base: server, fetcher, throttle, signal: controller.signal });
        failures = 0;
        retryAt = 0;
        remember(legs);
      } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) continue;
        failures += 1;
        retryAt = Date.now() + backoffMs(failures);
        setStatus(connected() ? "error" : "offline");
        return schedule(retryAt - Date.now());
      } finally {
        inFlight = null;
      }
    }
    setStatus(pendingJobs().length ? "loading" : "idle");
  }

  function run(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        await pass();
      } while (again && !disposed);
    })().finally(() => {
      running = null;
    });
    return running;
  }

  return {
    live: base !== null,
    lookup,
    request(next) {
      if (base === null || disposed) return;
      days = next;
      if (inFlight && !isCurrent(inFlight.day)) inFlight.controller.abort();
      schedule(debounceMs);
    },
    setOnline(next) {
      if (next === online) return;
      online = next;
      if (base === null) return;
      if (next) {
        failures = 0;
        retryAt = 0;
      } else {
        inFlight?.controller.abort();
      }
      schedule(0);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    getStatus: () => status,
    dispose() {
      disposed = true;
      window.clearTimeout(timer);
      inFlight?.controller.abort();
      listeners.clear();
      statusListeners.clear();
    },
  };
}
