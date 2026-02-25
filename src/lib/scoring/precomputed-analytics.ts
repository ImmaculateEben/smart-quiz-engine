import type { ScoreAttemptOutput } from "./score-attempt";

type AdminClient = {
  from: (table: string) => any;
};

export async function applyPrecomputedSubmissionAnalytics(params: {
  admin: AdminClient;
  institutionId: string;
  examId: string;
  submittedAtIso: string;
  scoring: ScoreAttemptOutput;
}) {
  const { admin, institutionId, examId, submittedAtIso, scoring } = params;
  const dateKey = submittedAtIso.slice(0, 10);

  await upsertExamAnalyticsDaily({
    admin,
    institutionId,
    examId,
    dateKey,
    percentage: scoring.percentage,
    passed: scoring.passed
  });

  for (const outcome of scoring.questionOutcomes) {
    await upsertQuestionAnalytics({
      admin,
      institutionId,
      questionId: outcome.questionId,
      answered: outcome.answered,
      correct: outcome.correct,
      optionKey: toOptionPopularityKey(outcome.answerPayload)
    });
  }

  const answeredQuestionIds = scoring.questionOutcomes.filter((o) => o.answered).map((o) => o.questionId);
  if (answeredQuestionIds.length > 0) {
    await incrementQuestionUsageCounts({ admin, institutionId, questionIds: answeredQuestionIds });
  }
}

async function upsertExamAnalyticsDaily(params: {
  admin: AdminClient;
  institutionId: string;
  examId: string;
  dateKey: string;
  percentage: number;
  passed: boolean | null;
}) {
  const { admin, institutionId, examId, dateKey, percentage, passed } = params;
  const { data: existing } = await admin
    .from("exam_analytics_daily")
    .select("id,attempts_count,submissions_count,avg_percentage,pass_rate,aggregates")
    .eq("institution_id", institutionId)
    .eq("exam_id", examId)
    .eq("date_key", dateKey)
    .maybeSingle();

  const priorSubmissions = Number(existing?.submissions_count ?? 0);
  const nextSubmissions = priorSubmissions + 1;
  const priorAttempts = Number(existing?.attempts_count ?? 0);
  const nextAttempts = Math.max(nextSubmissions, priorAttempts + 1);
  const priorAvg = existing?.avg_percentage == null ? null : Number(existing.avg_percentage);
  const priorPassRate = existing?.pass_rate == null ? null : Number(existing.pass_rate);
  const passValue = passed == null ? null : passed ? 100 : 0;
  const nextAvg =
    priorSubmissions <= 0 || priorAvg == null ? round2(percentage) : round2(((priorAvg * priorSubmissions) + percentage) / nextSubmissions);
  const nextPassRate =
    passValue == null
      ? priorPassRate
      : priorSubmissions <= 0 || priorPassRate == null
        ? round2(passValue)
        : round2(((priorPassRate * priorSubmissions) + passValue) / nextSubmissions);

  const aggregates = isRecord(existing?.aggregates) ? { ...existing.aggregates } : {};
  const sumPercentage = round2(Number(aggregates.sum_percentage ?? 0) + percentage);
  const passCount =
    passValue == null
      ? Number(aggregates.pass_count ?? 0)
      : Number(aggregates.pass_count ?? 0) + (passed ? 1 : 0);

  await admin.from("exam_analytics_daily").upsert(
    {
      institution_id: institutionId,
      exam_id: examId,
      date_key: dateKey,
      attempts_count: nextAttempts,
      submissions_count: nextSubmissions,
      avg_percentage: nextAvg,
      pass_rate: nextPassRate,
      aggregates: {
        ...aggregates,
        sum_percentage: sumPercentage,
        pass_count: passCount,
        last_submission_at: new Date().toISOString()
      }
    },
    { onConflict: "institution_id,exam_id,date_key" }
  );
}

async function upsertQuestionAnalytics(params: {
  admin: AdminClient;
  institutionId: string;
  questionId: string;
  answered: boolean;
  correct: boolean;
  optionKey: string | null;
}) {
  const { admin, institutionId, questionId, answered, correct, optionKey } = params;
  const { data: existing } = await admin
    .from("question_analytics")
    .select("id,exposure_count,answer_count,correct_count,option_popularity")
    .eq("institution_id", institutionId)
    .eq("question_id", questionId)
    .maybeSingle();

  const optionPopularity = isRecord(existing?.option_popularity) ? { ...existing.option_popularity } : {};
  if (answered && optionKey) {
    optionPopularity[optionKey] = Number(optionPopularity[optionKey] ?? 0) + 1;
  }

  await admin.from("question_analytics").upsert(
    {
      institution_id: institutionId,
      question_id: questionId,
      exposure_count: Number(existing?.exposure_count ?? 0) + 1,
      answer_count: Number(existing?.answer_count ?? 0) + (answered ? 1 : 0),
      correct_count: Number(existing?.correct_count ?? 0) + (correct ? 1 : 0),
      option_popularity: optionPopularity,
      updated_at: new Date().toISOString()
    },
    { onConflict: "question_id" }
  );
}

async function incrementQuestionUsageCounts(params: {
  admin: AdminClient;
  institutionId: string;
  questionIds: string[];
}) {
  const ids = [...new Set(params.questionIds)];
  const { data: rows } = await params.admin
    .from("questions")
    .select("id,usage_count")
    .eq("institution_id", params.institutionId)
    .in("id", ids);

  for (const row of rows ?? []) {
    await params.admin
      .from("questions")
      .update({ usage_count: Number(row.usage_count ?? 0) + 1 })
      .eq("id", row.id)
      .eq("institution_id", params.institutionId);
  }
}

function toOptionPopularityKey(answerPayload: unknown) {
  if (answerPayload == null) return null;
  if (typeof answerPayload === "number" && Number.isFinite(answerPayload)) return `n:${answerPayload}`;
  if (typeof answerPayload === "boolean") return `b:${answerPayload ? "true" : "false"}`;
  if (typeof answerPayload === "string") {
    const trimmed = answerPayload.trim();
    if (!trimmed) return null;
    return `s:${trimmed.slice(0, 120).toLowerCase()}`;
  }
  if (Array.isArray(answerPayload)) {
    const normalized = answerPayload
      .map((v) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" ? v.trim() : null))
      .filter((v) => v != null)
      .join(",");
    return normalized ? `a:${normalized}` : null;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
