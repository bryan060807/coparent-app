export function cloudEnabled() {
  return process.env.APP_BACKEND === "supabase" || process.env.VERCEL === "1";
}
export function cloudConfig() {
  const names = [
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
    "APP_ORIGIN",
  ] as const;
  for (const name of names)
    if (!process.env[name])
      throw Error(`Set ${name} before using the hosted app.`);
  const origin = new URL(process.env.APP_ORIGIN!).origin;
  if (process.env.VERCEL === "1" && !origin.startsWith("https://"))
    throw Error("APP_ORIGIN must use HTTPS on Vercel.");
  const url = new URL(process.env.SUPABASE_URL!);
  if (
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(url.hostname)
  )
    throw Error("SUPABASE_URL must use HTTPS.");
  return {
    url: url.origin,
    key: process.env.SUPABASE_PUBLISHABLE_KEY!,
    secret: process.env.SUPABASE_SECRET_KEY!,
    origin,
  };
}
export function trustedOrigin(origin: string, config = cloudConfig()) {
  const allowed = [
    config.origin,
    ...(process.env.APP_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  ];
  if (process.env.VERCEL_URL) allowed.push(`https://${process.env.VERCEL_URL}`);
  return allowed.includes(origin);
}
