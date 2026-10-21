import { buildTripModel } from "../../../data/model";
import { planFromData } from "../../../data/types";
import { tripStorageId } from "../../../state/persist";
import { createTripStore } from "../../../state/store";
import { makeTrip } from "../../../test/fixtures";
import { MAX_DAYS } from "../logic/constants";
import { draftBasis, draftKey, hasCurrentDraft } from "./draftStorage";
import { createEditorSession } from "./session";

function setup() {
  const data = makeTrip();
  const model = buildTripModel(data);
  const trip = createTripStore({
    city: data.city,
    langs: ["en", "vi"],
    defaultLang: "en",
    plan: planFromData(data),
    phone: false,
    persistence: null,
  });
  const session = createEditorSession(model, trip);
  const uidOf = (ref: string) => {
    const stop = session.store.getState().days.flatMap((d) => d.stops).find((s) => s.ref === ref);
    if (!stop) throw new Error(`no stop ${ref}`);
    return stop.uid;
  };
  return { model, trip, session, uidOf };
}

const kinds = (stops: readonly { kind: string; ref?: string | null }[]) => stops.map((s) => `${s.kind}:${s.ref ?? ""}`);

describe("editor session", () => {
  it("starts from the generated plan with the left-out place and its code", () => {
    const { session } = setup();
    const state = session.store.getState();
    expect(state.days.map((d) => d.stops.map((s) => s.ref))).toEqual([["a", "n1"]]);
    const { leftOut } = session.derive(state);
    expect(leftOut).toEqual([
      { ref: "b", code: "too_far", reason: "" },
      { ref: "c", code: "other", reason: "" },
    ]);
    expect(session.isDirty()).toBe(false);
  });

  it("reorders a stop and publishes the recomputed plan to the trip store", () => {
    const { session, trip, uidOf } = setup();
    session.actions.moveBy(uidOf("n1"), -1);
    const plan = trip.getState().plan;
    expect(plan.edited).toBe(true);
    expect(kinds(plan.days[0]?.stops ?? [])).toEqual(["start:", "nearby:n1", "place:a", "end:"]);
    expect(plan.days[0]?.stops[1]?.arrive_min).toEqual(expect.any(Number));
    expect(plan.unplaced.map((u) => [u.ref, u.reason_text.en])).toEqual([
      ["b", "Too far"],
      ["c", ""],
    ]);
    expect(session.planJson().days[0]?.stops.map((s) => s.ref)).toEqual(["n1", "a"]);
    expect(session.store.getState().focus?.key).toBe(`main:${uidOf("n1")}`);
    expect(session.isDirty()).toBe(true);
  });

  it("removes with an undo toast; undoing restores the generated plan", () => {
    const { session, trip, uidOf } = setup();
    session.actions.removeStop(uidOf("a"));
    expect(trip.getState().toast?.action?.label).toBe("Undo");
    expect(session.derive(session.store.getState()).leftOut.find((u) => u.ref === "a")).toEqual({
      ref: "a",
      code: "other",
      reason: "",
    });
    expect(session.planJson().unplaced.map((u) => u.ref)).toEqual(["a", "b", "c"]);
    trip.getState().toast?.action?.run();
    expect(session.store.getState().days[0]?.stops.map((s) => s.ref)).toEqual(["a", "n1"]);
    expect(trip.getState().plan.edited).toBe(false);
  });

  it("a later edit ends the undo and hides its toast", () => {
    const { session, trip, uidOf } = setup();
    session.actions.removeStop(uidOf("a"));
    expect(trip.getState().toast).not.toBeNull();
    session.actions.addDay();
    expect(trip.getState().toast).toBeNull();
    expect(session.store.getState().undo).toBeNull();
  });

  it("commits a note once, in the current language, and asks for focus on Done when the editor opens", () => {
    const { session, trip, uidOf } = setup();
    const before = session.store.getState().days;
    session.actions.commitNote(uidOf("a"), "");
    expect(session.store.getState().days).toBe(before);
    session.actions.commitNote(uidOf("a"), "go early");
    expect(session.planJson().days[0]?.stops[0]).toMatchObject({ ref: "a", reason: "go early" });
    expect(trip.getState().plan.edited).toBe(true);
    const seq = session.store.getState().focus?.seq ?? 0;
    trip.getState().actions.setEditing(true);
    expect(session.store.getState().focus).toEqual({ key: "done", seq: seq + 1 });
  });

  it("adds days up to the limit, rests and left-out places in rhythm order", () => {
    const { session } = setup();
    for (let i = 0; i < MAX_DAYS + 2; i++) session.actions.addDay();
    expect(session.store.getState().days).toHaveLength(MAX_DAYS);
    session.actions.addLeftOut(1, "b");
    session.actions.addRest(1);
    expect(session.store.getState().days[1]?.stops.map((s) => s.ref)).toEqual(["b", "rest"]);
    const rules = session.derive(session.store.getState()).computed.issues.map((i) => i.rule);
    expect(rules).toContain("too_many_days");
  });

  it("moving a planned place from the picker moves it instead of duplicating it", () => {
    const { session } = setup();
    session.actions.addDay();
    session.actions.addOrMove(1, "a");
    expect(session.store.getState().days.map((d) => d.stops.map((s) => s.ref))).toEqual([["n1"], ["a"]]);
  });

  it("saves a versioned draft that a new session applies, and marks an outdated one stale", async () => {
    const { model, trip, session, uidOf } = setup();
    session.actions.moveBy(uidOf("n1"), -1);
    session.actions.save();
    expect(session.isDirty()).toBe(false);
    const stored = JSON.parse(localStorage.getItem(draftKey(model.data.city)) ?? "null") as { v: number };
    expect(stored.v).toBe(2);

    trip.getState().actions.resetPlan();
    const again = createEditorSession(model, trip);
    expect(again.store.getState().days[0]?.stops.map((s) => s.ref)).toEqual(["n1", "a"]);
    await Promise.resolve();
    expect(trip.getState().plan.edited).toBe(true);

    const id = tripStorageId(model.data);
    expect(hasCurrentDraft(id, draftBasis(model.data))).toBe(true);
    const changed = buildTripModel(makeTrip({ unplaced: [], days: [] }));
    expect(hasCurrentDraft(id, draftBasis(changed.data))).toBe(false);
    const stale = createEditorSession(changed, trip);
    expect(stale.store.getState().staleDraft).not.toBeNull();
    stale.actions.restoreDraft();
    expect(stale.store.getState().days[0]?.stops.map((s) => s.ref)).toEqual(["n1", "a"]);
  });

  it("reads the old app's draft key", () => {
    const { model, trip } = setup();
    const base = createEditorSession(model, trip);
    const basis = (() => {
      base.actions.save();
      const saved = JSON.parse(localStorage.getItem(draftKey(model.data.city)) ?? "{}") as { basis: string };
      localStorage.clear();
      return saved.basis;
    })();
    localStorage.setItem(
      `trip-plan-draft:${model.data.city}`,
      JSON.stringify({ v: 1, basis, days: [{ stops: [{ ref: "n1", slot: null }] }], reasons: { a: "skip it" } }),
    );
    const legacy = createEditorSession(model, trip);
    expect(legacy.store.getState().days[0]?.stops.map((s) => s.ref)).toEqual(["n1"]);
    expect(legacy.store.getState().unplaced.a).toEqual({ code: "other", reason: "skip it" });
  });
});
