import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { expect, type Browser, type Page } from "@playwright/test";
import type { PickupDetail } from "../lib/pickup-types";

export async function checkPickupApi(
  base: string,
  a: string,
  b: string,
  c: string,
) {
  const get = (url: string, cookie = a) =>
    fetch(base + "/api/pickups" + url, { headers: { cookie } });
  const post = (url: string, body: object, cookie = a, origin = base) =>
    fetch(base + "/api/pickups" + url, {
      method: "POST",
      headers: { cookie, origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const draft = {
    title: "Library handoff",
    scheduled_at: "2060-05-10T20:15:00.000Z",
    location: "Willow Primary, front gate",
    assignee: "sam",
    note: "Bring the blue folder.",
  };
  for (const invalid of [
    { assignee: "jordan" },
    { scheduled_at: "not a date" },
    { scheduled_at: "2060-02-31T20:15:00.000Z" },
    { location: "" },
    { note: "x".repeat(501) },
  ])
    assert.equal(
      (await post("", { ...draft, ...invalid, key: randomUUID() })).status,
      400,
    );
  const createKey = randomUUID();
  const created = await Promise.all([
    post("", { ...draft, key: createKey }),
    post("", { ...draft, key: createKey }),
  ]);
  assert.ok(created.every((r) => [200, 201].includes(r.status)));
  const item = (await created[0].json()) as PickupDetail;
  assert.equal((await created[1].json()).id, item.id);
  assert.equal(item.events.length, 1);
  assert.equal(item.events[0].actor, "Alex Willow");
  assert.equal(
    (await (await get("/" + item.id, b)).json()).scheduled_at,
    draft.scheduled_at,
  );
  for (const cookie of [c, ""]) {
    assert.equal((await get("", cookie)).status, cookie ? 200 : 401);
    if (cookie) assert.deepEqual(await (await get("", cookie)).json(), []);
    for (const suffix of ["", "/timeline"])
      assert.equal(
        (await get("/" + item.id + suffix, cookie)).status,
        cookie ? 404 : 401,
      );
    assert.equal(
      (
        await post(
          "/" + item.id,
          { action: "complete", version: 1, key: randomUUID() },
          cookie,
        )
      ).status,
      cookie ? 404 : 401,
    );
  }
  assert.equal(
    (
      await post(
        "/" + item.id,
        { action: "complete", version: 1, key: randomUUID() },
        a,
        "https://other.example",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await post(
        "/" + item.id,
        {
          ...draft,
          assignee: "jordan",
          action: "edit",
          version: 1,
          key: randomUUID(),
        },
        b,
      )
    ).status,
    400,
  );
  const editKey = randomUUID();
  const edits = await Promise.all([
    post(
      "/" + item.id,
      {
        ...draft,
        location: "Side gate",
        assignee: "alex",
        action: "edit",
        version: 1,
        key: editKey,
        actor: "alex",
      },
      b,
    ),
    post(
      "/" + item.id,
      {
        ...draft,
        location: "Old screen",
        action: "edit",
        version: 1,
        key: randomUUID(),
      },
      a,
    ),
  ]);
  assert.deepEqual(edits.map((r) => r.status).sort(), [200, 409]);
  const current = (await (await get("/" + item.id)).json()) as PickupDetail;
  assert.equal(current.version, 2);
  assert.equal(current.events.length, 2);
  // The server, not a client-supplied actor field, owns event attribution.
  const winningActor = edits[0].status === 200 ? "Sam Willow" : "Alex Willow";
  assert.equal(current.events[1].actor, winningActor);
  assert.equal(
    (
      await post(
        "/" + item.id,
        { ...draft, action: "edit", version: 1, key: randomUUID() },
        b,
      )
    ).status,
    409,
  );
  const complete = { action: "complete", version: 2, key: randomUUID() };
  const twice = await Promise.all([
    post("/" + item.id, complete, b),
    post("/" + item.id, complete, b),
  ]);
  twice.forEach((r) => assert.equal(r.status, 200));
  assert.equal(
    (
      await post(
        "/" + item.id,
        { ...draft, action: "edit", version: 2, key: randomUUID() },
        a,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await post(
        "/" + item.id,
        { action: "cancel", version: 3, key: randomUUID() },
        a,
      )
    ).status,
    409,
  );
  const done = (await (await get("/" + item.id)).json()) as PickupDetail;
  assert.equal(done.status, "completed");
  assert.deepEqual(
    done.events.map((e) => e.action),
    ["created", "edited", "completed"],
  );
  assert.equal(done.events[2].actor, "Sam Willow");
  assert.equal(done.events[0].snapshot.location, draft.location);
  const otherIds: string[] = [];
  for (const scheduled_at of [
    "2060-05-11T20:15:00.000Z",
    "2020-01-01T15:00:00.000Z",
  ]) {
    const r = await post("", { ...draft, scheduled_at, key: randomUUID() });
    assert.equal(r.status, 201);
    otherIds.push((await r.json()).id);
  }
  const list = (await (await get("", b)).json()) as PickupDetail[];
  assert.deepEqual(
    list.map((p) => p.scheduled_at),
    [
      "2020-01-01T15:00:00.000Z",
      draft.scheduled_at,
      "2060-05-11T20:15:00.000Z",
    ],
  );
  for (const id of otherIds) {
    const cancel = { action: "cancel", version: 1, key: randomUUID() };
    assert.equal((await post("/" + id, cancel, b)).status, 200);
    assert.equal((await post("/" + id, cancel, b)).status, 200);
    assert.equal(
      (
        await post(
          "/" + id,
          { ...draft, action: "edit", version: 1, key: randomUUID() },
          a,
        )
      ).status,
      409,
    );
  }
  console.log(
    "PASS: pickup household/anonymous isolation, validation, ordering, immutable activity, concurrent edits, duplicate create/completion/cancellation, actor identity, and final-state protection.",
  );
  return { id: item.id, scheduled_at: done.scheduled_at };
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
async function openCard(page: Page, title: string) {
  await page
    .getByRole("button")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
    .click();
}
export async function checkPickupBrowsers(
  browser: Browser,
  base: string,
  otherBase: string,
) {
  const ca = await browser.newContext({
      viewport: { width: 390, height: 844 },
      timezoneId: "America/Chicago",
      locale: "en-US",
    }),
    cb = await browser.newContext({
      viewport: { width: 390, height: 844 },
      timezoneId: "America/Denver",
      locale: "en-US",
    }),
    cc = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const pa = await ca.newPage(),
      pb = await cb.newPage(),
      pc = await cc.newPage();
    await signIn(pa, base, "alex@example.test");
    await signIn(pb, otherBase, "sam@example.test");
    await signIn(pc, base, "jordan@example.test");
    await pa.getByRole("button", { name: "Pickups", exact: true }).click();
    await expect(
      pa.getByRole("heading", { name: "No pickups planned yet" }),
    ).toBeVisible();
    await pa.getByRole("button", { name: "Add pickup", exact: false }).click();
    await pa.getByLabel("Date and time").fill("2060-05-10T15:15");
    await pa.getByLabel("Pickup location").fill("Willow Primary, front gate");
    await pa.getByLabel("Who’s picking up?").selectOption("sam");
    await pa.getByLabel("Pickup note").fill("Bring the blue folder.");
    await pa.getByLabel("Date and time").fill("2027-03-14T02:30");
    await pa.getByRole("button", { name: "Add pickup", exact: true }).click();
    await expect(
      pa.getByRole("alert").filter({ hasText: "the clocks change" }),
    ).toBeVisible();
    await expect(pa.getByLabel("Pickup note")).toHaveValue(
      "Bring the blue folder.",
    );
    await pa.getByLabel("Date and time").fill("2060-05-10T15:15");
    await pa.getByRole("button", { name: "Add pickup", exact: true }).click();
    await expect(
      pa.getByRole("heading", { name: "School pickup", exact: true }),
    ).toBeVisible();
    await expect(pb.getByRole("region", { name: "Next pickup" })).toContainText(
      "Sam Willow is picking up",
      { timeout: 10000 },
    );
    await pb.getByRole("button", { name: "View pickups" }).click();
    await openCard(pb, "School pickup");
    const rows = (await (
      await ca.request.get(base + "/api/pickups")
    ).json()) as PickupDetail[];
    const item = rows.find((p) => p.status === "scheduled")!;
    assert.equal(item.scheduled_at, "2060-05-10T20:15:00.000Z");
    await expect(pa.locator(".pickup-time")).toContainText("3:15 PM");
    await expect(pb.locator(".pickup-time")).toContainText("2:15 PM");
    await pa.getByRole("button", { name: "Edit pickup", exact: true }).click();
    await pa.getByLabel("Pickup note").fill("Keep my typed note.");
    await pb.getByRole("button", { name: "Edit pickup", exact: true }).click();
    await pb.getByLabel("Date and time").fill("2060-05-10T14:45");
    await pb.getByLabel("Pickup location").fill("Willow Primary, side gate");
    await pb.getByLabel("Who’s picking up?").selectOption("alex");
    await pb.getByLabel("Pickup note").fill("Meet at the side gate.");
    await pb.getByRole("button", { name: "Save changes" }).click();
    await expect(
      pa.getByText("This pickup changed while you were editing."),
    ).toBeVisible({ timeout: 10000 });
    await expect(pa.getByLabel("Pickup note")).toHaveValue(
      "Keep my typed note.",
    );
    await expect(
      pa.getByRole("button", { name: "Save changes" }),
    ).toBeDisabled();
    await pa
      .getByRole("button", { name: "Discard my draft and load latest details" })
      .click();
    await expect(pa.getByLabel("Date and time")).toHaveValue(
      "2060-05-10T15:45",
    );
    await expect(pa.getByLabel("Pickup location")).toHaveValue(
      "Willow Primary, side gate",
    );
    await pa.getByLabel("Pickup note").fill("Bring the backpack.");
    await pa.getByRole("button", { name: "Save changes" }).click();
    await expect(pb.getByText("Updated by Alex Willow")).toBeVisible({
      timeout: 10000,
    });
    await pa.screenshot({
      path: "/tmp/two-homes-pickup-detail.png",
      fullPage: true,
    });
    await pb.getByRole("button", { name: "Mark picked up" }).click();
    await pb.getByRole("button", { name: "Confirm picked up" }).click();
    await expect(pa.getByText("Picked up by Sam Willow")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      pa.getByRole("button", { name: "Edit pickup", exact: true }),
    ).toHaveCount(0);
    await pa.getByRole("button", { name: "Back to pickups" }).click();
    await expect(
      pa.getByRole("heading", { name: "School pickup", exact: true }),
    ).toHaveCount(0);
    await pa.getByRole("button", { name: "Past pickups", exact: true }).click();
    await expect(
      pa.getByRole("heading", { name: "School pickup", exact: true }),
    ).toBeVisible();
    await pa.getByRole("button", { name: "Add pickup", exact: false }).click();
    await pa.getByLabel("Pickup title").fill("Home handoff");
    await pa.getByLabel("Date and time").fill("2060-05-11T17:00");
    await pa.getByLabel("Pickup location").fill("Willow Library entrance");
    await pa.getByRole("button", { name: "Add pickup", exact: true }).click();
    await pb.getByRole("button", { name: "Today", exact: true }).click();
    await expect(pb.getByRole("region", { name: "Next pickup" })).toContainText(
      "Home handoff",
      { timeout: 10000 },
    );
    await pb.getByRole("button", { name: "View pickups" }).click();
    await openCard(pb, "Home handoff");
    await pb
      .getByRole("button", { name: "Cancel pickup", exact: true })
      .click();
    await pb.getByRole("button", { name: "Confirm cancellation" }).click();
    await expect(pa.getByText("Cancelled by Sam Willow")).toBeVisible({
      timeout: 10000,
    });
    await pc.getByRole("button", { name: "Pickups", exact: true }).click();
    await expect(
      pc.getByRole("heading", { name: "No pickups planned yet" }),
    ).toBeVisible();
    assert.equal(
      (await cc.request.get(base + "/api/pickups/" + item.id)).status(),
      404,
    );
    for (const page of [pa, pb, pc])
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
    console.log(
      "PASS: two phone-sized browser sessions, pickup creation, Today summary, live edits/reassignment, time-zone conversion, stale draft preservation, completion/history, cancellation, third-household privacy, and mobile layout.",
    );
  } finally {
    await ca.close();
    await cb.close();
    await cc.close();
  }
}
