import { useCallback, useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { DOM_IDS, focusById } from "../app/ids";
import { useT } from "../i18n/useT";
import { locateBrowser, type LocateBrowser } from "../location/browser";
import { requestCompass } from "../location/heading";
import { isDotShown, type LocateMode } from "../location/locateMachine";
import type { GeoUnavailable } from "../location/locator";
import { useTripActions, useTripStore, useTripStoreApi } from "../state/hooks";
import type { TripState } from "../state/store";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/IconSprite";
import L from "./leaflet";
import type { MapHandle } from "./mapCore";

const TITLE_ID = "locateTitle";

const ICONS: Readonly<Record<LocateMode, IconName>> = {
  off: "locate",
  locating: "locate",
  showing: "locate-fixed",
  following: "locate-fixed",
  denied: "locate-off",
  failed: "locate-off",
};

const HINTS: Readonly<Record<LocateMode, string>> = {
  off: "my_location",
  locating: "locate_finding",
  showing: "locate_centre",
  following: "locate_following",
  denied: "locate_blocked",
  failed: "locate_retry",
};

const ANNOUNCED: Readonly<Partial<Record<LocateMode, string>>> = {
  showing: "locate_shown",
  following: "locate_followed",
  denied: "locate_blocked_title",
};

const selectMode = (s: TripState) => s.locate.mode;
const selectAsked = (s: TripState) => s.locate.mode === "locating" && s.locate.follow;

interface LocateControlProps {
  handle: MapHandle;
  /** Why this page cannot get a position at all; the button then explains instead of asking. */
  unavailable?: GeoUnavailable | null;
}

/** "My location" as a Leaflet control at the bottom right: above the zoom buttons, clear of the top tools. */
export function LocateControl({ handle, unavailable = null }: LocateControlProps) {
  const [element] = useState(createControlElement);
  useEffect(() => {
    const control = new L.Control({ position: "bottomright" });
    control.onAdd = () => element;
    control.addTo(handle.map);
    return () => {
      control.remove();
    };
  }, [handle, element]);
  return createPortal(<LocateTool unavailable={unavailable} />, element);
}

function createControlElement(): HTMLDivElement {
  const element = L.DomUtil.create("div", "leaflet-control locate-control");
  L.DomEvent.disableClickPropagation(element);
  L.DomEvent.disableScrollPropagation(element);
  return element;
}

function LocateTool({ unavailable }: { unavailable: GeoUnavailable | null }) {
  const t = useT();
  const store = useTripStoreApi();
  const mode = useTripStore(selectMode);
  const asked = useTripStore(selectAsked);
  const { locate } = useTripActions();
  const [open, setOpen] = useState(false);
  const closeHelp = useCallback(() => setOpen(false), []);
  const blocked = unavailable != null || mode === "denied";
  if (open && !blocked) setOpen(false);

  /* A prompt refused after a tap opens the help at once: a greyed icon alone does not say why. */
  useEffect(
    () =>
      store.subscribe((state, previous) => {
        if (state.locate.mode === "denied" && previous.locate.mode === "locating" && previous.locate.follow) setOpen(true);
      }),
    [store],
  );

  const onClick = () => {
    if (blocked) {
      setOpen(!open);
      return;
    }
    const compass = mode !== "following" && !asked;
    locate({ type: "tap" });
    if (compass) requestCompass();
  };
  const announced = unavailable ? undefined : asked ? "locate_finding" : ANNOUNCED[mode];

  return (
    <>
      <button
        type="button"
        className="tool locate-tool"
        id={DOM_IDS.locateButton}
        data-mode={unavailable ? "unavailable" : asked ? "asked" : mode}
        aria-label={t.t("my_location")}
        title={t.t(unavailable ? "locate_unavailable" : HINTS[mode])}
        aria-pressed={blocked ? undefined : isDotShown(mode)}
        aria-haspopup={blocked ? "dialog" : undefined}
        aria-expanded={blocked ? open : undefined}
        aria-controls={blocked && open ? DOM_IDS.locatePopover : undefined}
        aria-busy={asked || undefined}
        onClick={onClick}
      >
        <Icon name={unavailable ? "locate-off" : asked ? "spinner" : ICONS[mode]} className={asked ? "icon locate-spin" : "icon"} />
      </button>
      <span className="sr-only" role="status">
        {announced ? t.t(announced) : ""}
      </span>
      {open ? <BlockedHelp reason={unavailable ?? "denied"} onClose={closeHelp} onRetry={() => locate({ type: "retry" })} /> : null}
    </>
  );
}

interface BlockedHelpProps {
  reason: "denied" | GeoUnavailable;
  onClose: () => void;
  onRetry: () => void;
}

/** The help's text keys: why, then the steps to take (most specific case first). */
function helpText(reason: BlockedHelpProps["reason"], browser: LocateBrowser, file: boolean): { why: string; steps: string[] } {
  if (reason === "insecure") return { why: "locate_insecure", steps: [] };
  if (browser.inApp) return { why: "locate_in_app", steps: ["install_in_app_open"] };
  if (reason === "unsupported") return { why: "locate_unsupported", steps: [] };
  if (file) return { why: "locate_blocked_why", steps: ["locate_file"] };
  return { why: "locate_blocked_why", steps: browser.ios ? ["locate_steps_ios"] : ["locate_steps_site", "locate_steps_device"] };
}

/**
 * Why location is blocked (or cannot work on this page) and what to do: the browser is never asked
 * twice by itself; Try again asks once more.
 */
function BlockedHelp({ reason, onClose, onRetry }: BlockedHelpProps) {
  const t = useT();
  const pop = useRef<HTMLDivElement>(null);
  const [browser] = useState(locateBrowser);
  const { why, steps } = helpText(reason, browser, window.location.protocol === "file:");
  const denied = reason === "denied";

  useEffect(() => {
    pop.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, []);

  useEffect(() => {
    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !document.contains(target)) return;
      if (target.closest(`#${DOM_IDS.locatePopover}, #${DOM_IDS.locateButton}`)) return;
      onClose();
    };
    document.addEventListener("click", onDocumentClick);
    return () => document.removeEventListener("click", onDocumentClick);
  }, [onClose]);

  const close = () => {
    onClose();
    focusById(DOM_IDS.locateButton);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    close();
  };
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || event.currentTarget.contains(next)) return;
    if (next instanceof Element && next.id === DOM_IDS.locateButton) return;
    onClose();
  };

  return (
    <div
      ref={pop}
      className="locate-pop"
      id={DOM_IDS.locatePopover}
      role="dialog"
      aria-labelledby={TITLE_ID}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      <h2 id={TITLE_ID}>{t.t(denied ? "locate_blocked_title" : "locate_unavailable_title")}</h2>
      <p>{t.t(why)}</p>
      {steps.length === 1 ? <p>{t.t(steps[0]!)}</p> : null}
      {steps.length > 1 ? (
        <ol className="install-steps">
          {steps.map((key) => (
            <li key={key}>{t.t(key)}</li>
          ))}
        </ol>
      ) : null}
      <div className="install-actions">
        {denied ? (
          <Button
            variant="ghost"
            onClick={() => {
              onRetry();
              focusById(DOM_IDS.locateButton);
            }}
          >
            {t.t("retry")}
          </Button>
        ) : null}
        <Button data-autofocus="" onClick={close}>
          {t.t("close")}
        </Button>
      </div>
    </div>
  );
}
