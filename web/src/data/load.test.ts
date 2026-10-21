import { makeTrip } from "../test/fixtures";
import { fetchTrip, loadTrip, readInlineTrip, TRIP_SCHEMA_VERSION } from "./load";

function page(body: string): Document {
  return new DOMParser().parseFromString(`<script type="application/json" id="trip-data">${body}</script>`, "text/html");
}

const respond = (status: number, body = "") => vi.fn<typeof fetch>(() => Promise.resolve(new Response(body, { status })));

describe("loadTrip", () => {
  it("uses inline data in the single file", async () => {
    const fetcher = respond(500);
    const result = await loadTrip(page(JSON.stringify(makeTrip())), fetcher);
    expect(result.ok && result.source).toBe("inline");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("fetches trip.json while the placeholder is unreplaced", async () => {
    const fetcher = respond(200, JSON.stringify(makeTrip()));
    const result = await loadTrip(page("__TRIP_DATA__"), fetcher);
    expect(readInlineTrip(page("__TRIP_DATA__"))).toBeNull();
    expect(result.ok && result.data.city).toBe("Đà Lạt");
    expect(fetcher).toHaveBeenCalledWith("trip.json", { cache: "no-cache" });
  });

  it("reports a missing, failing or malformed trip", async () => {
    expect(await fetchTrip("trip.json", respond(404))).toEqual({ ok: false, error: { kind: "missing", source: "trip.json" } });
    expect(await fetchTrip("trip.json", respond(503))).toMatchObject({ ok: false, error: { kind: "http", status: 503 } });
    expect(await fetchTrip("trip.json", respond(200, "{}"))).toMatchObject({ ok: false, error: { kind: "invalid" } });
    const offline = vi.fn<typeof fetch>(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(await fetchTrip("trip.json", offline)).toMatchObject({ ok: false, error: { kind: "network" } });
  });

  it("refuses data written for another app version", async () => {
    const newer = JSON.stringify(makeTrip({ schema_version: TRIP_SCHEMA_VERSION + 1 }));
    expect(await fetchTrip("trip.json", respond(200, newer))).toEqual({
      ok: false,
      error: { kind: "version", source: "trip.json", found: TRIP_SCHEMA_VERSION + 1, expected: TRIP_SCHEMA_VERSION },
    });
    const { schema_version: _, ...older } = makeTrip();
    expect(await fetchTrip("trip.json", respond(200, JSON.stringify(older)))).toMatchObject({
      ok: false,
      error: { kind: "version", found: null },
    });
  });
});
