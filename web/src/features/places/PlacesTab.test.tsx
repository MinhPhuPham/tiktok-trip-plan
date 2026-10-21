import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOM_IDS } from "../../app/ids";
import { ROW_HOVER_DELAY_MS } from "../../state/useRowHover";
import { renderTrip } from "../../test/renderTrip";
import { Toast } from "../../ui/Toast";
import { PlacesTab } from "./PlacesTab";
import { SEARCH_DELAY_MS } from "./SearchBox";

/** Row names without stars, screen-reader priority or badges. */
const listed = () =>
  [...document.querySelectorAll(".row-name")].map((name) =>
    [...name.childNodes].flatMap((node) => (node.nodeType === Node.TEXT_NODE ? [node.textContent] : [])).join(""),
  );

function openFilters() {
  fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
}

describe("PlacesTab", () => {
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

  it("filters by day, including places not in the plan", () => {
    renderTrip(<PlacesTab />);
    const days = screen.getByRole("group", { name: "day" });
    fireEvent.click(within(days).getByRole("button", { name: "Day 1" }));
    expect(listed()).toEqual(["Phở Gia Truyền"]);
    fireEvent.click(within(days).getByRole("button", { name: "not_planned" }));
    expect(within(days).getByRole("button", { name: "not_planned" })).toHaveAttribute("aria-pressed", "true");
    expect(listed()).toEqual(["Cà phê Đá", "Bảo tàng"]);
  });

  it("filters by direction with the compass and counts active filters", () => {
    renderTrip(<PlacesTab />);
    const toggle = screen.getByRole("button", { name: /Filters/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    openFilters();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const compass = screen.getByRole("group", { name: "direction" });
    expect(within(compass).getByRole("button", { name: "W – W" })).toBeDisabled();
    const east = within(compass).getByRole("button", { name: "E – East" });
    fireEvent.click(east);
    expect(east).toHaveAttribute("aria-pressed", "true");
    expect(within(compass).getByRole("button", { name: "all_directions" })).toHaveAttribute("aria-pressed", "false");
    expect(listed()).toEqual(["Cà phê Đá"]);
    expect(toggle).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: "No direction" }));
    expect(listed()).toEqual(["Cà phê Đá", "Bảo tàng"]);
    fireEvent.click(within(compass).getByRole("button", { name: "all_directions" }));
    expect(listed()).toHaveLength(3);
  });

  it("filters by priority, category and tag", () => {
    renderTrip(<PlacesTab />);
    openFilters();
    const priority = screen.getByRole("group", { name: "priority" });
    expect(within(priority).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "★★★★Must go",
      "★★★High",
      "unrated",
    ]);
    fireEvent.click(within(priority).getByRole("button", { name: /unrated/ }));
    expect(listed()).toEqual(["Bảo tàng"]);
    fireEvent.click(within(priority).getByRole("button", { name: /unrated/ }));

    fireEvent.click(within(screen.getByRole("group", { name: "category" })).getByRole("button", { name: "Cafe" }));
    expect(listed()).toEqual(["Cà phê Đá"]);
    fireEvent.click(within(screen.getByRole("group", { name: "category" })).getByRole("button", { name: "Cafe" }));

    const tag = within(screen.getByRole("group", { name: "tags" })).getByRole("button", { name: /Local favourite/ });
    expect(tag).toHaveTextContent("1");
    fireEvent.click(tag);
    expect(listed()).toEqual(["Phở Gia Truyền"]);
  });

  it("shows an empty state whose reset clears every filter and focuses the search", () => {
    const { store } = renderTrip(<PlacesTab />);
    fireEvent.change(document.getElementById(DOM_IDS.search) as HTMLInputElement, { target: { value: "zzz" } });
    act(() => {
      vi.advanceTimersByTime(SEARCH_DELAY_MS);
    });
    expect(screen.getByText("no_results")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    const resets = screen.getAllByRole("button", { name: "reset" });
    expect(resets).toHaveLength(2);
    fireEvent.click(resets[1] as HTMLElement);
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
    renderTrip(<PlacesTab />, { lang: "vi" });
    fireEvent.click(screen.getByRole("button", { name: /Bộ lọc/ }));
    expect(within(screen.getByRole("group", { name: "day" })).getByRole("button", { name: "Ngày 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ưu tiên high/ })).toBeInTheDocument();
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
