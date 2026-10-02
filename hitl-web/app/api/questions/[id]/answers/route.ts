import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { resolveCaller } from "@/lib/caller";
import { answerQuestion } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
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
    const payload = (await request.json()) as { body?: unknown };
    const body = typeof payload.body === "string" ? payload.body.trim() : "";
    if (!body || body.length > 20_000) {
      return NextResponse.json({ error: "Enter an answer." }, { status: 400 });
    }
    const { id } = await context.params;
    const sql = getSql();
    if (!sql) {
      return NextResponse.json(
        { error: "Question store is unavailable." },
        { status: 503 },
      );
    }
    const result = await answerQuestion(sql, resolved.caller, id, body);
    if (result.kind === "not-found") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (result.kind === "forbidden") {
      return NextResponse.json(
        { error: "Your role can't answer this question." },
        { status: 403 },
      );
    }
    return NextResponse.json({ question: result.view });
  } catch {
    return NextResponse.json(
      { error: "Question store is unavailable." },
      { status: 503 },
    );
  }
}
