import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { cssVars } from "../../../lib/css";
import { hoursText } from "../logic/issues";
import type { Days, PickerState } from "../session/session";
import { starsOf } from "../text";
import { LiveRegion } from "./LiveRegion";
import { PeIcon } from "./PeIcon";
import { pickerFilters, pickerItems, pickerSource, plannedDays, type PickItem } from "./pickerItems";
import { useEditorText, useSession, useSessionActions, useSessionState } from "./sessionContext";

const COUNT_SPEAK_MS = 600;

type ChipGroup = "priority" | "category" | "tag";

interface ChipProps {
  group: ChipGroup;
  value: string;
  label: string;
  current: string;
  onPick: (group: ChipGroup, value: string) => void;
}

function Chip({ group, value, label, current, onPick }: ChipProps) {
  return (
    <button type="button" className="pe-chip" aria-pressed={current === value} onClick={() => onPick(group, value)}>
      <PeIcon name="check" className="pe-chip-check" />
      {label}
    </button>
  );
}

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="pe-filter" role="group" aria-label={label}>
      <span className="pe-filter-label" aria-hidden="true">
        {label}
      </span>
      <div className="pe-chips">{children}</div>
    </div>
  );
}

function PlaceFilters({ picker, onPick }: { picker: PickerState; onPick: ChipProps["onPick"] }) {
  const { ctx } = useSession();
  const { t, tr } = useEditorText();
  const { categories, tags } = useMemo(() => pickerFilters(ctx), [ctx]);
  return (
    <div className="pe-filters">
      <FilterGroup label={t("priority")}>
        <Chip group="priority" value="all" label={t("all")} current={picker.priority} onPick={onPick} />
        <Chip group="priority" value="must" label={tr.priority("must") || "Must go"} current={picker.priority} onPick={onPick} />
        <Chip group="priority" value="high" label={`${tr.priority("high") || "High"}+`} current={picker.priority} onPick={onPick} />
      </FilterGroup>
      <FilterGroup label={t("category")}>
        <Chip group="category" value="" label={t("all")} current={picker.category} onPick={onPick} />
        {categories.map((c) => (
          <Chip key={c} group="category" value={c} label={tr.category(c)} current={picker.category} onPick={onPick} />
        ))}
      </FilterGroup>
      {tags.length ? (
        <FilterGroup label={t("tags")}>
          <Chip group="tag" value="" label={t("all")} current={picker.tag} onPick={onPick} />
          {tags.map((tag) => (
            <Chip
              key={tag}
              group="tag"
              value={tag}
              label={tr.labels.tags[tag] || tag.replace(/_/g, " ")}
              current={picker.tag}
              onPick={onPick}
            />
          ))}
        </FilterGroup>
      ) : null}
    </div>
  );
}

function PickRow({ item, pickerDay, onPick }: { item: PickItem; pickerDay: number; onPick: (ref: string) => void }) {
  const { model } = useSession();
  const words = useEditorText();
  const { t, tr } = words;
  const { node, day, weekday } = item;
  const meta =
    node.kind === "place"
      ? [tr.category(node.category ?? ""), tr.priority(node.place?.priority), node.sector ? tr.directionName(node.sector) : ""]
      : [t("nearby")];
  const hours = node.kind === "place" ? hoursText(words, node, weekday) : "";
  const closed = hours === t("closed_today");
  const hoursLabel = hours && hours !== "?" ? (closed ? hours : t("open_today", { hours })) : "";
  const here = day === pickerDay;
  const action = here ? "" : day !== null ? t("move_here") : t("add");
  const stars = starsOf(node.place);
  return (
    <li>
      <button type="button" className="pe-pick" data-pick={node.ref} disabled={here} onClick={() => onPick(node.ref)}>
        <span className="pe-pick-text">
          <span className="pe-name">
            {stars ? (
              <span className="pe-stars" aria-hidden="true">
                {stars}
              </span>
            ) : null}
            {node.name}
          </span>
          <span className="pe-meta">{meta.filter(Boolean).join(" · ")}</span>
          {hoursLabel ? <span className={closed ? "pe-meta is-error" : "pe-meta"}>{hoursLabel}</span> : null}
        </span>
        {day !== null ? (
          <span className="pe-badge" style={cssVars({ "--d": model.defaultDayColor(day + 1) })}>
            {t("planned_day", { n: day + 1 })}
          </span>
        ) : null}
        {action ? (
          <span className="pe-pick-act">
            <PeIcon name="plus" />
            {action}
          </span>
        ) : null}
      </button>
    </li>
  );
}

const selectPicker = (s: { picker: PickerState }) => s.picker;
const selectDays = (s: { days: Days }) => s.days;

/** The "Add to day" drawer: a modal <dialog> with search, filters and the place or spot list. */
export function AddPlaceDialog() {
  const session = useSession();
  const actions = useSessionActions();
  const picker = useSessionState(selectPicker);
  const days = useSessionState(selectDays);
  const { t, tr, lang } = useEditorText();
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLUListElement>(null);
  const pendingFocus = useRef<{ ref: string; at: number } | null>(null);
  const speakCount = useRef(false);
  const [said, setSaid] = useState({ text: "", seq: 0 });
  const query = useDeferredValue(picker.query);

  const planned = useMemo(() => plannedDays(days), [days]);
  const { tab, day, priority, category, tag, unplannedOnly } = picker;
  const items = useMemo(
    () => pickerItems(session.ctx, tr, { tab, day, priority, category, tag, unplannedOnly }, query, planned),
    [session.ctx, tr, tab, day, priority, category, tag, unplannedOnly, query, planned],
  );
  const total = useMemo(() => pickerSource(session.ctx, picker.tab).length, [session.ctx, picker.tab]);
  const count = t("count", { shown: items.length, total });

  useLayoutEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (picker.open && !node.open) {
      node.showModal();
      search.current?.focus();
      search.current?.select();
    } else if (!picker.open && node.open) {
      node.close();
    }
  }, [picker.open]);

  useEffect(() => {
    if (!speakCount.current) return;
    speakCount.current = false;
    const timer = window.setTimeout(() => setSaid((s) => ({ text: count, seq: s.seq + 1 })), COUNT_SPEAK_MS);
    return () => window.clearTimeout(timer);
  }, [count]);

  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    const list = results.current;
    if (!pending || !list) return;
    pendingFocus.current = null;
    const rows = [...list.querySelectorAll<HTMLButtonElement>("[data-pick]")];
    const same = rows.find((row) => row.dataset.pick === pending.ref);
    const next = rows[Math.min(pending.at, rows.length - 1)];
    const target = same && !same.disabled ? same : next && !next.disabled ? next : search.current;
    target?.focus();
  }, [items]);

  const onPick = (ref: string) => {
    const at = items.findIndex((item) => item.node.ref === ref);
    const node = session.ctx.nodes.get(ref);
    pendingFocus.current = { ref, at: Math.max(at, 0) };
    speakCount.current = false;
    actions.addOrMove(picker.day, ref);
    if (node) setSaid((s) => ({ text: t("announce_added", { name: node.name, day: picker.day + 1 }), seq: s.seq + 1 }));
  };
  const filter = (patch: Partial<Omit<PickerState, "open">>) => {
    speakCount.current = true;
    actions.setPicker(patch);
  };
  const onChip = (group: ChipGroup, value: string) => {
    if (group === "priority") filter({ priority: value === "must" || value === "high" ? value : "all" });
    else if (group === "category") filter({ category: value });
    else filter({ tag: value });
  };
  const onBackdrop = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  };

  return (
    <dialog
      ref={dialog}
      className="pe-dialog"
      aria-labelledby="pe-picker-title"
      onClick={onBackdrop}
      onClose={() => {
        if (session.store.getState().picker.open) actions.closePicker();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
      }}
    >
      {picker.open ? (
        <div className="pe-sheet pe" data-lang={lang}>
          <header className="pe-sheet-head">
            <h2 id="pe-picker-title">{t("picker_title")}</h2>
            <select
              aria-labelledby="pe-picker-title"
              value={picker.day}
              onChange={(event) => filter({ day: Number(event.target.value) })}
            >
              {days.map((_, d) => (
                <option key={d} value={d}>
                  {t("planned_day", { n: d + 1 })}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="pe-icon-btn"
              aria-label={t("close")}
              title={t("close")}
              onClick={() => dialog.current?.close()}
            >
              <PeIcon name="x" />
            </button>
          </header>
          <div className="pe-seg" role="group" aria-label={t("picker_source")}>
            <button type="button" aria-pressed={picker.tab === "places"} onClick={() => filter({ tab: "places" })}>
              {t("places")}
            </button>
            <button type="button" aria-pressed={picker.tab === "nearby"} onClick={() => filter({ tab: "nearby" })}>
              {t("nearby")}
            </button>
          </div>
          <label className="pe-search">
            <PeIcon name="search" />
            <input
              ref={search}
              type="search"
              value={picker.query}
              placeholder={t("search_placeholder")}
              aria-label={t("search")}
              aria-controls="pe-results"
              aria-describedby="pe-count-line"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="search"
              onChange={(event) => filter({ query: event.target.value })}
            />
          </label>
          <label className="pe-toggle">
            <input
              type="checkbox"
              checked={picker.unplannedOnly}
              onChange={(event) => filter({ unplannedOnly: event.target.checked })}
            />
            <span>{t("only_unplanned")}</span>
          </label>
          {picker.tab === "places" ? <PlaceFilters picker={picker} onPick={onChip} /> : null}
          <p className="pe-count-line num" id="pe-count-line">
            {count}
          </p>
          <ul className="pe-results" id="pe-results" ref={results} aria-labelledby="pe-picker-title">
            {items.length ? (
              items.map((item) => <PickRow key={item.node.ref} item={item} pickerDay={picker.day} onPick={onPick} />)
            ) : (
              <li className="pe-empty">{t("no_results")}</li>
            )}
          </ul>
          <LiveRegion text={said.text} seq={said.seq} />
        </div>
      ) : null}
    </dialog>
  );
}
