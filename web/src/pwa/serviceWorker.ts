import { Workbox } from "workbox-window";
import { OFFLINE_MANIFEST_URL, isOfflineManifest, type SwMessage } from "./constants";

export interface ServiceWorkerHandlers {
  /** A new version is installed and waiting; call `apply` to switch to it (the page reloads). */
  onUpdateReady(apply: () => void): void;
}

const serviceWorkerSupported = (): boolean =>
  __PWA__ && "serviceWorker" in navigator && window.isSecureContext;

/** Registers sw.js (app build only, https or localhost) and asks it to warm the offline cache. */
export function registerServiceWorker(handlers: ServiceWorkerHandlers): void {
  if (!__PWA__ || !serviceWorkerSupported()) return;
  const wb = new Workbox("sw.js");
  wb.addEventListener("waiting", () => {
    handlers.onUpdateReady(() => {
      wb.addEventListener("controlling", () => window.location.reload());
      wb.messageSkipWaiting();
    });
  });
  wb.register()
    .then(() => {
      void navigator.storage?.persist?.().catch(() => undefined);
      return warmOfflineCache();
    })
    .catch((error: unknown) => console.warn("[trip] service worker not registered", error));
}

/** Sends offline.json (version + media URLs) to the active worker; it downloads what changed. */
export async function warmOfflineCache(): Promise<void> {
  if (!__PWA__ || !serviceWorkerSupported() || !navigator.serviceWorker.controller || !navigator.onLine) return;
  const response = await fetch(OFFLINE_MANIFEST_URL, { cache: "no-cache" }).catch(() => null);
  const manifest: unknown = response?.ok ? await response.json().catch(() => null) : null;
  if (!isOfflineManifest(manifest)) return;
  const registration = await navigator.serviceWorker.ready;
  const message: SwMessage = { type: "WARM_OFFLINE", ...manifest };
  registration.active?.postMessage(message);
}
