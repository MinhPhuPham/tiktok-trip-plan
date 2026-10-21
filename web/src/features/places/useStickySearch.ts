import { useEffect, useRef } from "react";
import { scrollBackTo, scrollParent } from "../../lib/dom";

type Stuck = "search" | "bar";

/**
 * The Places tab keeps its search (and on tall screens the result bar) stuck to the top of the
 * scrolling panel. Two 1px marks report, through one IntersectionObserver, when each part has
 * content under it; the box gets data-stuck so CSS draws the edge under the lowest stuck part.
 * The results mark sits one search height above the result bar (places.css), so its top is where
 * the results begin once the search covers the top of the panel.
 */
export function useStickySearch() {
  const box = useRef<HTMLDivElement>(null);
  const searchMark = useRef<HTMLDivElement>(null);
  const resultsMark = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = box.current;
    const marks = new Map<Element, Stuck>();
    if (searchMark.current) marks.set(searchMark.current, "search");
    if (resultsMark.current) marks.set(resultsMark.current, "bar");
    if (!node || !marks.size) return;
    const above = new Set<Stuck>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const part = marks.get(entry.target);
          if (!part) continue;
          const gone = !entry.isIntersecting && entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0);
          if (gone) above.add(part);
          else above.delete(part);
        }
        const stuck = above.has("bar") ? "bar" : above.has("search") ? "search" : null;
        if (stuck) node.dataset.stuck = stuck;
        else delete node.dataset.stuck;
      },
      { root: scrollParent(node) },
    );
    for (const mark of marks.keys()) observer.observe(mark);
    return () => observer.disconnect();
  }, []);

  /** Typing while scrolled past the results' start brings the results back under the search. */
  const revealResults = () => scrollBackTo(resultsMark.current);
  return { box, searchMark, resultsMark, revealResults };
}
