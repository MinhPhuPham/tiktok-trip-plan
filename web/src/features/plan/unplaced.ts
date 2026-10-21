import type { PlanUnplaced } from "../../data/types";
import { unplacedText } from "../../data/unplaced";
import type { Translator } from "../../i18n/translator";

/** The export's own text, else the code's label (the shell's for older exports) with the planner's note. */
export function unplacedReason(t: Translator, item: PlanUnplaced): string {
  const own = t.loc(item.reason_text);
  if (own) return own;
  const vi = t.lang === "vi" && "reason_vi" in item && typeof item.reason_vi === "string" ? item.reason_vi.trim() : "";
  const key = `unplaced_${item.code ?? ""}`;
  const label = (item.code && t.labels.unplaced_codes[item.code]) || (item.code && t.has(key) ? t.t(key) : "");
  return unplacedText(label, vi || item.reason, t.lang === "en" || Boolean(vi));
}
