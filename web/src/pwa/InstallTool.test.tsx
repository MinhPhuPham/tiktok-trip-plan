import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTrip } from "../test/renderTrip";
import type { InstallState } from "./install";
import { InstallButton } from "./InstallButton";
import { InstallTool } from "./InstallTool";
import { SNOOZE_KEY, type BrowserInfo, type InstallHelp, type IosBrowser } from "./installOffer";

const install = vi.hoisted((): { state: InstallState } => ({ state: { kind: "unavailable" } }));

vi.mock("./install", () => ({ useInstallState: () => install.state }));

const browser = (help: InstallHelp, iosBrowser: IosBrowser | null = null, iosMajor: number | null = null): BrowserInfo => ({
  help,
  ios: iosBrowser != null || help === "safari-only",
  iosBrowser,
  iosMajor,
});
const state = (help: InstallHelp, iosBrowser: IosBrowser | null = null, iosMajor: number | null = null): InstallState => ({
  kind: help,
  browser: browser(help, iosBrowser, iosMajor),
});

const tool = () => screen.queryByRole("button", { name: "Install app" });
const openDialog = () => {
  fireEvent.click(tool()!);
  return screen.getByRole("dialog", { name: "Install this trip" });
};

describe("InstallTool", () => {
  afterEach(() => {
    install.state = { kind: "unavailable" };
  });

  it("stays hidden once installed or in the single file", () => {
    renderTrip(<InstallTool />);
    expect(tool()).not.toBeInTheDocument();
  });

  it("opens Chrome's prompt from its popover; dismissing the prompt shrinks the button to its icon", async () => {
    const prompt = vi.fn(() => Promise.resolve("dismissed" as const));
    install.state = { kind: "prompt", install: prompt };
    const { unmount } = renderTrip(<InstallTool />);
    expect(tool()).toHaveTextContent("Install app");
    expect(openDialog()).toHaveTextContent("works offline");
    expect(screen.getByRole("button", { name: "Install" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    expect(prompt).toHaveBeenCalledOnce();
    await waitFor(() => expect(tool()).toHaveAttribute("title", "Install app"));
    expect(window.localStorage.getItem(SNOOZE_KEY)).not.toBeNull();
    unmount();
    renderTrip(<InstallTool />);
    expect(tool()).toHaveAttribute("title", "Install app");
  });

  it("explains Share → Add to Home Screen on iOS; Not now keeps an icon button", () => {
    install.state = state("share", "safari", 17);
    const { unmount } = renderTrip(<InstallTool />);
    const dialog = openDialog();
    expect(dialog).toHaveTextContent("Share");
    expect(dialog).toHaveTextContent("Add to Home Screen");
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(dialog).not.toBeVisible();
    expect(tool()).toHaveFocus();
    fireEvent.click(tool()!);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(tool()).toHaveAttribute("title", "Install app");
    expect(openDialog()).toHaveTextContent("Add to Home Screen");
    expect(screen.queryByRole("button", { name: "Not now" })).not.toBeInTheDocument();
    unmount();
    renderTrip(<InstallTool />);
    expect(tool()).toHaveAttribute("title", "Install app");
  });

  it.each([
    [state("menu"), ["browser menu", "Add to Home screen"]],
    [state("dock"), ["File, then Add to Dock"]],
    [state("unsupported"), ["can't install web apps", "Chrome or Edge"]],
    [state("safari-only", "chrome", 15), ["Before iOS 16.4 only Safari", "Open this page in Safari"]],
    [{ kind: "in-app", browser: { ...browser("in-app"), ios: true } }, ["Open in browser", "In Safari, tap Install app again", "paste it into Safari"]],
    [state("in-app"), ["In Chrome, tap Install app again"]],
    [state("share", "safari", 18), ["Share in Safari's bottom bar", "Add to Home Screen, then tap Add"]],
    [state("share", "safari", 26), ["Tap ••• in Safari's bottom bar, then", "Add to Home Screen"]],
    [state("share", "chrome", 17), ["Share at the right end of the address bar", "Add to Home Screen"]],
    [state("share", "edge", 18), ["Tap ••• in the bottom bar, then", "Add to Home Screen"]],
    [state("share", "firefox", 18), ["Tap the ≡ menu, then", "Add to Home Screen"]],
  ] as const)("shows the steps for %o", (current, texts) => {
    install.state = current;
    renderTrip(<InstallTool />);
    const dialog = openDialog();
    for (const text of texts) expect(dialog).toHaveTextContent(text);
  });

  it("copies the link, or shows it selected where the clipboard is blocked", async () => {
    install.state = state("in-app");
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderTrip(<InstallTool />);
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(await screen.findByRole("button", { name: "Link copied" })).toBeInTheDocument();

    writeText.mockRejectedValueOnce(new Error("blocked"));
    fireEvent.click(screen.getByRole("button", { name: "Link copied" }));
    expect(await screen.findByRole("textbox", { name: "Trip link" })).toHaveValue(window.location.href);
  });

  it("speaks Vietnamese and closes on Escape", () => {
    install.state = { kind: "in-app", browser: { ...browser("in-app"), ios: true } };
    renderTrip(<InstallTool />, { lang: "vi" });
    fireEvent.click(screen.getByRole("button", { name: "Cài ứng dụng" }));
    const dialog = screen.getByRole("dialog", { name: "Cài chuyến đi này" });
    expect(dialog).toHaveTextContent("Mở bằng trình duyệt");
    expect(dialog).toHaveTextContent("Trong Safari, bấm Cài ứng dụng lần nữa.");
    expect(screen.getByRole("button", { name: "Chép link" })).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(dialog).not.toBeVisible();
  });

  it("tells iPhone Chrome where its Share button is, in Vietnamese", () => {
    install.state = state("share", "chrome", 18);
    renderTrip(<InstallTool />, { lang: "vi" });
    fireEvent.click(screen.getByRole("button", { name: "Cài ứng dụng" }));
    const dialog = screen.getByRole("dialog", { name: "Cài chuyến đi này" });
    expect(dialog).toHaveTextContent("Bấm Chia sẻ ở đầu phải thanh địa chỉ (hoặc ••• → Chia sẻ).");
    expect(dialog).toHaveTextContent("Kéo xuống, chọn Thêm vào MH chính rồi bấm Thêm.");
  });
});

describe("InstallButton (panel footer)", () => {
  afterEach(() => {
    install.state = { kind: "unavailable" };
  });

  it("opens the browser's prompt, or shows this browser's steps even while the map button is snoozed", () => {
    const prompt = vi.fn(() => Promise.resolve("accepted" as const));
    install.state = { kind: "prompt", install: prompt };
    const { unmount } = renderTrip(<InstallButton />);
    fireEvent.click(screen.getByRole("button", { name: "Install app" }));
    expect(prompt).toHaveBeenCalledOnce();
    unmount();

    window.localStorage.setItem(SNOOZE_KEY, JSON.stringify({ v: 1, at: Date.now() }));
    install.state = state("menu");
    const { container } = renderTrip(<InstallButton />);
    expect(container.querySelector("summary")).toHaveTextContent("Install app");
    expect(container).toHaveTextContent("Add to Home screen");
  });

  it("is absent once installed", () => {
    const { container } = renderTrip(<InstallButton />);
    expect(container).toBeEmptyDOMElement();
  });
});
