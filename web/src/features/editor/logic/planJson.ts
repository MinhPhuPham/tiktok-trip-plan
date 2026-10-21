/** plan.json in and out. */
import { REST_REF } from "../../../data/types";
import type { EditDay, PlanJson, PlanJsonStop, UnplacedEntry } from "./types";

/** plan.json for planning/schema.py (AgentPlan): stop order, slots and notes, never times. */
export function toPlanJson(days: readonly EditDay[], unplaced: readonly UnplacedEntry[] | null | undefined): PlanJson {
  return {
    days: days.map((day, i) => ({
      day: i + 1,
      stops: day.stops.map((s) => {
        const stop: PlanJsonStop = { ref: s.ref, slot: s.slot || null };
        const reason = (s.reason || "").trim();
        const reasonVi = (s.reason_vi || "").trim();
        if (reason) stop.reason = reason;
        if (reasonVi) stop.reason_vi = reasonVi;
        return stop;
      }),
    })),
    unplaced: (unplaced ?? []).map((u) => ({
      ref: u.ref,
      ...(u.code ? { code: u.code } : {}),
      reason: (u.reason || "").trim(),
    })),
  };
}

export interface SourceStop {
  kind: string;
  ref?: string | null;
  ref_id?: string | null;
  slot?: string | null;
  reason?: string | null;
  reason_vi?: string | null;
}

export interface EditableStop {
  ref: string;
  slot: string | null;
  reason: string;
  reason_vi: string;
}

const EDITABLE_KINDS: ReadonlySet<string> = new Set(["place", "nearby", "rest"]);

/** Places, nearby spots and rests: the stops a plan lists (start and end are computed). */
export const isEditable = (stop: { kind: string }): boolean => EDITABLE_KINDS.has(stop.kind);

/** Editable stops from data.days, dropping the start and end rows. */
export function editableDays(
  days: readonly { stops?: readonly SourceStop[] | null }[] | null | undefined,
): { stops: EditableStop[] }[] {
  return (days ?? []).map((day) => ({
    stops: (day.stops ?? [])
      .filter(isEditable)
      .map((s) => ({
        ref: s.kind === "rest" ? REST_REF : (s.ref ?? s.ref_id ?? ""),
        slot: s.slot || null,
        reason: s.reason || "",
        reason_vi: s.reason_vi || "",
      })),
  }));
}
