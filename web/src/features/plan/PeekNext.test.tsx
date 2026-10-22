import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectSheetOpen } from "../../state/store";
import { makeDay, makeStop, makeTrip, threeVisitTrip } from "../../test/fixtures";
import { renderTrip } from "../../test/renderTrip";
import type { TripData } from "../../data/types";
import { PEEK_IDLE_RESET_MS } from "../../app/usePeekFocus";
import { PeekNext } from "./PeekNext";

const withLegs = (data: TripData): TripData => {
  data.labels.en!.ui.leg = "{n} min";
  data.labels.vi!.ui.leg = "{n} phút";
  return data;
};
/** Dated, with today (Oct 21) as Day 1: the peek follows the clock. */
const trip = () => withLegs({ ...threeVisitTrip(), tripDates: ["2026-10-21"] });
/** Undated, two days: the peek starts at the open day's #1. */
const undated = () => {
  const data = withLegs(threeVisitTrip());
  data.days.push(
    makeDay(2, [
      makeStop("start", null, { travel_min_to_next: 15 }),
      makeStop("place", "c", { arrive: "09:30", depart: "10:30" }),
      makeStop("end", null, { arrive: "18:00" }),
    ]),
  );
  return data;
};

const peekMain = () => document.getElementById("peekMain")!;
const prev = () => screen.getByRole("button", { name: /^Previous stop/ });
const next = () => screen.getByRole("button", { name: /^Next stop/ });

describe("PeekNext", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date(2026, 9, 21, 10, 30));
  });
  afterEach(() => vi.useRealTimers());

  it("renders only on phones", () => {
    renderTrip(<PeekNext />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the next stop on a trip day and opens it", () => {
    const data = makeTrip({
      days: [makeDay(1, [makeStop("start", null), makeStop("place", "a", { arrive: "00:00", depart: "23:59" }), makeStop("end", null)])],
      tripDates: ["2026-10-21"],
    });
    const { store } = renderTrip(<PeekNext />, { data: withLegs(data), phone: true });
    expect(peekMain()).toHaveTextContent("Next: 12:00 AM · Day 1 · #1 · 10 min");
    expect(peekMain()).toHaveTextContent("Phở Gia Truyền");
    expect(prev()).toHaveAttribute("aria-disabled", "true");
    expect(next()).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(peekMain());
    expect(store.getState().selected).toBe("a");
  });

  it("steps through the day's visits, lights each on the map and stops at the ends", () => {
    const { store } = renderTrip(<PeekNext />, { data: trip(), phone: true });
    expect(peekMain()).toHaveTextContent("Next: 10:15 AM · Day 1 · #2 · 7 min");
    expect(peekMain()).toHaveTextContent("Cà phê Đá");
    expect(prev()).toHaveAccessibleName("Previous stop: Phở Gia Truyền");
    expect(next()).toHaveAccessibleName("Next stop: Lookout");
    expect(store.getState().hovered).toBeNull();

    fireEvent.click(prev());
    expect(peekMain()).toHaveTextContent("Day 1 · #1 · 9:00 AM · 10 min");
    expect(peekMain()).not.toHaveTextContent("Next:");
    expect(peekMain()).toHaveTextContent("Phở Gia Truyền");
    expect(store.getState().hovered).toBe("a");
    expect(store.getState().mapIntent).toMatchObject({ type: "fly", id: "a" });
    expect(prev()).toHaveAttribute("aria-disabled", "true");
    expect(prev()).toHaveAccessibleName("Previous stop");
    const intent = store.getState().mapIntent;
    fireEvent.click(prev());
    expect(store.getState().hovered).toBe("a");
    expect(store.getState().mapIntent).toBe(intent);

    fireEvent.click(next());
    fireEvent.click(next());
    expect(peekMain()).toHaveTextContent("Day 1 · #3 · 11:45 AM");
    expect(store.getState().hovered).toBe("n1");
    expect(next()).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(next());
    expect(peekMain()).toHaveTextContent("Lookout");
    expect(selectSheetOpen(store.getState())).toBe(false);
  });

  it("opens the card of the stop it shows", () => {
    const { store } = renderTrip(<PeekNext />, { data: trip(), phone: true });
    fireEvent.click(next());
    fireEvent.click(peekMain());
    expect(store.getState().selected).toBe("n1");
    expect(store.getState().mapIntent).toMatchObject({ type: "fly", id: "n1" });
  });

  it("an open card follows the stepped stop", () => {
    const { store } = renderTrip(<PeekNext />, { data: trip(), phone: true });
    fireEvent.click(peekMain());
    expect(store.getState().selected).toBe("b");
    fireEvent.click(next());
    expect(store.getState().selected).toBe("n1");
    expect(store.getState().mapIntent).toMatchObject({ type: "fly", id: "n1" });
  });

  it("steps with the arrow keys and a horizontal swipe, not a vertical one", () => {
    const { store } = renderTrip(<PeekNext />, { data: trip(), phone: true });
    fireEvent.keyDown(peekMain(), { key: "ArrowRight" });
    expect(store.getState().hovered).toBe("n1");

    const swipe = (dx: number, dy: number) => {
      fireEvent.pointerDown(peekMain(), { pointerId: 7, isPrimary: true, button: 0, clientX: 200, clientY: 300 });
      fireEvent.pointerUp(window, { pointerId: 7, clientX: 200 + dx, clientY: 300 + dy });
      fireEvent.click(peekMain());
    };
    swipe(60, 8);
    expect(store.getState().hovered).toBe("b");
    expect(store.getState().selected).toBeNull();
    swipe(60, 0);
    expect(store.getState().hovered).toBe("a");
    swipe(-20, -90);
    expect(store.getState().hovered).toBe("a");
    expect(store.getState().selected).toBe("a");
  });

  it("goes back to the next stop after two idle minutes and clears its pin highlight", () => {
    const { store } = renderTrip(<PeekNext />, { data: trip(), phone: true });
    fireEvent.click(prev());
    expect(store.getState().hovered).toBe("a");
    act(() => {
      vi.advanceTimersByTime(PEEK_IDLE_RESET_MS);
    });
    expect(peekMain()).toHaveTextContent("Next: 10:15 AM");
    expect(store.getState().hovered).toBeNull();
  });

  it("on an undated trip starts at the open day's #1 whatever the clock", () => {
    vi.setSystemTime(new Date(2026, 9, 21, 15, 0));
    const { store } = renderTrip(<PeekNext />, { data: undated(), phone: true });
    expect(peekMain()).toHaveTextContent("Day 1 · #1 · 9:00 AM · 10 min");
    expect(peekMain()).toHaveTextContent("Phở Gia Truyền");
    expect(peekMain()).not.toHaveTextContent("Next:");
    expect(peekMain()).toHaveAttribute("title", "Day 1 · #1 9:00 AM Phở Gia Truyền");

    act(() => store.getState().actions.setFocusDay(2));
    expect(peekMain()).toHaveTextContent("Day 2 · #1 · 9:30 AM · 15 min");
    expect(peekMain()).toHaveTextContent("Bảo tàng");

    act(() => store.getState().actions.setFocusDay(null));
    expect(peekMain()).toHaveTextContent("Day 1 · #1");
  });

  it("on an undated trip goes back to #1 after two idle minutes", () => {
    const { store } = renderTrip(<PeekNext />, { data: undated(), phone: true });
    fireEvent.click(next());
    fireEvent.click(next());
    expect(peekMain()).toHaveTextContent("Day 1 · #3");
    expect(store.getState().hovered).toBe("n1");
    act(() => {
      vi.advanceTimersByTime(PEEK_IDLE_RESET_MS);
    });
    expect(peekMain()).toHaveTextContent("Day 1 · #1 · 9:00 AM");
    expect(store.getState().hovered).toBeNull();
  });

  it("opening another day while browsing starts that day at #1", () => {
    const { store } = renderTrip(<PeekNext />, { data: undated(), phone: true });
    fireEvent.click(next());
    expect(peekMain()).toHaveTextContent("Day 1 · #2");
    act(() => store.getState().actions.setFocusDay(2));
    expect(peekMain()).toHaveTextContent("Day 2 · #1");
    expect(store.getState().hovered).toBeNull();
    act(() => store.getState().actions.setFocusDay(1));
    expect(peekMain()).toHaveTextContent("Day 1 · #1");
  });

  it("speaks Vietnamese on an undated trip", () => {
    renderTrip(<PeekNext />, { data: undated(), phone: true, lang: "vi" });
    expect(peekMain()).toHaveTextContent("Ngày 1 · #1 · 9:00 · 10 phút");
    expect(peekMain()).not.toHaveTextContent("Tiếp theo");
  });

  it("speaks Vietnamese", () => {
    const { store } = renderTrip(<PeekNext />, { data: trip(), phone: true, lang: "vi" });
    expect(screen.getByRole("button", { name: "Điểm dừng trước: Phở Gia Truyền" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Điểm dừng tiếp theo: Lookout" })).toBeInTheDocument();
    expect(peekMain()).toHaveTextContent("Tiếp theo: 10:15 · Ngày 1 · #2");
    expect(store.getState().lang).toBe("vi");
  });
});
