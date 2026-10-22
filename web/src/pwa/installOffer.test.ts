import { describe, expect, it } from "vitest";
import {
  browserInfo,
  INSTALL_SNOOZE_MS,
  installEntry,
  installKind,
  loadInstallSnooze,
  saveInstallSnooze,
  shareSteps,
  SNOOZE_KEY,
  type InstallEnv,
  type InstallHelp,
  type IosBrowser,
} from "./installOffer";

const IPHONE = (os: string) => `Mozilla/5.0 (iPhone; CPU iPhone OS ${os} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)`;
const ANDROID = "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko)";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

type Row = readonly [name: string, ua: string, help: InstallHelp, ios: boolean, iosBrowser?: IosBrowser, iosMajor?: number];

const USER_AGENTS: readonly Row[] = [
  ["iOS Safari", `${IPHONE("17_5")} Version/17.5 Mobile/15E148 Safari/604.1`, "share", true, "safari", 17],
  ["iOS Safari 18", `${IPHONE("18_5")} Version/18.5 Mobile/15E148 Safari/604.1`, "share", true, "safari", 18],
  ["iOS Safari 26 (OS frozen at 18_6)", `${IPHONE("18_6")} Version/26.0 Mobile/15E148 Safari/604.1`, "share", true, "safari", 26],
  ["iOS Chrome 17", `${IPHONE("17_5")} CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1`, "share", true, "chrome", 17],
  ["iOS Chrome 16.4", `${IPHONE("16_4")} CriOS/112.0.5615.46 Mobile/15E148 Safari/604.1`, "share", true, "chrome", 16],
  ["iOS Chrome 15", `${IPHONE("15_7")} CriOS/112.0.5615.46 Mobile/15E148 Safari/604.1`, "safari-only", true, "chrome", 15],
  ["iOS Chrome on iOS 26", `${IPHONE("18_6")} CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1`, "share", true, "chrome", 18],
  ["iOS Edge 16.4", `${IPHONE("16_4")} EdgiOS/125.0 Version/16.0 Mobile/15E148 Safari/604.1`, "share", true, "edge", 16],
  ["iOS Edge 18", `${IPHONE("18_5")} EdgiOS/138.0.3351.65 Version/18.0 Mobile/15E148 Safari/604.1`, "share", true, "edge", 18],
  ["iOS Firefox 16.3", `${IPHONE("16_3")} FxiOS/120.0 Mobile/15E148 Safari/605.1.15`, "safari-only", true, "firefox", 16],
  ["iOS Firefox 18", `${IPHONE("18_5")} FxiOS/140.0 Mobile/15E148 Safari/605.1.15`, "share", true, "firefox", 18],
  ["iOS Opera 17", `${IPHONE("17_5")} OPT/5.0.0 Mobile/15E148 Safari/604.1`, "share", true, "other", 17],
  ["iOS Safari 15", `${IPHONE("15_8")} Version/15.6 Mobile/15E148 Safari/604.1`, "share", true, "safari", 15],
  ["iPad desktop Safari", `${MAC} Version/17.5 Safari/605.1.15`, "share", true, "safari", 17],
  ["Zalo iOS", `${IPHONE("17_5")} Mobile/15E148 Zalo iOS/600 ZaloTheme/light ZaloLanguage/vi`, "in-app", true],
  ["Facebook iOS", `${IPHONE("17_5")} Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.37.97;FBBV/618234112]`, "in-app", true],
  ["Messenger iOS", `${IPHONE("17_5")} Mobile/15E148 LightSpeed [FBAN/MessengerLiteForiOS;FBAV/470.0]`, "in-app", true],
  ["Instagram iOS", `${IPHONE("17_5")} Mobile/15E148 Instagram 336.0.3.18.99 (iPhone15,3; iOS 17_5; vi_VN)`, "in-app", true],
  ["TikTok iOS", `${IPHONE("17_5")} Mobile/15E148 musical_ly_34.9.0 JsSdk/2.0 NetType/WIFI BytedanceWebview/d8a21c6`, "in-app", true],
  ["Line iOS", `${IPHONE("17_5")} Mobile/15E148 Safari Line/14.9.0`, "in-app", true],
  ["iOS app web view", `${IPHONE("17_5")} Mobile/15E148`, "in-app", true],
  ["Android Chrome", `${ANDROID} Chrome/126.0.6478.71 Mobile Safari/537.36`, "menu", false],
  ["Samsung Internet", `${ANDROID} SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36`, "menu", false],
  ["Firefox Android", "Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0", "menu", false],
  ["Zalo Android", `${ANDROID} Chrome/126.0.6478.71 Mobile Safari/537.36 Zalo android/12100541 ZaloTheme/light`, "in-app", false],
  ["Facebook Android", `${ANDROID} Chrome/126.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/470.0.0.40.86;]`, "in-app", false],
  ["Messenger Android", `${ANDROID} Chrome/126.0 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/460.0]`, "in-app", false],
  ["Android web view", "Mozilla/5.0 (Linux; Android 14; K; wv) AppleWebKit/537.36 Version/4.0 Chrome/126.0 Mobile Safari/537.36", "in-app", false],
  ["macOS Safari 17", `${MAC} Version/17.5 Safari/605.1.15`, "dock", false],
  ["macOS Safari 16", `${MAC} Version/16.6 Safari/605.1.15`, "unsupported", false],
  ["macOS Chrome", `${MAC} Chrome/126.0.0.0 Safari/537.36`, "menu", false],
  ["Windows Edge", `${WINDOWS} AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0`, "menu", false],
  ["Windows Firefox", `${WINDOWS}; rv:127.0) Gecko/20100101 Firefox/127.0`, "unsupported", false],
  ["macOS Firefox", "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:127.0) Gecko/20100101 Firefox/127.0", "unsupported", false],
];

const env = (patch: Partial<InstallEnv> = {}): InstallEnv => ({
  pwa: true,
  installed: false,
  standalone: false,
  canPrompt: false,
  help: "menu",
  ...patch,
});

describe("install help by browser", () => {
  it.each(USER_AGENTS.map((row) => ({ name: row[0], row })))("$name", ({ row: [name, ua, help, ios, iosBrowser, iosMajor] }) => {
    const info = browserInfo(ua, name.startsWith("iPad"));
    expect(info).toMatchObject({ help, ios, iosBrowser: iosBrowser ?? null });
    if (iosMajor != null) expect(info.iosMajor).toBe(iosMajor);
    if (!ios) expect(info.iosMajor).toBeNull();
  });
});

describe("Share → Add to Home Screen steps on iOS", () => {
  const firstStep = (ua: string) => shareSteps(browserInfo(ua))[0]!.text;
  const row = (name: string) => USER_AGENTS.find(([n]) => n === name)![1];

  it.each([
    ["iOS Safari", "install_ios_share_safari"],
    ["iOS Safari 18", "install_ios_share_safari"],
    ["iOS Safari 26 (OS frozen at 18_6)", "install_ios_share_safari26"],
    ["iOS Chrome 17", "install_ios_share_chrome"],
    ["iOS Chrome on iOS 26", "install_ios_share_chrome"],
    ["iOS Edge 18", "install_ios_share_edge"],
    ["iOS Firefox 18", "install_ios_share_firefox"],
    ["iOS Opera 17", "install_ios_share"],
  ])("%s finds Share with %s", (name, key) => {
    expect(firstStep(row(name))).toBe(key);
  });

  it("always ends with Add to Home Screen, each step with the icon the browser shows", () => {
    for (const [, ua, help] of USER_AGENTS) {
      if (help !== "share") continue;
      const [share, add] = shareSteps(browserInfo(ua));
      expect(share?.text).toMatch(/^install_ios_share/);
      expect(share?.icon).toBe("share");
      expect(add).toEqual({ text: "install_ios_add", icon: "plus-square" });
    }
  });
});

describe("install offer", () => {
  it("prefers the browser's prompt, else this browser's steps; never in the single file or once installed", () => {
    expect(installKind(env({ canPrompt: true }))).toBe("prompt");
    for (const [, , help] of USER_AGENTS) {
      expect(installKind(env({ help }))).toBe(help);
      expect(installKind(env({ help, pwa: false }))).toBe("unavailable");
      expect(installKind(env({ help, standalone: true }))).toBe("unavailable");
      expect(installKind(env({ help, installed: true }))).toBe("unavailable");
    }
    expect(installKind(env({ canPrompt: true, standalone: true }))).toBe("unavailable");
  });

  it("always shows the map button; 'Not now' shrinks it to its icon for 14 days", () => {
    const at = Date.UTC(2026, 9, 21);
    for (const kind of ["prompt", "share", "in-app", "menu", "dock", "unsupported", "safari-only"] as const) {
      expect(installEntry(kind, null, at)).toBe("label");
      expect(installEntry(kind, at, at + 1)).toBe("icon");
    }
    expect(installEntry("share", at, at + INSTALL_SNOOZE_MS - 1)).toBe("icon");
    expect(installEntry("share", at, at + INSTALL_SNOOZE_MS)).toBe("label");
    expect(installEntry("unavailable", null, at)).toBeNull();
    expect(installEntry("unavailable", at, at + 1)).toBeNull();
  });

  it("remembers the dismissal under a versioned key and ignores anything else", () => {
    expect(loadInstallSnooze()).toBeNull();
    saveInstallSnooze(1234);
    expect(JSON.parse(window.localStorage.getItem(SNOOZE_KEY) ?? "null")).toEqual({ v: 1, at: 1234 });
    expect(loadInstallSnooze()).toBe(1234);
    window.localStorage.setItem(SNOOZE_KEY, JSON.stringify({ v: 2, at: 1234 }));
    expect(loadInstallSnooze()).toBeNull();
    window.localStorage.setItem(SNOOZE_KEY, "{not json");
    expect(loadInstallSnooze()).toBeNull();
  });
});
