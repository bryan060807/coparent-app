import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { expect, type Browser, type Page } from "@playwright/test";
import type { HomeworkDetail } from "../lib/homework-types";
export async function checkHomeworkApi(
  base: string,
  a: string,
  b: string,
  c: string,
) {
  const get = (url: string, cookie = a) =>
    fetch(base + "/api/homework" + url, { headers: { cookie } });
  const post = (url: string, body: object, cookie = a, origin = base) =>
    fetch(base + "/api/homework" + url, {
      method: "POST",
      headers: { cookie, origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const draft = {
    title: "API workbook",
    due: "2060-11-12",
    note: "In the blue folder.",
  };
  for (const invalid of [
    { title: "" },
    { due: "2060-02-31" },
    { due: "not a date" },
    { note: "x".repeat(501) },
  ])
    assert.equal(
      (await post("", { ...draft, ...invalid, key: randomUUID() })).status,
      400,
    );
  const key = randomUUID();
  const creates = await Promise.all([
    post("", { ...draft, key }),
    post("", { ...draft, key }),
  ]);
  assert.ok(creates.every((r) => [200, 201].includes(r.status)));
  const item = (await creates[0].json()) as HomeworkDetail;
  assert.equal((await creates[1].json()).id, item.id);
  assert.equal(item.status, "not_started");
  assert.equal(item.events.length, 1);
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
          { action: "start", version: 1, note: "", key: randomUUID() },
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
        { action: "start", version: 1, note: "", key: randomUUID() },
        a,
        "https://other.example",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await post("/" + item.id, {
        action: "done",
        version: 1,
        note: "",
        key: randomUUID(),
      })
    ).status,
    409,
  );
  const edit = await post(
    "/" + item.id,
    {
      ...draft,
      title: "API workbook revised",
      due: "2060-11-13",
      action: "edit",
      version: 1,
      key: randomUUID(),
      actor: "alex",
    },
    b,
  );
  assert.equal(edit.status, 200);
  assert.equal((await edit.json()).events[1].actor, "Sam Willow");
  assert.equal(
    (
      await post("/" + item.id, {
        ...draft,
        action: "edit",
        version: 1,
        key: randomUUID(),
      })
    ).status,
    409,
  );
  const start = {
    action: "start",
    version: 2,
    note: "Reading done; math still to do.",
    key: randomUUID(),
  };
  const starts = await Promise.all([
    post("/" + item.id, start, b),
    post("/" + item.id, start, b),
  ]);
  starts.forEach((r) => assert.equal(r.status, 200));
  const edits = await Promise.all([
    post(
      "/" + item.id,
      { action: "note", version: 3, note: "First draft.", key: randomUUID() },
      a,
    ),
    post(
      "/" + item.id,
      { action: "note", version: 3, note: "Other draft.", key: randomUUID() },
      b,
    ),
  ]);
  assert.deepEqual(edits.map((r) => r.status).sort(), [200, 409]);
  const done = {
    action: "done",
    version: 4,
    note: "Finished and checked.",
    key: randomUUID(),
  };
  const dones = await Promise.all([
    post("/" + item.id, done, a),
    post("/" + item.id, done, a),
  ]);
  dones.forEach((r) => assert.equal(r.status, 200));
  for (const action of ["start", "note", "edit"])
    assert.equal(
      (
        await post(
          "/" + item.id,
          { ...draft, action, version: 5, key: randomUUID() },
          b,
        )
      ).status,
      409,
    );
  const final = (await (await get("/" + item.id, b)).json()) as HomeworkDetail;
  assert.equal(final.status, "done");
  assert.equal(final.note, "Finished and checked.");
  assert.deepEqual(
    final.events.map((e) => e.action),
    ["created", "edited", "started", "noted", "done"],
  );
  assert.equal(final.events[0].actor, "Alex Willow");
  assert.equal(final.events[2].actor, "Sam Willow");
  assert.equal(final.events[4].actor, "Alex Willow");
  assert.equal(final.events[0].snapshot.due, draft.due);
  assert.equal(final.due, "2060-11-13");
  const ids: string[] = [];
  for (const due of ["2099-12-31", "2020-01-01"]) {
    const r = await post("", { ...draft, due, key: randomUUID() });
    assert.equal(r.status, 201);
    ids.push((await r.json()).id);
  }
  const active = ((await (await get("", b)).json()) as HomeworkDetail[]).filter(
    (h) => h.status !== "done",
  );
  assert.deepEqual(
    active.map((h) => h.due),
    ["2020-01-01", "2099-12-31"],
  );
  for (const id of ids) {
    assert.equal(
      (
        await post("/" + id, {
          action: "start",
          version: 1,
          note: "",
          key: randomUUID(),
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await post("/" + id, {
          action: "done",
          version: 2,
          note: "",
          key: randomUUID(),
        })
      ).status,
      200,
    );
  }
  console.log(
    "PASS: homework privacy, validation, due ordering, forward-only progress, retry idempotency, concurrent/stale edits, snapshot activity and server-owned actors.",
  );
  return { id: item.id, events: final.events.length };
}
async function login(page: Page, base: string, email: string) {
  await page.goto(base);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Backpack-demo-26!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
}
export async function checkHomeworkBrowsers(
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
    await login(pa, base, "alex@example.test");
    await login(pb, otherBase, "sam@example.test");
    await login(pc, base, "jordan@example.test");
    await pa.getByRole("button", { name: "Homework", exact: true }).click();
    await expect(
      pa.getByRole("heading", { name: "No homework to do" }),
    ).toBeVisible();
    await pa
      .getByRole("button", { name: "Add homework", exact: false })
      .click();
    await pa.getByLabel("Assignment title").fill("Reading and math sheet");
    await pa.getByLabel("Homework due date").fill("2060-11-12");
    await pa
      .getByLabel("Handoff note")
      .fill("Math sheet is in the blue folder.");
    await pa
      .getByRole("button", { name: "Add assignment", exact: true })
      .click();
    await expect(
      pa.getByRole("heading", { name: "Reading and math sheet", exact: true }),
    ).toBeVisible();
    const summary = pb.getByRole("region", { name: "Homework to do" });
    await expect(summary).toContainText("Reading and math sheet", {
      timeout: 10000,
    });
    await expect(summary).toContainText("Nov 12, 2060");
    await summary
      .getByRole("button", { name: /Reading and math sheet/ })
      .click();
    await expect(
      pb.getByRole("heading", { name: "Reading and math sheet", exact: true }),
    ).toBeVisible();
    await expect(
      pb.getByText("Due Nov 12, 2060", { exact: true }),
    ).toBeVisible();
    await pb
      .getByLabel("Handoff note")
      .fill("Reading finished; math sheet is in the blue folder.");
    await pb
      .getByRole("button", { name: "Start homework", exact: true })
      .click();
    await expect(pa.getByText("Started by Sam Willow")).toBeVisible({
      timeout: 10000,
    });
    await expect(pa.getByLabel("Handoff note")).toHaveValue(
      "Reading finished; math sheet is in the blue folder.",
    );
    await pa
      .getByRole("button", { name: "Edit assignment", exact: true })
      .click();
    await pa.getByLabel("Homework due date").fill("2060-11-13");
    await pa.getByLabel("Handoff note").fill("Keep this assignment draft.");
    await pb
      .getByLabel("Handoff note")
      .fill("Math questions 1–3 finished; finish 4–6.");
    await pb
      .getByRole("button", { name: "Save handoff note", exact: true })
      .click();
    await expect(
      pa.getByText("This assignment changed while you were editing."),
    ).toBeVisible({ timeout: 10000 });
    await expect(pa.getByLabel("Homework due date")).toHaveValue("2060-11-13");
    await expect(pa.getByLabel("Handoff note")).toHaveValue(
      "Keep this assignment draft.",
    );
    await expect(
      pa.getByRole("button", { name: "Save assignment" }),
    ).toBeDisabled();
    await pa
      .getByRole("button", { name: "Discard my draft and load latest details" })
      .click();
    await expect(pa.getByLabel("Homework due date")).toHaveValue("2060-11-12");
    await pa.getByLabel("Homework due date").fill("2060-11-13");
    await pa.getByRole("button", { name: "Save assignment" }).click();
    await expect(pb.getByText("Due Nov 13, 2060", { exact: true })).toBeVisible(
      { timeout: 10000 },
    );
    await pa.getByLabel("Handoff note").fill("Keep my unsaved handoff.");
    await pb.getByLabel("Handoff note").fill("Math finished; ready to check.");
    await pb
      .getByRole("button", { name: "Save handoff note", exact: true })
      .click();
    await expect(
      pa.getByText("This assignment changed while you were writing."),
    ).toBeVisible({ timeout: 10000 });
    await expect(pa.getByLabel("Handoff note")).toHaveValue(
      "Keep my unsaved handoff.",
    );
    await expect(
      pa.getByRole("button", { name: "Mark done", exact: true }),
    ).toBeDisabled();
    await pa
      .getByRole("button", { name: "Replace my draft with the latest note" })
      .click();
    await expect(pa.getByLabel("Handoff note")).toHaveValue(
      "Math finished; ready to check.",
    );
    await pa.getByLabel("Handoff note").fill("Checked together; all finished.");
    await pb.getByLabel("Handoff note").fill("Keep Sam’s unsaved note.");
    await pa.screenshot({
      path: "/tmp/two-homes-homework-detail.png",
      fullPage: true,
    });
    await pa.getByRole("button", { name: "Mark done", exact: true }).click();
    await expect(pb.getByText("Done by Alex Willow")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      pb.getByText("Keep Sam’s unsaved note.", { exact: true }),
    ).toBeVisible();
    await expect(
      pb.getByRole("button", { name: "Mark done", exact: true }),
    ).toHaveCount(0);
    await pa.getByRole("button", { name: "Back to homework" }).click();
    await expect(
      pa.getByRole("heading", { name: "Reading and math sheet", exact: true }),
    ).toHaveCount(0);
    await pa
      .getByRole("button", { name: "Completed homework", exact: true })
      .click();
    await expect(
      pa.getByRole("heading", { name: "Reading and math sheet", exact: true }),
    ).toBeVisible();
    await pb.getByRole("button", { name: "Today", exact: true }).click();
    await expect(
      pb.getByRole("region", { name: "Homework to do" }),
    ).not.toContainText("Reading and math sheet", { timeout: 10000 });
    await pc.getByRole("button", { name: "Homework", exact: true }).click();
    await expect(
      pc.getByRole("heading", { name: "No homework to do" }),
    ).toBeVisible();
    const all = (await (
      await ca.request.get(base + "/api/homework")
    ).json()) as HomeworkDetail[];
    const id = all.find((h) => h.title === "Reading and math sheet")!.id;
    assert.equal(
      (await cc.request.get(base + "/api/homework/" + id)).status(),
      404,
    );
    assert.equal(
      (
        await cc.request.get(base + "/api/homework/" + id + "/timeline")
      ).status(),
      404,
    );
    for (const [title, due] of [
      ["Spelling practice", "2020-01-01"],
      ["Read 10 minutes", "2099-12-31"],
    ])
      assert.equal(
        (
          await ca.request.post(base + "/api/homework", {
            headers: { origin: base },
            data: { title, due, note: "", key: randomUUID() },
          })
        ).status(),
        201,
      );
    await pa.getByRole("button", { name: "Today", exact: true }).click();
    const todo = pa.getByRole("region", { name: "Homework to do" });
    await expect(todo).toContainText("Spelling practice", { timeout: 10000 });
    await expect(todo).toContainText("Overdue");
    await expect(todo.locator(".homework-mini").first()).toContainText(
      "Spelling practice",
    );
    await expect(todo.locator(".homework-mini").last()).toContainText(
      "Read 10 minutes",
    );
    await pa.screenshot({
      path: "/tmp/two-homes-homework-today.png",
      fullPage: true,
    });
    for (const width of [390, 320]) {
      await pa.setViewportSize({ width, height: 844 });
      assert.equal(
        await pa.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      for (const name of ["Today", "Pickups", "Homework", "More"])
        await expect(
          pa.getByRole("button", { name, exact: true }),
        ).toBeVisible();
    }
    console.log(
      "PASS: homework across two phone-sized sessions, Today updates, note/progress handoff, edited due dates in different time zones, draft preservation, completion/history, household privacy and 320/390px navigation.",
    );
  } finally {
    await ca.close();
    await cb.close();
    await cc.close();
  }
}
