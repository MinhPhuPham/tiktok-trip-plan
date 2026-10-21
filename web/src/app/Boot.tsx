import { Suspense, use } from "react";
import App from "../App";
import type { TripLoadError, TripLoadResult } from "../data/load";
import { browserLang, shellText } from "../i18n/shellText";
import { reloadWithUpdate } from "../pwa/update";
import { Icon } from "../ui/Icon";
import { IconSprite } from "../ui/IconSprite";
import { ErrorBoundary } from "./ErrorBoundary";
import { TripProviders } from "./TripProviders";

const bootLang = () => browserLang(["en", "vi"]);
const text = (key: string) => shellText(bootLang(), key) ?? key;

function BootScreen() {
  return (
    <div className="boot" role="status">
      <p>{text("loading")}</p>
    </div>
  );
}

function errorTitle(error: TripLoadError): string {
  if (error.kind !== "version") return text("load_failed");
  return text(error.found != null && error.found > error.expected ? "update_ready" : "load_failed");
}

function errorDetail(error: TripLoadError): string {
  switch (error.kind) {
    case "missing":
      return text("load_missing");
    case "http":
      return `${error.source}: HTTP ${error.status}`;
    case "network":
    case "invalid":
      return `${error.source}: ${error.message}`;
    case "version":
      return text(error.found != null && error.found > error.expected ? "load_version_newer" : "load_version_older");
  }
}

function LoadError({ error }: { error: TripLoadError }) {
  const update = error.kind === "version";
  const reload = update || error.kind === "invalid";
  return (
    <div className="boot" role="alert">
      <IconSprite />
      <Icon name="offline" />
      <h1>{errorTitle(error)}</h1>
      <p>{errorDetail(error)}</p>
      <button
        type="button"
        className="btn"
        onClick={() => (update ? void reloadWithUpdate() : window.location.reload())}
      >
        {text(reload ? "reload" : "retry")}
      </button>
    </div>
  );
}

const crashScreen = (error: Error) => <LoadError error={{ kind: "invalid", source: "app", message: error.message }} />;

function TripGate({ trip }: { trip: Promise<TripLoadResult> }) {
  const result = use(trip);
  if (!result.ok) return <LoadError error={result.error} />;
  return (
    <ErrorBoundary fallback={crashScreen}>
      <TripProviders data={result.data}>
        <App />
      </TripProviders>
    </ErrorBoundary>
  );
}

export function Boot({ trip }: { trip: Promise<TripLoadResult> }) {
  return (
    <Suspense fallback={<BootScreen />}>
      <TripGate trip={trip} />
    </Suspense>
  );
}
