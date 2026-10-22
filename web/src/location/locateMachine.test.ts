import { describe, expect, it } from "vitest";
import { buildTripModel } from "../data/model";
import { planFromData } from "../data/types";
import { createTripStore } from "../state/store";
import { makeTrip } from "../test/fixtures";
import { isDotShown, isWatching, LOCATE_OFF, locateStep, type LocateEvent, type LocateState } from "./locateMachine";

const run = (events: readonly LocateEvent["type"][], from: LocateState = LOCATE_OFF): LocateState =>
  events.reduce((state, type) => locateStep(state, { type }), from);

describe("locateStep", () => {
  it("tap, fix: locates, then centres and follows", () => {
    expect(run(["tap"])).toEqual({ mode: "locating", follow: true });
    expect(run(["tap", "fix"])).toEqual({ mode: "following", follow: true });
  });

  it("a granted permission on load shows the dot without moving the map", () => {
    expect(run(["granted", "fix"])).toEqual({ mode: "showing", follow: false });
  });

  it("a pan ends following, a tap resumes it, the next tap turns location off", () => {
    expect(run(["tap", "fix", "pan"]).mode).toBe("showing");
    expect(run(["tap", "fix", "pan", "tap"]).mode).toBe("following");
    expect(run(["tap", "fix", "tap"])).toEqual(LOCATE_OFF);
  });

  it("a pan while locating cancels the centring but keeps locating", () => {
    expect(run(["tap", "pan"])).toEqual({ mode: "locating", follow: false });
    expect(run(["tap", "pan", "fix"]).mode).toBe("showing");
  });

  it("a tap on the silent start asks for centring; a second tap cancels", () => {
    expect(run(["granted", "tap"])).toEqual({ mode: "locating", follow: true });
    expect(run(["tap", "tap"])).toEqual(LOCATE_OFF);
  });

  it("denied is sticky: taps change nothing, retry asks again, a reset permission turns it off", () => {
    const denied = run(["tap", "denied"]);
    expect(denied.mode).toBe("denied");
    expect(locateStep(denied, { type: "tap" })).toBe(denied);
    expect(locateStep(denied, { type: "fix" })).toBe(denied);
    expect(run(["retry"], denied)).toEqual({ mode: "locating", follow: true });
    expect(run(["reset"], denied)).toEqual(LOCATE_OFF);
    expect(run(["granted"], denied)).toEqual({ mode: "locating", follow: false });
  });

  it("revoking the permission while showing goes to denied", () => {
    expect(run(["granted", "fix", "denied"]).mode).toBe("denied");
  });

  it("failing after a tap shows the failed state; failing silently just turns it off", () => {
    expect(run(["tap", "failed"]).mode).toBe("failed");
    expect(run(["tap", "failed", "tap"])).toEqual({ mode: "locating", follow: true });
    expect(run(["granted", "failed"])).toEqual(LOCATE_OFF);
  });

  it("denied and failed keep why: no prompt, refused prompt, no position or timeout", () => {
    const asked = run(["tap"]);
    expect(locateStep(asked, { type: "denied" })).toEqual({ mode: "denied", follow: false, problem: "blocked" });
    expect(locateStep(asked, { type: "denied", problem: "refused" }).problem).toBe("refused");
    expect(locateStep(asked, { type: "failed" })).toEqual({ mode: "failed", follow: false, problem: "timeout" });
    expect(locateStep(asked, { type: "failed", problem: "off" }).problem).toBe("off");
    expect(run(["retry"], locateStep(asked, { type: "failed", problem: "off" }))).toEqual({ mode: "locating", follow: true });
  });

  it("errors after a fix keep the dot", () => {
    expect(run(["tap", "fix", "failed"]).mode).toBe("following");
  });

  it("watching and dot modes", () => {
    expect(["off", "locating", "showing", "following", "denied", "failed"].map((m) => isWatching(m as never))).toEqual([
      false, true, true, true, false, false,
    ]);
    expect(["locating", "showing", "following"].map((m) => isDotShown(m as never))).toEqual([false, true, true]);
  });
});

describe("store locate actions", () => {
  const store = () => {
    const data = makeTrip();
    return createTripStore({ city: data.city, langs: buildTripModel(data).langs, defaultLang: "en", plan: planFromData(data), phone: false, persistence: null });
  };
  const fix = { lat: 10.77, lng: 106.7, accuracy: 20, heading: null };

  it("keeps a fix only while watching and forgets it when location turns off", () => {
    const s = store();
    s.getState().actions.receiveFix(fix);
    expect(s.getState().userFix).toBeNull();
    s.getState().actions.locate({ type: "tap" });
    s.getState().actions.receiveFix(fix);
    expect(s.getState().locate.mode).toBe("following");
    expect(s.getState().userFix).toEqual(fix);
    s.getState().actions.locate({ type: "tap" });
    expect(s.getState().locate.mode).toBe("off");
    expect(s.getState().userFix).toBeNull();
  });

  it("a denied permission forgets the position too", () => {
    const s = store();
    s.getState().actions.locate({ type: "granted" });
    s.getState().actions.receiveFix(fix);
    s.getState().actions.locate({ type: "denied" });
    expect(s.getState().userFix).toBeNull();
  });
});
