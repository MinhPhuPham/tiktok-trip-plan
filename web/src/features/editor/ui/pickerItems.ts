import { priorityRank } from "../../../data/priority";
import type { Translator } from "../../../i18n/translator";
import { fold } from "../../../lib/format";
import { weekdayOf, type EditorContext } from "../logic/context";
import { countRefs } from "../logic/coverage";
import { matchesQuery } from "../logic/text";
import type { EditorNode } from "../logic/types";
import type { Days, PickerState } from "../session/session";

export interface PickItem {
  node: EditorNode;
  /** Day index the node is planned in, else null. */
  day: number | null;
  weekday: number;
}

const searchCache = new WeakMap<EditorContext, Map<string, string>>();

/** Folded name, address, dishes, category and tag labels of a node, cached per language. */
function searchText(ctx: EditorContext, tr: Translator, node: EditorNode): string {
  let byKey = searchCache.get(ctx);
  if (!byKey) searchCache.set(ctx, (byKey = new Map<string, string>()));
  const key = `${tr.lang}\u0000${node.ref}`;
  let text = byKey.get(key);
  if (text === undefined) {
    const place = node.place;
    text = fold(
      [
        node.name,
        place?.address ?? "",
        (place?.must_try ?? []).join(" "),
        node.category ? tr.category(node.category) : "",
        (place?.tags ?? []).map((tag) => tr.labels.tags[tag] || tag).join(" "),
      ].join(" "),
    );
    byKey.set(key, text);
  }
  return text;
}

export function plannedDays(days: Days): Map<string, number> {
  const out = new Map<string, number>();
  days.forEach((day, d) => {
    for (const stop of day.stops) if (!out.has(stop.ref)) out.set(stop.ref, d);
  });
  return out;
}

export function pickerSource(ctx: EditorContext, tab: PickerState["tab"]): EditorNode[] {
  const kind = tab === "nearby" ? "nearby" : "place";
  return [...ctx.nodes.values()].filter((n) => n.kind === kind);
}

const rankOf = (node: EditorNode): number => priorityRank(node.place?.priority);

export function pickerItems(
  ctx: EditorContext,
  tr: Translator,
  picker: Omit<PickerState, "open" | "query">,
  query: string,
  planned: ReadonlyMap<string, number>,
): PickItem[] {
  const q = query.trim();
  const weekday = weekdayOf(ctx, picker.day);
  return pickerSource(ctx, picker.tab)
    .filter((n) => {
      if (q && !matchesQuery(searchText(ctx, tr, n), q)) return false;
      if (picker.unplannedOnly && planned.has(n.ref)) return false;
      if (n.kind !== "place") return true;
      const priority = n.place?.priority;
      if (picker.priority === "must" && priority !== "must") return false;
      if (picker.priority === "high" && priority !== "must" && priority !== "high") return false;
      if (picker.category && n.category !== picker.category) return false;
      if (picker.tag && !(n.place?.tags ?? []).includes(picker.tag)) return false;
      return true;
    })
    .sort((a, b) => rankOf(a) - rankOf(b) || a.name.localeCompare(b.name))
    .map((node) => ({ node, day: planned.get(node.ref) ?? null, weekday }));
}

/** Categories present among the places, and the ten most used tags. */
export function pickerFilters(ctx: EditorContext): { categories: string[]; tags: string[] } {
  const places = pickerSource(ctx, "places");
  const categories = [...new Set(places.map((n) => n.category ?? "other"))];
  const counts = countRefs(places.flatMap((n) => n.place?.tags ?? []));
  const tags = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag]) => tag);
  return { categories, tags };
}
