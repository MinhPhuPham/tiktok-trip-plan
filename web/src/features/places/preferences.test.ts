import { buildTripModel } from "../../data/model";
import { makeTrip } from "../../test/fixtures";
import { preferencesYaml } from "./preferences";

it("writes must_go and removed with the hidden places it knows", () => {
  const model = buildTripModel(makeTrip());
  const { yaml, removed } = preferencesYaml(model, ["b", "gone"], new Date(2026, 9, 20));
  expect(removed).toBe(1);
  expect(yaml).toBe(
    [
      "# input/preferences.yaml, exported from the Đà Lạt trip map on 2026-10-20",
      "# Save it as input/preferences.yaml, then run: uv run tiktok-trip run --from resolve",
      "must_go:",
      '  - "Phở Gia Truyền"',
      "removed:",
      '  - "b"  # Cà phê Đá',
      "",
    ].join("\n"),
  );
});
