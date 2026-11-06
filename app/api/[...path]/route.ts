import { NextRequest, NextResponse } from "next/server";
import { db, dataDir, verify, type User } from "../../../lib/db";
import { randomBytes, randomUUID } from "node:crypto";
import { writeFileSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { getPickups, savePickup } from "../../../lib/pickups";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (v: unknown, status = 200) =>
  NextResponse.json(v, { status, headers: { "Cache-Control": "no-store" } });
function user(req: NextRequest): User | undefined {
  return db
    .prepare(
      "SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>?",
    )
    .get(req.cookies.get("session")?.value || "", Date.now()) as
    User | undefined;
}
function paper(id: string, u: User) {
  return db
    .prepare("SELECT * FROM papers WHERE id=? AND household=?")
    .get(id, u.household) as Record<string, string> | undefined;
}
function members(u: User) {
  return db
    .prepare("SELECT id,name FROM users WHERE household=? ORDER BY name")
    .all(u.household);
}
export async function GET(req: NextRequest) {
  const u = user(req);
  if (!u) return json({ error: "Please sign in." }, 401);
  const parts = req.nextUrl.pathname.split("/").slice(2);
  if (parts[0] === "pickups") return getPickups(parts, u);
  if (parts[0] === "me")
    return json({ user: { id: u.id, name: u.name }, members: members(u) });
  if (parts[0] === "papers" && !parts[1])
    return json(
      db
        .prepare(
          `SELECT p.id,p.title,p.due,p.status,p.note,p.created,p.assignee,u.name AS assignee_name FROM papers p JOIN users u ON p.assignee=u.id WHERE p.household=? ORDER BY p.due ASC,p.created ASC`,
        )
        .all(u.household),
    );
  if (parts[0] === "papers" && parts[1]) {
    const p = paper(parts[1], u);
    if (!p) return json({ error: "Paper not found." }, 404);
    if (parts[2] === "attachment")
      return new NextResponse(
        readFileSync(path.join(dataDir, "attachments", p.file)),
        {
          headers: {
            "Content-Type": p.mime,
            "Content-Disposition": `inline; filename="school-paper.${p.mime === "application/pdf" ? "pdf" : p.mime === "image/png" ? "png" : "jpg"}"`,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
          },
        },
      );
    const events = db
      .prepare(
        "SELECT e.action,e.note,e.at,u.name AS actor FROM events e JOIN users u ON e.actor=u.id WHERE e.paper=? ORDER BY e.id",
      )
      .all(p.id);
    if (parts[2] === "timeline") return json(events);
    if (parts[2]) return json({ error: "Not found" }, 404);
    return json({ ...p, events, members: members(u) });
  }
  return json({ error: "Not found" }, 404);
}
export async function POST(req: NextRequest) {
  // Same-origin browser requests only, including login, to prevent cookie-based CSRF.
  // Next builds nextUrl from the bind address (0.0.0.0), which is not the
  // browser's origin. Use the actual Host, including its port, instead.
  const origin = req.headers.get("origin");
  if (origin) {
    const host = req.headers.get("host");
    let expectedOrigin: string | undefined;
    try {
      if (host)
        expectedOrigin = new URL(`${req.nextUrl.protocol}//${host}`).origin;
    } catch {
      // A missing or malformed Host must not bypass the origin check.
    }
    if (origin !== expectedOrigin)
      return json({ error: "Invalid request origin." }, 403);
  }
  const parts = req.nextUrl.pathname.split("/").slice(2);
  if (parts[0] === "login") {
    let b;
    try {
      b = await req.json();
    } catch {
      return json({ error: "Invalid sign-in request." }, 400);
    }
    if (
      !b ||
      typeof b.email !== "string" ||
      typeof b.password !== "string" ||
      b.password.length > 200
    )
      return json({ error: "Enter your email and password." }, 400);
    const u = db
      .prepare("SELECT * FROM users WHERE email=?")
      .get(b.email.toLowerCase().trim()) as
      (User & { password: string }) | undefined;
    if (!u || !verify(b.password, u.password))
      return json({ error: "Email or password is incorrect." }, 401);
    const token = randomBytes(32).toString("hex");
    db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
      token,
      u.id,
      Date.now() + 7 * 86400000,
    );
    const res = json({ ok: true });
    res.cookies.set("session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.COOKIE_SECURE === "true",
      path: "/",
      maxAge: 604800,
    });
    return res;
  }
  const u = user(req);
  if (!u) return json({ error: "Please sign in." }, 401);
  if (parts[0] === "logout") {
    db.prepare("DELETE FROM sessions WHERE token=?").run(
      req.cookies.get("session")?.value || "",
    );
    const res = json({ ok: true });
    res.cookies.delete("session");
    return res;
  }
  if (parts[0] === "pickups") return savePickup(req, parts, u);
  if (parts[0] !== "papers") return json({ error: "Not found" }, 404);
  if (!parts[1]) {
    if (Number(req.headers.get("content-length") || 0) > 11 * 1024 * 1024)
      return json(
        {
          error:
            "Choose a file smaller than 10 MB. Your other fields are kept.",
        },
        413,
      );
    let form;
    try {
      const chunks: Uint8Array[] = [];
      let total = 0;
      const reader = req.body?.getReader();
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > 11 * 1024 * 1024) {
            await reader.cancel();
            return json(
              {
                error:
                  "Choose a file smaller than 10 MB. Your other fields are kept.",
              },
              413,
            );
          }
          chunks.push(value);
        }
      }
      const body = Buffer.concat(chunks);
      form = await new Request(req.url, {
        method: "POST",
        headers: { "Content-Type": req.headers.get("content-type") || "" },
        body,
      }).formData();
    } catch {
      return json({ error: "Could not read the upload. Try again." }, 400);
    }
    const title = String(form.get("title") || "").trim(),
      due = String(form.get("due") || ""),
      assignee = String(form.get("assignee") || ""),
      key = String(form.get("key") || "");
    if (
      !title ||
      title.length > 160 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(due) ||
      !Number.isFinite(Date.parse(due + "T12:00:00Z")) ||
      new Date(due + "T12:00:00Z").toISOString().slice(0, 10) !== due ||
      !key ||
      key.length > 100
    )
      return json(
        { error: "Enter a title (up to 160 characters) and a valid due date." },
        400,
      );
    if (
      !db
        .prepare("SELECT id FROM users WHERE id=? AND household=?")
        .get(assignee, u.household)
    )
      return json({ error: "Choose a parent in your household." }, 400);
    const existing = db
      .prepare("SELECT id FROM papers WHERE creator=? AND request_key=?")
      .get(u.id, key);
    if (existing) return json(existing);
    const f = form.get("file");
    if (!(f instanceof File) || f.size === 0 || f.size > 10 * 1024 * 1024)
      return json(
        {
          error:
            "Choose an image or PDF between 1 byte and 10 MB. Your other fields are kept.",
        },
        400,
      );
    const bytes = Buffer.from(await f.arrayBuffer());
    const mime =
      bytes.subarray(0, 5).toString() === "%PDF-"
        ? "application/pdf"
        : bytes
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          ? "image/png"
          : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
            ? "image/jpeg"
            : null;
    if (!mime || f.type !== mime)
      return json(
        {
          error:
            "Unsupported file. Choose a JPEG, PNG, or PDF; HEIC photos must be exported as JPEG. Your other fields are kept.",
        },
        400,
      );
    const id = randomUUID(),
      file = randomUUID(),
      at = new Date().toISOString();
    writeFileSync(path.join(dataDir, "attachments", file), bytes, {
      mode: 0o600,
      flag: "wx",
    });
    try {
      db.exec("BEGIN IMMEDIATE");
      db.prepare(
        "INSERT INTO papers(id,household,title,due,assignee,file,mime,original,created,creator,request_key) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        id,
        u.household,
        title,
        due,
        assignee,
        file,
        mime,
        f.name.slice(0, 200),
        at,
        u.id,
        key,
      );
      db.prepare(
        "INSERT INTO events(paper,actor,action,at) VALUES(?,?,'added',?)",
      ).run(id, u.id, at);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      unlinkSync(path.join(dataDir, "attachments", file));
      const retried = db
        .prepare("SELECT id FROM papers WHERE creator=? AND request_key=?")
        .get(u.id, key);
      if (retried) return json(retried);
      throw e;
    }
    return json({ id }, 201);
  }
  const p = paper(parts[1], u);
  if (!p) return json({ error: "Paper not found." }, 404);
  if (parts.length !== 2) return json({ error: "Not found" }, 404);
  let b;
  try {
    b = await req.json();
  } catch {
    return json({ error: "Invalid update." }, 400);
  }
  if (
    !b ||
    !["signed", "returned"].includes(b.status) ||
    typeof b.note !== "string" ||
    b.note.length > 500
  )
    return json(
      {
        error: "Choose Signed or Returned and keep notes under 500 characters.",
      },
      400,
    );
  db.exec("BEGIN IMMEDIATE");
  try {
    const current = paper(p.id, u)!;
    if (current.status === b.status) {
      db.exec("COMMIT");
      return json({ ok: true });
    }
    if (
      current.status === "returned" ||
      (b.status === "returned" && current.status !== "signed")
    ) {
      db.exec("COMMIT");
      return json(
        {
          error:
            current.status === "returned"
              ? "This paper is already returned."
              : "Mark the paper Signed before returning it.",
        },
        409,
      );
    }
    db.prepare("UPDATE papers SET status=?,note=? WHERE id=?").run(
      b.status,
      b.note.trim(),
      p.id,
    );
    db.prepare(
      "INSERT INTO events(paper,actor,action,note,at) VALUES(?,?,?,?,?)",
    ).run(p.id, u.id, b.status, b.note.trim(), new Date().toISOString());
    db.exec("COMMIT");
    return json({ ok: true });
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
