import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTripModel } from "../data/model";
import { planFromData } from "../data/types";
import { createTripStore, type TripStoreApi } from "../state/store";
import { makeTrip } from "../test/fixtures";
import { startLocator, type GeoEnv } from "./locator";

interface Watch {
  id: number;
  onFix: PositionCallback;
  onError: PositionErrorCallback;
  options: PositionOptions | undefined;
}

const position = (latitude = 11.9404, longitude = 108.4419, accuracy = 25) =>
  ({ coords: { latitude, longitude, accuracy, heading: null, speed: null }, timestamp: Date.now() }) as GeolocationPosition;
const positionError = (code: number): GeolocationPositionError => ({ code, message: "", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });

function fakeGeolocation() {
  const watches: Watch[] = [];
  const quick: Omit<Watch, "id">[] = [];
  const cleared: number[] = [];
  let next = 0;
  const geolocation = {
    watchPosition: vi.fn((onFix: PositionCallback, onError?: PositionErrorCallback | null, options?: PositionOptions) => {
      const id = ++next;
      watches.push({ id, onFix, onError: onError ?? (() => undefined), options });
      return id;
    }),
    clearWatch: vi.fn((id: number) => cleared.push(id)),
    getCurrentPosition: vi.fn((onFix: PositionCallback, onError?: PositionErrorCallback | null, options?: PositionOptions) => {
      quick.push({ onFix, onError: onError ?? (() => undefined), options });
    }),
  } satisfies Geolocation;
  const last = () => watches[watches.length - 1]!;
  const lastQuick = () => quick[quick.length - 1]!;
  const active = () => watches.filter((w) => !cleared.includes(w.id));
  const fix = (latitude?: number, longitude?: number, accuracy?: number) => last().onFix(position(latitude, longitude, accuracy));
  const fail = (code: number) => last().onError(positionError(code));
  const quickFix = (latitude?: number, longitude?: number, accuracy?: number) =>
    lastQuick().onFix(position(latitude, longitude, accuracy));
  const quickFail = (code: number) => lastQuick().onError(positionError(code));
  return { geolocation, watches, quick, active, fix, fail, quickFix, quickFail };
}

function fakePermission(state: PermissionState) {
  const target = new EventTarget() as PermissionStatus & { state: PermissionState };
  Object.defineProperty(target, "state", { value: state, writable: true });
  const set = (next: PermissionState) => {
    Object.defineProperty(target, "state", { value: next, writable: true });
    target.dispatchEvent(new Event("change"));
  };
  return { permissions: { query: vi.fn(() => Promise.resolve(target)) }, set };
}

function fakeDocument() {
  const doc = new EventTarget() as Document & { visibilityState: DocumentVisibilityState };
  const setVisible = (visible: boolean) => {
    Object.defineProperty(doc, "visibilityState", { value: visible ? "visible" : "hidden", configurable: true });
    doc.dispatchEvent(new Event("visibilitychange"));
  };
  Object.defineProperty(doc, "visibilityState", { value: "visible", configurable: true });
  return { doc, setVisible };
}

function setup({
  permission = "prompt",
  permissions,
}: { permission?: PermissionState | null; permissions?: GeoEnv["permissions"] } = {}) {
  const data = makeTrip();
  const store: TripStoreApi = createTripStore({
    city: data.city,
    langs: buildTripModel(data).langs,
    defaultLang: "en",
    plan: planFromData(data),
    phone: false,
    persistence: null,
  });
  const geo = fakeGeolocation();
  const perm = permission ? fakePermission(permission) : null;
  const { doc, setVisible } = fakeDocument();
  const env: GeoEnv = {
    geolocation: geo.geolocation,
    unavailable: null,
    permissions: permissions ?? perm?.permissions ?? null,
    document: doc,
  };
  const onFailed = vi.fn();
  const stop = startLocator(store, env, onFailed);
  const tap = () => store.getState().actions.locate({ type: "tap" });
  const mode = () => store.getState().locate.mode;
  return { store, geo, perm, setVisible, onFailed, stop, tap, mode };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("startLocator", () => {
  afterEach(() => vi.restoreAllMocks());

  it("never asks the browser on load while the permission is undecided", async () => {
    const { geo, mode } = setup({ permission: "prompt" });
    await settle();
    expect(geo.geolocation.watchPosition).not.toHaveBeenCalled();
    expect(mode()).toBe("off");
  });

  it("shows the dot silently on load when the permission is already granted", async () => {
    const { geo, store, mode } = setup({ permission: "granted" });
    await settle();
    expect(geo.geolocation.watchPosition).toHaveBeenCalledTimes(1);
    geo.fix();
    expect(mode()).toBe("showing");
    expect(store.getState().userFix).toMatchObject({ lat: 11.9404, lng: 108.4419, accuracy: 25 });
  });

  it("marks location blocked on load when the permission is denied, and a tap does not ask", async () => {
    const { geo, tap, mode } = setup({ permission: "denied" });
    await settle();
    expect(mode()).toBe("denied");
    tap();
    expect(geo.geolocation.watchPosition).not.toHaveBeenCalled();
  });

  it("works without the Permissions API: only a tap starts watching", async () => {
    const { geo, tap, mode } = setup({ permission: null });
    await settle();
    expect(geo.geolocation.watchPosition).not.toHaveBeenCalled();
    tap();
    expect(geo.geolocation.watchPosition).toHaveBeenCalledTimes(1);
    expect(geo.watches[0]!.options).toMatchObject({ enableHighAccuracy: true });
    geo.fix();
    expect(mode()).toBe("following");
  });

  it("starts the precise watch inside the tap, with a quick coarse fix alongside and a generous first-fix timeout", () => {
    const { geo, tap } = setup();
    tap();
    expect(geo.watches).toHaveLength(1);
    expect(geo.watches[0]!.options).toMatchObject({ enableHighAccuracy: true });
    expect(geo.watches[0]!.options!.timeout).toBeGreaterThanOrEqual(20_000);
    expect(geo.quick).toHaveLength(1);
    expect(geo.quick[0]!.options).toMatchObject({ enableHighAccuracy: false });
  });

  it("the quick coarse fix shows the dot while GPS warms up; the precise watch then takes over", () => {
    const { geo, tap, mode, store } = setup();
    tap();
    geo.quickFix(11.95, 108.45, 900);
    expect(mode()).toBe("following");
    expect(store.getState().userFix).toMatchObject({ accuracy: 900 });
    geo.fix(11.9404, 108.4419, 12);
    expect(store.getState().userFix).toMatchObject({ accuracy: 12 });
  });

  it("a late coarse fix never replaces a precise one", () => {
    const { geo, tap, store } = setup();
    tap();
    geo.fix(11.9404, 108.4419, 12);
    geo.quickFix(11.95, 108.45, 900);
    expect(store.getState().userFix).toMatchObject({ accuracy: 12 });
  });

  it("keeps locating while one request is still out (a slow first fix indoors)", () => {
    const { geo, tap, mode } = setup();
    tap();
    geo.quickFail(3);
    expect(mode()).toBe("locating");
    geo.fix();
    expect(mode()).toBe("following");
  });

  it("fails with a toast only when the precise watch and the coarse fix both give up", () => {
    const { geo, tap, mode, onFailed } = setup();
    tap();
    geo.fail(3);
    expect(mode()).toBe("locating");
    geo.quickFail(2);
    expect(mode()).toBe("failed");
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(geo.active()).toHaveLength(0);
  });

  it("a tap on failed asks again", () => {
    const { geo, tap, mode } = setup();
    tap();
    geo.fail(2);
    geo.quickFail(2);
    tap();
    expect(mode()).toBe("locating");
    expect(geo.active()).toHaveLength(1);
  });

  it("a failed silent start turns off quietly", async () => {
    const { geo, mode, onFailed } = setup({ permission: "granted" });
    await settle();
    geo.fail(3);
    geo.quickFail(3);
    expect(mode()).toBe("off");
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("a refusal on the coarse request blocks location too", () => {
    const { geo, tap, mode } = setup();
    tap();
    geo.quickFail(1);
    expect(mode()).toBe("denied");
    expect(geo.active()).toHaveLength(0);
  });

  it("survives a Permissions API that throws or rejects for geolocation: a tap still locates", async () => {
    for (const query of [
      () => {
        throw new TypeError("'geolocation' is not a valid PermissionName");
      },
      () => Promise.reject(new TypeError("unsupported")),
    ]) {
      const { geo, tap, mode, stop } = setup({ permissions: { query } as unknown as Pick<Permissions, "query"> });
      await settle();
      expect(mode()).toBe("off");
      tap();
      geo.fix();
      expect(mode()).toBe("following");
      stop();
    }
  });

  it("reads a permission status that cannot be listened to", async () => {
    const status = { state: "granted" } as PermissionStatus;
    const { geo, mode, stop } = setup({ permissions: { query: () => Promise.resolve(status) } });
    await settle();
    expect(mode()).toBe("locating");
    geo.fix();
    expect(mode()).toBe("showing");
    expect(stop).not.toThrow();
  });

  it("keeps the dot when the watch times out after a fix", () => {
    const { geo, tap, mode } = setup();
    tap();
    geo.fix();
    geo.fail(3);
    expect(mode()).toBe("following");
    expect(geo.watches).toHaveLength(1);
  });

  it("a refused prompt blocks location and stops watching", () => {
    const { geo, tap, mode, store } = setup();
    tap();
    geo.fail(1);
    expect(mode()).toBe("denied");
    expect(geo.active()).toHaveLength(0);
    expect(store.getState().userFix).toBeNull();
  });

  it("a permission reset in the browser settings turns the blocked button back to off", async () => {
    const { perm, mode } = setup({ permission: "denied" });
    await settle();
    perm!.set("prompt");
    expect(mode()).toBe("off");
  });

  it("stops watching while the page is hidden and resumes on return", () => {
    const { geo, tap, setVisible, mode } = setup();
    tap();
    geo.fix();
    setVisible(false);
    expect(geo.active()).toHaveLength(0);
    expect(mode()).toBe("following");
    setVisible(true);
    expect(geo.active()).toHaveLength(1);
  });

  it("turning location off clears the watch and forgets the position", () => {
    const { geo, tap, store } = setup();
    tap();
    geo.fix();
    tap();
    expect(store.getState().locate.mode).toBe("off");
    expect(geo.active()).toHaveLength(0);
    expect(store.getState().userFix).toBeNull();
  });

  it("ignores positions from a watch it already cleared", () => {
    const { geo, tap, store } = setup();
    tap();
    const first = geo.watches[0]!;
    tap();
    first.onFix({ coords: { latitude: 1, longitude: 2, accuracy: 5 } } as GeolocationPosition);
    expect(store.getState().userFix).toBeNull();
  });

  it("cleans up on stop", () => {
    const { geo, tap, stop } = setup();
    tap();
    stop();
    expect(geo.active()).toHaveLength(0);
  });
});
