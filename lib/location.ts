import { randomUUID } from "node:crypto";
import type {
  HubState,
  HubActor,
  LocationView,
  LocationFix,
  FamilyLocation,
} from "./hub-types";
import { HubError } from "./hub-domain";
import { preferFix } from "./location-quality";
export function cleanLocations(s: HubState, now = Date.now()) {
  let changed = false;
  for (const [id, loc] of Object.entries(s.locations ?? {})) {
    const child = id === s.child?.id;
    if (
      loc.expires <= now ||
      (loc.fix && now - loc.fix.capturedAt > 86400000) ||
      (loc.credential &&
        (!child ||
          !s.child?.enabled ||
          !s.childSettings?.locationAllowed ||
          s.child.credentialVersion !== loc.credential))
    ) {
      delete s.locations![id];
      s.locationVersions ??= {};
      s.locationVersions[id] = (s.locationVersions[id] ?? 0) + 1;
      changed = true;
    }
  }
  return changed;
}
export function locationView(
  s: HubState,
  a: HubActor,
  members: { id: string; name: string }[],
  childName: string,
  now = Date.now(),
): LocationView {
  const allowed = a.role === "parent" || !!s.childSettings?.locationAllowed;
  const people: FamilyLocation[] =
    a.role === "parent"
      ? [
          ...members.map((m) => ({ ...m, role: "parent" as const })),
          ...(s.child?.enabled
            ? [{ id: s.child.id, name: childName, role: "child" as const }]
            : []),
        ].map((m) => {
          const l = s.locations?.[m.id];
          return { ...m, sharing: !!l, expires: l?.expires, fix: l?.fix };
        })
      : [];
  return {
    viewer: a.id,
    role: a.role,
    allowed,
    controlVersion: s.locationVersions?.[a.id] ?? 0,
    own:
      allowed && s.locations?.[a.id]
        ? {
            grant: s.locations[a.id].grant,
            expires: s.locations[a.id].expires,
            startedAt: s.locations[a.id].startedAt,
            fix: s.locations[a.id].fix,
          }
        : null,
    people,
    serverTime: now,
  };
}
export function mutateLocation(
  s: HubState,
  a: HubActor,
  b: Record<string, unknown>,
  now = Date.now(),
) {
  const op = b.action;
  s.locations ??= {};
  s.locationVersions ??= {};
  const current = s.locations[a.id];
  if (op === "point") {
    if (!current || current.grant !== b.grant || current.expires <= now)
      throw new HubError(
        "Sharing has stopped or changed. Start a new sharing session if you want to share again.",
        409,
      );
    if (
      a.role === "child" &&
      (!s.childSettings?.locationAllowed ||
        s.child?.credentialVersion !== current.credential)
    )
      throw new HubError(
        "A parent needs to allow location sharing first.",
        403,
      );
    const f = b.fix as LocationFix;
    if (
      !f ||
      ![f.latitude, f.longitude, f.accuracy, f.capturedAt].every(
        (v) => typeof v === "number" && Number.isFinite(v),
      ) ||
      Math.abs(f.latitude) > 90 ||
      Math.abs(f.longitude) > 180 ||
      f.accuracy < 0 ||
      f.accuracy > 100000 ||
      f.capturedAt > now + 60000 ||
      f.capturedAt < now - 300000
    )
      throw new HubError(
        "This location is invalid or too old. Wait for a fresh GPS fix.",
      );
    if (current.fix && f.capturedAt < current.fix.capturedAt)
      throw new HubError("A newer location is already saved.", 409);
    if (current.fix && f.capturedAt === current.fix.capturedAt) {
      if (
        f.latitude !== current.fix.latitude ||
        f.longitude !== current.fix.longitude ||
        f.accuracy !== current.fix.accuracy
      )
        throw new HubError("A newer location is already saved.", 409);
      return false;
    }
    if (!preferFix(current.fix, f, now)) return false;
    current.fix = {
      latitude: f.latitude,
      longitude: f.longitude,
      accuracy: f.accuracy,
      capturedAt: f.capturedAt,
    };
    return true;
  }
  if (typeof b.key !== "string" || !/^[a-zA-Z0-9_-]{16,100}$/.test(b.key))
    throw new HubError("Retry this action from the location screen.");
  const key = a.id + ":location:" + b.key,
    signature = JSON.stringify({
      action: op,
      version: b.version,
      hours: b.hours,
    });
  if (s.requests[key]) {
    if (s.requests[key] !== signature)
      throw new HubError("This retry changed. Please try again.", 409);
    return false;
  }
  if (b.version !== (s.locationVersions[a.id] ?? 0))
    throw new HubError(
      "Location sharing changed. Load its current status before trying again.",
      409,
    );
  if (op === "start") {
    if (
      a.role === "child" &&
      (!s.childSettings?.locationAllowed || !s.child?.enabled)
    )
      throw new HubError(
        "A parent needs to allow location sharing first.",
        403,
      );
    if (b.consent !== true || ![1, 8, 24].includes(Number(b.hours)))
      throw new HubError(
        "Choose a sharing duration and confirm that you want to share this device's location.",
      );
    s.locations[a.id] = {
      grant: randomUUID(),
      expires: now + Number(b.hours) * 3600000,
      startedAt: now,
      ...(a.role === "child" ? { credential: s.child!.credentialVersion } : {}),
    };
  } else if (op === "stop") {
    delete s.locations[a.id];
  } else throw new HubError("Location action not found.", 404);
  s.locationVersions[a.id] = (s.locationVersions[a.id] ?? 0) + 1;
  s.requests[key] = signature;
  return true;
}
