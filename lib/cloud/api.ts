import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cloudClient, storageAdmin } from "./client";
import { trustedOrigin } from "./config";
import { readJson } from "../request";
import { personalName } from "../team-types";
import { MAX_UPLOAD, fileMime } from "./files";
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
class ApiError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
function databaseError(e: { code?: string; message: string }) {
  const code = e.code ?? "";
  const status =
    code === "P0404"
      ? 404
      : code === "P0409" || code === "23505"
        ? 409
        : code === "28000"
          ? 401
          : code.startsWith("22")
            ? 400
            : code === "42501"
              ? 403
              : 503;
  return new ApiError(
    status === 503
      ? "Could not reach your shared data. Please try again."
      : e.message,
    status,
  );
}
async function rpc(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown> = {},
) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw databaseError(error);
  return data;
}
function authFields(b: Record<string, unknown>, signup: boolean) {
  if (
    typeof b.email !== "string" ||
    b.email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email.trim()) ||
    typeof b.password !== "string" ||
    b.password.length > 200 ||
    b.password.length < (signup ? 12 : 1)
  )
    throw new ApiError(
      signup
        ? "Enter a valid email and a password of 12–200 characters."
        : "Enter your email and password.",
    );
  return { email: b.email.trim().toLowerCase(), password: b.password };
}
function onboardingFields(b: Record<string, unknown>) {
  const name = personalName(b.name, 80);
  if (!name || !["create", "join"].includes(String(b.mode)))
    throw new ApiError(
      "Enter your name and choose whether to create or join a team.",
    );
  if (b.mode === "create" && !personalName(b.childName, 40))
    throw new ApiError(
      "Enter your child's name or nickname, up to 40 characters.",
    );
  if (
    b.mode === "join" &&
    (typeof b.invite !== "string" ||
      !/^[A-Za-z0-9_-]{24,64}$/.test(b.invite.trim()))
  )
    throw new ApiError("Enter the invitation code shared by the other parent.");
  return {
    name,
    mode: b.mode,
    childName: b.mode === "create" ? personalName(b.childName, 40) : undefined,
    invite: b.mode === "join" ? String(b.invite).trim() : undefined,
  };
}
async function requestBody(req: Request) {
  try {
    return await readJson(req, 32768);
  } catch (e) {
    throw new ApiError((e as Error).message);
  }
}
export async function handle(req: NextRequest) {
  let ctx: ReturnType<typeof cloudClient>;
  try {
    ctx = cloudClient(req);
  } catch (e) {
    return json({ error: (e as Error).message }, 503);
  }
  try {
    return ctx.finish(await dispatch(req, ctx));
  } catch (e) {
    if (e instanceof ApiError)
      return ctx.finish(json({ error: e.message }, e.status));
    console.error("Hosted request failed", {
      name: e instanceof Error ? e.name : "UnknownError",
    });
    return ctx.finish(
      json(
        {
          error:
            "Could not complete this request. Your draft is kept; please retry.",
        },
        503,
      ),
    );
  }
}
async function dispatch(
  req: NextRequest,
  ctx: ReturnType<typeof cloudClient>,
): Promise<Response> {
  const { client, config } = ctx;
  const parts = req.nextUrl.pathname.split("/").slice(2);
  const post = req.method === "POST";
  if (
    post &&
    (!req.headers.get("origin") ||
      !trustedOrigin(req.headers.get("origin")!, config))
  )
    throw new ApiError("Invalid request origin.", 403);
  if (post && parts.length === 1 && ["login", "signup"].includes(parts[0])) {
    const b = await requestBody(req);
    const credentials = authFields(b, parts[0] === "signup");
    if (parts[0] === "login") {
      const { error } = await client.auth.signInWithPassword(credentials);
      if (error)
        throw new ApiError(
          error.status === 429
            ? "Too many attempts. Try again shortly."
            : "Email or password is incorrect, or your email still needs confirmation.",
          error.status === 429 ? 429 : 401,
        );
      return json({ ok: true });
    }
    const fields = onboardingFields(b);
    if (
      b.mode === "join" &&
      !(await rpc(client, "app_invite_available", {
        p_code: String(b.invite).trim(),
      }))
    )
      throw new ApiError(
        "This invitation is expired, used, or unavailable. Ask for a new code.",
        409,
      );
    const { data, error } = await client.auth.signUp({
      ...credentials,
      options: {
        data: { name: fields.name },
        emailRedirectTo: config.origin + "/auth/callback",
      },
    });
    if (error)
      throw new ApiError(
        error.status === 429
          ? "Too many account attempts. Try again shortly."
          : "Could not create this account. If you already have an account, sign in.",
        error.status === 429 ? 429 : 400,
      );
    if (!data.session)
      return json(
        {
          needsConfirmation: true,
          message:
            "Check your email to confirm your account, then sign in to finish setting up your team.",
        },
        201,
      );
    await rpc(client, "app_onboard", { p_body: fields });
    return json({ ok: true }, 201);
  }
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user) throw new ApiError("Please sign in.", 401);
  if (post && parts.length === 1 && parts[0] === "logout") {
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) throw new ApiError("Could not sign out. Please retry.", 503);
    return json({ ok: true });
  }
  if (post && parts.length === 1 && parts[0] === "onboarding") {
    await rpc(client, "app_onboard", {
      p_body: onboardingFields(await requestBody(req)),
    });
    return json({ ok: true });
  }
  if (!post && parts.length === 1 && parts[0] === "me")
    return json(await rpc(client, "app_me"));
  if (parts[0] === "team") {
    if (parts.length === 1) {
      if (post)
        return json(
          await rpc(client, "app_settings", {
            p_kind: "team",
            p_body: await requestBody(req),
          }),
        );
      const me = await rpc(client, "app_me");
      if (!me.team)
        throw new ApiError("Finish setting up your team first.", 401);
      return json(me.team);
    }
    if (post && parts.length === 2 && parts[1] === "invitations")
      return json(await rpc(client, "app_invitation"), 201);
    throw new ApiError("Not found.", 404);
  }
  if (post && parts.length === 1 && parts[0] === "uploads") {
    const upload = await rpc(client, "app_new_upload", {
      p_body: await requestBody(req),
    });
    const { data, error } = await storageAdmin()
      .storage.from("school-papers")
      .createSignedUploadUrl(upload.path);
    if (error || !data)
      throw new ApiError(
        "Could not prepare the upload. Your fields are kept; try again.",
        503,
      );
    return json(
      { id: upload.id, url: data.signedUrl, publishableKey: config.key },
      201,
    );
  }
  const family = parts[0] === "family";
  const kind = family ? parts[1] : parts[0];
  const id = parts[family ? 2 : 1] ?? null;
  const suffix = parts[family ? 3 : 2];
  if (
    !["papers", "pickups", "homework", "gifts", "routines", "info"].includes(
      kind,
    ) ||
    (family && !["gifts", "routines", "info"].includes(kind)) ||
    (!family && ["gifts", "routines", "info"].includes(kind)) ||
    parts.length > (family ? 4 : 3)
  )
    throw new ApiError("Not found.", 404);
  if (post && family && kind === "routines" && id === "timezone" && !suffix)
    return json(
      await rpc(client, "app_settings", {
        p_kind: "timezone",
        p_body: await requestBody(req),
      }),
    );
  if (!post) {
    const data = await rpc(client, "app_read", { p_kind: kind, p_id: id });
    if (suffix === "timeline" && id) return json(data.events);
    if (suffix === "attachment" && kind === "papers" && id) {
      const {
        data: { session },
      } = await client.auth.getSession();
      if (!session) throw new ApiError("Please sign in.", 401);
      const url =
        config.url +
        "/storage/v1/object/school-papers/" +
        data.file.split("/").map(encodeURIComponent).join("/");
      const original = await fetch(url, {
        headers: {
          apikey: config.key,
          Authorization: `Bearer ${session.access_token}`,
        },
        cache: "no-store",
      });
      if (!original.ok || !original.body)
        throw new ApiError("Could not open this attachment. Try again.", 503);
      return new Response(original.body, {
        headers: {
          "Content-Type": data.mime,
          "Content-Disposition": `inline; filename="school-paper.${data.mime === "application/pdf" ? "pdf" : data.mime === "image/png" ? "png" : "jpg"}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; sandbox",
        },
      });
    }
    if (suffix) throw new ApiError("Not found.", 404);
    return json(data);
  }
  if (suffix) throw new ApiError("Not found.", 404);
  const body = await requestBody(req);
  if (kind === "papers" && !id) await validateUpload(client, body);
  const result = await rpc(client, "app_mutate", {
    p_kind: kind,
    p_id: id,
    p_body: body,
  });
  return json(
    kind === "papers" && !id
      ? { id: result }
      : await rpc(client, "app_read", { p_kind: kind, p_id: result }),
    id ? 200 : 201,
  );
}
async function validateUpload(
  client: SupabaseClient,
  body: Record<string, unknown>,
) {
  if (typeof body.uploadId !== "string")
    throw new ApiError("Choose a file first. Your other fields are kept.");
  const upload = await rpc(client, "app_get_upload", { p_id: body.uploadId });
  if (upload.validated) return;
  const admin = storageAdmin();
  const { data, error } = await admin.storage
    .from("school-papers")
    .download(upload.path);
  if (error || !data)
    throw new ApiError(
      "The upload did not finish. Choose the file again; your fields are kept.",
    );
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (
    !bytes.length ||
    bytes.length > MAX_UPLOAD ||
    bytes.length !== upload.size ||
    fileMime(bytes) !== upload.mime
  ) {
    await admin.storage.from("school-papers").remove([upload.path]);
    throw new ApiError(
      "Unsupported file. Choose a JPEG, PNG, or PDF up to 10 MB; HEIC must be exported as JPEG. Your other fields are kept.",
    );
  }
  const path = upload.household + "/" + upload.id;
  const saved = await admin.storage
    .from("school-papers")
    .upload(path, bytes, { contentType: upload.mime, upsert: false });
  if (saved.error) {
    // A concurrent finalization or retry may already have stored the original.
    // Keep that original immutable; only accept an identical validated file.
    const existing = await admin.storage.from("school-papers").download(path);
    if (
      existing.error ||
      !existing.data ||
      !Buffer.from(await existing.data.arrayBuffer()).equals(Buffer.from(bytes))
    )
      throw new ApiError(
        "Could not save this attachment. Choose the file again; your fields are kept.",
        409,
      );
  }
  const marked = await admin.rpc("app_validate_upload", {
    p_id: upload.id,
    p_path: path,
  });
  if (marked.error) throw databaseError(marked.error);
  await admin.storage.from("school-papers").remove([upload.path]);
}
