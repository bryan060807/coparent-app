import assert from "node:assert/strict";
import { emptyHub, defaultAppearance, type HubActor } from "../lib/hub-types";
import { cleanLocations, locationView, mutateLocation } from "../lib/location";
import { mutateHub } from "../lib/hub-domain";
import { randomUUID } from "node:crypto";
const s = emptyHub(),
  a: HubActor = {
    id: randomUUID(),
    household: randomUUID(),
    name: "Alex Willow",
    role: "parent",
  },
  child: HubActor = {
    id: randomUUID(),
    household: a.household,
    name: "Bill",
    role: "child",
  };
const now = Date.now(),
  key = () => randomUUID();
s.child = {
  id: child.id,
  username: "fictional-bill",
  passwordHash: "fictional",
  credentialVersion: randomUUID(),
  enabled: true,
};
const fail = (fn: () => unknown, status: number) =>
  assert.throws(fn, (e: any) => e.status === status);
fail(
  () =>
    mutateLocation(
      s,
      child,
      { action: "start", hours: 8, consent: true, version: 0, key: key() },
      now,
    ),
  403,
);
fail(
  () =>
    mutateLocation(
      s,
      a,
      { action: "start", hours: 8, consent: false, version: 0, key: key() },
      now,
    ),
  400,
);
const start = {
  action: "start",
  hours: 8,
  consent: true,
  version: 0,
  key: key(),
};
assert.equal(mutateLocation(s, a, start, now), true);
const grant = s.locations![a.id].grant;
assert.equal(mutateLocation(s, a, start, now), false);
for (const fix of [
  { latitude: 91, longitude: 0, accuracy: 10, capturedAt: now },
  { latitude: 40, longitude: Infinity, accuracy: 1, capturedAt: now },
  { latitude: 40, longitude: -87, accuracy: -1, capturedAt: now },
  { latitude: 40, longitude: -87, accuracy: 10, capturedAt: now + 120000 },
  { latitude: 40, longitude: -87, accuracy: 10, capturedAt: now - 360000 },
])
  fail(() => mutateLocation(s, a, { action: "point", grant, fix }, now), 400);
const fix = {
  latitude: 41.8827,
  longitude: -87.6233,
  accuracy: 25,
  capturedAt: now,
};
assert.equal(mutateLocation(s, a, { action: "point", grant, fix }, now), true);
assert.equal(mutateLocation(s, a, { action: "point", grant, fix }, now), false);
fail(
  () =>
    mutateLocation(
      s,
      a,
      { action: "point", grant, fix: { ...fix, capturedAt: now - 1 } },
      now,
    ),
  409,
);
const publicChild = locationView(
  s,
  child,
  [{ id: a.id, name: a.name }],
  "Bill",
  now,
);
assert.deepEqual(publicChild.people, []);
assert.equal(publicChild.own, null);
mutateLocation(s, a, { action: "stop", version: 1, key: key() }, now);
assert.equal(s.locations![a.id], undefined);
fail(() => mutateLocation(s, a, { action: "point", grant, fix }, now), 409);
assert.equal(
  mutateLocation(s, a, start, now),
  false,
  "Old start retry does not reactivate sharing",
);
assert.equal(s.locations![a.id], undefined);
fail(() => mutateLocation(s, a, { ...start, key: key() }, now), 409);
mutateHub(
  s,
  a,
  "childSettings",
  {
    version: 0,
    key: key(),
    appearance: defaultAppearance,
    locationAllowed: true,
  },
  [],
);
mutateLocation(
  s,
  child,
  { action: "start", hours: 1, consent: true, version: 0, key: key() },
  now,
);
const childGrant = s.locations![child.id].grant;
mutateLocation(s, child, { action: "point", grant: childGrant, fix }, now);
s.child.credentialVersion = randomUUID();
assert.equal(cleanLocations(s, now), true);
assert.equal(
  s.locations![child.id],
  undefined,
  "Password reset clears child sharing",
);
mutateLocation(
  s,
  child,
  {
    action: "start",
    hours: 1,
    consent: true,
    version: s.locationVersions![child.id],
    key: key(),
  },
  now,
);
mutateHub(
  s,
  a,
  "childSettings",
  {
    version: 1,
    key: key(),
    appearance: defaultAppearance,
    locationAllowed: false,
  },
  [],
);
assert.equal(s.locations![child.id], undefined);
mutateLocation(
  s,
  a,
  {
    action: "start",
    hours: 1,
    consent: true,
    version: s.locationVersions![a.id],
    key: key(),
  },
  now,
);
mutateLocation(
  s,
  a,
  { action: "point", grant: s.locations![a.id].grant, fix },
  now,
);
assert.equal(cleanLocations(s, now + 3600001), true);
assert.equal(s.locations![a.id], undefined);
const profileState = emptyHub();
profileState.child = s.child;
profileState.childSettings = {
  appearance: { ...defaultAppearance, theme: "mint" },
  version: 1,
  locationAllowed: false,
};
profileState.profiles[child.id] = {
  name: "Bill",
  avatar: "🌟",
  about: "",
  appearance: { ...defaultAppearance, theme: "berry" },
  version: 0,
  settingsVersion: 1,
  inheritChildAppearance: true,
};
mutateHub(
  profileState,
  child,
  "profile",
  { version: 0, key: key(), avatar: "🚀", about: "I like stories." },
  [],
);
assert.equal(
  profileState.profiles[child.id].appearance.theme,
  "berry",
  "Profile edits preserve a child's personal appearance even while inheriting family defaults",
);
console.log(
  "PASS: explicit location consent, guardian permission, coordinate validation, stale/duplicate fixes, stop/replay protection, password-reset revocation, expiry, and child map privacy.",
);
