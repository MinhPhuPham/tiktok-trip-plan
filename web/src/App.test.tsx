import { act, fireEvent, render, screen } from "@testing-library/react";
import { Boot } from "./app/Boot";
import type { TripLoadResult } from "./data/load";
import { savePrefs } from "./state/persist";
import { makeTrip } from "./test/fixtures";

async function renderApp(result: TripLoadResult) {
  const trip = Promise.resolve(result);
  await act(async () => {
    render(<Boot trip={trip} />);
    await trip;
  });
}

describe("App shell", () => {
  it("opens in Vietnamese and switches to English", async () => {
    await renderApp({ ok: true, data: makeTrip(), source: "inline" });
    expect(screen.getByRole("heading", { level: 1, name: "Đà Lạt" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("vi");
    expect(document.title).toBe("TwLP-Trips");
    expect(screen.getByRole("tab", { name: /Lịch trình/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: /Địa điểm/ }));
    expect(screen.getByRole("tab", { name: /Địa điểm/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("lang", "en");
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(document.documentElement.lang).toBe("en");
    expect(screen.getByRole("tab", { name: /Places/ })).toBeInTheDocument();
  });

  it("keeps a saved language over the Vietnamese default", async () => {
    savePrefs({ lang: "en", basemap: null, overlays: {} });
    await renderApp({ ok: true, data: makeTrip(), source: "inline" });
    expect(document.documentElement.lang).toBe("en");
    expect(screen.getByRole("tab", { name: /Plan/ })).toHaveAttribute("aria-selected", "true");
  });

  it("explains a missing trip.json", async () => {
    await renderApp({ ok: false, error: { kind: "missing", source: "trip.json" } });
    expect(screen.getByRole("alert")).toHaveTextContent("run --from export");
  });

  it("asks for a reload when trip.json is newer than the app", async () => {
    await renderApp({ ok: false, error: { kind: "version", source: "trip.json", found: 9, expected: 1 } });
    expect(screen.getByRole("alert")).toHaveTextContent("phiên bản ứng dụng mới hơn");
    expect(screen.getByRole("button", { name: "Tải lại" })).toBeInTheDocument();
  });

  it("shows load errors in the saved language", async () => {
    savePrefs({ lang: "en", basemap: null, overlays: {} });
    await renderApp({ ok: false, error: { kind: "version", source: "trip.json", found: 9, expected: 1 } });
    expect(screen.getByRole("alert")).toHaveTextContent("newer version");
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("shows the load error instead of a blank page when rendering fails", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await renderApp({ ok: true, data: makeTrip({ places: null as never }), source: "inline" });
    expect(screen.getByRole("alert")).toHaveTextContent("app:");
    expect(screen.getByRole("button", { name: "Tải lại" })).toBeInTheDocument();
    quiet.mockRestore();
  });
});
