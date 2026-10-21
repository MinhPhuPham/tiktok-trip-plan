import { useTripStore } from "../state/hooks";
import { isDotShown } from "./locateMachine";
import { distanceMeters, formatDistance } from "./position";

/** "1.2 km" in a straight line from the user while their dot shows, else "" (re-renders only when the text changes). */
export function useDistanceFromUser(point: { lat: number; lng: number } | null): string {
  return useTripStore((s) =>
    point && s.userFix && isDotShown(s.locate.mode) ? formatDistance(distanceMeters(s.userFix, point)) : "",
  );
}
