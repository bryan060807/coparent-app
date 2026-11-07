import type { NextRequest } from "next/server";
import { cloudEnabled } from "../../../lib/cloud/config";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(req: NextRequest) {
  if (cloudEnabled())
    return (await import("../../../lib/cloud/api")).handle(req);
  return (await import("../../../lib/api-local")).GET(req);
}
export async function POST(req: NextRequest) {
  if (cloudEnabled())
    return (await import("../../../lib/cloud/api")).handle(req);
  return (await import("../../../lib/api-local")).POST(req);
}
