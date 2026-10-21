import { useSyncExternalStore } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallState =
  | { kind: "unavailable" }
  | { kind: "prompt"; install: () => Promise<void> }
  | { kind: "ios-hint" };

const listeners = new Set<() => void>();
let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
let state: InstallState = { kind: "unavailable" };

const standalone = (): boolean =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

const isIos = (): boolean =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function compute(): InstallState {
  if (!__PWA__ || installed || standalone()) return { kind: "unavailable" };
  if (deferred) {
    const event = deferred;
    return {
      kind: "prompt",
      install: async () => {
        deferred = null;
        await event.prompt();
        await event.userChoice.catch(() => undefined);
        update();
      },
    };
  }
  return isIos() ? { kind: "ios-hint" } : { kind: "unavailable" };
}

function update(): void {
  state = compute();
  for (const listener of listeners) listener();
}

if (__PWA__ && typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    update();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    deferred = null;
    update();
  });
  state = compute();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether to offer an install button (beforeinstallprompt fired) or the iOS share-sheet hint. */
export function useInstallState(): InstallState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}
