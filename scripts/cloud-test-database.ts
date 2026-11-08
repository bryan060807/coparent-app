import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
export async function cloudTestDatabase() {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text);
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id));
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant usage on schema public,storage to anon,authenticated,service_role;
    grant select on storage.objects to authenticated;
    grant all on storage.objects to service_role;`);
    await db.exec(
      readFileSync("supabase/migrations/202611070001_team.sql", "utf8"),
    );
    await db.exec(
      readFileSync("supabase/migrations/202611080001_family_hub.sql", "utf8"),
    );
    return db;
  } catch (e) {
    await db.close();
    throw e;
  }
}
