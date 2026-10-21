import type { MapPlace } from "../data/types";
import type { Translator } from "../i18n/translator";

interface PlaceStarsProps {
  place: MapPlace | null;
  t: Translator;
}

/** "★★★ " before a name; screen readers hear the priority instead. */
export function PlaceStars({ place, t }: PlaceStarsProps) {
  if (!place?.stars) return null;
  return (
    <>
      <span className="stars" aria-hidden="true">
        {place.stars}{" "}
      </span>
      <span className="sr-only">{t.priority(place.priority)}: </span>
    </>
  );
}
