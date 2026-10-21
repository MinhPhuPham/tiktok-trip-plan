import { useSyncExternalStore } from "react";
import type * as Checks from "../features/editor/planNotes";
import { useT } from "../i18n/useT";
import { useTripModel, useTripPlan } from "./hooks";
import type { TripStop } from "./types";

export type NoteLevel = "error" | "warning";

/** One plan check result in the current language; `day` is the plan day it belongs to. */
export interface PlanNote {
  level: NoteLevel;
  text: string;
  day: number;
}

export interface StopNotes {
  /** "error" when any note is one. */
  level: NoteLevel;
  notes: readonly PlanNote[];
  /** "1 problem: …", the stop's flag as one accessible name. */
  label: string;
}

/** The checks of the plan as shown, per stop (by identity) and per card target id. */
export interface PlanIssues {
  byStop: ReadonlyMap<TripStop, StopNotes>;
  byTarget: ReadonlyMap<string, readonly PlanNote[]>;
}

let checks: typeof Checks | null = null;
let loading = false;
const listeners = new Set<() => void>();

const whenIdle = (run: () => void): void => {
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(run, { timeout: 2000 });
  else window.setTimeout(run, 1);
};

/** The checks are the editor's logic: a lazy chunk, fetched once the page is idle. */
function load(): void {
  if (loading || checks) return;
  loading = true;
  whenIdle(() => {
    import("../features/editor/planNotes").then(
      (module) => {
        checks = module;
        for (const listener of listeners) listener();
      },
      () => {
        loading = false;
      },
    );
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  load();
  return () => listeners.delete(listener);
}

const loaded = (): boolean => checks !== null;

/** Null until the checks chunk has loaded; computed once per plan and language. */
export function usePlanIssues(): PlanIssues | null {
  const ready = useSyncExternalStore(subscribe, loaded, loaded);
  const model = useTripModel();
  const plan = useTripPlan();
  const t = useT();
  return ready && checks ? checks.planIssues(model, plan, t) : null;
}

const NONE: readonly PlanNote[] = [];

export const useStopNotes = (stop: TripStop): StopNotes | null => usePlanIssues()?.byStop.get(stop) ?? null;

export const useTargetNotes = (id: string): readonly PlanNote[] => usePlanIssues()?.byTarget.get(id) ?? NONE;
