import { describe, expect, it } from "vitest";
import { getTripPlan } from "../../data/hooks";
import { buildTripModel } from "../../data/model";
import { peekStart } from "../../data/stops";
import { planFromData, type TripData } from "../../data/types";
import { makeDay, makeStop, threeVisitTrip } from "../../test/fixtures";
import { neighbour, peekView, stepPeek } from "./peekCursor";

const TODAY = "2026-10-21";
const at = (hour: number, minute = 0) => new Date(2026, 9, 21, hour, minute);

const dated = (data: TripData, dates: (string | null)[] = [TODAY, "2026-10-22", "2026-10-23"]): TripData => ({
  ...data,
  tripDates: dates,
});

/** threeVisitTrip plus Day 2: c (9:30), n1 (14:00). */
const twoDayTrip = (): TripData => {
  const data = threeVisitTrip();
  data.days.push(
    makeDay(2, [
      makeStop("start", null),
      makeStop("place", "c", { arrive: "09:30", depart: "10:30" }),
      makeStop("nearby", "n1", { arrive: "14:00", depart: "14:30" }),
      makeStop("end", null, { arrive: "18:00" }),
    ]),
  );
  return data;
};

const startOf = (data: TripData, openDay: number | null, now: Date) => {
  const model = buildTripModel(data);
  const plan = getTripPlan(model, planFromData(data));
  return { model, plan, start: peekStart(model, plan, openDay, now) };
};

const where = (data: TripData, openDay: number | null, now: Date) => {
  const { start } = startOf(data, openDay, now);
  return start ? `${start.day.day}:${start.stop.ref}${start.live ? " live" : ""}` : null;
};

const setup = (now = at(10, 30)) => {
  const { model, plan, start } = startOf(dated(threeVisitTrip()), 1, now);
  if (!start) throw new Error("no start");
  return { model, plan, next: start };
};

describe("peek start", () => {
  it.each([
    ["undated, Day 1 open, mid-afternoon", twoDayTrip(), 1, at(15), "1:a"],
    ["undated, Day 2 open", twoDayTrip(), 2, at(15), "2:c"],
    ["undated, no day open", twoDayTrip(), null, at(8), "1:a"],
    ["undated, an unknown day open", twoDayTrip(), 5, at(15), "1:a"],
    ["dated, today is Day 1", dated(twoDayTrip()), 1, at(10, 30), "1:b live"],
    ["dated, today is Day 1, no day open", dated(twoDayTrip()), null, at(10, 30), "1:b live"],
    ["dated, Day 1 done: tomorrow's first", dated(twoDayTrip()), 1, at(15), "2:c live"],
    ["dated, today is Day 1 but Day 2 open", dated(twoDayTrip()), 2, at(10, 30), "2:c"],
    ["dated, before the trip", dated(twoDayTrip(), ["2026-10-25", "2026-10-26"]), 1, at(10, 30), "1:a"],
    ["dated, after the trip", dated(twoDayTrip(), ["2026-10-19", "2026-10-20"]), 2, at(10, 30), "2:c"],
    ["dated, last day done", dated(twoDayTrip(), ["2026-10-20", TODAY]), 2, at(20), "2:c"],
  ])("%s", (_, data, openDay, now, expected) => {
    expect(where(data, openDay, now)).toBe(expected);
  });

  it("has nothing to show without visits", () => {
    expect(where({ ...threeVisitTrip(), days: [] }, 1, at(10))).toBeNull();
  });
});

describe("peek cursor", () => {
  it("only the live start is labelled next", () => {
    const { start } = startOf(threeVisitTrip(), 1, at(10, 30));
    expect(peekView(start!, null)).toMatchObject({ index: 0, isNext: false, browsing: false, legMinutes: 10 });
  });

  it("starts at the next stop among the day's visits only", () => {
    const { next } = setup();
    const view = peekView(next, null);
    expect(view.visits.map((s) => s.ref)).toEqual(["a", "b", "n1"]);
    expect(view).toMatchObject({ index: 1, isNext: true, browsing: false, step: null, legMinutes: 7 });
    expect(view.stop.ref).toBe("b");
  });

  it("steps both ways and stops at the ends (no wrap)", () => {
    const { next } = setup();
    let view = peekView(next, null);
    const back = stepPeek(view, next, -1);
    view = peekView(next, back);
    expect(view).toMatchObject({ index: 0, isNext: false, browsing: true, step: -1 });
    expect(view.stop.ref).toBe("a");
    expect(neighbour(view, -1)).toBeNull();
    expect(stepPeek(view, next, -1)).toBeNull();

    view = peekView(next, stepPeek(peekView(next, stepPeek(view, next, 1)), next, 1));
    expect(view.stop.ref).toBe("n1");
    expect(view.legMinutes).toBe(10);
    expect(neighbour(view, 1)).toBeNull();
    expect(neighbour(view, -1)?.ref).toBe("b");
  });

  it("coming back to the next stop is still browsing; a new next stop resets the cursor", () => {
    const { next, model, plan } = setup();
    const back = stepPeek(peekView(next, null), next, -1);
    const again = stepPeek(peekView(next, back), next, 1);
    expect(peekView(next, again)).toMatchObject({ index: 1, isNext: true, browsing: true, step: 1 });

    const later = peekStart(model, plan, 1, at(11, 40));
    expect(later?.stop.ref).toBe("n1");
    expect(peekView(later!, back)).toMatchObject({ index: 2, isNext: true, browsing: false });
  });
});
