import { storage } from "../lib/storage";
import type { IconName } from "../ui/IconSprite";

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

/** The iOS browser app the page runs in: each puts Share, and its location switch, somewhere else. */
export type IosBrowser = "safari" | "chrome" | "edge" | "firefox" | "other";

export interface BrowserInfo {
  help: InstallHelp;
  ios: boolean;
  /** null off iOS and in in-app browsers. */
  iosBrowser: IosBrowser | null;
  /**
   * iOS major version: Safari's Version/ (iOS 26 freezes the OS in the user agent at 18), else the
   * OS version. Other browsers on iOS 26 therefore read 18, which changes none of their steps.
   */
  iosMajor: number | null;
}

const IN_APP =
  /FBAN|FBAV|FB_IAB|FBIOS|FB4A|Messenger|Orca-Android|Instagram|Zalo|\bLine\/|musical_ly|Bytedance|TikTok|Twitter|Snapchat|KAKAOTALK|Pinterest|LinkedInApp|; wv\)/i;
const IOS_DEVICE = /iPhone|iPad|iPod/i;
const IOS_VERSION = /OS (\d+)[_.](\d+)/;
const IOS_OTHER_BROWSER = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|YaBrowser|DuckDuckGo/;
const IOS_BROWSERS: readonly (readonly [RegExp, IosBrowser])[] = [
  [/CriOS\//, "chrome"],
  [/EdgiOS\//, "edge"],
  [/FxiOS\//, "firefox"],
  [IOS_OTHER_BROWSER, "other"],
];
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

const iosBrowserOf = (ua: string): IosBrowser => IOS_BROWSERS.find(([pattern]) => pattern.test(ua))?.[1] ?? "safari";

function iosMajorOf(ua: string, browser: IosBrowser | null): number | null {
  const version = browser === "safari" ? SAFARI_VERSION.exec(ua) : null;
  const os = IOS_VERSION.exec(ua);
  const major = Number(version?.[1] ?? os?.[1] ?? Number.NaN);
  return Number.isFinite(major) ? major : null;
}

/**
 * Reads the user agent for the install and location instructions. `touchMac` is an iPad asking for
 * the desktop site (MacIntel with a touch screen), which is iOS Safari.
 */
export function browserInfo(ua: string, touchMac = false): BrowserInfo {
  const ios = IOS_DEVICE.test(ua) || touchMac;
  const off = { ios, iosBrowser: null, iosMajor: null };
  if (ios) {
    if (IN_APP.test(ua) || !/Safari\//.test(ua)) return { help: "in-app", ...off, iosMajor: iosMajorOf(ua, null) };
    const iosBrowser = iosBrowserOf(ua);
    const share = iosBrowser === "safari" || iosShareEverywhere(ua);
    return { help: share ? "share" : "safari-only", ios, iosBrowser, iosMajor: iosMajorOf(ua, iosBrowser) };
  }
  if (IN_APP.test(ua)) return { help: "in-app", ...off };
  if (/Android/i.test(ua)) return { help: "menu", ...off };
  if (/Firefox\//.test(ua)) return { help: "unsupported", ...off };
  if (/Macintosh/.test(ua) && !NOT_SAFARI.test(ua)) {
    const version = Number(SAFARI_VERSION.exec(ua)?.[1] ?? 0);
    return { help: version >= 17 ? "dock" : "unsupported", ...off };
  }
  return { help: CHROMIUM.test(ua) ? "menu" : "unsupported", ...off };
}

/** This page's user agent; an iPad asking for the desktop site counts as iOS. */
export function currentBrowser(): BrowserInfo {
  const touchMac = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return browserInfo(navigator.userAgent, touchMac);
}

export interface InstallStep {
  text: string;
  /** Replaces "{icon}" in the text: the button the browser shows. */
  icon?: IconName;
}

/** Safari 26 folds Share into the ••• button of its bottom bar. */
const SAFARI_SHARE_IN_MENU = 26;

const SHARE_STEP: Readonly<Record<IosBrowser, string>> = {
  safari: "install_ios_share_safari",
  chrome: "install_ios_share_chrome",
  edge: "install_ios_share_edge",
  firefox: "install_ios_share_firefox",
  other: "install_ios_share",
};

/** Share → Add to Home Screen, with Share where this iOS browser keeps it. */
export function shareSteps({ iosBrowser, iosMajor }: Pick<BrowserInfo, "iosBrowser" | "iosMajor">): InstallStep[] {
  const safari26 = iosBrowser === "safari" && (iosMajor ?? 0) >= SAFARI_SHARE_IN_MENU;
  const share = safari26 ? "install_ios_share_safari26" : SHARE_STEP[iosBrowser ?? "other"];
  return [
    { text: share, icon: "share" },
    { text: "install_ios_add", icon: "plus-square" },
  ];
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
