import { PRIORITY_ORDER, type Priority } from "./types";

const PRIORITIES: ReadonlySet<string> = new Set(PRIORITY_ORDER.filter((level) => level !== null));

const isPriority = (value: string | null | undefined): value is Priority => value != null && PRIORITIES.has(value);

/** Map pin diameter per priority; unrated places get the smallest. */
const PIN_SIZE: Readonly<Record<Priority, number>> = { must: 34, high: 30, medium: 25, low: 20 };

export const pinSize = (priority: string | null | undefined): number => (isPriority(priority) ? PIN_SIZE[priority] : PIN_SIZE.low);

export const PRIORITY_STARS: Readonly<Record<Priority, string>> = { must: "★★★★", high: "★★★", medium: "★★", low: "★" };

export const priorityStars = (priority: string | null | undefined): string => (isPriority(priority) ? PRIORITY_STARS[priority] : "");

/** Sort key: must first, unrated after every level. */
export const priorityRank = (priority: string | null | undefined): number =>
  isPriority(priority) ? PRIORITY_ORDER.indexOf(priority) : PRIORITY_ORDER.length - 1;
