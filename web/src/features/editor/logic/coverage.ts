/** Whole-plan checks: port of planning/collect.py coverage_issues. */
import { REST_REF } from "../../../data/types";
import type { EditorContext } from "./context";
import { computeTimes } from "./timing";
import type { ComputedPlan, EditDay, Issue, IssueLevel, IssueParams, UnplacedEntry } from "./types";

export function countRefs(refs: Iterable<string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ref of refs) counts.set(ref, (counts.get(ref) ?? 0) + 1);
  return counts;
}

export function validatePlan(
  ctx: EditorContext,
  days: readonly EditDay[],
  unplaced: readonly UnplacedEntry[] | null | undefined,
): Issue[] {
  const issues: Issue[] = [];
  const add = (level: IssueLevel, rule: string, params: IssueParams, extra: { ref?: string; day?: number } = {}) =>
    issues.push({ level, rule, day: null, index: null, ref: null, params, ...extra });
  if (days.length > ctx.tripDays) add("error", "too_many_days", { planned: days.length, days: ctx.tripDays });
  const used = countRefs(days.flatMap((d) => d.stops.map((s) => s.ref)).filter((r) => r !== REST_REF));
  for (const [ref, count] of used) {
    if (count > 1 && ctx.nodes.has(ref)) add("error", "duplicate", { n: count }, { ref });
  }
  const listed = countRefs((unplaced ?? []).map((u) => u.ref));
  for (const [ref, count] of listed) {
    const node = ctx.nodes.get(ref);
    if (!node || node.kind !== "place") add("error", "unknown_unplaced", { ref }, { ref });
    else if (used.has(ref)) add("error", "planned_and_unplaced", {}, { ref });
    else if (count > 1) add("error", "duplicate", { n: count }, { ref });
    else if (node.place?.priority === "must") add("warning", "must_unplaced", {}, { ref });
  }
  for (const place of ctx.places) {
    if (!used.has(place.id) && !listed.has(place.id)) add("error", "missing_place", {}, { ref: place.id });
  }
  days.forEach((day, i) => {
    let places = 0;
    let nearby = 0;
    for (const stop of day.stops) {
      const kind = ctx.nodes.get(stop.ref)?.kind;
      if (kind === "place") places++;
      if (kind === "nearby") nearby++;
    }
    if (ctx.maxPlacesPerDay != null && places > ctx.maxPlacesPerDay) {
      add("error", "max_places", { n: places, max: ctx.maxPlacesPerDay }, { day: i + 1 });
    }
    if (nearby > ctx.maxNearbyPerDay) add("error", "max_nearby", { n: nearby, max: ctx.maxNearbyPerDay }, { day: i + 1 });
  });
  return issues;
}

export function computePlan(
  ctx: EditorContext,
  days: readonly EditDay[],
  unplaced: readonly UnplacedEntry[] | null | undefined,
): ComputedPlan {
  const timed = days.map((day, i) => computeTimes(ctx, i + 1, day.stops));
  return { days: timed, issues: [...validatePlan(ctx, days, unplaced), ...timed.flatMap((d) => d.issues)] };
}
