import { NextResponse } from "next/server";
import { isElectronCapability } from "@/lib/boundary";
import { resolveCaller } from "@/lib/caller";
import { callerFailure } from "@/lib/gascity/caller_response";
import {
  parseElectronCapabilityRequest,
  type ElectronCapabilityResponse,
} from "@/lib/gascity/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Records that a machine-local capability is required. This route does not
 * start Electron and does not call the host bridge. GasCity is the process
 * that may later invoke Electron for the named capability.
 */
export async function POST(request: Request) {
  try {
    const resolved = await resolveCaller();
    const failure = callerFailure(resolved);
    if (failure) return failure;
    const parsed = parseElectronCapabilityRequest(
      await request.json(),
      isElectronCapability,
    );
    if (!parsed) {
      return NextResponse.json(
        { error: "Unknown Electron capability." },
        { status: 400 },
      );
    }
    const body: ElectronCapabilityResponse = {
      disposition: "electron-required",
      capability: parsed.capability,
      electronInvoked: false,
    };
    return NextResponse.json(body, { status: 409 });
  } catch {
    return NextResponse.json(
      { error: "GasCity is unavailable." },
      { status: 503 },
    );
  }
}
