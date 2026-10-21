import { useState } from "react";
import { useInstallState, type InstallState } from "./install";
import { installEntry, loadInstallSnooze, saveInstallSnooze, type InstallEntry } from "./installOffer";

export interface InstallNudge {
  install: InstallState;
  /** The map's install button: labelled, icon only while "Not now" lasts, or none. */
  entry: InstallEntry;
  /** "Not now": shrink the map's install button to its icon for two weeks (this browser). */
  snooze: () => void;
}

export function useInstallNudge(): InstallNudge {
  const install = useInstallState();
  const [shownAt] = useState(Date.now);
  const [dismissedAt, setDismissedAt] = useState(loadInstallSnooze);
  const snooze = () => {
    const now = Date.now();
    saveInstallSnooze(now);
    setDismissedAt(now);
  };
  return { install, entry: installEntry(install.kind, dismissedAt, shownAt), snooze };
}
