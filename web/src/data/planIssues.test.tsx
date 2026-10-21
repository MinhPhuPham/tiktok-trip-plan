import { act, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import { closingTrip } from "../test/fixtures";
import { renderTrip } from "../test/renderTrip";
import { useTripPlan } from "./hooks";
import { usePlanIssues, type PlanIssues } from "./planIssues";
import type { TripPlan } from "./types";

const seen: { issues: PlanIssues | null; plan: TripPlan | null } = { issues: null, plan: null };

function Probe() {
  const issues = usePlanIssues();
  const plan = useTripPlan();
  useEffect(() => {
    seen.issues = issues;
    seen.plan = plan;
  });
  return <p>{issues ? "ready" : "loading"}</p>;
}

describe("usePlanIssues", () => {
  it("loads the checks lazily and maps each issue to its stop and card target", async () => {
    renderTrip(<Probe />, { data: closingTrip() });
    await screen.findByText("ready");
    const [start, a, n1, end] = seen.plan?.days[0]?.stops ?? [];
    const notesA = seen.issues?.byStop.get(a!);
    expect(notesA?.level).toBe("error");
    expect(notesA?.notes.map((n) => [n.level, n.day])).toEqual([
      ["error", 1],
      ["warning", 1],
    ]);
    expect(notesA?.notes[0]?.text).toMatch(/^Arrives 8:0\d AM with no time left before closing \(needs 30 min\)/);
    expect(notesA?.label).toMatch(/^1 problem, 1 note: Arrives .*; No part of day set$/);
    expect(seen.issues?.byStop.get(n1!)?.label).toMatch(/^2 notes: No part of day set; \d+ min on the road to get here$/);
    expect(seen.issues?.byStop.has(start!)).toBe(false);
    expect(seen.issues?.byStop.has(end!)).toBe(false);
    expect(seen.issues?.byTarget.get("a")?.map((n) => n.level)).toEqual(["error", "warning"]);
  });

  it("is computed once per plan and recomputed for an edited plan", async () => {
    const { store } = renderTrip(<Probe />, { data: closingTrip() });
    await screen.findByText("ready");
    const first = seen.issues;
    act(() => store.getState().actions.setLang("en"));
    expect(seen.issues).toBe(first);
    const [day] = store.getState().plan.days;
    act(() => store.getState().actions.setPlan([{ day: 1, stops: (day?.stops ?? []).filter((s) => s.ref !== "a") }]));
    await waitFor(() => expect(seen.issues).not.toBe(first));
    expect(seen.issues?.byTarget.has("a")).toBe(false);
    expect(seen.issues?.byTarget.get("n1")?.map((n) => n.level)).toEqual(["warning", "warning"]);
  });
});
