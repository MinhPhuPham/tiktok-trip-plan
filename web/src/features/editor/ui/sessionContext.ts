import { createContext, use } from "react";
import { useStore } from "zustand";
import { useT } from "../../../i18n/useT";
import type { IssueWords } from "../logic/issues";
import type { EditorSession, SessionActions, SessionState } from "../session/session";
import { editorText, issueWords, type EditorText } from "../text";

export const EditorSessionContext = createContext<EditorSession | null>(null);

export function useSession(): EditorSession {
  const session = use(EditorSessionContext);
  if (!session) throw new Error("editor components need <EditorSessionContext>");
  return session;
}

export function useSessionState<T>(selector: (state: SessionState) => T): T {
  return useStore(useSession().store, selector);
}

export const useSessionActions = (): SessionActions => useSession().actions;

export function useEditorText(): EditorText {
  return editorText(useT());
}

/** Everything issueText needs, in the current language. */
export function useIssueWords(): IssueWords {
  return issueWords(useSession().ctx, useEditorText());
}
