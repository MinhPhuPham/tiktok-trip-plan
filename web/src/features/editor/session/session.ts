import { createStore, type StoreApi } from "zustand/vanilla";
import type { TripModel } from "../../../data/model";
import { REST_REF, type PlanDay, type PlanStop, type PlanUnplaced } from "../../../data/types";
import { getTranslator } from "../../../i18n/useT";
import { tripStorageId } from "../../../state/persist";
import type { TripState, TripStoreApi } from "../../../state/store";
import { MAX_DAYS } from "../logic/constants";
import { buildContext, slotById, type EditorContext } from "../logic/context";
import { computePlan } from "../logic/coverage";
import { errorsText } from "../logic/issues";
import { insertIndex, pickSlot } from "../logic/placement";
import { editableDays, toPlanJson, type EditableStop } from "../logic/planJson";
import type { ComputedPlan, PlanJson, TimedStop, UnplacedEntry } from "../logic/types";
import { editorText, restName, slotName, unplacedNote, type EditorText } from "../text";
import {
  DRAFT_VERSION,
  draftBasis,
  readDraft,
  removeDraft,
  writeDraft,
  type StoredDraft,
  type UnplacedNote,
  type UnplacedNotes,
} from "./draftStorage";

export interface DraftStop extends EditableStop {
  uid: string;
}

export interface DraftDay {
  stops: readonly DraftStop[];
}

export type Days = readonly DraftDay[];
export type FocusTarget = { uid: string; part?: "main" | "slot" | "up" | "down" } | { key: string };

interface Snapshot {
  days: Days;
  unplaced: UnplacedNotes;
  expanded: ReadonlySet<string>;
}

export type PickerTab = "places" | "nearby";
export type PriorityFilter = "all" | "must" | "high";

export interface PickerState {
  open: boolean;
  day: number;
  tab: PickerTab;
  query: string;
  priority: PriorityFilter;
  category: string;
  tag: string;
  unplannedOnly: boolean;
}

export interface SessionState {
  days: Days;
  /** Why each place is out of the plan, by ref (entries for planned places are ignored). */
  unplaced: UnplacedNotes;
  expanded: ReadonlySet<string>;
  /** The snapshot last written to this browser (every edit autosaves). */
  savedSnapshot: string;
  saveError: boolean;
  /** A draft made from an older generated plan; autosave waits until the user restores or discards it. */
  staleDraft: StoredDraft | null;
  /** The last destructive edit, while it can be undone; `toast` is the id of its Undo toast. */
  undo: { snap: Snapshot; focus: FocusTarget; toast: number | null } | null;
  /**
   * A focus request the editor carries out once after rendering (`data-fk` key); opening the editor
   * asks for the heading of the day it was opened at (`day:<index>`), else for Done.
   */
  focus: { key: string; seq: number } | null;
  /** The polite live region's next message. */
  live: { text: string; seq: number };
  picker: PickerState;
}

export interface LeftOut {
  ref: string;
  code: string | null;
  reason: string;
}

export interface Derived {
  computed: ComputedPlan;
  leftOut: LeftOut[];
  snapshot: string;
}

export interface SessionActions {
  toggle: (uid: string) => void;
  moveBy: (uid: string, delta: -1 | 1, part?: "main" | "up" | "down") => void;
  moveToDay: (uid: string, day: number, position?: number) => void;
  dropOnStop: (uid: string, targetUid: string, after: boolean) => void;
  dropIntoDay: (uid: string, day: number) => void;
  removeStop: (uid: string) => void;
  addOrMove: (day: number, ref: string) => void;
  addRest: (day: number) => void;
  addLeftOut: (day: number, ref: string) => void;
  addDay: () => void;
  removeDay: (day: number) => void;
  setSlot: (uid: string, slot: string | null) => void;
  /** Sets the stop's note in the current language (the input keeps the text until blur or Enter). */
  commitNote: (uid: string, value: string) => void;
  undo: () => void;
  reset: () => void;
  restoreDraft: () => void;
  discardDraft: () => void;
  openPicker: (day: number) => void;
  closePicker: () => void;
  setPicker: (patch: Partial<Omit<PickerState, "open">>) => void;
  announce: (text: string) => void;
  close: () => void;
}

export interface EditorSession {
  model: TripModel;
  ctx: EditorContext;
  store: StoreApi<SessionState>;
  actions: SessionActions;
  derive: (state: Pick<SessionState, "days" | "unplaced">) => Derived;
  /** plan.json for data/plan/plan.json, as `route --collect` reads it. */
  planJson: () => PlanJson;
  isDirty: () => boolean;
}

const ANNOUNCE_BATCH_MS = 150;

/** The editor's first focus: the heading of the plan day it was opened at, else Done. */
function openingFocusKey(trip: TripState): string {
  const index = trip.editDay == null ? -1 : trip.plan.days.findIndex((d) => d.day === trip.editDay);
  return index >= 0 ? `day:${index}` : "done";
}

const focusKey = (target: FocusTarget): string =>
  "uid" in target ? `${target.part ?? "main"}:${target.uid}` : target.key;

const stripUids = (days: Days): { stops: EditableStop[] }[] =>
  days.map((d) => ({ stops: d.stops.map(({ ref, slot, reason, reason_vi }) => ({ ref, slot, reason, reason_vi })) }));

interface Located {
  d: number;
  i: number;
  stop: DraftStop;
}

function locate(days: Days, uid: string): Located | null {
  for (let d = 0; d < days.length; d++) {
    const stops = days[d]?.stops ?? [];
    const i = stops.findIndex((s) => s.uid === uid);
    const stop = stops[i];
    if (stop) return { d, i, stop };
  }
  return null;
}

const withDay = (days: Days, d: number, stops: readonly DraftStop[]): Days =>
  days.map((day, k) => (k === d ? { stops } : day));

const without = (days: Days, at: Located): Days =>
  withDay(days, at.d, (days[at.d]?.stops ?? []).filter((_, i) => i !== at.i));

function insertAt(days: Days, d: number, index: number, stop: DraftStop): Days {
  const stops = [...(days[d]?.stops ?? [])];
  stops.splice(Math.min(index, stops.length), 0, stop);
  return withDay(days, d, stops);
}

function toPlanStop(stop: TimedStop): PlanStop {
  return {
    kind: stop.kind,
    ref: stop.ref,
    slot: stop.slot,
    arrive: stop.arrive,
    depart: stop.depart,
    arrive_min: stop.arrive_min,
    depart_min: stop.depart_min,
    travel_min_to_next: stop.travel_min_to_next,
    reason: stop.reason ?? "",
    reason_vi: stop.reason_vi ?? "",
    ...(stop.lat != null && stop.lng != null ? { lat: stop.lat, lng: stop.lng } : {}),
  };
}

function originalUnplaced(model: TripModel): Record<string, UnplacedNote> {
  const out: Record<string, UnplacedNote> = {};
  for (const u of model.data.unplaced) {
    if (u.ref) out[u.ref] = { code: u.code || null, reason: u.reason || "" };
  }
  return out;
}

/** Version 1 drafts kept only a free-text reason per left-out place. */
function draftUnplaced(model: TripModel, draft: StoredDraft): UnplacedNotes {
  const original = originalUnplaced(model);
  if (draft.unplaced) return { ...original, ...draft.unplaced };
  const merged = { ...original };
  for (const [ref, text] of Object.entries(draft.reasons ?? {})) {
    if (original[ref]?.reason !== text) merged[ref] = { code: "other", reason: text || "" };
  }
  return merged;
}

const sessions = new WeakMap<TripModel, EditorSession>();

/** One editing session per loaded trip: it outlives the editor panel so closing it keeps the draft. */
export function getEditorSession(model: TripModel, tripStore: TripStoreApi): EditorSession {
  let session = sessions.get(model);
  if (!session) sessions.set(model, (session = createEditorSession(model, tripStore)));
  return session;
}

export function createEditorSession(model: TripModel, tripStore: TripStoreApi): EditorSession {
  const data = model.data;
  const city = tripStorageId(data);
  const ctx = buildContext(data);
  const baseline = editableDays(data.days);
  const basis = draftBasis(data);
  let seq = 0;
  let focusSeq = 0;
  let liveSeq = 0;
  let announceParts: string[] = [];
  let announceTimer = 0;

  const withUids = (days: readonly { stops: readonly EditableStop[] }[]): Days =>
    days.map((d) => ({ stops: d.stops.map((s) => ({ uid: `s${++seq}`, ...s })) }));

  const cache = new WeakMap<Days, WeakMap<UnplacedNotes, Derived>>();
  const derive = ({ days, unplaced }: Pick<SessionState, "days" | "unplaced">): Derived => {
    let byNotes = cache.get(days);
    if (!byNotes) cache.set(days, (byNotes = new WeakMap()));
    let derived = byNotes.get(unplaced);
    if (!derived) {
      const plain = stripUids(days);
      const used = new Set(days.flatMap((d) => d.stops.map((s) => s.ref)));
      const leftOut = ctx.places
        .filter((p) => !used.has(p.id))
        .map((p) => ({ ref: p.id, ...(unplaced[p.id] ?? { code: "other", reason: "" }) }));
      derived = {
        computed: computePlan(ctx, plain, leftOut satisfies UnplacedEntry[]),
        leftOut,
        snapshot: JSON.stringify({ days: plain, unplaced }),
      };
      byNotes.set(unplaced, derived);
    }
    return derived;
  };

  const initial = { days: withUids(baseline), unplaced: originalUnplaced(model) as UnplacedNotes };
  const baselineSnapshot = derive(initial).snapshot;
  const draft = readDraft(city);
  const applied = draft && draft.basis === basis ? { days: withUids(draft.days), unplaced: draftUnplaced(model, draft) } : null;
  const start = applied ?? initial;

  const store = createStore<SessionState>()(() => ({
    ...start,
    expanded: new Set<string>(),
    savedSnapshot: derive(start).snapshot,
    saveError: false,
    staleDraft: draft && !applied ? draft : null,
    undo: null,
    focus: tripStore.getState().editing ? { key: openingFocusKey(tripStore.getState()), seq: ++focusSeq } : null,
    live: { text: "", seq: 0 },
    picker: {
      open: false,
      day: 0,
      tab: "places",
      query: "",
      priority: "all",
      category: "",
      tag: "",
      unplannedOnly: true,
    },
  }));
  const get = store.getState;
  const set = store.setState;
  const text = (): EditorText => editorText(getTranslator(model, tripStore.getState().lang));
  const tripActions = () => tripStore.getState().actions;

  const stopLabel = (stop: EditableStop): string =>
    stop.ref === REST_REF ? restName(model, getTranslator(model, tripStore.getState().lang)) : (ctx.nodes.get(stop.ref)?.name ?? stop.ref);

  const emitChange = (): void => {
    persist();
    const state = get();
    const { computed, leftOut, snapshot } = derive(state);
    if (snapshot === baselineSnapshot) {
      tripActions().resetPlan();
      return;
    }
    const days: PlanDay[] = computed.days.map((d) => ({ day: d.day, stops: d.stops.map(toPlanStop) }));
    const langs = Object.keys(data.labels);
    const unplaced: PlanUnplaced[] = leftOut.map((u) => ({
      ref: u.ref,
      name: ctx.nodes.get(u.ref)?.name ?? u.ref,
      code: u.code,
      reason: u.reason,
      reason_text: Object.fromEntries(langs.map((l) => [l, unplacedNote(model, u.code, u.reason, l)])),
    }));
    tripActions().setPlan(days, unplaced);
  };

  const announce = (message: string): void => {
    if (!message) return;
    announceParts.push(message);
    window.clearTimeout(announceTimer);
    announceTimer = window.setTimeout(() => {
      const joined = announceParts.join(" ");
      announceParts = [];
      set({ live: { text: joined, seq: ++liveSeq } });
    }, ANNOUNCE_BATCH_MS);
  };

  /** Autosave: the edited plan goes to this browser's draft, the generated one clears it. */
  const persist = (): void => {
    const state = get();
    const { snapshot } = derive(state);
    if (state.staleDraft || snapshot === state.savedSnapshot) return;
    let ok = true;
    if (snapshot === baselineSnapshot) removeDraft(city);
    else {
      ok = writeDraft(city, {
        v: DRAFT_VERSION,
        basis,
        savedAt: new Date().toISOString(),
        days: stripUids(state.days),
        unplaced: state.unplaced,
      });
    }
    if (!ok && !state.saveError) announce(text().t("save_failed"));
    set(ok ? { saveError: false, savedSnapshot: snapshot } : { saveError: true });
  };

  const requestFocus = (target: FocusTarget | null): Partial<SessionState> =>
    target ? { focus: { key: focusKey(target), seq: ++focusSeq } } : {};

  interface Digest {
    ends: (number | null)[];
    summary: string;
  }
  const digest = (): Digest => {
    const { computed } = derive(get());
    return {
      ends: computed.days.map((d) => d.stops[d.stops.length - 1]?.arrive_min ?? null),
      summary: errorsText(text().t, computed.issues),
    };
  };

  /** What a screen reader user cannot see change: day end times and the problems to fix. */
  const changesBetween = (before: Digest, after: Digest): string[] => {
    const parts: string[] = [];
    const { t, time } = text();
    for (let i = 0; i < after.ends.length && parts.length < 2; i++) {
      const end = after.ends[i];
      if (end != null && end !== before.ends[i]) parts.push(t("announce_times", { day: i + 1, end: time(end) }));
    }
    if (after.summary !== before.summary) parts.push(after.summary);
    return parts;
  };

  /** Any later edit ends the chance to undo: its toast goes too, so it cannot undo the wrong thing. */
  const dropUndo = (): void => {
    const toast = get().undo?.toast;
    if (toast != null && tripStore.getState().toast?.id === toast) tripActions().hideToast();
  };

  const commit = (patch: Partial<SessionState>, focus: FocusTarget | null, announcement = ""): void => {
    const before = digest();
    dropUndo();
    set({ ...patch, undo: null, ...requestFocus(focus) });
    emitChange();
    announce([announcement, ...changesBetween(before, digest())].filter(Boolean).join(" "));
  };

  const snapshotNow = (): Snapshot => {
    const { days, unplaced, expanded } = get();
    return { days, unplaced, expanded };
  };

  /** Destructive edits are undone, never confirmed. */
  const offerUndo = (message: string, snap: Snapshot, focus: FocusTarget): void => {
    tripActions().showToast(message, { action: { label: text().t("undo"), run: () => actions.undo() } });
    set({ undo: { snap, focus, toast: tripStore.getState().toast?.id ?? null } });
  };

  /** Places taken out of the plan by the user: code "other" with their note, if any. */
  const markUnplaced = (unplaced: UnplacedNotes, stops: readonly EditableStop[]): UnplacedNotes => {
    const next: Record<string, UnplacedNote> = { ...unplaced };
    for (const stop of stops) {
      if (stop.ref === REST_REF || ctx.nodes.get(stop.ref)?.kind !== "place") continue;
      next[stop.ref] = { code: "other", reason: (stop.reason || stop.reason_vi || "").trim() };
    }
    return next;
  };

  const announceMove = (days: Days, uid: string): string => {
    const at = locate(days, uid);
    return at ? text().t("announce_moved", { name: stopLabel(at.stop), day: at.d + 1, pos: at.i + 1 }) : "";
  };

  const moved = (days: Days, uid: string, part: "main" | "up" | "down" = "main"): void =>
    commit({ days }, { uid, part }, announceMove(days, uid));

  const addStop = (day: number, ref: string): { days: Days; stop: DraftStop } | null => {
    const node = ctx.nodes.get(ref);
    const into = get().days[day]?.stops;
    if (!node || !into) return null;
    const slot = pickSlot(ctx, node, into);
    const stop: DraftStop = { uid: `s${++seq}`, ref, slot, reason: "", reason_vi: "" };
    return { days: insertAt(get().days, day, insertIndex(ctx, into, slot), stop), stop };
  };

  const updateStop = (uid: string, patch: Partial<EditableStop>): Days | null => {
    const at = locate(get().days, uid);
    if (!at) return null;
    const stops = (get().days[at.d]?.stops ?? []).map((s) => (s.uid === uid ? { ...s, ...patch } : s));
    return withDay(get().days, at.d, stops);
  };

  const noteField = (): "reason" | "reason_vi" => (tripStore.getState().lang === "vi" ? "reason_vi" : "reason");

  const actions: SessionActions = {
    toggle: (uid) => {
      const { expanded, days } = get();
      const next = new Set(expanded);
      if (!next.delete(uid)) next.add(uid);
      set({ expanded: next, ...requestFocus({ uid, part: "main" }) });
      const at = locate(days, uid);
      if (at && at.stop.ref !== REST_REF && model.target(at.stop.ref)) {
        tripActions().requestMap({ type: "fly", id: at.stop.ref });
      }
    },
    moveBy: (uid, delta, part = "main") => {
      const { days } = get();
      const at = locate(days, uid);
      if (!at) return;
      const stops = days[at.d]?.stops ?? [];
      const target = at.i + delta;
      if (target >= 0 && target < stops.length) {
        const reordered = stops.filter((_, i) => i !== at.i);
        reordered.splice(target, 0, at.stop);
        moved(withDay(days, at.d, reordered), uid, part);
        return;
      }
      const day = at.d + delta;
      const into = days[day]?.stops;
      if (!into) return;
      const rest = without(days, at);
      moved(withDay(rest, day, delta < 0 ? [...into, at.stop] : [at.stop, ...into]), uid, part);
    },
    moveToDay: (uid, day, position) => {
      const { days } = get();
      const at = locate(days, uid);
      if (!at || day < 0 || day >= days.length) return;
      const rest = without(days, at);
      const into = rest[day]?.stops ?? [];
      moved(insertAt(rest, day, position ?? insertIndex(ctx, into, at.stop.slot), at.stop), uid);
    },
    dropOnStop: (uid, targetUid, after) => {
      const { days } = get();
      const from = locate(days, uid);
      if (!from || !locate(days, targetUid)) return;
      const rest = without(days, from);
      const again = locate(rest, targetUid);
      if (!again) return;
      moved(insertAt(rest, again.d, again.i + (after ? 1 : 0), from.stop), uid);
    },
    dropIntoDay: (uid, day) => {
      const from = locate(get().days, uid);
      if (!from) return;
      actions.moveToDay(uid, day, day === from.d ? (get().days[from.d]?.stops.length ?? 0) : undefined);
    },
    removeStop: (uid) => {
      const { days, unplaced, expanded } = get();
      const at = locate(days, uid);
      if (!at) return;
      const snap = snapshotNow();
      const next = without(days, at);
      const stops = next[at.d]?.stops ?? [];
      const neighbour = stops[at.i] ?? stops[at.i - 1];
      const open = new Set(expanded);
      open.delete(uid);
      const { t } = text();
      commit(
        { days: next, unplaced: markUnplaced(unplaced, [at.stop]), expanded: open },
        neighbour ? { uid: neighbour.uid, part: "main" } : { key: `add-place:${at.d}` },
        t("undo_hint"),
      );
      offerUndo(t("announce_removed", { name: stopLabel(at.stop) }), snap, { uid, part: "main" });
    },
    addOrMove: (day, ref) => {
      const existing = get().days.flatMap((d) => d.stops).find((s) => s.ref === ref);
      if (existing && ref !== REST_REF) {
        actions.moveToDay(existing.uid, day);
        return;
      }
      const added = addStop(day, ref);
      if (added) commit({ days: added.days }, null, text().t("announce_added", { name: stopLabel(added.stop), day: day + 1 }));
    },
    addRest: (day) => {
      const added = addStop(day, REST_REF);
      if (!added) return;
      commit(
        { days: added.days },
        { uid: added.stop.uid, part: "main" },
        text().t("announce_added", { name: stopLabel(added.stop), day: day + 1 }),
      );
    },
    addLeftOut: (day, ref) => {
      const added = addStop(day, ref);
      if (!added) return;
      commit(
        { days: added.days },
        { key: `add-place:${day}` },
        text().t("announce_added", { name: stopLabel(added.stop), day: day + 1 }),
      );
    },
    addDay: () => {
      const { days } = get();
      if (days.length >= MAX_DAYS) return;
      commit({ days: [...days, { stops: [] }] }, { key: `add-place:${days.length}` });
    },
    removeDay: (day) => {
      const { days, unplaced } = get();
      const stops = days[day]?.stops;
      if (!stops) return;
      const snap = snapshotNow();
      commit({ days: days.filter((_, k) => k !== day), unplaced: markUnplaced(unplaced, stops) }, { key: "add-day" });
      const { t } = text();
      offerUndo(t("announce_day_removed", { n: day + 1, count: stops.length, unplaced: t("unplaced") }), snap, {
        key: `remove-day:${day}`,
      });
    },
    setSlot: (uid, slot) => {
      const days = updateStop(uid, { slot });
      const at = days && locate(days, uid);
      if (!days || !at) return;
      const named = slotById(ctx, slot);
      const words = text();
      const label = named ? slotName(named, words.lang) : words.t("no_slot");
      commit({ days }, { uid, part: "slot" }, words.t("announce_slot", { name: stopLabel(at.stop), slot: label }));
    },
    commitNote: (uid, value) => {
      const field = noteField();
      const at = locate(get().days, uid);
      if (!at || at.stop[field] === value) return;
      const days = updateStop(uid, field === "reason_vi" ? { reason_vi: value } : { reason: value });
      if (!days) return;
      dropUndo();
      set({ days, undo: null });
      emitChange();
      announce(text().t("announce_note", { name: stopLabel(at.stop) }));
    },
    undo: () => {
      const pending = get().undo;
      if (!pending) return;
      const { snap, focus } = pending;
      commit({ days: snap.days, unplaced: snap.unplaced, expanded: snap.expanded }, focus, text().t("announce_undone"));
    },
    reset: () => {
      const snap = snapshotNow();
      const fresh = { days: withUids(baseline), unplaced: originalUnplaced(model) as UnplacedNotes };
      removeDraft(city);
      commit(
        { ...fresh, expanded: new Set(), staleDraft: null, savedSnapshot: derive(fresh).snapshot },
        { key: "reset" },
      );
      offerUndo(text().t("announce_reset"), snap, { key: "reset" });
    },
    restoreDraft: () => {
      const stale = get().staleDraft;
      if (!stale) return;
      commit({ days: withUids(stale.days), unplaced: draftUnplaced(model, stale), staleDraft: null }, null);
    },
    discardDraft: () => {
      removeDraft(city);
      set({ staleDraft: null, savedSnapshot: baselineSnapshot });
      persist();
    },
    openPicker: (day) => set((s) => ({ picker: { ...s.picker, open: true, day } })),
    closePicker: () =>
      set((s) => ({ picker: { ...s.picker, open: false }, ...requestFocus({ key: `add-place:${s.picker.day}` }) })),
    setPicker: (patch) => set((s) => ({ picker: { ...s.picker, ...patch } })),
    announce,
    close: () => {
      set((s) => ({ picker: { ...s.picker, open: false } }));
      tripActions().setEditing(false);
    },
  };

  tripStore.subscribe((state, previous) => {
    if (state.editing && !previous.editing) set(requestFocus({ key: openingFocusKey(state) }));
  });

  const isDirty = (): boolean => derive(get()).snapshot !== get().savedSnapshot;
  window.addEventListener("beforeunload", (event) => {
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = "";
  });
  if (applied) queueMicrotask(emitChange);

  return {
    model,
    ctx,
    store,
    actions,
    derive,
    planJson: () => toPlanJson(stripUids(get().days), derive(get()).leftOut),
    isDirty,
  };
}
