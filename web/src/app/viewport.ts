export const PHONE_QUERY = "(max-width: 760px)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export const matches = (query: string): boolean =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;

export const prefersReducedMotion = (): boolean => matches(REDUCED_MOTION_QUERY);
