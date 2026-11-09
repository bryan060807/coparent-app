import type { LocationFix } from "./hub-types";
// Keep a recent good fix when a provider falls back to a much broader estimate.
// After 60s, accept the new estimate with its real uncertainty and capture time.
export function preferFix(
  old: LocationFix | null | undefined,
  next: LocationFix,
  now = Date.now(),
) {
  if (!old) return true;
  if (next.capturedAt <= old.capturedAt) return false;
  return !(
    now - old.capturedAt < 60000 &&
    next.accuracy > Math.max(100, old.accuracy * 2)
  );
}
export function improvedFix(
  old: LocationFix | null | undefined,
  next: LocationFix,
) {
  return (
    !!old &&
    next.capturedAt > old.capturedAt &&
    next.accuracy < old.accuracy / 2
  );
}
export function accuracyLabel(accuracy: number) {
  return accuracy >= 1000
    ? `${(accuracy / 1000).toFixed(1)} km`
    : `${Math.max(1, Math.round(accuracy))} metres`;
}
