import assert from "node:assert/strict";
import { checkPickupApi, checkPickupBrowsers } from "./pickup-checks";
import { checkFamilyApi, checkFamilyBrowsers } from "./family-checks";
import { checkHomeworkApi, checkHomeworkBrowsers } from "./homework-checks";
import { checkTeamApi, checkTeamBrowsers } from "./team-checks";
import { chromium, expect } from "@playwright/test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { request as httpRequest } from "node:http";
const dir = mkdtempSync(path.join(tmpdir(), "two-homes-test-"));
const port = 3217,
  base = `http://localhost:${port}`;
const development = process.argv.includes("--dev");
const localIp = Object.values(networkInterfaces())
  .flatMap((entries) => entries ?? [])
  .find((entry) => entry.family === "IPv4" && !entry.internal)?.address;
const parentBBase = `http://127.0.0.1:${port}`;
const env: NodeJS.ProcessEnv = {
  ...process.env,
  APP_BACKEND: "sqlite",
  VERCEL: "0",
  DATA_DIR: dir,
  NODE_ENV: development ? "development" : "test",
  COOKIE_SECURE: "false",
};
let server: ChildProcess;
function start() {
  server = spawn(
    "node",
    [
      "node_modules/next/dist/bin/next",
      development ? "dev" : "start",
      "--hostname",
      "0.0.0.0",
      "-p",
      String(port),
    ],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  server.stdout?.on("data", () => {});
  server.stderr?.on("data", (b) => {
    if (!b.toString().includes("ExperimentalWarning")) process.stderr.write(b);
  });
}
async function ready() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + "/api/me")).status === 401) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error("Server did not become ready");
}
async function stop() {
  if (server.exitCode !== null) return;
  await new Promise<void>((r) => {
    server.once("exit", () => r());
    server.kill("SIGTERM");
  });
}
async function login(email: string) {
  const r = await fetch(base + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: base },
    body: JSON.stringify({ email, password: "Backpack-demo-26!" }),
  });
  assert.equal(r.status, 200);
  return r.headers.get("set-cookie")!.split(";")[0];
}
function get(url: string, cookie = "") {
  return fetch(base + url, { headers: { cookie } });
}
// Fetch normalizes Host to the connection URL. Use HTTP directly when testing
// a LAN Host over a loopback connection, without contacting the LAN address.
function requestWithHost(
  url: string,
  headers: Record<string, string>,
  body?: string,
) {
  return new Promise<number>((resolve, reject) => {
    const req = httpRequest(
      base + url,
      {
        method: body ? "POST" : "GET",
        headers,
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}
function update(
  id: string,
  cookie: string,
  status: string,
  note = "",
  extra = {},
) {
  return fetch(base + "/api/papers/" + id, {
    method: "POST",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ status, note, ...extra }),
  });
}
try {
  const seed = spawnSync("node", ["--import", "tsx", "scripts/seed.ts"], {
    env,
    encoding: "utf8",
  });
  assert.equal(seed.status, 0, seed.stderr);
  start();
  await ready();
  if (localIp) {
    // Exercise a LAN Host/Origin over loopback: cloud egress policies can block
    // connecting a browser directly to the worker's own non-loopback address.
    const lanStatus = await requestWithHost(
      "/api/login",
      {
        "Content-Type": "application/json",
        host: `${localIp}:${port}`,
        origin: `http://${localIp}:${port}`,
      },
      JSON.stringify({
        email: "alex@example.test",
        password: "Backpack-demo-26!",
      }),
    );
    assert.equal(lanStatus, 200);
  }
  // Same-host requests must work, while other origins and spoofed forwarded
  // headers must not turn this into an unrestricted CSRF bypass.
  for (const origin of [
    "https://other.example",
    "null",
    `http://localhost:${port + 1}`,
    `https://localhost:${port}`,
  ]) {
    const rejected = await fetch(base + "/api/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin,
        "x-forwarded-host": new URL(origin === "null" ? base : origin).host,
      },
      body: JSON.stringify({
        email: "alex@example.test",
        password: "Backpack-demo-26!",
      }),
    });
    assert.equal(rejected.status, 403);
  }
  const a = await login("alex@example.test"),
    b = await login("sam@example.test"),
    c = await login("jordan@example.test");
  assert.notEqual(a, b);
  assert.equal((await (await get("/api/papers", b)).json()).length, 0);
  const payload = () => {
    const f = new FormData();
    f.set("title", "Field trip permission slip");
    f.set("due", "2026-11-12");
    f.set("assignee", "sam");
    f.set("key", "integration-upload");
    f.set(
      "file",
      new Blob([readFileSync("fixtures/permission-slip.pdf")], {
        type: "application/pdf",
      }),
      "permission-slip.pdf",
    );
    return f;
  };
  const bad = payload();
  bad.set(
    "file",
    new Blob(["not a PDF"], { type: "application/pdf" }),
    "bad.pdf",
  );
  assert.equal(
    (
      await fetch(base + "/api/papers", {
        method: "POST",
        headers: { cookie: a },
        body: bad,
      })
    ).status,
    400,
  );
  const big = payload();
  big.set(
    "file",
    new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], {
      type: "application/pdf",
    }),
    "large.pdf",
  );
  assert.ok(
    [400, 413].includes(
      (
        await fetch(base + "/api/papers", {
          method: "POST",
          headers: { cookie: a },
          body: big,
        })
      ).status,
    ),
  );
  const other = payload();
  other.set("assignee", "jordan");
  assert.equal(
    (
      await fetch(base + "/api/papers", {
        method: "POST",
        headers: { cookie: a },
        body: other,
      })
    ).status,
    400,
  );
  const invalid = payload();
  invalid.set("due", "2026-02-31");
  assert.equal(
    (
      await fetch(base + "/api/papers", {
        method: "POST",
        headers: { cookie: a },
        body: invalid,
      })
    ).status,
    400,
  );
  const create = await fetch(base + "/api/papers", {
    method: "POST",
    headers: { cookie: a },
    body: payload(),
  });
  assert.equal(create.status, 201);
  const { id } = await create.json();
  assert.equal(
    (
      await (
        await fetch(base + "/api/papers", {
          method: "POST",
          headers: { cookie: a },
          body: payload(),
        })
      ).json()
    ).id,
    id,
  );
  const list = await (await get("/api/papers", b)).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].assignee_name, "Sam Willow");
  assert.equal(list[0].status, "added");
  const attachment = await get(`/api/papers/${id}/attachment`, b);
  assert.equal(attachment.status, 200);
  assert.deepEqual(
    Buffer.from(await attachment.arrayBuffer()),
    readFileSync("fixtures/permission-slip.pdf"),
  );
  for (const cookie of [c, ""]) {
    const status = cookie ? 404 : 401;
    for (const suffix of ["", "/attachment", "/timeline"])
      assert.equal(
        (await get("/api/papers/" + id + suffix, cookie)).status,
        status,
      );
    assert.equal((await update(id, cookie, "signed")).status, status);
  }
  assert.equal((await get("/api/papers")).status, 401);
  assert.deepEqual(await (await get("/api/papers", c)).json(), []);
  assert.equal((await update(id, b, "returned")).status, 409);
  const signs = await Promise.all([
    update(id, b, "signed", "In the blue folder.", { actor: "alex" }),
    update(id, b, "signed", "In the blue folder."),
  ]);
  signs.forEach((r) => assert.equal(r.status, 200));
  const signed = await (await get("/api/papers/" + id, a)).json();
  assert.equal(signed.status, "signed");
  assert.equal(signed.note, "In the blue folder.");
  assert.equal(signed.events.length, 2);
  assert.equal(signed.events[1].actor, "Sam Willow");
  assert.equal(
    (await (await get("/api/papers", a)).json()).filter(
      (p: any) => p.status !== "returned",
    ).length,
    1,
  );
  assert.equal(
    (await update(id, a, "returned", "Sent to school.")).status,
    200,
  );
  assert.equal(
    (await update(id, a, "returned", "Sent to school.")).status,
    200,
  );
  assert.equal((await update(id, b, "signed", "stale screen")).status, 409);
  const final = await (await get("/api/papers/" + id, b)).json();
  assert.deepEqual(
    final.events.map((e: any) => e.action),
    ["added", "signed", "returned"],
  );
  assert.deepEqual(
    final.events.map((e: any) => e.actor),
    ["Alex Willow", "Sam Willow", "Alex Willow"],
  );
  assert.equal(final.status, "returned");
  assert.equal(
    (await (await get("/api/papers", b)).json()).filter(
      (p: any) => p.status !== "returned",
    ).length,
    0,
  );
  assert.equal(
    (
      await fetch(base + "/api/papers/" + id, {
        method: "POST",
        headers: {
          cookie: a,
          origin: "https://other.example",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "signed", note: "" }),
      })
    ).status,
    403,
  );
  const persistedPickup = await checkPickupApi(base, a, b, c);
  const persistedHomework = await checkHomeworkApi(base, a, b, c);
  const familyIds = await checkFamilyApi(base, a, b, c, dir);
  const newFamily = await checkTeamApi(base, a, b, c, dir);
  await stop();
  start();
  await ready();
  const restoredTeam = await (await get("/api/me", newFamily.cookie)).json();
  assert.equal(restoredTeam.user.id, newFamily.userId);
  assert.equal(restoredTeam.members.length, 2);
  assert.equal(restoredTeam.team.name, "Team Bill");
  assert.equal(
    (await (await get("/api/me", newFamily.partnerCookie)).json()).team.name,
    "Team Bill",
  );
  const restoredPickup = await (
    await fetch(base + "/api/pickups/" + persistedPickup.id, {
      headers: { cookie: b },
    })
  ).json();
  const restoredHomework = await (
    await fetch(base + "/api/homework/" + persistedHomework.id, {
      headers: { cookie: b },
    })
  ).json();
  for (const kind of ["gifts", "routines", "info"] as const) {
    const saved = await (
      await fetch(base + "/api/family/" + kind + "/" + familyIds[kind], {
        headers: { cookie: b },
      })
    ).json();
    assert.equal(saved.record.archived, true);
    assert.ok(saved.events.length >= 3);
    if (kind === "routines") assert.ok(saved.checks.length >= 2);
  }
  assert.equal(restoredHomework.status, "done");
  assert.equal(restoredHomework.events.length, persistedHomework.events);
  assert.equal(restoredHomework.note, "Finished and checked.");
  assert.equal(restoredPickup.status, "completed");
  assert.equal(restoredPickup.events.length, 3);
  assert.equal(restoredPickup.scheduled_at, persistedPickup.scheduled_at);
  assert.equal(
    (await (await get("/api/papers/" + id, a)).json()).status,
    "returned",
  );
  assert.equal((await get("/api/papers/" + id + "/attachment", b)).status, 200);
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ||
      (existsSync("/usr/bin/chromium")
        ? "/usr/bin/chromium"
        : chromium.executablePath()),
    args: ["--no-sandbox"],
  });
  try {
    const ca = await browser.newContext({
        viewport: { width: 390, height: 844 },
      }),
      cb = await browser.newContext({ viewport: { width: 390, height: 844 } }),
      cc = await browser.newContext();
    const pa = await ca.newPage(),
      pb = await cb.newPage(),
      pc = await cc.newPage();
    for (const [page, email, address] of [
      [pa, "alex@example.test", base],
      [pb, "sam@example.test", parentBBase],
      [pc, "jordan@example.test", `http://127.0.0.1:${port}`],
    ] as const) {
      await page.goto(address);
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill("Backpack-demo-26!");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Today", exact: true }),
      ).toBeVisible();
      // Reloading must retain the browser cookie and authenticated session.
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "Today", exact: true }),
      ).toBeVisible();
    }
    await pa.getByRole("button", { name: "Add school paper" }).click();
    await pa.getByLabel("Paper title").fill("Museum trip permission slip");
    await pa.getByLabel("Due date").fill("2026-11-13");
    await pa.getByLabel("Photo or PDF").setInputFiles({
      name: "bad.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("not pdf"),
    });
    await pa.getByRole("button", { name: "Add paper", exact: true }).click();
    await expect(
      pa.getByRole("alert").filter({ hasText: "Unsupported file" }),
    ).toContainText("Unsupported file");
    await expect(pa.getByLabel("Paper title")).toHaveValue(
      "Museum trip permission slip",
    );
    await expect(pa.getByLabel("Due date")).toHaveValue("2026-11-13");
    await pa
      .getByLabel("Photo or PDF")
      .setInputFiles("fixtures/permission-slip.pdf");
    await pa.getByRole("button", { name: "Add paper", exact: true }).click();
    await expect(
      pa.getByRole("heading", { name: "Today", exact: true }),
    ).toBeVisible();
    await expect(
      pb.getByRole("heading", { name: "Museum trip permission slip" }),
    ).toBeVisible({ timeout: 10000 });
    await pb
      .getByRole("button")
      .filter({
        has: pb.getByRole("heading", { name: "Museum trip permission slip" }),
      })
      .click();
    await expect(
      pb.getByRole("heading", { name: "Next: sign the paper" }),
    ).toBeVisible();
    const original = await cb.request.get(
      parentBBase +
        (await pb
          .getByRole("link", { name: "Open original attachment" })
          .getAttribute("href")),
    );
    assert.equal(original.status(), 200);
    await pb.getByLabel("Handoff note").fill("In the blue folder.");
    await pb.getByRole("button", { name: "Mark Signed" }).click();
    await expect(
      pb.getByRole("heading", { name: "Next: send it back to school" }),
    ).toBeVisible();
    await expect(pa.getByText("Signed · return to school")).toBeVisible({
      timeout: 10000,
    });
    await pa
      .getByRole("button")
      .filter({
        has: pa.getByRole("heading", { name: "Museum trip permission slip" }),
      })
      .click();
    await expect(
      pa.getByText("In the blue folder.", { exact: true }).first(),
    ).toBeVisible();
    await pa.getByRole("button", { name: "Mark Returned" }).click();
    await expect(
      pb.getByText("Returned to school", { exact: true }),
    ).toBeVisible({ timeout: 10000 });
    await expect(pb.getByText("Returned by Alex Willow")).toBeVisible();
    await pa.getByRole("button", { name: "Back to Today" }).click();
    await expect(
      pa.getByRole("heading", { name: "Museum trip permission slip" }),
    ).toHaveCount(0);
    await pa.getByRole("button", { name: "More", exact: true }).click();
    await pa
      .getByRole("button", { name: "Paper history", exact: true })
      .click();
    await expect(
      pa.getByRole("heading", { name: "Museum trip permission slip" }),
    ).toBeVisible();
    await expect(
      pc.getByRole("heading", { name: "The backpack is clear" }),
    ).toBeVisible();
    await expect(pc.getByText("Museum trip permission slip")).toHaveCount(0);
    if (development) {
      const asset = await pa
        .locator('script[src^="/_next/"]')
        .first()
        .getAttribute("src");
      assert.ok(asset);
      const denied = await fetch(base + asset, {
        headers: { origin: "https://other.example" },
      });
      assert.equal(denied.status, 403);
      if (localIp) {
        const allowed = await requestWithHost(asset, {
          host: `${localIp}:${port}`,
          origin: `http://${localIp}:${port}`,
        });
        assert.equal(allowed, 200);
      }
    }
    assert.equal(
      await pa.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await pa.screenshot({ path: "/tmp/two-homes-history.png", fullPage: true });
    await pa.getByRole("button", { name: "Sign out" }).click();
    await expect(
      pa.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible();
    assert.equal((await ca.request.get(base + "/api/me")).status(), 401);
    console.log(
      `PASS (${development ? "development" : "production"}): browser sign-in at localhost and loopback IP${localIp ? ", simulated LAN Host/Origin" : ""}; sessions survive reload, full handoff syncs, sign-out revokes session, cross-origin requests rejected.`,
    );
    await checkPickupBrowsers(browser, base, parentBBase);
    await checkHomeworkBrowsers(browser, base, parentBBase);
    await checkFamilyBrowsers(browser, base, parentBBase);
    await checkTeamBrowsers(browser, base, parentBBase);
  } finally {
    await browser.close();
  }
  // A valid PNG is accepted too, and overdue/soonest dates sort first.
  for (const [key, due] of [
    ["later-image", "2099-12-31"],
    ["overdue-image", "2020-01-01"],
  ]) {
    const form = payload();
    form.set("key", key);
    form.set("due", due);
    form.set(
      "file",
      new Blob(
        [
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
            "base64",
          ),
        ],
        { type: "image/png" },
      ),
      "sample.png",
    );
    assert.equal(
      (
        await fetch(base + "/api/papers", {
          method: "POST",
          headers: { cookie: a },
          body: form,
        })
      ).status,
      201,
    );
  }
  const ordered = await (await get("/api/papers", b)).json();
  assert.equal(ordered[0].due, "2020-01-01");
  assert.equal(ordered.at(-1).due, "2099-12-31");
  console.log(
    "PASS: independent parent sessions, full handoff, original attachment, history, actor identity, duplicate upload/status, stale update, validation, household/anonymous isolation, CSRF, restart persistence.",
  );
} finally {
  if (server!) await stop();
  rmSync(dir, { recursive: true, force: true });
}
