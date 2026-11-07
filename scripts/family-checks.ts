import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { expect, type Browser, type Page } from "@playwright/test";
import type {
  FamilyKind,
  FamilyData,
  FamilyDetail,
  FamilyList,
  GiftData,
  InfoData,
} from "../lib/family-types";
export async function checkFamilyApi(
  base: string,
  a: string,
  b: string,
  c: string,
  dir: string,
) {
  const get = (kind: FamilyKind, url = "", cookie = a) =>
    fetch(base + "/api/family/" + kind + url, { headers: { cookie } });
  const post = (
    kind: FamilyKind,
    url: string,
    body: object,
    cookie = a,
    origin = base,
  ) =>
    fetch(base + "/api/family/" + kind + url, {
      method: "POST",
      headers: { cookie, origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const fixtures: Record<FamilyKind, FamilyData> = {
    gifts: {
      title: "API birthday entry",
      type: "money_in",
      date: "2026-11-06",
      from: "Aunt Rowan",
      occasion: "Birthday",
      amountCents: 10000,
      thankYou: false,
      note: "Fictional test money.",
    },
    routines: {
      title: "API morning task",
      type: "routine",
      days: [0, 1, 2, 3, 4, 5, 6],
      time: "07:30",
      home: "both",
      note: "Fictional routine.",
    },
    info: {
      title: "API health card",
      category: "health",
      details: "Fictional storybook pollen note.",
      important: true,
    },
  };
  const invalid: Record<FamilyKind, object[]> = {
    gifts: [
      { amountCents: -1 },
      { amountCents: 1.5 },
      { amountCents: null },
      { date: "2026-02-31" },
      { type: ["gift"] },
    ],
    routines: [
      { days: [] },
      { days: [1, 1] },
      { home: "jordan" },
      { time: "25:00" },
      { type: ["routine"] },
    ],
    info: [
      { details: "" },
      { details: "x".repeat(4001) },
      { category: ["health"] },
    ],
  };
  const ids: Record<FamilyKind, string> = { gifts: "", routines: "", info: "" };
  for (const kind of ["gifts", "routines", "info"] as const) {
    for (const bad of invalid[kind])
      assert.equal(
        (
          await post(kind, "", {
            data: { ...fixtures[kind], ...bad },
            key: randomUUID(),
          })
        ).status,
        400,
      );
    const key = randomUUID();
    const results = await Promise.all([
      post(kind, "", { data: fixtures[kind], key }),
      post(kind, "", { data: fixtures[kind], key }),
    ]);
    assert.ok(results.every((r) => [200, 201].includes(r.status)));
    const item = (await results[0].json()) as FamilyDetail;
    assert.equal((await results[1].json()).record.id, item.record.id);
    ids[kind] = item.record.id;
    assert.equal(item.events.length, 1);
    assert.equal(item.events[0].actor, "Alex Willow");
    for (const cookie of [c, ""]) {
      const list = await get(kind, "", cookie);
      assert.equal(list.status, cookie ? 200 : 401);
      if (cookie) assert.deepEqual((await list.json()).records, []);
      for (const suffix of ["", "/timeline"])
        assert.equal(
          (await get(kind, "/" + ids[kind] + suffix, cookie)).status,
          cookie ? 404 : 401,
        );
      assert.equal(
        (
          await post(
            kind,
            "/" + ids[kind],
            { action: "archive", version: 1, key: randomUUID() },
            cookie,
          )
        ).status,
        cookie ? 404 : 401,
      );
    }
    assert.equal(
      (
        await post(
          kind,
          "/" + ids[kind],
          { action: "archive", version: 1, key: randomUUID() },
          a,
          "https://other.example",
        )
      ).status,
      403,
    );
    const changed = {
      ...fixtures[kind],
      title: fixtures[kind].title + " revised",
    };
    const edit = {
      action: "edit",
      version: 1,
      data: changed,
      key: randomUUID(),
      actor: "alex",
    };
    assert.equal((await post(kind, "/" + ids[kind], edit, b)).status, 200);
    const edited = (await (
      await get(kind, "/" + ids[kind])
    ).json()) as FamilyDetail;
    assert.equal(edited.events[1].actor, "Sam Willow");
    assert.equal(edited.events[0].snapshot.data.title, fixtures[kind].title);
    assert.equal(
      (await post(kind, "/" + ids[kind], { ...edit, key: randomUUID() }, a))
        .status,
      409,
    );
  }
  assert.equal((await get("info", "/" + ids.gifts)).status, 404);
  const addGift = async (data: object) => {
    const r = await post("gifts", "", { data, key: randomUUID() });
    assert.equal(r.status, 201);
    return ((await r.json()) as FamilyDetail).record;
  };
  const physical = await addGift({
    ...fixtures.gifts,
    title: "API toy bicycle",
    type: "gift",
    amountCents: 50000,
  });
  const spent = await addGift({
    ...fixtures.gifts,
    title: "API book purchase",
    type: "money_out",
    amountCents: 1234,
  });
  assert.deepEqual((await (await get("gifts")).json()).totals, {
    receivedCents: 10000,
    spentCents: 1234,
    balanceCents: 8766,
  });
  const archive = {
    action: "archive",
    version: spent.version,
    key: randomUUID(),
  };
  const archives = await Promise.all([
    post("gifts", "/" + spent.id, archive),
    post("gifts", "/" + spent.id, archive),
  ]);
  archives.forEach((r) => assert.equal(r.status, 200));
  assert.equal((await (await get("gifts")).json()).totals.balanceCents, 10000);
  const ar = (await (
    await get("gifts", "/" + spent.id)
  ).json()) as FamilyDetail;
  assert.equal(
    (
      await post("gifts", "/" + spent.id, {
        action: "edit",
        version: ar.record.version,
        data: fixtures.gifts,
        key: randomUUID(),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await post("gifts", "/" + spent.id, {
        action: "restore",
        version: ar.record.version,
        key: randomUUID(),
      })
    ).status,
    200,
  );
  assert.equal((await (await get("gifts")).json()).totals.balanceCents, 8766);
  let routine = (await (
    await get("routines", "/" + ids.routines)
  ).json()) as FamilyDetail;
  const yesterday = new Date(
    Date.parse(routine.context.day + "T12:00:00Z") - 86400000,
  )
    .toISOString()
    .slice(0, 10);
  const fixtureDb = new DatabaseSync(path.join(dir, "family.sqlite"), {
    timeout: 5000,
  });
  fixtureDb
    .prepare("INSERT INTO routine_checks VALUES(?,?,1,1,?,?)")
    .run(ids.routines, yesterday, "alex", new Date().toISOString());
  fixtureDb.close();
  routine = await (await get("routines", "/" + ids.routines)).json();
  assert.equal(routine.record.check!.checked, false);
  assert.equal(routine.checks[0].day, yesterday);
  const check = {
    action: "check",
    version: routine.record.version,
    day: routine.context.day,
    dayVersion: 0,
    timezoneVersion: routine.context.timezoneVersion,
    checked: true,
    key: randomUUID(),
  };
  const checks = await Promise.all([
    post("routines", "/" + ids.routines, check, b),
    post("routines", "/" + ids.routines, check, b),
  ]);
  checks.forEach((r) => assert.equal(r.status, 200));
  routine = await (await get("routines", "/" + ids.routines)).json();
  assert.equal(routine.record.check!.actor, "Sam Willow");
  assert.equal(routine.events.filter((e) => e.action === "checked").length, 1);
  assert.equal(
    (
      await post("routines", "/" + ids.routines, {
        ...check,
        key: randomUUID(),
        checked: false,
      })
    ).status,
    409,
  );
  const uncheck = {
    ...check,
    dayVersion: 1,
    checked: false,
    key: randomUUID(),
  };
  assert.equal(
    (await post("routines", "/" + ids.routines, uncheck, a)).status,
    200,
  );
  assert.equal(
    (await post("routines", "/" + ids.routines, uncheck, a)).status,
    200,
  );
  assert.equal(
    (
      await post("routines", "/" + ids.routines, {
        ...check,
        day: yesterday,
        dayVersion: 1,
        key: randomUUID(),
      })
    ).status,
    409,
  );
  routine = await (await get("routines", "/" + ids.routines)).json();
  const originalSchedule = routine.record.data;
  assert.equal(
    (
      await post("routines", "/" + ids.routines, {
        action: "edit",
        version: routine.record.version,
        data: {
          ...originalSchedule,
          days: [(routine.context.weekday + 1) % 7],
        },
        key: randomUUID(),
      })
    ).status,
    200,
  );
  routine = await (await get("routines", "/" + ids.routines)).json();
  assert.equal(routine.record.scheduledToday, false);
  assert.equal(
    (
      await post("routines", "/" + ids.routines, {
        ...check,
        version: routine.record.version,
        dayVersion: 2,
        key: randomUUID(),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await post("routines", "/" + ids.routines, {
        action: "edit",
        version: routine.record.version,
        data: originalSchedule,
        key: randomUUID(),
      })
    ).status,
    200,
  );
  routine = await (await get("routines", "/" + ids.routines)).json();
  check.version = routine.record.version;
  const tz = {
    timezone: "UTC",
    version: routine.context.timezoneVersion,
    key: randomUUID(),
  };
  assert.equal((await post("routines", "/timezone", tz, b)).status, 200);
  assert.equal((await post("routines", "/timezone", tz, b)).status, 200);
  assert.equal(
    (
      await post("routines", "/" + ids.routines, {
        ...check,
        dayVersion: 2,
        key: randomUUID(),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await post("routines", "/timezone", {
        ...tz,
        timezone: "Not/AZone",
        key: randomUUID(),
      })
    ).status,
    400,
  );
  const newContext = ((await (await get("routines")).json()) as FamilyList)
    .context;
  assert.equal(
    (await (await get("routines", "", c)).json()).context.timezoneVersion,
    0,
  );
  assert.equal(
    (
      await post(
        "routines",
        "/timezone",
        {
          timezone: "America/Chicago",
          version: newContext.timezoneVersion,
          key: randomUUID(),
        },
        a,
      )
    ).status,
    200,
  );
  const profile = (await (
    await get("info", "/" + ids.info)
  ).json()) as FamilyDetail;
  const race = await Promise.all([
    post(
      "info",
      "/" + ids.info,
      {
        action: "edit",
        version: profile.record.version,
        data: { ...profile.record.data, details: "First parent revision." },
        key: randomUUID(),
      },
      a,
    ),
    post(
      "info",
      "/" + ids.info,
      {
        action: "edit",
        version: profile.record.version,
        data: { ...profile.record.data, details: "Second parent revision." },
        key: randomUUID(),
      },
      b,
    ),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  for (const [kind, id] of [
    ...Object.entries(ids),
    ["gifts", physical.id],
    ["gifts", spent.id],
  ] as [FamilyKind, string][]) {
    const detail = (await (await get(kind, "/" + id)).json()) as FamilyDetail;
    assert.equal(
      (
        await post(kind, "/" + id, {
          action: "archive",
          version: detail.record.version,
          key: randomUUID(),
        })
      ).status,
      200,
    );
  }
  assert.equal((await (await get("gifts")).json()).totals.balanceCents, 0);
  console.log(
    "PASS: family-record household/anonymous access, validation, integer money totals, physical gift exclusion, archive/restore, concurrent/stale edits, duplicate mutations, routine daily reset/history, timezone changes, and server-owned activity.",
  );
  return ids;
}
async function signIn(page: Page, base: string, email: string) {
  await page.goto(base);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Backpack-demo-26!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
}
async function section(page: Page, name: string) {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page
    .getByRole("navigation", { name: "More sections" })
    .getByRole("button", { name, exact: true })
    .click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}
async function card(page: Page, title: string) {
  await page
    .getByRole("button")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
    .click();
}
const balance = (page: Page) =>
  page
    .getByRole("region", { name: "Recorded cash totals" })
    .locator("strong")
    .last();
export async function checkFamilyBrowsers(
  browser: Browser,
  base: string,
  otherBase: string,
) {
  const ca = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "en-US",
      timezoneId: "America/Chicago",
    }),
    cb = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "en-US",
      timezoneId: "America/Denver",
    }),
    cc = await browser.newContext();
  try {
    const pa = await ca.newPage(),
      pb = await cb.newPage(),
      pc = await cc.newPage();
    const renderingErrors: string[] = [];
    for (const page of [pa, pb, pc])
      page.on("console", (message) => {
        if (
          message.type() === "error" &&
          /same key|unique.*key/i.test(message.text())
        )
          renderingErrors.push(message.text());
      });
    await signIn(pa, base, "alex@example.test");
    await signIn(pb, otherBase, "sam@example.test");
    await signIn(pc, base, "jordan@example.test");
    await section(pa, "Gifts & money");
    await pa
      .getByRole("button", { name: "Add gift or money", exact: true })
      .click();
    await pa.getByLabel("Entry title").fill("Birthday money");
    await pa.getByLabel("Entry type").selectOption("money_in");
    await pa.getByLabel("From").fill("Aunt Rowan");
    await pa.getByLabel("Occasion").fill("Birthday");
    await pa.getByLabel("Amount in USD", { exact: true }).fill("50.00");
    await pa.getByRole("button", { name: "Save record" }).click();
    await expect(
      pa.getByRole("heading", { name: "Birthday money", exact: true }),
    ).toBeVisible();
    await section(pb, "Gifts & money");
    await expect(balance(pb)).toHaveText("$50.00", { timeout: 10000 });
    await card(pb, "Birthday money");
    await pb.getByRole("button", { name: "Edit record", exact: true }).click();
    await pb.getByLabel("Amount in USD", { exact: true }).fill("55.00");
    await pb.getByLabel("Thank-you sent").check();
    await pb.getByRole("button", { name: "Save record" }).click();
    await expect(pa.locator(".family-section > .entry-amount")).toHaveText(
      "$55.00",
      { timeout: 10000 },
    );
    await expect(
      pa.locator(".family-section > p").filter({ hasText: "Thank-you: Sent" }),
    ).toBeVisible();
    await pa.getByRole("button", { name: /Back to Gifts/ }).click();
    await pb.getByRole("button", { name: /Back to Gifts/ }).click();
    await pa
      .getByRole("button", { name: "Add gift or money", exact: true })
      .click();
    await pa.getByLabel("Entry title").fill("Book purchase");
    await pa.getByLabel("Entry type").selectOption("money_out");
    await pa.getByLabel("Amount in USD", { exact: true }).fill("12.34");
    await pa.getByRole("button", { name: "Save record" }).click();
    await pa.getByRole("button", { name: /Back to Gifts/ }).click();
    await expect(balance(pa)).toHaveText("$42.66");
    await expect(balance(pb)).toHaveText("$42.66", { timeout: 10000 });
    await card(pa, "Book purchase");
    await pa
      .getByRole("button", { name: "Archive record", exact: true })
      .click();
    await pa.getByRole("button", { name: "Confirm archive" }).click();
    await expect(balance(pb)).toHaveText("$55.00", { timeout: 10000 });
    await pa.getByRole("button", { name: "Restore record" }).click();
    await expect(balance(pb)).toHaveText("$42.66", { timeout: 10000 });
    await pb.screenshot({ path: "/tmp/two-homes-gifts.png", fullPage: true });
    await section(pa, "Routines & chores");
    await pa
      .getByRole("button", { name: "Add routine or chore", exact: true })
      .click();
    await pa.getByLabel("Task name").fill("Brush teeth");
    await pa.getByLabel("Time", { exact: false }).fill("07:30");
    await pa.getByLabel("Task instructions").fill("Use the small blue brush.");
    await pa.getByRole("button", { name: "Save record" }).click();
    await expect(
      pa.getByRole("heading", { name: "Brush teeth", exact: true }),
    ).toBeVisible();
    await section(pb, "Routines & chores");
    await expect(
      pb.getByRole("checkbox", { name: "Brush teeth", exact: true }),
    ).toBeVisible();
    const brush = (
      (await (
        await cb.request.get(otherBase + "/api/family/routines")
      ).json()) as FamilyList
    ).records.find((r) => r.data.title === "Brush teeth")!;
    const pattern = "**/api/family/routines/" + brush.id;
    await pb.route(pattern, async (route) => {
      if (route.request().method() === "POST")
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            error: "Checklist changed in another session. Try again.",
          }),
        });
      else await route.continue();
    });
    await pb
      .getByRole("checkbox", { name: "Brush teeth", exact: true })
      .click();
    await expect(
      pb
        .getByRole("alert")
        .filter({ hasText: "Checklist changed in another session" }),
    ).toBeVisible();
    await expect(
      pb.getByRole("checkbox", { name: "Brush teeth", exact: true }),
    ).not.toBeChecked();
    await pb.unroute(pattern);
    await pb
      .getByRole("checkbox", { name: "Brush teeth", exact: true })
      .check();
    await expect(
      pb.getByRole("heading", { name: "Routines & chores", exact: true }),
    ).toBeVisible();
    await expect(
      pa.getByRole("checkbox", { name: "Brush teeth", exact: true }),
    ).toBeChecked({ timeout: 10000 });
    await pa
      .getByRole("checkbox", { name: "Brush teeth", exact: true })
      .uncheck();
    await expect(
      pb.getByRole("checkbox", { name: "Brush teeth", exact: true }),
    ).not.toBeChecked({ timeout: 10000 });
    await pa.getByRole("button", { name: "Edit record", exact: true }).click();
    await pa.getByLabel("Applies at").selectOption("alex");
    await pa.getByLabel("Time", { exact: false }).fill("08:00");
    await pa.getByRole("button", { name: "Save record" }).click();
    await pa.getByRole("button", { name: /Back to Routines/ }).click();
    await pa
      .getByRole("button", { name: "Add routine or chore", exact: true })
      .click();
    await pa.getByLabel("Task name").fill("Put toys away");
    await pa.getByLabel("Task type").selectOption("chore");
    await pa.getByLabel("Repeats").selectOption("weekly");
    const routines = (await (
      await ca.request.get(base + "/api/family/routines")
    ).json()) as FamilyList;
    const weekday = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ][routines.context.weekday];
    await pa.getByRole("checkbox", { name: weekday, exact: true }).uncheck();
    await pa.getByRole("button", { name: "Save record" }).click();
    await expect(
      pa.getByRole("alert").filter({ hasText: "Choose at least one weekday" }),
    ).toBeVisible();
    await expect(pa.getByLabel("Task name")).toHaveValue("Put toys away");
    await pa.getByRole("checkbox", { name: weekday, exact: true }).check();
    await pa.getByRole("button", { name: "Save record" }).click();
    await pa.getByRole("button", { name: /Back to Routines/ }).click();
    await expect(
      pb.getByRole("checkbox", { name: "Put toys away", exact: true }),
    ).toBeVisible({ timeout: 10000 });
    await pb.getByLabel("Show homes").selectOption("alex");
    await expect(
      pb.getByRole("checkbox", { name: "Brush teeth", exact: true }),
    ).toBeVisible();
    await expect(
      pb.getByRole("checkbox", { name: "Put toys away", exact: true }),
    ).toBeVisible();
    await pb.getByLabel("Show homes").selectOption("sam");
    await expect(
      pb.getByRole("checkbox", { name: "Brush teeth", exact: true }),
    ).toHaveCount(0);
    await expect(
      pb.getByRole("checkbox", { name: "Put toys away", exact: true }),
    ).toBeVisible();
    await pa.getByRole("button", { name: "Edit time zone" }).click();
    await pa.getByLabel("Routine time zone").fill("Not/AZone");
    await pa
      .getByRole("button", { name: "Save time zone", exact: true })
      .click();
    await expect(
      pa.getByRole("alert").filter({ hasText: "IANA time zone" }),
    ).toBeVisible();
    await expect(pa.getByLabel("Routine time zone")).toHaveValue("Not/AZone");
    await pa.getByLabel("Routine time zone").fill("America/Denver");
    await pa
      .getByRole("button", { name: "Save time zone", exact: true })
      .click();
    await expect(pb.locator(".routine-day")).toContainText("America/Denver", {
      timeout: 10000,
    });
    await pb.screenshot({
      path: "/tmp/two-homes-routines.png",
      fullPage: true,
    });
    await section(pa, "Health & personal info");
    await pa.getByRole("button", { name: "Add info card" }).click();
    await pa.getByLabel("Info title").fill("Allergies");
    await pa
      .getByLabel("Details", { exact: true })
      .fill("Fictional storybook pollen note.");
    await pa.getByLabel("Mark as important").check();
    await pa.getByRole("button", { name: "Save record" }).click();
    await section(pb, "Health & personal info");
    await expect(
      pb.getByRole("heading", { name: "Allergies", exact: true }),
    ).toBeVisible({ timeout: 10000 });
    await card(pb, "Allergies");
    await pa.getByRole("button", { name: "Edit record", exact: true }).click();
    await pa.getByLabel("Details", { exact: true }).fill("Keep this draft.");
    await pb.getByRole("button", { name: "Edit record", exact: true }).click();
    await pb
      .getByLabel("Details", { exact: true })
      .fill("Updated fictional pollen note.");
    await pb.getByRole("button", { name: "Save record" }).click();
    await expect(
      pa.getByText("This record changed while you were editing."),
    ).toBeVisible({ timeout: 10000 });
    await expect(pa.getByLabel("Details", { exact: true })).toHaveValue(
      "Keep this draft.",
    );
    await expect(
      pa.getByRole("button", { name: "Save record" }),
    ).toBeDisabled();
    await pa
      .getByRole("button", { name: "Discard my draft and load latest details" })
      .click();
    await expect(pa.getByLabel("Details", { exact: true })).toHaveValue(
      "Updated fictional pollen note.",
    );
    await pa
      .getByLabel("Details", { exact: true })
      .fill("Reviewed fictional allergy note.");
    await pa.getByRole("button", { name: "Save record" }).click();
    await expect(pb.locator(".family-section > .preserve-lines")).toHaveText(
      "Reviewed fictional allergy note.",
      { timeout: 10000 },
    );
    await pa.getByRole("button", { name: /Back to Health/ }).click();
    await pa.getByRole("button", { name: "Add info card" }).click();
    await pa.getByLabel("Info title").fill("About Bill");
    await pa.getByLabel("Category", { exact: true }).selectOption("personal");
    await pa
      .getByLabel("Details", { exact: true })
      .fill("Fictional child: shirts size 6; favorite color green.");
    await pa.getByRole("button", { name: "Save record" }).click();
    await pa.getByRole("button", { name: /Back to Health/ }).click();
    await expect(
      pa
        .locator(".cards > .card")
        .first()
        .getByRole("heading", { name: "Allergies", exact: true }),
    ).toBeVisible();
    await pb.getByRole("button", { name: /Back to Health/ }).click();
    await pb.getByLabel("Show category").selectOption("personal");
    await expect(
      pb.getByRole("heading", { name: "About Bill", exact: true }),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      pb.getByRole("heading", { name: "Allergies", exact: true }),
    ).toHaveCount(0);
    await pa.screenshot({ path: "/tmp/two-homes-health.png", fullPage: true });
    for (const title of [
      "Gifts & money",
      "Routines & chores",
      "Health & personal info",
    ]) {
      await section(pc, title);
      await expect(
        pc.getByRole("heading", { name: title, exact: true }),
      ).toBeVisible();
      await expect(
        pc.getByText("Reviewed fictional allergy note.", { exact: true }),
      ).toHaveCount(0);
    }
    for (const width of [390, 320]) {
      await pa.setViewportSize({ width, height: 844 });
      assert.equal(
        await pa.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await pa.getByRole("button", { name: "More", exact: true }).click();
      for (const title of [
        "Gifts & money",
        "Routines & chores",
        "Health & personal info",
        "Paper history",
      ])
        await expect(
          pa
            .getByRole("navigation", { name: "More sections" })
            .getByRole("button", { name: title, exact: true }),
        ).toBeVisible();
      assert.equal(
        await pa.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await pa.getByRole("button", { name: "More", exact: true }).click();
    }
    const privateInfo = (
      (await (
        await ca.request.get(base + "/api/family/info")
      ).json()) as FamilyList
    ).records.find((r) => r.data.title === "Allergies")!;
    assert.equal(
      (
        await ca.request.post(base + "/api/login", {
          data: { email: "jordan@example.test", password: "Backpack-demo-26!" },
        })
      ).status(),
      200,
    );
    await expect(
      pa.getByRole("heading", { name: "Today", exact: true }),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      pa.getByText("Reviewed fictional allergy note.", { exact: true }),
    ).toHaveCount(0);
    await section(pa, "Health & personal info");
    await expect(
      pa.getByRole("heading", { name: "Nothing added yet", exact: true }),
    ).toBeVisible();
    assert.equal(
      (
        await ca.request.get(base + "/api/family/info/" + privateInfo.id)
      ).status(),
      404,
    );
    assert.deepEqual(
      renderingErrors,
      [],
      "Family screens should render without duplicate React keys.",
    );
    console.log(
      "PASS: family sections in independent sessions, cash totals and thank-yous, archiving/restoring, editable daily/weekly chores, synchronized checkoffs and home filters, timezone settings, editable/private health and personal cards, conflict drafts, and 320/390px More navigation.",
    );
  } finally {
    await ca.close();
    await cb.close();
    await cc.close();
  }
}
