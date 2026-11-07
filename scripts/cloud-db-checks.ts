import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cloudTestDatabase } from "./cloud-test-database";

const db = await cloudTestDatabase();
const a = { id: randomUUID(), session: randomUUID() },
  b = { id: randomUUID(), session: randomUUID() },
  c = { id: randomUUID(), session: randomUUID() };
try {
  for (const user of [a, b, c]) {
    await db.query("insert into auth.users values($1,$2)", [
      user.id,
      user.id + "@example.test",
    ]);
    await db.query("insert into auth.sessions values($1,$2)", [
      user.session,
      user.id,
    ]);
  }
  const as = async (
    who: typeof a | null,
    sql: string,
    values: unknown[] = [],
  ) => {
    await db.exec("begin");
    try {
      await db.exec(
        who ? "set local role authenticated" : "set local role anon",
      );
      await db.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify(
          who
            ? { sub: who.id, session_id: who.session, role: "authenticated" }
            : { role: "anon" },
        ),
      ]);
      const result = await db.query(sql, values);
      await db.exec("commit");
      return result;
    } catch (e) {
      await db.exec("rollback");
      throw e;
    }
  };
  // The Postgres RPC transport returns JSON; assertions below exercise its public contract.
  const rpc = async (
    who: typeof a | null,
    name: string,
    args: unknown[] = [],
  ): Promise<any> => {
    assert.match(name, /^app_[a-z_]+$/);
    const r = await as(
      who,
      `select ${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as value`,
      args,
    );
    return (r.rows[0] as { value: unknown }).value;
  };
  const mutate = (
    who: typeof a,
    kind: string,
    id: string | null,
    body: object,
  ) => rpc(who, "app_mutate", [kind, id, JSON.stringify(body)]);
  const read = (who: typeof a, kind: string, id: string | null = null) =>
    rpc(who, "app_read", [kind, id]);
  const fail = async (call: Promise<unknown>, code: string) => {
    await assert.rejects(call, (e: { code?: string }) => e.code === code);
  };
  assert.equal((await rpc(a, "app_me")).onboardingRequired, true);
  const me = await rpc(a, "app_onboard", [
    JSON.stringify({ mode: "create", name: "Alex Willow", childName: "Bill" }),
  ]);
  assert.equal(me.team.name, "Team Bill");
  await rpc(c, "app_onboard", [
    JSON.stringify({
      mode: "create",
      name: "Jordan Cedar",
      childName: "Robin",
    }),
  ]);
  await fail(rpc(null, "app_me"), "42501");
  await fail(
    as(a, "insert into app_profiles(id,household,name) values($1,$2,'spoof')", [
      b.id,
      randomUUID(),
    ]),
    "42501",
  );
  const invite = await rpc(a, "app_invitation");
  assert.equal(await rpc(null, "app_invite_available", [invite.code]), true);
  const joined = await rpc(b, "app_onboard", [
    JSON.stringify({
      mode: "join",
      name: "Sam Willow",
      invite: invite.code,
      household: "cedar",
    }),
  ]);
  assert.equal(joined.team.name, "Team Bill");
  assert.equal(joined.members.length, 2);
  assert.equal(await rpc(null, "app_invite_available", [invite.code]), false);
  await fail(rpc(a, "app_invitation"), "P0409");
  const profile = (
    await db.query<{ household: string }>(
      "select household from app_profiles where id=$1",
      [a.id],
    )
  ).rows[0];
  assert.equal(
    (
      await as(c, "select * from app_profiles where household=$1", [
        profile.household,
      ])
    ).rows.length,
    0,
  );
  await fail(as(a, "update app_households set child_name='Forged'"), "42501");
  const rename = {
    childName: "Bíll Rowan",
    version: me.team.version,
    key: randomUUID(),
    actor: c.id,
  };
  const named = await rpc(b, "app_settings", ["team", JSON.stringify(rename)]);
  assert.equal(named.updatedBy, "Sam Willow");
  assert.equal(named.name, "Team Bíll Rowan");
  assert.equal(
    (await rpc(b, "app_settings", ["team", JSON.stringify(rename)])).version,
    named.version,
  );
  await fail(
    rpc(a, "app_settings", [
      "team",
      JSON.stringify({ ...rename, key: randomUUID() }),
    ]),
    "P0409",
  );
  assert.equal((await rpc(c, "app_me")).team.name, "Team Robin");
  const upload = await rpc(a, "app_new_upload", [
    JSON.stringify({
      name: "permission-slip.pdf",
      mime: "application/pdf",
      size: 500,
    }),
  ]);
  await fail(rpc(b, "app_get_upload", [upload.id]), "P0404");
  await fail(
    rpc(a, "app_validate_upload", [
      upload.id,
      profile.household + "/" + upload.id,
    ]),
    "42501",
  );
  const paperBody = {
    title: "Field trip permission slip",
    due: "2060-11-12",
    assignee: b.id,
    key: randomUUID(),
    uploadId: upload.id,
  };
  await fail(mutate(a, "papers", null, paperBody), "22023");
  await db.exec("set role service_role");
  await db.query("select app_validate_upload($1,$2)", [
    upload.id,
    profile.household + "/" + upload.id,
  ]);
  await db.exec("reset role");
  const paper = await mutate(a, "papers", null, paperBody);
  assert.equal(await mutate(a, "papers", null, paperBody), paper);
  await fail(
    mutate(a, "papers", null, {
      ...paperBody,
      key: randomUUID(),
      assignee: c.id,
    }),
    "22023",
  );
  await fail(read(c, "papers", paper), "P0404");
  await fail(
    mutate(c, "papers", paper, { status: "signed", note: "unauthorized" }),
    "P0404",
  );
  await fail(
    mutate(a, "papers", paper, { status: "returned", note: "too soon" }),
    "P0409",
  );
  await mutate(b, "papers", paper, {
    status: "signed",
    note: "In the blue folder.",
    actor: a.id,
  });
  await mutate(b, "papers", paper, {
    status: "signed",
    note: "In the blue folder.",
  });
  let detail = await read(a, "papers", paper);
  assert.equal(detail.events.length, 2);
  assert.equal(detail.events[1].actor, "Sam Willow");
  assert.equal(detail.note, "In the blue folder.");
  await mutate(a, "papers", paper, {
    status: "returned",
    note: "Back at school.",
  });
  await fail(
    mutate(b, "papers", paper, { status: "signed", note: "stale" }),
    "P0409",
  );
  detail = await read(b, "papers", paper);
  assert.deepEqual(
    detail.events.map((e: any) => e.action),
    ["added", "signed", "returned"],
  );
  await db.query(
    "insert into storage.objects(bucket_id,name) values('school-papers',$1)",
    [detail.file],
  );
  assert.equal((await as(a, "select * from storage.objects")).rows.length, 1);
  assert.equal((await as(b, "select * from storage.objects")).rows.length, 1);
  assert.equal((await as(c, "select * from storage.objects")).rows.length, 0);
  await fail(as(null, "select * from storage.objects"), "42501");
  await fail(
    as(
      a,
      "insert into storage.objects(bucket_id,name) values('school-papers','forged')",
    ),
    "42501",
  );
  await fail(as(a, "update app_records set data='{}'"), "42501");
  await fail(rpc(a, "app_record_json", [paper]), "42501");
  const pickupBody = {
    title: "School pickup",
    scheduled_at: "2060-11-12T20:15:00.000Z",
    location: "Willow Primary",
    assignee: b.id,
    note: "Blue folder",
    key: randomUUID(),
  };
  const pickup = await mutate(a, "pickups", null, pickupBody);
  const p = await read(a, "pickups", pickup);
  await fail(
    mutate(a, "pickups", pickup, {
      action: "edit",
      version: p.version,
      title: "Bad",
      scheduled_at: "bad",
      location: "Gate",
      assignee: b.id,
      note: "",
      key: randomUUID(),
    }),
    "22007",
  );
  const completed = {
    action: "complete",
    version: p.version,
    key: randomUUID(),
  };
  await mutate(b, "pickups", pickup, completed);
  await mutate(b, "pickups", pickup, completed);
  assert.equal((await read(a, "pickups", pickup)).events.length, 2);
  await fail(
    mutate(a, "pickups", pickup, { ...completed, key: randomUUID() }),
    "P0409",
  );
  const homework = await mutate(a, "homework", null, {
    title: "Reading sheet",
    due: "2060-11-12",
    note: "In folder",
    key: randomUUID(),
  });
  await fail(
    mutate(a, "homework", homework, {
      action: "done",
      version: 1,
      key: randomUUID(),
      note: "",
    }),
    "P0409",
  );
  await mutate(b, "homework", homework, {
    action: "start",
    version: 1,
    key: randomUUID(),
    note: "Reading finished",
  });
  await mutate(a, "homework", homework, {
    action: "done",
    version: 2,
    key: randomUUID(),
    note: "All finished",
  });
  await fail(
    mutate(a, "homework", homework, {
      action: "note",
      version: 3,
      key: randomUUID(),
      note: "stale",
    }),
    "P0409",
  );
  const giftData = {
    title: "Birthday money",
    type: "money_in",
    date: "2060-11-10",
    from: "Aunt Rowan",
    occasion: "Birthday",
    amountCents: 5500,
    thankYou: false,
    note: "",
  };
  const gift = await mutate(a, "gifts", null, {
    data: giftData,
    key: randomUUID(),
  });
  await mutate(b, "gifts", null, {
    data: {
      ...giftData,
      title: "Book purchase",
      type: "money_out",
      amountCents: 1234,
    },
    key: randomUUID(),
  });
  await mutate(b, "gifts", null, {
    data: {
      ...giftData,
      title: "Wooden train",
      type: "gift",
      amountCents: 3000,
    },
    key: randomUUID(),
  });
  assert.equal((await read(a, "gifts")).totals.balanceCents, 4266);
  await fail(
    mutate(a, "gifts", null, {
      data: { ...giftData, amountCents: 1.5 },
      key: randomUUID(),
    }),
    "22023",
  );
  await mutate(b, "gifts", gift, {
    action: "archive",
    version: 1,
    key: randomUUID(),
  });
  assert.equal((await read(a, "gifts")).totals.balanceCents, -1234);
  await mutate(a, "gifts", gift, {
    action: "restore",
    version: 2,
    key: randomUUID(),
  });
  assert.equal((await read(a, "gifts")).totals.balanceCents, 4266);
  const routine = await mutate(a, "routines", null, {
    data: {
      title: "Brush teeth",
      type: "routine",
      days: [0, 1, 2, 3, 4, 5, 6],
      time: "07:30",
      home: "both",
      note: "",
    },
    key: randomUUID(),
  });
  let routines = await read(b, "routines");
  const ctx = routines.context;
  const check = {
    action: "check",
    version: 1,
    checked: true,
    day: ctx.day,
    dayVersion: 0,
    timezoneVersion: ctx.timezoneVersion,
    key: randomUUID(),
  };
  await mutate(b, "routines", routine, check);
  await mutate(b, "routines", routine, check);
  assert.equal(
    (await read(a, "routines", routine)).record.check.actor,
    "Sam Willow",
  );
  await fail(
    mutate(a, "routines", routine, {
      ...check,
      checked: false,
      key: randomUUID(),
    }),
    "P0409",
  );
  await rpc(a, "app_settings", [
    "timezone",
    JSON.stringify({
      timezone: "America/Denver",
      version: ctx.timezoneVersion,
      key: randomUUID(),
    }),
  ]);
  await fail(
    mutate(a, "routines", routine, {
      ...check,
      dayVersion: 1,
      checked: false,
      key: randomUUID(),
    }),
    "P0409",
  );
  const info = await mutate(a, "info", null, {
    data: {
      title: "School details",
      category: "school",
      details: "Fictional Willow Primary",
      important: true,
    },
    key: randomUUID(),
  });
  await fail(read(c, "info", info), "P0404");
  for (const kind of [
    "papers",
    "pickups",
    "homework",
    "gifts",
    "routines",
    "info",
  ])
    assert.equal(
      (
        await as(
          c,
          "select * from app_records where kind=$1 and household=$2",
          [kind, profile.household],
        )
      ).rows.length,
      0,
    );
  await db.query("delete from auth.sessions where id=$1", [b.session]);
  await fail(rpc(b, "app_me"), "28000");
  await fail(as(b, "select * from storage.objects"), "28000");
  console.log(
    "PASS: Postgres migration, database RLS/Storage policies, signup membership/invites, all six workflows, money cents, version conflicts, retry idempotency, household isolation, server-owned actors and revoked-session denial.",
  );
} finally {
  await db.close();
}
