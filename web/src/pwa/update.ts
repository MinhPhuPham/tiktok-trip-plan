import type { SwMessage } from "./constants";

const INSTALL_WAIT_MS = 8000;

function installed(worker: ServiceWorker): Promise<boolean> {
  if (worker.state === "installed") return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(false), INSTALL_WAIT_MS);
    worker.addEventListener("statechange", () => {
      if (worker.state === "installing") return;
      window.clearTimeout(timer);
      resolve(worker.state === "installed");
    });
  });
}

async function waitingWorker(): Promise<ServiceWorker | null> {
  if (!__PWA__ || !("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration().catch(() => undefined);
  if (!registration) return null;
  if (!registration.waiting && !registration.installing) await registration.update().catch(() => undefined);
  if (registration.waiting) return registration.waiting;
  const pending = registration.installing;
  return pending && (await installed(pending)) ? (registration.waiting ?? pending) : null;
}

/**
 * Reloads the page; when a newer service worker is installed (or installs now), it takes over
 * first so the reload gets the new app. Used when trip.json is newer than this app.
 */
export async function reloadWithUpdate(): Promise<void> {
  const worker = await waitingWorker();
  if (!worker) {
    window.location.reload();
    return;
  }
  const reload = () => window.location.reload();
  navigator.serviceWorker.addEventListener("controllerchange", reload, { once: true });
  window.setTimeout(reload, INSTALL_WAIT_MS);
  const message: SwMessage = { type: "SKIP_WAITING" };
  worker.postMessage(message);
}
