import { createHash, randomBytes, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db, hash, verify, type User } from "./db";
import { personalName } from "./team-types";
export const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const sessionKey = (token: string) => "sha256:" + tokenHash(token);
export function currentUser(req: NextRequest): User | undefined {
  const token = req.cookies.get("session")?.value ?? "";
  if (!/^[a-f0-9]{64}$/.test(token)) return;
  // Existing development sessions remain valid until their usual expiry.
  return db
    .prepare(
      "SELECT u.id,u.household,u.name,u.email FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token IN (?,?) AND s.expires>?",
    )
    .get(sessionKey(token), token, Date.now()) as User | undefined;
}
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const reader = req.body?.getReader();
  if (!reader) throw Error("Enter the form details.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 8192) {
      await reader.cancel();
      throw Error("The form is too large. Keep each field within its limit.");
    }
    chunks.push(value);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw Error();
    return body;
  } catch {
    throw Error("Enter valid form details.");
  }
}
function emailAddress(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 254) return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ? email : null;
}
function limited(action: string, email: string) {
  const key = tokenHash(action + ":" + email);
  const now = Date.now();
  db.prepare("DELETE FROM auth_limits WHERE window_start<?").run(now - 900000);
  const row = db
    .prepare(
      "INSERT INTO auth_limits(key,window_start,attempts) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 RETURNING attempts",
    )
    .get(key, now) as { attempts: number };
  return row.attempts > 10;
}
function signedIn(userId: string, status = 200) {
  const token = randomBytes(32).toString("hex");
  db.prepare("DELETE FROM sessions WHERE expires<=?").run(Date.now());
  db.prepare("INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)").run(
    sessionKey(token),
    userId,
    Date.now() + 7 * 86400000,
  );
  const res = json({ ok: true }, status);
  res.cookies.set("session", token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge: 604800,
  });
  return res;
}
// Match the password work for an unknown address without storing a real password.
const dummyHash = hash(randomBytes(32).toString("hex"));
export async function signIn(req: NextRequest) {
  let b;
  try {
    b = await readJson(req);
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
  const email = emailAddress(b.email);
  if (
    !email ||
    typeof b.password !== "string" ||
    !b.password ||
    b.password.length > 200
  )
    return json({ error: "Enter your email and password." }, 400);
  if (limited("login", email))
    return json(
      {
        error:
          "Too many sign-in attempts for this address. Try again in 15 minutes.",
      },
      429,
    );
  const user = db
    .prepare("SELECT id,password FROM users WHERE email=?")
    .get(email) as { id: string; password: string } | undefined;
  const correct = verify(b.password, user?.password ?? dummyHash);
  if (!user || !correct)
    return json({ error: "Email or password is incorrect." }, 401);
  db.prepare("DELETE FROM auth_limits WHERE key=?").run(
    tokenHash("login:" + email),
  );
  return signedIn(user.id);
}
export async function signUp(req: NextRequest) {
  let b;
  try {
    b = await readJson(req);
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
  const email = emailAddress(b.email),
    name = personalName(b.name, 80);
  if (
    !email ||
    !name ||
    typeof b.password !== "string" ||
    b.password.length < 12 ||
    b.password.length > 200
  )
    return json(
      {
        error:
          "Enter your name (up to 80 characters), a valid email, and a password of 12–200 characters.",
      },
      400,
    );
  if (b.mode !== "create" && b.mode !== "join")
    return json({ error: "Choose whether to create or join a team." }, 400);
  const childName = personalName(b.childName, 40);
  const code = typeof b.invite === "string" ? b.invite.trim() : "";
  if (b.mode === "create" && !childName)
    return json(
      { error: "Enter your child's name or nickname, up to 40 characters." },
      400,
    );
  if (b.mode === "join" && !/^[A-Za-z0-9_-]{24}$/.test(code))
    return json(
      { error: "Enter the invitation code shared by the other parent." },
      400,
    );
  if (limited("signup", email))
    return json(
      {
        error:
          "Too many account attempts for this address. Try again in 15 minutes.",
      },
      429,
    );
  const password = hash(b.password);
  const id = randomUUID();
  db.exec("BEGIN IMMEDIATE");
  try {
    if (db.prepare("SELECT id FROM users WHERE email=?").get(email)) {
      db.exec("ROLLBACK");
      return json(
        {
          error:
            "Could not create an account with those details. If you already have an account, sign in.",
        },
        409,
      );
    }
    let household: string = randomUUID();
    if (b.mode === "join") {
      const invite = db
        .prepare(
          "SELECT household FROM household_invites WHERE token_hash=? AND expires>? AND used_by IS NULL",
        )
        .get(tokenHash(code), Date.now()) as { household: string } | undefined;
      const count =
        invite &&
        (db
          .prepare("SELECT count(*) AS n FROM users WHERE household=?")
          .get(invite.household) as { n: number } | undefined);
      if (!invite || !count || count.n >= 2) {
        db.exec("ROLLBACK");
        return json(
          {
            error:
              "This invitation is expired, already used, or unavailable. Ask the other parent for a new code.",
          },
          409,
        );
      }
      household = invite.household;
    } else {
      db.prepare("INSERT INTO households(id,name) VALUES(?,?)").run(
        household,
        "Family household",
      );
    }
    db.prepare(
      "INSERT INTO users(id,household,name,email,password) VALUES(?,?,?,?,?)",
    ).run(id, household, name, email, password);
    if (b.mode === "create") {
      db.prepare(
        "INSERT INTO team_settings(household,child_name,version,updated_by,updated_at) VALUES(?,?,1,?,?)",
      ).run(household, childName!, id, new Date().toISOString());
    } else {
      db.prepare(
        "UPDATE household_invites SET used_by=? WHERE token_hash=?",
      ).run(id, tokenHash(code));
    }
    // Create the session in the same transaction as the account and invite claim.
    const response = signedIn(id, 201);
    db.exec("COMMIT");
    return response;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function signOut(req: NextRequest) {
  const token = req.cookies.get("session")?.value ?? "";
  db.prepare("DELETE FROM sessions WHERE token IN (?,?)").run(
    sessionKey(token),
    token,
  );
  const res = json({ ok: true });
  res.cookies.delete("session");
  return res;
}
export function createInvitation(user: User) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const count = db
      .prepare("SELECT count(*) AS n FROM users WHERE household=?")
      .get(user.household) as { n: number };
    if (count.n >= 2) {
      db.exec("ROLLBACK");
      return json(
        { error: "Both parent places on this team are filled." },
        409,
      );
    }
    const code = randomBytes(18).toString("base64url");
    const expires = Date.now() + 72 * 3600000;
    db.prepare(
      "DELETE FROM household_invites WHERE household=? AND used_by IS NULL",
    ).run(user.household);
    db.prepare(
      "INSERT INTO household_invites(token_hash,household,created_by,expires) VALUES(?,?,?,?)",
    ).run(tokenHash(code), user.household, user.id, expires);
    db.exec("COMMIT");
    return json({ code, expires }, 201);
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
