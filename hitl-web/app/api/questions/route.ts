import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { resolveCaller } from "@/lib/caller";
import { listQuestions } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const resolved = await resolveCaller();
    if (resolved.kind === "signed-out") {
      return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    }
    if (resolved.kind === "unavailable") {
      return NextResponse.json(
        { error: "Question store is unavailable." },
        { status: 503 },
      );
    }
    if (resolved.kind === "not-found") {
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
    });
  } catch {
    return NextResponse.json(
      { error: "Question store is unavailable." },
      { status: 503 },
    );
  }
}
