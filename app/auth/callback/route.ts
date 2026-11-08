import { NextRequest, NextResponse } from "next/server";
import { cloudClient } from "../../../lib/cloud/client";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const ctx = cloudClient(req);
  // A confirmation link must not leave a parent session hidden behind child mode.
  if (req.cookies.has("team_child"))
    return NextResponse.redirect(ctx.config.origin);
  const code = req.nextUrl.searchParams.get("code");
  if (code) {
    const { error } = await ctx.client.auth.exchangeCodeForSession(code);
    if (!error) return ctx.finish(NextResponse.redirect(ctx.config.origin));
  }
  return ctx.finish(
    NextResponse.redirect(ctx.config.origin + "/?auth=confirmation"),
  );
}
