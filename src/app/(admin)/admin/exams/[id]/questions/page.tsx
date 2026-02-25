import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSessionAuthState } from "@/lib/auth/session";
import { hasInstitutionRole } from "@/lib/auth/rbac";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formDataString, parseServerActionForm } from "@/lib/http/server-action-validation";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | undefined>>;
};

const questionIdFormSchema = z.object({
  questionId: z.string().trim().min(1).max(128)
});

const examQuestionIdFormSchema = z.object({
  examQuestionId: z.string().trim().min(1).max(128)
});

const randomSelectFormSchema = z.object({
  subjectId: z.string().trim().max(128),
  type: z.union([z.literal(""), z.enum(["mcq_single", "mcq_multi", "true_false", "short_answer"])]),
  q: z.string().trim().max(500),
  easyCount: z.coerce.number().int().min(0).max(500),
  mediumCount: z.coerce.number().int().min(0).max(500),
  hardCount: z.coerce.number().int().min(0).max(500)
});

function toRoute(examId: string, params: Record<string, string | undefined>) {
  const s = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v && s.set(k, v));
  const q = s.toString();
  return q ? `/admin/exams/${examId}/questions?${q}` : `/admin/exams/${examId}/questions`;
}

async function ensureDefaultSection(examId: string, institutionId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("exam_sections")
    .select("id")
    .eq("exam_id", examId)
    .eq("institution_id", institutionId)
    .order("display_order", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing?.id) return existing.id;

  const { data: inserted, error } = await supabase
    .from("exam_sections")
    .insert({
      exam_id: examId,
      institution_id: institutionId,
      title: "Main Section",
      question_count: 1,
      selection_mode: "manual",
      difficulty_distribution: {}
    })
    .select("id")
    .single();
  if (error || !inserted) throw new Error("Unable to create default exam section");
  return inserted.id;
}

export default async function ExamQuestionSelectionPage({ params, searchParams }: PageProps) {
  const { id: examId } = await params;
  const sp = (await searchParams) ?? {};
  const auth = await getSessionAuthState();
  if (!auth.user) redirect(`/login?next=/admin/exams/${examId}/questions`);

  const membership = auth.memberships.find((m) => ["owner", "admin", "editor"].includes(m.role)) ?? null;
  const canManage =
    Boolean(auth.context && hasInstitutionRole(auth.context, ["owner", "admin", "editor"])) || Boolean(membership);
  if (!membership || !canManage) return <main className="mx-auto max-w-4xl px-6 py-10 text-sm">Insufficient permissions.</main>;

  const supabase = await createSupabaseServerClient();
  const institutionId = membership.institutionId;

  const [examRes, subjectsRes, questionsRes, selectedRes] = await Promise.all([
    supabase
      .from("exams")
      .select("id,title,status,duration_minutes")
      .eq("id", examId)
      .eq("institution_id", institutionId)
      .is("deleted_at", null)
      .single(),
    supabase.from("subjects").select("id,name,code").eq("institution_id", institutionId).is("deleted_at", null).order("name"),
    supabase
      .from("questions")
      .select("id,subject_id,question_type,prompt,difficulty,is_active,deleted_at,tags")
      .eq("institution_id", institutionId)
      .is("deleted_at", null)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("exam_questions")
      .select("id,question_id,display_order,points,required")
      .eq("exam_id", examId)
      .eq("institution_id", institutionId)
      .order("display_order", { ascending: true })
  ]);

  if (!examRes.data) return <main className="mx-auto max-w-4xl px-6 py-10 text-sm">Exam not found.</main>;

  const qSearch = (sp.q ?? "").toLowerCase();
  const typeFilter = sp.type ?? "";
  const diffFilter = sp.difficulty ?? "";
  const subjectFilter = sp.subject ?? "";

  const selectedIds = new Set((selectedRes.data ?? []).map((r) => r.question_id));
  const subjectMap = new Map((subjectsRes.data ?? []).map((s) => [s.id, s]));
  const pool = (questionsRes.data ?? []).filter((q) => {
    if (qSearch && !`${q.prompt} ${(q.tags ?? []).join(" ")}`.toLowerCase().includes(qSearch)) return false;
    if (typeFilter && q.question_type !== typeFilter) return false;
    if (diffFilter && q.difficulty !== diffFilter) return false;
    if (subjectFilter && q.subject_id !== subjectFilter) return false;
    return true;
  });

  async function addQuestion(formData: FormData) {
    "use server";
    const auth = await getSessionAuthState();
    const membership = auth.memberships.find((m) => ["owner", "admin", "editor"].includes(m.role)) ?? null;
    if (!auth.user || !membership) redirect(toRoute(examId, { error: "forbidden" }));
    const parsedForm = parseServerActionForm(questionIdFormSchema, {
      questionId: formDataString(formData, "questionId")
    });
    if (!parsedForm.ok) redirect(toRoute(examId, { error: "missing_question_id" }));
    const { questionId } = parsedForm.data;
    const supabase = await createSupabaseServerClient();
    const sectionId = await ensureDefaultSection(examId, membership.institutionId);
    const { count } = await supabase
      .from("exam_questions")
      .select("*", { count: "exact", head: true })
      .eq("exam_id", examId)
      .eq("institution_id", membership.institutionId);
    const nextOrder = count ?? 0;
    const { error } = await supabase.from("exam_questions").insert({
      exam_id: examId,
      institution_id: membership.institutionId,
      section_id: sectionId,
      question_id: questionId,
      display_order: nextOrder,
      points: 1,
      required: true
    });
    if (error) redirect(toRoute(examId, { error: String(error.message).toLowerCase().includes("unique") ? "duplicate" : "add_failed" }));
    await supabase.from("exam_sections").update({ question_count: (nextOrder + 1), selection_mode: "manual" }).eq("id", sectionId);
    redirect(toRoute(examId, { status: "added" }));
  }

  async function removeQuestion(formData: FormData) {
    "use server";
    const auth = await getSessionAuthState();
    const membership = auth.memberships.find((m) => ["owner", "admin", "editor"].includes(m.role)) ?? null;
    if (!auth.user || !membership) redirect(toRoute(examId, { error: "forbidden" }));
    const parsedForm = parseServerActionForm(examQuestionIdFormSchema, {
      examQuestionId: formDataString(formData, "examQuestionId")
    });
    if (!parsedForm.ok) redirect(toRoute(examId, { error: "missing_exam_question_id" }));
    const { examQuestionId } = parsedForm.data;
    const supabase = await createSupabaseServerClient();
    const { data: row } = await supabase
      .from("exam_questions")
      .select("section_id")
      .eq("id", examQuestionId)
      .eq("exam_id", examId)
      .eq("institution_id", membership.institutionId)
      .single();
    const { error } = await supabase
      .from("exam_questions")
      .delete()
      .eq("id", examQuestionId)
      .eq("exam_id", examId)
      .eq("institution_id", membership.institutionId);
    if (error) redirect(toRoute(examId, { error: "remove_failed" }));
    if (row?.section_id) {
      const { count } = await supabase
        .from("exam_questions")
        .select("*", { count: "exact", head: true })
        .eq("exam_id", examId)
        .eq("institution_id", membership.institutionId)
        .eq("section_id", row.section_id);
      await supabase.from("exam_sections").update({ question_count: count ?? 0, selection_mode: "manual" }).eq("id", row.section_id);
    }
    redirect(toRoute(examId, { status: "removed" }));
  }

  async function randomSelect(formData: FormData) {
    "use server";
    const auth = await getSessionAuthState();
    const membership = auth.memberships.find((m) => ["owner", "admin", "editor"].includes(m.role)) ?? null;
    if (!auth.user || !membership) redirect(toRoute(examId, { error: "forbidden" }));
    const parsedForm = parseServerActionForm(randomSelectFormSchema, {
      subjectId: formDataString(formData, "subjectId"),
      type: formDataString(formData, "type"),
      q: formDataString(formData, "q"),
      easyCount: formDataString(formData, "easyCount") || "0",
      mediumCount: formDataString(formData, "mediumCount") || "0",
      hardCount: formDataString(formData, "hardCount") || "0"
    });
    if (!parsedForm.ok) redirect(toRoute(examId, { error: "invalid_random_request" }));
    const { subjectId, type: qType, q, easyCount, mediumCount, hardCount } = parsedForm.data;
    const search = q.toLowerCase();
    const totalRequested = easyCount + mediumCount + hardCount;
    if (!Number.isFinite(totalRequested) || totalRequested <= 0) redirect(toRoute(examId, { error: "invalid_random_request" }));

    const supabase = await createSupabaseServerClient();
    const [poolRes, selectedRes] = await Promise.all([
      supabase
        .from("questions")
        .select("id,subject_id,question_type,prompt,difficulty")
        .eq("institution_id", membership.institutionId)
        .is("deleted_at", null)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1000),
      supabase
        .from("exam_questions")
        .select("question_id")
        .eq("exam_id", examId)
        .eq("institution_id", membership.institutionId)
    ]);
    const existing = new Set((selectedRes.data ?? []).map((r) => r.question_id));
    let candidates = (poolRes.data ?? []).filter((q) => !existing.has(q.id));
    if (subjectId) candidates = candidates.filter((q) => q.subject_id === subjectId);
    if (qType) candidates = candidates.filter((q) => q.question_type === qType);
    if (search) candidates = candidates.filter((q) => q.prompt.toLowerCase().includes(search));

    const byDifficulty = {
      easy: candidates.filter((q) => q.difficulty === "easy"),
      medium: candidates.filter((q) => q.difficulty === "medium"),
      hard: candidates.filter((q) => q.difficulty === "hard")
    };

    function pick<T>(arr: T[], count: number) {
      const copy = [...arr];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy.slice(0, count);
    }

    const chosen = [
      ...pick(byDifficulty.easy, easyCount),
      ...pick(byDifficulty.medium, mediumCount),
      ...pick(byDifficulty.hard, hardCount)
    ];
    if (chosen.length === 0) redirect(toRoute(examId, { error: "no_candidates" }));

    const uniqueChosen = [...new Map(chosen.map((q) => [q.id, q])).values()];
    if (uniqueChosen.length < totalRequested) {
      // Still proceed with what is available but signal partial fill.
    }

    const sectionId = await ensureDefaultSection(examId, membership.institutionId);
    const { count } = await supabase
      .from("exam_questions")
      .select("*", { count: "exact", head: true })
      .eq("exam_id", examId)
      .eq("institution_id", membership.institutionId);
    const startOrder = count ?? 0;

    const inserts = uniqueChosen.map((q, idx) => ({
      exam_id: examId,
      institution_id: membership.institutionId,
      section_id: sectionId,
      question_id: q.id,
      display_order: startOrder + idx,
      points: 1,
      required: true
    }));

    const { error } = await supabase.from("exam_questions").insert(inserts);
    if (error) redirect(toRoute(examId, { error: "random_insert_failed" }));

    await supabase
      .from("exam_sections")
      .update({
        question_count: startOrder + inserts.length,
        selection_mode: "random",
        difficulty_distribution: { easy: easyCount, medium: mediumCount, hard: hardCount }
      })
      .eq("id", sectionId);

    redirect(toRoute(examId, { status: uniqueChosen.length < totalRequested ? "random_partial" : "random_added" }));
  }

  const selectedQuestionIds = (selectedRes.data ?? []).map((r) => r.question_id);
  const selectedQuestions = (questionsRes.data ?? [])
    .filter((q) => selectedQuestionIds.includes(q.id))
    .sort((a, b) => selectedQuestionIds.indexOf(a.id) - selectedQuestionIds.indexOf(b.id));
  const selectedMap = new Map((selectedRes.data ?? []).map((r) => [r.question_id, r]));

  const errorCopy: Record<string, string> = {
    forbidden: "You do not have permission to configure exam questions.",
    missing_question_id: "Question ID is missing.",
    missing_exam_question_id: "Exam question entry is missing.",
    duplicate: "That question is already in the exam.",
    add_failed: "Failed to add question to exam.",
    remove_failed: "Failed to remove question from exam.",
    invalid_random_request: "Enter one or more difficulty counts for random selection.",
    no_candidates: "No candidate questions matched the current filters for random selection.",
    random_insert_failed: "Failed to insert randomly selected questions."
  };

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Question Selection</p>
            <h1 className="mt-3 text-2xl font-semibold text-slate-900">{examRes.data.title}</h1>
            <p className="mt-2 text-sm text-slate-600">
              Phase 4.2 picker UI with search/filter, difficulty distribution, random selection, and manual overrides.
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/admin/exams" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Back to exams</Link>
          </div>
        </div>

        {sp.error ? <Banner tone="error" text={errorCopy[sp.error] ?? "Question selection action failed."} /> : null}
        {sp.status ? <Banner tone="success" text={
          sp.status === "added" ? "Question added." :
          sp.status === "removed" ? "Question removed." :
          sp.status === "random_added" ? "Random questions added." :
          sp.status === "random_partial" ? "Random selection added some questions (insufficient matches for full request)." :
          `Status: ${sp.status}`
        } /> : null}

        <div className="mt-8 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
            <h2 className="text-lg font-semibold text-slate-900">Question picker</h2>
            <form method="get" className="mt-4 grid gap-3">
              <input name="q" defaultValue={sp.q ?? ""} placeholder="Search prompt" className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm" />
              <div className="grid gap-3 sm:grid-cols-3">
                <select name="subject" defaultValue={sp.subject ?? ""} className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm">
                  <option value="">All subjects</option>
                  {(subjectsRes.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <select name="type" defaultValue={sp.type ?? ""} className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm">
                  <option value="">All types</option>
                  <option value="mcq_single">mcq_single</option>
                  <option value="mcq_multi">mcq_multi</option>
                  <option value="true_false">true_false</option>
                  <option value="short_answer">short_answer</option>
                </select>
                <select name="difficulty" defaultValue={sp.difficulty ?? ""} className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm">
                  <option value="">All difficulty</option>
                  <option value="easy">easy</option>
                  <option value="medium">medium</option>
                  <option value="hard">hard</option>
                </select>
              </div>
              <button className="justify-self-start rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50">Apply filters</button>
            </form>

            <form action={randomSelect} className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-semibold text-slate-900">Random selection</h3>
              <input type="hidden" name="q" value={sp.q ?? ""} />
              <input type="hidden" name="subjectId" value={sp.subject ?? ""} />
              <input type="hidden" name="type" value={sp.type ?? ""} />
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <NumField name="easyCount" label="Easy" defaultValue={0} />
                <NumField name="mediumCount" label="Medium" defaultValue={0} />
                <NumField name="hardCount" label="Hard" defaultValue={0} />
              </div>
              <button className="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
                Add random questions
              </button>
            </form>

            <div className="mt-6 space-y-3">
              {pool.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">No questions match filters.</div>
              ) : (
                pool.slice(0, 100).map((q) => {
                  const alreadySelected = selectedIds.has(q.id);
                  return (
                    <div key={q.id} className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-slate-900">{q.prompt}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {subjectMap.get(q.subject_id)?.name ?? q.subject_id} | {q.question_type} | {q.difficulty}
                          </p>
                        </div>
                        {alreadySelected ? (
                          <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">Selected</span>
                        ) : (
                          <form action={addQuestion}>
                            <input type="hidden" name="questionId" value={q.id} />
                            <button className="rounded-lg border border-blue-300 bg-white px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50">Add</button>
                          </form>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900">Selected questions</h2>
              <p className="text-sm text-slate-500">{selectedQuestions.length} selected</p>
            </div>
            <div className="mt-4 space-y-3">
              {selectedQuestions.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                  No questions selected yet. Use manual add or random selection.
                </div>
              ) : (
                selectedQuestions.map((q, idx) => {
                  const eq = selectedMap.get(q.id);
                  return (
                    <div key={q.id} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-slate-900">{idx + 1}. {q.prompt}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {subjectMap.get(q.subject_id)?.name ?? q.subject_id} | {q.question_type} | {q.difficulty}
                          </p>
                        </div>
                        {eq ? (
                          <form action={removeQuestion}>
                            <input type="hidden" name="examQuestionId" value={eq.id} />
                            <button className="rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50">Remove</button>
                          </form>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

function NumField({ name, label, defaultValue }: { name: string; label: string; defaultValue: number }) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-slate-700">{label}</label>
      <input name={name} type="number" min={0} defaultValue={defaultValue} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm" />
    </div>
  );
}

function Banner({ tone, text }: { tone: "error" | "success"; text: string }) {
  const cls = tone === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-900";
  return <div className={`mt-5 rounded-xl border px-4 py-3 text-sm ${cls}`}>{text}</div>;
}
