import { useLayoutEffect, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/useT";
import { Icon } from "./Icon";

export interface LightboxSlide {
  src: string;
  alt: string;
  /** Caption, credit and source link under the image. */
  details?: ReactNode;
}

export interface LightboxProps {
  label: string;
  slides: readonly LightboxSlide[];
  index: number;
  onIndexChange: (index: number) => void;
  /** After the dialog closed (button, Escape, backdrop); the caller restores focus. */
  onClose: () => void;
}

const SWIPE_PX = 48;

interface Swipe {
  id: number;
  x: number;
  y: number;
}

/**
 * Full-size images on a dark scrim in a modal <dialog>: arrows, ←/→, swipe, Escape and a click
 * on the backdrop. Images never grow past their natural size.
 */
export default function Lightbox({ label, slides, index, onIndexChange, onClose }: LightboxProps) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const swipe = useRef<Swipe | null>(null);
  const swiped = useRef(false);
  const total = slides.length;
  const slide = slides[index];

  useLayoutEffect(() => {
    const node = dialog.current;
    if (!node || node.open) return;
    node.showModal();
    closeButton.current?.focus();
  }, []);

  if (!slide) return null;
  const many = total > 1;
  const go = (step: number) => onIndexChange((index + step + total) % total);
  const close = () => dialog.current?.close();

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Escape") event.stopPropagation();
    if (!many || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      go(event.key === "ArrowRight" ? 1 : -1);
    }
  };
  const onClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (swiped.current) {
      swiped.current = false;
      return;
    }
    if (event.target === event.currentTarget || event.target === stage.current) close();
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    swiped.current = false;
    swipe.current = event.pointerType === "mouse" ? null : { id: event.pointerId, x: event.clientX, y: event.clientY };
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = swipe.current;
    swipe.current = null;
    if (!many || !start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    swiped.current = true;
    go(dx < 0 ? 1 : -1);
  };

  return createPortal(
    <dialog ref={dialog} className="lightbox" aria-label={label} onClick={onClick} onKeyDown={onKeyDown} onClose={onClose}>
      <button ref={closeButton} type="button" className="lightbox-btn lightbox-close" title={t.t("close")} onClick={close}>
        <Icon name="x" />
        <span className="sr-only">{t.t("close")}</span>
      </button>
      <div
        ref={stage}
        className="lightbox-stage"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          swipe.current = null;
        }}
      >
        <img key={slide.src} src={slide.src} alt={slide.alt} decoding="async" draggable={false} />
      </div>
      {many ? (
        <>
          <button type="button" className="lightbox-btn lightbox-prev" title={t.t("photo_prev")} onClick={() => go(-1)}>
            <Icon name="chevron" />
            <span className="sr-only">{t.t("photo_prev")}</span>
          </button>
          <button type="button" className="lightbox-btn lightbox-next" title={t.t("photo_next")} onClick={() => go(1)}>
            <Icon name="chevron" />
            <span className="sr-only">{t.t("photo_next")}</span>
          </button>
        </>
      ) : null}
      <div className="lightbox-caption">
        <p className="lightbox-title">
          <span>{slide.alt}</span>
          {many ? (
            <span className="lightbox-count num" aria-live="polite">
              {t.t("photo_position", { n: index + 1, total })}
            </span>
          ) : null}
        </p>
        {slide.details}
      </div>
    </dialog>,
    document.body,
  );
}
