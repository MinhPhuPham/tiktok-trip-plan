import type { Translator } from "../../i18n/translator";

/** "1 stop" / "13 stops" in the current language. */
export const stopCount = (t: Translator, n: number): string => t.t(n === 1 ? "stop_1" : "stops", { n });
