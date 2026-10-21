/// <reference types="vitest/config" />
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { viteSingleFile } from "vite-plugin-singlefile";

const webRoot = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(webRoot, "..");
const distRoot = resolve(repoRoot, "src/tiktok_trip/export/web_dist");
const exportedApp = resolve(repoRoot, "output/app");
const exportedOutput = resolve(repoRoot, "output");
const devData = resolve(webRoot, ".dev-data");
const webPublic = resolve(webRoot, "public");

const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".webmanifest": "application/manifest+json",
};

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

/**
 * Dev only. output/app is the public dir; what it lacks comes from web/.dev-data (trip.json from
 * `npm run dev:data`), web/public (icons) and output/ (media/ of the last export).
 */
function devFallbacks(): Plugin {
  return {
    name: "trip-dev-fallbacks",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/"));
        if (path.includes("..") || isFile(join(exportedApp, path))) return next();
        const roots = path.startsWith("/media/") ? [exportedOutput] : [devData, webPublic];
        const file = roots.map((root) => join(root, path)).find(isFile);
        if (!file) {
          if (path === "/trip.json") {
            server.config.logger.warn(
              "No trip.json: run `uv run tiktok-trip run --from export` or `npm run dev:data`.",
            );
          }
          return next();
        }
        res.setHeader("Content-Type", CONTENT_TYPES[extname(file)] ?? "application/octet-stream");
        createReadStream(file).pipe(res);
      });
    },
  };
}

function appHeadLinks(): Plugin {
  return {
    name: "trip-app-head",
    transformIndexHtml: () => [
      { tag: "link", attrs: { rel: "manifest", href: "manifest.webmanifest" }, injectTo: "head" },
      { tag: "link", attrs: { rel: "icon", href: "favicon.svg", type: "image/svg+xml" }, injectTo: "head" },
      { tag: "link", attrs: { rel: "icon", href: "favicon-32.png", sizes: "32x32" }, injectTo: "head" },
      { tag: "link", attrs: { rel: "apple-touch-icon", href: "apple-touch-icon.png", sizes: "180x180" }, injectTo: "head" },
    ],
  };
}

function pwa(): Plugin[] {
  return VitePWA({
    strategies: "injectManifest",
    srcDir: "src",
    filename: "sw.ts",
    registerType: "prompt",
    injectRegister: false,
    /** public/manifest.webmanifest, not generated: the plugin would precache it, and Python fills it. */
    manifest: false,
    injectManifest: {
      globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
      maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
    },
    devOptions: { enabled: false },
  });
}

export default defineConfig(({ mode, command }) => {
  const single = mode === "single";
  const app = mode === "app";
  return {
    base: command === "build" ? "./" : "/",
    publicDir: command === "serve" ? exportedApp : single ? false : webPublic,
    define: { __PWA__: JSON.stringify(app) },
    plugins: [
      react(),
      devFallbacks(),
      ...(single ? [] : [appHeadLinks()]),
      ...(app ? pwa() : []),
      ...(single ? [viteSingleFile({ removeViteModuleLoader: true })] : []),
    ],
    build: {
      outDir: resolve(distRoot, single ? "single" : "app"),
      emptyOutDir: true,
      target: "es2022",
      sourcemap: false,
      license: app ? { fileName: "licenses.md" } : false,
      chunkSizeWarningLimit: 1200,
      ...(single ? { assetsInlineLimit: Number.MAX_SAFE_INTEGER, cssCodeSplit: false } : {}),
    },
    server: { fs: { allow: [webRoot, exportedOutput] } },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.ts"],
      css: false,
    },
  };
});
