import { NextResponse } from "next/server";
import { resolveCaller } from "@/lib/caller";
import { getSql } from "@/lib/db";
import { callerFailure } from "@/lib/gascity/caller_response";
import { parseAnswerBody } from "@/lib/gascity/contract";
import { answerQuestion } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const resolved = await resolveCaller();
    const failure = callerFailure(resolved);
    if (failure) return failure;
    if (resolved.kind !== "caller") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const body = parseAnswerBody(await request.json());
    if (!body) {
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
    return NextResponse.json({
      question: result.view,
      electronInvoked: false,
    });
  } catch {
    return NextResponse.json(
      { error: "Question store is unavailable." },
      { status: 503 },
    );
  }
}
