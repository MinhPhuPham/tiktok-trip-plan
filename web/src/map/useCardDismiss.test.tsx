import { act, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderTrip } from "../test/renderTrip";
import { createFingerReach } from "./fingerReach";
import L from "./leafletGlobal";
import type { MapHandle } from "./mapCore";
import { DISMISS_DELAY_MS, useCardDismiss } from "./useCardDismiss";

function Dismiss({ handle }: { handle: MapHandle }) {
  useCardDismiss(handle);
  return null;
}

function setup({ phone = false } = {}) {
  const element = document.createElement("div");
  element.tabIndex = -1;
  document.body.append(element);
  const map = L.map(element, { fadeAnimation: false, zoomAnimation: false }).setView([10.77, 106.7], 14);
  const handle: MapHandle = { map, reach: createFingerReach(map), renderers: { compass: L.svg(), routes: L.svg(), nearby: L.svg() } };
  const view = renderTrip(<Dismiss handle={handle} />, { phone });
  act(() => view.store.getState().actions.openCard("a", { fly: false }));
  const cleanup = () => {
    view.unmount();
    map.remove();
    element.remove();
  };
  return { map, element, reach: handle.reach, store: view.store, cleanup };
}

describe("useCardDismiss", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("closes the card on a click on empty map and leaves focus on the map", () => {
    const { element, store, cleanup } = setup();
    fireEvent.click(element);
    expect(store.getState().selected).toBe("a");
    act(() => {
      vi.advanceTimersByTime(DISMISS_DELAY_MS);
    });
    expect(store.getState().selected).toBeNull();
    expect(element).toHaveFocus();
    cleanup();
  });

  it("keeps the card on a double-click zoom", () => {
    const { element, store, cleanup } = setup();
    fireEvent.click(element);
    fireEvent.click(element);
    fireEvent.dblClick(element);
    act(() => {
      vi.advanceTimersByTime(DISMISS_DELAY_MS * 2);
    });
    expect(store.getState().selected).toBe("a");
    cleanup();
  });

  it("lets a pin click switch the card instead of closing it", () => {
    const { map, store, cleanup } = setup();
    const marker = L.marker([10.77, 106.7]).addTo(map);
    marker.on("click", () => store.getState().actions.openCard("b", { fly: false }));
    fireEvent.click(marker.getElement() as HTMLElement);
    act(() => {
      vi.advanceTimersByTime(DISMISS_DELAY_MS);
    });
    expect(store.getState().selected).toBe("b");
    cleanup();
  });

  it("does not close when a route or spot that stops bubbling is clicked", () => {
    const { map, store, cleanup } = setup();
    const line = L.polyline(
      [
        [10.77, 106.7],
        [10.78, 106.71],
      ],
      { bubblingMouseEvents: false },
    ).addTo(map);
    const onLine = vi.fn();
    line.on("click", onLine);
    fireEvent.click(line.getElement() as Element);
    act(() => {
      vi.advanceTimersByTime(DISMISS_DELAY_MS);
    });
    expect(onLine).toHaveBeenCalled();
    expect(store.getState().selected).toBe("a");
    cleanup();
  });

  it("opens the pin a finger tap lands beside instead of closing the card", () => {
    const { map, reach, store, cleanup } = setup();
    const marker = L.marker([10.77, 106.7]).addTo(map);
    marker.on("click", () => store.getState().actions.openCard("b", { fly: false }));
    reach.add(() => [marker]);
    const beside = map.latLngToContainerPoint(marker.getLatLng()).add([16, 0]);
    const originalEvent = Object.assign(new MouseEvent("click", { detail: 1 }), { pointerType: "touch" });
    map.fire("click", { latlng: map.containerPointToLatLng(beside), containerPoint: beside, originalEvent });
    act(() => {
      vi.advanceTimersByTime(DISMISS_DELAY_MS);
    });
    expect(store.getState().selected).toBe("b");
    cleanup();
  });

  it("ignores clicks while no card is open", () => {
    const { element, store, cleanup } = setup();
    act(() => store.getState().actions.closeCard());
    const close = vi.spyOn(store.getState().actions, "closeCard");
    fireEvent.click(element);
    act(() => {
      vi.advanceTimersByTime(DISMISS_DELAY_MS);
    });
    expect(close).not.toHaveBeenCalled();
    cleanup();
  });

  it("on a phone lowers the open sheet to its peek when no card is open, after the double-click wait", () => {
    const { element, store, cleanup } = setup({ phone: true });
    act(() => {
      store.getState().actions.closeCard();
      store.getState().actions.setSheet("half");
    });
    fireEvent.click(element);
    expect(store.getState().sheet).toBe("half");
    act(() => {
      vi.advanceTimersByTime(DISMISS_DELAY_MS);
    });
    expect(store.getState().sheet).toBe("peek");
    act(() => store.getState().actions.setSheet("full"));
    fireEvent.click(element);
    fireEvent.dblClick(element);
    act(() => {
      vi.advanceTimersByTime(DISMISS_DELAY_MS * 2);
    });
    expect(store.getState().sheet).toBe("full");
    cleanup();
  });

  it("closes an open card before it lowers the sheet", () => {
    const { element, store, cleanup } = setup({ phone: true });
    act(() => store.getState().actions.setSheet("half"));
    fireEvent.click(element);
    act(() => {
      vi.advanceTimersByTime(DISMISS_DELAY_MS);
    });
    expect(store.getState()).toMatchObject({ selected: null, sheet: "half" });
    fireEvent.click(element);
    act(() => {
      vi.advanceTimersByTime(DISMISS_DELAY_MS);
    });
    expect(store.getState().sheet).toBe("peek");
    cleanup();
  });
});
