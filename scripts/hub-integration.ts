import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chromium,
  expect,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mockSupabase } from "./mock-supabase";
import { seedCloud } from "./seed-cloud";
import type { HubView } from "../lib/hub-types";
const cloud = process.argv.includes("--cloud");
const mock = cloud ? await mockSupabase() : null;
const temp = mkdtempSync("/tmp/team-hub-check-"),
  base = `http://localhost:${cloud ? 3357 : 3356}`;
const env = {
  ...process.env,
  APP_BACKEND: cloud ? "supabase" : "sqlite",
  VERCEL: "0",
  DATA_DIR: temp + "/data",
  APP_ORIGIN: base,
  ...(mock
    ? {
        SUPABASE_URL: mock.base,
        SUPABASE_PUBLISHABLE_KEY: mock.key,
        SUPABASE_SECRET_KEY: mock.secret,
      }
    : {}),
};
if (mock) await seedCloud(mock, true);
else {
  const seed = spawnSync("node", ["--import", "tsx", "scripts/seed.ts"], {
    env,
    encoding: "utf8",
  });
  assert.equal(seed.status, 0, seed.stderr);
}
let log = "",
  server: ChildProcess | undefined;
function start() {
  server = spawn(
    "node",
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "0.0.0.0",
      "--port",
      cloud ? "3357" : "3356",
    ],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  server.stdout!.on("data", (b) => (log += b));
  server.stderr!.on("data", (b) => (log += b));
}
async function stop() {
  if (
    server &&
    !server.killed &&
    server.exitCode === null &&
    server.signalCode === null
  ) {
    const stopped = new Promise<void>((r) => server!.once("exit", () => r()));
    server.kill("SIGTERM");
    await stopped;
  }
}
async function ready() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(base + "/api/me")).status === 401) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw Error("Server did not start: " + log);
}
start();
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let debugPages: Page[] = [];
try {
  await ready();
  browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ||
      (existsSync("/usr/bin/chromium")
        ? "/usr/bin/chromium"
        : chromium.executablePath()),
  });
  const contexts = await Promise.all(
    [390, 390, 320, 320, 390].map((width) =>
      browser!.newContext({ viewport: { width, height: 844 } }),
    ),
  );
  const [a, b, c, kid, anon] = contexts;
  const [pa, pb, pc, pk] = await Promise.all(
    contexts.slice(0, 4).map((x) => x.newPage()),
  );
  debugPages = [pa, pb, pc, pk];
  for (const page of debugPages)
    page.on("pageerror", (error) =>
      console.error("Browser error:", error.message),
    );
  async function login(p: Page, email: string) {
    await p.goto(base);
    await p.getByLabel("Email", { exact: true }).fill(email);
    await p.getByLabel("Password", { exact: true }).fill("Backpack-demo-26!");
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      p.getByRole("button", { name: "Sign out", exact: true }),
    ).toBeVisible();
  }
  await login(pa, "alex@example.test");
  await login(pb, "sam@example.test");
  await login(pc, "jordan@example.test");
  const get = async (ctx: BrowserContext, path = "/api/hub") => {
    const r = await ctx.request.get(base + path);
    assert.equal(r.status(), 200, await r.text());
    return r.json();
  };
  async function post(
    ctx: BrowserContext,
    path: string,
    body: object,
    status = 200,
  ) {
    const r = await ctx.request.post(base + path, {
      headers: { Origin: base },
      data: body,
    });
    assert.equal(r.status(), status, await r.text());
    return r.json();
  }
  const save = (ctx: BrowserContext, body: object, status = 200) =>
    post(
      ctx,
      "/api/hub",
      { key: randomUUID(), ...body },
      status,
    ) as Promise<HubView>;
  const open = async (p: Page, label: string) => {
    await p.getByRole("button", { name: "More", exact: true }).click();
    await p.getByRole("button", { name: label, exact: true }).click();
  };
  const meA = await get(a, "/api/me"),
    meB = await get(b, "/api/me");
  assert.equal((await anon.request.get(base + "/api/hub")).status(), 401);
  await open(pa, "Contacts");
  await pa.getByRole("button", { name: "Add contact", exact: false }).click();
  await pa
    .getByLabel("Contact name", { exact: true })
    .fill("Willow School Office");
  await pa.getByLabel("Role or relationship").fill("School");
  await pa.getByLabel("Phone number").fill("+1 (202) 555-0107");
  await pa
    .getByLabel("Notes", { exact: true })
    .fill("Fictional school contact");
  await pa.getByLabel("Pin as an important contact").check();
  await pa.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    pa.getByRole("heading", { name: "Willow School Office", exact: true }),
  ).toBeVisible();
  await open(pb, "Contacts");
  await expect(
    pb.getByRole("heading", { name: "Willow School Office" }),
  ).toBeVisible({ timeout: 10000 });
  await pa.screenshot({
    path: `/tmp/team-hub-${cloud ? "cloud" : "local"}-contacts.png`,
    fullPage: true,
  });
  let data: HubView = await get(a);
  let contact = data.contacts[0];
  assert.equal(contact.important, true);
  assert.equal(contact.by, meA.user.id);
  await pa.getByRole("button", { name: "Edit contact" }).click();
  await pa.getByLabel("Notes", { exact: true }).fill("Keep this unsaved draft");
  await save(b, { op: "contact", ...contact, note: "New office note" });
  await new Promise((r) => setTimeout(r, 3200));
  await pa.getByRole("button", { name: "Save", exact: true }).click();
  await expect(pa.locator(".hub-editor [role=alert]")).toContainText("changed");
  await expect(pa.getByLabel("Notes", { exact: true })).toHaveValue(
    "Keep this unsaved draft",
  );
  await pa
    .getByRole("button", { name: "Discard draft and load latest details" })
    .click();
  await expect(pa.getByLabel("Notes", { exact: true })).toHaveValue(
    "New office note",
  );
  await pa.getByRole("button", { name: "Cancel", exact: true }).click();
  data = await save(a, {
    op: "contact",
    name: "Aunt Rowan",
    role: "Trusted grownup",
    phone: "+1 202 555 0108",
    email: "rowan@example.test",
    note: "Fictional contact",
    childVisible: true,
    important: false,
  });
  contact = data.contacts[0];
  await save(c, { op: "contact", ...contact, note: "Forged" }, 404);
  await save(a, {
    op: "resource",
    title: "Parent guide",
    details: "Private grownup guidance",
    url: "",
    audience: "parents",
  });
  await save(a, {
    op: "resource",
    title: "Reading together",
    details: "Read a favorite story together.",
    url: "https://example.com/reading",
    audience: "child",
  });
  await save(
    a,
    {
      op: "resource",
      title: "Unsafe URL",
      details: "",
      url: "javascript:alert(1)",
      audience: "child",
    },
    400,
  );
  await open(pa, "Parent chat");
  await open(pb, "Parent chat");
  await pa
    .getByLabel("Message", { exact: true })
    .fill("The blue folder is ready for tomorrow.");
  await pa.getByRole("button", { name: "Send message", exact: false }).click();
  await expect(
    pb.getByText("The blue folder is ready for tomorrow.", { exact: true }),
  ).toBeVisible({ timeout: 10000 });
  const chat = {
    op: "message",
    text: "One message on retry",
    key: randomUUID(),
    actor: meB.user.id,
    household: "other",
  };
  await Promise.all([save(a, chat), save(a, chat)]);
  data = await get(b);
  assert.equal(data.messages.filter((x) => x.text === chat.text).length, 1);
  assert.equal(
    data.messages.find((x) => x.text === chat.text)!.by,
    meA.user.id,
  );
  assert.equal((await get(c)).messages.length, 0);
  await open(pa, "Parenting together");
  await pa
    .getByRole("button", { name: "Start a conversation", exact: false })
    .click();
  await pa
    .getByLabel("Or ask your own question")
    .fill("How do we wind down before bed?");
  await pa
    .getByLabel("My answer", { exact: true })
    .fill("A story and quiet lights.");
  await pa
    .getByLabel("Our shared approach", { exact: true })
    .fill("A story before lights out in both homes.");
  await pa.getByRole("button", { name: "Save", exact: true }).click();
  data = await get(a);
  let exercise = data.exercises[0];
  assert.equal(exercise.question, "How do we wind down before bed?");
  data = await save(b, {
    op: "exercise",
    id: exercise.id,
    version: exercise.version,
    answer: "A calm routine helps.",
    plan: exercise.plan,
  });
  exercise = data.exercises[0];
  assert.equal(exercise.answers[meA.user.id], "A story and quiet lights.");
  assert.equal(exercise.answers[meB.user.id], "A calm routine helps.");
  data = await save(a, {
    op: "approvePlan",
    id: exercise.id,
    version: exercise.version,
  });
  data = await save(b, {
    op: "approvePlan",
    id: exercise.id,
    version: data.exercises[0].version,
  });
  assert.equal(data.exercises[0].approvals.length, 2);
  data = await save(a, {
    op: "exercise",
    id: exercise.id,
    version: data.exercises[0].version,
    answer: "Changed my approach",
    previousAnswer: "Changed my approach",
    plan: exercise.plan,
  });
  assert.equal(data.exercises[0].approvals.length, 0);
  const tinyPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=",
    "base64",
  );
  const png = Buffer.concat([tinyPng, Buffer.alloc(5 * 1024 * 1024)]);
  await open(pa, "Photo gallery");
  await pa.getByRole("button", { name: "Add photo", exact: false }).click();
  await pa
    .getByLabel("Caption", { exact: true })
    .fill("A fictional kitchen adventure");
  await pa.locator('input[type="file"]').setInputFiles({
    name: "bad.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("not a photo"),
  });
  await pa.getByRole("button", { name: "Add photo", exact: true }).click();
  await expect(pa.locator(".hub-editor [role=alert]")).toContainText(
    /Unsupported/,
  );
  await expect(pa.getByLabel("Caption", { exact: true })).toHaveValue(
    "A fictional kitchen adventure",
  );
  await pa
    .locator('input[type="file"]')
    .setInputFiles({ name: "memory.png", mimeType: "image/png", buffer: png });
  await pa.getByLabel("Show in child view").check();
  await pa.getByRole("button", { name: "Add photo", exact: true }).click();
  await expect(
    pa.getByRole("img", { name: "A fictional kitchen adventure", exact: true }),
  ).toBeVisible();
  data = await get(a);
  const photo = data.photos[0],
    photoUrl = "/api/hub/photos/" + photo.id;
  const image = await b.request.get(base + photoUrl);
  assert.equal(image.status(), 200);
  assert.deepEqual(await image.body(), png);
  assert.match(image.headers()["cache-control"], /no-store/);
  assert.equal((await c.request.get(base + photoUrl)).status(), 404);
  assert.equal((await anon.request.get(base + photoUrl)).status(), 401);
  await save(a, {
    op: "photo",
    id: photo.id,
    version: photo.version,
    caption: "Parents' photo",
    childVisible: false,
  });
  await open(pa, "Stars & rewards");
  await pa.getByRole("button", { name: "Set up child login" }).click();
  const username = "bill-" + randomUUID().slice(0, 8),
    password = "Bill's little star phrase!";
  await pa.getByLabel("Child username").fill(username);
  await pa.getByLabel("New child password").fill(password);
  await pa.getByRole("button", { name: "Save", exact: true }).click();
  await expect(pa.getByText(username, { exact: true })).toBeVisible();
  const made = await post(
    a,
    "/api/family/routines",
    {
      key: randomUUID(),
      data: {
        title: "Put toys away",
        type: "chore",
        days: [0, 1, 2, 3, 4, 5, 6],
        time: "",
        home: "both",
        note: "Put each toy in its basket.",
      },
    },
    201,
  );
  const routineId = made.record.id;
  async function checkChore(value: boolean, key = randomUUID()) {
    const current = await get(a, "/api/family/routines/" + routineId);
    return post(a, "/api/family/routines/" + routineId, {
      action: "check",
      checked: value,
      version: current.record.version,
      day: current.context.day,
      dayVersion: current.record.check.version,
      timezoneVersion: current.context.timezoneVersion,
      key,
    });
  }
  const current = await get(a, "/api/family/routines/" + routineId);
  const check = {
    action: "check",
    checked: true,
    version: current.record.version,
    day: current.context.day,
    dayVersion: current.record.check.version,
    timezoneVersion: current.context.timezoneVersion,
    key: randomUUID(),
  };
  await Promise.all([
    post(a, "/api/family/routines/" + routineId, check),
    post(a, "/api/family/routines/" + routineId, check),
  ]);
  assert.equal((await get(a)).balance, 1);
  await checkChore(false);
  assert.equal((await get(a)).balance, 0);
  await checkChore(true);
  assert.equal((await get(a)).balance, 1);
  assert.equal((await get(a)).awards.length, 1);
  data = await save(b, {
    op: "recognition",
    text: "You kept trying even when it was tricky!",
    stars: 1,
  });
  assert.equal(data.balance, 2);
  data = await save(a, {
    op: "goal",
    title: "Choose our next bedtime story",
    cost: 2,
    archived: false,
  });
  const goal = data.goals[0];
  await pk.goto(base);
  await pk.getByRole("button", { name: "Child sign in", exact: true }).click();
  await pk.getByLabel("Child username", { exact: true }).fill(username);
  await pk.getByLabel("Password", { exact: true }).fill(password);
  const childLoginResponse = pk.waitForResponse(
    (r) =>
      r.url() === base + "/api/child/login" && r.request().method() === "POST",
  );
  await pk.getByRole("button", { name: "Let's go!", exact: true }).click();
  const signedIn = await childLoginResponse;
  assert.equal(signedIn.status(), 200, await signedIn.text());
  await signedIn.finished();
  assert.equal((await get(kid, "/api/me")).user.role, "child");
  await expect(pk.getByRole("heading", { name: /Hey, Bill/ })).toBeVisible();
  await expect(pk.getByText("Put toys away", { exact: true })).toBeVisible();
  await expect(
    pk.getByText("You kept trying even when it was tricky!", { exact: true }),
  ).toBeVisible();
  await pk.screenshot({
    path: `/tmp/team-hub-${cloud ? "cloud" : "local"}-child.png`,
    fullPage: true,
  });
  const childData: HubView = await get(kid);
  assert.equal(childData.role, "child");
  assert.equal(childData.messages.length, 0);
  assert.equal(childData.exercises.length, 0);
  assert.equal(childData.members.length, 0);
  assert.equal(childData.photos.length, 0);
  assert.deepEqual(
    childData.contacts.map((x) => x.name),
    ["Aunt Rowan"],
  );
  assert.deepEqual(
    childData.resources.map((x) => x.title),
    ["Reading together"],
  );
  assert.ok(!JSON.stringify(childData).includes("passwordHash"));
  assert.ok(!JSON.stringify(await get(a)).includes("passwordHash"));
  for (const path of [
    "/api/papers",
    "/api/papers/known-id/attachment",
    "/api/pickups",
    "/api/homework",
    "/api/family/info",
    "/api/family/routines",
    "/api/team",
    "/api/hub/photos/" + photo.id,
  ]) {
    const r = await kid.request.get(base + path);
    assert.equal(
      r.status(),
      path.includes("/api/hub/photos/") ? 404 : 403,
      path,
    );
  }
  let currentPhoto = (await get(a)).photos[0];
  await save(a, {
    op: "photo",
    id: currentPhoto.id,
    version: currentPhoto.version,
    caption: "A shared moment",
    childVisible: true,
  });
  assert.equal((await kid.request.get(base + photoUrl)).status(), 200);
  const kidProfile = (await get(kid)).profile;
  await save(kid, {
    op: "settings",
    inheritChildAppearance: false,
    version: kidProfile.settingsVersion ?? 0,
    appearance: { ...kidProfile.appearance, background: "photo:" + photo.id },
  });
  currentPhoto = (await get(a)).photos[0];
  await save(b, {
    op: "photo",
    id: currentPhoto.id,
    version: currentPhoto.version,
    caption: "Parents' photo",
    childVisible: false,
  });
  assert.equal((await get(kid)).profile.appearance.background, "plain");
  await save(kid, { op: "message", text: "forbidden" }, 403);
  await save(kid, { op: "recognition", text: "Forged stars", stars: 100 }, 403);
  await post(
    kid,
    "/api/family/routines/" + routineId,
    { ...check, key: randomUUID() },
    403,
  );
  await post(kid, "/api/team/invitations", {}, 403);
  await pk.getByRole("button", { name: "Rewards", exact: true }).click();
  await pk
    .getByRole("button", { name: "Ask for this reward", exact: true })
    .click();
  await expect(
    pk.getByText("Your grownup will take a look.", { exact: true }),
  ).toBeVisible();
  data = await get(a);
  const redemption = data.redemptions[0];
  const decision = {
    op: "decideReward",
    id: redemption.id,
    version: redemption.version,
    status: "approved",
    key: randomUUID(),
  };
  const decisions = await Promise.all([
    a.request.post(base + "/api/hub", {
      headers: { Origin: base },
      data: decision,
    }),
    b.request.post(base + "/api/hub", {
      headers: { Origin: base },
      data: { ...decision, key: randomUUID() },
    }),
  ]);
  assert.deepEqual(decisions.map((r) => r.status()).sort(), [200, 409]);
  assert.equal((await get(a)).balance, 0);
  await expect(
    pk.getByText("🎉 Your grownup said yes!", { exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await open(pa, "App settings");
  await pa.getByLabel("Blue skies", { exact: true }).check();
  await pa.getByLabel("Font", { exact: true }).selectOption("simple");
  await pa.getByLabel("Background", { exact: true }).selectOption("confetti");
  await pa.getByLabel("Text size", { exact: true }).selectOption("large");
  await pa
    .getByRole("button", { name: "Save app settings", exact: true })
    .click();
  await expect(pa.locator("html")).toHaveAttribute("data-theme", "ocean");
  await expect(pb.locator("html")).toHaveAttribute("data-theme", "forest");
  await pa.reload();
  await expect(pa.locator("html")).toHaveAttribute("data-font", "simple");
  await expect(pa.locator("html")).toHaveAttribute(
    "data-background",
    "confetti",
  );
  for (const page of [pa, pc, pk]) {
    await page.setViewportSize({ width: 320, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
      true,
      "No horizontal overflow at 320px",
    );
  }
  data = await get(a);
  const childAccount = data.child!;
  await save(b, {
    op: "childAccount",
    username,
    password: "A different star phrase!",
    version: childAccount.version,
    enabled: true,
  });
  assert.equal((await kid.request.get(base + "/api/me")).status(), 401);
  await post(kid, "/api/child/login", { username, password }, 401);
  await post(kid, "/api/child/login", {
    username,
    password: "A different star phrase!",
  });
  if (cloud) {
    const childCallback = await kid.request.get(
      base + "/auth/callback?code=unused-child-code",
      { maxRedirects: 0 },
    );
    assert.equal(childCallback.status(), 307);
    assert.equal(childCallback.headers().location, base + "/");
  }
  const sessionCookie = (await kid.cookies()).find(
    (x) => x.name === "team_child",
  )!;
  assert.equal(sessionCookie.httpOnly, true);
  assert.equal(sessionCookie.sameSite, "Strict");
  const retired = await browser.newContext();
  await retired.addCookies(await c.cookies());
  await post(c, "/api/child/login", {
    username,
    password: "A different star phrase!",
  });
  assert.equal((await get(c, "/api/me")).user.role, "child");
  assert.equal(
    (await retired.request.get(base + "/api/me")).status(),
    401,
    "Switching to child signs out the previous parent session",
  );
  await retired.close();
  if (mock) {
    const client = createClient(mock.base, mock.key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await client.auth.signInWithPassword({
      email: "alex@example.test",
      password: "Backpack-demo-26!",
    });
    const raw = await client.rpc("app_hub_service", {
      p_action: "read",
      p_body: { household: randomUUID() },
    });
    assert.equal(raw.error?.code, "42501");
    const anonymous = createClient(mock.base, mock.key, {
      auth: { persistSession: false },
    });
    assert.equal(
      (
        await anonymous.rpc("app_hub_service", {
          p_action: "childLookup",
          p_body: { username },
        })
      ).error?.code,
      "42501",
    );
    await client.auth.signOut();
    assert.equal(
      existsSync(temp + "/data/family.sqlite"),
      false,
      "Cloud never initializes SQLite",
    );
  }
  await stop();
  start();
  await ready();
  data = await get(a);
  assert.equal(data.photos.length, 1);
  assert.equal(data.contacts.length, 2);
  assert.equal(data.messages.length, 2);
  assert.equal(data.balance, 0);
  assert.equal((await get(kid)).role, "child");
  assert.equal((await kid.request.get(base + photoUrl)).status(), 404);
  console.log(
    `PASS: ${cloud ? "Supabase SDK + Postgres/RLS fixture" : "SQLite"} gallery/private originals, editable contacts/resources, parent chat polling/idempotency, separate consistency answers/approvals, child login and parent API isolation, automatic chore stars/undo/retry, reward approval race, per-account appearance, stale drafts, mobile layout, credential revocation, and restart persistence.`,
  );
} catch (e) {
  console.error(log);
  for (const page of debugPages)
    console.error((await page.locator("body").innerText()).slice(0, 1800));
  throw e;
} finally {
  await browser?.close();
  await stop();
  await mock?.close();
  rmSync(temp, { recursive: true, force: true });
}
