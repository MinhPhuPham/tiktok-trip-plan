import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { DOM_IDS } from "../../app/ids";
import { useT } from "../../i18n/useT";
import { useTripActions, useTripStore } from "../../state/hooks";
import type { TripState } from "../../state/store";
import { Icon } from "../../ui/Icon";

export const SEARCH_DELAY_MS = 140;

const selectQuery = (s: TripState) => s.filters.q;

/** The place search; typing updates the list after a short pause, a reset elsewhere clears it. */
export function SearchBox() {
  const t = useT();
  const query = useTripStore(selectQuery);
  const { setQuery } = useTripActions();
  const [text, setText] = useState(query);
  const [seenQuery, setSeenQuery] = useState(query);
  const timer = useRef(0);

  if (query !== seenQuery) {
    setSeenQuery(query);
    if (query !== text.trim()) setText(query);
  }

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setText(value);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setQuery(value.trim()), SEARCH_DELAY_MS);
  };

  return (
    <label className="search">
      <span className="sr-only">{t.t("search")}</span>
      <Icon name="search" />
      <input
        type="search"
        id={DOM_IDS.search}
        value={text}
        onChange={onChange}
        placeholder={t.t("search_placeholder")}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
      />
    </label>
  );
}
