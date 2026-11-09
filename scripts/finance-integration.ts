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
import { mockSupabase } from "./mock-supabase";
import { seedCloud } from "./seed-cloud";
import type { HubView } from "../lib/hub-types";
const cloud = process.argv.includes("--cloud");
const mock = cloud ? await mockSupabase() : null;
const temp = mkdtempSync("/tmp/team-finance-check-"),
  base = `http://localhost:${cloud ? 3363 : 3362}`;
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
      cloud ? "3363" : "3362",
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
  await (async () => {
    await ready();
    browser = await chromium.launch({
      ...(process.env.REAL_MAP_TILES === "1" && process.env.HTTPS_PROXY
        ? {
            proxy: {
              server: process.env.HTTPS_PROXY,
              bypass: "localhost,127.0.0.1",
            },
          }
        : {}),
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
        data:
          path === "/api/location"
            ? { ...body, viewer: (await get(ctx, "/api/me")).user.id }
            : body,
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
    const meA = (await get(a, "/api/me")).user.id,
      meB = (await get(b, "/api/me")).user.id;
    const finance = async (ctx: BrowserContext, body: object, status = 200) =>
      post(
        ctx,
        "/api/finance",
        {
          viewer: (await get(ctx, "/api/me")).user.id,
          key: randomUUID(),
          ...body,
        },
        status,
      );
    const state = (ctx = a) => get(ctx, "/api/finance");
    await open(pa, "Family finances");
    await open(pb, "Family finances");
    await expect(pa.getByText("Start with one receipt")).toBeVisible();
    await pa.getByRole("button", { name: "My PayPal", exact: true }).click();
    await pa
      .getByRole("button", { name: "Edit my PayPal link", exact: true })
      .click();
    await pa
      .getByLabel("PayPal.Me username", { exact: true })
      .fill("https://evil.example/pay");
    await pa.getByRole("button", { name: "Save", exact: true }).click();
    await expect(pa.locator(".finance-editor [role=alert]")).toContainText(
      "PayPal.Me",
    );
    await expect(
      pa.getByLabel("PayPal.Me username", { exact: true }),
    ).toHaveValue("https://evil.example/pay");
    await pa
      .getByLabel("PayPal.Me username", { exact: true })
      .fill("FictionalAlex");
    await pa.getByRole("button", { name: "Save", exact: true }).click();
    await pa.getByRole("button", { name: "Expenses", exact: true }).click();
    await pa.getByRole("button", { name: "Add expense", exact: true }).click();
    await pa.getByLabel("Title", { exact: true }).fill("Fictional school trip");
    await pa.getByLabel("Total amount (USD)", { exact: true }).fill("100.01");
    await pa.getByLabel("Date paid", { exact: true }).fill("2026-11-09");
    await pa.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      pb.getByRole("heading", { name: "Fictional school trip", exact: true }),
    ).toBeVisible({ timeout: 10000 });
    let f = await state(),
      expense = f.expenses[0];
    assert.equal(f.balances[meA], 5000);
    assert.equal(f.balances[meB], -5000);
    // The browser holds its own stale draft while the other parent edits.
    await pa.getByRole("button", { name: "Edit expense", exact: true }).click();
    await pa.getByLabel("Title", { exact: true }).fill("Keep my stale draft");
    await finance(b, {
      op: "expense",
      ...expense,
      title: "Fictional school trip updated",
    });
    await pa.getByRole("button", { name: "Save", exact: true }).click();
    await expect(pa.getByRole("alert").first()).toContainText("changed");
    await expect(pa.getByLabel("Title", { exact: true })).toHaveValue(
      "Keep my stale draft",
    );
    await pa
      .getByRole("button", { name: "Load latest record", exact: true })
      .click();
    await expect(pa.getByLabel("Title", { exact: true })).toHaveValue(
      "Fictional school trip updated",
    );
    await pa.getByRole("button", { name: "Cancel", exact: true }).click();
    // Full payment handoff from the owing parent's independent session.
    await pb.getByRole("button", { name: "Payments", exact: true }).click();
    await pb
      .getByRole("button", { name: "Prepare payment", exact: true })
      .click();
    await pb.getByLabel("Amount to send (USD)", { exact: true }).fill("20.00");
    await pb
      .getByLabel("What is it for?", { exact: true })
      .fill("School trip share");
    await pb
      .getByRole("button", { name: "Save payment record", exact: true })
      .click();
    await expect(
      pb.getByText("Ready to send · not paid", { exact: true }),
    ).toBeVisible();
    f = await state();
    let payment = f.payments[0];
    assert.equal(payment.sender, meB);
    assert.equal(f.balances[meB], -5000);
    const handoff = `/api/finance/payments/${payment.id}/paypal`;
    const redirect = await b.request.get(base + handoff, { maxRedirects: 0 });
    assert.equal(redirect.status(), 303);
    assert.equal(
      redirect.headers().location,
      "https://paypal.me/FictionalAlex/20.00USD",
    );
    assert.equal(
      (await state()).payments[0].status,
      "prepared",
      "Opening PayPal cannot record payment",
    );
    assert.equal(
      (await a.request.get(base + handoff, { maxRedirects: 0 })).status(),
      403,
    );
    await finance(a, { op: "sent", id: payment.id, version: 1 }, 403);
    await pb
      .getByRole("button", { name: "I sent this money", exact: true })
      .click();
    await pa.getByRole("button", { name: "Payments", exact: true }).click();
    await expect(
      pa.getByRole("button", { name: "I received $20.00", exact: true }),
    ).toBeVisible({ timeout: 10000 });
    assert.equal((await state()).balances[meB], -5000);
    await finance(b, { op: "received", id: payment.id, version: 2 }, 403);
    await pa
      .getByRole("button", { name: "I received $20.00", exact: true })
      .click();
    await expect(
      pb.getByText("Receipt confirmed", { exact: true }),
    ).toBeVisible({ timeout: 10000 });
    f = await state();
    assert.equal(f.balances[meB], -3000);
    assert.equal(
      (await b.request.get(base + handoff, { maxRedirects: 0 })).status(),
      409,
    );
    await finance(b, { op: "sent", id: payment.id, version: 1 }, 409);
    // Concurrent duplicate requests use one timeline entry and one transition.
    await finance(b, {
      op: "payment",
      recipient: meA,
      amount: 1000,
      purpose: "reimbursement",
      method: "paypal",
      reason: "Second part",
    });
    const second = (await state()).payments[1],
      sent = { op: "sent", id: second.id, version: 1, key: randomUUID() };
    await Promise.all([finance(b, sent), finance(b, sent)]);
    await finance(a, { op: "received", id: second.id, version: 2 });
    f = await state();
    assert.equal(f.balances[meB], -2000);
    assert.equal(
      f.events.filter(
        (e: any) =>
          e.entity === second.id && e.action === "Sender marked money sent",
      ).length,
      1,
    );
    await finance(
      b,
      {
        op: "payment",
        recipient: meA,
        amount: 2001,
        purpose: "reimbursement",
        method: "paypal",
        reason: "Too much",
      },
      409,
    );
    const pending = await finance(b, {
      op: "payment",
      recipient: meA,
      amount: 1000,
      purpose: "reimbursement",
      method: "paypal",
      reason: "Link change test",
    });
    const third = pending.payments[2];
    await finance(a, { op: "link", version: 1, handle: "FictionalAlexNew" });
    assert.equal(
      (
        await b.request.get(base + `/api/finance/payments/${third.id}/paypal`, {
          maxRedirects: 0,
        })
      ).status(),
      409,
    );
    await finance(b, { op: "cancelPayment", id: third.id, version: 1 });
    await finance(a, {
      op: "payment",
      recipient: meB,
      amount: 1200,
      purpose: "other",
      method: "other",
      reason: "Fictional birthday gift",
    });
    const other = (await state()).payments[3];
    await finance(a, { op: "sent", id: other.id, version: 1 });
    await finance(b, { op: "received", id: other.id, version: 2 });
    assert.equal(
      (await state()).balances[meB],
      -2000,
      "Other transfers do not settle expense balances",
    );
    console.log(
      "PASS: two-parent expense and PayPal handoff UI, exact split/receipt balances, stale drafts, manual transfers, duplicate updates, and changed-link protection",
    );
    await pa.getByRole("button", { name: "Savings", exact: true }).click();
    await pa
      .getByRole("button", { name: "Add savings goal", exact: true })
      .click();
    await pa
      .getByLabel("Title", { exact: true })
      .fill("Bill’s fictional college fund");
    await pa.getByLabel("Target amount (USD)", { exact: true }).fill("10000");
    await pa
      .getByLabel("Target date (optional)", { exact: true })
      .fill("2040-09-01");
    await pa
      .getByLabel("Notes (optional)", { exact: true })
      .fill("Discuss a monthly plan together.");
    await pa.getByRole("button", { name: "Save", exact: true }).click();
    await pa
      .getByRole("button", { name: "Record savings entry", exact: true })
      .click();
    await pa.getByLabel("Amount (USD)", { exact: true }).fill("100");
    await pa.getByRole("button", { name: "Save", exact: true }).click();
    f = await state();
    const goal = f.goals[0],
      contribution = f.contributions[0];
    await pb.getByRole("button", { name: "Savings", exact: true }).click();
    await expect(
      pb.locator(".finance-panel strong").filter({ hasText: /^\$100\.00$/ }),
    ).toBeVisible({
      timeout: 10000,
    });
    await finance(
      b,
      {
        op: "voidContribution",
        id: contribution.id,
        version: 1,
        note: "Spoofed",
      },
      403,
    );
    const withdrawals = await Promise.all(
      [a, b].map((ctx) =>
        ctx.request.post(base + "/api/finance", {
          headers: { Origin: base },
          data: {
            viewer: ctx === a ? meA : meB,
            key: randomUUID(),
            op: "contribution",
            goal: goal.id,
            direction: "withdrawal",
            amount: 7000,
            date: "2026-11-09",
            note: "Race check",
          },
        }),
      ),
    );
    assert.deepEqual(withdrawals.map((r) => r.status()).sort(), [200, 409]);
    f = await state();
    assert.equal(f.contributions.length, 2);
    await finance(
      a,
      {
        op: "voidContribution",
        id: contribution.id,
        version: 1,
        note: "Would go negative",
      },
      409,
    );
    // Parent, child, household, direct URL and CSRF boundaries.
    const username = "finance-" + randomUUID().slice(0, 8),
      password = "A fictional finance phrase!";
    await save(a, {
      op: "childAccount",
      username,
      password,
      enabled: true,
      version: "",
    });
    await pk.goto(base);
    await pk
      .getByRole("button", { name: "Child sign in", exact: true })
      .click();
    await pk.getByLabel("Child username", { exact: true }).fill(username);
    await pk.getByLabel("Password", { exact: true }).fill(password);
    await pk.getByRole("button", { name: "Let's go!", exact: true }).click();
    await expect(
      pk.getByRole("button", { name: "My day", exact: true }),
    ).toBeVisible();
    const paths = [
      "/api/finance",
      `/api/finance/expenses/${expense.id}`,
      `/api/finance/expenses/${expense.id}/timeline`,
      `/api/finance/payments/${payment.id}`,
      handoff,
      `/api/finance/payments/${payment.id}/timeline`,
      `/api/finance/goals/${goal.id}`,
      `/api/finance/goals/${goal.id}/timeline`,
    ];
    for (const path of paths) {
      assert.equal(
        (await kid.request.get(base + path, { maxRedirects: 0 })).status(),
        403,
        path,
      );
      assert.equal(
        (await anon.request.get(base + path, { maxRedirects: 0 })).status(),
        401,
        path,
      );
      if (path !== "/api/finance")
        assert.equal(
          (await c.request.get(base + path, { maxRedirects: 0 })).status(),
          404,
          path,
        );
    }
    assert.equal((await state(c)).expenses.length, 0);
    for (const ctx of [kid, anon, c]) {
      const r = await ctx.request.post(base + "/api/finance", {
        headers: { Origin: base },
        data: {
          viewer: ctx === c ? (await get(c, "/api/me")).user.id : meA,
          key: randomUUID(),
          op: "voidExpense",
          id: expense.id,
          version: 2,
          note: "Intruder",
        },
      });
      assert.equal(r.status(), ctx === kid ? 403 : ctx === anon ? 401 : 404);
    }
    assert.equal(
      (
        await a.request.post(base + "/api/finance", {
          headers: { Origin: "https://evil.example" },
          data: {},
        })
      ).status(),
      403,
    );
    assert.equal(
      (
        await a.request.post(base + "/api/finance", {
          headers: { Origin: base },
          data: {
            viewer: meB,
            key: randomUUID(),
            op: "link",
            version: 2,
            handle: "Impersonation",
          },
        })
      ).status(),
      409,
    );
    assert.ok(!JSON.stringify(await get(kid)).includes("finance"));
    assert.ok(
      !JSON.stringify(await get(a)).includes("FictionalAlexNew"),
      "General hub does not leak finance data",
    );
    for (const page of [pa, pb])
      for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 844 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
          true,
          "No horizontal overflow",
        );
      }
    await pa.screenshot({
      path: `/tmp/team-finance-${cloud ? "cloud" : "local"}.png`,
      fullPage: true,
    });
    const before = await state();
    await stop();
    start();
    await ready();
    const after = await state();
    assert.deepEqual(after, before);
    if (mock) assert.equal(existsSync(temp + "/data/family.sqlite"), false);
    console.log(
      `PASS: ${cloud ? "Supabase SDK/Postgres fixture" : "SQLite"} savings UI, withdrawal races, immutable audit, parent/child/third-household/anonymous restrictions, account-switch and CSRF checks, 320px layout and restart persistence. No external payment was sent.`,
    );
  })();
} catch (e) {
  console.error(log);
  for (const page of debugPages)
    try {
      console.error(
        (await page.locator("body").innerText({ timeout: 1000 })).slice(
          0,
          1800,
        ),
      );
    } catch {}
  throw e;
} finally {
  await browser?.close();
  await stop();
  await mock?.close();
  rmSync(temp, { recursive: true, force: true });
}
