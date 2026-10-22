import type { IosHost, LocateBrowser } from "./browser";
import type { GeoUnavailable } from "./locator";

/** What the location help explains: the page cannot locate at all, a refusal (with or without a prompt), or no position. */
export type HelpReason = GeoUnavailable | "blocked" | "refused" | "off";

/** Text keys; "{app}" in them is the iOS browser's name. */
export interface LocateHelp {
  title: string;
  why: string;
  steps: string[];
  /** The privacy line under a refusal. */
  privacy: boolean;
  retry: boolean;
}

/** iOS 18 moved every app's settings, Safari's too, under Settings → Apps. */
const SETTINGS_APPS_FROM = 18;

const APP_NAMES: Readonly<Partial<Record<IosHost, string>>> = { chrome: "Chrome", edge: "Edge", firefox: "Firefox", safari: "Safari" };

/** The iOS app whose settings hold location, as Settings names it; null where it needs translating. */
export const iosAppName = (browser: LocateBrowser): string | null => (browser.ios ? (APP_NAMES[browser.ios] ?? null) : null);

const appsMenu = (browser: LocateBrowser): boolean => (browser.iosMajor ?? SETTINGS_APPS_FROM) >= SETTINGS_APPS_FROM;

/** Settings → (Apps →) Chrome → Location, While Using + Precise, back: the app-level switch of Chrome, Edge, Firefox on iOS. */
const appSteps = (browser: LocateBrowser): string[] => [
  appsMenu(browser) ? "locate_ios_app_settings" : "locate_ios_app_settings_old",
  "locate_ios_while_using",
];

function refusalSteps(reason: "blocked" | "refused", browser: LocateBrowser): Pick<LocateHelp, "why" | "steps"> {
  const safariSettings = appsMenu(browser) ? "locate_safari_settings" : "locate_safari_settings_old";
  switch (browser.ios) {
    case null:
      return { why: "locate_blocked_why", steps: ["locate_steps_site", "locate_steps_device"] };
    case "web-app":
      return { why: "locate_webapp_why", steps: ["locate_webapp_settings", "locate_webapp_readd"] };
    case "safari":
      return reason === "blocked"
        ? { why: "locate_safari_blocked_why", steps: ["locate_safari_websites", safariSettings, "locate_safari_site"] }
        : { why: "locate_refused_why", steps: ["locate_safari_site", safariSettings, "locate_safari_websites"] };
    default:
      return reason === "blocked"
        ? { why: "locate_ios_app_why", steps: [...appSteps(browser), "locate_back_retry"] }
        : { why: "locate_refused_why", steps: ["locate_ios_reload_allow", ...appSteps(browser)] };
  }
}

const SERVICES_ROW: Readonly<Record<IosHost, string>> = {
  safari: "locate_ios_services_safari",
  "web-app": "locate_ios_services_webapp",
  chrome: "locate_ios_services_app",
  edge: "locate_ios_services_app",
  firefox: "locate_ios_services_app",
  other: "locate_ios_services_app",
};

/** The help behind the struck-through button, most specific case first. `file`: map.html opened from disk. */
export function locateHelp(reason: HelpReason, browser: LocateBrowser, file = false): LocateHelp {
  const refusal = reason === "blocked" || reason === "refused";
  const title = reason === "off" ? "locate_off_title" : refusal ? "locate_blocked_title" : "locate_unavailable_title";
  const base = { title, privacy: refusal, retry: reason === "off" || refusal };
  if (reason === "insecure") return { ...base, why: "locate_insecure", steps: [] };
  if (browser.inApp) return { ...base, why: "locate_in_app", steps: ["install_in_app_open"] };
  if (reason === "unsupported") return { ...base, why: "locate_unsupported", steps: [] };
  if (reason === "off") {
    return browser.ios
      ? { ...base, why: "locate_off_why_ios", steps: ["locate_ios_services", SERVICES_ROW[browser.ios], "locate_back_retry"] }
      : { ...base, why: "locate_off_why", steps: ["locate_off_device"] };
  }
  if (file) return { ...base, why: "locate_blocked_why", steps: ["locate_file"] };
  return { ...base, ...refusalSteps(reason, browser) };
}
