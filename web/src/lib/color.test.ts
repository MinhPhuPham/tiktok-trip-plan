import { inkFor, safeColor } from "./color";
import { safeSrc, safeUrl } from "./safe";

describe("color and URL guards", () => {
  it("picks the readable ink", () => {
    expect(inkFor("#ffffff")).toBe("#000000");
    expect(inkFor("#0072B2")).toBe("#ffffff");
    expect(safeColor("red")).toBe("#9e9e9e");
  });

  it("only lets https links and relative media through", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("https://example.com")).toBe("https://example.com");
    expect(safeSrc("media/p1/frame-1.jpg")).toBe("media/p1/frame-1.jpg");
    expect(safeSrc("media/../secret")).toBeNull();
  });
});
