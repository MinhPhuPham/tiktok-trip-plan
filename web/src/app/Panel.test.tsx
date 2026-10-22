import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TripData } from "../data/types";
import { stubDialog } from "../test/dialog";
import { makeTrip } from "../test/fixtures";
import { renderTrip } from "../test/renderTrip";
import { Panel } from "./Panel";

const trip = (): TripData => {
  const data = makeTrip();
  Object.assign(data.labels.en!.ui, { all: "All", search: "Search places" });
  return data;
};

const peekMeta = () => document.querySelector(".sheet-peek .peek-meta");
const sheetHead = () => document.querySelector(".sheet-head")!;

describe("Panel", () => {
  beforeAll(stubDialog);
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("on desktop keeps the city title block above the tabs", () => {
    renderTrip(<Panel />, { data: trip() });
    expect(sheetHead().querySelector(".panel-head")).toBeInTheDocument();
    const title = screen.getByRole("heading", { level: 1, name: "Đà Lạt" });
    expect(title).not.toHaveClass("sr-only");
    expect(screen.getByRole("complementary", { name: "Đà Lạt" })).toBeInTheDocument();
  });

  it("on phones puts the tabs right under the handle and keeps the trip name for screen readers", () => {
    renderTrip(<Panel />, { data: trip(), phone: true });
    expect(document.querySelector(".panel-head")).not.toBeInTheDocument();
    expect(sheetHead().firstElementChild).toHaveAttribute("role", "tablist");
    const title = screen.getByRole("heading", { level: 1, name: "Đà Lạt · 3 days · Driving" });
    expect(title).toHaveClass("sr-only");
    expect(title.closest("[inert]")).toBeNull();
    expect(screen.getByRole("complementary", { name: "Đà Lạt · 3 days · Driving" })).toBeInTheDocument();
  });

  it("the peek row follows the tab at once and a tab switch lets go of the browsed pin", () => {
    const { store } = renderTrip(<Panel />, { data: trip(), phone: true });
    expect(peekMeta()).toHaveTextContent(/^Day 1 · #1/);

    act(() => store.getState().actions.setTab("places"));
    expect(peekMeta()).toHaveTextContent(/^All · 3 · /);
    fireEvent.click(screen.getByRole("button", { name: /^Next place/ }));
    expect(store.getState().hovered).toBe("b");

    act(() => store.getState().actions.setTab("plan"));
    expect(store.getState().hovered).toBeNull();
    expect(peekMeta()).toHaveTextContent(/^Day 1 · #1/);
    fireEvent.click(screen.getByRole("button", { name: /^Next stop/ }));
    expect(store.getState().hovered).toBe("n1");

    act(() => store.getState().actions.setTab("places"));
    expect(store.getState().hovered).toBeNull();
    expect(peekMeta()).toHaveTextContent(/^All · 3 · /);
  });

  it("the Places peek's search button shows the search at full height, focused", () => {
    const { store } = renderTrip(<Panel />, { data: trip(), phone: true });
    act(() => store.getState().actions.setTab("places"));
    fireEvent.click(screen.getByRole("button", { name: "Search places" }));
    expect(store.getState().sheet).toBe("full");
    expect(document.getElementById("q")).toHaveFocus();
    expect(document.getElementById("panelBody")).not.toHaveAttribute("inert");
  });
});
