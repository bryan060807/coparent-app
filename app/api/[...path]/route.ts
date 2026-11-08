import type { NextRequest } from "next/server";
import { cloudEnabled } from "../../../lib/cloud/config";
import { hubHandle } from "../../../lib/hub-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(req: NextRequest) {
  const hub = await hubHandle(req);
  if (hub) return hub;
  if (cloudEnabled())
    return (await import("../../../lib/cloud/api")).handle(req);
  return (await import("../../../lib/api-local")).GET(req);
}
export async function POST(req: NextRequest) {
  const hub = await hubHandle(req);
  if (hub) return hub;
  if (cloudEnabled())
    return (await import("../../../lib/cloud/api")).handle(req);
  return (await import("../../../lib/api-local")).POST(req);
}
