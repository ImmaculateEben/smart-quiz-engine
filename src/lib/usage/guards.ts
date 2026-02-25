import { NextResponse } from "next/server";
import { assertUsageAllowed, type UsageGuardTarget, UsageLimitExceededError } from "@/lib/usage/limits";

export async function enforceUsageLimit(params: {
  institutionId: string;
  target: UsageGuardTarget;
  requested?: number;
}) {
  return assertUsageAllowed(params);
}

export async function usageLimitGuardResponse(params: {
  institutionId: string;
  target: UsageGuardTarget;
  requested?: number;
}) {
  try {
    const result = await assertUsageAllowed(params);
    return { ok: true as const, result };
  } catch (error) {
    if (error instanceof UsageLimitExceededError) {
      return {
        ok: false as const,
        response: NextResponse.json(
          {
            error: error.code,
            message: error.message,
            details: error.details
          },
          { status: 429 }
        )
      };
    }
    throw error;
  }
}
