/** Where a new stop goes: its rhythm slot and its position in the day. */
import { restSlot, slotIndex, type EditorContext } from "./context";
import type { EditorNode, EditStop } from "./types";

/** Rhythm slot for a new stop: the first slot for its kind/category not used yet that day. */
export function pickSlot(ctx: EditorContext, node: EditorNode, stops: readonly EditStop[]): string | null {
  if (node.kind === "rest") return restSlot(ctx)?.id ?? null;
  const wanted = node.kind === "place" ? [node.category ?? ""] : ["other"];
  const fits = ctx.rhythm.filter((s) => (s.categories ?? []).some((c) => wanted.includes(c)));
  const first = fits[0];
  if (!first) return null;
  const used = new Set(stops.map((s) => s.slot));
  return (fits.find((s) => !used.has(s.id)) ?? first).id;
}

/** Position that keeps the rhythm order: after the last stop whose slot is not later. */
export function insertIndex(ctx: EditorContext, stops: readonly EditStop[], slot: string | null | undefined): number {
  const target = slotIndex(ctx, slot);
  if (target === null) return stops.length;
  let at = 0;
  stops.forEach((s, i) => {
    const index = slotIndex(ctx, s.slot);
    if (index === null || index <= target) at = i + 1;
  });
  return at;
}
