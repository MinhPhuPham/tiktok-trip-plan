/** The editor's checks for whatever plan the app shows (lazy chunk, see data/planIssues.ts). */
import type { TripModel } from "../../data/model";
import type { NoteLevel, PlanIssues, PlanNote, StopNotes } from "../../data/planIssues";
import { stopTargetId } from "../../data/stops";
import { REST_REF, type TripPlan, type TripStop } from "../../data/types";
import type { Translator } from "../../i18n/translator";
import { buildContext, type EditorContext } from "./logic/context";
import { computePlan } from "./logic/coverage";
import { groupIssues, issueText } from "./logic/issues";
import { isEditable } from "./logic/planJson";
import type { Issue } from "./logic/types";
import { editorText, issueWords } from "./text";

interface Found {
  stop: TripStop;
  day: number;
  issues: Issue[];
}

const contexts = new WeakMap<TripModel, EditorContext>();
const found = new WeakMap<TripPlan, Found[]>();
const described = new WeakMap<TripPlan, WeakMap<Translator, PlanIssues>>();

function contextOf(model: TripModel): EditorContext {
  let ctx = contexts.get(model);
  if (!ctx) contexts.set(model, (ctx = buildContext(model.data)));
  return ctx;
}

const refOf = (stop: TripStop): string => (stop.kind === "rest" ? REST_REF : (stop.ref ?? ""));

/** Each stop's issues, as the editor would compute them for this plan. */
function findIssues(model: TripModel, plan: TripPlan): Found[] {
  let list = found.get(plan);
  if (list) return list;
  const days = plan.days.map((day, d) => ({
    number: day.day,
    stops: day.stops.filter(isEditable).map((stop, i) => ({ uid: `${d}:${i}`, ref: refOf(stop), stop })),
  }));
  const computed = computePlan(
    contextOf(model),
    days.map((d) => ({ stops: d.stops.map((s) => ({ ref: s.ref, slot: s.stop.slot ?? null })) })),
    plan.unplaced,
  );
  const { byStop } = groupIssues(days, computed.issues);
  list = days.flatMap((day) =>
    day.stops.flatMap((s) => {
      const issues = byStop.get(s.uid);
      return issues ? [{ stop: s.stop, day: day.number, issues }] : [];
    }),
  );
  found.set(plan, list);
  return list;
}

/** Problems first, then notes, each in check order. */
export const byLevel = (a: { level: NoteLevel }, b: { level: NoteLevel }): number =>
  (a.level === "error" ? 0 : 1) - (b.level === "error" ? 0 : 1);

/** "1 problem, 2 notes: …; …": a stop's flag as one accessible name. */
export function notesLabel(tr: Translator, notes: readonly Pick<PlanNote, "level" | "text">[]): string {
  const errors = notes.filter((n) => n.level === "error").length;
  const warnings = notes.length - errors;
  const counts = [
    errors ? tr.t(errors === 1 ? "plan_problem_1" : "plan_problems_n", { n: errors }) : "",
    warnings ? tr.t(warnings === 1 ? "plan_note_1" : "plan_notes_n", { n: warnings }) : "",
  ].filter(Boolean);
  return `${counts.join(", ")}: ${notes.map((n) => n.text).join("; ")}`;
}

export function planIssues(model: TripModel, plan: TripPlan, tr: Translator): PlanIssues {
  let byTr = described.get(plan);
  if (!byTr) described.set(plan, (byTr = new WeakMap()));
  let result = byTr.get(tr);
  if (result) return result;
  const words = issueWords(contextOf(model), editorText(tr));
  const byStop = new Map<TripStop, StopNotes>();
  const byTarget = new Map<string, PlanNote[]>();
  for (const { stop, day, issues } of findIssues(model, plan)) {
    const notes = issues.map((issue) => ({ level: issue.level, text: issueText(words, issue), day })).sort(byLevel);
    const level = notes[0]?.level ?? "warning";
    byStop.set(stop, { level, notes, label: notesLabel(tr, notes) });
    const target = stopTargetId(model, stop);
    byTarget.set(target, [...(byTarget.get(target) ?? []), ...notes].sort(byLevel));
  }
  result = { byStop, byTarget };
  byTr.set(tr, result);
  return result;
}
