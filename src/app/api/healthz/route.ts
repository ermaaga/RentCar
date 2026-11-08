import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Liveness probe: the process is up and serving requests. It does not touch the database.
export function GET(): NextResponse {
  return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
