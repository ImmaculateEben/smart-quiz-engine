import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionAuthState } from "@/lib/auth/session";
import { hasInstitutionRole } from "@/lib/auth/rbac";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type SearchParams = {
  examId?: string;
};

export default async function ExamAnalyticsPage({
  searchParams
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sp = (await searchParams) ?? {};
  const auth = await getSessionAuthState();
  if (!auth.user) redirect("/login?next=/admin/analytics/exams");

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
          <h1 className="text-2xl font-semibold text-slate-900">Exam Analytics</h1>
          <p className="mt-2 text-sm text-slate-600">Create and publish an exam, then collect submissions to view analytics.</p>
        </section>
      </main>
    );
  }

  const [{ data: exam }, { data: results }, { data: daily }, { data: examQuestions }] = await Promise.all([
    supabase
      .from("exams")
      .select("id,title,status,passing_score,published_at")
      .eq("institution_id", membership.institutionId)
      .eq("id", selectedExamId)
      .single(),
    supabase
      .from("exam_results")
      .select("attempt_id,percentage,score,grade_letter,integrity_score,correct_count,incorrect_count,total_questions,answered_questions,created_at")
      .eq("institution_id", membership.institutionId)
      .eq("exam_id", selectedExamId)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("exam_analytics_daily")
      .select("date_key,attempts_count,submissions_count,avg_percentage,pass_rate,aggregates")
      .eq("institution_id", membership.institutionId)
      .eq("exam_id", selectedExamId)
      .order("date_key", { ascending: false })
      .limit(30),
    supabase
      .from("exam_questions")
      .select("question_id,display_order,points")
      .eq("institution_id", membership.institutionId)
      .eq("exam_id", selectedExamId)
      .order("display_order", { ascending: true })
  ]);

  const questionIds = [...new Set((examQuestions ?? []).map((q) => q.question_id))];
  const [{ data: questions }, { data: qAnalytics }] = await Promise.all([
    questionIds.length
      ? supabase
          .from("questions")
          .select("id,prompt,question_type,difficulty,subject_id")
          .eq("institution_id", membership.institutionId)
          .in("id", questionIds)
      : Promise.resolve({ data: [] }),
    questionIds.length
      ? supabase
          .from("question_analytics")
          .select("question_id,exposure_count,answer_count,correct_count,option_popularity,difficulty_index")
          .eq("institution_id", membership.institutionId)
          .in("question_id", questionIds)
      : Promise.resolve({ data: [] })
  ]);

  const resultsRows = results ?? [];
  const submissions = resultsRows.length;
  const avgPercentage = round2(
    submissions > 0
      ? resultsRows.reduce((sum, r) => sum + Number(r.percentage ?? 0), 0) / submissions
      : 0
  );
  const avgIntegrity = round2(
    submissions > 0
      ? resultsRows.reduce((sum, r) => sum + Number(r.integrity_score ?? 100), 0) / submissions
      : 0
  );
  const passingScore = exam?.passing_score == null ? null : Number(exam.passing_score);
  const passCount =
    passingScore == null ? null : resultsRows.filter((r) => Number(r.percentage ?? 0) >= passingScore).length;
  const passRate = passCount == null || submissions === 0 ? null : round2((passCount / submissions) * 100);
  const scoreBuckets = buildScoreBuckets(resultsRows.map((r) => Number(r.percentage ?? 0)));

  const qMap = new Map((questions ?? []).map((q) => [q.id, q]));
  const qaMap = new Map((qAnalytics ?? []).map((q) => [q.question_id, q]));
  const questionBreakdown = (examQuestions ?? []).map((eq, idx) => {
    const q = qMap.get(eq.question_id);
    const qa = qaMap.get(eq.question_id);
    const exposure = Number(qa?.exposure_count ?? 0);
    const correct = Number(qa?.correct_count ?? 0);
    const answered = Number(qa?.answer_count ?? 0);
    return {
      order: idx + 1,
      questionId: eq.question_id,
      prompt: q?.prompt ?? eq.question_id,
      type: q?.question_type ?? "unknown",
      difficulty: q?.difficulty ?? "unknown",
      points: Number(eq.points ?? 0),
      exposure,
      answered,
      correct,
      accuracy: answered > 0 ? round2((correct / answered) * 100) : null,
      optionPopularity: qa?.option_popularity ?? {}
    };
  });

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Analytics</p>
            <h1 className="mt-3 text-2xl font-semibold text-slate-900">Exam Analytics Dashboard</h1>
            <p className="mt-2 text-sm text-slate-600">
              Submission metrics, score distribution, pass rate trends, and question-level breakdown for a selected exam.
            </p>
            <p className="mt-2 text-sm">
              <Link href={`/admin/analytics/questions?examId=${selectedExamId}`} className="font-medium text-blue-700 hover:text-blue-800">
                Open question intelligence &rarr;
              </Link>
            </p>
            <p className="mt-1 text-sm">
              <Link href="/admin/analytics/exports" className="font-medium text-blue-700 hover:text-blue-800">
                Open exports & reports &rarr;
              </Link>
            </p>
          </div>
          <form method="get" className="min-w-72">
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
              Load analytics
            </button>
          </form>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Submissions" value={String(submissions)} />
          <Metric label="Average Score" value={`${avgPercentage}%`} />
          <Metric label="Pass Rate" value={passRate == null ? "n/a" : `${passRate}%`} />
          <Metric label="Avg Integrity" value={`${avgIntegrity}`} tone={avgIntegrity < 75 ? "warn" : "neutral"} />
        </div>

        <section className="mt-8 grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
            <h2 className="text-lg font-semibold text-slate-900">Score distribution</h2>
            <p className="mt-1 text-sm text-slate-600">Histogram buckets from `exam_results.percentage`.</p>
            <div className="mt-4 space-y-3">
              {scoreBuckets.map((bucket) => (
                <div key={bucket.label}>
                  <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
                    <span>{bucket.label}</span>
                    <span>{bucket.count}</span>
                  </div>
                  <div className="h-3 rounded-full bg-slate-200">
                    <div
                      className="h-3 rounded-full bg-slate-900"
                      style={{ width: `${bucket.maxCount > 0 ? Math.round((bucket.count / bucket.maxCount) * 100) : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-slate-900">Pass rate trend (daily)</h2>
            <p className="mt-1 text-sm text-slate-600">Precomputed from `exam_analytics_daily`.</p>
            <div className="mt-4 space-y-3">
              {(daily ?? []).length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                  No daily analytics yet.
                </div>
              ) : (
                (daily ?? []).map((d) => (
                  <div key={d.date_key} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="font-medium text-slate-900">{d.date_key}</span>
                      <span className="text-slate-600">
                        {d.submissions_count} submissions | avg {formatMaybeNum(d.avg_percentage)}% | pass {formatMaybeNum(d.pass_rate)}%
                      </span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-slate-100">
                      <div
                        className="h-2 rounded-full bg-emerald-500"
                        style={{ width: `${Math.max(0, Math.min(100, Number(d.pass_rate ?? 0)))}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">Question-level breakdown</h2>
          <p className="mt-1 text-sm text-slate-600">
            Accuracy and response volumes for questions assigned to this exam (using `question_analytics`).
          </p>
          <div className="mt-4 space-y-3">
            {questionBreakdown.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                No question breakdown available.
              </div>
            ) : (
              questionBreakdown.map((q) => (
                <details key={q.questionId} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <summary className="cursor-pointer list-none">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          Q{q.order}. {q.prompt}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {q.type} | {q.difficulty} | {q.points} pt{q.points === 1 ? "" : "s"}
                        </p>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <TinyStat label="Exposed" value={String(q.exposure)} />
                        <TinyStat label="Answered" value={String(q.answered)} />
                        <TinyStat
                          label="Accuracy"
                          value={q.accuracy == null ? "n/a" : `${q.accuracy}%`}
                          tone={q.accuracy != null && q.accuracy < 50 ? "warn" : "neutral"}
                        />
                      </div>
                    </div>
                  </summary>
                  <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Option popularity / answer buckets</p>
                    <pre className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                      {JSON.stringify(q.optionPopularity ?? {}, null, 2)}
                    </pre>
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

function Metric({
  label,
  value,
  tone = "neutral"
}: {
  label: string;
  value: string;
  tone?: "neutral" | "warn";
}) {
  return (
    <div className={`rounded-xl border px-4 py-4 ${tone === "warn" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50"}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function TinyStat({
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

function buildScoreBuckets(values: number[]) {
  const ranges = [
    [0, 9],
    [10, 19],
    [20, 29],
    [30, 39],
    [40, 49],
    [50, 59],
    [60, 69],
    [70, 79],
    [80, 89],
    [90, 100]
  ] as const;
  const buckets = ranges.map(([min, max]) => ({
    label: `${min}-${max}%`,
    min,
    max,
    count: 0,
    maxCount: 0
  }));
  for (const raw of values) {
    const value = Math.max(0, Math.min(100, Number(raw) || 0));
    const idx = Math.min(9, Math.floor(value / 10));
    buckets[idx].count += 1;
  }
  const maxCount = Math.max(0, ...buckets.map((b) => b.count));
  return buckets.map((b) => ({ ...b, maxCount }));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function formatMaybeNum(value: unknown) {
  if (value == null) return "0";
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : String(value);
}
