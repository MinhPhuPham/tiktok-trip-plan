import { useEffect, useState } from "react";
import { useT } from "../i18n/useT";
import { classes } from "../lib/css";
import type { RoadStatus } from "../routing/router";
import { useRoadStatus } from "../routing/useRoadGeometry";
import { selectStatus, useOnline, useTripStore } from "../state/hooks";
import { Icon } from "./Icon";

const ANNOUNCE_DELAY_MS = 30;
/** Only legs that stay straight get a note; fetching takes a second and draws dashes meanwhile. */
const ROAD_STATUS_KEYS: Readonly<Record<RoadStatus, string | null>> = {
  idle: null,
  loading: null,
  offline: "routes_approximate",
  error: "routes_approximate_failed",
};

/**
 * Offline badge (warning tone, offline icon), transient map status ("Loading Google Maps…",
 * neutral) and a note when edited legs stay approximate, in one fixed slot over the map.
 */
export function StatusPill() {
  const t = useT();
  const online = useOnline();
  const status = useTripStore(selectStatus);
  const roadKey = ROAD_STATUS_KEYS[useRoadStatus()];
  const text = [online ? null : t.t("offline_badge"), status, roadKey ? t.t(roadKey) : null].filter(Boolean).join(" · ");
  const [announced, setAnnounced] = useState("");

  useEffect(() => {
    const wait = window.setTimeout(() => setAnnounced(text), ANNOUNCE_DELAY_MS);
    return () => window.clearTimeout(wait);
  }, [text]);

  return (
    <p className={classes("status-pill", Boolean(text) && "is-shown", !online && "is-offline")} role="status" title={text || undefined}>
      {online ? null : <Icon name="offline" />}
      <span>{announced}</span>
    </p>
  );
}
