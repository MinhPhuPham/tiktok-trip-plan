import { useId } from "react";
import type { PlanNote } from "../../data/planIssues";
import type { Translator } from "../../i18n/translator";
import { Icon } from "../../ui/Icon";

/** The plan checks for the card's place, in the language shown; the day leads when there are several. */
export function PlanNotes({ t, notes }: { t: Translator; notes: readonly PlanNote[] }) {
  const titleId = useId();
  if (!notes.length) return null;
  const days = new Set(notes.map((n) => n.day)).size > 1;
  return (
    <section className="card-notes" aria-labelledby={titleId}>
      <p className="card-label" id={titleId}>
        {t.t("plan_notes")}
      </p>
      <ul>
        {notes.map((note, k) => {
          const error = note.level === "error";
          return (
            <li key={`${note.day}:${k}`} className={error ? "is-error" : undefined}>
              <Icon name={error ? "alert" : "warn"} />
              <span>
                <span className="sr-only">{t.t(error ? "plan_problem" : "plan_note")} </span>
                {days ? `${t.dayName(note.day)}: ${note.text}` : note.text}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
