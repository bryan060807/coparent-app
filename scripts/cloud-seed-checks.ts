import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { mockSupabase } from "./mock-supabase";
import { seedCloud } from "./seed-cloud";
const mock = await mockSupabase();
try {
  await assert.rejects(seedCloud(mock), /development-only/);
  await seedCloud(mock, true);
  await seedCloud(mock, true);
  const users = [];
  for (const email of [
    "alex@example.test",
    "sam@example.test",
    "jordan@example.test",
  ]) {
    const client = createClient(mock.base, mock.key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const login = await client.auth.signInWithPassword({
      email,
      password: "Backpack-demo-26!",
    });
    assert.equal(login.error, null);
    const me = await client.rpc("app_me");
    assert.equal(me.error, null);
    users.push(me.data);
    await client.auth.signOut({ scope: "local" });
  }
  assert.equal(users[0].team.name, "Team Bill");
  assert.equal(users[0].members.length, 2);
  assert.deepEqual(users[0].members, users[1].members);
  assert.equal(users[2].members.length, 1);
  assert.equal(users[2].team.name, "Team Robin");
  console.log(
    "PASS: opt-in development cloud seed uses Supabase Admin/Auth SDK, is repeatable, and creates two fictional parents plus an isolated third account.",
  );
} finally {
  await mock.close();
}
