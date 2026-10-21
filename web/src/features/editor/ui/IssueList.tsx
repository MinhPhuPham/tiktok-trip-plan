import { issueText } from "../logic/issues";
import type { Issue } from "../logic/types";
import { PeIcon } from "./PeIcon";
import { useIssueWords, useSessionState } from "./sessionContext";

interface IssueListProps {
  issues: readonly Issue[];
  className?: string;
  /** Show warnings even while the notes are folded (an expanded stop, a left-out place). */
  withWarnings?: boolean;
}

const selectShowNotes = (s: { showNotes: boolean }) => s.showNotes;

/** Errors always; warnings only while the notes are open or the caller asks for them. */
export function IssueList({ issues, className, withWarnings = false }: IssueListProps) {
  const showNotes = useSessionState(selectShowNotes);
  const words = useIssueWords();
  const shown = issues.filter((i) => i.level === "error" || withWarnings || showNotes);
  if (!shown.length) return null;
  return (
    <ul className={className ? `pe-issues ${className}` : "pe-issues"}>
      {shown.map((issue, k) => (
        <li key={`${issue.rule}:${k}`} className={`pe-issue ${issue.level === "error" ? "is-error" : "is-warn"}`}>
          <PeIcon name={issue.level === "error" ? "error" : "warn"} />
          <span>{issueText(words, issue)}</span>
        </li>
      ))}
    </ul>
  );
}
