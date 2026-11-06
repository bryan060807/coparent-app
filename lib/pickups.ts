import { randomUUID } from "node:crypto";
import { db, type User } from "./db";
import type { Pickup, PickupDetail, PickupEvent } from "./pickup-types";

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const select =
  "SELECT p.id,p.title,p.scheduled_at,p.location,p.assignee,u.name AS assignee_name,p.note,p.status,p.version,p.created_at,p.updated_at FROM pickups p JOIN users u ON p.assignee=u.id";
function pickup(id: string, user: User) {
  return db
    .prepare(select + " WHERE p.id=? AND p.household=?")
    .get(id, user.household) as Pickup | undefined;
}
function detail(item: Pickup): PickupDetail {
  const events = db
    .prepare(
      "SELECT e.id,u.name AS actor,e.action,e.at,e.snapshot FROM pickup_events e JOIN users u ON e.actor=u.id WHERE e.pickup=? ORDER BY e.id",
    )
    .all(item.id) as {
    id: number;
    actor: string;
    action: PickupEvent["action"];
    at: string;
    snapshot: string;
  }[];
  return {
    ...item,
    events: events.map((e) => ({
      ...e,
      snapshot: JSON.parse(e.snapshot) as Pickup,
    })),
  };
}
export function getPickups(parts: string[], user: User) {
  if (parts.length === 1)
    return json(
      db
        .prepare(
          select +
            " WHERE p.household=? ORDER BY p.scheduled_at,p.created_at,p.id",
        )
        .all(user.household),
    );
  const item = pickup(parts[1], user);
  if (!item) return json({ error: "Pickup not found." }, 404);
  if (parts.length === 3 && parts[2] === "timeline")
    return json(detail(item).events);
  if (parts.length !== 2) return json({ error: "Not found." }, 404);
  return json(detail(item));
}
export async function savePickup(req: Request, parts: string[], user: User) {
  if (parts.length > 2) return json({ error: "Not found." }, 404);
  // Check access before reading a mutation body or acknowledging a retry.
  if (parts[1] && !pickup(parts[1], user))
    return json({ error: "Pickup not found." }, 404);
  let body;
  try {
    body = await req.json();
  } catch {
    return json(
      { error: "Could not read this pickup. Please try again." },
      400,
    );
  }
  if (
    !body ||
    typeof body !== "object" ||
    typeof body.key !== "string" ||
    !body.key ||
    body.key.length > 100
  )
    return json(
      { error: "Invalid request. Please reopen the pickup and try again." },
      400,
    );
  const action = parts[1] ? body.action : "created";
  if (
    !["created", "edit", "complete", "cancel"].includes(action) ||
    (parts[1] && action === "created")
  )
    return json({ error: "Choose a valid pickup action." }, 400);
  if (parts[1] && (!Number.isInteger(body.version) || body.version < 1))
    return json({ error: "Reopen the pickup before saving changes." }, 400);
  const changes = action === "created" || action === "edit";
  let title = "",
    location = "",
    note = "",
    scheduledAt = "";
  if (changes) {
    if (
      typeof body.title !== "string" ||
      !body.title.trim() ||
      body.title.trim().length > 160 ||
      typeof body.location !== "string" ||
      !body.location.trim() ||
      body.location.trim().length > 200 ||
      typeof body.note !== "string" ||
      body.note.length > 500
    )
      return json(
        {
          error:
            "Enter a title (up to 160 characters), a location (up to 200), and a note under 500 characters.",
        },
        400,
      );
    if (
      typeof body.scheduled_at !== "string" ||
      !Number.isFinite(Date.parse(body.scheduled_at)) ||
      new Date(body.scheduled_at).toISOString() !== body.scheduled_at
    )
      return json({ error: "Choose a valid pickup date and time." }, 400);
    if (
      typeof body.assignee !== "string" ||
      !db
        .prepare("SELECT id FROM users WHERE id=? AND household=?")
        .get(body.assignee, user.household)
    )
      return json({ error: "Choose a parent in your household." }, 400);
    title = body.title.trim();
    location = body.location.trim();
    note = body.note.trim();
    scheduledAt = body.scheduled_at;
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const retry = db
      .prepare(
        "SELECT e.pickup FROM pickup_events e JOIN pickups p ON p.id=e.pickup WHERE e.actor=? AND e.request_key=? AND p.household=?",
      )
      .get(user.id, body.key, user.household) as { pickup: string } | undefined;
    if (retry) {
      db.exec("COMMIT");
      if (parts[1] && parts[1] !== retry.pickup)
        return json(
          { error: "This request was already used for another pickup." },
          409,
        );
      return json(detail(pickup(retry.pickup, user)!));
    }
    const id = parts[1] || randomUUID();
    const current = parts[1] ? pickup(id, user) : undefined;
    if (
      parts[1] &&
      (!current ||
        current.status !== "scheduled" ||
        current.version !== body.version)
    ) {
      db.exec("COMMIT");
      return json(
        {
          error:
            current?.status !== "scheduled"
              ? "This pickup is already finished or cancelled. It cannot be changed."
              : "The other parent changed this pickup. Your draft is kept; review the latest details before saving again.",
          current,
        },
        409,
      );
    }
    const at = new Date().toISOString();
    const eventAction =
      action === "created"
        ? "created"
        : action === "edit"
          ? "edited"
          : action === "complete"
            ? "completed"
            : "cancelled";
    if (!current) {
      db.prepare(
        "INSERT INTO pickups(id,household,title,scheduled_at,location,assignee,note,status,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'scheduled',1,?,?)",
      ).run(
        id,
        user.household,
        title,
        scheduledAt,
        location,
        body.assignee,
        note,
        at,
        at,
      );
    } else if (changes) {
      db.prepare(
        "UPDATE pickups SET title=?,scheduled_at=?,location=?,assignee=?,note=?,version=version+1,updated_at=? WHERE id=? AND household=?",
      ).run(
        title,
        scheduledAt,
        location,
        body.assignee,
        note,
        at,
        id,
        user.household,
      );
    } else {
      db.prepare(
        "UPDATE pickups SET status=?,version=version+1,updated_at=? WHERE id=? AND household=?",
      ).run(eventAction, at, id, user.household);
    }
    const updated = pickup(id, user)!;
    db.prepare(
      "INSERT INTO pickup_events(pickup,actor,action,at,snapshot,request_key,version) VALUES(?,?,?,?,?,?,?)",
    ).run(
      id,
      user.id,
      eventAction,
      at,
      JSON.stringify(updated),
      body.key,
      updated.version,
    );
    db.exec("COMMIT");
    return json(detail(updated), current ? 200 : 201);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
