import { NextResponse } from "next/server";
import { z } from "zod";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function buildError(error: string, status: number, details?: unknown) {
  return NextResponse.json(details ? { error, details } : { error }, { status });
}

export function enforceSameOrigin(request: Request) {
  const method = request.method.toUpperCase();
  if (SAFE_METHODS.has(method)) return null;

  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite === "cross-site") {
    return buildError("CSRF_BLOCKED", 403);
  }

  const origin = request.headers.get("origin");
  if (!origin) return null;

  let requestOrigin = "";
  try {
    requestOrigin = new URL(request.url).origin;
  } catch {
    return buildError("INVALID_REQUEST_URL", 400);
  }

  if (origin !== requestOrigin) {
    return buildError("CSRF_BLOCKED", 403);
  }

  return null;
}

export async function parseJsonBody<TSchema extends z.ZodTypeAny>(
  request: Request,
  schema: TSchema
): Promise<{ ok: true; data: z.infer<TSchema> } | { ok: false; response: NextResponse }> {
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return {
      ok: false,
      response: buildError("UNSUPPORTED_MEDIA_TYPE", 415)
    };
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      ok: false,
      response: buildError("INVALID_JSON", 400)
    };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: buildError("INVALID_INPUT", 400, parsed.error.flatten())
    };
  }

  return { ok: true, data: parsed.data };
}
