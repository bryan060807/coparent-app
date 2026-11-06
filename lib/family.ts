import { randomUUID } from "node:crypto";
import { db, type User } from "./db";
import type {
  FamilyKind,
  FamilyData,
  FamilyRecord,
  FamilyContext,
  FamilyEvent,
  DailyCheck,
  GiftData,
  RoutineData,
} from "./family-types";
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const kinds = ["gifts", "routines", "info"];
type Row = {
  id: string;
  kind: FamilyKind;
  data: string;
  archived: number;
  version: number;
  created_at: string;
  updated_at: string;
};
function validDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + "T12:00:00Z")) &&
    new Date(value + "T12:00:00Z").toISOString().slice(0, 10) === value
  );
}
function text(value: unknown, max: number, required = false): value is string {
  return (
    typeof value === "string" &&
    value.length <= max &&
    (!required || !!value.trim())
  );
}
function validate(kind: FamilyKind, value: unknown, user: User): FamilyData {
  if (!value || typeof value !== "object")
    throw Error("Enter the details for this record.");
  const d = value as Record<string, unknown>;
  if (!text(d.title, 160, true))
    throw Error("Enter a title up to 160 characters.");
  const title = d.title.trim();
  if (kind === "gifts") {
    if (
      typeof d.type !== "string" ||
      !["gift", "money_in", "money_out"].includes(d.type) ||
      !validDate(d.date) ||
      !text(d.from, 120) ||
      !text(d.occasion, 120) ||
      !text(d.note, 500) ||
      typeof d.thankYou !== "boolean"
    )
      throw Error(
        "Choose a gift/money type, a valid date, and keep names/occasions under 120 characters and notes under 500.",
      );
    if (
      d.amountCents !== null &&
      (!Number.isSafeInteger(d.amountCents) ||
        Number(d.amountCents) < 0 ||
        Number(d.amountCents) > 100000000)
    )
      throw Error(
        "Enter a USD amount with at most two decimal places, up to $1,000,000.",
      );
    if (
      d.type !== "gift" &&
      (d.amountCents === null || Number(d.amountCents) <= 0)
    )
      throw Error("Money received or spent needs an amount greater than zero.");
    return {
      title,
      type: d.type as GiftData["type"],
      date: d.date,
      from: d.from.trim(),
      occasion: d.occasion.trim(),
      amountCents: d.amountCents as number | null,
      thankYou: d.type === "money_out" ? false : d.thankYou,
      note: d.note.trim(),
    };
  }
  if (kind === "routines") {
    if (
      typeof d.type !== "string" ||
      !["routine", "chore"].includes(d.type) ||
      !Array.isArray(d.days) ||
      d.days.length < 1 ||
      d.days.length > 7 ||
      d.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6) ||
      new Set(d.days).size !== d.days.length ||
      !text(d.note, 500) ||
      !text(d.time, 5) ||
      (d.time !== "" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(d.time))
    )
      throw Error(
        "Choose at least one weekday, a valid time (or leave it blank), and a note under 500 characters.",
      );
    if (
      typeof d.home !== "string" ||
      (d.home !== "both" &&
        !db
          .prepare("SELECT id FROM users WHERE id=? AND household=?")
          .get(d.home, user.household))
    )
      throw Error("Choose both homes or a parent in your household.");
    return {
      title,
      type: d.type as RoutineData["type"],
      days: [...d.days].sort(),
      time: d.time,
      home: d.home,
      note: d.note.trim(),
    };
  }
  if (
    typeof d.category !== "string" ||
    !["health", "personal", "emergency", "school", "other"].includes(
      d.category,
    ) ||
    !text(d.details, 4000, true) ||
    typeof d.important !== "boolean"
  )
    throw Error("Choose a category and enter details up to 4,000 characters.");
  return {
    title,
    category: d.category as
      "health" | "personal" | "emergency" | "school" | "other",
    details: d.details.trim(),
    important: d.important,
  };
}
function context(user: User): FamilyContext {
  const setting = db
    .prepare("SELECT timezone,version FROM family_settings WHERE household=?")
    .get(user.household) as { timezone: string; version: number } | undefined;
  const timezone = setting?.timezone ?? "America/Chicago";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (name: string) => parts.find((p) => p.type === name)!.value;
  const day = `${get("year")}-${get("month")}-${get("day")}`;
  return {
    day,
    weekday: new Date(day + "T12:00:00Z").getUTCDay(),
    timezone,
    timezoneVersion: setting?.version ?? 0,
  };
}
function row(id: string, kind: FamilyKind, user: User) {
  return db
    .prepare(
      "SELECT id,kind,data,archived,version,created_at,updated_at FROM family_records WHERE id=? AND kind=? AND household=?",
    )
    .get(id, kind, user.household) as Row | undefined;
}
function hydrate(r: Row, ctx: FamilyContext): FamilyRecord {
  const item: FamilyRecord = {
    ...r,
    data: JSON.parse(r.data) as FamilyData,
    archived: !!r.archived,
  };
  if (r.kind === "routines") {
    const check = db
      .prepare(
        "SELECT c.day,c.checked,c.version,u.name AS actor,c.at FROM routine_checks c JOIN users u ON c.actor=u.id WHERE c.record=? AND c.day=?",
      )
      .get(r.id, ctx.day) as
      (Omit<DailyCheck, "checked"> & { checked: number }) | undefined;
    item.check = check
      ? { ...check, checked: !!check.checked }
      : { day: ctx.day, checked: false, version: 0, actor: null, at: null };
    item.scheduledToday = (item.data as RoutineData).days.includes(ctx.weekday);
  }
  return item;
}
function detail(r: Row, ctx: FamilyContext) {
  const events = db
    .prepare(
      "SELECT e.id,e.action,e.at,u.name AS actor,e.snapshot FROM family_events e JOIN users u ON e.actor=u.id WHERE e.record=? ORDER BY e.id",
    )
    .all(r.id) as {
    id: number;
    action: string;
    at: string;
    actor: string;
    snapshot: string;
  }[];
  const checks =
    r.kind === "routines"
      ? (db
          .prepare(
            "SELECT c.day,c.checked,c.version,u.name AS actor,c.at FROM routine_checks c JOIN users u ON c.actor=u.id WHERE c.record=? ORDER BY c.day DESC LIMIT 30",
          )
          .all(r.id) as (Omit<DailyCheck, "checked"> & { checked: number })[])
      : [];
  return {
    record: hydrate(r, ctx),
    context: ctx,
    events: events.map((e) => ({
      ...e,
      snapshot: JSON.parse(e.snapshot) as FamilyEvent["snapshot"],
    })),
    checks: checks.map((c) => ({ ...c, checked: !!c.checked })),
  };
}
export function getFamily(parts: string[], user: User) {
  const kind = parts[1] as FamilyKind;
  if (!kinds.includes(kind)) return json({ error: "Not found." }, 404);
  const ctx = context(user);
  if (parts.length === 2) {
    const rows = db
      .prepare(
        "SELECT id,kind,data,archived,version,created_at,updated_at FROM family_records WHERE household=? AND kind=? ORDER BY created_at,id",
      )
      .all(user.household, kind) as Row[];
    const records = rows.map((r) => hydrate(r, ctx));
    let receivedCents = 0,
      spentCents = 0;
    if (kind === "gifts")
      for (const item of records) {
        if (item.archived) continue;
        const d = item.data as GiftData;
        if (d.type === "money_in") receivedCents += d.amountCents!;
        if (d.type === "money_out") spentCents += d.amountCents!;
      }
    return json({
      records,
      context: ctx,
      ...(kind === "gifts"
        ? {
            totals: {
              receivedCents,
              spentCents,
              balanceCents: receivedCents - spentCents,
            },
          }
        : {}),
    });
  }
  const r = row(parts[2], kind, user);
  if (!r) return json({ error: "Record not found." }, 404);
  if (parts.length === 4 && parts[3] === "timeline")
    return json(detail(r, ctx).events);
  if (parts.length !== 3) return json({ error: "Not found." }, 404);
  return json(detail(r, ctx));
}
async function setTimezone(req: Request, user: User) {
  let b;
  try {
    b = await req.json();
  } catch {
    return json({ error: "Enter a valid time zone." }, 400);
  }
  if (
    !b ||
    typeof b.timezone !== "string" ||
    b.timezone.length > 100 ||
    !Number.isInteger(b.version) ||
    b.version < 0 ||
    typeof b.key !== "string" ||
    !b.key ||
    b.key.length > 100
  )
    return json(
      { error: "Enter a valid time zone and reopen settings before saving." },
      400,
    );
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: b.timezone }).format();
  } catch {
    return json(
      { error: "Enter an IANA time zone, for example America/Chicago." },
      400,
    );
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const retry = db
      .prepare(
        "SELECT household FROM family_timezone_events WHERE actor=? AND request_key=?",
      )
      .get(user.id, b.key);
    const ctx = context(user);
    if (retry) {
      db.exec("COMMIT");
      return json(ctx);
    }
    if (ctx.timezoneVersion !== b.version) {
      db.exec("COMMIT");
      return json(
        {
          error:
            "The time zone changed in another session. Reload the latest setting.",
          current: ctx,
        },
        409,
      );
    }
    db.prepare(
      "INSERT INTO family_settings(household,timezone,version) VALUES(?,?,1) ON CONFLICT(household) DO UPDATE SET timezone=excluded.timezone,version=version+1",
    ).run(user.household, b.timezone);
    db.prepare(
      "INSERT INTO family_timezone_events(household,actor,request_key,timezone,at) VALUES(?,?,?,?,?)",
    ).run(user.household, user.id, b.key, b.timezone, new Date().toISOString());
    const next = context(user);
    db.exec("COMMIT");
    return json(next);
  } catch (e) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw e;
  }
}
export async function saveFamily(req: Request, parts: string[], user: User) {
  const kind = parts[1] as FamilyKind;
  if (!kinds.includes(kind) || parts.length > 3)
    return json({ error: "Not found." }, 404);
  if (kind === "routines" && parts[2] === "timezone")
    return setTimezone(req, user);
  if (parts[2] && !row(parts[2], kind, user))
    return json({ error: "Record not found." }, 404);
  let b;
  try {
    b = await req.json();
  } catch {
    return json(
      { error: "Could not read this record. Please try again." },
      400,
    );
  }
  if (!b || typeof b.key !== "string" || !b.key || b.key.length > 100)
    return json({ error: "Reopen this form and try again." }, 400);
  const action = parts[2] ? b.action : "created";
  if (
    !["created", "edit", "archive", "restore", "check"].includes(action) ||
    (parts[2] && action === "created") ||
    (action === "check" && kind !== "routines")
  )
    return json({ error: "Choose a valid action." }, 400);
  if (parts[2] && (!Number.isInteger(b.version) || b.version < 1))
    return json({ error: "Reopen this record before saving." }, 400);
  let data: FamilyData | undefined;
  if (action === "created" || action === "edit") {
    try {
      data = validate(kind, b.data, user);
    } catch (e) {
      return json({ error: (e as Error).message }, 400);
    }
  }
  if (
    action === "check" &&
    (!validDate(b.day) ||
      typeof b.checked !== "boolean" ||
      !Number.isInteger(b.dayVersion) ||
      b.dayVersion < 0 ||
      !Number.isInteger(b.timezoneVersion) ||
      b.timezoneVersion < 0)
  )
    return json(
      { error: "Reload today’s checklist before checking this task." },
      400,
    );
  db.exec("BEGIN IMMEDIATE");
  try {
    const ctx = context(user);
    const retry = db
      .prepare(
        "SELECT e.record FROM family_events e JOIN family_records r ON e.record=r.id WHERE e.actor=? AND e.request_key=? AND r.household=? AND r.kind=?",
      )
      .get(user.id, b.key, user.household, kind) as
      { record: string } | undefined;
    if (retry) {
      if (parts[2] && retry.record !== parts[2]) {
        db.exec("COMMIT");
        return json(
          { error: "This request was already used for another record." },
          409,
        );
      }
      const response = detail(row(retry.record, kind, user)!, ctx);
      db.exec("COMMIT");
      return json(response);
    }
    const current = parts[2] ? row(parts[2], kind, user) : undefined;
    if (parts[2] && (!current || current.version !== b.version)) {
      db.exec("COMMIT");
      return json(
        {
          error:
            "The other session changed this record. Your draft is kept; review the latest details.",
          current: current ? hydrate(current, ctx) : null,
        },
        409,
      );
    }
    if (
      current &&
      (((action === "edit" || action === "check" || action === "archive") &&
        current.archived) ||
        (action === "restore" && !current.archived))
    ) {
      db.exec("COMMIT");
      return json(
        {
          error: current.archived
            ? "This record is archived. Restore it before changing it."
            : "This record is already active.",
        },
        409,
      );
    }
    const id = parts[2] || randomUUID(),
      at = new Date().toISOString();
    let event =
      action === "created"
        ? "created"
        : action === "edit"
          ? "edited"
          : action === "archive"
            ? "archived"
            : "restored";
    if (action === "check") {
      const item = hydrate(current!, ctx);
      if (
        b.day !== ctx.day ||
        b.timezoneVersion !== ctx.timezoneVersion ||
        !item.scheduledToday ||
        item.check!.version !== b.dayVersion
      ) {
        db.exec("COMMIT");
        return json(
          {
            error:
              "The day, schedule, or checkoff changed. Review today’s latest checklist before trying again.",
            current: item,
          },
          409,
        );
      }
      db.prepare(
        "INSERT INTO routine_checks(record,day,checked,version,actor,at) VALUES(?,?,?,1,?,?) ON CONFLICT(record,day) DO UPDATE SET checked=excluded.checked,version=version+1,actor=excluded.actor,at=excluded.at",
      ).run(id, ctx.day, b.checked ? 1 : 0, user.id, at);
      event = b.checked ? "checked" : "unchecked";
    } else if (!current)
      db.prepare(
        "INSERT INTO family_records(id,household,kind,data,archived,version,created_at,updated_at) VALUES(?,?,?,?,0,1,?,?)",
      ).run(id, user.household, kind, JSON.stringify(data), at, at);
    else
      db.prepare(
        "UPDATE family_records SET data=?,archived=?,version=version+1,updated_at=? WHERE id=? AND household=?",
      ).run(
        action === "edit" ? JSON.stringify(data) : current.data,
        action === "archive" ? 1 : action === "restore" ? 0 : current.archived,
        at,
        id,
        user.household,
      );
    const snapshot = {
      ...hydrate(row(id, kind, user)!, ctx),
      ...(action === "check"
        ? { day: ctx.day, checked: b.checked, timezone: ctx.timezone }
        : {}),
    };
    db.prepare(
      "INSERT INTO family_events(record,actor,action,at,snapshot,request_key) VALUES(?,?,?,?,?,?)",
    ).run(id, user.id, event, at, JSON.stringify(snapshot), b.key);
    const response = detail(row(id, kind, user)!, ctx);
    db.exec("COMMIT");
    return json(response, current ? 200 : 201);
  } catch (e) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw e;
  }
}
