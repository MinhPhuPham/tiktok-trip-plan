import { issueText } from "../logic/issues";
import type { Issue } from "../logic/types";
import { PeIcon } from "./PeIcon";
import { useIssueWords } from "./sessionContext";

/** Issues that belong to no stop: a day's, or a left-out place's. Stops carry only an icon. */
export function IssueList({ issues, className }: { issues: readonly Issue[]; className?: string }) {
  const words = useIssueWords();
  if (!issues.length) return null;
  return (
    <ul className={className ? `pe-issues ${className}` : "pe-issues"}>
      {issues.map((issue, k) => (
        <li key={`${issue.rule}:${k}`} className={`pe-issue ${issue.level === "error" ? "is-error" : "is-warn"}`}>
          <PeIcon name={issue.level === "error" ? "error" : "warn"} />
          <span>{issueText(words, issue)}</span>
        </li>
      ))}
    </ul>
  );
}
