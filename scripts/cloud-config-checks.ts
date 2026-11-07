import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cloudConfig, cloudEnabled, trustedOrigin } from "../lib/cloud/config";
const names = [
  "VERCEL",
  "VERCEL_URL",
  "APP_BACKEND",
  "APP_ORIGIN",
  "APP_ALLOWED_ORIGINS",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
];
const saved = new Map(names.map((name) => [name, process.env[name]]));
try {
  for (const route of ["api/[...path]", "auth/callback"]) {
    const files = JSON.parse(
      readFileSync(`.next/server/app/${route}/route.js.nft.json`, "utf8"),
    ).files as string[];
    assert.equal(
      files.some(
        (file) =>
          file.includes("/data/") ||
          /\.sqlite(?:-|$)/.test(file) ||
          /\/\.env[^/]*$/.test(file),
      ),
      false,
      "Deployment bundles must exclude private local records and environment files",
    );
  }
  for (const name of names) delete process.env[name];
  assert.equal(cloudEnabled(), false);
  process.env.VERCEL = "1";
  process.env.APP_BACKEND = "sqlite";
  assert.equal(
    cloudEnabled(),
    true,
    "A Vercel deployment must never fall back to SQLite",
  );
  assert.throws(cloudConfig, /Set SUPABASE_URL/);
  Object.assign(process.env, {
    SUPABASE_URL: "https://fictional-project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "test-only-public",
    SUPABASE_SECRET_KEY: "test-only-secret",
    APP_ORIGIN: "https://teambill.example.test",
  });
  const config = cloudConfig();
  assert.equal(trustedOrigin("https://teambill.example.test", config), true);
  for (const origin of [
    "http://teambill.example.test",
    "https://teambill.example.test:444",
    "https://evil.example",
    "null",
    "https://teambill.example.test.evil.example",
  ])
    assert.equal(trustedOrigin(origin, config), false);
  process.env.APP_ALLOWED_ORIGINS = "https://team-preview.vercel.app";
  assert.equal(trustedOrigin("https://team-preview.vercel.app", config), true);
  process.env.VERCEL_URL = "team-deployment.vercel.app";
  assert.equal(
    trustedOrigin("https://team-deployment.vercel.app", config),
    true,
  );
  process.env.APP_ORIGIN = "http://teambill.example.test";
  assert.throws(cloudConfig, /HTTPS on Vercel/);
  console.log(
    "PASS: hosted configuration fails closed, HTTPS cookies/origins use explicit trusted configuration, exact preview origins, and no SQLite fallback on Vercel.",
  );
} finally {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
