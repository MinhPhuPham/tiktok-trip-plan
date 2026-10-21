import L from "leaflet";

declare global {
  interface Window {
    L?: typeof L;
  }
}

/** leaflet.markercluster is a UMD script that extends the global L; it must exist before it loads. */
window.L = L;

export default L;
