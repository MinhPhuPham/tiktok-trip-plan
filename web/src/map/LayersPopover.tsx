import { useEffect, useRef, type ChangeEvent, type FocusEvent } from "react";
import { LanguageSwitch } from "../app/LanguageSwitch";
import { DOM_IDS, focusById } from "../app/ids";
import { useTripModel } from "../data/hooks";
import { useT } from "../i18n/useT";
import { useOverlays, useTripActions, useTripStore } from "../state/hooks";
import type { OverlayKey, TripState } from "../state/store";
import { Icon } from "../ui/Icon";
import { Segmented } from "../ui/Segmented";
import { GOOGLE_ID } from "./basemapChoice";
import { Legend } from "./Legend";

const LANG_LABEL_ID = "popLangLabel";
const TITLE_ID = "layersTitle";

const selectLayersOpen = (s: TripState) => s.layersOpen;
const selectShownBasemap = (s: TripState) => s.activeBasemap ?? s.basemap;
const TABBABLE = 'button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), summary';

const isVisible = (node: HTMLElement): boolean =>
  typeof node.checkVisibility === "function" ? node.checkVisibility() : node.offsetParent !== null;

/** The first control a keyboard user can reach: the language on phones, else the chosen basemap. */
function firstVisibleControl(root: HTMLElement | null): HTMLElement | undefined {
  return [...(root?.querySelectorAll<HTMLElement>(TABBABLE) ?? [])].find(isVisible);
}

/** Focus stayed in the closing popover (or fell to <body>): give it back to the Layers button. */
function returnFocus(pop: HTMLElement | null): void {
  const active = document.activeElement;
  if (!active || active === document.body || pop?.contains(active)) focusById(DOM_IDS.layersButton);
}

interface LayersPopoverProps {
  basemapIds: readonly string[];
  pending: string | null;
  onChoose: (id: string) => void;
}

/** Basemap choice, overlay switches, the language on phones and the legend. */
export function LayersPopover({ basemapIds, pending, onChoose }: LayersPopoverProps) {
  const t = useT();
  const { data } = useTripModel();
  const open = useTripStore(selectLayersOpen);
  const shown = useTripStore(selectShownBasemap);
  const overlays = useOverlays();
  const { setOverlay, setLayersOpen } = useTripActions();
  const pop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    firstVisibleControl(pop.current)?.focus();
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !document.contains(target)) return;
      if (target.closest(`#${DOM_IDS.layersPopover}, #${DOM_IDS.layersButton}`)) return;
      returnFocus(pop.current);
      setLayersOpen(false);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [open, setLayersOpen]);

  /** Tabbing (or clicking a control) out of the popover closes it; focus stays where it went. */
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || event.currentTarget.contains(next)) return;
    if (next instanceof Element && next.id === DOM_IDS.layersButton) return;
    setLayersOpen(false);
  };

  const toggle = (key: OverlayKey) => (event: ChangeEvent<HTMLInputElement>) => setOverlay(key, event.target.checked);
  const options = basemapIds.map((id) => ({
    value: id,
    label: <span className="bm-name">{t.t(`basemap_${id}`)}</span>,
    title: id === GOOGLE_ID ? data.google?.name : data.basemaps.find((b) => b.id === id)?.name,
  }));

  return (
    <div
      ref={pop}
      className={open ? "pop is-entering" : "pop"}
      id={DOM_IDS.layersPopover}
      role="dialog"
      aria-labelledby={TITLE_ID}
      hidden={!open}
      onBlur={onBlur}
    >
      <div className="pop-lang">
        <h3 id={LANG_LABEL_ID}>{t.t("language")}</h3>
        <LanguageSwitch labelledBy={LANG_LABEL_ID} />
      </div>
      <h3 id={TITLE_ID}>{t.t("basemap")}</h3>
      <Segmented
        mode="radio"
        wrap
        options={options}
        value={pending ?? shown}
        onChange={onChoose}
        aria-label={t.t("basemap")}
      />
      <h3>{t.t("overlays")}</h3>
      <label className="check">
        <input type="checkbox" checked={overlays.compass} disabled={!data.center} onChange={toggle("compass")} />
        <span>{t.t("rays_rings")}</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={overlays.nearby} onChange={toggle("nearby")} />
        <span>{t.t("nearby")}</span>
        <span className="muted num">{data.nearby.length}</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={overlays.routes} onChange={toggle("routes")} />
        <span>{t.t("routes")}</span>
      </label>
      <details className="legend-disc">
        <summary>
          <span>{t.t("legend")}</span>
          <Icon name="chevron" className="icon chev" />
        </summary>
        {open ? <Legend /> : null}
      </details>
    </div>
  );
}
