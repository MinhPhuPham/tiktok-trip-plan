import { fold } from "../lib/format";

/**
 * Why a place is out of the plan, the rule of i18n.unplaced_text: the code's label, plus the planner's
 * note when the reader can read it (`noteFits`: English, or a Vietnamese note) and it says more; the
 * note alone without a label.
 */
export function unplacedText(label: string | null | undefined, note: string | null | undefined, noteFits: boolean): string {
  const text = (note ?? "").trim();
  if (!label) return text;
  return text && noteFits && fold(text) !== fold(label) ? `${label} · ${text}` : label;
}
