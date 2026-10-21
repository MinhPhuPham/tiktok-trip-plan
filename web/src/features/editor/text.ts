import type { TripModel } from "../../data/model";
import { priorityStars } from "../../data/priority";
import { unplacedText } from "../../data/unplaced";
import type { Translator } from "../../i18n/translator";
import { fmt, type FormatVars } from "../../lib/format";
import { FALLBACK_LABELS, type EditorLabelKey } from "./logic/labels";
import type { EditorPlace, RhythmSlot } from "./logic/types";

export interface EditorText {
  lang: string;
  /** labels.ui[key] from the export, else the editor's English fallback. */
  t: (key: EditorLabelKey, vars?: FormatVars) => string;
  time: (min: number) => string;
  tr: Translator;
}

const cache = new WeakMap<Translator, EditorText>();

export function editorText(tr: Translator): EditorText {
  let words = cache.get(tr);
  if (!words) {
    const ui = tr.labels.ui;
    words = {
      lang: tr.lang,
      t: (key, vars) => fmt(ui[key] ?? FALLBACK_LABELS[key], vars),
      time: (min) => tr.time(min),
      tr,
    };
    cache.set(tr, words);
  }
  return words;
}

export const slotName = (slot: RhythmSlot, lang: string): string =>
  (lang === "vi" ? slot.name_vi : slot.name_en) || slot.name_en || slot.id;

export const restName = (model: TripModel, tr: Translator): string =>
  tr.loc(model.data.rest_name) || editorText(tr).t("rest_stop");

export const centerName = (model: TripModel, tr: Translator): string => tr.loc(model.data.center?.name);

export const starsOf = (place: EditorPlace | undefined): string => (place ? place.stars || priorityStars(place.priority) : "");

/** reason_text for one language of a place the editor left out (its notes are English). */
export const unplacedNote = (model: TripModel, code: string | null, reason: string, language: string): string =>
  unplacedText(model.data.labels[language]?.unplaced_codes[code ?? ""], reason, language === "en");
