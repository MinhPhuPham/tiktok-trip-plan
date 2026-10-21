import { fmt, fmtRange, fmtTime, fold, km, localDate, localMonths, toMin } from "./format";

describe("format", () => {
  it("fills known placeholders and keeps unknown ones", () => {
    expect(fmt("{shown} of {total} {x}", { shown: 2, total: 5 })).toBe("2 of 5 {x}");
  });

  it("folds Vietnamese for search", () => {
    expect(fold("Phở Đà Lạt")).toBe("pho da lat");
    expect(fold(null)).toBe("");
  });

  it("parses and formats clock times", () => {
    expect(toMin("7:05")).toBe(425);
    expect(toMin("7h")).toBeNull();
    expect(fmtTime(425, false)).toBe("7:05");
    expect(fmtTime(13 * 60, true)).toBe("1:00 PM");
    expect(fmtTime(24 * 60 + 30, false)).toBe("0:30");
    expect(fmtTime(null, false)).toBe("");
  });

  it("drops the first meridiem when both ends share it", () => {
    expect(fmtRange(9 * 60, 10 * 60 + 30, true)).toBe("9:00–10:30 AM");
    expect(fmtRange(11 * 60, 13 * 60, true)).toBe("11:00 AM–1:00 PM");
    expect(fmtRange(9 * 60, null, false)).toBe("9:00");
  });

  it("localises months, distances and dates", () => {
    expect(localMonths("Dec–Feb", "vi")).toBe("T12–T2");
    expect(localMonths("Dec–Feb", "en")).toBe("Dec–Feb");
    expect(km(1.24)).toBe("1.2 km");
    expect(localDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
