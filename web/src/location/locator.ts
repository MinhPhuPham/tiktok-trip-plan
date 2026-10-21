import type { TripStoreApi } from "../state/store";
import { isWatching } from "./locateMachine";
import { toUserFix } from "./position";

/** Why the browser cannot give this page a position at all: no API, or an insecure (http) page. */
export type GeoUnavailable = "insecure" | "unsupported";

export interface GeoEnv {
  /** null where location cannot work; `unavailable` says why. */
  geolocation: Geolocation | null;
  unavailable: GeoUnavailable | null;
  permissions: Pick<Permissions, "query"> | null;
  document: Document;
}

const PERMISSION_DENIED = 1;
/** Time to the first precise fix: GPS indoors (iOS above all) often needs 10 to 20 s. */
const PRECISE_TIMEOUT_MS = 30_000;
/** The quick network/Wi-Fi fix asked alongside it, so the dot shows while GPS warms up. */
const COARSE_TIMEOUT_MS = 20_000;
const COARSE_MAX_AGE_MS = 60_000;
const MAX_AGE_MS = 10_000;

export function browserGeoEnv(): GeoEnv {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  const api = nav?.geolocation ?? null;
  const secure = typeof window !== "undefined" && window.isSecureContext !== false;
  const unavailable: GeoUnavailable | null = !secure ? "insecure" : api ? null : "unsupported";
  const permissions = typeof nav?.permissions?.query === "function" ? nav.permissions : null;
  return { geolocation: unavailable ? null : api, unavailable, permissions, document };
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
 * Errors after a fix keep the last dot. On load it only reads the permission: "granted" starts the
 * silent dot, "denied" shows the blocked button, and nothing ever prompts without a tap.
 */
export function startLocator(store: TripStoreApi, env: GeoEnv, onFailed: () => void): () => void {
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
    const pending = new Set<"precise" | "coarse">(["precise"]);
    const onFix = (position: GeolocationPosition, precise: boolean) => {
      if (current !== generation || (!precise && fixed)) return;
      fixed = true;
      actions().receiveFix(toUserFix(position));
    };
    const onError = (error: GeolocationPositionError, request: "precise" | "coarse") => {
      if (current !== generation) return;
      if (error.code === PERMISSION_DENIED) {
        stopWatch();
        actions().locate({ type: "denied" });
        return;
      }
      pending.delete(request);
      if (fixed || pending.size > 0) return;
      stopWatch();
      const asked = store.getState().locate.follow;
      actions().locate({ type: "failed" });
      if (asked) onFailed();
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

  void queryPermission(env.permissions).then((status) => {
    if (disposed || !status) return;
    permission = status;
    if (status.state !== "prompt") onPermission();
    if (typeof status.addEventListener === "function") status.addEventListener("change", onPermission);
  });

  const stopStore = store.subscribe((state, previous) => {
    if (state.locate.mode !== previous.locate.mode) sync();
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
