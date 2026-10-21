import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DOM_IDS } from "../../app/ids";
import { stubDialog } from "../../test/dialog";
import { ROW_HOVER_DELAY_MS } from "../../state/useRowHover";
import { makeTrip } from "../../test/fixtures";
import { renderTrip } from "../../test/renderTrip";
import { Toast } from "../../ui/Toast";
import { PlacesTab } from "./PlacesTab";
import { SEARCH_DELAY_MS } from "./SearchBox";

/** Row names without stars, screen-reader priority or badges. */
const listed = () =>
  [...document.querySelectorAll(".row-name")].map((name) =>
    [...name.childNodes].flatMap((node) => (node.nodeType === Node.TEXT_NODE ? [node.textContent] : [])).join(""),
  );

/** Breakfast at a (must, food) and b (high, cafe), lunch at b and c (unrated attraction). */
function taggedTrip() {
  const data = makeTrip();
  const tags: Record<string, string[]> = { a: ["breakfast"], b: ["breakfast", "lunch"], c: ["lunch"] };
  return { ...data, places: data.places.map((p) => ({ ...p, tags: tags[p.id] ?? [] })) };
}

describe("PlacesTab", () => {
  beforeAll(stubDialog);
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("lists must-go places first under their own heading", () => {
    renderTrip(<PlacesTab />);
    expect(screen.getByRole("heading", { name: /must_go/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /other_places/ })).toBeInTheDocument();
    expect(listed()).toEqual(["Phở Gia Truyền", "Cà phê Đá", "Bảo tàng"]);
    expect(screen.getByText("3 of 3 places")).toBeInTheDocument();
  });

  it("marks the row whose card is open", () => {
    const { store } = renderTrip(<PlacesTab />);
    const row = screen.getByRole("button", { name: /Phở Gia Truyền/ });
    expect(row).not.toHaveAttribute("aria-current");
    fireEvent.click(row);
    expect(store.getState().selected).toBe("a");
    expect(row).toHaveAttribute("aria-current", "true");
  });

  it("shows the day and stop of planned places", () => {
    renderTrip(<PlacesTab />);
    const row = screen.getByRole("button", { name: /Phở Gia Truyền/ });
    expect(within(row).getByText("Day 1 · #1")).toBeInTheDocument();
  });

  it("searches without accents after a short pause", () => {
    const { store } = renderTrip(<PlacesTab />);
    const input = document.getElementById(DOM_IDS.search) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  pho " } });
    expect(store.getState().filters.q).toBe("");
    act(() => {
      vi.advanceTimersByTime(SEARCH_DELAY_MS);
    });
    expect(store.getState().filters.q).toBe("pho");
    expect(listed()).toEqual(["Phở Gia Truyền"]);
    expect(screen.getByText("1 of 3 places")).toBeInTheDocument();
  });

  it("finds places by tag name in another language", () => {
    renderTrip(<PlacesTab />);
    fireEvent.change(document.getElementById(DOM_IDS.search) as HTMLInputElement, { target: { value: "quan dia phuong" } });
    act(() => {
      vi.advanceTimersByTime(SEARCH_DELAY_MS);
    });
    expect(listed()).toEqual(["Phở Gia Truyền"]);
  });

  it("filters by day with a menu that counts each day's places", () => {
    renderTrip(<PlacesTab />);
    const day = screen.getByRole("combobox", { name: "day" });
    expect([...day.querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "All days",
      "Day 1 · 1 places",
      "not_planned · 2 places",
    ]);
    fireEvent.change(day, { target: { value: "1" } });
    expect(listed()).toEqual(["Phở Gia Truyền"]);
    expect(day.closest(".select")?.querySelector(".select-v")).toHaveTextContent(/^Day 1$/);
    fireEvent.change(day, { target: { value: "none" } });
    expect(listed()).toEqual(["Cà phê Đá", "Bảo tàng"]);
  });

  it("filters by priority and category with menus", () => {
    renderTrip(<PlacesTab />);
    const priority = screen.getByRole("combobox", { name: "priority" });
    expect([...priority.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["all", "Must go", "High", "unrated"]);
    fireEvent.change(priority, { target: { value: "none" } });
    expect(listed()).toEqual(["Bảo tàng"]);
    expect(priority.closest(".select")).toHaveClass("is-on");
    fireEvent.change(priority, { target: { value: "all" } });
    expect(listed()).toHaveLength(3);

    const category = screen.getByRole("combobox", { name: "category" });
    fireEvent.change(category, { target: { value: "cafe" } });
    expect(listed()).toEqual(["Cà phê Đá"]);
    expect(category.closest(".select")?.querySelector(".select-v")).toHaveTextContent(/^Cafe$/);
  });

  it("offers Good for intents in a menu with counts, lists their union by relevance and clears them", () => {
    const { store } = renderTrip(<PlacesTab />, { data: taggedTrip() });
    const trigger = screen.getByRole("button", { name: "Good for" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const list = screen.getByRole("listbox", { name: "Good for" });
    expect(list).toHaveFocus();
    expect(list).toHaveAttribute("aria-multiselectable", "true");
    const options = () => within(list).getAllByRole("option").map((o) => o.textContent);
    expect(options()).toEqual(["Breakfast2", "Lunch2", "Coffee & chill1"]);

    fireEvent.click(within(list).getByRole("option", { name: /Breakfast/ }));
    expect(listed()).toEqual(["Phở Gia Truyền", "Cà phê Đá"]);
    expect(screen.queryByRole("heading", { name: /must_go/ })).not.toBeInTheDocument();
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: " " });
    expect(within(list).getByRole("option", { name: /Lunch/ })).toHaveAttribute("aria-selected", "true");
    expect(listed()).toEqual(["Phở Gia Truyền", "Cà phê Đá", "Bảo tàng"]);
    fireEvent.keyDown(list, { key: "Enter" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAccessibleName("Good for: Breakfast, Lunch");
    expect(trigger).toHaveTextContent("Breakfast +1");
    expect(trigger).toHaveClass("is-on");

    fireEvent.change(screen.getByRole("combobox", { name: "category" }), { target: { value: "attraction" } });
    fireEvent.click(trigger);
    expect(options()).toEqual(["Breakfast0", "Lunch1"]);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(store.getState().filters.intents.size).toBe(0);
    expect(options()).toEqual(["Lunch1"]);
    fireEvent.keyDown(list, { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  it("keeps the Good for menu in place, disabled, while the other filters leave no intent", () => {
    renderTrip(<PlacesTab />, { data: taggedTrip() });
    fireEvent.change(document.getElementById(DOM_IDS.search) as HTMLInputElement, { target: { value: "zzz" } });
    act(() => {
      vi.advanceTimersByTime(SEARCH_DELAY_MS);
    });
    expect(screen.getByRole("button", { name: "Good for" })).toBeDisabled();
  });

  it("leaves Good for out when no place fits any intent", () => {
    const data = makeTrip();
    renderTrip(<PlacesTab />, { data: { ...data, places: data.places.filter((p) => p.category !== "cafe") } });
    expect(screen.queryByRole("button", { name: "Good for" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "direction" })).not.toBeInTheDocument();
  });

  it("shows an empty state whose reset clears every filter and focuses the search", () => {
    const { store } = renderTrip(<PlacesTab />);
    fireEvent.change(document.getElementById(DOM_IDS.search) as HTMLInputElement, { target: { value: "zzz" } });
    act(() => {
      vi.advanceTimersByTime(SEARCH_DELAY_MS);
    });
    expect(screen.getByText("no_results")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "reset" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(store.getState().filters.q).toBe("");
    expect(document.getElementById(DOM_IDS.search)).toHaveValue("");
    expect(document.getElementById(DOM_IDS.search)).toHaveFocus();
    expect(listed()).toHaveLength(3);
  });

  it("leaves hidden places out until shown, then offers to restore them", () => {
    const { store } = renderTrip(
      <>
        <PlacesTab />
        <Toast />
      </>,
    );
    act(() => store.getState().actions.setHidden("b", true));
    expect(listed()).toEqual(["Phở Gia Truyền", "Bảo tàng"]);
    expect(screen.getByText("2 of 3 places · 1 hidden")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show hidden" }));
    expect(listed()).toEqual(["Phở Gia Truyền", "Cà phê Đá", "Bảo tàng"]);
    expect(screen.getByText("hidden_badge")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show in my list again: Cà phê Đá" }));
    expect(store.getState().hidden.has("b")).toBe(false);
    expect(store.getState().toast?.message).toBe("restored_toast");
    expect(screen.queryByRole("button", { name: "Show hidden" })).not.toBeInTheDocument();
  });

  it("opens the card from a row", () => {
    const { store } = renderTrip(<PlacesTab />);
    fireEvent.click(screen.getByRole("button", { name: /Bảo tàng/ }));
    expect(store.getState().selected).toBe("c");
  });

  it("speaks Vietnamese", () => {
    renderTrip(<PlacesTab />, { lang: "vi", data: taggedTrip() });
    const day = screen.getByRole("combobox", { name: "day" });
    expect([...day.querySelectorAll("option")].map((o) => o.textContent).slice(0, 2)).toEqual(["Tất cả các ngày", "Ngày 1 · 1 địa điểm"]);
    fireEvent.click(screen.getByRole("button", { name: "Gợi ý cho" }));
    const list = screen.getByRole("listbox", { name: "Gợi ý cho" });
    expect(within(list).getByRole("option", { name: /Ăn sáng/ })).toBeInTheDocument();
    expect(within(list).getByRole("option", { name: /Cà phê chill/ })).toBeInTheDocument();
  });

  it("reports the place row the mouse settles on and clears it on leave or unmount", () => {
    const { store, unmount } = renderTrip(<PlacesTab />);
    const settle = () =>
      act(() => {
        vi.advanceTimersByTime(ROW_HOVER_DELAY_MS);
      });
    const rows = [...document.querySelectorAll<HTMLButtonElement>(".place-row .row-btn")];
    for (const row of rows) fireEvent.pointerOver(row.querySelector(".row-name")!, { pointerType: "mouse" });
    settle();
    expect(store.getState()).toMatchObject({ hovered: rows.at(-1)!.dataset.hoverId, selected: null });
    fireEvent.pointerLeave(rows[0]!.closest(".place-list")!.parentElement!.parentElement!, { pointerType: "mouse" });
    settle();
    expect(store.getState().hovered).toBeNull();
    fireEvent.pointerOver(rows[0]!, { pointerType: "mouse" });
    settle();
    expect(store.getState().hovered).toBe("a");
    unmount();
    expect(store.getState().hovered).toBeNull();
  });
});
