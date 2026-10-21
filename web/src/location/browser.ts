import { isStandalone } from "../pwa/install";
import { browserInfo } from "../pwa/installOffer";

export interface LocateBrowser {
  ios: boolean;
  /** Zalo, Facebook, Instagram…: their built-in browser often blocks location (the installed app does not count). */
  inApp: boolean;
}

export function locateBrowser(): LocateBrowser {
  const touchMac = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  const { help, ios } = browserInfo(navigator.userAgent, touchMac);
  return { ios, inApp: help === "in-app" && !isStandalone() };
}
