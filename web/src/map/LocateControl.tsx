import { useCallback, useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { DOM_IDS, focusById } from "../app/ids";
import { useT } from "../i18n/useT";
import { locateBrowser } from "../location/browser";
import { requestCompass } from "../location/heading";
import { iosAppName, locateHelp, type HelpReason } from "../location/locateHelp";
import { isDotShown, type LocateMode, type LocateState } from "../location/locateMachine";
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
const selectProblem = (s: TripState) => s.locate.problem;

/** The help this state explains: a refusal, or no position at all (Location Services off). */
function helpFor({ mode, problem }: Pick<LocateState, "mode" | "problem">): HelpReason | null {
  if (mode === "denied") return problem === "refused" ? "refused" : "blocked";
  return mode === "failed" && problem === "off" ? "off" : null;
}

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
  const problem = useTripStore(selectProblem);
  const { locate } = useTripActions();
  const [open, setOpen] = useState(false);
  const closeHelp = useCallback(() => setOpen(false), []);
  const blocked = unavailable != null || mode === "denied";
  const reason = unavailable ?? helpFor({ mode, problem });
  if (open && !reason) setOpen(false);

  /*
   * A tap that ends refused (with or without a prompt) or with no position opens the help at once:
   * a struck-through icon alone does not say which setting to change.
   */
  useEffect(
    () =>
      store.subscribe((state, previous) => {
        if (helpFor(state.locate) && previous.locate.mode === "locating" && previous.locate.follow) setOpen(true);
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
      {open && reason ? <LocateHelpPopover reason={reason} onClose={closeHelp} onRetry={() => locate({ type: "retry" })} /> : null}
    </>
  );
}

interface LocateHelpProps {
  reason: HelpReason;
  onClose: () => void;
  onRetry: () => void;
}

/**
 * Why location is blocked, off or cannot work on this page, and the settings to change for this
 * browser: the browser is never asked twice by itself; Try again asks once more.
 */
function LocateHelpPopover({ reason, onClose, onRetry }: LocateHelpProps) {
  const t = useT();
  const pop = useRef<HTMLDivElement>(null);
  const [browser] = useState(locateBrowser);
  const help = locateHelp(reason, browser, window.location.protocol === "file:");
  const vars = { app: iosAppName(browser) ?? t.t("locate_this_browser") };
  const { steps } = help;

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
      <h2 id={TITLE_ID}>{t.t(help.title)}</h2>
      <p>{t.t(help.why, vars)}</p>
      {steps.length === 1 ? <p>{t.t(steps[0]!, vars)}</p> : null}
      {steps.length > 1 ? (
        <ol className="install-steps">
          {steps.map((key) => (
            <li key={key}>{t.t(key, vars)}</li>
          ))}
        </ol>
      ) : null}
      {help.privacy ? <p className="locate-privacy">{t.t("locate_privacy")}</p> : null}
      <div className="install-actions">
        {help.retry ? (
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
