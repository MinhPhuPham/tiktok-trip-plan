import { describe, expect, it } from "vitest";
import { buildTripModel } from "../data/model";
import { planFromData, type Basemap } from "../data/types";
import { createTripStore } from "../state/store";
import { makeTrip } from "../test/fixtures";
import { basemapIds, fallbackBasemap, nextWorkingBasemap, resolveBasemap } from "./basemapChoice";
import { clusterMix, clusterSize } from "./clusterMix";
import { compassShapes } from "./compass";
import { clusterHtml, escapeHtml, pinHtml } from "./markup";
import { createRoadLookup, dayLine, decodePolyline, legKey } from "./polyline";
import { fillTileUrl, preloadTileUrls, tileAt, vectorTileUrls } from "./tiles";
import L from "./leafletGlobal";
import { drawnHover } from "./mapCore";

describe("decodePolyline", () => {
  it("decodes Google's reference example", () => {
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
  });

  it("returns nothing for an empty string", () => {
    expect(decodePolyline("")).toEqual([]);
  });

  it("honours another precision", () => {
    expect(decodePolyline("_ibE_ibE", 6)).toEqual([[0.1, 0.1]]);
  });
});

describe("road legs", () => {
  const stops = [
    { kind: "start", ref: null, lat: 0, lng: 0 },
    { kind: "place", ref: "a", lat: 1, lng: 1 },
    { kind: "rest", ref: "rest", lat: 0, lng: 0 },
  ];

  it("keys legs by place id with start, end and rest as the center", () => {
    expect(legKey(stops[0]!, stops[1]!)).toBe("center>a");
    expect(legKey(stops[1]!, stops[2]!)).toBe("a>center");
  });

  it("joins stops along the road and straight where a leg has none", () => {
    const road = createRoadLookup({ "center>a": "_p~iF~ps|U" });
    expect(dayLine(stops, road)).toEqual([
      [0, 0],
      [38.5, -120.2],
      [1, 1],
      [0, 0],
    ]);
  });

  it("ignores inherited keys", () => {
    const road = createRoadLookup({});
    expect(road({ kind: "place", ref: "__proto__" }, { kind: "place", ref: "x" })).toEqual([]);
  });
});

describe("clusterMix", () => {
  const colors: Record<string, string> = { food: "#111111", cafe: "#222222", other: "#999999" };
  const colorOf = (category: string) => colors[category] ?? "#999999";

  it("orders the ring by count and marks a hidden must-go", () => {
    const mix = clusterMix(
      [
        { category: "food", priority: "low" },
        { category: "cafe", priority: "must" },
        { category: "cafe", priority: null },
        { category: "cafe", priority: "high" },
      ],
      colorOf,
    );
    expect(mix.ring).toBe("#222222 0.0deg 270.0deg,#111111 270.0deg 360.0deg");
    expect(mix.hasMust).toBe(true);
    expect(mix.total).toBe(4);
    expect(mix.size).toBe(34);
  });

  it("merges categories this app does not know into other", () => {
    const mix = clusterMix(
      [
        { category: "spa", priority: null },
        { category: "other", priority: null },
        { category: "food", priority: null },
      ],
      colorOf,
    );
    expect(mix.ring).toBe("#999999 0.0deg 240.0deg,#111111 240.0deg 360.0deg");
  });

  it("grows with the member count", () => {
    expect([clusterSize(9), clusterSize(10), clusterSize(39), clusterSize(40)]).toEqual([34, 40, 40, 46]);
  });
});

describe("compassShapes", () => {
  it("needs a center", () => {
    expect(compassShapes(null, [], [], () => "#000000")).toBeNull();
  });

  it("builds rings in metres and labelled rays", () => {
    const shapes = compassShapes(
      { lat: 1, lng: 2 },
      [{ km: 5, label: "5 km", lat: 1.04, lng: 2 }],
      [{ sector: "NE-1", color: "not-a-colour", lat: 1.1, lng: 2.1 }],
      () => "#ffffff",
    );
    expect(shapes?.rings).toEqual([{ center: [1, 2], radiusM: 5000, labelAt: [1.04, 2], label: "5 km" }]);
    expect(shapes?.rays[0]).toEqual({ line: [[1, 2], [1.1, 2.1]], color: "#9e9e9e", ink: "#ffffff", label: "NE" });
  });
});

describe("basemap choice", () => {
  const base = (id: Basemap["id"]): Basemap => ({
    id,
    name: id,
    kind: id === "openfreemap" ? "vector" : "raster",
    url: "",
    attribution: "",
    max_zoom: 19,
    subdomains: "",
    labels_url: null,
    retina: false,
  });
  const data = {
    basemaps: [base("openfreemap"), base("esri_streets"), base("esri_satellite")],
    default_basemap: "openfreemap",
    google: { name: "Google", src: "https://maps.googleapis.com/x" },
  };

  it("lists Google first until it fails", () => {
    expect(basemapIds(data, false)).toEqual(["google", "openfreemap", "esri_streets", "esri_satellite"]);
    expect(basemapIds(data, true)).toEqual(["openfreemap", "esri_streets", "esri_satellite"]);
    expect(basemapIds({ ...data, google: null }, false)).not.toContain("google");
  });

  it("keeps a stored choice that is offered, else the default", () => {
    expect(resolveBasemap(data, "esri_satellite", false)).toBe("esri_satellite");
    expect(resolveBasemap(data, "google", true)).toBe("openfreemap");
    expect(resolveBasemap(data, "osm", false)).toBe("openfreemap");
    expect(resolveBasemap(data, null, false)).toBe("openfreemap");
  });

  it("falls back to Esri streets, then the first working basemap", () => {
    expect(fallbackBasemap(data, new Set())?.id).toBe("esri_streets");
    expect(fallbackBasemap(data, new Set(["esri_streets"]))?.id).toBe("openfreemap");
    expect(nextWorkingBasemap(data, new Set(["openfreemap"]))?.id).toBe("esri_streets");
    expect(nextWorkingBasemap(data, new Set(["openfreemap", "esri_streets", "esri_satellite"]))).toBeUndefined();
  });
});

describe("tile preload", () => {
  it("finds the Web Mercator tile of a point", () => {
    expect(tileAt([0, 0], 1)).toEqual({ x: 1, y: 1 });
    const leaflet = L.CRS.EPSG3857.latLngToPoint(L.latLng(11.94, 108.44), 15).divideBy(256).floor();
    expect(tileAt([11.94, 108.44], 15)).toEqual({ x: leaflet.x, y: leaflet.y });
    expect(tileAt([11.94, 108.44], 14, 128)).toEqual(tileAt([11.94, 108.44], 15));
  });

  it("fills templates and refuses unknown placeholders", () => {
    expect(fillTileUrl("https://t/{s}/{z}/{x}/{y}{r}.png", { s: "a", x: 1, y: 2, z: 3 })).toBe("https://t/a/3/1/2.png");
    expect(fillTileUrl("https://t/{z}/{x}/{y}?k={key}", { s: "", x: 1, y: 2, z: 3 })).toBeNull();
  });

  it("takes the 3×3 block around each point, deduplicated and capped", () => {
    const grid = { tileSize: 256, zoomOffset: 0, subdomains: ["a", "b"] };
    const urls = preloadTileUrls("https://{s}.t/{z}/{x}/{y}", [[11.94, 108.44], [11.94, 108.44]], [15, 15], grid);
    expect(urls).toHaveLength(9);
    expect(urls).toContain(`https://${["a", "b"][(26254 + 15289) % 2]}.t/15/26254/15289`);
    expect(preloadTileUrls("https://t/{z}/{x}/{y}", [[0, 0], [10, 10]], [10], grid, 12)).toHaveLength(12);
  });

  it("covers the trip area with vector tiles within the source zooms and the cap", () => {
    const source = { tiles: ["https://v/{z}/{x}/{y}.pbf"], minzoom: 0, maxzoom: 14 };
    const area: [number, number][] = [[11.94, 108.44], [11.9, 108.47]];
    const urls = vectorTileUrls(source, area, { min: 12, max: 16 });
    const a = tileAt([11.94, 108.44], 14);
    const b = tileAt([11.9, 108.47], 14);
    expect(urls).toContain(`https://v/14/${a.x}/${a.y}.pbf`);
    expect(urls).toContain(`https://v/14/${b.x}/${a.y}.pbf`);
    expect(urls.some((url) => url.startsWith("https://v/15/"))).toBe(false);
    expect(urls.filter((url) => url.startsWith("https://v/14/"))).toHaveLength((b.x - a.x + 1) * (b.y - a.y + 1));
    expect(vectorTileUrls(source, [[11.94, 108.44], [21.03, 105.85]], { min: 10, max: 14 }, 50)).toHaveLength(50);
    expect(vectorTileUrls(source, [], { min: 10, max: 14 })).toEqual([]);
  });
});

describe("markup", () => {
  it("escapes text", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });

  it("draws an unknown category as other, with the day badge and selection", () => {
    const html = pinHtml({
      category: "spa",
      priority: null,
      color: "#123456",
      ink: "#ffffff",
      selected: true,
      hovered: true,
      day: { n: 2, color: "#abcdef", ink: "#000000" },
    });
    expect(html).toContain('class="pin pin-none is-selected"');
    expect(html).toContain('href="#i-other"');
    expect(html).toContain('<b class="pin-day" style="--d:#abcdef;--dink:#000000">2</b>');
  });

  it("marks a hovered pin unless it is selected", () => {
    const look = { category: "food", priority: "high", color: "#123456", ink: "#ffffff", selected: false, hovered: true, day: null };
    expect(pinHtml(look)).toContain('class="pin pin-high is-hovered"');
    expect(pinHtml({ ...look, hovered: false })).toContain('class="pin pin-high"');
  });

  it("puts the must-go dot and an escaped title on clusters", () => {
    const mix = clusterMix([{ category: "food", priority: "must" }], () => "#111111");
    const html = clusterHtml(mix, `1 "places"`);
    expect(html).toContain("cluster has-must");
    expect(html).toContain("--ring:conic-gradient(#111111 0.0deg 360.0deg)");
    expect(html).toContain('title="1 &quot;places&quot;"');
  });
});

describe("drawnHover", () => {
  const data = makeTrip();
  const model = buildTripModel(data);
  const store = () =>
    createTripStore({ city: data.city, langs: model.langs, defaultLang: "en", plan: planFromData(data), phone: false, persistence: null });

  it("lights a hovered place or nearby spot only while the map draws it", () => {
    const trip = store();
    const { actions } = trip.getState();
    expect(drawnHover(model, trip.getState())).toBeNull();
    actions.setHovered("a");
    expect(drawnHover(model, trip.getState())).toBe("a");
    actions.setHovered("n1");
    expect(drawnHover(model, trip.getState())).toBe("n1");
    actions.setOverlay("nearby", false);
    expect(drawnHover(model, trip.getState())).toBeNull();
    actions.setHovered("unknown");
    expect(drawnHover(model, trip.getState())).toBeNull();
  });

  it("skips hidden places and, on the Places tab, places its filters leave out", () => {
    const trip = store();
    const { actions } = trip.getState();
    actions.setHidden("a", true);
    actions.setHovered("a");
    expect(drawnHover(model, trip.getState())).toBeNull();
    actions.setShowHidden(true);
    expect(drawnHover(model, trip.getState())).toBe("a");
    actions.setTab("places");
    actions.toggleFilter("categories", "cafe");
    actions.setHovered("a");
    expect(drawnHover(model, trip.getState())).toBeNull();
    actions.setHovered("b");
    expect(drawnHover(model, trip.getState())).toBe("b");
  });
});
