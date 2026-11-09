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
const temp = mkdtempSync("/tmp/team-settings-map-check-"),
  base = `http://localhost:${cloud ? 3361 : 3360}`;
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
      cloud ? "3361" : "3360",
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
    console.log("Ready: signed in fictional parent sessions");
    const meA = await get(a, "/api/me"),
      meB = await get(b, "/api/me");
    await open(pa, "My profile");
    await pa
      .getByRole("button", { name: "Edit my profile", exact: true })
      .click();
    await expect(pa.getByLabel("Display name", { exact: true })).toBeVisible();
    assert.equal(
      await pa.getByLabel("Font", { exact: true }).count(),
      0,
      "Profile contains identity fields only",
    );
    await pa
      .getByLabel("A little about me", { exact: true })
      .fill("Fictional chef and story reader.");
    await pa.getByRole("button", { name: "Save", exact: true }).click();
    await open(pa, "App settings");
    await expect(
      pa.getByRole("heading", { name: "App settings", exact: true }),
    ).toHaveCount(1);
    assert.equal(
      await pa.getByLabel("Display name", { exact: true }).count(),
      0,
    );
    await pa.getByLabel("Wild rose", { exact: true }).check();
    await pa.getByLabel("Font", { exact: true }).selectOption("playful");
    await pa.getByLabel("Text size", { exact: true }).selectOption("extra");
    await pa.getByLabel("Background", { exact: true }).selectOption("grid");
    await pa.getByLabel("Spacing", { exact: true }).selectOption("compact");
    await pa.getByLabel("Card style", { exact: true }).selectOption("outlined");
    await pa.getByLabel("Time display", { exact: true }).selectOption("24h");
    await pa.getByLabel("Start page", { exact: true }).selectOption("gallery");
    await pa
      .getByLabel("Show pickup, homework, and routine summaries on Today")
      .uncheck();
    await pa
      .getByRole("button", { name: "Save app settings", exact: true })
      .click();
    await expect(pa.getByRole("status")).toContainText("App settings saved");
    await expect(pa.locator("html")).toHaveAttribute("data-theme", "rose");
    await expect(pa.locator("html")).toHaveAttribute(
      "data-card-style",
      "outlined",
    );
    await expect(pb.locator("html")).toHaveAttribute("data-theme", "forest");
    assert.equal(
      (await get(a)).profile.about,
      "Fictional chef and story reader.",
    );
    await pa.screenshot({
      path: `/tmp/team-settings-${cloud ? "cloud" : "local"}.png`,
      fullPage: true,
    });
    console.log("PASS: custom settings saved, profile remains separate");
    await pa.reload();
    await expect(
      pa.getByRole("heading", { name: "Photo gallery", exact: true }),
    ).toBeVisible();
    await expect(pa.locator("html")).toHaveAttribute("data-font", "playful");
    await open(pa, "App settings");
    await pa.getByLabel("Font", { exact: true }).selectOption("bookish");
    let state: HubView = await get(a);
    await save(a, {
      op: "settings",
      version: state.profile.settingsVersion ?? 0,
      appearance: { ...state.profile.appearance, theme: "ocean" },
      inheritChildAppearance: false,
    });
    await pa
      .getByRole("button", { name: "Save app settings", exact: true })
      .click();
    await expect(
      pa.locator(".settings-form [role=alert]").last(),
    ).toContainText("changed");
    await expect(pa.getByLabel("Font", { exact: true })).toHaveValue("bookish");
    await pa
      .getByRole("button", { name: "Load saved settings", exact: true })
      .click();
    await expect(pa.getByLabel("Font", { exact: true })).toHaveValue("playful");
    await pa
      .getByRole("button", { name: "Child defaults", exact: true })
      .click();
    await pa.getByLabel("Fresh mint", { exact: true }).check();
    await pa.getByLabel("Font", { exact: true }).selectOption("accessible");
    await pa.getByLabel("Start page", { exact: true }).selectOption("rewards");
    await pa
      .getByRole("button", { name: "Save child defaults", exact: true })
      .click();
    const username = "maps-" + randomUUID().slice(0, 8),
      password = "A fictional map phrase!";
    await save(a, {
      op: "childAccount",
      username,
      password,
      enabled: true,
      version: "",
    });
    await kid.grantPermissions(["geolocation"], { origin: base });
    await kid.setGeolocation({
      latitude: 41.8781,
      longitude: -87.6298,
      accuracy: 30,
    });
    await pk.goto(base);
    await pk
      .getByRole("button", { name: "Child sign in", exact: true })
      .click();
    await pk.getByLabel("Child username", { exact: true }).fill(username);
    await pk.getByLabel("Password", { exact: true }).fill(password);
    const childLogin = pk.waitForResponse(
      (r) => r.url() === base + "/api/child/login",
    );
    await pk.getByRole("button", { name: "Let's go!", exact: true }).click();
    await (await childLogin).finished();
    await expect(
      pk.getByRole("heading", {
        name: "Something to look forward to",
        exact: true,
      }),
    ).toBeVisible();
    await expect(pk.locator("html")).toHaveAttribute("data-theme", "mint");
    await expect(pk.locator("html")).toHaveAttribute("data-font", "accessible");
    await save(
      kid,
      {
        op: "childSettings",
        version: 1,
        appearance: state.profile.appearance,
        locationAllowed: true,
      },
      403,
    );
    const childLoc = await get(kid, "/api/location");
    assert.equal(childLoc.allowed, false);
    assert.deepEqual(childLoc.people, []);
    await post(
      kid,
      "/api/location",
      {
        action: "start",
        hours: 8,
        consent: true,
        version: 0,
        key: randomUUID(),
      },
      403,
    );
    await pk.getByRole("button", { name: "My day", exact: true }).click();
    await pk
      .getByRole("button", { name: "Make this space mine", exact: false })
      .click();
    await pk.getByLabel("Use my team's defaults").uncheck();
    await pk.getByLabel("Berry bright", { exact: true }).check();
    await pk.getByLabel("Start page", { exact: true }).selectOption("today");
    await pk
      .getByRole("button", { name: "Save app settings", exact: true })
      .click();
    await expect(pk.locator("html")).toHaveAttribute("data-theme", "berry");
    state = await get(a);
    await save(b, {
      op: "childSettings",
      version: state.childSettings!.version,
      appearance: { ...state.childSettings!.appearance, theme: "forest" },
      locationAllowed: true,
    });
    assert.equal(
      (await get(kid)).profile.appearance.theme,
      "berry",
      "Personal child settings are preserved",
    );
    await pk.getByLabel("Use my team's defaults").check();
    await pk
      .getByRole("button", { name: "Save app settings", exact: true })
      .click();
    await expect(pk.locator("html")).toHaveAttribute("data-theme", "forest");
    const profileBefore = (await get(a)).profile;
    await save(a, {
      op: "profile",
      version: profileBefore.version,
      name: "Alex Willow",
      avatar: "🌟",
      about: profileBefore.about,
      appearance: { ...profileBefore.appearance, theme: "sand" },
    });
    assert.equal(
      (await get(a)).profile.appearance.theme,
      "ocean",
      "Profile updates cannot overwrite appearance",
    );
    assert.equal(
      (await anon.request.get(base + "/api/location")).status(),
      401,
    );
    assert.equal(
      (
        await a.request.post(base + "/api/location", {
          headers: { Origin: "https://other.example" },
          data: { action: "start" },
        })
      ).status(),
      403,
    );
    await open(pa, "Family map");
    await expect(
      pa.getByRole("heading", { name: "Family map", exact: true }),
    ).toHaveCount(1);
    let location = await get(a, "/api/location");
    assert.ok(location.people.every((p: any) => !p.sharing));
    assert.ok(
      !(await get(c, "/api/location")).people.some(
        (p: any) => p.id === meA.user.id,
      ),
    );
    const wrongViewer = await a.request.post(base + "/api/location", {
      headers: { Origin: base },
      data: {
        viewer: meB.user.id,
        action: "start",
        hours: 8,
        consent: true,
        version: 0,
        key: randomUUID(),
      },
    });
    assert.equal(
      wrongViewer.status(),
      409,
      "An old screen cannot start sharing under a newly signed-in account",
    );
    assert.equal((await get(a, "/api/location")).own, null);
    await a.grantPermissions(["geolocation"], { origin: base });
    await a.setGeolocation({
      latitude: 41.8827,
      longitude: -87.6233,
      accuracy: 50000,
    });
    const geoConsent =
      "I want to share this device's location with the household's parents for the selected time.";
    await expect(
      pa.getByRole("button", {
        name: "Start sharing my location",
        exact: true,
      }),
    ).toBeDisabled();
    await pa.getByLabel(geoConsent, { exact: true }).check();
    await pa
      .getByRole("button", { name: "Start sharing my location", exact: true })
      .click();
    await expect
      .poll(async () => !!(await get(a, "/api/location")).own?.fix, {
        timeout: 15000,
      })
      .toBe(true);
    location = await get(a, "/api/location");
    assert.equal(location.own.fix.latitude, 41.8827);
    assert.equal(location.own.fix.accuracy, 50000);
    await expect(
      pa.getByText("Approximate area only.", { exact: false }),
    ).toBeVisible();
    await a.setGeolocation({
      latitude: 41.8828,
      longitude: -87.6234,
      accuracy: 10,
    });
    await expect
      .poll(async () => (await get(a, "/api/location")).own.fix.accuracy, {
        timeout: 5000,
      })
      .toBe(10);
    await a.setGeolocation({
      latitude: 38.6,
      longitude: -90.2,
      accuracy: 50000,
    });
    assert.equal(
      (await get(a, "/api/location")).own.fix.accuracy,
      10,
      "A recent precise point resists a coarse fallback",
    );

    const parentGrant = location.own.grant;
    const other = await get(b, "/api/location");
    assert.equal(other.own, null);
    assert.equal(
      other.people.find((p: any) => p.id === meA.user.id).fix.longitude,
      -87.6234,
    );
    assert.ok(!JSON.stringify(other.people).includes("grant"));
    const third = await get(c, "/api/location");
    assert.ok(!JSON.stringify(third).includes("41.8827"));
    await post(
      c,
      "/api/location",
      { action: "point", grant: parentGrant, fix: location.own.fix },
      409,
    );
    assert.deepEqual((await get(kid, "/api/location")).people, []);
    assert.ok(!JSON.stringify(await get(kid)).includes("latitude"));
    assert.ok(!JSON.stringify(await get(a)).includes("latitude"));
    if (process.env.REAL_MAP_TILES !== "1")
      await pa.route("https://tile.openstreetmap.org/**", (route) =>
        route.fulfill({
          contentType: "image/png",
          body: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=",
            "base64",
          ),
        }),
      );
    await pa
      .getByRole("button", { name: "Load family map", exact: true })
      .click();
    await expect(pa.locator(".leaflet-container")).toBeVisible();
    await expect(pa.locator(".family-map-marker")).toHaveCount(1);
    if (process.env.REAL_MAP_TILES === "1")
      await expect
        .poll(
          () =>
            pa
              .locator(".leaflet-tile")
              .evaluateAll((images) =>
                images.some(
                  (img) => (img as HTMLImageElement).naturalWidth > 1,
                ),
              ),
          { timeout: 20000 },
        )
        .toBe(true);
    console.log("PASS: family map and map tiles rendered");
    await pa.screenshot({
      path: `/tmp/team-map-${cloud ? "cloud" : "local"}${process.env.REAL_MAP_TILES === "1" ? "-real" : ""}.png`,
      fullPage: true,
    });
    if (process.env.MAP_SMOKE_ONLY === "1") {
      console.log(
        "PASS: real OpenStreetMap tiles rendered in Chromium at a fictional test position, with explicit sharing and private parent access.",
      );
      return;
    }
    await pk
      .getByRole("button", { name: "Back to my space", exact: false })
      .click();
    await pk.getByRole("button", { name: "My location", exact: true }).click();
    await expect(
      pk.getByRole("button", {
        name: "Start sharing my location",
        exact: true,
      }),
    ).toBeVisible({ timeout: 20000 });
    await pk.getByLabel(geoConsent, { exact: true }).check();
    await pk
      .getByRole("button", { name: "Start sharing my location", exact: true })
      .click();
    await expect
      .poll(async () => !!(await get(kid, "/api/location")).own?.fix, {
        timeout: 15000,
      })
      .toBe(true);
    const childPoint = await get(kid, "/api/location");
    assert.equal(childPoint.own.fix.latitude, 41.8781);
    assert.deepEqual(childPoint.people, []);
    assert.equal(
      (await get(b, "/api/location")).people.find(
        (p: any) => p.role === "child",
      ).fix.latitude,
      41.8781,
    );
    await pa.clock.setFixedTime(new Date(Date.now() + 180000));
    await expect
      .poll(async () => await pa.locator(".stale-location").count(), {
        timeout: 20000,
      })
      .toBeGreaterThan(0);
    await pa.clock.setFixedTime(new Date());
    state = await get(a);
    await save(a, {
      op: "childSettings",
      version: state.childSettings!.version,
      appearance: state.childSettings!.appearance,
      locationAllowed: false,
    });
    assert.equal((await get(kid, "/api/location")).own, null);
    await post(
      kid,
      "/api/location",
      { action: "point", grant: childPoint.own.grant, fix: childPoint.own.fix },
      409,
    );
    await pa.evaluate(() => {
      const original = navigator.geolocation.clearWatch.bind(
        navigator.geolocation,
      );
      (window as any).__clearedLocationWatch = 0;
      navigator.geolocation.clearWatch = (id: number) => {
        (window as any).__clearedLocationWatch++;
        original(id);
      };
    });
    await pa.route("**/api/location", (route) => {
      if (
        route.request().method() === "POST" &&
        route.request().postDataJSON()?.action === "stop"
      )
        return route.abort("failed");
      return route.continue();
    });
    await pa
      .getByRole("button", {
        name: "Stop sharing & remove my point",
        exact: true,
      })
      .click();
    await expect(
      pa.getByRole("alert").filter({ hasText: "This device stopped updating" }),
    ).toBeVisible();
    assert.ok(
      await pa.evaluate(() => (window as any).__clearedLocationWatch > 0),
      "Offline Stop immediately clears the GPS watcher",
    );
    assert.ok(
      (await get(a, "/api/location")).own,
      "The UI explains that the server still has the last point",
    );
    await pa.unroute("**/api/location");
    location = await get(a, "/api/location");
    const update = {
      action: "point",
      viewer: meA.user.id,
      grant: parentGrant,
      fix: { ...location.own.fix, capturedAt: Date.now() },
    };
    const stopBody = {
      action: "stop",
      viewer: meA.user.id,
      version: location.controlVersion,
      key: randomUUID(),
    };
    const races = await Promise.all([
      a.request.post(base + "/api/location", {
        headers: { Origin: base },
        data: update,
      }),
      a.request.post(base + "/api/location", {
        headers: { Origin: base },
        data: stopBody,
      }),
    ]);
    assert.ok([200, 409].includes(races[0].status()));
    assert.equal(races[1].status(), 200);
    assert.equal((await get(a, "/api/location")).own, null);
    await post(a, "/api/location", update, 409);
    for (const p of [pa, pk]) {
      await p.setViewportSize({ width: 320, height: 844 });
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
        "Mobile layout fits 320px",
      );
    }
    console.log(
      "PASS: privacy, disconnected Stop and stale update checks; restarting",
    );
    const expiryContext = await browser!.newContext({
      viewport: { width: 390, height: 844 },
      permissions: ["geolocation"],
      geolocation: { latitude: 41.881, longitude: -87.625, accuracy: 20 },
    });
    await expiryContext.addCookies(await b.cookies());
    const expiryPage = await expiryContext.newPage();
    await expiryPage.clock.install();
    await expiryPage.goto(base);
    await expect(
      expiryPage.getByRole("button", { name: "Sign out", exact: true }),
    ).toBeVisible();
    await open(expiryPage, "Family map");
    await expiryPage.getByLabel("Share for", { exact: true }).selectOption("1");
    await expiryPage.getByLabel(geoConsent, { exact: true }).check();
    await expiryPage
      .getByRole("button", { name: "Start sharing my location", exact: true })
      .click();
    await expect
      .poll(async () => !!(await get(b, "/api/location")).own?.fix, {
        timeout: 15000,
      })
      .toBe(true);
    await expiryPage.evaluate(() => {
      const original = navigator.geolocation.clearWatch.bind(
        navigator.geolocation,
      );
      (window as any).__expiryClears = 0;
      navigator.geolocation.clearWatch = (id: number) => {
        (window as any).__expiryClears++;
        original(id);
      };
    });
    await expiryPage.route("**/api/location", (route) => route.abort("failed"));
    await expiryPage.clock.fastForward(3600001);
    await expect
      .poll(() => expiryPage.evaluate(() => (window as any).__expiryClears), {
        timeout: 5000,
      })
      .toBeGreaterThan(0);
    assert.equal(
      await expiryPage.evaluate(
        (id) => localStorage.getItem("team-location-grant:" + id),
        meB.user.id,
      ),
      null,
      "The local expiry timer stops GPS even without a server connection",
    );
    await expiryContext.close();
    const bLocation = await get(b, "/api/location");
    await post(b, "/api/location", {
      action: "stop",
      version: bLocation.controlVersion,
      key: randomUUID(),
    });
    await stop();
    start();
    await ready();
    console.log("Ready after restart");
    assert.equal((await get(a, "/api/location")).own, null);
    assert.equal((await get(kid, "/api/location")).own, null);
    assert.equal((await get(a)).profile.appearance.theme, "ocean");
    if (mock) assert.equal(existsSync(temp + "/data/family.sqlite"), false);
    console.log(
      `PASS: ${cloud ? "Supabase SDK/Postgres fixture" : "SQLite"} separate profile/settings, customization persistence/isolation/conflicts, child defaults and overrides, opt-in device GPS, private family map, child and third-household denial, stale labels, stop/update races, guardian revocation, and restart persistence.`,
    );
  })();
} catch (e) {
  console.error(log);
  for (const page of debugPages) {
    try {
      console.error(
        (await page.locator("body").innerText({ timeout: 1000 })).slice(
          0,
          1800,
        ),
      );
    } catch {}
  }
  throw e;
} finally {
  await browser?.close();
  await stop();
  await mock?.close();
  rmSync(temp, { recursive: true, force: true });
}
