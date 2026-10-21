import { categoryId } from "../data/types";
import type { ClusterMix } from "./clusterMix";

/** HTML for Leaflet divIcons. Colors must already be safe (safeColor / inkFor); text is escaped here. */

const HTML_ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const HTML_SPECIAL = /[&<>"']/g;

export const escapeHtml = (text: string): string => text.replace(HTML_SPECIAL, (c) => HTML_ESCAPES[c] ?? c);

export interface PinLook {
  category: string;
  priority: string | null;
  color: string;
  ink: string;
  selected: boolean;
  /** Its list row is hovered (never together with selected). */
  hovered: boolean;
  /** The plan day badge. */
  day: { n: number; color: string; ink: string } | null;
}

export function pinHtml(look: PinLook): string {
  const category = categoryId(look.category);
  const badge = look.day
    ? `<b class="pin-day" style="--d:${look.day.color};--dink:${look.day.ink}">${look.day.n}</b>`
    : "";
  const classes = `pin pin-${look.priority ?? "none"}${look.selected ? " is-selected" : look.hovered ? " is-hovered" : ""}`;
  return `<span class="${classes}" style="--c:${look.color};--ink:${look.ink}"><svg aria-hidden="true"><use href="#i-${category}"/></svg>${badge}</span>`;
}

export function clusterHtml(mix: ClusterMix, title: string): string {
  return `<span class="cluster${mix.hasMust ? " has-must" : ""}" style="--ring:conic-gradient(${mix.ring})" title="${escapeHtml(title)}"><b>${mix.total}</b></span>`;
}

export function centerHtml(color: string, ink: string, kind: string): string {
  return `<span class="center-pin" style="--cc:${color};--cink:${ink}"><svg aria-hidden="true"><use href="#i-${kind === "hotel" ? "home" : "target"}"/></svg></span>`;
}

export function stopChipHtml(n: number, color: string, ink: string): string {
  return `<span class="stop-chip" style="--d:${color};--dink:${ink}">${n}</span>`;
}

export function rayLabelHtml(label: string, color: string, ink: string): string {
  return `<span style="--c:${color};--ink:${ink}">${escapeHtml(label)}</span>`;
}

export function ringLabelHtml(label: string): string {
  return `<span>${escapeHtml(label)}</span>`;
}
