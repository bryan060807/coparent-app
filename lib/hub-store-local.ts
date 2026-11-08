import { db } from "./db";
import {
  emptyHub,
  type HubState,
  type HubActor,
  type Award,
} from "./hub-types";
export async function localHub(
  action: string,
  b: Record<string, any>,
): Promise<any> {
  const h = b.household;
  if (action === "read") {
    const row = db
      .prepare("SELECT * FROM hub_state WHERE household=?")
      .get(h) as { data: string; version: number } | undefined;
    const awards = (
      db
        .prepare(
          "SELECT record,day,title,active,at FROM hub_awards WHERE household=? ORDER BY at DESC",
        )
        .all(h) as unknown as Award[]
    ).map((x) => ({ ...x, active: !!x.active }));
    const members = db
      .prepare("SELECT id,name FROM users WHERE household=? ORDER BY name")
      .all(h);
    const setting = db
      .prepare("SELECT child_name FROM team_settings WHERE household=?")
      .get(h) as { child_name: string } | undefined;
    return {
      data: row ? JSON.parse(row.data) : emptyHub(),
      version: row?.version ?? 0,
      awards,
      members,
      childName: setting?.child_name ?? "Bill",
    };
  }
  if (action === "store") {
    db.exec("BEGIN IMMEDIATE");
    try {
      const old = db
        .prepare("SELECT version FROM hub_state WHERE household=?")
        .get(h) as { version: number } | undefined;
      const earned = (
        db
          .prepare(
            "SELECT count(*) n FROM hub_awards WHERE household=? AND active=1",
          )
          .get(h) as { n: number }
      ).n;
      if ((old?.version ?? 0) !== b.version || earned !== b.earned) {
        db.exec("ROLLBACK");
        return false;
      }
      db.prepare(
        "INSERT INTO hub_state VALUES(?,?,?) ON CONFLICT(household) DO UPDATE SET version=excluded.version,data=excluded.data",
      ).run(h, b.version + 1, JSON.stringify(b.data));
      if (b.profileName)
        db.prepare("UPDATE users SET name=? WHERE id=? AND household=?").run(
          b.profileName,
          b.actor,
          h,
        );
      db.exec("COMMIT");
      return true;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  if (action === "childLookup") {
    const row = db
      .prepare(
        "SELECT household,data FROM hub_state WHERE json_extract(data,'$.child.username')=?",
      )
      .get(b.username) as { household: string; data: string } | undefined;
    return row
      ? {
          household: row.household,
          child: (JSON.parse(row.data) as HubState).child,
        }
      : null;
  }
  if (action === "limit") {
    const now = Date.now();
    db.prepare("DELETE FROM hub_limits WHERE started<?").run(now - 900000);
    const row = db
      .prepare(
        "INSERT INTO hub_limits VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 RETURNING attempts",
      )
      .get(b.key, now) as { attempts: number };
    return row.attempts <= 10;
  }
  if (action === "createSession") {
    const row = db
      .prepare("SELECT data FROM hub_state WHERE household=?")
      .get(h) as { data: string } | undefined;
    const child = row ? (JSON.parse(row.data) as HubState).child : null;
    if (
      !child?.enabled ||
      child.id !== b.child ||
      child.credentialVersion !== b.credential
    )
      return false;
    db.prepare("DELETE FROM hub_sessions WHERE expires<?").run(Date.now());
    db.prepare("INSERT INTO hub_sessions VALUES(?,?,?,?,?)").run(
      b.token,
      h,
      b.child,
      b.credential,
      Date.now() + 7 * 86400000,
    );
    return true;
  }
  if (action === "session") {
    const row = db
      .prepare(
        "SELECT s.*,h.data FROM hub_sessions s JOIN hub_state h ON h.household=s.household WHERE token=? AND expires>?",
      )
      .get(b.token, Date.now()) as
      | { household: string; child: string; credential: string; data: string }
      | undefined;
    const c = row ? (JSON.parse(row.data) as HubState).child : null;
    if (
      !row ||
      !c?.enabled ||
      c.id !== row.child ||
      c.credentialVersion !== row.credential
    )
      return null;
    const name = (await localHub("read", { household: row.household }))
      .childName;
    return {
      id: c.id,
      household: row.household,
      name,
      role: "child",
    } satisfies HubActor;
  }
  if (action === "deleteSession") {
    db.prepare("DELETE FROM hub_sessions WHERE token=?").run(b.token);
    return true;
  }
  throw Error("Unknown household store operation");
}
