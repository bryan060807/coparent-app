import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { cloudConfig } from "../lib/cloud/config";
const password = "Backpack-demo-26!";
export async function seedCloud(
  config: { url?: string; base?: string; key: string; secret: string },
  allowDemo = false,
) {
  if (
    !allowDemo ||
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL === "1"
  )
    throw Error(
      "Cloud demo seeding is development-only and requires ALLOW_CLOUD_DEMO_SEED=yes.",
    );
  const url = config.url ?? config.base!;
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, config.secret, options);
  const clients: SupabaseClient[] = [];
  async function account(email: string, name: string) {
    const made = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });
    if (
      made.error &&
      !["email_exists", "user_already_exists"].includes(made.error.code ?? "")
    )
      throw Error(
        "Could not prepare a fictional account. Check the project and server key.",
      );
    const client = createClient(url, config.key, options);
    clients.push(client);
    const login = await client.auth.signInWithPassword({ email, password });
    if (login.error || !login.data.user)
      throw Error(
        "A demo email already has different credentials. No passwords were changed; use a clean test project.",
      );
    const me = await client.rpc("app_me");
    if (me.error)
      throw Error("Apply the app's Supabase migration before seeding.");
    return { client, me: me.data, id: login.data.user.id };
  }
  try {
    const a = await account("alex@example.test", "Alex Willow");
    if (a.me.onboardingRequired) {
      const r = await a.client.rpc("app_onboard", {
        p_body: { mode: "create", name: "Alex Willow", childName: "Bill" },
      });
      if (r.error)
        throw Error("Could not create the fictional Willow household.");
    }
    const b = await account("sam@example.test", "Sam Willow");
    if (b.me.onboardingRequired) {
      const invite = await a.client.rpc("app_invitation");
      if (invite.error)
        throw Error(
          "The existing demo household already has two parents; no membership was changed.",
        );
      const joined = await b.client.rpc("app_onboard", {
        p_body: { mode: "join", name: "Sam Willow", invite: invite.data.code },
      });
      if (joined.error)
        throw Error("Could not join the fictional second parent.");
    } else if (!b.me.members.some((m: { id: string }) => m.id === a.id))
      throw Error(
        "Demo accounts are in different households; no membership was changed.",
      );
    const c = await account("jordan@example.test", "Jordan Cedar");
    if (c.me.onboardingRequired) {
      const r = await c.client.rpc("app_onboard", {
        p_body: { mode: "create", name: "Jordan Cedar", childName: "Robin" },
      });
      if (r.error)
        throw Error("Could not create the fictional Cedar household.");
    }
  } finally {
    for (const client of clients) await client.auth.signOut({ scope: "local" });
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await seedCloud(cloudConfig(), process.env.ALLOW_CLOUD_DEMO_SEED === "yes");
  console.log(
    "Fictional cloud accounts ready: alex@example.test, sam@example.test, jordan@example.test. Demo password: Backpack-demo-26! Existing passwords, records and team names were preserved. Sample: fixtures/permission-slip.pdf.",
  );
}
