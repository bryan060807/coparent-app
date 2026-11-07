import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { cloudConfig } from "./config";
export function cloudClient(req: NextRequest) {
  const config = cloudConfig();
  const writes: { name: string; value: string; options: CookieOptions }[] = [];
  const headers: Record<string, string> = {};
  const client = createServerClient(config.url, config.key, {
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: config.origin.startsWith("https://"),
      path: "/",
    },
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll(cookies, nextHeaders) {
        writes.push(...cookies);
        Object.assign(headers, nextHeaders);
        for (const cookie of cookies)
          req.cookies.set(cookie.name, cookie.value);
      },
    },
  });
  return {
    client,
    config,
    finish(response: Response) {
      const result = new NextResponse(response.body, {
        status: response.status,
        headers: response.headers,
      });
      for (const { name, value, options } of writes)
        result.cookies.set(name, value, options);
      for (const [key, value] of Object.entries(headers))
        result.headers.set(key, value);
      result.headers.set("Cache-Control", "private, no-store");
      return result;
    },
  };
}
// Server-only administrative client: never imported by a Client Component.
export function storageAdmin() {
  const c = cloudConfig();
  return createClient(c.url, c.secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
