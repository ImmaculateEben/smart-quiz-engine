import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { enforceSameOrigin, parseJsonBody } from "@/lib/http/api-security";
import { hashPin } from "@/lib/pins/generate";

const RATE_LIMIT_WINDOW_MINUTES = 15;
const RATE_LIMIT_MAX_ATTEMPTS = 10;
const pinValidationRequestSchema = z.object({
  pin: z.string().trim().min(1).max(128),
  examId: z.string().trim().min(1).max(128),
  candidateIdentifier: z.string().trim().max(200).optional().default(""),
  candidateName: z.string().trim().max(200).optional().default(""),
  startAttempt: z.boolean().optional().default(false)
});

function getClientIp(request: Request) {
  const xfwd = request.headers.get("x-forwarded-for");
  if (xfwd) return xfwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? null;
}

export async function POST(request: Request) {
  const csrf = enforceSameOrigin(request);
  if (csrf) return csrf;

  const parsed = await parseJsonBody(request, pinValidationRequestSchema);
  if (!parsed.ok) return parsed.response;

  const { pin: rawPin, examId, candidateIdentifier, candidateName, startAttempt } = parsed.data;

  // Use the server-side admin client so this endpoint remains functional after anon table privileges are revoked.
  const supabase = createSupabaseAdminClient();
  const clientIp = getClientIp(request);
  const userAgent = request.headers.get("user-agent");
  const enteredPinHash = hashPin(rawPin);

  if (clientIp) {
    const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("pin_validation_attempts")
      .select("*", { count: "exact", head: true })
      .eq("client_ip", clientIp)
      .eq("success", false)
      .gte("created_at", since);
    if ((count ?? 0) >= RATE_LIMIT_MAX_ATTEMPTS) {
      await supabase.from("pin_validation_attempts").insert({
        entered_pin_hash: enteredPinHash,
        client_ip: clientIp,
        user_agent: userAgent,
        candidate_identifier: candidateIdentifier || null,
        success: false,
        reason: "rate_limited"
      });
      return NextResponse.json(
        { error: "RATE_LIMITED", retryAfterMinutes: RATE_LIMIT_WINDOW_MINUTES },
        { status: 429 }
      );
    }
  }

  const { data: pin } = await supabase
    .from("exam_pins")
    .select("id,institution_id,exam_id,status,max_uses,uses_count,allow_list_enabled,expires_at")
    .eq("pin_hash", enteredPinHash)
    .eq("exam_id", examId)
    .maybeSingle();

  const fail = async (reason: string, pinId?: string | null, institutionId?: string | null) => {
    await supabase.from("pin_validation_attempts").insert({
      institution_id: institutionId ?? null,
      pin_id: pinId ?? null,
      entered_pin_hash: enteredPinHash,
      client_ip: clientIp,
      user_agent: userAgent,
      candidate_identifier: candidateIdentifier || null,
      success: false,
      reason
    });
    return NextResponse.json({ error: "INVALID_PIN", reason }, { status: 401 });
  };

  if (!pin) return fail("pin_not_found");
  if (pin.status !== "active") return fail(`pin_status_${pin.status}`, pin.id, pin.institution_id);
  if (pin.expires_at && new Date(pin.expires_at).getTime() < Date.now()) return fail("pin_expired", pin.id, pin.institution_id);
  if (pin.uses_count >= pin.max_uses) return fail("pin_usage_limit_reached", pin.id, pin.institution_id);

  if (pin.allow_list_enabled) {
    if (!candidateIdentifier) return fail("allow_list_identifier_required", pin.id, pin.institution_id);
    const { data: allowEntry } = await supabase
      .from("pin_allow_list")
      .select("id")
      .eq("institution_id", pin.institution_id)
      .eq("exam_pin_id", pin.id)
      .eq("candidate_identifier", candidateIdentifier)
      .maybeSingle();
    if (!allowEntry) return fail("allow_list_miss", pin.id, pin.institution_id);
  }

  const nextUses = pin.uses_count + 1;
  const nextStatus = nextUses >= pin.max_uses ? "used" : "active";
  const { error: updateErr } = await supabase
    .from("exam_pins")
    .update({ uses_count: nextUses, status: nextStatus })
    .eq("id", pin.id)
    .eq("institution_id", pin.institution_id);
  if (updateErr) {
    return NextResponse.json({ error: "PIN_UPDATE_FAILED" }, { status: 500 });
  }

  await supabase.from("pin_validation_attempts").insert({
    institution_id: pin.institution_id,
    pin_id: pin.id,
    entered_pin_hash: enteredPinHash,
    client_ip: clientIp,
    user_agent: userAgent,
    candidate_identifier: candidateIdentifier || null,
    success: true,
    reason: "validated"
  });

  let attemptId: string | null = null;
  if (startAttempt) {
    if (!candidateName) {
      return NextResponse.json({ error: "CANDIDATE_NAME_REQUIRED" }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
    const { data: exam } = await admin
      .from("exams")
      .select("id,institution_id,title,duration_minutes,shuffle_questions,status")
      .eq("id", pin.exam_id)
      .eq("institution_id", pin.institution_id)
      .is("deleted_at", null)
      .single();
    if (!exam || exam.status !== "published") {
      return NextResponse.json({ error: "EXAM_NOT_PUBLISHED" }, { status: 400 });
    }

    const { data: examQuestions } = await admin
      .from("exam_questions")
      .select("question_id,display_order")
      .eq("exam_id", exam.id)
      .eq("institution_id", pin.institution_id)
      .order("display_order", { ascending: true });
    if (!examQuestions || examQuestions.length === 0) {
      return NextResponse.json({ error: "EXAM_HAS_NO_QUESTIONS" }, { status: 400 });
    }

    const { data: candidate, error: candidateErr } = await admin
      .from("candidates")
      .insert({
        institution_id: pin.institution_id,
        full_name: candidateName,
        registration_data: {
          candidateIdentifier: candidateIdentifier || null,
          source: "pin_entry"
        }
      })
      .select("id")
      .single();
    if (candidateErr || !candidate) {
      return NextResponse.json({ error: "CANDIDATE_CREATE_FAILED" }, { status: 500 });
    }

    const questionOrder = examQuestions.map((q) => q.question_id);
    if (exam.shuffle_questions) {
      for (let i = questionOrder.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [questionOrder[i], questionOrder[j]] = [questionOrder[j], questionOrder[i]];
      }
    }

    const now = Date.now();
    const expiresAt = new Date(now + exam.duration_minutes * 60 * 1000).toISOString();
    const { data: attempt, error: attemptErr } = await admin
      .from("exam_attempts")
      .insert({
        institution_id: pin.institution_id,
        exam_id: exam.id,
        candidate_id: candidate.id,
        pin_id: pin.id,
        status: "in_progress",
        started_at: new Date(now).toISOString(),
        expires_at: expiresAt,
        last_saved_at: new Date(now).toISOString(),
        current_question_index: 0,
        shuffled_question_order: questionOrder,
        client_metadata: {
          userAgent,
          clientIp
        },
        attempt_metadata: {
          candidateIdentifier: candidateIdentifier || null
        }
      })
      .select("id")
      .single();
    if (attemptErr || !attempt) {
      return NextResponse.json({ error: "ATTEMPT_CREATE_FAILED" }, { status: 500 });
    }
    attemptId = attempt.id;
  }

  return NextResponse.json({
    status: "ok",
    examId: pin.exam_id,
    pinId: pin.id,
    usesCount: nextUses,
    remainingUses: Math.max(0, pin.max_uses - nextUses),
    attemptId
  });
}
