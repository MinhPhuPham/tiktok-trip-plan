import { createContext, use, useMemo } from "react";
import { useStore } from "zustand";
import { useT } from "../../../i18n/useT";
import { slotById } from "../logic/context";
import type { IssueWords } from "../logic/issues";
import type { EditorSession, SessionActions, SessionState } from "../session/session";
import { editorText, slotName, type EditorText } from "../text";

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
  const { ctx } = useSession();
  const words = useEditorText();
  return useMemo(
    () => ({
      t: words.t,
      time: words.time,
      slotName: (id: string) => {
        const slot = slotById(ctx, id);
        return slot ? slotName(slot, words.lang) : id;
      },
      category: (category: string) => words.tr.category(category),
      direction: (sector: string) => words.tr.directionName(sector),
      node: (ref: string) => ctx.nodes.get(ref),
    }),
    [ctx, words],
  );
}
