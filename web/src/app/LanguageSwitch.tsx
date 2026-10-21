import { useTripModel } from "../data/hooks";
import { useT } from "../i18n/useT";
import { useLang, useTripActions } from "../state/hooks";
import { Segmented } from "../ui/Segmented";

/** Each language named in itself, so a screen reader says it in that language. */
const LANGUAGE_NAMES: Readonly<Record<string, string>> = { en: "English", vi: "Tiếng Việt" };

interface LanguageSwitchProps {
  labelledBy?: string;
}

/** EN / VI toggle. The header shows it on desktop; the map's layers popover on phones. */
export function LanguageSwitch({ labelledBy }: LanguageSwitchProps) {
  const { langs } = useTripModel();
  const t = useT();
  const lang = useLang();
  const { setLang } = useTripActions();
  const options = langs.map((code) => ({
    value: code,
    label: code.toUpperCase(),
    ariaLabel: LANGUAGE_NAMES[code],
    lang: code,
  }));
  return (
    <Segmented
      className="lang"
      options={options}
      value={lang}
      onChange={setLang}
      aria-label={labelledBy ? undefined : t.t("language")}
      aria-labelledby={labelledBy}
    />
  );
}
