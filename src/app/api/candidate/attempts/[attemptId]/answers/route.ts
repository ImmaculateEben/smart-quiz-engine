import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { enforceSameOrigin, parseJsonBody } from "@/lib/http/api-security";

const saveAnswerRequestSchema = z.object({
  examId: z.string().trim().min(1).max(128),
  questionId: z.string().trim().min(1).max(128),
  answerPayload: z.unknown().optional(),
  currentQuestionIndex: z.number().finite().optional().default(0),
  isFinal: z.boolean().optional().default(false)
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ attemptId: string }> }
) {
  const csrf = enforceSameOrigin(request);
  if (csrf) return csrf;

  const { attemptId } = await params;
  const parsed = await parseJsonBody(request, saveAnswerRequestSchema);
  if (!parsed.ok) return parsed.response;

  const { examId, questionId, currentQuestionIndex, isFinal } = parsed.data;
  const answerPayload = parsed.data.answerPayload ?? null;
  if (!attemptId?.trim()) {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: attempt } = await admin
    .from("exam_attempts")
    .select("id,institution_id,status,expires_at")
    .eq("id", attemptId)
    .eq("exam_id", examId)
    .single();
  if (!attempt) return NextResponse.json({ error: "ATTEMPT_NOT_FOUND" }, { status: 404 });
  if (attempt.status !== "in_progress") return NextResponse.json({ error: "ATTEMPT_NOT_EDITABLE" }, { status: 400 });
  if (attempt.expires_at && new Date(attempt.expires_at).getTime() <= Date.now()) {
    await admin
      .from("exam_attempts")
      .update({ status: "auto_submitted", submitted_at: new Date().toISOString() })
      .eq("id", attemptId)
      .eq("status", "in_progress");
    return NextResponse.json({ error: "ATTEMPT_EXPIRED" }, { status: 409 });
  }

  const now = new Date().toISOString();
  const { data: existing } = await admin
    .from("attempt_answers")
    .select("id,version_no")
    .eq("attempt_id", attemptId)
    .eq("question_id", questionId)
    .eq("institution_id", attempt.institution_id)
    .maybeSingle();

  if (!existing) {
    const { error } = await admin.from("attempt_answers").insert({
      institution_id: attempt.institution_id,
      attempt_id: attemptId,
      exam_id: examId,
      question_id: questionId,
      answer_payload: answerPayload ?? {},
      is_final: isFinal,
      saved_at: now,
      version_no: 1
    });
    if (error) return NextResponse.json({ error: "SAVE_FAILED" }, { status: 500 });
    await admin.from("attempt_answer_history").insert({
      institution_id: attempt.institution_id,
      attempt_id: attemptId,
      question_id: questionId,
      answer_payload: answerPayload ?? {},
      version_no: 1
    });
  } else {
    const nextVersion = Number(existing.version_no ?? 1) + 1;
    const { error } = await admin
      .from("attempt_answers")
      .update({
        answer_payload: answerPayload ?? {},
        is_final: isFinal,
        saved_at: now,
        version_no: nextVersion
      })
      .eq("id", existing.id);
    if (error) return NextResponse.json({ error: "SAVE_FAILED" }, { status: 500 });
    await admin.from("attempt_answer_history").insert({
      institution_id: attempt.institution_id,
      attempt_id: attemptId,
      question_id: questionId,
      answer_payload: answerPayload ?? {},
      version_no: nextVersion
    });
  }

  await admin
    .from("exam_attempts")
    .update({
      last_saved_at: now,
      current_question_index: Math.max(0, Math.trunc(currentQuestionIndex))
    })
    .eq("id", attemptId);

  return NextResponse.json({ status: "ok", savedAt: now });
}
