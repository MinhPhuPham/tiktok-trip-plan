import { makeDay, makeStop, makeTrip } from "../test/fixtures";
import { planFromData } from "../data/types";
import { prefsKey, tripKey, tripStorageId, watchTrip } from "./persist";
import { createTripStore, selectMapFocusDay, selectSheetOpen, type TripStoreInit } from "./store";

const trip = makeTrip();
const init = (patch: Partial<TripStoreInit> = {}): TripStoreInit => ({
  city: trip.city,
  langs: ["en", "vi"],
  defaultLang: "en",
  plan: planFromData(trip),
  phone: false,
  ...patch,
});

describe("trip store", () => {
  it("starts from the defaults", () => {
    const s = createTripStore(init({ phone: true })).getState();
    expect(s).toMatchObject({ lang: "en", tab: "plan", focusDay: 1, basemap: null, selected: null, editDay: null });
    expect(s.overlays).toEqual({ compass: false, nearby: true, routes: true });
    expect(createTripStore(init({ phone: false })).getState().overlays.compass).toBe(false);
  });

  it("persists preferences and hidden places under versioned keys", () => {
    const store = createTripStore(init());
    const { actions } = store.getState();
    actions.setLang("vi");
    actions.setLang("fr");
    actions.setOverlay("nearby", false);
    actions.setBasemap("osm");
    expect(actions.toggleHidden("a")).toBe(true);
    expect(JSON.parse(localStorage.getItem(prefsKey)!)).toEqual({
      v: 2,
      lang: "vi",
      basemap: "osm",
      overlays: { nearby: false },
      filtersOpen: false,
    });
    expect(JSON.parse(localStorage.getItem(tripKey(trip.city))!)).toEqual({ v: 2, hidden: ["a"] });
    const again = createTripStore(init()).getState();
    expect(again.lang).toBe("vi");
    expect(again.overlays.nearby).toBe(false);
    expect(again.hidden.has("a")).toBe(true);
  });

  it("reads the old app's keys once", () => {
    localStorage.setItem("tripmap:lang", "vi");
    localStorage.setItem("tripmap:ov-routes", "0");
    localStorage.setItem("tripmap:filters-open", "1");
    localStorage.setItem(`tripmap:${trip.city}:hidden`, JSON.stringify(["b", 3]));
    const s = createTripStore(init()).getState();
    expect(s.lang).toBe("vi");
    expect(s.overlays.routes).toBe(false);
    expect(s.filtersOpen).toBe(true);
    expect([...s.hidden]).toEqual(["b"]);
  });

  it("works without storage", () => {
    const store = createTripStore(init({ persistence: null }));
    store.getState().actions.setLang("vi");
    expect(localStorage.length).toBe(0);
  });

  it("focusing a day turns routes on, collapses the phone sheet and asks the map to fit it", () => {
    const store = createTripStore(init({ phone: true, persistence: null }));
    const { actions } = store.getState();
    actions.setOverlay("routes", false);
    actions.setSheet("full");
    actions.toggleFocusDay(1);
    expect(store.getState().focusDay).toBeNull();
    actions.toggleFocusDay(1);
    expect(store.getState()).toMatchObject({ focusDay: 1, sheet: "peek" });
    expect(store.getState().overlays.routes).toBe(true);
    expect(store.getState().mapIntent).toMatchObject({ type: "fitDay", day: 1 });
    actions.setSheet("full");
    actions.setFocusDay(null);
    expect(store.getState().sheet).toBe("full");
    actions.setFocusDay(1, { sheet: "half" });
    expect(store.getState()).toMatchObject({ focusDay: 1, sheet: "half" });
  });

  it("keeps the sheet detent: the handle reopens at the last open detent, a card or a new viewport collapses it", () => {
    const store = createTripStore(init({ phone: true, persistence: null }));
    const { actions } = store.getState();
    expect(store.getState()).toMatchObject({ sheet: "peek", sheetReopen: "half" });
    expect(selectSheetOpen(store.getState())).toBe(false);
    actions.toggleSheet();
    expect(store.getState().sheet).toBe("half");
    actions.setSheet("full");
    actions.toggleSheet();
    expect(store.getState()).toMatchObject({ sheet: "peek", sheetReopen: "full" });
    actions.toggleSheet();
    expect(store.getState().sheet).toBe("full");
    expect(selectSheetOpen(store.getState())).toBe(true);
    actions.openCard("a");
    expect(store.getState().sheet).toBe("peek");
    actions.setSheet("half");
    actions.setPhone(false);
    expect(store.getState().sheet).toBe("peek");
  });

  it("leaves the sheet alone on desktop", () => {
    const store = createTripStore(init({ phone: false, persistence: null }));
    store.getState().actions.setFocusDay(1, { sheet: "half" });
    store.getState().actions.openCard("a");
    expect(store.getState().sheet).toBe("peek");
  });

  it("starts with nothing focused without a plan and remembers the day the editor opened at", () => {
    const store = createTripStore(init({ plan: { days: [], unplaced: [], edited: false }, persistence: null }));
    const { actions } = store.getState();
    expect(store.getState().focusDay).toBeNull();
    actions.setEditing(true, 2);
    expect(store.getState()).toMatchObject({ editing: true, editDay: 2 });
    actions.setEditing(false);
    expect(store.getState()).toMatchObject({ editing: false, editDay: 2 });
    actions.setEditing(true);
    expect(store.getState().editDay).toBeNull();
  });

  it("opens cards with or without flying", () => {
    const store = createTripStore(init({ persistence: null }));
    const { actions } = store.getState();
    actions.openCard("a");
    const first = store.getState().mapIntent;
    expect(first).toMatchObject({ type: "fly", id: "a" });
    actions.openCard("b", { fly: false });
    expect(store.getState()).toMatchObject({ selected: "b", mapIntent: first });
    actions.closeCard();
    expect(store.getState().selected).toBeNull();
  });

  it("focuses the map on the open day only while the Plan tab shows, keeping the day across tabs", () => {
    const store = createTripStore(init({ persistence: null }));
    const { actions } = store.getState();
    actions.setHovered("a");
    actions.setTab("places");
    expect(store.getState()).toMatchObject({ focusDay: 1, hovered: null });
    expect(selectMapFocusDay(store.getState())).toBeNull();
    actions.setTab("plan");
    expect(selectMapFocusDay(store.getState())).toBe(1);
    actions.setFocusDay(null);
    expect(selectMapFocusDay(store.getState())).toBeNull();
  });

  it("records the hovered row and notifies only on a change", () => {
    const store = createTripStore(init({ persistence: null }));
    const seen: (string | null)[] = [];
    store.subscribe((s) => seen.push(s.hovered));
    const { actions } = store.getState();
    actions.setHovered("a");
    actions.setHovered("a");
    actions.setHovered(null);
    expect(seen).toEqual(["a", null]);
  });

  it("toggles filter sets immutably and resets them", () => {
    const store = createTripStore(init({ persistence: null }));
    const { actions } = store.getState();
    const before = store.getState().filters;
    actions.toggleFilter("sectors", "N");
    actions.toggleFilter("tags", "local");
    actions.toggleFilter("tags", "local");
    expect(before.sectors.size).toBe(0);
    expect([...store.getState().filters.sectors]).toEqual(["N"]);
    expect(store.getState().filters.tags.size).toBe(0);
    actions.resetFilters();
    expect(store.getState().filters.sectors.size).toBe(0);
  });

  it("replaces the plan and drops a focus on a removed day", () => {
    const store = createTripStore(init({ persistence: null }));
    const { actions } = store.getState();
    actions.setFocusDay(1);
    actions.setPlan([makeDay(2, [makeStop("place", "b")])]);
    expect(store.getState().plan).toMatchObject({ edited: true, unplaced: trip.unplaced });
    expect(store.getState().focusDay).toBeNull();
    actions.resetPlan();
    expect(store.getState().plan.edited).toBe(false);
  });

  it("numbers toasts and picks a longer duration for actions", () => {
    const store = createTripStore(init({ persistence: null }));
    const { actions } = store.getState();
    actions.showToast("Hidden");
    actions.showToast("Hidden", { action: { label: "Undo", run: () => undefined } });
    expect(store.getState().toast).toMatchObject({ id: 2, durationMs: 8000 });
    actions.hideToast(1);
    expect(store.getState().toast?.id).toBe(2);
    actions.hideToast(2);
    expect(store.getState().toast).toBeNull();
  });

  it("drops stored hidden ids of places the trip no longer has", () => {
    localStorage.setItem(tripKey(tripStorageId(trip)), JSON.stringify({ v: 2, hidden: ["a", "gone"] }));
    const store = createTripStore(init({ isPlace: (id) => id !== "gone" }));
    expect([...store.getState().hidden]).toEqual(["a"]);
  });

  it("follows hidden places changed in another tab", () => {
    const store = createTripStore(init({ isPlace: (id) => id !== "gone" }));
    const stop = watchTrip(tripStorageId(trip), (stored) => store.getState().actions.replaceHidden(stored.hidden));
    const key = tripKey(tripStorageId(trip));
    const value = JSON.stringify({ v: 2, hidden: ["b", "gone"] });
    localStorage.setItem(key, value);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
    expect([...store.getState().hidden]).toEqual(["b"]);
    stop();
  });

  it("keys a trip without a city as trip", () => {
    expect(tripStorageId({ city: "" })).toBe("trip");
    expect(tripStorageId({ city: "Huế" })).toBe("Huế");
  });
});
