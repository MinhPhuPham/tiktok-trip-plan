import type { IssueGroups } from "../logic/issues";
import type { LeftOut } from "../session/session";
import { unplacedNote } from "../text";
import { IssueList } from "./IssueList";
import { PeIcon } from "./PeIcon";
import { useEditorText, useSession, useSessionActions } from "./sessionContext";

interface LeftOutListProps {
  leftOut: readonly LeftOut[];
  dayCount: number;
  groups: IssueGroups;
}

/** Places out of the plan, each with its reason and an "Add to day…" picker. */
export function LeftOutList({ leftOut, dayCount, groups }: LeftOutListProps) {
  const { ctx, model } = useSession();
  const actions = useSessionActions();
  const { t, tr, lang } = useEditorText();
  if (!leftOut.length) return null;
  return (
    <details className="pe-left">
      <summary>
        <span>{t("unplaced")}</span>
        <span className="pe-count num">{leftOut.length}</span>
        <PeIcon name="down" className="pe-chev" />
      </summary>
      <ul>
        {leftOut.map((u) => {
          const node = ctx.nodes.get(u.ref);
          const name = node?.name ?? u.ref;
          const priority = node?.place?.priority;
          const meta = [tr.category(node?.category ?? ""), priority ? tr.priority(priority) : ""].filter(Boolean).join(" · ");
          const why = unplacedNote(model, u.code, u.reason, lang) || t("unplaced_default_reason");
          return (
            <li key={u.ref} className="pe-left-row">
              <div className="pe-left-text">
                <span className="pe-name">{name}</span>
                <span className="pe-meta">{[meta, why].filter(Boolean).join(" · ")}</span>
                <IssueList issues={groups.byRef.get(u.ref) ?? []} withWarnings />
              </div>
              <select
                className="pe-select-sm"
                data-fk={`left:${u.ref}`}
                aria-label={`${t("add_to_day")} ${name}`}
                value=""
                onChange={(event) => {
                  if (event.target.value !== "") actions.addLeftOut(Number(event.target.value), u.ref);
                }}
              >
                <option value="" disabled>
                  {t("add_to_day")}
                </option>
                {Array.from({ length: dayCount }, (_, d) => (
                  <option key={d} value={d}>
                    {t("planned_day", { n: d + 1 })}
                  </option>
                ))}
              </select>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
