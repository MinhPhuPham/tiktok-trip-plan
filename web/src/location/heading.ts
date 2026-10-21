type OrientationEventClass = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<PermissionState> };

interface CompassReading {
  alpha: number | null;
  absolute: boolean;
  webkitCompassHeading?: number;
}

let compassAllowed: Promise<boolean> | null = null;

const orientationClass = (): OrientationEventClass | null =>
  typeof DeviceOrientationEvent === "undefined" ? null : DeviceOrientationEvent;

/**
 * iOS asks for motion access per page, and only from a tap: call this inside the locate tap, after
 * geolocation has been asked (location never waits for or depends on it). Asks at most once per
 * page (a refusal is final); elsewhere there is nothing to ask. Never throws.
 */
export function requestCompass(): void {
  const ask = orientationClass()?.requestPermission;
  if (!ask || compassAllowed) return;
  try {
    compassAllowed = Promise.resolve(ask.call(DeviceOrientationEvent)).then(
      (state) => state === "granted",
      () => false,
    );
  } catch {
    compassAllowed = Promise.resolve(false);
  }
}

function compassUsable(): Promise<boolean> {
  const events = orientationClass();
  if (!events) return Promise.resolve(false);
  return events.requestPermission ? (compassAllowed ?? Promise.resolve(false)) : Promise.resolve(true);
}

/** Degrees clockwise from north the top of the screen points to, or null without a compass reading. */
export function compassHeading(event: CompassReading, screenAngle: number): number | null {
  let heading: number;
  if (typeof event.webkitCompassHeading === "number" && Number.isFinite(event.webkitCompassHeading)) {
    heading = event.webkitCompassHeading;
  } else if (event.absolute && event.alpha != null) {
    heading = 360 - event.alpha;
  } else {
    return null;
  }
  return (((heading + screenAngle) % 360) + 360) % 360;
}

const screenAngle = (): number => (typeof screen !== "undefined" ? (screen.orientation?.angle ?? 0) : 0);

/** Calls `onHeading` at most once a frame while the device reports a compass heading; returns the stop. */
export function watchHeading(onHeading: (degrees: number) => void): () => void {
  let stopped = false;
  let frame = 0;
  let latest = 0;
  let detach = (): void => undefined;
  void compassUsable().then((usable) => {
    if (!usable || stopped) return;
    const type = "ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation";
    const onEvent = (event: Event) => {
      const heading = compassHeading(event as DeviceOrientationEvent & CompassReading, screenAngle());
      if (heading == null) return;
      latest = heading;
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          onHeading(latest);
        });
      }
    };
    window.addEventListener(type, onEvent, { passive: true });
    detach = () => window.removeEventListener(type, onEvent);
  });
  return () => {
    stopped = true;
    detach();
    cancelAnimationFrame(frame);
  };
}
