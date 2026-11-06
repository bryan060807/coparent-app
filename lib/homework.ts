import { randomUUID } from "node:crypto";
import { db, type User } from "./db";
import type { Homework, HomeworkDetail, HomeworkEvent } from "./homework-types";
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
function assignment(id: string, user: User) {
  return db
    .prepare(
      "SELECT id,title,due,status,note,version,created_at,updated_at FROM homework WHERE id=? AND household=?",
    )
    .get(id, user.household) as Homework | undefined;
}
function detail(item: Homework): HomeworkDetail {
  const rows = db
    .prepare(
      "SELECT e.id,u.name AS actor,e.action,e.at,e.snapshot FROM homework_events e JOIN users u ON e.actor=u.id WHERE e.homework=? ORDER BY e.id",
    )
    .all(item.id) as {
    id: number;
    actor: string;
    action: HomeworkEvent["action"];
    at: string;
    snapshot: string;
  }[];
  return {
    ...item,
    events: rows.map((e) => ({
      ...e,
      snapshot: JSON.parse(e.snapshot) as Homework,
    })),
  };
}
export function getHomework(parts: string[], user: User) {
  if (parts.length === 1)
    return json(
      db
        .prepare(
          "SELECT id,title,due,status,note,version,created_at,updated_at FROM homework WHERE household=? ORDER BY due,created_at,id",
        )
        .all(user.household),
    );
  const item = assignment(parts[1], user);
  if (!item) return json({ error: "Homework not found." }, 404);
  if (parts.length === 3 && parts[2] === "timeline")
    return json(detail(item).events);
  if (parts.length !== 2) return json({ error: "Not found." }, 404);
  return json(detail(item));
}
export async function saveHomework(req: Request, parts: string[], user: User) {
  if (parts.length > 2) return json({ error: "Not found." }, 404);
  if (parts[1] && !assignment(parts[1], user))
    return json({ error: "Homework not found." }, 404);
  let body;
  try {
    body = await req.json();
  } catch {
    return json(
      { error: "Could not read this homework. Please try again." },
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
      { error: "Invalid request. Please reopen the assignment and try again." },
      400,
    );
  const action = parts[1] ? body.action : "created";
  if (
    !["created", "edit", "note", "start", "done"].includes(action) ||
    (parts[1] && action === "created")
  )
    return json({ error: "Choose a valid homework action." }, 400);
  if (parts[1] && (!Number.isInteger(body.version) || body.version < 1))
    return json(
      { error: "Reopen this assignment before saving changes." },
      400,
    );
  if (typeof body.note !== "string" || body.note.length > 500)
    return json({ error: "Keep the handoff note under 500 characters." }, 400);
  const changes = action === "created" || action === "edit";
  if (changes) {
    if (
      typeof body.title !== "string" ||
      !body.title.trim() ||
      body.title.trim().length > 160
    )
      return json(
        { error: "Enter an assignment title up to 160 characters." },
        400,
      );
    if (
      typeof body.due !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(body.due) ||
      !Number.isFinite(Date.parse(body.due + "T12:00:00Z")) ||
      new Date(body.due + "T12:00:00Z").toISOString().slice(0, 10) !== body.due
    )
      return json({ error: "Choose a valid due date." }, 400);
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const retry = db
      .prepare(
        "SELECT e.homework FROM homework_events e JOIN homework h ON e.homework=h.id WHERE e.actor=? AND e.request_key=? AND h.household=?",
      )
      .get(user.id, body.key, user.household) as
      { homework: string } | undefined;
    if (retry) {
      if (parts[1] && parts[1] !== retry.homework) {
        db.exec("COMMIT");
        return json(
          { error: "This request was used for another assignment." },
          409,
        );
      }
      const response = detail(assignment(retry.homework, user)!);
      db.exec("COMMIT");
      return json(response);
    }
    const current = parts[1] ? assignment(parts[1], user) : undefined;
    if (
      parts[1] &&
      (!current ||
        current.version !== body.version ||
        current.status === "done")
    ) {
      db.exec("COMMIT");
      return json(
        {
          error:
            current?.status === "done"
              ? "This assignment is already done. It cannot be changed."
              : "This assignment changed in the other session. Your draft is kept; review the latest details before saving again.",
          current,
        },
        409,
      );
    }
    if (
      (action === "start" && current?.status !== "not_started") ||
      (action === "done" && current?.status !== "in_progress")
    ) {
      db.exec("COMMIT");
      return json(
        {
          error:
            action === "done"
              ? "Start the assignment before marking it done."
              : "This assignment is already in progress.",
          current,
        },
        409,
      );
    }
    const id = parts[1] || randomUUID(),
      at = new Date().toISOString();
    const eventAction: HomeworkEvent["action"] =
      action === "edit"
        ? "edited"
        : action === "note"
          ? "noted"
          : action === "start"
            ? "started"
            : action === "done"
              ? "done"
              : "created";
    if (!current)
      db.prepare(
        "INSERT INTO homework(id,household,title,due,status,note,version,created_at,updated_at) VALUES(?,?,?,?,'not_started',?,1,?,?)",
      ).run(
        id,
        user.household,
        body.title.trim(),
        body.due,
        body.note.trim(),
        at,
        at,
      );
    else if (changes)
      db.prepare(
        "UPDATE homework SET title=?,due=?,note=?,version=version+1,updated_at=? WHERE id=? AND household=?",
      ).run(
        body.title.trim(),
        body.due,
        body.note.trim(),
        at,
        id,
        user.household,
      );
    else
      db.prepare(
        "UPDATE homework SET status=?,note=?,version=version+1,updated_at=? WHERE id=? AND household=?",
      ).run(
        action === "start"
          ? "in_progress"
          : action === "done"
            ? "done"
            : current.status,
        body.note.trim(),
        at,
        id,
        user.household,
      );
    const updated = assignment(id, user)!;
    db.prepare(
      "INSERT INTO homework_events(homework,actor,action,at,snapshot,request_key,version) VALUES(?,?,?,?,?,?,?)",
    ).run(
      id,
      user.id,
      eventAction,
      at,
      JSON.stringify(updated),
      body.key,
      updated.version,
    );
    const response = detail(updated);
    db.exec("COMMIT");
    return json(response, current ? 200 : 201);
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}
