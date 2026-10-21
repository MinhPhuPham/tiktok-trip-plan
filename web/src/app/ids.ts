/** DOM ids shared across features (skip link, focus return, search shortcut). */
export const DOM_IDS = {
  map: "map",
  googleMap: "gmap",
  mapWrap: "mapWrap",
  panel: "panel",
  panelBody: "panelBody",
  sheetToggle: "sheetToggle",
  peekNext: "peekNext",
  search: "q",
  card: "card",
  cardTitle: "cardTitle",
  toast: "toast",
  layersButton: "layersBtn",
  layersPopover: "layersPop",
  fitButton: "fitBtn",
  installButton: "installBtn",
  installPopover: "installPop",
  locateButton: "locateBtn",
  locatePopover: "locatePop",
  tabPlan: "tab-plan",
  tabPlaces: "tab-places",
  viewPlan: "view-plan",
  viewPlaces: "view-places",
} as const;

export function focusById(id: string): boolean {
  const node = document.getElementById(id);
  node?.focus({ preventScroll: true });
  return Boolean(node);
}
