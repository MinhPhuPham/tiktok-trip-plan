import { useSyncExternalStore } from "react";

const DARK_QUERY = "(prefers-color-scheme: dark)";

const darkQuery = (): MediaQueryList | null =>
  typeof window.matchMedia === "function" ? window.matchMedia(DARK_QUERY) : null;

function subscribe(onChange: () => void): () => void {
  const query = darkQuery();
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

const snapshot = (): "dark" | "light" => (darkQuery()?.matches ? "dark" : "light");

/** "dark" or "light": canvas layers read their colours from CSS tokens and redraw when it flips. */
export function useColorScheme(): "dark" | "light" {
  return useSyncExternalStore(subscribe, snapshot, () => "light");
}
