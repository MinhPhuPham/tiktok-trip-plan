import { storage } from "../lib/storage";

/** How this browser installs a web app when it does not offer its own prompt. */
export type InstallHelp =
  /** In-app browser (Zalo, Facebook, Messenger, Instagram, Line, TikTok…): open the page in a real browser. */
  | "in-app"
  /** iOS before 16.4 outside Safari: only Safari adds to the Home Screen. */
  | "safari-only"
  /** iOS Safari, and Chrome/Edge/Firefox on iOS 16.4+: Share → Add to Home Screen. */
  | "share"
  /** Android browsers and desktop Chromium without a prompt: the browser menu → Install / Add to Home screen. */
  | "menu"
  /** Safari 17+ on macOS: File → Add to Dock. */
  | "dock"
  /** Desktop Firefox, older Safari: cannot install; use Chrome or Edge. */
  | "unsupported";

export type InstallKind = "prompt" | InstallHelp | "unavailable";

export interface BrowserInfo {
  help: InstallHelp;
  ios: boolean;
}

const IN_APP =
  /FBAN|FBAV|FB_IAB|FBIOS|FB4A|Messenger|Orca-Android|Instagram|Zalo|\bLine\/|musical_ly|Bytedance|TikTok|Twitter|Snapchat|KAKAOTALK|Pinterest|LinkedInApp|; wv\)/i;
const IOS_DEVICE = /iPhone|iPad|iPod/i;
const IOS_VERSION = /OS (\d+)[_.](\d+)/;
const IOS_OTHER_BROWSER = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|YaBrowser|DuckDuckGo/;
const SAFARI_VERSION = /Version\/(\d+)/;
const NOT_SAFARI = /Chrome|Chromium|CriOS|Edg\/|OPR|Firefox/;
const CHROMIUM = /Chrome\/|Chromium|Edg\//;

/** iOS 16.4 let every iOS browser add web apps to the Home Screen from its share menu. */
const iosShareEverywhere = (ua: string): boolean => {
  const match = IOS_VERSION.exec(ua);
  if (!match) return true;
  const [major, minor] = [Number(match[1]), Number(match[2])];
  return major > 16 || (major === 16 && minor >= 4);
};

/**
 * Reads the user agent for the install instructions. `touchMac` is an iPad asking for the desktop site
 * (MacIntel with a touch screen), which is iOS Safari.
 */
export function browserInfo(ua: string, touchMac = false): BrowserInfo {
  const ios = IOS_DEVICE.test(ua) || touchMac;
  if (ios) {
    if (IN_APP.test(ua) || !/Safari\//.test(ua)) return { help: "in-app", ios };
    const share = !IOS_OTHER_BROWSER.test(ua) || iosShareEverywhere(ua);
    return { help: share ? "share" : "safari-only", ios };
  }
  if (IN_APP.test(ua)) return { help: "in-app", ios };
  if (/Android/i.test(ua)) return { help: "menu", ios };
  if (/Firefox\//.test(ua)) return { help: "unsupported", ios };
  if (/Macintosh/.test(ua) && !NOT_SAFARI.test(ua)) {
    const version = Number(SAFARI_VERSION.exec(ua)?.[1] ?? 0);
    return { help: version >= 17 ? "dock" : "unsupported", ios };
  }
  return { help: CHROMIUM.test(ua) ? "menu" : "unsupported", ios };
}

export interface InstallEnv {
  /** The app build (`__PWA__`); the single-file map.html has no service worker or manifest. */
  pwa: boolean;
  /** `appinstalled` fired in this page. */
  installed: boolean;
  /** Already running as the installed app (display-mode standalone, navigator.standalone). */
  standalone: boolean;
  /** `beforeinstallprompt` was captured. */
  canPrompt: boolean;
  help: InstallHelp;
}

export function installKind({ pwa, installed, standalone, canPrompt, help }: InstallEnv): InstallKind {
  if (!pwa || installed || standalone) return "unavailable";
  return canPrompt ? "prompt" : help;
}

export const INSTALL_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

export const isSnoozed = (dismissedAt: number | null, now: number): boolean =>
  dismissedAt != null && now < dismissedAt + INSTALL_SNOOZE_MS;

/** The map's install button: labelled, icon only for two weeks after "Not now", or none once installed. */
export type InstallEntry = "label" | "icon" | null;

export function installEntry(kind: InstallKind, dismissedAt: number | null, now: number): InstallEntry {
  if (kind === "unavailable") return null;
  return isSnoozed(dismissedAt, now) ? "icon" : "label";
}

const SNOOZE_VERSION = 1;
export const SNOOZE_KEY = `tripmap:install-snooze:v${SNOOZE_VERSION}`;

const parseSnooze = (raw: unknown): number | null => {
  if (!raw || typeof raw !== "object") return null;
  const { v, at } = raw as { v?: unknown; at?: unknown };
  return v === SNOOZE_VERSION && typeof at === "number" && Number.isFinite(at) ? at : null;
};

export const loadInstallSnooze = (): number | null => storage.read(SNOOZE_KEY, parseSnooze);

export const saveInstallSnooze = (at: number): void => {
  storage.write(SNOOZE_KEY, { v: SNOOZE_VERSION, at });
};
