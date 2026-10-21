import type { TripModel } from "../../data/model";
import { priorityStars } from "../../data/priority";
import { unplacedText } from "../../data/unplaced";
import type { Translator } from "../../i18n/translator";
import { fmt, type FormatVars } from "../../lib/format";
import { slotById, type EditorContext } from "./logic/context";
import type { IssueWords } from "./logic/issues";
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

const issueWordsCache = new WeakMap<EditorContext, WeakMap<EditorText, IssueWords>>();

/** Everything issueText needs, in the language of `words`. */
export function issueWords(ctx: EditorContext, words: EditorText): IssueWords {
  let byText = issueWordsCache.get(ctx);
  if (!byText) issueWordsCache.set(ctx, (byText = new WeakMap()));
  let issue = byText.get(words);
  if (!issue) {
    issue = {
      t: words.t,
      time: words.time,
      slotName: (id) => {
        const slot = slotById(ctx, id);
        return slot ? slotName(slot, words.lang) : id;
      },
      category: (category) => words.tr.category(category),
      direction: (sector) => words.tr.directionName(sector),
      node: (ref) => ctx.nodes.get(ref),
    };
    byText.set(words, issue);
  }
  return issue;
}

export const restName = (model: TripModel, tr: Translator): string =>
  tr.loc(model.data.rest_name) || editorText(tr).t("rest_stop");

export const centerName = (model: TripModel, tr: Translator): string => tr.loc(model.data.center?.name);

export const starsOf = (place: EditorPlace | undefined): string => (place ? place.stars || priorityStars(place.priority) : "");

/** reason_text for one language of a place the editor left out (its notes are English). */
export const unplacedNote = (model: TripModel, code: string | null, reason: string, language: string): string =>
  unplacedText(model.data.labels[language]?.unplaced_codes[code ?? ""], reason, language === "en");
