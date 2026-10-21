import { Suspense, useRef, useState } from "react";
import type { MediaItem } from "../../data/types";
import type { Translator } from "../../i18n/translator";
import { classes } from "../../lib/css";
import { safeSrc, safeUrl } from "../../lib/safe";
import { Icon } from "../../ui/Icon";
import { LazyLightbox, preloadLightbox } from "../../ui/LazyLightbox";
import type { LightboxSlide } from "../../ui/Lightbox";

interface MediaGalleryProps {
  t: Translator;
  placeName: string;
  items: readonly MediaItem[];
  /** Phones show one photo and "+n" until expanded. */
  expanded: boolean;
  onExpand: () => void;
}

type Attribution = MediaItem["attributions"][number];

interface Thumb {
  item: MediaItem;
  src: string;
  label: string;
}

const isShown = (element: HTMLElement): boolean =>
  typeof element.checkVisibility === "function" ? element.checkVisibility() : true;

/** Video frames and Google photos; each opens full size in a lightbox. Broken images drop out. */
export function MediaGallery({ t, placeName, items, expanded, onExpand }: MediaGalleryProps) {
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(() => new Set());
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const [viewing, setViewing] = useState<string | null>(null);
  const opener = useRef<string | null>(null);
  const strip = useRef<HTMLUListElement>(null);
  const thumbs: Thumb[] = items.flatMap((item, index) => {
    const src = safeSrc(item.src);
    if (!src || failed.has(src)) return [];
    return [{ item, src, label: item.caption || t.t("photo_n", { n: index + 1, name: placeName }) }];
  });
  if (!thumbs.length) return null;
  const collapsed = !expanded && thumbs.length > 1;
  const credits = thumbs.flatMap(({ item }) => item.attributions.filter((who) => who.name));
  const viewIndex = viewing == null ? -1 : thumbs.findIndex((thumb) => thumb.src === viewing);

  const thumbButton = (src: string | null) =>
    [...(strip.current?.querySelectorAll<HTMLElement>(".thumb[data-src]") ?? [])].find((el) => el.dataset.src === src);
  const expand = () => {
    onExpand();
    requestAnimationFrame(() => strip.current?.querySelector<HTMLElement>("li:nth-child(2) .thumb")?.focus());
  };
  const open = (src: string) => {
    opener.current = src;
    setViewing(src);
  };
  const closeViewer = () => {
    const last = thumbButton(viewing);
    setViewing(null);
    (last && isShown(last) ? last : thumbButton(opener.current))?.focus();
  };

  return (
    <div className="media">
      <ul ref={strip} className={classes("media-strip", collapsed && "is-collapsed")} aria-label={t.t("photos")}>
        {thumbs.map(({ item, src, label }) => (
          <li key={src}>
            <MediaThumb
              item={item}
              src={src}
              label={label}
              loaded={loaded.has(src)}
              onOpen={() => open(src)}
              onLoad={() => setLoaded((prev) => new Set(prev).add(src))}
              onError={() => setFailed((prev) => new Set(prev).add(src))}
            />
          </li>
        ))}
        {collapsed ? (
          <li className="more">
            <button
              type="button"
              className="thumb more-btn num"
              aria-label={t.t("more_photos_label", { n: thumbs.length - 1 })}
              onClick={expand}
            >
              {t.t("more_photos", { n: thumbs.length - 1 })}
            </button>
          </li>
        ) : null}
      </ul>
      {credits.length ? (
        <p className="media-credit">
          {t.t("photo_by")} <Credits t={t} people={credits} />
        </p>
      ) : null}
      {viewIndex >= 0 ? (
        <Suspense fallback={null}>
          <LazyLightbox
            label={t.t("lightbox_label", { name: placeName })}
            slides={thumbs.map((thumb) => toSlide(t, thumb))}
            index={viewIndex}
            onIndexChange={(index) => setViewing(thumbs[index]?.src ?? null)}
            onClose={closeViewer}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

function toSlide(t: Translator, { item, src, label }: Thumb): LightboxSlide {
  return { src, alt: label, details: <MediaSource t={t} item={item} /> };
}

function MediaSource({ t, item }: { t: Translator; item: MediaItem }) {
  const href = safeUrl(item.source_url);
  const people = item.attributions.filter((who) => who.name);
  if (!href && !people.length) return null;
  return (
    <p className="lightbox-meta">
      {people.length ? (
        <span>
          {t.t("photo_by")} <Credits t={t} people={people} />
        </span>
      ) : null}
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer">
          <Icon name={item.kind === "frame" ? "play" : "external"} />
          {t.t(item.kind === "frame" ? "open_video" : "open_maps")}
          <span className="sr-only"> {t.t("new_tab")}</span>
        </a>
      ) : null}
    </p>
  );
}

function Credits({ t, people }: { t: Translator; people: readonly Attribution[] }) {
  return people.map((who, index) => {
    const uri = safeUrl(who.uri);
    return (
      <span key={`${who.name}-${index}`}>
        {index ? ", " : null}
        {uri ? (
          <a href={uri} target="_blank" rel="noopener noreferrer">
            {who.name}
            <span className="sr-only"> {t.t("new_tab")}</span>
          </a>
        ) : (
          who.name
        )}
      </span>
    );
  });
}

interface MediaThumbProps {
  item: MediaItem;
  src: string;
  label: string;
  loaded: boolean;
  onOpen: () => void;
  onLoad: () => void;
  onError: () => void;
}

function MediaThumb({ item, src, label, loaded, onOpen, onLoad, onError }: MediaThumbProps) {
  return (
    <button
      type="button"
      className="thumb"
      data-src={src}
      title={label}
      aria-label={label}
      aria-haspopup="dialog"
      onClick={onOpen}
      onPointerEnter={preloadLightbox}
      onFocus={preloadLightbox}
    >
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        width={112}
        height={84}
        draggable={false}
        className={loaded ? "is-loaded" : undefined}
        onLoad={onLoad}
        onError={onError}
      />
      {item.kind === "frame" ? (
        <span className="kind" aria-hidden="true">
          <Icon name="play" />
        </span>
      ) : null}
    </button>
  );
}
