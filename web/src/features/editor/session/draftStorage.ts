import { storage } from "../../../lib/storage";
import { editableDays, toPlanJson, type EditableStop } from "../logic/planJson";
import { hashText } from "../logic/text";

/**
 * Saved editor drafts, one per trip (state/persist.ts tripStorageId), versioned like state/persist.ts. The old app's key
 * (trip-plan-draft:<city>, payload v1 or v2) is read as a fallback so an upgrade keeps the edits.
 */
export const DRAFT_VERSION = 2;
export const draftKey = (city: string) => `tripmap:v${DRAFT_VERSION}:draft:${city}`;
const legacyKey = (city: string) => `trip-plan-draft:${city}`;

interface PlanSource {
  days: Parameters<typeof editableDays>[0];
  travel?: { ids: readonly string[] } | null;
}

/** Hash of the generated plan (stops, slots, notes and the travel matrix ids) a draft is made from. */
export const draftBasis = (data: PlanSource): string =>
  hashText(JSON.stringify(toPlanJson(editableDays(data.days), [])) + (data.travel ? data.travel.ids.join() : ""));

export interface UnplacedNote {
  code: string | null;
  reason: string;
}

export type UnplacedNotes = Readonly<Record<string, UnplacedNote>>;

export interface StoredDraft {
  v: number;
  /** Hash of the generated plan the draft was made from; a different one makes the draft stale. */
  basis: string;
  savedAt: string;
  days: { stops: EditableStop[] }[];
  /** v2: why each left-out place is out. */
  unplaced?: UnplacedNotes;
  /** v1: a free-text reason per left-out place. */
  reasons?: Readonly<Record<string, string>>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object";
const text = (value: unknown): string => (typeof value === "string" ? value : "");

function parseStop(raw: unknown): EditableStop | null {
  if (!isRecord(raw) || typeof raw.ref !== "string") return null;
  return { ref: raw.ref, slot: text(raw.slot) || null, reason: text(raw.reason), reason_vi: text(raw.reason_vi) };
}

function parseNotes(raw: unknown): UnplacedNotes | undefined {
  if (!isRecord(raw)) return undefined;
  const out: Record<string, UnplacedNote> = {};
  for (const [ref, note] of Object.entries(raw)) {
    if (isRecord(note)) out[ref] = { code: text(note.code) || null, reason: text(note.reason) };
  }
  return out;
}

function parseReasons(raw: unknown): Record<string, string> | undefined {
  if (!isRecord(raw)) return undefined;
  return Object.fromEntries(Object.entries(raw).map(([ref, reason]) => [ref, text(reason)]));
}

function parseDraft(raw: unknown): StoredDraft | null {
  if (!isRecord(raw) || (raw.v !== DRAFT_VERSION && raw.v !== 1) || !Array.isArray(raw.days)) return null;
  return {
    v: raw.v,
    basis: text(raw.basis),
    savedAt: text(raw.savedAt),
    days: raw.days.map((day: unknown) => ({
      stops: isRecord(day) && Array.isArray(day.stops) ? day.stops.map(parseStop).filter((s) => s !== null) : [],
    })),
    unplaced: parseNotes(raw.unplaced),
    reasons: parseReasons(raw.reasons),
  };
}

export function readDraft(city: string): StoredDraft | null {
  return storage.read(draftKey(city), parseDraft) ?? storage.read(legacyKey(city), parseDraft);
}

/** For the boot loader: a saved draft made from this generated plan, which the session would apply. */
export function hasCurrentDraft(city: string, basis: string): boolean {
  return readDraft(city)?.basis === basis;
}

/** False when the browser refuses (private mode, quota). */
export function writeDraft(city: string, draft: StoredDraft): boolean {
  if (!storage.write(draftKey(city), draft)) return false;
  storage.remove(legacyKey(city));
  return true;
}

export function removeDraft(city: string): void {
  storage.remove(draftKey(city));
  storage.remove(legacyKey(city));
}
