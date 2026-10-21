import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { stubDialog } from "../test/dialog";
import { renderTrip } from "../test/renderTrip";
import Lightbox, { type LightboxSlide } from "./Lightbox";

const SLIDES: LightboxSlide[] = [
  { src: "media/a/1.jpg", alt: "Front", details: <a href="https://example.com/1">source one</a> },
  { src: "media/a/2.jpg", alt: "Bowl" },
  { src: "media/a/3.jpg", alt: "Menu" },
];

function Harness({ onClose }: { onClose: () => void }) {
  const [index, setIndex] = useState(0);
  return <Lightbox label="Photos of Phở" slides={SLIDES} index={index} onIndexChange={setIndex} onClose={onClose} />;
}

function renderLightbox() {
  const onClose = vi.fn();
  renderTrip(<Harness onClose={onClose} />);
  return { onClose, dialog: screen.getByRole("dialog", { name: "Photos of Phở" }) };
}

const shown = () => screen.getByRole("img").getAttribute("alt");

describe("Lightbox", () => {
  beforeAll(stubDialog);

  it("opens modal with the close button focused and the caption details", () => {
    const { dialog } = renderLightbox();
    expect(dialog).toHaveAttribute("open");
    expect(screen.getByRole("button", { name: "close" })).toHaveFocus();
    expect(screen.getByRole("img", { name: "Front" })).toHaveAttribute("src", "media/a/1.jpg");
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "source one" })).toBeInTheDocument();
  });

  it("moves with the arrow buttons and keys, wrapping at the ends", () => {
    const { dialog } = renderLightbox();
    fireEvent.click(screen.getByRole("button", { name: "Next photo" }));
    expect(shown()).toBe("Bowl");
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(shown()).toBe("Menu");
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(shown()).toBe("Front");
    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    expect(shown()).toBe("Menu");
    fireEvent.click(screen.getByRole("button", { name: "Previous photo" }));
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
  });

  it("follows a horizontal swipe but not a vertical one or a mouse drag", () => {
    renderLightbox();
    const stage = screen.getByRole("img").parentElement as HTMLElement;
    fireEvent.pointerDown(stage, { pointerId: 1, pointerType: "touch", clientX: 300, clientY: 400 });
    fireEvent.pointerUp(stage, { pointerId: 1, pointerType: "touch", clientX: 200, clientY: 410 });
    expect(shown()).toBe("Bowl");
    fireEvent.pointerDown(stage, { pointerId: 2, pointerType: "touch", clientX: 300, clientY: 400 });
    fireEvent.pointerUp(stage, { pointerId: 2, pointerType: "touch", clientX: 240, clientY: 600 });
    expect(shown()).toBe("Bowl");
    fireEvent.pointerDown(stage, { pointerId: 3, pointerType: "mouse", clientX: 300, clientY: 400 });
    fireEvent.pointerUp(stage, { pointerId: 3, pointerType: "mouse", clientX: 100, clientY: 400 });
    expect(shown()).toBe("Bowl");
  });

  it("closes from the button and from the backdrop, not from the image", () => {
    const { dialog, onClose } = renderLightbox();
    fireEvent.click(screen.getByRole("img"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dialog).not.toHaveAttribute("open");
  });

  it("keeps Escape from reaching the page", () => {
    const { dialog } = renderLightbox();
    const onDocument = vi.fn();
    document.addEventListener("keydown", onDocument);
    fireEvent.keyDown(dialog, { key: "Escape" });
    document.removeEventListener("keydown", onDocument);
    expect(onDocument).not.toHaveBeenCalled();
  });
});
