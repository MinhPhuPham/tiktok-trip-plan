import type { Translator } from "../../i18n/translator";
import { safeUrl } from "../../lib/safe";
import { ExternalLink } from "../../ui/ExternalLink";
import { Icon } from "../../ui/Icon";

interface DirectionsLinksProps {
  urls: readonly string[];
  t: Translator;
}

/** One "Directions" link, or "Directions: Part 1 Part 2" when the day needs several legs. */
export function DirectionsLinks({ urls, t }: DirectionsLinksProps) {
  const legs = urls.flatMap((url) => safeUrl(url) ?? []);
  if (legs.length === 1) {
    return (
      <ExternalLink href={legs[0]} variant="ghost" icon="external">
        {t.labels.directions_link}
      </ExternalLink>
    );
  }
  if (!legs.length) return null;
  return (
    <span className="legs" role="group" aria-label={t.labels.directions_link}>
      <span className="legs-label" aria-hidden="true">
        <Icon name="external" />
        {t.labels.directions_link}
      </span>
      {legs.map((url, index) => (
        <a
          key={url}
          className="btn ghost num"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${t.t("directions_part", { n: index + 1, total: legs.length })} ${t.t("new_tab")}`}
        >
          {t.t("part_n", { n: index + 1 })}
        </a>
      ))}
    </span>
  );
}
