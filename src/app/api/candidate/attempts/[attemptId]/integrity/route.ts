import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { enforceSameOrigin, parseJsonBody } from "@/lib/http/api-security";

type IntegrityEventInput = {
  type?: string;
  severity?: "info" | "warning" | "critical";
  occurredAt?: string;
  metadata?: unknown;
};

const ALLOWED_EVENT_TYPES = new Set([
  "tab_hidden",
  "tab_visible",
  "fullscreen_exited",
  "fullscreen_entered",
  "timer_drift",
  "window_blur",
  "window_focus",
  "suspicious_client_event"
]);

const integrityEventRequestSchema = z.object({
  type: z.string().trim().min(1).max(80).optional(),
  severity: z.enum(["info", "warning", "critical"]).optional(),
  occurredAt: z.string().trim().max(80).optional(),
  metadata: z.unknown().optional()
});

const integrityBatchRequestSchema = z.object({
  events: z.array(integrityEventRequestSchema).min(1).max(50)
});

function sanitizeMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 20)) {
    if (typeof v === "string") out[k] = v.slice(0, 300);
    else if (typeof v === "number" || typeof v === "boolean" || v === null) out[k] = v;
    else if (Array.isArray(v)) out[k] = v.slice(0, 20).map((item) => (typeof item === "string" ? item.slice(0, 80) : item));
  }
  return out;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ attemptId: string }> }
) {
  const csrf = enforceSameOrigin(request);
  if (csrf) return csrf;

  const { attemptId } = await params;
  const parsed = await parseJsonBody(request, integrityBatchRequestSchema);
  if (!parsed.ok) return parsed.response;

  const events = parsed.data.events as IntegrityEventInput[];
  if (!attemptId?.trim()) {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: attempt } = await admin
    .from("exam_attempts")
    .select("id,institution_id,exam_id,candidate_id,status,integrity_events_count")
    .eq("id", attemptId)
    .single();
  if (!attempt) return NextResponse.json({ error: "ATTEMPT_NOT_FOUND" }, { status: 404 });

  const accepted = events
    .map((event) => {
      const type = String(event.type ?? "").trim();
      if (!ALLOWED_EVENT_TYPES.has(type)) return null;
      const severity =
        event.severity === "critical" || event.severity === "warning" || event.severity === "info"
          ? event.severity
          : "info";
      const occurredAtClient =
        event.occurredAt && !Number.isNaN(new Date(event.occurredAt).getTime()) ? event.occurredAt : null;
      return {
        institution_id: attempt.institution_id,
        exam_id: attempt.exam_id,
        attempt_id: attempt.id,
        candidate_id: attempt.candidate_id,
        event_type: type,
        severity,
        occurred_at_client: occurredAtClient,
        metadata: sanitizeMetadata(event.metadata)
      };
    })
    .filter(Boolean);

  if (accepted.length === 0) {
    return NextResponse.json({ error: "NO_VALID_EVENTS" }, { status: 400 });
  }

  const { error } = await admin.from("attempt_integrity_events").insert(accepted);
  if (error) return NextResponse.json({ error: "LOG_FAILED" }, { status: 500 });

  await admin
    .from("exam_attempts")
    .update({
      integrity_events_count: Number(attempt.integrity_events_count ?? 0) + accepted.length
    })
    .eq("id", attempt.id);

  return NextResponse.json({ status: "ok", logged: accepted.length });
}
