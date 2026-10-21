import { createStore, type StoreApi } from "zustand/vanilla";
import type { Plan, PlanDay, PlanUnplaced } from "../data/types";
import type { OpenDetent, SheetDetent } from "../lib/sheetSnap";
import { isWatching, LOCATE_OFF, locateStep, type LocateEvent, type LocateState } from "../location/locateMachine";
import type { UserFix } from "../location/position";
import * as storedState from "./persist";
import type { OverlayKey, Overlays, StoredPrefs, StoredTrip } from "./persist";

export type { OverlayKey, Overlays } from "./persist";

export type Tab = "plan" | "places";
export type FilterSetKey = "priorities" | "categories" | "intents";
/** "all", "none" (not planned) or a day number as text. */
export type DayFilter = string;

export interface Filters {
  q: string;
  day: DayFilter;
  /** Priority levels; "none" for unrated places. */
  priorities: ReadonlySet<string>;
  categories: ReadonlySet<string>;
  /** "Good for" intent ids (data/intents.ts); a place fits when it fits any of them. */
  intents: ReadonlySet<string>;
}

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  message: string;
  action: ToastAction | null;
  durationMs: number;
}

export interface ToastOptions {
  action?: ToastAction;
  durationMs?: number;
}

/** A camera move the map performs once; `seq` makes a repeated request distinct. */
export type MapIntent = { seq: number } & (
  | { type: "fly"; id: string }
  | { type: "fitDay"; day: number }
  | { type: "fitAll"; animate: boolean }
);
export type MapIntentRequest = MapIntent extends infer I ? (I extends MapIntent ? Omit<I, "seq"> : never) : never;

export interface OpenCardOptions {
  /** Fly the map to the target (default true; false when the click came from its own marker). */
  fly?: boolean;
}

export interface FocusDayOptions {
  /** Where the phone sheet goes when a day opens: peek by default so the map shows, half from the day list. */
  sheet?: SheetDetent;
}

export interface TripActions {
  setLang: (lang: string) => void;
  /** Switching tabs ends a row hover; `focusDay` (the open Plan day) stays. */
  setTab: (tab: Tab) => void;
  setPhone: (phone: boolean) => void;
  setSheet: (detent: SheetDetent) => void;
  /** The handle: a collapsed sheet reopens at its last open detent, an open one collapses. */
  toggleSheet: () => void;
  /** Focus one day on the map (routes overlay turns on) or show all days with null. */
  setFocusDay: (day: number | null, options?: FocusDayOptions) => void;
  /** A Plan tab day header: focus (open) the day, or show all days when it already is. */
  toggleFocusDay: (day: number, options?: FocusDayOptions) => void;
  setBasemap: (id: string) => void;
  /** Set by the map: the basemap actually drawn (after fallbacks), "google" included. */
  setActiveBasemap: (id: string | null) => void;
  setOverlay: (key: OverlayKey, on: boolean) => void;
  setLayersOpen: (open: boolean) => void;
  setQuery: (q: string) => void;
  setDayFilter: (day: DayFilter) => void;
  toggleFilter: (key: FilterSetKey, value: string) => void;
  clearFilter: (key: FilterSetKey) => void;
  /** A single choice (the priority and category menus); null clears the set. */
  chooseFilter: (key: FilterSetKey, value: string | null) => void;
  resetFilters: () => void;
  setHidden: (id: string, hidden: boolean) => void;
  /** Returns true when the place is now hidden. */
  toggleHidden: (id: string) => boolean;
  setShowHidden: (show: boolean) => void;
  /** Hidden places as another tab stored them (unknown ids dropped). */
  replaceHidden: (ids: Iterable<string>) => void;
  /** The list row under the mouse or keyboard focus (place or nearby spot id), or null. */
  setHovered: (id: string | null) => void;
  openCard: (id: string, options?: OpenCardOptions) => void;
  closeCard: () => void;
  /** Opens or closes the plan editor; `day` is the plan day it should start at. */
  setEditing: (open: boolean, day?: number) => void;
  /** The plan editor's result replaces the shown plan. */
  setPlan: (days: PlanDay[], unplaced?: PlanUnplaced[]) => void;
  resetPlan: () => void;
  requestMap: (intent: MapIntentRequest) => void;
  showToast: (message: string, options?: ToastOptions) => void;
  /** Hides the toast; with an id, only while that toast is the one shown (an old timer is a no-op). */
  hideToast: (id?: number) => void;
  setStatus: (message: string | null) => void;
  setOnline: (online: boolean) => void;
  /** Steps the "My location" state machine; leaving the watching modes forgets the position. */
  locate: (event: LocateEvent) => void;
  /** A position from the browser: the dot moves (and the first fix ends "locating"). */
  receiveFix: (fix: UserFix) => void;
}

export interface TripState {
  lang: string;
  tab: Tab;
  /** max-width 760px: the panel is a bottom sheet. */
  phone: boolean;
  /** Phone sheet detent. */
  sheet: SheetDetent;
  /** The detent the handle reopens the collapsed sheet at: the last one the sheet rested at. */
  sheetReopen: OpenDetent;
  /** The day shown alone on the map and open in the Plan tab; starts at today's trip day, else the first day. */
  focusDay: number | null;
  /** The chosen basemap id; null until the user picks one (the map uses data.default_basemap). */
  basemap: string | null;
  activeBasemap: string | null;
  overlays: Overlays;
  layersOpen: boolean;
  filters: Filters;
  hidden: ReadonlySet<string>;
  showHidden: boolean;
  /** Place, nearby spot or "center" whose card is open. */
  selected: string | null;
  /** Place or nearby spot whose list row is hovered or keyboard-focused; the map highlights it. */
  hovered: string | null;
  editing: boolean;
  /** The day the editor was last opened at (null: the whole plan); kept after close to return focus. */
  editDay: number | null;
  plan: Plan;
  mapIntent: MapIntent | null;
  toast: Toast | null;
  /** Transient map status ("Loading Google Maps…"), shown in the status pill. */
  status: string | null;
  online: boolean;
  locate: LocateState;
  /** The device's position while "My location" is on; memory only, never persisted. */
  userFix: UserFix | null;
  actions: TripActions;
}

export type TripStoreApi = StoreApi<TripState>;

/** The day the map focuses: the open Plan tab day, none while the Places tab shows (focusDay itself stays). */
export const selectSheetOpen = (s: TripState): boolean => s.sheet !== "peek";

export const selectMapFocusDay = (s: TripState): number | null => (s.tab === "plan" ? s.focusDay : null);

/** The plan days whose routes the map draws: one day (with its stop chips), every day, or none. */
export type RouteDays = number | "all" | "none";

/**
 * Plan tab: the open day, else every day. Places tab: its day filter ("Not planned" draws no route);
 * there the pins already follow the filters, so nothing is dimmed the way the Plan focus dims.
 */
export function selectRouteDays(s: TripState): RouteDays {
  if (s.tab === "plan") return s.focusDay ?? "all";
  const { day } = s.filters;
  if (day === "none") return "none";
  const number = Number(day);
  return day !== "all" && Number.isInteger(number) ? number : "all";
}

export interface Persistence {
  loadPrefs(): StoredPrefs;
  loadTrip(id: string): StoredTrip;
  savePrefs(prefs: StoredPrefs): void;
  saveTrip(id: string, trip: StoredTrip): void;
  watchTrip?(id: string, onChange: (trip: StoredTrip) => void): () => void;
}

export const browserPersistence: Persistence = storedState;

export interface TripStoreInit {
  city: string;
  /** Whether a stored hidden id is still a place of this trip (ids of removed places are dropped). */
  isPlace?: (id: string) => boolean;
  langs: readonly string[];
  defaultLang: string;
  plan: Plan;
  /** The Plan day open at first when the plan has it (today's on a dated trip); else the first day. */
  openDay?: number | null;
  phone: boolean;
  online?: boolean;
  persistence?: Persistence | null;
}

const DEFAULT_TOAST_MS = 6000;
const ACTION_TOAST_MS = 8000;

const emptyFilters = (): Filters => ({
  q: "",
  day: "all",
  priorities: new Set(),
  categories: new Set(),
  intents: new Set(),
});

function toggled(set: ReadonlySet<string>, value: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(value)) next.add(value);
  return next;
}

export function createTripStore(init: TripStoreInit): TripStoreApi {
  const persistence = init.persistence === undefined ? browserPersistence : init.persistence;
  const prefs = persistence?.loadPrefs();
  const storageId = storedState.tripStorageId(init);
  const trip = persistence?.loadTrip(storageId);
  const knownIds = (ids: Iterable<string>): Set<string> =>
    new Set(init.isPlace ? [...ids].filter(init.isPlace) : ids);
  const lang = prefs?.lang && init.langs.includes(prefs.lang) ? prefs.lang : init.defaultLang;
  let toastId = 0;
  let intentSeq = 0;
  /** Only overlays the user switched are remembered; focusing a day turns routes on for now only. */
  let overlayChoices: Partial<Record<OverlayKey, boolean>> = { ...prefs?.overlays };

  const store = createStore<TripState>()((set, get) => {
    const sheetAt = (sheet: SheetDetent): Partial<TripState> =>
      sheet === "peek" ? { sheet } : { sheet, sheetReopen: sheet };
    const sheetOnPhone = (sheet: SheetDetent): Partial<TripState> => (get().phone ? sheetAt(sheet) : {});
    const mapIntent = (request: MapIntentRequest): MapIntent => ({ ...request, seq: ++intentSeq });
    const focusDay = (day: number | null, options?: FocusDayOptions): void =>
      set((s) => ({
        focusDay: day,
        overlays: day != null && !s.overlays.routes ? { ...s.overlays, routes: true } : s.overlays,
        ...(day != null
          ? {
              ...sheetOnPhone(options?.sheet ?? "peek"),
              mapIntent: mapIntent({ type: "fitDay", day }),
            }
          : s.focusDay != null
            ? { mapIntent: mapIntent({ type: "fitAll", animate: true }) }
            : {}),
      }));
    const setFilters = (patch: (f: Filters) => Partial<Filters>): void =>
      set((s) => ({ filters: { ...s.filters, ...patch(s.filters) } }));
    const setHidden = (id: string, hidden: boolean): void =>
      set((s) => {
        if (s.hidden.has(id) === hidden) return {};
        const next = new Set(s.hidden);
        if (hidden) next.add(id);
        else next.delete(id);
        return { hidden: next };
      });

    const actions: TripActions = {
      setLang: (next) => {
        if (init.langs.includes(next)) set({ lang: next });
      },
      setTab: (tab) => set({ tab, hovered: null }),
      setPhone: (phone) => set({ phone, sheet: "peek" }),
      setSheet: (sheet) => set(sheetAt(sheet)),
      toggleSheet: () => set((s) => sheetAt(s.sheet === "peek" ? s.sheetReopen : "peek")),
      setFocusDay: focusDay,
      toggleFocusDay: (day, options) => focusDay(get().focusDay === day ? null : day, options),
      setBasemap: (id) => set({ basemap: id }),
      setActiveBasemap: (id) => set({ activeBasemap: id }),
      setOverlay: (key, on) => {
        overlayChoices = { ...overlayChoices, [key]: on };
        set((s) => ({ overlays: { ...s.overlays, [key]: on } }));
      },
      setLayersOpen: (open) => set({ layersOpen: open }),
      setQuery: (q) => setFilters(() => ({ q })),
      setDayFilter: (day) => setFilters(() => ({ day })),
      toggleFilter: (key, value) => setFilters((f) => ({ [key]: toggled(f[key], value) })),
      clearFilter: (key) => setFilters(() => ({ [key]: new Set<string>() })),
      chooseFilter: (key, value) => setFilters(() => ({ [key]: new Set(value == null ? [] : [value]) })),
      resetFilters: () => set({ filters: emptyFilters() }),
      setHidden,
      toggleHidden: (id) => {
        const hiding = !get().hidden.has(id);
        setHidden(id, hiding);
        return hiding;
      },
      setShowHidden: (show) => set({ showHidden: show }),
      replaceHidden: (ids) =>
        set((s) => {
          const next = knownIds(ids);
          const same = next.size === s.hidden.size && [...next].every((id) => s.hidden.has(id));
          return same ? {} : { hidden: next };
        }),
      setHovered: (id) => {
        if (get().hovered !== id) set({ hovered: id });
      },
      openCard: (id, options) =>
        set({
          selected: id,
          ...sheetOnPhone("peek"),
          ...(options?.fly === false ? {} : { mapIntent: mapIntent({ type: "fly", id }) }),
        }),
      closeCard: () => set({ selected: null }),
      setEditing: (open, day) => set(open ? { editing: true, editDay: day ?? null } : { editing: false }),
      setPlan: (days, unplaced) =>
        set((s) => ({
          plan: { days, unplaced: unplaced ?? s.plan.unplaced, edited: true },
          focusDay: s.focusDay != null && days.some((d) => d.day === s.focusDay) ? s.focusDay : null,
        })),
      resetPlan: () =>
        set((s) => ({
          plan: init.plan,
          focusDay: s.focusDay != null && init.plan.days.some((d) => d.day === s.focusDay) ? s.focusDay : null,
        })),
      requestMap: (request) => set({ mapIntent: mapIntent(request) }),
      showToast: (message, options) =>
        set({
          toast: {
            id: ++toastId,
            message,
            action: options?.action ?? null,
            durationMs: options?.durationMs ?? (options?.action ? ACTION_TOAST_MS : DEFAULT_TOAST_MS),
          },
        }),
      hideToast: (id) => set((s) => (id == null || s.toast?.id === id ? { toast: null } : {})),
      setStatus: (message) => set({ status: message }),
      setOnline: (online) => set({ online }),
      locate: (event) =>
        set((s) => {
          const locate = locateStep(s.locate, event);
          if (locate === s.locate) return {};
          return isWatching(locate.mode) ? { locate } : { locate, userFix: null };
        }),
      receiveFix: (fix) =>
        set((s) => (isWatching(s.locate.mode) ? { userFix: fix, locate: locateStep(s.locate, { type: "fix" }) } : {})),
    };

    return {
      lang,
      tab: "plan",
      phone: init.phone,
      sheet: "peek",
      sheetReopen: "half",
      focusDay: init.plan.days.find((d) => d.day === init.openDay)?.day ?? init.plan.days[0]?.day ?? null,
      basemap: prefs?.basemap ?? null,
      activeBasemap: null,
      overlays: {
        compass: prefs?.overlays.compass ?? false,
        nearby: prefs?.overlays.nearby ?? true,
        routes: prefs?.overlays.routes ?? true,
      },
      layersOpen: false,
      filters: emptyFilters(),
      hidden: knownIds(trip?.hidden ?? []),
      showHidden: false,
      selected: null,
      hovered: null,
      editing: false,
      editDay: null,
      plan: init.plan,
      mapIntent: null,
      toast: null,
      status: null,
      online: init.online ?? true,
      locate: LOCATE_OFF,
      userFix: null,
      actions,
    };
  });

  if (persistence) {
    store.subscribe((state, previous) => {
      const prefsChanged =
        state.lang !== previous.lang ||
        state.basemap !== previous.basemap ||
        state.overlays !== previous.overlays;
      if (prefsChanged) {
        persistence.savePrefs({ lang: state.lang, basemap: state.basemap, overlays: overlayChoices });
      }
      if (state.hidden !== previous.hidden) persistence.saveTrip(storageId, { hidden: [...state.hidden] });
    });
  }
  return store;
}
