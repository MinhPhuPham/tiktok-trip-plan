import { useTripModel } from "../data/hooks";
import type { TripModel } from "../data/model";
import { useLang } from "../state/hooks";
import { createTranslator, type Translator } from "./translator";

const cache = new WeakMap<TripModel, Map<string, Translator>>();

/** One translator per trip and language, shared by every caller. */
export function getTranslator(model: TripModel, lang: string): Translator {
  let byLang = cache.get(model);
  if (!byLang) cache.set(model, (byLang = new Map<string, Translator>()));
  let translator = byLang.get(lang);
  if (!translator) {
    const labels = model.data.labels[lang] ?? model.data.labels.en ?? Object.values(model.data.labels)[0];
    if (!labels) throw new Error("trip.json has no labels");
    byLang.set(lang, (translator = createTranslator(labels, lang)));
  }
  return translator;
}

/** The translator for the current language: `const t = useT(); t.t("plan")`, `t.dayName(2)`. */
export function useT(): Translator {
  return getTranslator(useTripModel(), useLang());
}
