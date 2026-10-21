import { describe, expect, it } from "vitest";
import { distanceMeters, formatDistance, toUserFix } from "./position";

const coords = (patch: Partial<GeolocationCoordinates>) =>
  ({ coords: { latitude: 11.94, longitude: 108.44, accuracy: 25, heading: null, speed: null, altitude: null, altitudeAccuracy: null, ...patch } }) as GeolocationPosition;

describe("toUserFix", () => {
  it("keeps the GPS course only while moving", () => {
    expect(toUserFix(coords({ heading: 90, speed: 3 })).heading).toBe(90);
    expect(toUserFix(coords({ heading: 90, speed: 0.2 })).heading).toBeNull();
    expect(toUserFix(coords({ heading: Number.NaN, speed: 3 })).heading).toBeNull();
    expect(toUserFix(coords({}))).toEqual({ lat: 11.94, lng: 108.44, accuracy: 25, heading: null });
  });
});

describe("distanceMeters", () => {
  it("measures a great-circle distance", () => {
    expect(distanceMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(111_195, -1);
    expect(distanceMeters({ lat: 11.94, lng: 108.44 }, { lat: 11.94, lng: 108.44 })).toBe(0);
  });
});

describe("formatDistance", () => {
  it("rounds to what a straight line can tell", () => {
    expect([3, 84, 451, 994, 995, 1234, 9940, 14_400].map(formatDistance)).toEqual([
      "10 m", "80 m", "450 m", "990 m", "1.0 km", "1.2 km", "9.9 km", "14 km",
    ]);
  });
});
