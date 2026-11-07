// TEST DOUBLE ONLY. Real PostgreSQL functions/RLS run in PGlite; these HTTP
// endpoints emulate Supabase Auth and Storage to test the actual Supabase SDK.
// This does not replace live Supabase/Vercel deployment verification.
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { cloudTestDatabase } from "./cloud-test-database";
export async function mockSupabase() {
  const db = await cloudTestDatabase();
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>) => {
    const next = queue.then(work, work);
    queue = next.catch(() => {});
    return next;
  };
  type User = {
    id: string;
    email: string;
    password: string;
    confirmed: boolean;
    name: string;
    challenge?: string;
  };
  type Session = { user: User; id: string; access: string; refresh: string };
  const users = new Map<string, User>(),
    sessions = new Map<string, Session>(),
    refreshes = new Map<string, Session>(),
    codes = new Map<string, User>();
  const files = new Map<string, { bytes: Buffer; mime: string }>(),
    signs = new Map<string, string>();
  const secret = "test-only-secret",
    key = "test-only-publishable";
  const stats = { largestSignedUpload: 0 };
  let base = "";
  const createSession = async (user: User) => {
    const id = randomUUID(),
      now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: user.id,
      session_id: id,
      role: "authenticated",
      aud: "authenticated",
      iss: base + "/auth/v1",
      iat: now,
      exp: now + 3600,
    };
    const access =
      Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
        "base64url",
      ) +
      "." +
      Buffer.from(JSON.stringify(payload)).toString("base64url") +
      ".test-signature";
    const session = { user, id, access, refresh: randomUUID() };
    await db.query("insert into auth.sessions values($1,$2)", [id, user.id]);
    sessions.set(access, session);
    refreshes.set(session.refresh, session);
    return session;
  };
  const publicUser = (u: User) => ({
    id: u.id,
    email: u.email,
    aud: "authenticated",
    role: "authenticated",
    email_confirmed_at: u.confirmed ? new Date().toISOString() : null,
    created_at: new Date().toISOString(),
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { name: u.name },
  });
  const tokens = (s: Session) => ({
    access_token: s.access,
    refresh_token: s.refresh,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: publicUser(s.user),
  });
  const claims = (s: Session) =>
    JSON.stringify({ sub: s.user.id, session_id: s.id, role: "authenticated" });
  const as = async (
    session: Session | undefined,
    admin: boolean,
    sql: string,
    args: unknown[] = [],
  ) => {
    await db.exec("begin");
    try {
      await db.exec(
        admin
          ? "set local role service_role"
          : session
            ? "set local role authenticated"
            : "set local role anon",
      );
      await db.query("select set_config('request.jwt.claims',$1,true)", [
        session ? claims(session) : "{}",
      ]);
      const r = await db.query(sql, args);
      await db.exec("commit");
      return r;
    } catch (e) {
      await db.exec("rollback");
      throw e;
    }
  };
  const body = async (req: IncomingMessage) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  };
  const reply = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(value));
  };
  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "authorization,apikey,content-type,x-upsert,x-client-info,cache-control",
    );
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,DELETE,OPTIONS",
    );
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url!, base),
      raw = await body(req);
    const auth = req.headers.authorization?.replace(/^Bearer /, "");
    const admin = auth === secret;
    const session = auth ? sessions.get(auth) : undefined;
    try {
      await serial(async () => {
        if (
          url.pathname === "/auth/v1/admin/users" &&
          admin &&
          req.method === "POST"
        ) {
          const b = JSON.parse(raw.toString());
          const email = b.email.toLowerCase();
          if (users.has(email))
            return reply(res, 422, {
              msg: "Account exists",
              error_code: "email_exists",
            });
          const user: User = {
            id: randomUUID(),
            email,
            password: b.password,
            name: b.user_metadata?.name ?? "Parent",
            confirmed: true,
          };
          users.set(email, user);
          await db.query("insert into auth.users values($1,$2)", [
            user.id,
            email,
          ]);
          return reply(res, 200, publicUser(user));
        }
        if (url.pathname === "/auth/v1/signup") {
          const b = JSON.parse(raw.toString());
          const email = b.email.toLowerCase();
          if (users.has(email))
            return reply(res, 400, {
              msg: "Account exists",
              error_code: "user_already_exists",
            });
          const user: User = {
            id: randomUUID(),
            email,
            password: b.password,
            name: b.data?.name ?? "Parent",
            confirmed: !email.startsWith("confirm-"),
            challenge: b.code_challenge,
          };
          users.set(email, user);
          await db.query("insert into auth.users values($1,$2)", [
            user.id,
            email,
          ]);
          if (!user.confirmed)
            return reply(res, 200, { user: publicUser(user) });
          return reply(res, 200, tokens(await createSession(user)));
        }
        if (url.pathname === "/auth/v1/token") {
          const b = JSON.parse(raw.toString());
          let user: User | undefined;
          const grant = url.searchParams.get("grant_type");
          if (grant === "password") {
            user = users.get(String(b.email).toLowerCase());
            if (!user || user.password !== b.password || !user.confirmed)
              user = undefined;
          }
          if (grant === "refresh_token")
            user = refreshes.get(b.refresh_token)?.user;
          if (grant === "pkce") {
            user = codes.get(b.auth_code);
            if (
              user?.challenge !==
              createHash("sha256")
                .update(b.code_verifier ?? "")
                .digest("base64url")
            )
              user = undefined;
            codes.delete(b.auth_code);
          }
          if (!user)
            return reply(res, 400, {
              msg: "Invalid login credentials",
              error_code: "invalid_credentials",
            });
          return reply(res, 200, tokens(await createSession(user)));
        }
        if (url.pathname === "/auth/v1/user") {
          if (!session)
            return reply(res, 401, {
              msg: "Not signed in",
              error_code: "bad_jwt",
            });
          return reply(res, 200, publicUser(session.user));
        }
        if (url.pathname === "/auth/v1/logout") {
          if (!session) return reply(res, 401, { msg: "Not signed in" });
          await db.query("delete from auth.sessions where id=$1", [session.id]);
          sessions.delete(session.access);
          refreshes.delete(session.refresh);
          res.writeHead(204);
          res.end();
          return;
        }
        if (url.pathname.startsWith("/rest/v1/rpc/")) {
          const name = url.pathname.split("/").pop()!;
          if (!/^app_[a-z_]+$/.test(name)) return reply(res, 404, {});
          const b = JSON.parse(raw.toString() || "{}"),
            keys = Object.keys(b);
          if (keys.some((k) => !/^p_[a-z_]+$/.test(k)))
            return reply(res, 400, {});
          const args = keys.map((k) =>
            b[k] && typeof b[k] === "object" ? JSON.stringify(b[k]) : b[k],
          );
          const r = await as(
            session,
            admin,
            `select public.${name}(${keys.map((k, i) => k + "=> $" + (i + 1)).join(",")}) as value`,
            args,
          );
          return reply(res, 200, (r.rows[0] as { value: unknown }).value);
        }
        const prefix = "/storage/v1/object/";
        if (url.pathname.startsWith(prefix)) {
          const tail = decodeURIComponent(url.pathname.slice(prefix.length));
          if (tail.startsWith("upload/sign/")) {
            const path = tail.slice("upload/sign/school-papers/".length);
            if (req.method === "POST" && admin) {
              const token = randomUUID();
              signs.set(token, path);
              return reply(res, 200, {
                url:
                  "/object/upload/sign/school-papers/" +
                  path +
                  "?token=" +
                  token,
              });
            }
            if (
              req.method === "PUT" &&
              signs.get(url.searchParams.get("token") ?? "") === path
            ) {
              stats.largestSignedUpload = Math.max(
                stats.largestSignedUpload,
                raw.length,
              );
              if (raw.length > 10485760)
                return reply(res, 413, { error: "Too large" });
              if (files.has(path))
                return reply(res, 409, { error: "Duplicate" });
              const mime = String(req.headers["content-type"] ?? "");
              files.set(path, { bytes: raw, mime });
              await db.query(
                "insert into storage.objects(bucket_id,name) values('school-papers',$1)",
                [path],
              );
              return reply(res, 200, { Key: "school-papers/" + path });
            }
            return reply(res, 403, { error: "Invalid upload token" });
          }
          if (tail === "school-papers" && req.method === "DELETE" && admin) {
            for (const path of JSON.parse(raw.toString()).prefixes ?? []) {
              files.delete(path);
              await db.query("delete from storage.objects where name=$1", [
                path,
              ]);
            }
            return reply(res, 200, []);
          }
          if (
            tail.startsWith("school-papers/") &&
            req.method === "POST" &&
            admin
          ) {
            const path = tail.slice("school-papers/".length);
            if (files.has(path) && req.headers["x-upsert"] !== "true")
              return reply(res, 409, {
                statusCode: "409",
                error: "Duplicate",
                message: "The resource already exists",
              });
            files.set(path, {
              bytes: raw,
              mime: String(req.headers["content-type"]),
            });
            if (
              !(
                await db.query("select id from storage.objects where name=$1", [
                  path,
                ])
              ).rows.length
            )
              await db.query(
                "insert into storage.objects(bucket_id,name) values('school-papers',$1)",
                [path],
              );
            return reply(res, 200, {
              Id: randomUUID(),
              Key: "school-papers/" + path,
            });
          }
          if (
            (tail.startsWith("authenticated/school-papers/") ||
              tail.startsWith("school-papers/")) &&
            req.method === "GET"
          ) {
            const path = tail.slice(
                (tail.startsWith("authenticated/")
                  ? "authenticated/school-papers/"
                  : "school-papers/"
                ).length,
              ),
              file = files.get(path);
            if (!admin && !session)
              return reply(res, 401, { error: "Not signed in" });
            const rows = await as(
              session,
              admin,
              "select * from storage.objects where bucket_id='school-papers' and name=$1",
              [path],
            );
            if (!file || !rows.rows.length)
              return reply(res, 404, { error: "Not found" });
            res.writeHead(200, { "Content-Type": file.mime });
            res.end(file.bytes);
            return;
          }
        }
        reply(res, 404, { message: "No fixture route" });
      });
    } catch (e) {
      const err = e as { code?: string; message: string };
      const status =
        err.code === "P0404"
          ? 404
          : err.code === "P0409"
            ? 409
            : err.code === "28000"
              ? 401
              : err.code === "42501"
                ? 403
                : 400;
      reply(res, status, {
        code: err.code ?? "TEST_ERROR",
        message: err.message,
      });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No mock port");
  base = `http://127.0.0.1:${address.port}`;
  return {
    base,
    key,
    secret,
    stats,
    async confirm(email: string) {
      return serial(async () => {
        const user = users.get(email)!;
        user.confirmed = true;
        const code = randomUUID();
        codes.set(code, user);
        return code;
      });
    },
    async close() {
      await new Promise<void>((r) => server.close(() => r()));
      await db.close();
    },
  };
}
