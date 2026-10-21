import { useEffect } from "react";
import { useTripModel } from "../data/hooks";
import { useLang } from "../state/hooks";

/** <html lang> follows the language; the title names the trip (the app build ships a placeholder). */
export function useDocumentChrome(): void {
  const { data } = useTripModel();
  const lang = useLang();
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  useEffect(() => {
    document.title = `${data.city} · trip map`;
  }, [data.city]);
}
