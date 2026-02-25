import { NextResponse } from "next/server";
import { clientEnv, serverEnv } from "@/lib/env";

export async function GET() {
  const clientEnvReady = clientEnv.success;
  const serverEnvReady = serverEnv.success;

  return NextResponse.json({
    service: "clavis",
    status: clientEnvReady ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    checks: {
      clientEnv: clientEnvReady ? "ready" : "missing_or_invalid",
      serverEnv: serverEnvReady ? "ready" : "missing_or_invalid"
    }
  });
}
