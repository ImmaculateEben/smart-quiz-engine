import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { enforceSameOrigin } from "@/lib/http/api-security";
import { scoreAttempt } from "@/lib/scoring/score-attempt";
import { applyPrecomputedSubmissionAnalytics } from "@/lib/scoring/precomputed-analytics";
import { calculateIntegrityScore } from "@/lib/integrity/score";

class SubmitAttemptRouteError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number
  ) {
    super(code);
  }
}

function throwSubmitAttemptRouteError(code: string, status: number): never {
  throw new SubmitAttemptRouteError(code, status);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ attemptId: string }> }
) {
  const csrf = enforceSameOrigin(request);
  if (csrf) return csrf;

  const { attemptId } = await params;
  if (!attemptId?.trim()) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const { data: attempt } = await admin
    .from("exam_attempts")
    .select("id,institution_id,exam_id,candidate_id,status,expires_at,attempt_metadata")
    .eq("id", attemptId)
    .single();
  if (!attempt) return NextResponse.json({ error: "ATTEMPT_NOT_FOUND" }, { status: 404 });
  if (attempt.status === "submitting") return NextResponse.json({ error: "SUBMIT_IN_PROGRESS" }, { status: 409 });
  if (attempt.status !== "in_progress") return NextResponse.json({ error: "ATTEMPT_NOT_EDITABLE" }, { status: 400 });

  const { data: lockedAttempt, error: lockError } = await admin
    .from("exam_attempts")
    .update({
      status: "submitting",
      last_saved_at: new Date().toISOString()
    })
    .eq("id", attempt.id)
    .eq("institution_id", attempt.institution_id)
    .eq("status", "in_progress")
    .select("id")
    .maybeSingle();
  if (lockError) return NextResponse.json({ error: "SUBMIT_LOCK_FAILED" }, { status: 500 });
  if (!lockedAttempt) {
    const { data: latestAttempt } = await admin.from("exam_attempts").select("status").eq("id", attemptId).maybeSingle();
    if (latestAttempt?.status === "submitting") {
      return NextResponse.json({ error: "SUBMIT_IN_PROGRESS" }, { status: 409 });
    }
    return NextResponse.json({ error: "ATTEMPT_NOT_EDITABLE" }, { status: 400 });
  }

  let lockHeld = true;
  try {
    const { data: existingResult } = await admin
      .from("exam_results")
      .select("id,analytics_snapshot")
      .eq("attempt_id", attemptId)
      .maybeSingle();

    const [{ data: exam }, { data: examQuestions }, { data: answers }, { data: integrityEvents }] = await Promise.all([
      admin
        .from("exams")
        .select("id,passing_score")
        .eq("id", attempt.exam_id)
        .eq("institution_id", attempt.institution_id)
        .single(),
      admin
        .from("exam_questions")
        .select("question_id,points")
        .eq("exam_id", attempt.exam_id)
        .eq("institution_id", attempt.institution_id),
      admin
        .from("attempt_answers")
        .select("question_id,answer_payload")
        .eq("attempt_id", attempt.id)
        .eq("institution_id", attempt.institution_id),
      admin
        .from("attempt_integrity_events")
        .select("event_type,severity,metadata,created_at")
        .eq("attempt_id", attempt.id)
        .eq("institution_id", attempt.institution_id)
    ]);

    if (!exam) throwSubmitAttemptRouteError("EXAM_NOT_FOUND", 404);
    if (!examQuestions || examQuestions.length === 0) {
      throwSubmitAttemptRouteError("EXAM_HAS_NO_QUESTIONS", 400);
    }
    const questionIds = [...new Set(examQuestions.map((row) => row.question_id))];
    const { data: questions } = await admin
      .from("questions")
      .select("id,subject_id,question_type,correct_answer,short_answer_rules")
      .eq("institution_id", attempt.institution_id)
      .in("id", questionIds);

    const scoring = scoreAttempt({
      exam: {
        id: exam.id,
        passingScore: exam.passing_score == null ? null : Number(exam.passing_score)
      },
      examQuestions: examQuestions.map((row) => ({
        questionId: row.question_id,
        points: Number(row.points ?? 0)
      })),
      questions: (questions ?? []).map((row) => ({
        id: row.id,
        subjectId: row.subject_id,
        questionType: row.question_type,
        correctAnswer: row.correct_answer,
        shortAnswerRules: row.short_answer_rules
      })),
      answers: (answers ?? []).map((row) => ({
        questionId: row.question_id,
        answerPayload: row.answer_payload
      }))
    });
    const integrity = calculateIntegrityScore((integrityEvents ?? []) as Array<{
      event_type: string;
      severity: string | null;
      metadata?: unknown;
      created_at?: string | null;
    }>);

    const now = new Date().toISOString();
    const expired = attempt.expires_at && new Date(attempt.expires_at).getTime() <= Date.now();

    const { error: resultError } = await admin.from("exam_results").upsert(
      {
        institution_id: attempt.institution_id,
        attempt_id: attempt.id,
        exam_id: attempt.exam_id,
        candidate_id: attempt.candidate_id,
        total_questions: scoring.totalQuestions,
        answered_questions: scoring.answeredQuestions,
        correct_count: scoring.correctCount,
        incorrect_count: scoring.incorrectCount,
        score: scoring.score,
        percentage: scoring.percentage,
        grade_letter: scoring.gradeLetter,
        integrity_score: integrity.score,
        subject_breakdown: scoring.subjectBreakdown,
        analytics_snapshot: {
          ...scoring.analyticsSnapshot,
          integrity: {
            score: integrity.score,
            flagged: integrity.flagged,
            reviewStatus: integrity.reviewStatus,
            eventCount: integrity.eventCount,
            reasons: integrity.reasons,
            severityCounts: integrity.severityCounts,
            typeCounts: integrity.typeCounts
          }
        }
      },
      { onConflict: "attempt_id" }
    );
    if (resultError) throwSubmitAttemptRouteError("SCORING_FAILED", 500);

    const analyticsAlreadyApplied =
      existingResult &&
      typeof existingResult.analytics_snapshot === "object" &&
      existingResult.analytics_snapshot !== null &&
      (existingResult.analytics_snapshot as Record<string, unknown>).precomputedAnalyticsApplied === true;

    if (!analyticsAlreadyApplied) {
      await applyPrecomputedSubmissionAnalytics({
        admin,
        institutionId: attempt.institution_id,
        examId: attempt.exam_id,
        submittedAtIso: now,
        scoring
      });
      const nextAnalyticsSnapshot =
        typeof scoring.analyticsSnapshot === "object" && scoring.analyticsSnapshot !== null
          ? {
              ...(scoring.analyticsSnapshot as Record<string, unknown>),
              integrity: {
                score: integrity.score,
                flagged: integrity.flagged,
                reviewStatus: integrity.reviewStatus,
                eventCount: integrity.eventCount,
                reasons: integrity.reasons,
                severityCounts: integrity.severityCounts,
                typeCounts: integrity.typeCounts
              },
              precomputedAnalyticsApplied: true,
              precomputedAnalyticsAppliedAt: now
            }
          : {
              integrity: {
                score: integrity.score,
                flagged: integrity.flagged,
                reviewStatus: integrity.reviewStatus,
                eventCount: integrity.eventCount,
                reasons: integrity.reasons,
                severityCounts: integrity.severityCounts,
                typeCounts: integrity.typeCounts
              },
              precomputedAnalyticsApplied: true,
              precomputedAnalyticsAppliedAt: now
            };
      await admin
        .from("exam_results")
        .update({ analytics_snapshot: nextAnalyticsSnapshot })
        .eq("attempt_id", attempt.id);
    }

    const { data: finalizedAttempt, error } = await admin
      .from("exam_attempts")
      .update({
        status: expired ? "auto_submitted" : "submitted",
        submitted_at: now,
        last_saved_at: now,
        integrity_score: integrity.score,
        attempt_metadata: {
          ...(attempt.attempt_metadata &&
          typeof attempt.attempt_metadata === "object" &&
          !Array.isArray(attempt.attempt_metadata)
            ? (attempt.attempt_metadata as Record<string, unknown>)
            : {}),
          integrityFlagged: integrity.flagged,
          integrityReviewStatus: integrity.reviewStatus,
          integritySummary: {
            score: integrity.score,
            eventCount: integrity.eventCount,
            reasons: integrity.reasons,
            severityCounts: integrity.severityCounts
          }
        }
      })
      .eq("id", attemptId)
      .eq("status", "submitting")
      .select("id")
      .maybeSingle();
    if (error || !finalizedAttempt) throwSubmitAttemptRouteError("SUBMIT_FAILED", 500);
    lockHeld = false;

    return NextResponse.json({
      status: "ok",
      submittedAt: now,
      finalStatus: expired ? "auto_submitted" : "submitted",
      result: {
        totalQuestions: scoring.totalQuestions,
        answeredQuestions: scoring.answeredQuestions,
        correctCount: scoring.correctCount,
        incorrectCount: scoring.incorrectCount,
        score: scoring.score,
        percentage: scoring.percentage,
        gradeLetter: scoring.gradeLetter,
        integrityScore: integrity.score,
        integrityFlagged: integrity.flagged
      }
    });
  } catch (error) {
    if (lockHeld) {
      await admin
        .from("exam_attempts")
        .update({ status: "in_progress" })
        .eq("id", attemptId)
        .eq("status", "submitting");
    }
    if (error instanceof SubmitAttemptRouteError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "SUBMIT_FAILED" }, { status: 500 });
  }
}
