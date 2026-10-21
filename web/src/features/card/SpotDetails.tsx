import { DOM_IDS } from "../../app/ids";
import { directionsTo } from "../../data/plan";
import type { MapCenter, MapNearby } from "../../data/types";
import type { Translator } from "../../i18n/translator";
import { ExternalLink } from "../../ui/ExternalLink";

interface SpotProps {
  t: Translator;
  travelmode: string;
}

export function NearbyDetails({ t, travelmode, spot }: SpotProps & { spot: MapNearby }) {
  const kind = t.loc(spot.kind_label) || t.kindName(spot.kind);
  return (
    <>
      <div className="card-top">{t.t("nearby")}</div>
      <h2 className="card-title" id={DOM_IDS.cardTitle} tabIndex={-1}>
        {spot.name}
      </h2>
      <p className="card-meta num">{[kind, spot.rating != null ? spot.rating.toFixed(1) : ""].filter(Boolean).join(" · ")}</p>
      <div className="card-actions">
        <ExternalLink href={spot.maps_url} variant="primary" icon="external">
          {t.t("open_maps")}
        </ExternalLink>
        <ExternalLink href={directionsTo(spot.lat, spot.lng, travelmode)} variant="ghost" icon="route">
          {t.labels.directions_link}
        </ExternalLink>
      </div>
    </>
  );
}

export function CenterDetails({ t, travelmode, center }: SpotProps & { center: MapCenter }) {
  const source = t.loc(center.source);
  return (
    <>
      <div className="card-top">{source ? `${t.t("center")}: ${source}` : t.t("center")}</div>
      <h2 className="card-title" id={DOM_IDS.cardTitle} tabIndex={-1}>
        {t.loc(center.name)}
      </h2>
      <div className="card-actions">
        <ExternalLink href={center.maps_url} variant="primary" icon="external">
          {t.t("open_maps")}
        </ExternalLink>
        <ExternalLink href={directionsTo(center.lat, center.lng, travelmode)} variant="ghost" icon="route">
          {t.labels.directions_link}
        </ExternalLink>
      </div>
    </>
  );
}
