import { use } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { TripStoreContext } from "./context";
import { selectSheetOpen, type TripActions, type TripState, type TripStoreApi } from "./store";

export { useShallow };

/** The store itself, for imperative code (Leaflet hooks): getState() and subscribe(). */
export function useTripStoreApi(): TripStoreApi {
  const store = use(TripStoreContext);
  if (!store) throw new Error("useTripStore needs <StoreProvider>");
  return store;
}

/** Subscribe to a slice; return primitives or wrap object selectors in useShallow. */
export function useTripStore<T>(selector: (state: TripState) => T): T {
  return useStore(useTripStoreApi(), selector);
}

/** Stable action functions; never re-renders. */
export function useTripActions(): TripActions {
  return useTripStore(selectActions);
}

const selectActions = (s: TripState) => s.actions;
const selectLang = (s: TripState) => s.lang;
const selectTab = (s: TripState) => s.tab;
const selectPhone = (s: TripState) => s.phone;
const selectSheet = (s: TripState) => s.sheet;
const selectFocusDay = (s: TripState) => s.focusDay;
const selectSelected = (s: TripState) => s.selected;
const selectOverlays = (s: TripState) => s.overlays;
const selectFilters = (s: TripState) => s.filters;
const selectHidden = (s: TripState) => s.hidden;
export const selectPlan = (s: TripState) => s.plan;
const selectEditing = (s: TripState) => s.editing;
export const selectToast = (s: TripState) => s.toast;
const selectOnline = (s: TripState) => s.online;
export const selectStatus = (s: TripState) => s.status;

export const useLang = () => useTripStore(selectLang);
export const useTab = () => useTripStore(selectTab);
export const usePhone = () => useTripStore(selectPhone);
export const useSheet = () => useTripStore(selectSheet);
export const useSheetOpen = () => useTripStore(selectSheetOpen);
export const useFocusDay = () => useTripStore(selectFocusDay);
export const useSelectedId = () => useTripStore(selectSelected);
export const useOverlays = () => useTripStore(selectOverlays);
export const useFilters = () => useTripStore(selectFilters);
export const useHiddenIds = () => useTripStore(selectHidden);
export const useEditing = () => useTripStore(selectEditing);
export const useOnline = () => useTripStore(selectOnline);
export const useIsHidden = (id: string) => useTripStore((s) => s.hidden.has(id));
