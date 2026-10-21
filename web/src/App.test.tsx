import { act, fireEvent, render, screen } from "@testing-library/react";
import { Boot } from "./app/Boot";
import type { TripLoadResult } from "./data/load";
import { makeTrip } from "./test/fixtures";

async function renderApp(result: TripLoadResult) {
  const trip = Promise.resolve(result);
  await act(async () => {
    render(<Boot trip={trip} />);
    await trip;
  });
}

describe("App shell", () => {
  it("shows the trip, tabs and language switch", async () => {
    await renderApp({ ok: true, data: makeTrip(), source: "inline" });
    expect(screen.getByRole("heading", { level: 1, name: "Đà Lạt" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Plan/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: /Places/ }));
    expect(screen.getByRole("tab", { name: /Places/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("lang", "en");
    fireEvent.click(screen.getByRole("button", { name: "Tiếng Việt" }));
    expect(document.documentElement.lang).toBe("vi");
    expect(screen.getByRole("tab", { name: /Lịch trình/ })).toBeInTheDocument();
    expect(document.title).toBe("Đà Lạt · trip map");
  });

  it("explains a missing trip.json", async () => {
    await renderApp({ ok: false, error: { kind: "missing", source: "trip.json" } });
    expect(screen.getByRole("alert")).toHaveTextContent("run --from export");
  });

  it("asks for a reload when trip.json is newer than the app", async () => {
    await renderApp({ ok: false, error: { kind: "version", source: "trip.json", found: 9, expected: 1 } });
    expect(screen.getByRole("alert")).toHaveTextContent("newer version");
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("shows the load error instead of a blank page when rendering fails", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await renderApp({ ok: true, data: makeTrip({ places: null as never }), source: "inline" });
    expect(screen.getByRole("alert")).toHaveTextContent("app:");
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    quiet.mockRestore();
  });
});
