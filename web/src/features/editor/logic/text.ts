import { fold } from "../../../lib/format";

const SPACES = /\s+/;

/** Every word of the query occurs in the already folded haystack. */
export function matchesQuery(haystack: string, query: string): boolean {
  return fold(query)
    .split(SPACES)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/** djb2, base 36: identifies the generated plan a saved draft was made from. */
export function hashText(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}
