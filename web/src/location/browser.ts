import { isStandalone } from "../pwa/install";
import { currentBrowser, type BrowserInfo, type IosBrowser } from "../pwa/installOffer";

/** Where iOS keeps this page's location switch: the browser app, or the trip installed on the Home Screen. */
export type IosHost = IosBrowser | "web-app";

export interface LocateBrowser {
  /** null off iOS. */
  ios: IosHost | null;
  iosMajor: number | null;
  /** Zalo, Facebook, Instagram…: their built-in browser often blocks location (the installed app does not count). */
  inApp: boolean;
}

export function locateBrowserFrom(info: BrowserInfo, standalone: boolean): LocateBrowser {
  const inApp = info.help === "in-app" && !standalone;
  const ios = !info.ios ? null : standalone ? "web-app" : (info.iosBrowser ?? "other");
  return { ios, iosMajor: info.iosMajor, inApp };
}

export const locateBrowser = (): LocateBrowser => locateBrowserFrom(currentBrowser(), isStandalone());

/**
 * Chrome, Edge and Firefox on iOS run WebKit inside their own app: the Permissions API there can say
 * "prompt" or "denied" whatever the app and the page are allowed, so only a tap finds out.
 */
export const trustsPermissionsApi = (browser: LocateBrowser): boolean =>
  browser.ios == null || browser.ios === "safari" || browser.ios === "web-app";
