import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "../../i18n/translator";
import { ROW_HOVER_DELAY_MS } from "../../state/useRowHover";
import { makeDay, makeStop, makeTrip } from "../../test/fixtures";
import { renderTrip } from "../../test/renderTrip";
import { PeekNext } from "./PeekNext";
import { PlanTab } from "./PlanTab";
import { unplacedReason } from "./unplaced";

const twoDays = () => {
  const [first] = makeTrip().days;
  const second = makeDay(2, [makeStop("start", null), makeStop("place", "b", { number: 1, arrive: "10:00", depart: "11:00" }), makeStop("end", null)]);
  return makeTrip({ days: [first!, { ...second, color: "#56B4E9" }] });
};

describe("PlanTab", () => {
  it("opens the first day and lists its stops in order", () => {
    const { store } = renderTrip(<PlanTab />);
    expect(store.getState().focusDay).toBe(1);
    const day = screen.getByRole("region", { name: "Day 1" });
    const toggle = within(day).getByRole("button", { name: /^Day 1 · 2 stops/ });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveTextContent("9:00 AM–6:00 PM");
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)).toContainElement(within(day).getByRole("list"));
    expect(day).not.toHaveTextContent("N ·");
    const stops = within(day).getAllByRole("listitem");
    expect(stops.map((stop) => stop.querySelector(".stop-name")?.textContent)).toEqual([
      "Hotel",
      "★★ Must go: Phở Gia Truyền",
      "Lookout",
      "Hotel",
    ]);
    expect(stops[1]).toHaveTextContent("9:00–10:00 AM");
    expect(stops[2]).toHaveTextContent("Viewpoint");
  });

  it("shows the reason in the current language", () => {
    const data = makeTrip();
    const stops = data.days[0]?.stops ?? [];
    stops[1] = { ...stops[1]!, reason: "Best broth in town", reason_vi: "Nước dùng ngon nhất" };
    const { store } = renderTrip(<PlanTab />, { data });
    expect(screen.getByText("Best broth in town")).toBeInTheDocument();
    act(() => store.getState().actions.setLang("vi"));
    expect(screen.getByText("Nước dùng ngon nhất")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Ngày 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Ngày 1 · 2 stops 9:00–18:00$/ })).toBeInTheDocument();
  });

  it("says 1 stop for a single visit", () => {
    const one = makeTrip({ days: [makeDay(1, [makeStop("start", null), makeStop("place", "a", { number: 1 }), makeStop("end", null)])] });
    const { store } = renderTrip(<PlanTab />, { data: one });
    expect(screen.getByRole("button", { name: /^Day 1 · 1 stop\b/ })).toBeInTheDocument();
    act(() => store.getState().actions.setLang("vi"));
    expect(screen.getByRole("button", { name: /^Ngày 1 · 1 điểm dừng/ })).toBeInTheDocument();
  });

  it("keeps one day open, focuses it on the map and keeps the phone sheet open", () => {
    const { store } = renderTrip(<PlanTab />, { data: twoDays(), phone: true });
    act(() => store.getState().actions.setSheetOpen(true));
    const day1 = screen.getByRole("button", { name: /^Day 1 ·/ });
    const day2 = screen.getByRole("button", { name: /^Day 2 ·/ });
    expect(day2).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(day2);
    expect(store.getState()).toMatchObject({ focusDay: 2, sheetOpen: true });
    expect(store.getState().mapIntent).toMatchObject({ type: "fitDay", day: 2 });
    expect(day1).toHaveAttribute("aria-expanded", "false");
    expect(day2).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(day2);
    expect(store.getState().focusDay).toBeNull();
    expect(day2).toHaveAttribute("aria-expanded", "false");
    act(() => store.getState().actions.setFocusDay(1));
    expect(day1).toHaveAttribute("aria-expanded", "true");
  });

  it("opens a stop's card", () => {
    const { store } = renderTrip(<PlanTab />);
    fireEvent.click(screen.getByRole("button", { name: /Phở Gia Truyền/ }));
    expect(store.getState().selected).toBe("a");
  });

  it("edits the plan from a day's pencil and returns focus to it after Done", () => {
    const { store } = renderTrip(<PlanTab />, { data: twoDays() });
    const pencils = screen.getAllByRole("button", { name: "edit_plan" });
    expect(pencils).toHaveLength(2);
    expect(pencils[1]).toHaveAccessibleDescription("Day 2");
    fireEvent.click(pencils[1]!);
    expect(store.getState()).toMatchObject({ editing: true, editDay: 2 });
    expect(screen.queryByRole("button", { name: "edit_plan" })).not.toBeInTheDocument();
    act(() => store.getState().actions.setEditing(false));
    expect(document.activeElement).toBe(screen.getAllByRole("button", { name: "edit_plan" })[1]);
  });

  it("splits long days' directions into numbered parts", () => {
    const one = makeTrip({ days: [{ ...makeDay(1, makeTrip().days[0]!.stops), directions: ["https://www.google.com/maps/dir/?api=1&a"] }] });
    const { unmount } = renderTrip(<PlanTab />, { data: one });
    expect(screen.getByRole("link", { name: /Directions/ })).toHaveAttribute("href", "https://www.google.com/maps/dir/?api=1&a");
    unmount();
    const urls = ["https://www.google.com/maps/dir/?api=1&a", "https://www.google.com/maps/dir/?api=1&b", "javascript:void(0)"];
    const two = makeTrip({ days: [{ ...makeDay(1, makeTrip().days[0]!.stops), directions: urls }] });
    renderTrip(<PlanTab />, { data: two });
    const legs = screen.getByRole("group", { name: "Directions" });
    expect(within(legs).getAllByRole("link").map((a) => a.textContent)).toEqual(["Part 1", "Part 2"]);
    expect(within(legs).getByRole("link", { name: "Directions, part 2 of 2 (opens in new tab)" })).toHaveAttribute(
      "href",
      urls[1],
    );
  });

  it("lists the places left out with their reason", () => {
    const { store } = renderTrip(<PlanTab />);
    const details = screen.getByText("not_planned").closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    fireEvent.click(within(details).getByText("not_planned"));
    const row = within(details).getByRole("button", { name: /Cà phê Đá/ });
    expect(row).toHaveTextContent("Too far");
    fireEvent.click(row);
    expect(store.getState().selected).toBe("b");
  });

  it("shows an empty state without days and opens the editor from it", () => {
    const { store } = renderTrip(<PlanTab />, { data: makeTrip({ days: [], unplaced: [] }) });
    expect(screen.getByText("No plan yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "edit_plan" }));
    expect(store.getState().editing).toBe(true);
    expect(screen.queryByRole("button", { name: "edit_plan" })).not.toBeInTheDocument();
  });

  describe("row hover", () => {
    afterEach(() => vi.useRealTimers());
    const settle = (ms = ROW_HOVER_DELAY_MS) =>
      act(() => {
        vi.advanceTimersByTime(ms);
      });
    const stopButtons = () => [...document.querySelectorAll<HTMLButtonElement>(".stop-btn")];

    it("reports the stop the mouse settles on, not the ones passed over, and never opens its card", () => {
      vi.useFakeTimers();
      const { store, container } = renderTrip(<PlanTab />);
      const [hotel, place, spot] = stopButtons();
      fireEvent.pointerOver(spot!.querySelector(".stop-name")!, { pointerType: "mouse" });
      fireEvent.pointerOver(place!, { pointerType: "mouse" });
      settle(ROW_HOVER_DELAY_MS - 1);
      expect(store.getState().hovered).toBeNull();
      settle(1);
      expect(store.getState()).toMatchObject({ hovered: "a", selected: null });
      fireEvent.pointerOver(spot!, { pointerType: "mouse" });
      settle();
      expect(store.getState().hovered).toBe("n1");
      fireEvent.pointerOver(hotel!, { pointerType: "mouse" });
      settle();
      expect(store.getState().hovered).toBeNull();
      fireEvent.pointerOver(place!, { pointerType: "mouse" });
      settle();
      fireEvent.pointerLeave(container.firstElementChild!, { pointerType: "mouse" });
      settle();
      expect(store.getState().hovered).toBeNull();
    });

    it("ignores touch, follows keyboard focus and covers the places left out", () => {
      vi.useFakeTimers();
      const { store } = renderTrip(<PlanTab />);
      const place = stopButtons()[1]!;
      fireEvent.pointerOver(place, { pointerType: "touch" });
      settle();
      expect(store.getState().hovered).toBeNull();
      fireEvent.keyDown(document.body, { key: "Tab" });
      act(() => {
        place.focus();
      });
      settle();
      expect(store.getState().hovered).toBe("a");
      act(() => {
        place.blur();
      });
      settle();
      expect(store.getState().hovered).toBeNull();
      fireEvent.pointerOver(document.querySelector(".unplaced .row-btn")!, { pointerType: "mouse" });
      settle();
      expect(store.getState().hovered).toBe("b");
    });

    it("gives hidden places and the hotel no hover target", () => {
      const { store } = renderTrip(<PlanTab />);
      expect(stopButtons()[1]).toHaveAttribute("data-hover-id", "a");
      act(() => store.getState().actions.setHidden("a", true));
      expect(stopButtons()[1]).not.toHaveAttribute("data-hover-id");
      expect(stopButtons()[0]).not.toHaveAttribute("data-hover-id");
    });
  });

  it("marks hidden places in the timeline", () => {
    const { store } = renderTrip(<PlanTab />);
    act(() => store.getState().actions.setHidden("a", true));
    expect(screen.getByRole("button", { name: /Phở Gia Truyền/ }).closest("li")).toHaveClass("is-hidden");
  });
});

describe("PeekNext", () => {
  it("renders only on phones", () => {
    renderTrip(<PeekNext />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the next stop and opens it", () => {
    const data = makeTrip({
      days: [makeDay(1, [makeStop("start", null), makeStop("place", "a", { arrive: "00:00", depart: "23:59" }), makeStop("end", null)])],
    });
    data.labels.en!.ui.leg = "{n} min";
    const { store } = renderTrip(<PeekNext />, { data, phone: true });
    const peek = screen.getByRole("button");
    expect(peek).toHaveTextContent("Next:");
    expect(peek).toHaveTextContent("Phở Gia Truyền");
    expect(peek).toHaveTextContent("Day 1 · #1 · 10 min");
    fireEvent.click(peek);
    expect(store.getState().selected).toBe("a");
  });
});

describe("unplacedReason", () => {
  const labels = makeTrip().labels.en!;
  const t = createTranslator(labels, "en");
  const item = { ref: "x", name: "X", reason: "", code: null, reason_text: {} };

  it("prefers the export's text, then code label plus the planner's words", () => {
    expect(unplacedReason(t, { ...item, reason_text: { en: "Own text" } })).toBe("Own text");
    expect(unplacedReason(t, { ...item, code: "too_far" })).toBe("Too far");
    expect(unplacedReason(t, { ...item, code: "too_far", reason: "40 min away" })).toBe("Too far · 40 min away");
    expect(unplacedReason(t, { ...item, code: "too_far", reason: "too far" })).toBe("Too far");
    expect(unplacedReason(t, { ...item, code: "closed" })).toBe("Closed on trip days");
    expect(unplacedReason(t, { ...item, reason: "Just because" })).toBe("Just because");
  });

  it("uses the Vietnamese planner words in Vietnamese", () => {
    const vi = createTranslator(makeTrip().labels.vi!, "vi");
    expect(unplacedReason(vi, { ...item, reason: "far", reason_vi: "xa" } as typeof item)).toBe("xa");
  });
});
