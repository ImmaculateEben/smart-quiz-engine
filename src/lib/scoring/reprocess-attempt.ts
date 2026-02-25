import { scoreAttempt } from "@/lib/scoring/score-attempt";
import { applyPrecomputedSubmissionAnalytics } from "@/lib/scoring/precomputed-analytics";
import { calculateIntegrityScore } from "@/lib/integrity/score";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type ReprocessAttemptScoringParams = {
  attemptId: string;
};

export async function reprocessAttemptScoring(params: ReprocessAttemptScoringParams) {
  const attemptId = params.attemptId.trim();
  if (!attemptId) {
    throw new Error("Missing attemptId");
  }

  const admin = createSupabaseAdminClient();
  const { data: existingResult } = await admin
    .from("exam_results")
    .select("id,analytics_snapshot")
    .eq("attempt_id", attemptId)
    .maybeSingle();

  const { data: attempt } = await admin
    .from("exam_attempts")
    .select("id,institution_id,exam_id,candidate_id,status,submitted_at,attempt_metadata")
    .eq("id", attemptId)
    .single();

  if (!attempt) throw new Error("Attempt not found");
  if (!["submitted", "auto_submitted", "expired"].includes(String(attempt.status))) {
    throw new Error("Attempt not in a reprocessable status");
  }

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

  if (!exam) throw new Error("Exam not found");
  if (!examQuestions || examQuestions.length === 0) throw new Error("Exam has no questions");

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

  const integrity = calculateIntegrityScore(
    ((integrityEvents ?? []) as Array<{
      event_type: string;
      severity: string | null;
      metadata?: unknown;
      created_at?: string | null;
    }>) ?? []
  );

  const now = new Date().toISOString();
  const analyticsSnapshot = {
    ...(scoring.analyticsSnapshot as Record<string, unknown>),
    integrity: {
      score: integrity.score,
      flagged: integrity.flagged,
      reviewStatus: integrity.reviewStatus,
      eventCount: integrity.eventCount,
      reasons: integrity.reasons,
      severityCounts: integrity.severityCounts,
      typeCounts: integrity.typeCounts
    }
  };

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
      analytics_snapshot: analyticsSnapshot
    },
    { onConflict: "attempt_id" }
  );
  if (resultError) {
    throw new Error(`Failed to upsert result: ${resultError.message}`);
  }

  const analyticsAlreadyApplied =
    existingResult &&
    typeof existingResult.analytics_snapshot === "object" &&
    existingResult.analytics_snapshot !== null &&
    (existingResult.analytics_snapshot as Record<string, unknown>).precomputedAnalyticsApplied === true;

  if (!analyticsAlreadyApplied && !existingResult) {
    await applyPrecomputedSubmissionAnalytics({
      admin,
      institutionId: attempt.institution_id,
      examId: attempt.exam_id,
      submittedAtIso: attempt.submitted_at ?? now,
      scoring
    });
    await admin
      .from("exam_results")
      .update({
        analytics_snapshot: {
          ...analyticsSnapshot,
          precomputedAnalyticsApplied: true,
          precomputedAnalyticsAppliedAt: now,
          precomputedAnalyticsSource: "ops_reprocess"
        }
      })
      .eq("attempt_id", attempt.id);
  }

  const baseAttemptMetadata =
    attempt.attempt_metadata &&
    typeof attempt.attempt_metadata === "object" &&
    !Array.isArray(attempt.attempt_metadata)
      ? (attempt.attempt_metadata as Record<string, unknown>)
      : {};

  await admin
    .from("exam_attempts")
    .update({
      integrity_score: integrity.score,
      attempt_metadata: {
        ...baseAttemptMetadata,
        integrityFlagged: integrity.flagged,
        integrityReviewStatus: integrity.reviewStatus,
        integritySummary: {
          score: integrity.score,
          eventCount: integrity.eventCount,
          reasons: integrity.reasons,
          severityCounts: integrity.severityCounts
        },
        scoringReprocessedAt: now
      }
    })
    .eq("id", attempt.id);

  return {
    attemptId: attempt.id,
    institutionId: attempt.institution_id as string,
    examId: attempt.exam_id as string,
    percentage: scoring.percentage,
    gradeLetter: scoring.gradeLetter,
    integrityScore: integrity.score,
    analyticsApplied: !existingResult
  };
}
