import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { DOM_IDS, focusById } from "../../app/ids";
import { useNow } from "../../app/useNow";
import { useToggleHidden } from "../../app/useToggleHidden";
import { useTripModel, useTripPlan } from "../../data/hooks";
import type { Target } from "../../data/model";
import { useTargetNotes, type PlanNote } from "../../data/planIssues";
import { useT } from "../../i18n/useT";
import { useDistanceFromUser } from "../../location/useDistanceFromUser";
import { useIsHidden, useSelectedId, useTripActions, useTripStoreApi } from "../../state/hooks";
import type { TripStoreApi } from "../../state/store";
import { Icon } from "../../ui/Icon";
import { PlaceDetails } from "./PlaceDetails";
import { CenterDetails, NearbyDetails } from "./SpotDetails";
import "./card.css";

/** The card for the selected place, nearby spot or center, over the map. */
export function PlaceCard() {
  const model = useTripModel();
  const selected = useSelectedId();
  const { closeCard } = useTripActions();
  const target = model.target(selected);
  const shownId = target?.id ?? null;
  useCardFocus(shownId);

  const stale = selected != null && shownId == null;
  useEffect(() => {
    if (stale) closeCard();
  }, [stale, closeCard]);

  return target ? <OpenCard target={target} onClose={closeCard} /> : null;
}

interface OpenCardProps {
  target: Target;
  onClose: () => void;
}

function OpenCard({ target, onClose }: OpenCardProps) {
  const t = useT();
  return (
    <section
      className="card is-entering"
      id={DOM_IDS.card}
      role="dialog"
      aria-labelledby={DOM_IDS.cardTitle}
      tabIndex={-1}
    >
      <button type="button" className="card-close" title={t.t("close")} onClick={onClose}>
        <Icon name="x" />
        <span className="sr-only">{t.t("close")}</span>
      </button>
      <div className="card-body">
        <CardBody target={target} />
      </div>
    </section>
  );
}

function CardBody({ target }: { target: Target }) {
  const model = useTripModel();
  const t = useT();
  const notes = useTargetNotes(target.id);
  const travelmode = model.data.config.travelmode;
  if (target.type === "place") return <PlaceBody target={target} notes={notes} />;
  if (target.type === "nearby") return <NearbyDetails t={t} travelmode={travelmode} spot={target.item} notes={notes} />;
  return <CenterDetails t={t} travelmode={travelmode} center={target.item} notes={notes} />;
}

function PlaceBody({ target, notes }: { target: Extract<Target, { type: "place" }>; notes: readonly PlanNote[] }) {
  const model = useTripModel();
  const plan = useTripPlan();
  const t = useT();
  const now = useNow();
  const hidden = useIsHidden(target.id);
  const fromUser = useDistanceFromUser(target.item);
  const toggleHidden = useToggleHidden();
  const [photosOpen, setPhotosOpen] = useState<ReadonlySet<string>>(() => new Set());
  return (
    <PlaceDetails
      model={model}
      plan={plan}
      t={t}
      place={target.item}
      notes={notes}
      hidden={hidden}
      fromUser={fromUser}
      now={now}
      photosExpanded={photosOpen.has(target.id)}
      onExpandPhotos={() => setPhotosOpen((prev) => new Set(prev).add(target.id))}
      onToggleHidden={() => toggleHidden(target.id)}
    />
  );
}

/**
 * Opening focuses the title and remembers where focus was; closing returns it there (on phones,
 * to the "Next" row or the sheet handle when that spot is gone or inert).
 */
function useCardFocus(id: string | null): void {
  const store = useTripStoreApi();
  const origin = useRef<HTMLElement | null>(null);
  const shown = useRef<string | null>(null);
  useLayoutEffect(() => {
    const previous = shown.current;
    shown.current = id;
    if (id) {
      const card = document.getElementById(DOM_IDS.card);
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body && !card?.contains(active)) origin.current = active;
      if (card) card.scrollTop = 0;
      focusById(DOM_IDS.cardTitle);
      return;
    }
    if (previous) restoreFocus(store, origin.current);
    origin.current = null;
  }, [id, store]);
}

function restoreFocus(store: TripStoreApi, back: HTMLElement | null): void {
  const active = document.activeElement;
  if (active && active !== document.body) return;
  if (back?.isConnected && !back.closest("[inert]")) {
    back.focus({ preventScroll: true });
  } else if (store.getState().phone) {
    if (!focused(DOM_IDS.peekNext)) focusById(DOM_IDS.sheetToggle);
  } else {
    focusById(DOM_IDS.map);
  }
}

function focused(id: string): boolean {
  focusById(id);
  return document.activeElement?.id === id;
}
