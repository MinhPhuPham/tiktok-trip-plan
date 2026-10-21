import type { CategoryId } from "./types";

/**
 * Copy of palette.CATEGORY_COLORS / CATEGORY_INK (the schema defaults) for exports written before
 * MapData carried them; palette.test.ts keeps both copies equal.
 */
export const DEFAULT_CATEGORY_COLORS: Readonly<Record<CategoryId, string>> = {
  food: "#C95D52",
  cafe: "#C59711",
  attraction: "#0486F4",
  other: "#9699B4",
};

export const DEFAULT_CATEGORY_INK: Readonly<Record<CategoryId, string>> = {
  food: "#000000",
  cafe: "#000000",
  attraction: "#000000",
  other: "#000000",
};
