import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { expect, type Browser, type Page } from "@playwright/test";

const password = "Family-table-2026!";
export async function checkTeamApi(
  base: string,
  a: string,
  b: string,
  c: string,
  dir: string,
) {
  const get = (url: string, cookie = "") =>
    fetch(base + url, { headers: { cookie } });
  const post = (url: string, body: object, cookie = "", origin = base) =>
    fetch(base + url, {
      method: "POST",
      headers: { cookie, origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const cookie = (r: Response) => r.headers.get("set-cookie")!.split(";")[0];
  const signup = {
    name: "Taylor Birch",
    email: "taylor@example.test",
    password,
    mode: "create",
    childName: "Bill",
  };
  for (const invalid of [
    { password: "short" },
    { name: "" },
    { email: "bad" },
    { childName: "" },
    { childName: "x".repeat(41) },
    { childName: "Bad\nname" },
    { mode: "unknown" },
  ])
    assert.equal(
      (await post("/api/signup", { ...signup, ...invalid })).status,
      400,
    );
  assert.equal(
    (await post("/api/signup", signup, "", "https://other.example")).status,
    403,
  );
  const oversized = await post("/api/signup", {
    ...signup,
    extra: "x".repeat(9000),
  });
  assert.equal(oversized.status, 400);
  const made = await post("/api/signup", signup);
  assert.equal(made.status, 201);
  const parentA = cookie(made);
  assert.match(made.headers.get("set-cookie")!, /HttpOnly/i);
  assert.match(made.headers.get("set-cookie")!, /SameSite=Strict/i);
  const me = await (await get("/api/me", parentA)).json();
  assert.equal(me.members.length, 1);
  assert.equal(me.team.name, "Team Bill");
  assert.deepEqual(await (await get("/api/papers", parentA)).json(), []);
  assert.equal(
    (await post("/api/signup", { ...signup, email: "TAYLOR@example.test" }))
      .status,
    409,
  );
  const inspect = new DatabaseSync(path.join(dir, "family.sqlite"));
  try {
    const user = inspect
      .prepare("SELECT password,household FROM users WHERE id=?")
      .get(me.user.id) as { password: string; household: string };
    assert.notEqual(user.password, password);
    assert.match(user.password, /^[a-f0-9]{32}:[a-f0-9]{128}$/);
    const storedSession = inspect
      .prepare("SELECT token FROM sessions WHERE user_id=?")
      .get(me.user.id) as { token: string };
    assert.notEqual(storedSession.token, parentA.split("=")[1]);
    assert.match(storedSession.token, /^sha256:/);
    // Compatibility with sessions created before hashed token storage.
    const legacyToken = randomBytes(32).toString("hex");
    inspect
      .prepare("INSERT INTO sessions VALUES(?,?,?)")
      .run(legacyToken, me.user.id, Date.now() + 60000);
    assert.equal((await get("/api/me", "session=" + legacyToken)).status, 200);
    assert.equal(
      (await post("/api/logout", {}, "session=" + legacyToken)).status,
      200,
    );
    assert.equal((await get("/api/me", "session=" + legacyToken)).status, 401);
    const renamed = {
      childName: "Bíll Rowan",
      version: me.team.version,
      key: randomUUID(),
      household: "cedar",
      actor: "jordan",
    };
    const saves = await Promise.all([
      post("/api/team", renamed, parentA),
      post("/api/team", renamed, parentA),
    ]);
    for (const r of saves) assert.equal(r.status, 200);
    const named = await (await get("/api/team", parentA)).json();
    assert.equal(named.name, "Team Bíll Rowan");
    assert.equal(named.updatedBy, "Taylor Birch");
    assert.equal(
      (
        inspect
          .prepare("SELECT count(*) AS n FROM team_events WHERE household=?")
          .get(user.household) as { n: number }
      ).n,
      1,
    );
    assert.equal((await (await get("/api/team", c)).json()).name, "Team Robin");
    assert.equal(
      (
        await post(
          "/api/team",
          { ...renamed, childName: "changed payload" },
          parentA,
        )
      ).status,
      409,
    );
    for (const value of ["", "x".repeat(41), "Bad\nname", null])
      assert.equal(
        (
          await post(
            "/api/team",
            { childName: value, version: named.version, key: randomUUID() },
            parentA,
          )
        ).status,
        400,
      );
    for (const url of ["/api/team", "/api/team/invitations"]) {
      assert.equal((await post(url, {}, "")).status, 401);
      assert.equal(
        (await post(url, {}, parentA, "https://other.example")).status,
        403,
      );
    }
    assert.equal((await get("/api/team")).status, 401);
    for (const outsider of [a, b, c]) {
      assert.equal(
        (await get("/api/team/" + user.household, outsider)).status,
        404,
      );
      assert.equal(
        (await post("/api/team/" + user.household, renamed, outsider)).status,
        404,
      );
      assert.notEqual(
        (await (await get("/api/team", outsider)).json()).name,
        named.name,
      );
    }
    assert.equal((await post("/api/team/invitations", {}, a)).status, 409);
    const invitation1 = await (
      await post("/api/team/invitations", {}, parentA)
    ).json();
    const invitation2 = await (
      await post("/api/team/invitations", {}, parentA)
    ).json();
    assert.notEqual(invitation1.code, invitation2.code);
    assert.equal(
      inspect
        .prepare("SELECT token_hash FROM household_invites WHERE token_hash=?")
        .get(invitation2.code),
      undefined,
    );
    const partner = {
      name: "Morgan Birch",
      email: "morgan@example.test",
      password,
      mode: "join",
      invite: invitation1.code,
      household: "cedar",
    };
    assert.equal((await post("/api/signup", partner)).status, 409);
    assert.equal(
      inspect.prepare("SELECT id FROM users WHERE email=?").get(partner.email),
      undefined,
    );
    const joined = await post("/api/signup", {
      ...partner,
      invite: invitation2.code,
    });
    assert.equal(joined.status, 201);
    const parentB = cookie(joined);
    const partnerMe = await (await get("/api/me", parentB)).json();
    assert.equal(partnerMe.team.name, named.name);
    assert.equal(partnerMe.members.length, 2);
    assert.ok(
      partnerMe.members.some((m: { id: string }) => m.id === me.user.id),
    );
    assert.equal(
      (
        await post("/api/signup", {
          ...partner,
          email: "third@example.test",
          invite: invitation2.code,
        })
      ).status,
      409,
    );
    assert.equal(
      (await post("/api/team/invitations", {}, parentB)).status,
      409,
    );
    const competing = await Promise.all([
      post(
        "/api/team",
        { childName: "Bill", version: named.version, key: randomUUID() },
        parentA,
      ),
      post(
        "/api/team",
        { childName: "Billie", version: named.version, key: randomUUID() },
        parentB,
      ),
    ]);
    assert.deepEqual(competing.map((r) => r.status).sort(), [200, 409]);
    const current = await (await get("/api/team", parentA)).json();
    const restore = await post(
      "/api/team",
      { childName: "Bill", version: current.version, key: randomUUID() },
      parentB,
    );
    assert.equal(restore.status, 200);
    // Expiry, replacement, and simultaneous claims cannot create extra parents.
    const owner = await post("/api/signup", {
      ...signup,
      email: "invite-owner@example.test",
      childName: "Robin",
    });
    const ownerCookie = cookie(owner);
    const expired = await (
      await post("/api/team/invitations", {}, ownerCookie)
    ).json();
    inspect
      .prepare("UPDATE household_invites SET expires=0 WHERE token_hash=?")
      .run(createHash("sha256").update(expired.code).digest("hex"));
    assert.equal(
      (
        await post("/api/signup", {
          ...partner,
          email: "expired@example.test",
          invite: expired.code,
        })
      ).status,
      409,
    );
    const fresh = await (
      await post("/api/team/invitations", {}, ownerCookie)
    ).json();
    const claims = await Promise.all(
      ["race-one@example.test", "race-two@example.test"].map((email) =>
        post("/api/signup", { ...partner, email, invite: fresh.code }),
      ),
    );
    assert.deepEqual(claims.map((r) => r.status).sort(), [201, 409]);
    assert.equal(
      (await (await get("/api/me", ownerCookie)).json()).members.length,
      2,
    );
    assert.equal(
      (
        await post("/api/login", {
          email: signup.email,
          password: "wrong password",
        })
      ).status,
      401,
    );
    const relogin = await post("/api/login", {
      email: "TAYLOR@EXAMPLE.TEST",
      password,
    });
    assert.equal(relogin.status, 200);
    const revoked = cookie(relogin);
    assert.equal((await post("/api/logout", {}, revoked)).status, 200);
    assert.equal((await get("/api/me", revoked)).status, 401);
    for (let i = 0; i < 10; i++)
      assert.equal(
        (
          await post("/api/login", {
            email: "rate-limit@example.test",
            password,
          })
        ).status,
        401,
      );
    assert.equal(
      (await post("/api/login", { email: "rate-limit@example.test", password }))
        .status,
      429,
    );
    const oldTitle = await (await get("/api/team", a)).json();
    assert.equal(oldTitle.name, "Team Bill");
    console.log(
      "PASS: signup/login, password and session hashing, legacy sessions, validation/throttling, private team names, duplicate/stale edits, invite replacement/expiry/concurrent claims, two-parent limit and server-owned membership.",
    );
    return { cookie: parentA, partnerCookie: parentB, userId: me.user.id };
  } finally {
    inspect.close();
  }
}

export async function checkTeamBrowsers(
  browser: Browser,
  base: string,
  parentBBase: string,
) {
  const ca = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const cb = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const cc = await browser.newContext({
    viewport: { width: 320, height: 844 },
  });
  const pa = await ca.newPage(),
    pb = await cb.newPage(),
    pc = await cc.newPage();
  const inputWarnings: string[] = [];
  for (const page of [pa, pb, pc])
    page.on("console", (message) => {
      if (
        /controlled.*uncontrolled|uncontrolled.*controlled/i.test(
          message.text(),
        )
      )
        inputWarnings.push(message.text());
    });
  const openTeam = async (page: Page) => {
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page
      .getByRole("navigation", { name: "More sections" })
      .getByRole("button", { name: "Your team", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Your team", exact: true }),
    ).toBeVisible();
  };
  const create = async (
    page: Page,
    address: string,
    name: string,
    email: string,
    join = false,
    code = "",
  ) => {
    await page.goto(address);
    await expect(page).toHaveTitle("Team · Family handoffs");
    await page
      .getByRole("button", { name: "Create an account", exact: true })
      .click();
    await page.getByLabel("Your name", { exact: true }).fill(name);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    if (join) {
      await page
        .getByLabel("Join the other parent’s team", { exact: true })
        .check();
      await page.getByLabel("Invitation code", { exact: true }).fill(code);
    } else {
      await page
        .getByLabel("Child's name or nickname", { exact: true })
        .fill("Bill");
      await expect(page.getByText("Team Bill", { exact: true })).toBeVisible();
    }
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
  };
  try {
    await create(pa, base, "Avery Fern", "avery@example.test");
    await expect(pa.locator("header .brand strong")).toHaveText("Team Bill");
    await expect(
      pa.getByRole("button", { name: "Invite the other parent", exact: true }),
    ).toBeVisible();
    await pa
      .getByRole("button", { name: "Invite the other parent", exact: true })
      .click();
    await pa.evaluate(() => scrollTo(0, 0));
    await pa.screenshot({
      path: "/tmp/team-bill-settings-390.png",
      fullPage: true,
    });
    await pa
      .getByRole("button", { name: "Create invitation", exact: true })
      .click();
    const code = await pa
      .getByLabel("Invitation code", { exact: true })
      .inputValue();
    // The failed join keeps the parent's other input intact for a retry.
    await create(
      pb,
      parentBBase,
      "Riley Fern",
      "riley@example.test",
      true,
      "invalid",
    );
    await expect(pb.locator("form").getByRole("alert")).toContainText(
      "invitation code",
    );
    await expect(pb.getByLabel("Your name", { exact: true })).toHaveValue(
      "Riley Fern",
    );
    await expect(pb.getByLabel("Email", { exact: true })).toHaveValue(
      "riley@example.test",
    );
    await pb.getByLabel("Invitation code", { exact: true }).fill(code);
    await pb
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(pb.locator("header .brand strong")).toHaveText("Team Bill");
    await expect(pa.getByText("Riley Fern", { exact: true })).toBeVisible({
      timeout: 10000,
    });
    await expect(
      pa.getByRole("button", { name: "Create invitation", exact: true }),
    ).toHaveCount(0);
    await openTeam(pb);
    await pb
      .getByLabel("Child's name or nickname", { exact: true })
      .fill("My unsaved nickname");
    await pa
      .getByLabel("Child's name or nickname", { exact: true })
      .fill("Bíll Rowan");
    await pa
      .getByRole("button", { name: "Save team name", exact: true })
      .click();
    await expect(
      pa.getByText("Team name saved. Both parents will see it."),
    ).toBeVisible();
    await expect(pb.locator("header .brand strong")).toHaveText(
      "Team Bíll Rowan",
      { timeout: 10000 },
    );
    await expect(pb).toHaveTitle("Team Bíll Rowan · Family handoffs");
    await expect(
      pb.getByLabel("Child's name or nickname", { exact: true }),
    ).toHaveValue("My unsaved nickname");
    await expect(
      pb.getByRole("button", { name: "Save team name", exact: true }),
    ).toBeDisabled();
    await pb
      .getByRole("button", {
        name: "Load current name and replace my draft",
        exact: true,
      })
      .click();
    const longName = "María-José 長い名前 O’Connell-River";
    await pb
      .getByLabel("Child's name or nickname", { exact: true })
      .fill(longName);
    await pb
      .getByRole("button", { name: "Save team name", exact: true })
      .click();
    await expect(pa.locator("header .brand strong")).toHaveText(
      "Team " + longName,
      { timeout: 10000 },
    );
    await pb.setViewportSize({ width: 320, height: 844 });
    await expect
      .poll(() =>
        pb.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await pb.evaluate(() => scrollTo(0, 0));
    await pb.screenshot({ path: "/tmp/team-name-320.png", fullPage: true });
    await pa.reload();
    await expect(pa.locator("header .brand strong")).toHaveText(
      "Team " + longName,
    );
    await pc.goto(base);
    await pc.getByLabel("Email", { exact: true }).fill("jordan@example.test");
    await pc.getByLabel("Password", { exact: true }).fill("Backpack-demo-26!");
    await pc.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(pc.locator("header .brand strong")).toHaveText("Team Robin");
    await expect(pc.getByText(longName, { exact: false })).toHaveCount(0);
    // Replacing the cookie in another tab also clears the old household name.
    const switched = await ca.request.post(base + "/api/login", {
      headers: { origin: base },
      data: { email: "jordan@example.test", password: "Backpack-demo-26!" },
    });
    assert.equal(switched.status(), 200);
    await expect(pa.locator("header .brand strong")).toHaveText("Team Robin", {
      timeout: 10000,
    });
    await expect(pa.getByText(longName, { exact: false })).toHaveCount(0);
    await pb.route("**/api/logout", (route) =>
      route.fulfill({ status: 500, body: "Temporary error" }),
    );
    await pb.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(
      pb.getByText("Could not sign out. Check your connection and try again."),
    ).toBeVisible();
    await expect(pb.locator("header .brand strong")).toHaveText(
      "Team " + longName,
    );
    await pb.unroute("**/api/logout");
    await pb.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(
      pb.getByRole("heading", { name: "Sign in", exact: true }),
    ).toBeVisible();
    await expect(pb).toHaveTitle("Team · Family handoffs");
    await expect(pb.getByText(longName, { exact: false })).toHaveCount(0);
    await pb.getByLabel("Email", { exact: true }).fill("riley@example.test");
    await pb.getByLabel("Password", { exact: true }).fill(password);
    await pb.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(pb.locator("header .brand strong")).toHaveText(
      "Team " + longName,
    );
    assert.deepEqual(
      inputWarnings,
      [],
      "switching create/join must preserve input ownership",
    );
    console.log(
      "PASS: real two-browser signup/invitation, field-preserving errors, synced household names, stale drafts, Unicode/long names at 320px, account switching and sign-out privacy.",
    );
  } finally {
    await ca.close();
    await cb.close();
    await cc.close();
  }
}
