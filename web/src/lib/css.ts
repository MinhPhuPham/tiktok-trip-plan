import type { CSSProperties } from "react";

/** Inline custom properties ({"--c": "#hex"}) typed for the style prop. */
export function cssVars(vars: Readonly<Record<`--${string}`, string>>): CSSProperties {
  return vars;
}

export function classes(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}
