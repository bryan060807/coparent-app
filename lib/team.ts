import { db, type User } from "./db";
import { json, readJson } from "./auth";
import {
  DEFAULT_CHILD_NAME,
  personalName,
  teamName,
  type Team,
} from "./team-types";
export function getTeam(user: User): Team {
  const row = db
    .prepare(
      "SELECT t.child_name AS childName,t.version,u.name AS updatedBy,t.updated_at AS updatedAt FROM team_settings t LEFT JOIN users u ON t.updated_by=u.id WHERE t.household=?",
    )
    .get(user.household) as Omit<Team, "name"> | undefined;
  const team = row ?? {
    childName: DEFAULT_CHILD_NAME,
    version: 0,
    updatedBy: null,
    updatedAt: null,
  };
  return { ...team, name: teamName(team.childName) };
}
export async function saveTeam(req: Request, user: User) {
  let b;
  try {
    b = await readJson(req);
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
  const childName = personalName(b.childName, 40);
  if (
    !childName ||
    !Number.isInteger(b.version) ||
    Number(b.version) < 0 ||
    typeof b.key !== "string" ||
    !/^[A-Za-z0-9-]{16,100}$/.test(b.key)
  )
    return json(
      {
        error:
          "Enter a name or nickname up to 40 characters, and reopen team settings before saving.",
      },
      400,
    );
  db.exec("BEGIN IMMEDIATE");
  try {
    const prior = db
      .prepare(
        "SELECT household,child_name FROM team_events WHERE actor=? AND request_key=?",
      )
      .get(user.id, b.key) as
      { household: string; child_name: string } | undefined;
    if (prior) {
      db.exec("ROLLBACK");
      return prior.household === user.household &&
        prior.child_name === childName
        ? json(getTeam(user))
        : json(
            {
              error:
                "This save was already used. Reopen team settings and try again.",
            },
            409,
          );
    }
    const current = getTeam(user);
    if (current.version !== b.version) {
      db.exec("ROLLBACK");
      return json(
        {
          error:
            "The team name changed while you were editing. Your draft is kept; load the current name before saving.",
        },
        409,
      );
    }
    const at = new Date().toISOString(),
      version = current.version + 1;
    db.prepare(
      "INSERT INTO team_settings(household,child_name,version,updated_by,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(household) DO UPDATE SET child_name=excluded.child_name,version=excluded.version,updated_by=excluded.updated_by,updated_at=excluded.updated_at",
    ).run(user.household, childName, version, user.id, at);
    db.prepare(
      "INSERT INTO team_events(household,actor,child_name,version,request_key,at) VALUES(?,?,?,?,?,?)",
    ).run(user.household, user.id, childName, version, b.key, at);
    db.exec("COMMIT");
    return json(getTeam(user));
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
