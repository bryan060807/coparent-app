import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { chromium, expect, type Page } from "@playwright/test";
import { mockSupabase } from "./mock-supabase";
import { seedCloud } from "./seed-cloud";
import { checkTeamBrowsers } from "./team-checks";
import { checkPickupBrowsers } from "./pickup-checks";
import { checkHomeworkBrowsers } from "./homework-checks";
import { checkFamilyBrowsers } from "./family-checks";
const mock = await mockSupabase();
const base = "http://localhost:3334",
  second = "http://127.0.0.1:3334";
const temporary = mkdtempSync("/tmp/team-hosted-test-");
const unusedData = temporary + "/must-not-create-sqlite";
await seedCloud(mock, true);
const server = spawn(
  "node",
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "0.0.0.0",
    "--port",
    "3334",
  ],
  {
    env: {
      ...process.env,
      APP_BACKEND: "supabase",
      VERCEL: "0",
      SUPABASE_URL: mock.base,
      SUPABASE_PUBLISHABLE_KEY: mock.key,
      SUPABASE_SECRET_KEY: mock.secret,
      APP_ORIGIN: base,
      APP_ALLOWED_ORIGINS: second,
      DATA_DIR: unusedData,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let log = "";
server.stdout.on("data", (b) => (log += b));
server.stderr.on("data", (b) => (log += b));
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      ready = (await fetch(base + "/api/me")).status === 401;
    } catch {}
    if (ready) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(ready, log);
  browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ||
      (existsSync("/usr/bin/chromium")
        ? "/usr/bin/chromium"
        : chromium.executablePath()),
  });
  const contexts = await Promise.all(
    [390, 390, 320].map((width) =>
      browser!.newContext({ viewport: { width, height: 844 } }),
    ),
  );
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  const [pa, pb, pc] = pages;
  const login = async (page: Page, address: string, email: string) => {
    await page.goto(address);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page
      .getByLabel("Password", { exact: true })
      .fill("Backpack-demo-26!");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Sign out", exact: true }),
    ).toBeVisible();
  };
  await login(pa, base, "alex@example.test");
  await login(pb, second, "sam@example.test");
  await login(pc, base, "jordan@example.test");
  const cookies = (await contexts[0].cookies()).filter((c) =>
    c.name.startsWith("sb-"),
  );
  assert.ok(cookies.length);
  assert.ok(cookies.every((c) => c.httpOnly && c.sameSite === "Lax"));
  const [parentA, parentB] = contexts;
  await pa
    .getByRole("button", { name: "Add school paper", exact: true })
    .click();
  await pa
    .getByLabel("Paper title", { exact: true })
    .fill("Field trip permission slip");
  await pa.getByLabel("Due date", { exact: true }).fill("2060-11-12");
  await pa
    .getByLabel("Who’s handling it?", { exact: false })
    .selectOption({ label: "Sam Willow" });
  await pa.locator('input[type="file"]').setInputFiles({
    name: "bad.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("not a PDF"),
  });
  await pa.getByRole("button", { name: "Add paper", exact: true }).click();
  await expect(
    pa.getByText("Unsupported file.", { exact: false }),
  ).toBeVisible();
  await expect(pa.getByLabel("Paper title", { exact: true })).toHaveValue(
    "Field trip permission slip",
  );
  await expect(pa.getByLabel("Due date", { exact: true })).toHaveValue(
    "2060-11-12",
  );
  // Larger than Vercel's normal request-body limit: only the signed Storage PUT
  // carries these bytes. Our own POST /api/papers is a small JSON finalization.
  const pdf = Buffer.alloc(6 * 1024 * 1024, 32);
  readFileSync("fixtures/permission-slip.pdf").copy(pdf);
  let finalBody = 0;
  pa.on("request", (r) => {
    if (r.method() === "POST" && r.url() === base + "/api/papers")
      finalBody = r.postDataBuffer()?.length ?? 0;
  });
  await pa.locator('input[type="file"]').setInputFiles({
    name: "permission-slip.pdf",
    mimeType: "application/pdf",
    buffer: pdf,
  });
  await pa.getByRole("button", { name: "Add paper", exact: true }).click();
  await expect(
    pa.getByText("Paper added. Both parents can see it."),
  ).toBeVisible({ timeout: 15000 });
  assert.equal(mock.stats.largestSignedUpload, pdf.length);
  assert.ok(finalBody < 4096);
  await expect(
    pb.getByRole("heading", {
      name: "Field trip permission slip",
      exact: true,
    }),
  ).toBeVisible({ timeout: 10000 });
  const list = await (await parentA.request.get(base + "/api/papers")).json();
  const id = list[0].id;
  const attachment = await parentB.request.get(
    second + "/api/papers/" + id + "/attachment",
  );
  assert.equal(attachment.status(), 200);
  assert.deepEqual(await attachment.body(), pdf);
  assert.equal(attachment.headers()["cache-control"], "private, no-store");
  for (const suffix of ["", "/timeline", "/attachment"]) {
    assert.equal(
      (
        await contexts[2].request.get(base + "/api/papers/" + id + suffix)
      ).status(),
      404,
    );
    assert.equal(
      (await fetch(base + "/api/papers/" + id + suffix)).status,
      401,
    );
  }
  assert.equal(
    (
      await contexts[2].request.post(base + "/api/papers/" + id, {
        headers: { origin: base },
        data: { status: "signed", note: "forged" },
      })
    ).status(),
    404,
  );
  const privatePath = list[0].file;
  assert.equal(
    (await fetch(mock.base + "/storage/v1/object/school-papers/" + privatePath))
      .status,
    401,
  );
  const thirdLogin = await fetch(
    mock.base + "/auth/v1/token?grant_type=password",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: mock.key },
      body: JSON.stringify({
        email: "jordan@example.test",
        password: "Backpack-demo-26!",
      }),
    },
  );
  const third = await thirdLogin.json();
  assert.equal(
    (
      await fetch(
        mock.base + "/storage/v1/object/school-papers/" + privatePath,
        { headers: { Authorization: "Bearer " + third.access_token } },
      )
    ).status,
    404,
  );
  await pb
    .getByRole("button", { name: "Field trip permission slip", exact: false })
    .click();
  await pb
    .getByLabel("Handoff note", { exact: false })
    .fill("In the blue folder.");
  await pb.getByRole("button", { name: "Mark Signed", exact: true }).click();
  await expect(
    pb.getByText("Signed · return to school", { exact: true }),
  ).toBeVisible();
  await expect(
    pa.getByText("Signed · return to school", { exact: true }),
  ).toBeVisible({ timeout: 10000 });
  const signAgain = await parentB.request.post(second + "/api/papers/" + id, {
    headers: { origin: second },
    data: { status: "signed", note: "In the blue folder." },
  });
  assert.equal(signAgain.status(), 200);
  await pb.getByRole("button", { name: "Mark Returned", exact: true }).click();
  await expect(
    pb.getByText("Returned to school", { exact: true }),
  ).toBeVisible();
  assert.equal(
    (
      await parentA.request.post(base + "/api/papers/" + id, {
        headers: { origin: base },
        data: { status: "signed", note: "stale" },
      })
    ).status(),
    409,
  );
  const timeline = await (
    await parentA.request.get(base + "/api/papers/" + id + "/timeline")
  ).json();
  assert.deepEqual(
    timeline.map((e: { action: string }) => e.action),
    ["added", "signed", "returned"],
  );
  assert.deepEqual(
    timeline.map((e: { actor: string }) => e.actor),
    ["Alex Willow", "Sam Willow", "Sam Willow"],
  );
  await expect(
    pa.getByRole("heading", { name: "The backpack is clear", exact: true }),
  ).toBeVisible({ timeout: 10000 });
  assert.equal(
    (
      await fetch(base + "/api/login", {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          "x-forwarded-host": "evil.example",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: "alex@example.test",
          password: "Backpack-demo-26!",
        }),
      })
    ).status,
    403,
  );
  // An already-authorized response can arrive after the cookie/account changes.
  // It must not reopen the previous household's paper on the new account's UI.
  await pa.getByRole("button", { name: "More", exact: true }).click();
  await pa
    .getByRole("navigation", { name: "More sections" })
    .getByRole("button", { name: "Paper history", exact: true })
    .click();
  let release!: () => void, captured!: () => void;
  const hold = new Promise<void>((r) => {
      release = r;
    }),
    capture = new Promise<void>((r) => {
      captured = r;
    });
  const detailUrl = base + "/api/papers/" + id;
  await pa.route(detailUrl, async (route) => {
    const response = await route.fetch();
    captured();
    await hold;
    await route.fulfill({ response });
  });
  await pa
    .getByRole("button", { name: "Field trip permission slip", exact: false })
    .click();
  await capture;
  assert.equal(
    (
      await parentA.request.post(base + "/api/login", {
        headers: { origin: base },
        data: { email: "jordan@example.test", password: "Backpack-demo-26!" },
      })
    ).status(),
    200,
  );
  await expect(pa.locator("header .brand strong")).toHaveText("Team Robin", {
    timeout: 10000,
  });
  const lateResponse = pa.waitForResponse(detailUrl);
  release();
  await (await lateResponse).finished();
  await pa.evaluate(
    () =>
      new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())),
      ),
  );
  await expect(
    pa.getByRole("heading", {
      name: "Field trip permission slip",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    pa.getByRole("navigation", { name: "Household", exact: true }),
  ).toBeVisible();
  for (const context of contexts) await context.close();
  await checkPickupBrowsers(browser, base, second);
  await checkHomeworkBrowsers(browser, base, second);
  await checkFamilyBrowsers(browser, base, second);
  await checkTeamBrowsers(browser, base, second);
  const confirmation = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    page = await confirmation.newPage();
  await page.goto(base);
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await page.getByLabel("Your name", { exact: true }).fill("Taylor Spruce");
  await page
    .getByLabel("Email", { exact: true })
    .fill("confirm-taylor@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Fictional-email-2026!");
  await page
    .getByLabel("Child's name or nickname", { exact: true })
    .fill("Bill");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByText("Check your email to confirm your account", {
      exact: false,
    }),
  ).toBeVisible();
  const code = await mock.confirm("confirm-taylor@example.test");
  await page.goto(base + "/auth/callback?code=" + code);
  await expect(
    page.getByRole("heading", { name: "Finish your team setup", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
  await page.getByLabel("Your name", { exact: true }).fill("Taylor Spruce");
  await page
    .getByLabel("Child's name or nickname", { exact: true })
    .fill("Bill");
  await page
    .getByRole("button", { name: "Continue to your team", exact: true })
    .click();
  await expect(page.locator("header .brand strong")).toHaveText("Team Bill");
  await confirmation.close();
  assert.equal(
    existsSync(unusedData),
    false,
    "Hosted requests must never initialize SQLite or local attachment storage",
  );
  console.log(
    "PASS: Supabase SDK adapter against a local Auth/Storage HTTP test double and real Postgres functions/RLS: two-session paper handoff, 6 MB direct upload, streamed/private original, field-preserving rejection, actor/idempotency/final-state checks, invitations, confirmation/PKCE cookies and onboarding. No live provider deployment was tested.",
  );
} finally {
  await browser?.close();
  if (server.exitCode === null)
    await new Promise<void>((resolve) => {
      server.once("exit", () => resolve());
      server.kill("SIGTERM");
    });
  await mock.close();
  rmSync(temporary, { recursive: true, force: true });
}
