import { prefersReducedMotion } from "../app/viewport";
import { watchHeading } from "../location/heading";
import { isDotShown } from "../location/locateMachine";
import type { UserFix } from "../location/position";
import type { TripStoreApi } from "../state/store";
import L from "./leaflet";
import { FLY_ZOOM, setLayerOn, USER_PANE, watch } from "./mapCore";
import { centringPan, overlayShift } from "./overlayShift";
import {
  accuracyShown,
  FOLLOW_INTERVAL_MS,
  FOLLOW_TOLERANCE_PX,
  metersPerPixel,
  USER_DOT_HTML,
  USER_DOT_SIZE,
} from "./userDot";
import { mapOverlays } from "./visibleArea";

const CENTRE_SECONDS = 0.6;
const FOLLOW_SECONDS = 0.5;
/** The sheet settles in about this long; a following map then recentres in the new free area. */
const SHEET_SETTLE_MS = 320;
const USER_INPUT = ["pointerdown", "touchstart", "wheel", "keydown"] as const;

/**
 * The blue dot (accuracy circle, pulsing halo, heading cone) in its own click-through pane, and the
 * follow camera: entering "following" centres the dot in the free part of the map (zoom 15 or
 * closer), later fixes pan to it at most once a second when it drifts more than FOLLOW_TOLERANCE_PX.
 * Any camera move this layer did not start (a drag, a pinch, the wheel, keys, a fly to a place)
 * ends following; the dot stays.
 */
export function startUserLayer(map: L.Map, store: TripStoreApi): () => void {
  const renderer = L.svg({ pane: USER_PANE, padding: 0.5 });
  const circle = L.circle([0, 0], { radius: 1, renderer, interactive: false, className: "user-acc", weight: 1 });
  const half = USER_DOT_SIZE / 2;
  const marker = L.marker([0, 0], {
    pane: USER_PANE,
    interactive: false,
    keyboard: false,
    icon: L.divIcon({ className: "user-loc-wrap", html: USER_DOT_HTML, iconSize: [USER_DOT_SIZE, USER_DOT_SIZE], iconAnchor: [half, half] }),
  });
  const container = map.getContainer();
  let compass: number | null = null;
  let stopCompass: (() => void) | null = null;
  let own = false;
  let lastFollow = 0;
  let followTimer: number | undefined;
  let sheetTimer: number | undefined;

  const shownFix = (): UserFix | null => {
    const { userFix, locate } = store.getState();
    return userFix && isDotShown(locate.mode) ? userFix : null;
  };

  const drawAccuracy = () => {
    const fix = shownFix();
    const size = map.getSize();
    const radiusPx = fix ? fix.accuracy / metersPerPixel(fix.lat, map.getZoom()) : 0;
    setLayerOn(map, circle, fix != null && accuracyShown(fix.accuracy, radiusPx, [size.x, size.y]));
  };

  const drawHeading = () => {
    const heading = shownFix()?.heading ?? compass;
    const element = marker.getElement();
    if (!element) return;
    element.classList.toggle("has-heading", heading != null);
    if (heading != null) element.style.setProperty("--heading", `${Math.round(heading)}deg`);
  };

  const draw = () => {
    const fix = shownFix();
    if (fix) {
      marker.setLatLng([fix.lat, fix.lng]);
      circle.setLatLng([fix.lat, fix.lng]).setRadius(fix.accuracy);
    }
    setLayerOn(map, marker, fix != null);
    if (fix && !stopCompass) {
      stopCompass = watchHeading((degrees) => {
        compass = degrees;
        drawHeading();
      });
    } else if (!fix && stopCompass) {
      stopCompass();
      stopCompass = null;
      compass = null;
    }
    drawAccuracy();
    drawHeading();
  };

  /* Stopping a running move first lets its moveend pass before this move claims the camera. */
  const ownMove = (move: () => void) => {
    map.stop();
    own = true;
    move();
  };

  const visibleShift = () => {
    const { phone, sheet } = store.getState();
    return overlayShift(phone, mapOverlays(map, phone, sheet));
  };

  const centre = () => {
    const fix = shownFix();
    if (!fix) return;
    const zoom = Math.max(map.getZoom(), FLY_ZOOM);
    const shift = visibleShift();
    lastFollow = Date.now();
    if (zoom === map.getZoom()) {
      const pin = map.latLngToContainerPoint([fix.lat, fix.lng]);
      const size = map.getSize();
      const offset = centringPan([pin.x, pin.y], [size.x, size.y], shift, 2);
      if (offset) ownMove(() => map.panBy(offset, { animate: !prefersReducedMotion(), duration: CENTRE_SECONDS }));
      return;
    }
    const target = map.unproject(map.project([fix.lat, fix.lng], zoom).add(shift), zoom);
    ownMove(() =>
      prefersReducedMotion() ? map.setView(target, zoom, { animate: false }) : map.flyTo(target, zoom, { duration: CENTRE_SECONDS }),
    );
  };

  const follow = () => {
    window.clearTimeout(followTimer);
    const fix = shownFix();
    if (!fix || store.getState().locate.mode !== "following") return;
    const wait = lastFollow + FOLLOW_INTERVAL_MS - Date.now();
    if (wait > 0) {
      followTimer = window.setTimeout(follow, wait);
      return;
    }
    const pin = map.latLngToContainerPoint([fix.lat, fix.lng]);
    const size = map.getSize();
    const offset = centringPan([pin.x, pin.y], [size.x, size.y], visibleShift(), FOLLOW_TOLERANCE_PX);
    if (!offset) return;
    lastFollow = Date.now();
    ownMove(() => map.panBy(offset, { animate: !prefersReducedMotion(), duration: FOLLOW_SECONDS, easeLinearity: 0.5 }));
  };

  const onMoveStart = () => {
    if (!own) store.getState().actions.locate({ type: "pan" });
  };
  const onMoveEnd = () => {
    own = false;
  };
  const onDragStart = () => {
    own = false;
    store.getState().actions.locate({ type: "pan" });
  };
  /* The user's hand on the map: whatever moves next is theirs, even mid-flight of our own move. */
  const onUserInput = () => {
    own = false;
  };
  map.on("movestart", onMoveStart);
  map.on("moveend", onMoveEnd);
  map.on("dragstart", onDragStart);
  map.on("zoomend resize", drawAccuracy);
  for (const type of USER_INPUT) container.addEventListener(type, onUserInput, { passive: true, capture: true });

  /* Before the fix watch: the first fix's centring sets lastFollow, so that fix does not also pan. */
  const stopMode = watch(
    store,
    (s) => s.locate.mode,
    (mode, previous) => {
      draw();
      if (mode === "following" && previous !== "following") centre();
    },
  );
  const stopFix = watch(
    store,
    (s) => s.userFix,
    () => {
      draw();
      follow();
    },
  );
  const stopSheet = watch(
    store,
    (s) => s.sheet,
    (_sheet, previous) => {
      if (previous === undefined) return;
      window.clearTimeout(sheetTimer);
      sheetTimer = window.setTimeout(() => {
        lastFollow = 0;
        follow();
      }, SHEET_SETTLE_MS);
    },
  );

  return () => {
    stopFix();
    stopMode();
    stopSheet();
    stopCompass?.();
    window.clearTimeout(followTimer);
    window.clearTimeout(sheetTimer);
    map.off("movestart", onMoveStart);
    map.off("moveend", onMoveEnd);
    map.off("dragstart", onDragStart);
    map.off("zoomend resize", drawAccuracy);
    for (const type of USER_INPUT) container.removeEventListener(type, onUserInput, { capture: true });
    map.removeLayer(marker);
    map.removeLayer(circle);
  };
}
