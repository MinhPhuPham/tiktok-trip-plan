import type { LatLng } from "../map/polyline";

const KEY_DIGITS = 5;
const DB_NAME = "trip-roads-v1";
const DB_VERSION = 1;
const STORE = "legs";
const USED_INDEX = "used";
export const LEG_CACHE_LIMIT = 2000;
/** Pruning goes a little below the limit so it does not run after every write. */
const PRUNE_RATIO = 0.9;

/** One leg's road as stored: any trip, any export, keyed by server, profile and rounded end points. */
export interface CachedLeg {
  key: string;
  points: string;
  durationS: number | null;
  distanceM: number | null;
  noRoute: boolean;
  /** Last read or write (ms since epoch); the least recently used legs are pruned first. */
  used: number;
}

export interface LegStore {
  getMany: (keys: readonly string[]) => Promise<Map<string, CachedLeg>>;
  putMany: (legs: readonly CachedLeg[]) => Promise<void>;
}

const round = (value: number): string => (Math.round(value * 10 ** KEY_DIGITS) / 10 ** KEY_DIGITS).toFixed(KEY_DIGITS);

/** "lat,lng" at 5 decimals (about a metre), without "-0". */
export const coordText = ([lat, lng]: readonly [number, number]): string => `${round(lat)},${round(lng)}`;

export const samePoint = (a: { lat: number; lng: number }, b: { lat: number; lng: number }): boolean =>
  coordText([a.lat, a.lng]) === coordText([b.lat, b.lng]);

export const legCacheKey = (base: string, from: LatLng, to: LatLng): string => `${base}|${coordText(from)}|${coordText(to)}`;

const isCachedLeg = (value: unknown): value is CachedLeg =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as CachedLeg).key === "string" &&
  typeof (value as CachedLeg).points === "string" &&
  typeof (value as CachedLeg).noRoute === "boolean";

function settled<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = factory.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE, { keyPath: "key" }).createIndex(USED_INDEX, USED_INDEX);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function prune(db: IDBDatabase, limit: number): Promise<void> {
  const transaction = db.transaction(STORE, "readwrite");
  const store = transaction.objectStore(STORE);
  let excess = (await settled(store.count())) - Math.floor(limit * PRUNE_RATIO);
  if (excess > Math.floor(limit * (1 - PRUNE_RATIO))) {
    const cursors = store.index(USED_INDEX).openCursor();
    cursors.onsuccess = () => {
      const cursor = cursors.result;
      if (!cursor || excess <= 0) return;
      cursor.delete();
      excess -= 1;
      cursor.continue();
    };
  }
  await committed(transaction);
}

/**
 * Legs in IndexedDB, shared by every trip this origin opens. Every failure (private mode, blocked
 * storage, file:// without IndexedDB) reads as an empty cache and a dropped write.
 */
export function indexedDbLegStore(factory: IDBFactory | undefined = globalThis.indexedDB, limit = LEG_CACHE_LIMIT): LegStore {
  let database: Promise<IDBDatabase | null> | null = null;
  const open = () => (database ??= factory ? openDatabase(factory) : Promise.resolve(null));

  const getMany = async (keys: readonly string[]): Promise<Map<string, CachedLeg>> => {
    const found = new Map<string, CachedLeg>();
    const db = keys.length ? await open() : null;
    if (!db) return found;
    try {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      const used = Date.now();
      for (const key of keys) {
        const request = store.get(key);
        request.onsuccess = () => {
          const leg: unknown = request.result;
          if (!isCachedLeg(leg)) return;
          found.set(key, leg);
          store.put({ ...leg, used });
        };
      }
      await committed(transaction);
    } catch {
      return new Map();
    }
    return found;
  };

  const putMany = async (legs: readonly CachedLeg[]): Promise<void> => {
    const db = legs.length ? await open() : null;
    if (!db) return;
    try {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      for (const leg of legs) store.put(leg);
      await committed(transaction);
      await prune(db, limit);
    } catch {
      /* the in-memory copy still serves this session */
    }
  };

  return { getMany, putMany };
}

/** A LegStore that lives as long as the page (tests, and where IndexedDB is missing). */
export function memoryLegStore(initial: readonly CachedLeg[] = []): LegStore & { legs: Map<string, CachedLeg> } {
  const legs = new Map(initial.map((leg) => [leg.key, leg]));
  return {
    legs,
    getMany: (keys) => Promise.resolve(new Map(keys.flatMap((key) => {
      const leg = legs.get(key);
      return leg ? [[key, leg] as const] : [];
    }))),
    putMany: (items) => {
      for (const leg of items) legs.set(leg.key, leg);
      return Promise.resolve();
    },
  };
}
