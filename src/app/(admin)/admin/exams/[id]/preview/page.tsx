import type { Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionAuthState } from "@/lib/auth/session";
import { hasInstitutionRole } from "@/lib/auth/rbac";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/log";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | undefined>>;
};

function route(examId: string, params: Record<string, string | undefined>): Route {
  const s = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v && s.set(k, v));
  const q = s.toString();
  return (q ? `/admin/exams/${examId}/preview?${q}` : `/admin/exams/${examId}/preview`) as Route;
}

export default async function ExamPreviewPage({ params, searchParams }: PageProps) {
  const { id: examId } = await params;
  const sp = (await searchParams) ?? {};
  const auth = await getSessionAuthState();
  if (!auth.user) redirect(`/login?next=/admin/exams/${examId}/preview`);
  const membership = auth.memberships.find((m) => ["owner", "admin", "editor"].includes(m.role)) ?? null;
  const canManage =
    Boolean(auth.context && hasInstitutionRole(auth.context, ["owner", "admin", "editor"])) || Boolean(membership);
  if (!membership || !canManage) return <main className="mx-auto max-w-4xl px-6 py-10 text-sm">Insufficient permissions.</main>;

  const supabase = await createSupabaseServerClient();
  const institutionId = membership.institutionId;
  const [examRes, sectionsRes, examQuestionsRes] = await Promise.all([
    supabase
      .from("exams")
      .select("id,title,description,status,duration_minutes,passing_score,shuffle_questions,shuffle_options,show_result_immediately,allow_review,max_attempts,settings,published_at")
      .eq("id", examId)
      .eq("institution_id", institutionId)
      .is("deleted_at", null)
      .single(),
    supabase
      .from("exam_sections")
      .select("id,title,question_count,difficulty_distribution,selection_mode,display_order")
      .eq("exam_id", examId)
      .eq("institution_id", institutionId)
      .order("display_order"),
    supabase
      .from("exam_questions")
      .select("id,section_id,question_id,display_order,points,required")
      .eq("exam_id", examId)
      .eq("institution_id", institutionId)
      .order("display_order")
  ]);
  if (!examRes.data) return <main className="mx-auto max-w-4xl px-6 py-10 text-sm">Exam not found.</main>;

  const exam = examRes.data;
  const eqs = examQuestionsRes.data ?? [];
  const selectedQuestionIds = [...new Set(eqs.map((eq) => eq.question_id).filter(Boolean))];
  const { data: previewQuestions } = selectedQuestionIds.length
    ? await supabase
        .from("questions")
        .select("id,prompt,question_type,difficulty,is_active,deleted_at")
        .eq("institution_id", institutionId)
        .in("id", selectedQuestionIds)
    : { data: [] as Array<any> };
  const qMap = new Map((previewQuestions ?? []).map((q) => [q.id, q]));
  const sections = sectionsRes.data ?? [];

  const validation: string[] = [];
  if (!exam.title.trim()) validation.push("Title is required.");
  if (!Number.isFinite(exam.duration_minutes) || exam.duration_minutes <= 0) validation.push("Duration must be greater than 0.");
  if (eqs.length === 0) validation.push("At least one question must be selected.");
  const invalidSelected = eqs.filter((eq) => {
    const q = qMap.get(eq.question_id);
    return !q || q.deleted_at || !q.is_active;
  });
  if (invalidSelected.length > 0) validation.push(`${invalidSelected.length} selected questions are inactive or deleted.`);
  const duplicateSelected = eqs.length !== new Set(eqs.map((e) => e.question_id)).size;
  if (duplicateSelected) validation.push("Duplicate questions are selected.");
  const canPublish = validation.length === 0;

  async function publishExam() {
    "use server";
    const auth = await getSessionAuthState();
    const membership = auth.memberships.find((m) => ["owner", "admin", "editor"].includes(m.role)) ?? null;
    if (!auth.user || !membership) redirect(route(examId, { error: "forbidden" }));

    const supabase = await createSupabaseServerClient();
    const [examRes, selectedRes] = await Promise.all([
      supabase.from("exams").select("id,title,duration_minutes,status").eq("id", examId).eq("institution_id", membership.institutionId).single(),
      supabase.from("exam_questions").select("question_id").eq("exam_id", examId).eq("institution_id", membership.institutionId)
    ]);
    const selectedQuestionIds = [...new Set((selectedRes.data ?? []).map((eq) => eq.question_id).filter(Boolean))];
    const { data: questionsData } = selectedQuestionIds.length
      ? await supabase
          .from("questions")
          .select("id,is_active,deleted_at")
          .eq("institution_id", membership.institutionId)
          .in("id", selectedQuestionIds)
      : { data: [] as Array<any> };
    if (!examRes.data) redirect(route(examId, { error: "not_found" }));
    const qMap = new Map((questionsData ?? []).map((q) => [q.id, q]));
    const issues: string[] = [];
    if (!examRes.data.title.trim()) issues.push("missing_title");
    if (!examRes.data.duration_minutes || examRes.data.duration_minutes <= 0) issues.push("invalid_duration");
    if ((selectedRes.data ?? []).length === 0) issues.push("no_questions");
    if ((selectedRes.data ?? []).some((eq) => {
      const q = qMap.get(eq.question_id);
      return !q || q.deleted_at || !q.is_active;
    })) issues.push("invalid_selected_questions");
    if (issues.length > 0) redirect(route(examId, { error: "validation_failed" }));

    const { error } = await supabase
      .from("exams")
      .update({ status: "published", published_at: new Date().toISOString() })
      .eq("id", examId)
      .eq("institution_id", membership.institutionId);
    if (error) redirect(route(examId, { error: "publish_failed" }));

    try {
      await logAuditEvent({ institutionId: membership.institutionId, action: "exam.publish", entityType: "exams", entityId: examId });
    } catch {}
    redirect(route(examId, { status: "published" }));
  }

  async function unpublishExam() {
    "use server";
    const auth = await getSessionAuthState();
    const membership = auth.memberships.find((m) => ["owner", "admin", "editor"].includes(m.role)) ?? null;
    if (!auth.user || !membership) redirect(route(examId, { error: "forbidden" }));
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("exams")
      .update({ status: "draft", published_at: null })
      .eq("id", examId)
      .eq("institution_id", membership.institutionId);
    if (error) redirect(route(examId, { error: "unpublish_failed" }));
    try {
      await logAuditEvent({ institutionId: membership.institutionId, action: "exam.unpublish", entityType: "exams", entityId: examId });
    } catch {}
    redirect(route(examId, { status: "unpublished" }));
  }

  const errorCopy: Record<string, string> = {
    forbidden: "You do not have permission to publish exams.",
    not_found: "Exam not found.",
    validation_failed: "Exam validation failed. Fix issues listed below.",
    publish_failed: "Failed to publish exam.",
    unpublish_failed: "Failed to unpublish exam."
  };

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Exam Preview & Publishing</p>
            <h1 className="mt-3 text-2xl font-semibold text-slate-900">{exam.title}</h1>
            <p className="mt-2 text-sm text-slate-600">Preview exam configuration, validate selection integrity, and publish/unpublish.</p>
          </div>
          <div className="flex gap-2">
            <Link href={`/admin/exams/${examId}/questions`} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Question selection</Link>
            <Link href="/admin/exams" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Back to exams</Link>
          </div>
        </div>

        {sp.error ? <Banner tone="error" text={errorCopy[sp.error] ?? "Preview action failed."} /> : null}
        {sp.status ? <Banner tone="success" text={sp.status === "published" ? "Exam published." : sp.status === "unpublished" ? "Exam reverted to draft." : `Status: ${sp.status}`} /> : null}

        <div className="mt-8 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
            <h2 className="text-lg font-semibold text-slate-900">Configuration summary</h2>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2 text-sm">
              <Summary label="Status" value={exam.status} />
              <Summary label="Duration" value={`${exam.duration_minutes} mins`} />
              <Summary label="Passing score" value={exam.passing_score == null ? "n/a" : `${exam.passing_score}%`} />
              <Summary label="Max attempts" value={String(exam.max_attempts)} />
              <Summary label="Shuffle questions" value={exam.shuffle_questions ? "Yes" : "No"} />
              <Summary label="Shuffle options" value={exam.shuffle_options ? "Yes" : "No"} />
              <Summary label="Show result immediately" value={exam.show_result_immediately ? "Yes" : "No"} />
              <Summary label="Allow review" value={exam.allow_review ? "Yes" : "No"} />
            </dl>
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Description</p>
              <p className="mt-1 text-sm text-slate-700">{exam.description ?? "No description"}</p>
            </div>
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Settings JSON</p>
              <pre className="mt-1 overflow-x-auto rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-700">
                {JSON.stringify(exam.settings ?? {}, null, 2)}
              </pre>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-slate-900">Validation</h2>
            {validation.length === 0 ? (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                Ready to publish.
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                {validation.map((msg, i) => (
                  <div key={i} className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                    {msg}
                  </div>
                ))}
              </div>
            )}

            <div className="mt-6 grid gap-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
                <p className="font-medium text-slate-900">Sections</p>
                <p className="mt-1 text-slate-600">{sections.length} sections configured</p>
                <div className="mt-2 space-y-2">
                  {sections.map((s) => (
                    <div key={s.id} className="rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-600">
                      {s.title} | mode: {s.selection_mode} | count: {s.question_count}
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
                <p className="font-medium text-slate-900">Question selection</p>
                <p className="mt-1 text-slate-600">{eqs.length} exam questions selected</p>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              <form action={publishExam}>
                <button disabled={!canPublish} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
                  Publish exam
                </button>
              </form>
              <form action={unpublishExam}>
                <button className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  Unpublish to draft
                </button>
              </form>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm text-slate-900">{value}</dd>
    </div>
  );
}

function Banner({ tone, text }: { tone: "error" | "success"; text: string }) {
  const cls = tone === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-900";
  return <div className={`mt-5 rounded-xl border px-4 py-3 text-sm ${cls}`}>{text}</div>;
}
