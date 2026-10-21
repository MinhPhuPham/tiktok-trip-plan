/** Issue wording, grouping by stop/day/left-out place, and the count of problems to fix. */
import { hoursPeriods, openingIntervals } from "./clock";
import { DAY_MINUTES } from "./constants";
import type { EditorNode, Issue } from "./types";
import type { EditorLabelKey } from "./labels";

export interface IssueWords {
  t: (key: EditorLabelKey, vars?: Readonly<Record<string, string | number>>) => string;
  time: (min: number) => string;
  slotName: (id: string) => string;
  category: (category: string) => string;
  direction: (sector: string) => string;
  node: (ref: string) => EditorNode | undefined;
}

type Param = string | number | boolean | null | undefined;
const num = (value: Param): number => (typeof value === "number" ? value : Number(value) || 0);
const str = (value: Param): string => (value == null ? "" : String(value));

/** "7:00–11:00, 17:00–22:00", "Closed" or "?" when unknown. */
export function hoursText(words: Pick<IssueWords, "t" | "time">, node: EditorNode, weekday: number): string {
  const intervals = node.place ? openingIntervals(hoursPeriods(node.place.hours), weekday) : null;
  if (intervals === null) return "?";
  if (!intervals.length) return words.t("closed_today");
  return intervals.map(([lo, hi]) => `${words.time(lo)}–${words.time(Math.min(hi, DAY_MINUTES))}`).join(", ");
}

export function issueText(words: IssueWords, issue: Issue): string {
  const p = issue.params;
  const { t, time } = words;
  const node = issue.ref ? words.node(issue.ref) : undefined;
  switch (issue.rule) {
    case "closed": {
      const hours = node ? hoursText(words, node, num(p.weekday)) : "?";
      return p.closedDay
        ? t("closed_warning", { hours })
        : t("closing_warning", { time: time(num(p.time)), need: num(p.need), hours });
    }
    case "day_end":
      return t("past_end_warning", { time: time(num(p.time)), end: time(num(p.end)) });
    case "deadline":
      return t("deadline_warning", { time: time(num(p.time)), deadline: time(num(p.deadline)) });
    case "duplicate":
    case "planned_and_unplaced":
      return t("duplicate_warning", { n: num(p.n) || 2 });
    case "unknown_ref":
    case "unknown_unplaced":
      return t("unknown_warning", { ref: str(p.ref) });
    case "unknown_slot":
      return t("unknown_slot_warning", { slot: str(p.slot) });
    case "missing_slot":
      return t("missing_slot_warning");
    case "slot_category":
      return t("slot_category_warning", { category: words.category(str(p.category)), slot: words.slotName(str(p.slot)) });
    case "slot_order":
      return t("slot_order_warning", { slot: words.slotName(str(p.slot)) });
    case "long_leg":
      return t(p.back ? "long_leg_back_warning" : "long_leg_warning", { n: num(p.n) });
    case "long_wait":
      return t("long_wait_warning", { n: num(p.n), time: time(num(p.time)) });
    case "best_time":
      return t("best_time_warning", { time: time(num(p.time)), best: `${time(num(p.lo))}–${time(num(p.hi))}` });
    case "directions":
      return t("directions_warning", { a: words.direction(str(p.a)), b: words.direction(str(p.b)), deg: num(p.deg) });
    case "late_return":
      return t("late_return_warning", { time: time(num(p.time)), end: time(num(p.end)) });
    case "too_many_days":
      return t("too_many_days_warning", { n: num(p.n), days: num(p.days) });
    case "max_places":
      return t("max_places_warning", { n: num(p.n), max: num(p.max) });
    case "max_nearby":
      return t("max_nearby_warning", { n: num(p.n), max: num(p.max) });
    case "must_unplaced":
      return t("must_unplaced_warning");
    default:
      return issue.rule;
  }
}

export interface IssueGroups {
  byStop: ReadonlyMap<string, Issue[]>;
  byDay: ReadonlyMap<number, Issue[]>;
  byRef: ReadonlyMap<string, Issue[]>;
}

interface KeyedDay {
  stops: readonly { uid: string; ref: string }[];
}

function push<K>(map: Map<K, Issue[]>, key: K, issue: Issue): void {
  const list = map.get(key);
  if (list) list.push(issue);
  else map.set(key, [issue]);
}

/** Issues per stop uid, per day index, and per left-out ref; empty_day is drawn as the empty state. */
export function groupIssues(days: readonly KeyedDay[], issues: readonly Issue[]): IssueGroups {
  const byStop = new Map<string, Issue[]>();
  const byDay = new Map<number, Issue[]>();
  const byRef = new Map<string, Issue[]>();
  for (const issue of issues) {
    if (issue.rule === "empty_day") continue;
    if (issue.rule === "too_many_days") {
      for (let d = num(issue.params.days); d < days.length; d++) {
        push(byDay, d, { ...issue, params: { ...issue.params, n: d + 1 } });
      }
      continue;
    }
    if (issue.day != null && issue.index != null) {
      const stop = days[issue.day - 1]?.stops[issue.index];
      if (stop) push(byStop, stop.uid, issue);
    } else if (issue.ref && issue.day == null) {
      let found = false;
      for (const day of days) {
        for (const s of day.stops) {
          if (s.ref === issue.ref) {
            push(byStop, s.uid, issue);
            found = true;
          }
        }
      }
      if (!found) push(byRef, issue.ref, issue);
    } else if (issue.day != null) {
      push(byDay, issue.day - 1, issue);
    }
  }
  return { byStop, byDay, byRef };
}

export const errorCount = (issues: readonly Issue[]): number => issues.filter((i) => i.level === "error").length;

/** "2 to fix" / "Nothing to fix": warnings are never counted. */
export function errorsText(t: IssueWords["t"], issues: readonly Issue[]): string {
  const n = errorCount(issues);
  return n ? t("to_fix", { n }) : t("no_errors");
}
