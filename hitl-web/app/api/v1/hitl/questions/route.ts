import { NextResponse } from "next/server";
import { resolveCaller } from "@/lib/caller";
import { getSql } from "@/lib/db";
import { callerFailure } from "@/lib/gascity/caller_response";
import { listQuestions } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const resolved = await resolveCaller();
    const failure = callerFailure(resolved);
    if (failure) return failure;
    if (resolved.kind !== "caller") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const sql = getSql();
    if (!sql) {
      return NextResponse.json(
        { error: "Question store is unavailable." },
        { status: 503 },
      );
    }
    const questions = await listQuestions(sql, resolved.caller);
    return NextResponse.json({
      caller: {
        displayName: resolved.caller.displayName,
        roleId: resolved.caller.roleId,
      },
      questions,
      electronInvoked: false,
    });
  } catch {
    return NextResponse.json(
      { error: "Question store is unavailable." },
      { status: 503 },
    );
  }
}
