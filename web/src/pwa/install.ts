import { useSyncExternalStore } from "react";
import { browserInfo, installKind, type InstallHelp } from "./installOffer";

type InstallOutcome = "accepted" | "dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: InstallOutcome }>;
}

export type InstallState =
  | { kind: "unavailable" }
  | { kind: "prompt"; install: () => Promise<InstallOutcome> }
  | { kind: InstallHelp; ios: boolean };

const listeners = new Set<() => void>();
const installedListeners = new Set<() => void>();
let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
let state: InstallState = { kind: "unavailable" };

/** Running as the installed app (an iOS home-screen app's user agent lacks "Safari/", like an in-app browser). */
export const isStandalone = (): boolean =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

function compute(): InstallState {
  const touchMac = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  const { help, ios } = browserInfo(navigator.userAgent, touchMac);
  const kind = installKind({ pwa: __PWA__, installed, standalone: isStandalone(), canPrompt: deferred != null, help });
  const event = deferred;
  if (kind === "unavailable") return { kind };
  if (kind !== "prompt" || !event) return { kind: help, ios };
  return {
    kind,
    install: async () => {
      deferred = null;
      await event.prompt();
      const choice = await event.userChoice.catch(() => ({ outcome: "dismissed" as const }));
      update();
      return choice.outcome;
    },
  };
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
    for (const listener of installedListeners) listener();
  });
  state = compute();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Calls `listener` when the browser reports the app installed (`appinstalled`). */
export function onAppInstalled(listener: () => void): () => void {
  installedListeners.add(listener);
  return () => installedListeners.delete(listener);
}

/** The browser's own install prompt when it fired, else how this browser installs (or cannot). */
export function useInstallState(): InstallState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}
