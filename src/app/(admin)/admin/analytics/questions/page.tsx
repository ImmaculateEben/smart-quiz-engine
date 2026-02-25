import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionAuthState } from "@/lib/auth/session";
import { hasInstitutionRole } from "@/lib/auth/rbac";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasAnswerPayload, isQuestionAnswerCorrect } from "@/lib/scoring/score-attempt";

type SearchParams = {
  examId?: string;
};

type AttemptResultRow = {
  attempt_id: string;
  percentage: number | string | null;
};

export default async function QuestionIntelligencePage({
  searchParams
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sp = (await searchParams) ?? {};
  const auth = await getSessionAuthState();
  if (!auth.user) redirect("/login?next=/admin/analytics/questions");

  const membership = auth.memberships.find((m) =>
    ["owner", "admin", "editor", "viewer"].includes(m.role)
  ) ?? null;
  const canView =
    Boolean(auth.context && hasInstitutionRole(auth.context, ["owner", "admin", "editor", "viewer"])) ||
    Boolean(membership);
  if (!membership || !canView) {
    return <main className="mx-auto max-w-4xl px-6 py-10 text-sm">Insufficient permissions.</main>;
  }

  const supabase = await createSupabaseServerClient();
  const { data: exams } = await supabase
    .from("exams")
    .select("id,title,status,deleted_at")
    .eq("institution_id", membership.institutionId)
    .is("deleted_at", null)
    .order("title");

  const selectedExamId =
    (sp.examId && (exams ?? []).some((e) => e.id === sp.examId) ? sp.examId : undefined) ?? exams?.[0]?.id ?? null;

  if (!selectedExamId) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">Question Intelligence</h1>
          <p className="mt-2 text-sm text-slate-600">No exams found. Create and publish an exam first.</p>
        </section>
      </main>
    );
  }

  const [{ data: exam }, { data: examQuestions }, { data: results }] = await Promise.all([
    supabase
      .from("exams")
      .select("id,title,status")
      .eq("institution_id", membership.institutionId)
      .eq("id", selectedExamId)
      .single(),
    supabase
      .from("exam_questions")
      .select("question_id,display_order,points")
      .eq("institution_id", membership.institutionId)
      .eq("exam_id", selectedExamId)
      .order("display_order", { ascending: true }),
    supabase
      .from("exam_results")
      .select("attempt_id,percentage")
      .eq("institution_id", membership.institutionId)
      .eq("exam_id", selectedExamId)
      .order("created_at", { ascending: false })
      .limit(300)
  ]);

  const questionIds = [...new Set((examQuestions ?? []).map((q) => q.question_id))];
  const attemptResults = ((results ?? []) as AttemptResultRow[]).filter((r) => r.attempt_id);
  const attemptIds = attemptResults.map((r) => r.attempt_id);

  const [{ data: questions }, { data: qAnalytics }, { data: answers }] = await Promise.all([
    questionIds.length
      ? supabase
          .from("questions")
          .select("id,prompt,question_type,difficulty,correct_answer,short_answer_rules")
          .eq("institution_id", membership.institutionId)
          .in("id", questionIds)
      : Promise.resolve({ data: [] }),
    questionIds.length
      ? supabase
          .from("question_analytics")
          .select("question_id,option_popularity,exposure_count,answer_count,correct_count,difficulty_index,discrimination_index")
          .eq("institution_id", membership.institutionId)
          .in("question_id", questionIds)
      : Promise.resolve({ data: [] }),
    attemptIds.length && questionIds.length
      ? supabase
          .from("attempt_answers")
          .select("attempt_id,question_id,answer_payload")
          .eq("institution_id", membership.institutionId)
          .eq("exam_id", selectedExamId)
          .in("attempt_id", attemptIds)
          .in("question_id", questionIds)
      : Promise.resolve({ data: [] })
  ]);

  const qMap = new Map((questions ?? []).map((q) => [q.id, q]));
  const qaMap = new Map((qAnalytics ?? []).map((q) => [q.question_id, q]));
  const answersByQuestion = new Map<string, Array<{ attemptId: string; answerPayload: unknown }>>();
  for (const row of answers ?? []) {
    const list = answersByQuestion.get(row.question_id) ?? [];
    list.push({ attemptId: row.attempt_id, answerPayload: row.answer_payload });
    answersByQuestion.set(row.question_id, list);
  }

  const scoreMap = new Map(attemptResults.map((r) => [r.attempt_id, Number(r.percentage ?? 0)]));
  const rankedAttempts = [...attemptResults]
    .map((r) => ({ attemptId: r.attempt_id, percentage: Number(r.percentage ?? 0) }))
    .sort((a, b) => b.percentage - a.percentage);
  const groupSize = rankedAttempts.length >= 4 ? Math.max(1, Math.floor(rankedAttempts.length * 0.27)) : 0;
  const upperSet = new Set(rankedAttempts.slice(0, groupSize).map((r) => r.attemptId));
  const lowerSet = new Set(rankedAttempts.slice(-groupSize).map((r) => r.attemptId));

  const rows = (examQuestions ?? []).map((eq, idx) => {
    const q = qMap.get(eq.question_id);
    const analytics = qaMap.get(eq.question_id);
    const answerRows = answersByQuestion.get(eq.question_id) ?? [];

    let answered = 0;
    let correct = 0;
    let upperAnswered = 0;
    let upperCorrect = 0;
    let lowerAnswered = 0;
    let lowerCorrect = 0;
    const localOptionPopularity: Record<string, number> = {};

    for (const row of answerRows) {
      const answerPayload = row.answerPayload;
      const answeredThis = hasAnswerPayload(answerPayload);
      if (answeredThis) answered += 1;

      const correctThis =
        answeredThis && q
          ? isQuestionAnswerCorrect({
              questionType: q.question_type,
              correctAnswer: q.correct_answer,
              shortAnswerRules: q.short_answer_rules,
              answerPayload
            })
          : false;
      if (correctThis) correct += 1;

      if (upperSet.has(row.attemptId)) {
        if (answeredThis) upperAnswered += 1;
        if (correctThis) upperCorrect += 1;
      }
      if (lowerSet.has(row.attemptId)) {
        if (answeredThis) lowerAnswered += 1;
        if (correctThis) lowerCorrect += 1;
      }

      const bucket = answerBucket(answerPayload);
      if (bucket) localOptionPopularity[bucket] = Number(localOptionPopularity[bucket] ?? 0) + 1;
    }

    const difficultyIndex = answered > 0 ? round4(correct / answered) : null;
    const upperRate = upperAnswered > 0 ? upperCorrect / upperAnswered : null;
    const lowerRate = lowerAnswered > 0 ? lowerCorrect / lowerAnswered : null;
    const discriminationIndex =
      upperRate != null && lowerRate != null && groupSize > 0 ? round4(upperRate - lowerRate) : null;
    const blankRate = attemptIds.length > 0 ? round4((attemptIds.length - answered) / attemptIds.length) : null;

    const problemFlags = [
      discriminationIndex != null && discriminationIndex < 0.1 ? "low_discrimination" : null,
      discriminationIndex != null && discriminationIndex < 0 ? "negative_discrimination" : null,
      difficultyIndex != null && difficultyIndex < 0.25 ? "too_hard" : null,
      difficultyIndex != null && difficultyIndex > 0.9 ? "too_easy" : null,
      blankRate != null && blankRate > 0.35 ? "high_blank_rate" : null,
      answered < Math.max(5, Math.floor(attemptIds.length * 0.2)) ? "low_sample" : null
    ].filter(Boolean) as string[];

    return {
      order: idx + 1,
      questionId: eq.question_id,
      prompt: q?.prompt ?? eq.question_id,
      questionType: q?.question_type ?? "unknown",
      difficultyTag: q?.difficulty ?? "unknown",
      points: Number(eq.points ?? 0),
      attemptsSeen: attemptIds.length,
      answered,
      correct,
      difficultyIndex,
      discriminationIndex,
      blankRate,
      problemFlags,
      optionPopularityTracked: analytics?.option_popularity ?? {},
      optionPopularityExamLocal: localOptionPopularity
    };
  });

  const flaggedRows = rows.filter((r) => r.problemFlags.length > 0);
  const avgDiscrimination = round4(
    avg(rows.map((r) => r.discriminationIndex).filter((v): v is number => typeof v === "number"))
  );
  const avgDifficulty = round4(
    avg(rows.map((r) => r.difficultyIndex).filter((v): v is number => typeof v === "number"))
  );

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Analytics</p>
            <h1 className="mt-3 text-2xl font-semibold text-slate-900">Question Intelligence</h1>
            <p className="mt-2 text-sm text-slate-600">
              Difficulty/discrimination analysis, option popularity, and problem-question identification for a selected exam.
            </p>
          </div>
          <div className="flex min-w-80 flex-col gap-2">
            <form method="get">
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">Exam</label>
              <select
                name="examId"
                defaultValue={selectedExamId}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm"
              >
                {(exams ?? []).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title} ({e.status})
                  </option>
                ))}
              </select>
              <button className="mt-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50">
                Load intelligence
              </button>
            </form>
            <Link
              href={`/admin/analytics/exams?examId=${selectedExamId}`}
              className="text-sm font-medium text-blue-700 hover:text-blue-800"
            >
              Open exam analytics dashboard
            </Link>
          </div>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Exam" value={exam?.title ?? selectedExamId} compact />
          <Metric label="Submissions Used" value={String(attemptIds.length)} />
          <Metric label="Avg Difficulty Index" value={formatMetric(avgDifficulty)} />
          <Metric label="Avg Discrimination" value={formatMetric(avgDiscrimination)} tone={avgDiscrimination < 0.2 ? "warn" : "neutral"} />
        </div>

        <section className="mt-8 rounded-2xl border border-slate-200 bg-amber-50 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-amber-950">Problem questions</h2>
              <p className="mt-1 text-sm text-amber-900">
                Questions flagged by low discrimination, extreme difficulty, blank-rate spikes, or limited sample size.
              </p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-white px-4 py-2 text-sm font-semibold text-amber-900">
              {flaggedRows.length} flagged
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {flaggedRows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-amber-300 bg-white p-4 text-sm text-amber-900">
                No problem-question flags for the current dataset.
              </div>
            ) : (
              flaggedRows.slice(0, 12).map((row) => (
                <div key={`flag-${row.questionId}`} className="rounded-xl border border-amber-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Q{row.order}. {row.prompt}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        diff idx: {formatMetric(row.difficultyIndex)} | discrim: {formatMetric(row.discriminationIndex)} | blank: {formatPct(row.blankRate)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {row.problemFlags.map((flag) => (
                        <span key={flag} className="rounded-full border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900">
                          {flag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">Question intelligence breakdown</h2>
          <p className="mt-1 text-sm text-slate-600">
            `difficulty_index` = correct / answered. `discrimination_index` = upper-group correct rate minus lower-group correct rate.
          </p>
          <div className="mt-4 space-y-3">
            {rows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                No questions found for this exam.
              </div>
            ) : (
              rows.map((row) => (
                <details key={row.questionId} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <summary className="cursor-pointer list-none">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">Q{row.order}. {row.prompt}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {row.questionType} | {row.difficultyTag} | {row.points} pt{row.points === 1 ? "" : "s"}
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                        <MiniStat label="Difficulty" value={formatMetric(row.difficultyIndex)} tone={row.difficultyIndex != null && (row.difficultyIndex < 0.25 || row.difficultyIndex > 0.9) ? "warn" : "neutral"} />
                        <MiniStat label="Discrimination" value={formatMetric(row.discriminationIndex)} tone={row.discriminationIndex != null && row.discriminationIndex < 0.2 ? "warn" : "neutral"} />
                        <MiniStat label="Answered" value={`${row.answered}/${row.attemptsSeen}`} />
                        <MiniStat label="Blank Rate" value={formatPct(row.blankRate)} tone={row.blankRate != null && row.blankRate > 0.35 ? "warn" : "neutral"} />
                      </div>
                    </div>
                  </summary>

                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tracked option popularity (global)</p>
                      <pre className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                        {JSON.stringify(row.optionPopularityTracked ?? {}, null, 2)}
                      </pre>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Exam-local answer buckets</p>
                      <pre className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                        {JSON.stringify(row.optionPopularityExamLocal ?? {}, null, 2)}
                      </pre>
                    </div>
                  </div>
                </details>
              ))
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

function answerBucket(answerPayload: unknown) {
  if (answerPayload == null) return null;
  if (typeof answerPayload === "number" && Number.isFinite(answerPayload)) return `n:${answerPayload}`;
  if (typeof answerPayload === "boolean") return `b:${answerPayload ? "true" : "false"}`;
  if (typeof answerPayload === "string") {
    const trimmed = answerPayload.trim();
    return trimmed ? `s:${trimmed.slice(0, 80).toLowerCase()}` : null;
  }
  if (Array.isArray(answerPayload)) {
    const normalized = answerPayload
      .map((v) => (typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : ""))
      .filter(Boolean)
      .sort()
      .join(",");
    return normalized ? `a:${normalized}` : null;
  }
  return null;
}

function avg(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function round4(value: number) {
  return Math.round(value * 10000) / 10000;
}

function formatMetric(value: number | null) {
  return value == null || !Number.isFinite(value) ? "n/a" : value.toFixed(4);
}

function formatPct(value: number | null) {
  return value == null || !Number.isFinite(value) ? "n/a" : `${(value * 100).toFixed(2)}%`;
}

function Metric({
  label,
  value,
  tone = "neutral",
  compact = false
}: {
  label: string;
  value: string;
  tone?: "neutral" | "warn";
  compact?: boolean;
}) {
  return (
    <div className={`rounded-xl border px-4 py-4 ${tone === "warn" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50"}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-2 font-semibold text-slate-900 ${compact ? "text-sm" : "text-lg"}`}>{value}</p>
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone = "neutral"
}: {
  label: string;
  value: string;
  tone?: "neutral" | "warn";
}) {
  return (
    <div className={`rounded-md border px-2 py-1 ${tone === "warn" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 font-semibold text-slate-900">{value}</p>
    </div>
  );
}
