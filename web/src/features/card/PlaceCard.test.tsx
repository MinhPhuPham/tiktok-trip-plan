import { act, fireEvent, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { DOM_IDS } from "../../app/ids";
import { createTranslator } from "../../i18n/translator";
import { closingTrip, makePlace, makeTrip } from "../../test/fixtures";
import { stubDialog } from "../../test/dialog";
import { renderTrip } from "../../test/renderTrip";
import { Toast } from "../../ui/Toast";
import { PlaceCard } from "./PlaceCard";
import { mustTry } from "./PlaceDetails";
import { openState } from "./openState";

function renderCard(data = makeTrip(), lang = "en") {
  const view = renderTrip(
    <>
      <button type="button">origin</button>
      <PlaceCard />
      <Toast />
    </>,
    { data, lang },
  );
  const open = (id: string) => {
    screen.getByRole("button", { name: "origin" }).focus();
    act(() => view.store.getState().actions.openCard(id));
  };
  return { ...view, open };
}

describe("PlaceCard", () => {
  beforeAll(stubDialog);

  it("renders nothing until a place is selected", () => {
    renderCard();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a place with its plan slot, tags, dishes and links, and focuses the title", () => {
    const { open } = renderCard();
    open("a");
    const card = screen.getByRole("dialog", { name: "Phở Gia Truyền" });
    expect(screen.getByRole("heading", { name: "Phở Gia Truyền" })).toHaveFocus();
    expect(within(card).getByText("must_go")).toHaveClass("badge-must");
    expect(within(card).getByText("Day 1 · #1")).toBeInTheDocument();
    expect(within(card).getByText("Food · North · 1.0 km")).toBeInTheDocument();
    expect(within(card).getByRole("list", { name: "Tags" })).toHaveTextContent("Local favourite");
    expect(within(card).getByText("phở bò")).toBeInTheDocument();
    expect(within(card).getByText("4.5 (100)")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: /open_maps/ })).toHaveAttribute("href", "https://maps.google.com/?cid=1");
    expect(within(card).getByRole("link", { name: /Directions/ }).getAttribute("href")).toContain("destination=10.770000,106.700000");
  });

  it("lists the plan notes for the place, problems first, in English and Vietnamese", async () => {
    const data = closingTrip();
    data.labels.vi!.ui.closing_warning = "Đến lúc {time}, không đủ thời gian trước giờ đóng cửa (cần {need} phút). Giờ mở cửa: {hours}";
    data.labels.vi!.ui.missing_slot_warning = "Chưa chọn buổi";
    const { open, store } = renderCard(data);
    open("a");
    const notes = await screen.findByRole("region", { name: "Plan notes" });
    const items = within(notes).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringMatching(/^Problem: Arrives 8:0\d AM with no time left before closing \(needs 30 min\)\. Hours: 6:00 AM–8:10 AM$/),
      "Note: No part of day set",
    ]);
    expect(items[0]).toHaveClass("is-error");
    expect(items[1]).not.toHaveClass("is-error");
    act(() => store.getState().actions.setLang("vi"));
    const vi = screen.getByRole("region", { name: "Lưu ý lịch trình" });
    expect(within(vi).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      expect.stringMatching(/^Vấn đề: Đến lúc 8:0\d, không đủ thời gian trước giờ đóng cửa \(cần 30 phút\)\. Giờ mở cửa: 6:00–8:10$/),
      "Lưu ý: Chưa chọn buổi",
    ]);
  });

  it("shows no plan notes for a place the checks find nothing on", async () => {
    const { open } = renderCard(makeTrip({ days: [] }));
    open("b");
    await screen.findByRole("dialog");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.queryByRole("region", { name: "Plan notes" })).not.toBeInTheDocument();
  });

  it("returns focus to where it came from on close", () => {
    const { open } = renderCard();
    open("b");
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "origin" })).toHaveFocus();
  });

  it("hides a place with an undo toast", () => {
    const { open, store } = renderCard();
    open("b");
    fireEvent.click(screen.getByRole("button", { name: "Hide from my list" }));
    expect(store.getState().hidden.has("b")).toBe(true);
    expect(screen.getByText("hidden_badge")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show in my list again" })).toHaveAccessibleDescription(/Only in this browser/);
    act(() => store.getState().toast?.action?.run());
    expect(store.getState().hidden.has("b")).toBe(false);
  });

  it("shows unrated places and the time and source of the best visit", () => {
    const data = makeTrip();
    data.places[2] = makePlace("c", {
      name: "Bảo tàng",
      priority: null,
      stars: "",
      best: { en: "Dec–Feb, 7:00–9:00", vi: "Dec–Feb, 7:00–9:00" },
      best_source: "heuristic",
      best_why: { en: "Cooler mornings", vi: "Sáng mát" },
      price: "50.000đ",
    });
    const { open } = renderCard(data, "vi");
    open("c");
    const card = screen.getByRole("dialog");
    expect(within(card).getByText("unrated")).toBeInTheDocument();
    expect(within(card).getByText("T12–T2, 7:00–9:00")).toBeInTheDocument();
    expect(within(card).getByText("(estimate)")).toBeInTheDocument();
    expect(within(card).getByText("Sáng mát")).toBeInTheDocument();
    expect(within(card).getByText("50.000đ")).toBeInTheDocument();
    expect(within(card).queryByText("Day 1 · #1")).not.toBeInTheDocument();
  });

  it("shows photos with their credits, dropping broken ones", () => {
    const data = makeTrip({
      media: {
        a: [
          { src: "media/a/frame-1.jpg", kind: "frame", caption: "", source_url: "https://www.tiktok.com/@x/video/1", attributions: [] },
          { src: "media/a/photo-1.jpg", kind: "photo", caption: "Front", source_url: null, attributions: [{ name: "Lan", uri: "https://maps.google.com/contrib/1" }] },
          { src: "javascript:alert(1)", kind: "photo", caption: "", source_url: null, attributions: [] },
        ],
      },
    });
    const { open } = renderCard(data);
    open("a");
    const gallery = screen.getByRole("list", { name: "photos" });
    expect(within(gallery).getAllByRole("listitem")).toHaveLength(3);
    expect(within(gallery).getByRole("button", { name: "Photo 1 of Phở Gia Truyền" })).toHaveAttribute("aria-haspopup", "dialog");
    expect(within(gallery).getByRole("button", { name: "Front" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Lan/ })).toHaveAttribute("href", "https://maps.google.com/contrib/1");
    fireEvent.click(within(gallery).getByRole("button", { name: "Show 1 more photos" }));
    expect(within(gallery).queryByRole("button", { name: /more photos/ })).not.toBeInTheDocument();
    const broken = gallery.querySelectorAll("img")[1] as HTMLImageElement;
    fireEvent.error(broken);
    expect(within(gallery).queryByRole("button", { name: "Front" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Lan/ })).not.toBeInTheDocument();
  });

  it("opens a photo full size with its source and returns focus to its thumbnail", async () => {
    const data = makeTrip({
      media: {
        a: [
          { src: "media/a/frame-1.jpg", kind: "frame", caption: "", source_url: "https://www.tiktok.com/@x/video/1", attributions: [] },
          { src: "media/a/photo-1.jpg", kind: "photo", caption: "Front", source_url: "https://maps.google.com/?cid=1", attributions: [{ name: "Lan", uri: null }] },
        ],
      },
    });
    const { open } = renderCard(data);
    open("a");
    const thumb = screen.getByRole("button", { name: "Photo 1 of Phở Gia Truyền" });
    fireEvent.click(thumb);
    const lightbox = await screen.findByRole("dialog", { name: "Photos of Phở Gia Truyền" });
    expect(within(lightbox).getByRole("img", { name: "Photo 1 of Phở Gia Truyền" })).toHaveAttribute("src", "media/a/frame-1.jpg");
    expect(within(lightbox).getByRole("link", { name: /Watch the video/ })).toHaveAttribute("href", "https://www.tiktok.com/@x/video/1");
    fireEvent.keyDown(lightbox, { key: "ArrowRight" });
    expect(within(lightbox).getByRole("img", { name: "Front" })).toBeInTheDocument();
    expect(within(lightbox).getByText("Lan")).toBeInTheDocument();
    expect(within(lightbox).getByRole("link", { name: /open_maps/ })).toHaveAttribute("href", "https://maps.google.com/?cid=1");
    fireEvent.click(within(lightbox).getByRole("button", { name: "close" }));
    expect(screen.queryByRole("dialog", { name: "Photos of Phở Gia Truyền" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Front" })).toHaveFocus();
    expect(screen.getByRole("dialog", { name: "Phở Gia Truyền" })).toBeInTheDocument();
  });

  it("shows a nearby spot", () => {
    const { open } = renderCard();
    open("n1");
    const card = screen.getByRole("dialog", { name: "Lookout" });
    expect(within(card).getByText("nearby")).toBeInTheDocument();
    expect(within(card).getByText("Viewpoint")).toBeInTheDocument();
    expect(within(card).queryByRole("link", { name: /open_maps/ })).not.toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /Hide/ })).not.toBeInTheDocument();
  });

  it("shows the center in the current language", () => {
    const { open } = renderCard(makeTrip(), "vi");
    open("center");
    const card = screen.getByRole("dialog", { name: "Khách sạn" });
    expect(within(card).getByText("center: khách sạn")).toBeInTheDocument();
    expect(document.getElementById(DOM_IDS.cardTitle)).toHaveFocus();
  });

  it("closes itself when the selection has no target", () => {
    const { store } = renderCard();
    act(() => store.getState().actions.openCard("missing"));
    expect(store.getState().selected).toBeNull();
  });
});

describe("openState", () => {
  const t = createTranslator(makeTrip().labels.en ?? ({} as never), "en");
  const monday = (h: number, m = 0) => new Date(2026, 9, 19, h, m);

  it("is null without periods", () => {
    expect(openState(t, [], monday(9))).toBeNull();
  });

  it("says when an open place closes", () => {
    expect(openState(t, [{ day: 0, open: "08:00", close: "22:00" }], monday(9))).toEqual({
      open: true,
      text: "Open now · closes 10:00 PM",
    });
  });

  it("follows a close past midnight from the day before", () => {
    const periods = [{ day: 6, open: "18:00", close: "02:00" }];
    expect(openState(t, periods, monday(1, 30))?.open).toBe(true);
  });

  it("says when a closed place opens today, or that it is closed today", () => {
    const periods = [{ day: 0, open: "16:00", close: "22:00" }];
    expect(openState(t, periods, monday(9))).toEqual({ open: false, text: "Closed now · opens 4:00 PM" });
    expect(openState(t, periods, monday(23))).toEqual({ open: false, text: "Closed today" });
  });

  it("knows 24-hour places", () => {
    expect(openState(t, [{ day: 0, open: "00:00", close: null }], monday(12))).toEqual({ open: true, text: "Open 24 hours" });
  });
});

describe("mustTry", () => {
  it("keeps three distinct dishes, ignoring accents and case", () => {
    expect(mustTry(["Phở bò ", "pho bo", "", "Bún chả", "Nem", "Chè"])).toEqual(["Phở bò", "Bún chả", "Nem"]);
  });
});
