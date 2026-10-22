import type { TripStoreApi } from "../state/store";
import { locateBrowser, trustsPermissionsApi } from "./browser";
import { isWatching, type LocateProblem } from "./locateMachine";
import { toUserFix } from "./position";

/** Why the browser cannot give this page a position at all: no API, or an insecure (http) page. */
export type GeoUnavailable = "insecure" | "unsupported";

/** Whether a fix succeeded earlier in this browser session (tab), for browsers whose Permissions API says nothing useful. */
export interface FixMemory {
  had(): boolean;
  save(): void;
  forget(): void;
}

export interface GeoEnv {
  /** null where location cannot work; `unavailable` says why. */
  geolocation: Geolocation | null;
  unavailable: GeoUnavailable | null;
  /** null where it is missing or not trusted (Chrome, Edge, Firefox on iOS). */
  permissions: Pick<Permissions, "query"> | null;
  document: Document;
  now: () => number;
  session: FixMemory | null;
}

const PERMISSION_DENIED = 1;
const POSITION_UNAVAILABLE = 2;
/**
 * A refusal faster than this came without a prompt: nobody answers a dialog in 300 ms. On iOS it
 * means the browser app itself may not use location (Settings → Chrome → Location: Never).
 */
export const INSTANT_DENIAL_MS = 300;
const SESSION_KEY = "tripmap:located:v1";
/** Time to the first precise fix: GPS indoors (iOS above all) often needs 10 to 20 s. */
const PRECISE_TIMEOUT_MS = 30_000;
/** The quick network/Wi-Fi fix asked alongside it, so the dot shows while GPS warms up. */
const COARSE_TIMEOUT_MS = 20_000;
const COARSE_MAX_AGE_MS = 60_000;
const MAX_AGE_MS = 10_000;

function sessionMemory(): FixMemory {
  const attempt = <T>(run: () => T, fallback: T): T => {
    try {
      return run();
    } catch {
      return fallback;
    }
  };
  return {
    had: () => attempt(() => window.sessionStorage.getItem(SESSION_KEY) === "1", false),
    save: () => attempt(() => window.sessionStorage.setItem(SESSION_KEY, "1"), undefined),
    forget: () => attempt(() => window.sessionStorage.removeItem(SESSION_KEY), undefined),
  };
}

export function browserGeoEnv(): GeoEnv {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  const api = nav?.geolocation ?? null;
  const secure = typeof window !== "undefined" && window.isSecureContext !== false;
  const unavailable: GeoUnavailable | null = !secure ? "insecure" : api ? null : "unsupported";
  const trusted = typeof nav?.permissions?.query === "function" && trustsPermissionsApi(locateBrowser());
  return {
    geolocation: unavailable ? null : api,
    unavailable,
    permissions: trusted ? nav.permissions : null,
    document,
    now: () => performance.now(),
    session: sessionMemory(),
  };
}

/** The geolocation permission's status, or null where the Permissions API is missing or refuses the name. */
function queryPermission(permissions: GeoEnv["permissions"]): Promise<PermissionStatus | null> {
  if (!permissions) return Promise.resolve(null);
  try {
    return Promise.resolve(permissions.query({ name: "geolocation" })).catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}

/**
 * Drives the browser's geolocation from the store's locate mode: watchPosition only while a
 * watching mode is on and the page is visible. The store change that a tap makes starts the watch
 * synchronously, inside the tap. Until the first fix a quick low-accuracy fix is asked alongside
 * the precise watch (the dot shows sooner, then sharpens); "failed" comes only when both give up.
 * Errors after a fix keep the last dot. A refusal says whether a prompt was shown (see
 * INSTANT_DENIAL_MS); a failure whether any request found no position (code 2) or all timed out.
 * On load it only reads the permission: "granted" starts the silent dot, "denied" shows the blocked
 * button; without a usable Permissions API only a fix earlier in this session starts the silent dot.
 * Nothing prompts without a tap.
 */
export function startLocator(store: TripStoreApi, env: GeoEnv, onFailed: (problem: LocateProblem) => void): () => void {
  const geo = env.geolocation;
  if (!geo) return () => undefined;
  const actions = () => store.getState().actions;
  let watchId: number | null = null;
  let generation = 0;
  let fixed = false;
  let disposed = false;
  let permission: PermissionStatus | null = null;

  const stopWatch = () => {
    generation += 1;
    if (watchId != null) geo.clearWatch(watchId);
    watchId = null;
  };

  const startWatch = () => {
    stopWatch();
    const current = generation;
    const askedAt = env.now();
    const pending = new Set<"precise" | "coarse">(["precise"]);
    let noPosition = false;
    const onFix = (position: GeolocationPosition, precise: boolean) => {
      if (current !== generation || (!precise && fixed)) return;
      if (!fixed) env.session?.save();
      fixed = true;
      actions().receiveFix(toUserFix(position));
    };
    const onError = (error: GeolocationPositionError, request: "precise" | "coarse") => {
      if (current !== generation) return;
      if (error.code === PERMISSION_DENIED) {
        stopWatch();
        const instant = env.now() - askedAt < INSTANT_DENIAL_MS;
        actions().locate({ type: "denied", problem: instant ? "blocked" : "refused" });
        return;
      }
      if (error.code === POSITION_UNAVAILABLE) noPosition = true;
      pending.delete(request);
      if (fixed || pending.size > 0) return;
      stopWatch();
      const asked = store.getState().locate.follow;
      const problem = noPosition ? "off" : "timeout";
      actions().locate({ type: "failed", problem });
      if (asked) onFailed(problem);
    };
    watchId = geo.watchPosition(
      (position) => onFix(position, true),
      (error) => onError(error, "precise"),
      { enableHighAccuracy: true, timeout: PRECISE_TIMEOUT_MS, maximumAge: MAX_AGE_MS },
    );
    if (fixed) return;
    pending.add("coarse");
    geo.getCurrentPosition(
      (position) => onFix(position, false),
      (error) => onError(error, "coarse"),
      { enableHighAccuracy: false, timeout: COARSE_TIMEOUT_MS, maximumAge: COARSE_MAX_AGE_MS },
    );
  };

  const sync = () => {
    const on = isWatching(store.getState().locate.mode);
    if (!on) fixed = false;
    if (on && env.document.visibilityState !== "hidden") {
      if (watchId == null) startWatch();
    } else {
      stopWatch();
    }
  };

  const onPermission = () => {
    const state = permission?.state;
    if (state === "granted") actions().locate({ type: "granted" });
    else if (state === "denied") actions().locate({ type: "denied" });
    else actions().locate({ type: "reset" });
  };

  if (!env.permissions && env.session?.had()) actions().locate({ type: "granted" });
  void queryPermission(env.permissions).then((status) => {
    if (disposed || !status) return;
    permission = status;
    if (status.state !== "prompt") onPermission();
    if (typeof status.addEventListener === "function") status.addEventListener("change", onPermission);
  });

  const stopStore = store.subscribe((state, previous) => {
    const { mode } = state.locate;
    if (mode === previous.locate.mode) return;
    if (mode === "off" || mode === "denied") env.session?.forget();
    sync();
  });
  env.document.addEventListener("visibilitychange", sync);
  sync();

  return () => {
    disposed = true;
    stopStore();
    env.document.removeEventListener("visibilitychange", sync);
    if (typeof permission?.removeEventListener === "function") permission.removeEventListener("change", onPermission);
    stopWatch();
  };
}
