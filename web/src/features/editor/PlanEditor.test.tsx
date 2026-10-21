import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { TripModelContext } from "../../data/context";
import { buildTripModel } from "../../data/model";
import { planFromData } from "../../data/types";
import { TripStoreContext } from "../../state/context";
import { createTripStore } from "../../state/store";
import { closingTrip, makeDay, makeStop, makeTrip } from "../../test/fixtures";
import PlanEditor from "./PlanEditor";

function renderEditor({ data = makeTrip(), day }: { data?: ReturnType<typeof makeTrip>; day?: number } = {}) {
  const model = buildTripModel(data);
  const store = createTripStore({
    city: data.city,
    langs: ["en", "vi"],
    defaultLang: "en",
    plan: planFromData(data),
    phone: false,
    persistence: null,
  });
  store.getState().actions.setEditing(true, day);
  render(
    <TripModelContext value={model}>
      <TripStoreContext value={store}>
        <PlanEditor />
      </TripStoreContext>
    </TripModelContext>,
  );
  return store;
}

/** The stop's main button (its name starts with the time; the remove button says "Remove: …"). */
const stopButton = (name: string) => screen.getByRole("button", { name: new RegExp(`^(?!Remove).*${name}`) });
const stopNames = () => screen.getAllByRole("button", { expanded: false }).map((b) => b.textContent ?? "");

describe("PlanEditor", () => {
  it("shows the day with times, moves a stop with Alt+ArrowUp and publishes the plan", () => {
    const store = renderEditor();
    expect(screen.getByRole("heading", { level: 2, name: "Edit plan" })).toBeInTheDocument();
    const day = screen.getByRole("region", { name: "Day 1" });
    expect(within(day).getByText(/Leave Hotel/)).toBeInTheDocument();
    const lookout = stopButton("Lookout");
    act(() => {
      fireEvent.keyDown(lookout, { key: "ArrowUp", altKey: true });
    });
    expect(stopNames().findIndex((n) => n.includes("Lookout"))).toBeLessThan(
      stopNames().findIndex((n) => n.includes("Phở Gia Truyền")),
    );
    expect(store.getState().plan.edited).toBe(true);
    expect(document.activeElement?.textContent).toContain("Lookout");
  });

  it("shows no save status or check summary; edits save themselves", () => {
    renderEditor();
    const bar = document.querySelector<HTMLElement>(".pe-bar")!;
    expect(within(bar).getAllByRole("button").map((b) => b.textContent)).toEqual(["Done"]);
    expect(bar).not.toHaveTextContent(/saved|unsaved|to fix|nothing to fix|note/i);
    act(() => {
      fireEvent.keyDown(stopButton("Lookout"), { key: "ArrowUp", altKey: true });
    });
    expect(localStorage.length).toBe(1);
    expect(within(bar).getAllByRole("button").map((b) => b.textContent)).toEqual(["Done"]);
  });

  it("flags a stop with an icon only, jumps to the first problem and opens the card from the flag", () => {
    const store = renderEditor({ data: closingTrip() });
    const flag = screen.getByRole("button", { name: /^1 problem, 1 note: Arrives 8:0\d AM with no time left before closing/ });
    expect(document.querySelector(".pe-issues")).toBeNull();
    expect(stopButton("Phở Gia Truyền")).toHaveAccessibleDescription(/^1 problem, 1 note: Arrives/);
    fireEvent.click(screen.getByRole("button", { name: "1 to fix" }));
    expect(document.activeElement).toBe(stopButton("Phở Gia Truyền"));
    fireEvent.click(flag);
    expect(store.getState().selected).toBe("a");
    act(() => {
      fireEvent.keyDown(stopButton("Phở Gia Truyền"), { key: "Delete" });
    });
    expect(screen.queryByRole("button", { name: "1 to fix" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /problem/ })).not.toBeInTheDocument();
  });

  it("removes a stop with Delete (not Backspace) and keeps focus on the next stop", () => {
    const store = renderEditor();
    const lookout = stopButton("Lookout");
    fireEvent.keyDown(lookout, { key: "Backspace" });
    expect(stopNames().some((n) => n.includes("Lookout"))).toBe(true);
    act(() => {
      fireEvent.keyDown(lookout, { key: "Delete" });
    });
    expect(stopNames().some((n) => n.includes("Lookout"))).toBe(false);
    expect(document.activeElement?.classList.contains("pe-main")).toBe(true);
    expect(store.getState().toast?.message).toBe("Lookout removed");
  });

  it("focuses Done when opened for the whole plan, else the heading of the day it was opened at", () => {
    renderEditor();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Done" }));
    cleanup();
    const [first] = makeTrip().days;
    const data = makeTrip({ days: [first!, makeDay(2, [makeStop("start", null), makeStop("place", "c", { number: 1 }), makeStop("end", null)])] });
    renderEditor({ data, day: 2 });
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 3, name: /^Day 2/ }));
  });

  it("expands a stop, adds a day and closes with Done", () => {
    const store = renderEditor();
    fireEvent.click(stopButton("Phở Gia Truyền"));
    expect(screen.getByRole("combobox", { name: "Part of day" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add day" }));
    expect(screen.getByRole("region", { name: "Day 2" })).toHaveTextContent("No stops yet");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(store.getState().editing).toBe(false);
  });
});
