export type Throttle = (signal?: AbortSignal) => Promise<void>;

const abortError = (signal: AbortSignal): DOMException =>
  signal.reason instanceof DOMException ? signal.reason : new DOMException("Aborted", "AbortError");

export const isAbortError = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";

/** Resolves after `ms`, or rejects with the signal's AbortError. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(abortError(signal as AbortSignal));
    };
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** At most one call per `intervalMs`: each caller waits for its own slot, in call order. */
export function createThrottle(intervalMs: number): Throttle {
  let next = 0;
  return (signal) => {
    const now = Date.now();
    const slot = Math.max(now, next);
    next = slot + intervalMs;
    return slot > now ? sleep(slot - now, signal) : signal?.aborted ? sleep(0, signal) : Promise.resolve();
  };
}

/** The public OSRM server's fair-use rate, shared by every request this page sends. */
export const OSRM_INTERVAL_MS = 1000;
export const osrmThrottle: Throttle = createThrottle(OSRM_INTERVAL_MS);

const BACKOFF_BASE_MS = 2000;
const BACKOFF_MAX_MS = 60_000;

/** Wait before the next try after `failures` failed requests in a row: 2 s, 4 s, 8 s, … 60 s. */
export const backoffMs = (failures: number): number =>
  Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1));
