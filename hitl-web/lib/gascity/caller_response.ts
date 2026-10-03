import { NextResponse } from "next/server";
import type { CallerResult } from "../caller";

export function callerFailure(resolved: CallerResult): NextResponse | null {
  if (resolved.kind === "caller") return null;
  if (resolved.kind === "signed-out") {
    return NextResponse.json(
      { error: "Sign in to continue." },
      { status: 401 },
    );
  }
  if (resolved.kind === "not-found") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(
    { error: "Question store is unavailable." },
    { status: 503 },
  );
}
