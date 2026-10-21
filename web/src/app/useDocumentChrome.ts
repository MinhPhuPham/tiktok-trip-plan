import { useEffect } from "react";
import { useTripModel } from "../data/hooks";
import { useLang } from "../state/hooks";

/** <html lang> follows the language; the title is the site name (exports before it keep theirs). */
export function useDocumentChrome(): void {
  const { data } = useTripModel();
  const lang = useLang();
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  useEffect(() => {
    if (data.site_name) document.title = data.site_name;
  }, [data.site_name]);
}
