export type FormatVars = Readonly<Record<string, string | number>>;

const PLACEHOLDER = /\{(\w+)\}/g;
const DIACRITICS = /[̀-ͯ]/g;
const D_STROKE = /[đĐ]/g;
const HH_MM = /^(\d{1,2}):(\d{2})$/;
const MONTH_ABBR = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g;
const MONTH_NUMBER: Readonly<Record<string, number>> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

/** "{n} places" + {n: 3} → "3 places"; unknown placeholders stay as written. */
export function fmt(template: string, vars?: FormatVars): string {
  return template.replace(PLACEHOLDER, (match, key: string) => (vars && key in vars ? String(vars[key]) : match));
}

/** Lowercase, accents and đ removed: the search key for Vietnamese and English text. */
export function fold(text: string | null | undefined): string {
  return (text ?? "").normalize("NFD").replace(DIACRITICS, "").replace(D_STROKE, "d").toLowerCase();
}

export const pad2 = (n: number): string => String(n).padStart(2, "0");

export function km(value: number | null | undefined): string {
  return value == null ? "" : `${value.toFixed(1)} km`;
}

/** "07:30" → 450; null for anything else. */
export function toMin(hhmm: string | null | undefined): number | null {
  const match = HH_MM.exec(hhmm ?? "");
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** Minutes after midnight (wrapping past 24 h) as "7:30" or "7:30 AM". */
export function fmtTime(min: number | null | undefined, twelveHour: boolean): string {
  if (min == null || !Number.isFinite(min)) return "";
  const total = ((Math.round(min) % 1440) + 1440) % 1440;
  const hours = Math.floor(total / 60);
  const minutes = pad2(total % 60);
  if (!twelveHour) return `${hours}:${minutes}`;
  return `${hours % 12 || 12}:${minutes} ${hours < 12 ? "AM" : "PM"}`;
}

/** "7:30–9:00", or "7:30–9:00 AM" when both ends share the meridiem. */
export function fmtRange(start: number | null | undefined, end: number | null | undefined, twelveHour: boolean): string {
  let first = fmtTime(start, twelveHour);
  const last = fmtTime(end, twelveHour);
  if (!first || !last) return first || last;
  if (twelveHour && first.slice(-2) === last.slice(-2)) first = first.slice(0, -3);
  return `${first}–${last}`;
}

/** English month abbreviations as Vietnamese "T<n>" ("Dec" → "T12") when the language is vi. */
export function localMonths(text: string, lang: string): string {
  return lang === "vi" ? text.replace(MONTH_ABBR, (month) => `T${MONTH_NUMBER[month]}`) : text;
}

/** The local calendar date as "YYYY-MM-DD" (trip dates are local, not UTC). */
export function localDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}
