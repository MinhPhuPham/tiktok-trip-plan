import { describe, expect, it } from "vitest";
import { browserInfo } from "../pwa/installOffer";
import { locateBrowserFrom, trustsPermissionsApi } from "./browser";
import { iosAppName, locateHelp, type HelpReason } from "./locateHelp";

const IPHONE = (os: string) => `Mozilla/5.0 (iPhone; CPU iPhone OS ${os} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)`;
const UA = {
  chrome18: `${IPHONE("18_5")} CriOS/138.0.7204.156 Mobile/15E148 Safari/604.1`,
  chrome17: `${IPHONE("17_5")} CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1`,
  chrome15: `${IPHONE("15_7")} CriOS/112.0.5615.46 Mobile/15E148 Safari/604.1`,
  edge: `${IPHONE("18_5")} EdgiOS/138.0.3351.65 Version/18.0 Mobile/15E148 Safari/604.1`,
  firefox: `${IPHONE("18_5")} FxiOS/140.0 Mobile/15E148 Safari/605.1.15`,
  safari18: `${IPHONE("18_5")} Version/18.5 Mobile/15E148 Safari/604.1`,
  safari26: `${IPHONE("18_6")} Version/26.0 Mobile/15E148 Safari/604.1`,
  safari17: `${IPHONE("17_5")} Version/17.5 Mobile/15E148 Safari/604.1`,
  webApp: `${IPHONE("18_5")} Mobile/15E148`,
  zalo: `${IPHONE("17_5")} Mobile/15E148 Zalo iOS/600 ZaloTheme/light ZaloLanguage/vi`,
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
} as const;

const browser = (ua: keyof typeof UA) => locateBrowserFrom(browserInfo(UA[ua]), ua === "webApp");
const help = (reason: HelpReason, ua: keyof typeof UA) => locateHelp(reason, browser(ua));

describe("location help by iOS browser", () => {
  it.each([
    ["chrome18", "chrome", "Chrome", false],
    ["edge", "edge", "Edge", false],
    ["firefox", "firefox", "Firefox", false],
    ["safari18", "safari", "Safari", true],
    ["webApp", "web-app", null, true],
    ["zalo", "other", null, false],
    ["android", null, null, true],
  ] as const)("%s runs in %s (Settings name %s, Permissions API trusted: %s)", (ua, host, name, trusted) => {
    const b = browser(ua);
    expect(b.ios).toBe(host);
    expect(iosAppName(b)).toBe(name);
    expect(trustsPermissionsApi(b)).toBe(trusted);
  });

  it("a refusal with no prompt in Chrome, Edge or Firefox points to the app's own location switch", () => {
    for (const ua of ["chrome18", "edge", "firefox"] as const) {
      expect(help("blocked", ua)).toEqual({
        title: "locate_blocked_title",
        why: "locate_ios_app_why",
        steps: ["locate_ios_app_settings", "locate_ios_while_using", "locate_back_retry"],
        privacy: true,
        retry: true,
      });
    }
    expect(help("blocked", "chrome17").steps[0]).toBe("locate_ios_app_settings_old");
    expect(help("blocked", "chrome15").steps[0]).toBe("locate_ios_app_settings_old");
  });

  it("a refused prompt in Chrome: reload and allow first, then the app switch", () => {
    expect(help("refused", "chrome18")).toMatchObject({
      why: "locate_refused_why",
      steps: ["locate_ios_reload_allow", "locate_ios_app_settings", "locate_ios_while_using"],
    });
  });

  it("Safari: Safari Websites in Location Services, Safari's setting (under Apps from iOS 18), the site's aA menu", () => {
    expect(help("blocked", "safari18")).toMatchObject({
      why: "locate_safari_blocked_why",
      steps: ["locate_safari_websites", "locate_safari_settings", "locate_safari_site"],
    });
    expect(help("blocked", "safari26").steps).toContain("locate_safari_settings");
    expect(help("blocked", "safari17").steps).toContain("locate_safari_settings_old");
    expect(help("refused", "safari18").steps[0]).toBe("locate_safari_site");
  });

  it("the trip installed on the Home Screen has its own permission", () => {
    for (const reason of ["blocked", "refused"] as const) {
      expect(help(reason, "webApp")).toMatchObject({ why: "locate_webapp_why", steps: ["locate_webapp_settings", "locate_webapp_readd"] });
    }
  });

  it("no position (code 2): turn on Location Services, then this browser's row, then Try again", () => {
    expect(help("off", "chrome18")).toEqual({
      title: "locate_off_title",
      why: "locate_off_why_ios",
      steps: ["locate_ios_services", "locate_ios_services_app", "locate_back_retry"],
      privacy: false,
      retry: true,
    });
    expect(help("off", "safari18").steps[1]).toBe("locate_ios_services_safari");
    expect(help("off", "webApp").steps[1]).toBe("locate_ios_services_webapp");
    expect(help("off", "android")).toMatchObject({ why: "locate_off_why", steps: ["locate_off_device"], retry: true });
  });

  it("off iOS keeps the site and device steps; in-app browsers say to open a real browser", () => {
    expect(help("blocked", "android").steps).toEqual(["locate_steps_site", "locate_steps_device"]);
    expect(help("blocked", "zalo")).toMatchObject({ why: "locate_in_app", steps: ["install_in_app_open"] });
    expect(help("off", "zalo").why).toBe("locate_in_app");
  });

  it("a page that cannot locate at all offers no Try again", () => {
    expect(help("insecure", "chrome18")).toMatchObject({ title: "locate_unavailable_title", why: "locate_insecure", retry: false, privacy: false });
    expect(help("unsupported", "android")).toMatchObject({ why: "locate_unsupported", retry: false });
    expect(locateHelp("blocked", browser("android"), true).steps).toEqual(["locate_file"]);
  });
});
