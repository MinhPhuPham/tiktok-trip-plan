import type { TripModel } from "../../data/model";
import { localDate } from "../../lib/format";

const quote = (text: string) => JSON.stringify(text);
const comment = (text: string) => text.replace(/[\r\n]+/g, " ");

/** input/preferences.yaml: the export's must_go and removed lists plus the places hidden here (known places only). */
export function preferencesYaml(model: TripModel, hidden: Iterable<string>, today: Date = new Date()): { yaml: string; removed: number } {
  const prefs = model.data.preferences;
  const removed = [...prefs.removed];
  for (const id of hidden) if (model.placeById.has(id) && !removed.includes(id)) removed.push(id);
  const lines = [
    `# input/preferences.yaml, exported from the ${comment(model.data.city)} trip map on ${localDate(today)}`,
    "# Save it as input/preferences.yaml, then run: uv run tiktok-trip run --from resolve",
    prefs.must_go.length ? "must_go:" : "must_go: []",
    ...prefs.must_go.map((entry) => `  - ${quote(entry)}`),
    removed.length ? "removed:" : "removed: []",
    ...removed.map((entry) => {
      const place = model.placeById.get(entry);
      return `  - ${quote(entry)}${place ? `  # ${comment(place.name)}` : ""}`;
    }),
  ];
  return { yaml: `${lines.join("\n")}\n`, removed: removed.length };
}
