import { createHash, randomUUID } from "node:crypto";
import {
  defaultAppearance,
  type HubState,
  type HubActor,
  type HubItem,
  type Award,
  type Appearance,
  type Profile,
} from "./hub-types";
export class HubError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function text(v: unknown, max: number, required = false) {
  if (
    typeof v !== "string" ||
    v.length > max ||
    (required && !v.trim()) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v)
  )
    throw new HubError(
      `Enter ${required ? "the required " : ""}text, up to ${max} characters.`,
    );
  return v.trim();
}
export function appearance(v: unknown): Appearance {
  const p = v as Appearance;
  if (
    !p ||
    !["forest", "ocean", "sunset", "berry"].includes(p.theme) ||
    !["friendly", "simple", "editorial"].includes(p.font) ||
    typeof p.background !== "string" ||
    !/^(plain|confetti|waves|photo:[a-f0-9-]{36})$/.test(p.background) ||
    typeof p.largeText !== "boolean" ||
    typeof p.reduceMotion !== "boolean"
  )
    throw new HubError("Choose valid appearance settings.");
  return {
    theme: p.theme,
    font: p.font,
    background: p.background,
    largeText: p.largeText,
    reduceMotion: p.reduceMotion,
  };
}
export const profileFor = (s: HubState, a: HubActor): Profile =>
  s.profiles[a.id] ?? {
    name: a.name,
    about: "",
    avatar: "🌟",
    appearance: { ...defaultAppearance },
    version: 0,
  };
export const balanceFor = (s: HubState, awards: Award[]) =>
  awards.filter((a) => a.active).length +
  s.recognitions.reduce((n, r) => n + r.stars, 0) -
  s.redemptions
    .filter((r) => r.status === "approved")
    .reduce((n, r) => n + r.cost, 0);
function integer(v: unknown, min: number, max: number) {
  if (!Number.isSafeInteger(v) || Number(v) < min || Number(v) > max)
    throw new HubError(`Choose a whole number from ${min} to ${max}.`);
  return Number(v);
}
function checked(v: unknown) {
  if (typeof v !== "boolean")
    throw new HubError("Choose a valid sharing setting.");
  return v;
}
export function mutateHub(
  s: HubState,
  a: HubActor,
  op: string,
  b: Record<string, unknown>,
  awards: Award[],
) {
  if (typeof b.key !== "string" || !/^[a-zA-Z0-9_-]{16,100}$/.test(b.key))
    throw new HubError("Please retry this action from the app.");
  const fingerprintBody: Record<string, unknown> = { op, ...b };
  delete fingerprintBody.passwordHash;
  const requestKey = a.id + ":" + b.key,
    fingerprint = createHash("sha256")
      .update(JSON.stringify(fingerprintBody))
      .digest("hex");
  if (s.requests[requestKey]) {
    if (s.requests[requestKey] !== fingerprint)
      throw new HubError(
        "This retry changed. Please try again with a new action.",
        409,
      );
    return false;
  }
  if (a.role === "child" && op !== "requestReward" && op !== "profile")
    throw new HubError("A parent needs to do that.", 403);
  const base = (): HubItem => ({
    id: randomUUID(),
    version: 1,
    by: a.id,
    actor: profileFor(s, a).name,
    at: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const find = <T extends HubItem>(items: T[]): T => {
    const item = items.find((x) => x.id === b.id);
    if (!item) throw new HubError("This item wasn't found.", 404);
    if (b.version !== item.version)
      throw new HubError(
        "This item changed. Your draft is kept; load its latest details before saving.",
        409,
      );
    return item;
  };
  const touch = (item: HubItem) => {
    item.version++;
    item.updatedAt = new Date().toISOString();
  };
  if (op === "message") {
    s.messages.push({ ...base(), text: text(b.text, 2000, true) });
  } else if (op === "profile") {
    const old = profileFor(s, a);
    if (b.version !== old.version)
      throw new HubError(
        "Your profile changed. Load the latest settings.",
        409,
      );
    const p = appearance(b.appearance);
    if (
      p.background.startsWith("photo:") &&
      !s.photos.some(
        (x) =>
          x.id === p.background.slice(6) &&
          (a.role === "parent" || x.childVisible),
      )
    )
      throw new HubError("Choose a photo you can access.");
    s.profiles[a.id] = {
      name: a.role === "child" ? a.name : text(b.name, 80, true),
      about: text(b.about, 300),
      avatar: text(b.avatar, 8, true),
      appearance: p,
      version: old.version + 1,
    };
  } else if (op === "resource") {
    const url = text(b.url, 1000);
    if (url) {
      try {
        if (new URL(url).protocol !== "https:") throw Error();
      } catch {
        throw new HubError(
          "Use a complete HTTPS link, or leave the link blank.",
        );
      }
    }
    if (!["parents", "child"].includes(String(b.audience)))
      throw new HubError("Choose who can see this resource.");
    const data = {
      title: text(b.title, 160, true),
      details: text(b.details, 4000),
      url,
      audience: b.audience as "parents" | "child",
    };
    if (!data.details && !url)
      throw new HubError("Add some guidance or a resource link.");
    if (b.id) {
      const item = find(s.resources);
      Object.assign(item, data);
      touch(item);
    } else s.resources.push({ ...base(), ...data });
  } else if (op === "contact") {
    const data = {
      name: text(b.name, 120, true),
      role: text(b.role, 120),
      phone: text(b.phone, 60),
      email: text(b.email, 254),
      note: text(b.note, 2000),
      childVisible: checked(b.childVisible),
      important: checked(b.important),
    };
    if (data.phone && !/^[+\d\s().#*xX-]+$/.test(data.phone))
      throw new HubError(
        "Enter a phone number with digits and an optional extension.",
      );
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))
      throw new HubError("Enter a valid email address.");
    if (!data.phone && !data.email)
      throw new HubError("Add a phone number or email address.");
    if (b.id) {
      const item = find(s.contacts);
      Object.assign(item, data);
      touch(item);
    } else s.contacts.push({ ...base(), ...data });
  } else if (op === "photo") {
    const data = {
      caption: text(b.caption, 300),
      childVisible: checked(b.childVisible),
    };
    if (b.id) {
      const item = find(s.photos);
      Object.assign(item, data);
      touch(item);
    } else {
      if (
        typeof b.file !== "string" ||
        typeof b.uploadId !== "string" ||
        !["image/png", "image/jpeg"].includes(String(b.mime))
      )
        throw new HubError("Choose a JPEG or PNG photo first.");
      if (s.photos.some((x) => x.uploadId === b.uploadId))
        throw new HubError("This photo is already in the gallery.", 409);
      s.photos.push({
        ...base(),
        ...data,
        file: b.file,
        mime: String(b.mime),
        uploadId: b.uploadId,
      });
    }
  } else if (op === "delete") {
    if (!["photos", "resources", "contacts"].includes(String(b.collection)))
      throw new HubError("Choose an item to remove.");
    const collection = b.collection as "photos" | "resources" | "contacts";
    const item = find<HubItem>(s[collection]);
    s[collection].splice(
      s[collection].findIndex((x) => x.id === item.id),
      1,
    );
  } else if (op === "exercise") {
    if (b.id) {
      const item = find(s.exercises);
      const previous = item.answers[a.id] ?? "";
      item.answers[a.id] = text(b.answer, 2000);
      const plan = text(b.plan, 2000);
      if (item.plan !== plan || item.answers[a.id] !== previous)
        item.approvals = [];
      item.plan = plan;
      touch(item);
    } else {
      s.exercises.push({
        ...base(),
        question: text(b.question, 300, true),
        answers: { [a.id]: text(b.answer, 2000) },
        plan: text(b.plan, 2000),
        approvals: [],
      });
    }
  } else if (op === "approvePlan") {
    const item = find(s.exercises);
    if (!item.plan.trim())
      throw new HubError("Write a shared plan before agreeing to it.");
    if (!item.approvals.includes(a.id)) item.approvals.push(a.id);
    touch(item);
  } else if (op === "goal") {
    const data = {
      title: text(b.title, 160, true),
      cost: integer(b.cost, 1, 10000),
      archived: checked(b.archived),
    };
    if (b.id) {
      const item = find(s.goals);
      Object.assign(item, data);
      touch(item);
    } else s.goals.push({ ...base(), ...data });
  } else if (op === "recognition")
    s.recognitions.push({
      ...base(),
      text: text(b.text, 500, true),
      stars: integer(b.stars, 0, 100),
    });
  else if (op === "requestReward") {
    const goal = s.goals.find((g) => g.id === b.goal && !g.archived);
    if (!goal) throw new HubError("This reward is no longer available.", 404);
    if (balanceFor(s, awards) < goal.cost)
      throw new HubError(
        "Keep going! You need a few more stars for this reward.",
        409,
      );
    if (
      s.redemptions.some((r) => r.goal === goal.id && r.status === "requested")
    )
      throw new HubError("This reward is already waiting for a parent.", 409);
    s.redemptions.push({
      ...base(),
      goal: goal.id,
      title: goal.title,
      cost: goal.cost,
      status: "requested",
    });
  } else if (op === "decideReward") {
    const item = find(s.redemptions);
    if (item.status !== "requested")
      throw new HubError("This reward has already been reviewed.", 409);
    if (!["approved", "declined"].includes(String(b.status)))
      throw new HubError("Choose approve or decline.");
    if (b.status === "approved" && balanceFor(s, awards) < item.cost)
      throw new HubError(
        "There are not enough unspent stars for this reward.",
        409,
      );
    item.status = b.status as "approved" | "declined";
    item.decidedBy = profileFor(s, a).name;
    item.decidedAt = new Date().toISOString();
    touch(item);
  } else if (op === "childAccount") {
    const username = text(b.username, 40, true).toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{3,39}$/.test(username))
      throw new HubError(
        "Use a unique child username of 4–40 letters, numbers, underscores or hyphens.",
      );
    if (b.version !== (s.child?.credentialVersion ?? ""))
      throw new HubError(
        "The child account changed. Reload before trying again.",
        409,
      );
    if (typeof b.passwordHash !== "string")
      throw new HubError("Enter a new password to save the child account.");
    s.child = {
      id: s.child?.id ?? randomUUID(),
      username,
      passwordHash: b.passwordHash,
      credentialVersion: randomUUID(),
      enabled: checked(b.enabled),
    };
  } else throw new HubError("This action wasn't found.", 404);
  s.requests[requestKey] = fingerprint;
  return true;
}
