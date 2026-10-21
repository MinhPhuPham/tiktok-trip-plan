import { useEffect, useState } from "react";
import { useT } from "../i18n/useT";
import { classes } from "../lib/css";
import { selectStatus, useOnline, useTripStore } from "../state/hooks";
import { Icon } from "./Icon";

const ANNOUNCE_DELAY_MS = 30;

/**
 * Offline badge (warning tone, offline icon) and transient map status ("Loading Google Maps…",
 * neutral) in one fixed slot over the map.
 */
export function StatusPill() {
  const t = useT();
  const online = useOnline();
  const status = useTripStore(selectStatus);
  const text = [online ? null : t.t("offline_badge"), status].filter(Boolean).join(" · ");
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
