import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionAuthState } from "@/lib/auth/session";
import { usageLimitGuardResponse } from "@/lib/usage/guards";
import { type UsageGuardTarget, USAGE_LIMIT_DEFINITIONS } from "@/lib/usage/limits";

const requestedParamSchema = z.coerce.number().int().positive().max(10_000);

export async function GET(request: Request) {
  const authState = await getSessionAuthState();
  if (!authState.user) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const membership = authState.memberships[0] ?? null;
  if (!membership) {
    return NextResponse.json({ error: "NO_INSTITUTION_CONTEXT" }, { status: 400 });
  }

  const requestUrl = new URL(request.url);
  const target = requestUrl.searchParams.get("target") as UsageGuardTarget | null;
  const requestedParsed = requestedParamSchema.safeParse(requestUrl.searchParams.get("requested") ?? "1");

  if (!target || !(target in USAGE_LIMIT_DEFINITIONS)) {
    return NextResponse.json(
      { error: "INVALID_TARGET", allowedTargets: Object.keys(USAGE_LIMIT_DEFINITIONS) },
      { status: 400 }
    );
  }

  if (!requestedParsed.success) {
    return NextResponse.json({ error: "INVALID_REQUESTED" }, { status: 400 });
  }
  const requested = requestedParsed.data;

  const guard = await usageLimitGuardResponse({
    institutionId: membership.institutionId,
    target,
    requested
  });

  if (!guard.ok) {
    return guard.response;
  }

  return NextResponse.json({
    status: "ok",
    allowed: true,
    check: guard.result
  });
}
