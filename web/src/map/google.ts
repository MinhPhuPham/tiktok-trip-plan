export interface GoogleCamera {
  center: { lat: number; lng: number };
  zoom: number;
}

export interface GoogleMapLike {
  moveCamera(camera: GoogleCamera): void;
}

interface GoogleMapsApi {
  maps: { Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMapLike };
}

declare global {
  interface Window {
    google?: GoogleMapsApi;
    gm_authFailure?: () => void;
    /** The `callback` in the export's Google Maps script URL (map_html.GOOGLE_CALLBACK). */
    tripGoogleReady?: () => void;
  }
}

const GOOGLE_TIMEOUT_MS = 12000;

export interface GoogleLoad {
  src: string;
  element: HTMLElement;
  camera: () => GoogleCamera;
  onReady: (map: GoogleMapLike) => void;
  /** Script error, timeout, or a key rejected later (gm_authFailure); called at most once. */
  onFail: () => void;
}

interface Waiter {
  ready: () => void;
  fail: () => void;
}

let scriptAdded = false;
let waiter: Waiter | null = null;

/** Loads the Maps JavaScript API once per page and creates a camera-only map under Leaflet; returns a cancel. */
export function loadGoogleMap({ src, element, camera, onReady, onFail }: GoogleLoad): () => void {
  let done = false;
  const fail = () => {
    if (done) return;
    done = true;
    window.clearTimeout(timer);
    onFail();
  };
  const ready = () => {
    const api = window.google;
    if (done || !api) return;
    window.clearTimeout(timer);
    try {
      const view = camera();
      onReady(
        new api.maps.Map(element, {
          center: view.center,
          zoom: view.zoom,
          disableDefaultUI: true,
          gestureHandling: "none",
          keyboardShortcuts: false,
          clickableIcons: false,
          isFractionalZoomEnabled: true,
          colorScheme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "DARK" : "LIGHT",
        }),
      );
    } catch (error) {
      console.warn("[trip] Google Maps failed to start", error);
      fail();
    }
  };
  const timer = window.setTimeout(fail, GOOGLE_TIMEOUT_MS);
  const self: Waiter = { ready, fail };
  waiter = self;
  window.gm_authFailure = () => waiter?.fail();
  window.tripGoogleReady = () => waiter?.ready();
  if (window.google?.maps) {
    ready();
  } else if (!scriptAdded) {
    scriptAdded = true;
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onerror = () => {
      scriptAdded = false;
      script.remove();
      waiter?.fail();
    };
    document.head.append(script);
  }
  return () => {
    done = true;
    window.clearTimeout(timer);
    if (waiter === self) waiter = null;
  };
}
