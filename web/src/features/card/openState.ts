import type { OpeningPeriod } from "../../data/types";
import type { Translator } from "../../i18n/translator";
import { toMin } from "../../lib/format";

const DAY_MIN = 1440;
const WEEK_MIN = 7 * DAY_MIN;

export interface OpenState {
  open: boolean;
  text: string;
}

/**
 * "Open now · closes 22:00" from the weekly periods (0 = Monday). A close before the open time
 * runs past midnight; no close means 24 hours. Spans cross midnight here, unlike the planner's
 * per-day windows (editor/logic/clock.ts openingIntervals), so a late close reads as "closes 02:00".
 */
export function openState(t: Translator, periods: readonly OpeningPeriod[], now: Date): OpenState | null {
  if (!periods.length) return null;
  const today = (now.getDay() + 6) % 7;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const spans: [number, number][] = [];
  for (const period of periods) {
    const open = toMin(period.open);
    if (open == null) continue;
    const close = period.close ? toMin(period.close) : null;
    const length = close == null ? DAY_MIN : close > open ? close - open : close + DAY_MIN - open;
    const start = ((period.day - today + 7) % 7) * DAY_MIN + open;
    spans.push([start, start + length], [start - WEEK_MIN, start - WEEK_MIN + length]);
  }
  const current = spans.find(([from, to]) => from <= nowMin && nowMin < to);
  if (current) {
    if (current[1] - current[0] >= DAY_MIN) return { open: true, text: t.t("open_24h") };
    return { open: true, text: `${t.t("open_now")} · ${t.t("closes_at", { time: t.time(current[1]) })}` };
  }
  let next: number | null = null;
  for (const [from] of spans) if (from > nowMin && (next == null || from < next)) next = from;
  if (next != null && next < DAY_MIN) {
    return { open: false, text: `${t.t("closed_now")} · ${t.t("opens_at", { time: t.time(next) })}` };
  }
  return { open: false, text: t.t("closed_today_note") };
}
