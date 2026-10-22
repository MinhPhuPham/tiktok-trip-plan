import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GeoUnavailable } from "../location/locator";
import { renderTrip } from "../test/renderTrip";
import { createFingerReach } from "./fingerReach";
import L from "./leafletGlobal";
import type { MapHandle } from "./mapCore";
import { LocateControl } from "./LocateControl";

function setup(lang = "en", unavailable: GeoUnavailable | null = null) {
  const element = document.createElement("div");
  document.body.append(element);
  const map = L.map(element, { fadeAnimation: false, zoomAnimation: false }).setView([11.94, 108.44], 13);
  const handle: MapHandle = { map, reach: createFingerReach(map), renderers: { compass: L.svg(), routes: L.svg(), nearby: L.svg() } };
  const view = renderTrip(<LocateControl handle={handle} unavailable={unavailable} />, { lang });
  const button = () => screen.getByRole("button", { name: lang === "vi" ? "Vị trí của tôi" : "My location" });
  const cleanup = () => {
    view.unmount();
    map.remove();
    element.remove();
  };
  return { element, store: view.store, button, cleanup };
}

const IOS_CHROME_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.156 Mobile/15E148 Safari/604.1";

const ZALO_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 Zalo android/12100658";

describe("LocateControl", () => {
  let cleanup = () => undefined as void;
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("asks for location before the iOS compass, and a compass request that throws does not stop it", () => {
    const view = setup();
    cleanup = view.cleanup;
    const modes: string[] = [];
    const requestPermission = vi.fn(() => {
      modes.push(view.store.getState().locate.mode);
      throw new DOMException("not allowed", "NotAllowedError");
    });
    vi.stubGlobal("DeviceOrientationEvent", Object.assign(class extends Event {}, { requestPermission }));
    fireEvent.click(view.button());
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(modes).toEqual(["locating"]);
    expect(view.store.getState().locate).toEqual({ mode: "locating", follow: true });
  });

  it("opens the blocked help by itself when the prompt the tap opened is refused", () => {
    const view = setup("vi");
    cleanup = view.cleanup;
    fireEvent.click(view.button());
    act(() => view.store.getState().actions.locate({ type: "denied" }));
    expect(screen.getByRole("dialog", { name: "Vị trí đang bị chặn" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeInTheDocument();
  });

  it("iPhone Chrome refusing at once (no prompt): opens the help with Chrome's own location switch", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(IOS_CHROME_UA);
    const view = setup("vi");
    cleanup = view.cleanup;
    fireEvent.click(view.button());
    act(() => view.store.getState().actions.locate({ type: "denied", problem: "blocked" }));
    const dialog = screen.getByRole("dialog", { name: "Vị trí đang bị chặn" });
    expect(dialog).toHaveTextContent("iPhone chưa cho Chrome dùng vị trí, nên trang này không hỏi được bạn.");
    expect(dialog).toHaveTextContent("Mở Cài đặt → Ứng dụng → Chrome → Vị trí.");
    expect(dialog).toHaveTextContent("Chọn Khi dùng ứng dụng và bật Vị trí chính xác.");
    expect(dialog).not.toHaveTextContent("Safari");
    expect(within(dialog).getByRole("button", { name: "Thử lại" })).toBeInTheDocument();
  });

  it("no position after a tap (Location Services off) opens the Location Services help; a tap on the button retries", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(IOS_CHROME_UA);
    const view = setup("vi");
    cleanup = view.cleanup;
    fireEvent.click(view.button());
    act(() => view.store.getState().actions.locate({ type: "failed", problem: "off" }));
    const dialog = screen.getByRole("dialog", { name: "Chưa lấy được vị trí" });
    expect(dialog).toHaveTextContent("Quyền riêng tư & Bảo mật → Dịch vụ định vị");
    expect(dialog).toHaveTextContent("Ngay bên dưới, chọn Chrome → Khi dùng ứng dụng.");
    expect(view.button()).toHaveAttribute("data-mode", "failed");
    fireEvent.click(view.button());
    expect(view.store.getState().locate).toEqual({ mode: "locating", follow: true });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a timeout opens no help (the toast offers Try again)", () => {
    const view = setup();
    cleanup = view.cleanup;
    fireEvent.click(view.button());
    act(() => view.store.getState().actions.locate({ type: "failed", problem: "timeout" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not open the help for a permission that was already blocked on load", () => {
    const view = setup();
    cleanup = view.cleanup;
    act(() => view.store.getState().actions.locate({ type: "denied" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("on an http page shows the button and explains that location needs the https link", () => {
    const view = setup("vi", "insecure");
    cleanup = view.cleanup;
    expect(view.button()).toHaveAttribute("data-mode", "unavailable");
    expect(view.button()).toHaveAttribute("title", "Không dùng được vị trí ở đây. Bấm để xem lý do");
    fireEvent.click(view.button());
    expect(view.store.getState().locate.mode).toBe("off");
    const dialog = screen.getByRole("dialog", { name: "Không dùng được vị trí ở đây" });
    expect(dialog).toHaveTextContent("https://");
    expect(within(dialog).queryByRole("button", { name: "Thử lại" })).toBeNull();
  });

  it("inside Zalo or Facebook says to open the map in a real browser", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ZALO_UA);
    const view = setup("vi");
    cleanup = view.cleanup;
    act(() => view.store.getState().actions.locate({ type: "denied" }));
    fireEvent.click(view.button());
    const dialog = screen.getByRole("dialog", { name: "Vị trí đang bị chặn" });
    expect(dialog).toHaveTextContent("Zalo, Facebook");
    expect(dialog).toHaveTextContent("Mở bằng trình duyệt");
  });

  it("sits in the map's bottom-right control corner as an icon-only button", () => {
    const view = setup();
    cleanup = view.cleanup;
    const corner = view.element.querySelector(".leaflet-bottom.leaflet-right");
    expect(corner?.contains(view.button())).toBe(true);
    expect(view.button()).toHaveAttribute("aria-pressed", "false");
    expect(view.button()).toHaveAttribute("title", "My location");
  });

  it("walks off → locating → following → off on taps and shows each state", () => {
    const view = setup();
    cleanup = view.cleanup;
    fireEvent.click(view.button());
    expect(view.store.getState().locate.mode).toBe("locating");
    expect(view.button()).toHaveAttribute("aria-busy", "true");
    expect(view.button()).toHaveAttribute("data-mode", "asked");
    act(() => view.store.getState().actions.receiveFix({ lat: 11.94, lng: 108.44, accuracy: 20, heading: null }));
    expect(view.button()).toHaveAttribute("data-mode", "following");
    expect(view.button()).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("The map follows you");
    fireEvent.click(view.button());
    expect(view.store.getState().locate.mode).toBe("off");
    expect(view.button()).toHaveAttribute("aria-pressed", "false");
  });

  it("explains a blocked permission instead of asking again, in Vietnamese by default", () => {
    const view = setup("vi");
    cleanup = view.cleanup;
    act(() => view.store.getState().actions.locate({ type: "denied" }));
    expect(view.button()).not.toHaveAttribute("aria-pressed");
    expect(view.button()).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(view.button());
    expect(view.store.getState().locate.mode).toBe("denied");
    const dialog = screen.getByRole("dialog", { name: "Vị trí đang bị chặn" });
    expect(dialog).toHaveTextContent("không gửi đi hay lưu lại");
    expect(within(dialog).getAllByRole("button").at(-1)).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(view.button()).toHaveFocus();
  });

  it("Try again in the blocked help asks once more and closes it", () => {
    const view = setup();
    cleanup = view.cleanup;
    act(() => view.store.getState().actions.locate({ type: "denied" }));
    fireEvent.click(view.button());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(view.store.getState().locate).toEqual({ mode: "locating", follow: true });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
