import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PEEK_IDLE_RESET_MS } from "../../app/usePeekFocus";
import type { TripData } from "../../data/types";
import { makeTrip } from "../../test/fixtures";
import { renderTrip } from "../../test/renderTrip";
import { PlacesPeek } from "./PlacesPeek";

/** The map_ui labels the peek uses that the fixture does not ship. */
function withLabels(data: TripData): TripData {
  Object.assign(data.labels.en!.ui, { all: "All", search: "Search places", not_planned: "Not planned", unrated: "Not rated" });
  Object.assign(data.labels.vi!.ui, { all: "Tất cả", search: "Tìm địa điểm", not_planned: "Chưa xếp lịch", unrated: "Chưa đánh giá" });
  return data;
}

const trip = () => withLabels(makeTrip());

/** Breakfast at a (must, food) and b (high, cafe), lunch at b and c (unrated attraction). */
function taggedTrip() {
  const data = trip();
  const tags: Record<string, string[]> = { a: ["breakfast"], b: ["breakfast", "lunch"], c: ["lunch"] };
  return { ...data, places: data.places.map((p) => ({ ...p, tags: tags[p.id] ?? [] })) };
}

const main = () => document.getElementById("peekMain")!;
const meta = () => document.querySelector(".peek-meta")!;
const prev = () => screen.getByRole("button", { name: /^Previous place/ });
const next = () => screen.getByRole("button", { name: /^Next place/ });

describe("PlacesPeek", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("renders only on phones", () => {
    renderTrip(<PlacesPeek />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("names the list as filtered and shows its first place", () => {
    const { store } = renderTrip(<PlacesPeek />, { data: taggedTrip(), phone: true });
    expect(meta()).toHaveTextContent("All · 3 · Day 1 · #1 · 1.0 km · Food");
    expect(main()).toHaveTextContent("Phở Gia Truyền");
    expect(store.getState().hovered).toBeNull();

    act(() => store.getState().actions.toggleFilter("intents", "breakfast"));
    expect(meta()).toHaveTextContent(/^Breakfast · 2 · /);
    act(() => store.getState().actions.setQuery("cà phê"));
    expect(meta()).toHaveTextContent(/^“cà phê” \+1 · 1 · 2\.5 km · Cafe$/);
    expect(main()).toHaveTextContent("Cà phê Đá");
    expect(meta().querySelector("b")).toHaveTextContent("“cà phê” +1 · 1");
    expect(main()).toHaveAttribute("title", "“cà phê” · Breakfast · 1 place: Cà phê Đá");

    act(() => {
      store.getState().actions.resetFilters();
      store.getState().actions.setDayFilter("none");
    });
    expect(meta()).toHaveTextContent(/^Not planned · 2 · /);
  });

  it("steps through the list as shown, lighting each place on the map, and stops at the ends", () => {
    const { store } = renderTrip(<PlacesPeek />, { data: trip(), phone: true });
    expect(prev()).toHaveAttribute("aria-disabled", "true");
    expect(next()).toHaveAccessibleName("Next place: Cà phê Đá");

    fireEvent.click(next());
    expect(meta()).toHaveTextContent("All · 2/3 · 2.5 km · Cafe");
    expect(main()).toHaveTextContent("Cà phê Đá");
    expect(store.getState().hovered).toBe("b");
    expect(store.getState().mapIntent).toMatchObject({ type: "fly", id: "b" });
    expect(screen.getByRole("status")).toHaveTextContent("All · 2/3 · 2.5 km · Cafe Cà phê Đá");

    fireEvent.click(next());
    expect(main()).toHaveTextContent("Bảo tàng");
    expect(next()).toHaveAttribute("aria-disabled", "true");
    const intent = store.getState().mapIntent;
    fireEvent.click(next());
    expect(store.getState().mapIntent).toBe(intent);

    fireEvent.click(prev());
    fireEvent.click(prev());
    expect(meta()).toHaveTextContent("All · 1/3");
    expect(store.getState().hovered).toBe("a");
    expect(store.getState().sheet).toBe("peek");
  });

  it("follows the ranked order while intents are chosen", () => {
    const { store } = renderTrip(<PlacesPeek />, { data: taggedTrip(), phone: true });
    act(() => store.getState().actions.toggleFilter("intents", "lunch"));
    const first = main().querySelector(".peek-name")!.textContent;
    fireEvent.click(next());
    const second = main().querySelector(".peek-name")!.textContent;
    expect(new Set([first, second])).toEqual(new Set(["Cà phê Đá", "Bảo tàng"]));
  });

  it("opens the card of the place it shows, and an open card follows the steps", () => {
    const { store } = renderTrip(<PlacesPeek />, { data: trip(), phone: true });
    fireEvent.click(main());
    expect(store.getState().selected).toBe("a");
    fireEvent.click(next());
    expect(store.getState().selected).toBe("b");
  });

  it("steps with the arrow keys and a horizontal swipe", () => {
    const { store } = renderTrip(<PlacesPeek />, { data: trip(), phone: true });
    fireEvent.keyDown(main(), { key: "ArrowRight" });
    expect(store.getState().hovered).toBe("b");
    fireEvent.pointerDown(main(), { pointerId: 3, isPrimary: true, button: 0, clientX: 200, clientY: 300 });
    fireEvent.pointerUp(window, { pointerId: 3, clientX: 140, clientY: 304 });
    fireEvent.click(main());
    expect(store.getState().hovered).toBe("c");
    expect(store.getState().selected).toBeNull();
  });

  it("starts over at the first result when the filters or the search change", () => {
    const { store } = renderTrip(<PlacesPeek />, { data: taggedTrip(), phone: true });
    fireEvent.click(next());
    fireEvent.click(next());
    expect(store.getState().hovered).toBe("c");
    act(() => store.getState().actions.toggleFilter("intents", "breakfast"));
    expect(meta()).toHaveTextContent(/^Breakfast · 2 · /);
    expect(main()).toHaveTextContent("Phở Gia Truyền");
    expect(store.getState().hovered).toBeNull();

    fireEvent.click(next());
    act(() => store.getState().actions.setQuery("phở"));
    expect(main()).toHaveTextContent("Phở Gia Truyền");
    expect(store.getState().hovered).toBeNull();
  });

  it("lets go of the pin after two idle minutes", () => {
    const { store } = renderTrip(<PlacesPeek />, { data: trip(), phone: true });
    fireEvent.click(next());
    act(() => {
      vi.advanceTimersByTime(PEEK_IDLE_RESET_MS);
    });
    expect(meta()).toHaveTextContent(/^All · 3 · /);
    expect(store.getState().hovered).toBeNull();
  });

  it("says when nothing matches and clears the filters", () => {
    const { store } = renderTrip(<PlacesPeek />, { data: trip(), phone: true });
    act(() => store.getState().actions.setQuery("zzz"));
    expect(screen.getByRole("status")).toHaveTextContent("Nothing matches");
    expect(meta()).toHaveTextContent("“zzz”");
    expect(screen.queryByRole("button", { name: /^Next place/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(store.getState().filters.q).toBe("");
    expect(meta()).toHaveTextContent(/^All · 3 · /);
    expect(main()).toHaveFocus();
  });

  it("has no clear button when no filter is the reason the list is empty", () => {
    const { store } = renderTrip(<PlacesPeek />, { data: trip(), phone: true });
    act(() => {
      for (const id of ["a", "b", "c"]) store.getState().actions.setHidden(id, true);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Nothing matches");
    expect(meta()).toHaveTextContent("All");
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("the search button opens the Places search at full height", () => {
    const { store } = renderTrip(
      <>
        <PlacesPeek />
        <input id="q" />
      </>,
      { data: trip(), phone: true },
    );
    fireEvent.click(screen.getByRole("button", { name: "Search places" }));
    expect(store.getState().tab).toBe("places");
    expect(store.getState().sheet).toBe("full");
    expect(document.getElementById("q")).toHaveFocus();
  });

  it("speaks Vietnamese", () => {
    renderTrip(<PlacesPeek />, { data: trip(), phone: true, lang: "vi" });
    expect(meta()).toHaveTextContent(/^Tất cả · 3 · /);
    expect(screen.getByRole("button", { name: "Tìm địa điểm" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Địa điểm tiếp theo: Cà phê Đá" })).toBeInTheDocument();
  });
});
