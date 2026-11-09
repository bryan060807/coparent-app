import { cleanLocations, mutateLocation, locationView } from "./location";
import {
  financeView,
  mutateFinance,
  paypalDestination,
} from "./finance-domain";
import { NextRequest, NextResponse } from "next/server";
import { randomBytes, randomUUID } from "node:crypto";
import { cloudEnabled, trustedOrigin } from "./cloud/config";
import { cloudClient, storageAdmin } from "./cloud/client";
import { readJson } from "./request";
import { MAX_UPLOAD, fileMime } from "./cloud/files";
import { childHash, childVerify, digest } from "./hub-password";
import {
  mutateHub,
  HubError,
  text,
  profileFor,
  balanceFor,
} from "./hub-domain";
import {
  defaultAppearance,
  emptyHub,
  type HubActor,
  type HubState,
  type Award,
  type HubView,
} from "./hub-types";
const COOKIE = "team_child";
const dummy = childHash(randomBytes(32).toString("hex"));
const json = (v: unknown, status = 200) =>
  NextResponse.json(v, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
type Snapshot = {
  data: HubState;
  version: number;
  awards: Award[];
  members: { id: string; name: string }[];
  childName: string;
};
async function service(
  action: string,
  body: Record<string, unknown>,
): Promise<any> {
  if (!cloudEnabled()) {
    try {
      return await (await import("./hub-store-local")).localHub(action, body);
    } catch (error) {
      if ((error as Error).message.includes("hub_child_username"))
        throw new HubError(
          "That child username is unavailable. Choose another.",
          409,
        );
      throw error;
    }
  }
  const { data, error } = await storageAdmin().rpc("app_hub_service", {
    p_action: action,
    p_body: body,
  });
  if (error)
    throw new HubError(
      error.code === "23505"
        ? "That child username is unavailable. Choose another."
        : "Could not load household features. Check that the latest database migration has been applied, then retry.",
      error.code === "23505" ? 409 : 503,
    );
  return data;
}
async function snapshot(household: string): Promise<Snapshot> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const row = await service("read", { household }),
      data: HubState = row.data ?? emptyHub();
    if (!cleanLocations(data)) return { ...row, data };
    const saved = await service("store", {
      household,
      version: row.version,
      data,
      earned: row.awards.filter((a: Award) => a.active).length,
    });
    if (saved) return { ...row, data, version: row.version + 1 };
  }
  throw new HubError("Could not refresh sharing status. Try again.", 409);
}
async function childActor(req: NextRequest): Promise<HubActor> {
  const value = req.cookies.get(COOKIE)?.value;
  if (!value || !/^[a-f0-9]{64}$/.test(value))
    throw new HubError("Please sign in.", 401);
  const actor = await service("session", { token: digest(value) });
  if (!actor) throw new HubError("Please sign in.", 401);
  return actor;
}
async function parentActor(
  req: NextRequest,
  ctx: ReturnType<typeof cloudClient> | null,
): Promise<HubActor> {
  if (req.cookies.has(COOKIE))
    throw new HubError("A parent needs to sign in to do that.", 403);
  if (ctx) {
    const { data, error } = await ctx.client.rpc("app_hub_parent");
    if (error || !data) throw new HubError("Please sign in.", 401);
    return data;
  }
  const { currentUser } = await import("./auth");
  const u = currentUser(req);
  if (!u) throw new HubError("Please sign in.", 401);
  return { ...u, role: "parent" };
}
async function chores(
  actor: HubActor,
  ctx: ReturnType<typeof cloudClient> | null,
) {
  if (ctx && actor.role === "parent") {
    const { data, error } = await ctx.client.rpc("app_read", {
      p_kind: "routines",
      p_id: null,
    });
    if (error) throw new HubError("Could not load chores.", 503);
    return data.records
      .filter((r: any) => r.scheduledToday && !r.archived)
      .map((r: any) => ({
        id: r.id,
        title: r.data.title,
        checked: !!r.check?.checked,
        type: r.data.type,
      }));
  }
  if (cloudEnabled()) return []; // Child-safe checklist is read through the service-only RPC below.
  const { getFamily } = await import("./family");
  const data = await getFamily(["family", "routines"], {
    ...actor,
    email: "",
  }).json();
  return data.records
    .filter((r: any) => r.scheduledToday && !r.archived)
    .map((r: any) => ({
      id: r.id,
      title: r.data.title,
      checked: !!r.check?.checked,
      type: r.data.type,
    }));
}
async function view(
  actor: HubActor,
  ctx: ReturnType<typeof cloudClient> | null,
  allMessages = false,
): Promise<HubView> {
  const s = await snapshot(actor.household),
    d = s.data,
    parent = actor.role === "parent";
  const photos = d.photos
    .filter((p) => parent || p.childVisible)
    .map((p) => ({ ...p, file: "", uploadId: "" }));
  const profile = structuredClone(profileFor(d, actor));
  if (
    profile.appearance.background.startsWith("photo:") &&
    !photos.some((p) => p.id === profile.appearance.background.slice(6))
  )
    profile.appearance.background = "plain";
  return {
    viewer: actor.id,
    role: actor.role,
    version: s.version,
    photos,
    resources: d.resources.filter((r) => parent || r.audience === "child"),
    contacts: d.contacts.filter((c) => parent || c.childVisible),
    messages: parent ? (allMessages ? d.messages : d.messages.slice(-200)) : [],
    hasOlderMessages: parent && !allMessages && d.messages.length > 200,
    exercises: parent ? d.exercises : [],
    goals: d.goals,
    recognitions: d.recognitions,
    redemptions: d.redemptions,
    profile,
    childSettings: parent
      ? (d.childSettings ?? {
          appearance: { ...defaultAppearance },
          locationAllowed: false,
          version: 0,
        })
      : undefined,
    child:
      parent && d.child
        ? {
            username: d.child.username,
            enabled: d.child.enabled,
            version: d.child.credentialVersion,
          }
        : undefined,
    awards: s.awards,
    balance: balanceFor(d, s.awards),
    members: parent ? s.members : [],
    chores:
      cloudEnabled() && actor.role === "child"
        ? await service("chores", { household: actor.household })
        : await chores(actor, ctx),
  };
}
async function upload(
  req: NextRequest,
  actor: HubActor,
  ctx: ReturnType<typeof cloudClient> | null,
) {
  if (ctx) {
    const b = await readJson(req);
    if (!["image/png", "image/jpeg"].includes(String(b.mime)))
      throw new HubError(
        "Choose a JPEG or PNG photo up to 10 MB. Export HEIC as JPEG.",
      );
    const { data, error } = await ctx.client.rpc("app_new_upload", {
      p_body: b,
    });
    if (error) throw new HubError("Choose a JPEG or PNG photo up to 10 MB.");
    const signed = await storageAdmin()
      .storage.from("school-papers")
      .createSignedUploadUrl(data.path);
    if (signed.error || !signed.data)
      throw new HubError("Could not prepare this photo. Try again.", 503);
    return json(
      {
        id: data.id,
        url: signed.data.signedUrl,
        publishableKey: ctx.config.key,
      },
      201,
    );
  }
  const reader = req.body?.getReader();
  if (!reader) throw new HubError("Choose a photo first.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > MAX_UPLOAD + 65536) {
      await reader.cancel();
      throw new HubError(
        "Choose a photo up to 10 MB. Your caption is kept.",
        413,
      );
    }
    chunks.push(part.value);
  }
  const form = await new Response(Buffer.concat(chunks), {
    headers: { "Content-Type": req.headers.get("content-type") ?? "" },
  }).formData();
  const file = form.get("file");
  if (!(file instanceof File) || !file.size || file.size > MAX_UPLOAD)
    throw new HubError("Choose a JPEG or PNG photo up to 10 MB.");
  const bytes = Buffer.from(await file.arrayBuffer()),
    mime = fileMime(bytes);
  if (
    !mime ||
    mime !== file.type ||
    !["image/jpeg", "image/png"].includes(mime)
  )
    throw new HubError(
      "Unsupported photo. Choose JPEG or PNG; export HEIC as JPEG. Your caption is kept.",
    );
  const { db, dataDir } = await import("./db"),
    { writeFileSync } = await import("node:fs"),
    path = await import("node:path");
  const id = randomUUID();
  writeFileSync(path.join(dataDir, "attachments", id), bytes, {
    mode: 0o600,
    flag: "wx",
  });
  db.prepare("INSERT INTO hub_uploads VALUES(?,?,?,?,?,?)").run(
    id,
    actor.household,
    actor.id,
    id,
    mime,
    Date.now() + 3600000,
  );
  return json({ id }, 201);
}
async function photoFields(
  actor: HubActor,
  b: Record<string, unknown>,
  ctx: ReturnType<typeof cloudClient> | null,
) {
  if (typeof b.uploadId !== "string")
    throw new HubError("Choose a photo first.");
  if (ctx) {
    const { validateUpload } = await import("./cloud/api");
    try {
      await validateUpload(ctx.client, b);
    } catch (error) {
      const e = error as { status?: number; message?: string };
      if (e.status)
        throw new HubError(e.message ?? "Photo upload failed.", e.status);
      throw error;
    }
    const { data, error } = await ctx.client.rpc("app_get_upload", {
      p_id: b.uploadId,
    });
    if (error || !data || !["image/jpeg", "image/png"].includes(data.mime))
      throw new HubError("Choose a JPEG or PNG photo.");
    return { file: data.path, mime: data.mime };
  }
  const { db } = await import("./db");
  const u = db
    .prepare(
      "SELECT file,mime FROM hub_uploads WHERE id=? AND household=? AND actor=? AND expires>?",
    )
    .get(b.uploadId, actor.household, actor.id, Date.now());
  if (!u)
    throw new HubError(
      "This upload expired. Choose the photo again; your caption is kept.",
      404,
    );
  return u;
}
export async function hubHandle(req: NextRequest): Promise<Response | null> {
  const parts = req.nextUrl.pathname.split("/").slice(2),
    childCookie = req.cookies.has(COOKIE);
  if (
    !["hub", "child", "location", "finance"].includes(parts[0]) &&
    !childCookie
  )
    return null;
  let ctx: ReturnType<typeof cloudClient> | null = null;
  try {
    if (cloudEnabled()) ctx = cloudClient(req);
    const finish = (r: Response) => (ctx ? ctx.finish(r) : r);
    if (req.method === "POST") {
      const origin = req.headers.get("origin");
      const expected = new URL(
        req.nextUrl.protocol + "//" + req.headers.get("host"),
      ).origin;
      if (
        !origin ||
        (ctx ? !trustedOrigin(origin, ctx.config) : origin !== expected)
      )
        throw new HubError("Invalid request origin.", 403);
    }
    if (
      parts[0] === "child" &&
      parts[1] === "login" &&
      parts.length === 2 &&
      req.method === "POST"
    ) {
      const b = await readJson(req);
      const username = text(b.username, 40, true).toLowerCase();
      if (
        typeof b.password !== "string" ||
        !b.password.length ||
        b.password.length > 200
      )
        throw new HubError("Enter your username and password.");
      const password = b.password;
      if (!(await service("limit", { key: digest(username) })))
        throw new HubError(
          "Too many sign-in attempts. Try again in 15 minutes.",
          429,
        );
      const found = await service("childLookup", { username });
      const valid = childVerify(password, found?.child?.passwordHash ?? dummy);
      if (!found?.child?.enabled || !valid)
        throw new HubError("Username or password is incorrect.", 401);
      const token = randomBytes(32).toString("hex");
      if (
        !(await service("createSession", {
          household: found.household,
          child: found.child.id,
          credential: found.child.credentialVersion,
          token: digest(token),
        }))
      )
        throw new HubError(
          "This account changed. Please try signing in again.",
          401,
        );
      if (ctx) {
        const { data } = await ctx.client.auth.getUser();
        if (data.user) {
          const { error } = await ctx.client.auth.signOut({ scope: "local" });
          if (error)
            throw new HubError("Could not switch accounts. Try again.", 503);
        }
      } else (await import("./auth")).signOut(req);
      const result = finish(json({ ok: true }));
      const response = new NextResponse(result.body, {
        status: result.status,
        headers: result.headers,
      });
      response.cookies.set(COOKIE, token, {
        httpOnly: true,
        sameSite: "strict",
        secure: ctx
          ? ctx.config.origin.startsWith("https:")
          : process.env.COOKIE_SECURE === "true",
        path: "/",
        maxAge: 604800,
      });
      response.cookies.delete("session");
      return response;
    }
    if (
      childCookie &&
      req.method === "POST" &&
      ((parts[0] === "child" && parts[1] === "logout") || parts[0] === "logout")
    ) {
      await service("deleteSession", {
        token: digest(req.cookies.get(COOKIE)?.value ?? ""),
      });
      const r = json({ ok: true });
      r.cookies.delete(COOKIE);
      return finish(r);
    }
    const actor = childCookie
      ? await childActor(req)
      : await parentActor(req, ctx);
    if (childCookie && parts[0] === "me" && req.method === "GET") {
      const s = await snapshot(actor.household);
      return finish(
        json({
          user: { id: actor.id, name: actor.name, role: "child" },
          team: { name: "Team " + s.childName, childName: s.childName },
          members: [],
        }),
      );
    }
    if (parts[0] === "finance") {
      if (actor.role !== "parent")
        throw new HubError("Family finances are for parents only.", 403);
      if (req.method === "GET") {
        const s = await snapshot(actor.household),
          f = financeView(s.data, actor, s.members);
        if (parts.length === 1) return finish(json(f));
        const collection =
          parts[1] === "expenses"
            ? f.expenses
            : parts[1] === "payments"
              ? f.payments
              : parts[1] === "goals"
                ? f.goals
                : null;
        const item = collection?.find((i) => i.id === parts[2]);
        if (!item) throw new HubError("Record not found.", 404);
        if (parts.length === 3) return finish(json(item));
        if (parts.length === 4 && parts[3] === "timeline")
          return finish(
            json(
              f.events.filter(
                (e) =>
                  e.entity === item.id ||
                  (parts[1] === "goals" &&
                    "goal" in e.snapshot &&
                    e.snapshot.goal === item.id),
              ),
            ),
          );
        if (
          parts.length === 4 &&
          parts[1] === "payments" &&
          parts[3] === "paypal"
        ) {
          const url = paypalDestination(f, actor, s.members, item.id);
          return finish(
            new Response(null, {
              status: 303,
              headers: {
                Location: url,
                "Cache-Control": "private, no-store",
                "Referrer-Policy": "no-referrer",
              },
            }),
          );
        }
        throw new HubError("Not found.", 404);
      }
      if (req.method !== "POST" || parts.length !== 1)
        throw new HubError("Not found.", 404);
      const body = await readJson(req, 16384);
      for (let attempt = 0; attempt < 8; attempt++) {
        const s = await snapshot(actor.household),
          next = structuredClone(s.data);
        if (!mutateFinance(next, actor, s.members, body))
          return finish(json(financeView(s.data, actor, s.members)));
        if (
          await service("store", {
            household: actor.household,
            version: s.version,
            data: next,
            earned: s.awards.filter((x) => x.active).length,
          })
        )
          return finish(json(financeView(next, actor, s.members)));
      }
      throw new HubError(
        "Someone else is saving. Your draft is kept; please retry.",
        409,
      );
    }
    if (parts[0] === "location") {
      if (parts.length !== 1) throw new HubError("Not found.", 404);
      if (req.method === "GET") {
        const s = await snapshot(actor.household);
        return finish(
          json(locationView(s.data, actor, s.members, s.childName)),
        );
      }
      const body = await readJson(req, 8192);
      if (body.viewer !== actor.id)
        throw new HubError(
          "The signed-in account changed. Reload sharing status before trying again.",
          409,
        );
      for (let attempt = 0; attempt < 8; attempt++) {
        const s = await snapshot(actor.household),
          next = structuredClone(s.data);
        if (actor.role === "child") await childActor(req);
        if (!mutateLocation(next, actor, body))
          return finish(
            json(locationView(s.data, actor, s.members, s.childName)),
          );
        const saved = await service("store", {
          household: actor.household,
          version: s.version,
          data: next,
          earned: s.awards.filter((x) => x.active).length,
        });
        if (saved)
          return finish(
            json(locationView(next, actor, s.members, s.childName)),
          );
      }
      throw new HubError("Sharing changed while saving. Please retry.", 409);
    }
    if (parts[0] !== "hub")
      throw new HubError("A parent needs to sign in to do that.", 403);
    if (parts[1] === "uploads" && parts.length === 2 && req.method === "POST") {
      if (actor.role !== "parent")
        throw new HubError("A parent needs to add photos.", 403);
      return finish(await upload(req, actor, ctx));
    }
    if (
      parts[1] === "photos" &&
      parts[2] &&
      parts.length === 3 &&
      req.method === "GET"
    ) {
      const s = await snapshot(actor.household),
        photo = s.data.photos.find(
          (p) =>
            p.id === parts[2] && (actor.role === "parent" || p.childVisible),
        );
      if (!photo) throw new HubError("Photo not found.", 404);
      let bytes: BodyInit;
      if (ctx) {
        const original = await fetch(
          ctx.config.url +
            "/storage/v1/object/school-papers/" +
            photo.file.split("/").map(encodeURIComponent).join("/"),
          {
            headers: {
              apikey: ctx.config.secret,
              Authorization: "Bearer " + ctx.config.secret,
            },
            cache: "no-store",
          },
        );
        if (!original.ok || !original.body)
          throw new HubError("Could not open this photo. Try again.", 503);
        bytes = original.body;
      } else {
        const { dataDir } = await import("./db"),
          { readFileSync } = await import("node:fs"),
          path = await import("node:path");
        bytes = new Uint8Array(
          readFileSync(path.join(dataDir, "attachments", photo.file)),
        );
      }
      return finish(
        new Response(bytes, {
          headers: {
            "Content-Type": photo.mime,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
          },
        }),
      );
    }
    if (parts.length !== 1) throw new HubError("Not found.", 404);
    if (req.method === "GET")
      return finish(
        json(
          await view(
            actor,
            ctx,
            req.nextUrl.searchParams.get("history") === "all",
          ),
        ),
      );
    const b = await readJson(req, 32768),
      op = text(b.op, 30, true);
    let extra: Record<string, unknown> = {};
    if (op === "photo" && !b.id) {
      if (actor.role !== "parent")
        throw new HubError("A parent needs to add photos.", 403);
      extra = await photoFields(actor, b, ctx);
    }
    if (op === "childAccount") {
      if (actor.role !== "parent")
        throw new HubError("A parent needs to manage the child account.", 403);
      if (
        typeof b.password !== "string" ||
        b.password.length < 12 ||
        b.password.length > 200
      )
        throw new HubError(
          "Choose a child password of 12–200 characters. A short phrase works well.",
        );
      extra.passwordHash = childHash(b.password);
      extra.passwordDigest = digest(b.password);
      delete b.password;
    }
    for (let attempt = 0; attempt < 8; attempt++) {
      const old = await snapshot(actor.household),
        next = structuredClone(old.data);
      // Hash the original request, not a newly salted password hash, for retries.
      const args = { ...b, ...extra };
      const changed = mutateHub(next, actor, op, args, old.awards);
      if (!changed) return finish(json(await view(actor, ctx)));
      const saved = await service("store", {
        household: actor.household,
        actor: actor.id,
        version: old.version,
        data: next,
        earned: old.awards.filter((x) => x.active).length,
        profileName:
          op === "profile" && actor.role === "parent"
            ? next.profiles[actor.id].name
            : undefined,
      });
      if (saved) return finish(json(await view(actor, ctx)));
    }
    throw new HubError(
      "Someone else is saving right now. Your draft is kept; please retry.",
      409,
    );
  } catch (e) {
    const known = e instanceof HubError;
    const response = json(
      {
        error: known
          ? e.message
          : "Could not complete this request. Your draft is kept; please retry.",
      },
      known ? e.status : 503,
    );
    if (known && e.status === 401 && childCookie && parts[0] !== "child")
      response.cookies.delete(COOKIE);
    return ctx ? ctx.finish(response) : response;
  }
}
