import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { resolveCaller } from "@/lib/caller";
import { callerFailure } from "@/lib/gascity/caller_response";
import { parseRunRequest, type RunAccepted } from "@/lib/gascity/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const resolved = await resolveCaller();
    const failure = callerFailure(resolved);
    if (failure) return failure;
    const parsed = parseRunRequest(await request.json());
    if (!parsed) {
      return NextResponse.json({ error: "Enter a prompt." }, { status: 400 });
    }
    const body: RunAccepted = {
      runId: `gascity-run:${randomUUID()}`,
      status: "accepted",
      orchestration: "gascity",
      electronInvoked: false,
    };
    return NextResponse.json(body, { status: 202 });
  } catch {
    return NextResponse.json(
      { error: "GasCity is unavailable." },
      { status: 503 },
    );
  }
}
