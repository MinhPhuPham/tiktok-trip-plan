import { UNASSIGNED, type Labels, type LangCode, type Localized } from "../data/types";
import { fmt, fmtRange, fmtTime, localMonths, type FormatVars } from "../lib/format";
import { shellText } from "./shellText";

export interface Translator {
  lang: LangCode;
  labels: Labels;
  /** labels.ui[key] (else the shell fallback, else the key) with {placeholders} filled. */
  t: (key: string, vars?: FormatVars) => string;
  has: (key: string) => boolean;
  /** The current language's entry of a {en, vi} value; plain strings pass through. */
  loc: (value: Localized | string | null | undefined) => string;
  /** `vi` in Vietnamese when it is not empty, else `en` (stop reasons). */
  pick: (en: string | null | undefined, vi: string | null | undefined) => string;
  time: (min: number | null | undefined) => string;
  range: (start: number | null | undefined, end: number | null | undefined) => string;
  months: (text: string) => string;
  dayName: (day: number) => string;
  dayCount: (days: number) => string;
  directionName: (sector: string) => string;
  category: (category: string) => string;
  priority: (level: string | null | undefined) => string;
  tag: (tag: string) => string;
  kindName: (kind: string) => string;
}

export function createTranslator(labels: Labels, lang: LangCode): Translator {
  const has = (key: string) => key in labels.ui || shellText(lang, key) !== undefined;
  const t = (key: string, vars?: FormatVars) => fmt(labels.ui[key] ?? shellText(lang, key) ?? key, vars);
  const loc = (value: Localized | string | null | undefined): string => {
    if (value == null) return "";
    if (typeof value === "string") return value;
    return value[lang] ?? value.en ?? "";
  };
  const kindName = (kind: string): string => {
    const known = labels.kinds[kind] ?? labels.ui[`kind_${kind}`] ?? labels.categories[kind];
    if (known) return known;
    const plain = kind.replace(/_/g, " ");
    return plain.charAt(0).toUpperCase() + plain.slice(1);
  };
  return {
    lang,
    labels,
    t,
    has,
    loc,
    pick: (en, vi) => (lang === "vi" && vi ? vi : (en ?? "")),
    time: (min) => fmtTime(min, labels.twelve_hour),
    range: (start, end) => fmtRange(start, end, labels.twelve_hour),
    months: (text) => localMonths(text, lang),
    dayName: (day) => fmt(labels.day, { day }),
    dayCount: (days) => `${days} ${(days === 1 ? labels.day_units[0] : labels.day_units[1]) ?? ""}`.trim(),
    directionName: (sector) => (sector === UNASSIGNED ? labels.no_direction : (labels.directions[sector] ?? sector)),
    category: (category) => labels.categories[category] ?? category,
    priority: (level) => (level ? (labels.priorities[level] ?? level) : ""),
    tag: (tag) => labels.tags[tag] ?? tag,
    kindName,
  };
}
