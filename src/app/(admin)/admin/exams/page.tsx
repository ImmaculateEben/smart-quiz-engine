import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSessionAuthState } from "@/lib/auth/session";
import { hasInstitutionRole } from "@/lib/auth/rbac";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assertUsageAllowed, incrementUsageCounter } from "@/lib/usage/limits";
import { logAuditEvent } from "@/lib/audit/log";
import { formDataString, parseServerActionForm, zFormBooleanString } from "@/lib/http/server-action-validation";

type ExamsPageProps = {
  searchParams?: Promise<{
    status?: string;
    error?: string;
  }>;
};

function pageRedirect(params: Record<string, string | undefined>) {
  const s = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v && s.set(k, v));
  const q = s.toString();
  return q ? `/admin/exams?${q}` : "/admin/exams";
}

function parseSettingsObject(raw: string) {
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Settings must be JSON object");
  }
  return parsed as Record<string, unknown>;
}

const examIdFormSchema = z.object({
  examId: z.string().trim().min(1).max(128)
});

const examMutableFormSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5_000),
  durationMinutes: z.coerce.number().int().min(1).max(2_880),
  passingScoreRaw: z
    .string()
    .trim()
    .max(20)
    .refine((value) => !value || Number.isFinite(Number(value)), { message: "Invalid passing score number" })
    .refine((value) => !value || (Number(value) >= 0 && Number(value) <= 100), {
      message: "Passing score out of range"
    }),
  shuffleQuestions: zFormBooleanString,
  shuffleOptions: zFormBooleanString,
  showResultImmediately: zFormBooleanString,
  allowReview: zFormBooleanString,
  maxAttempts: z.coerce.number().int().min(1).max(100),
  settingsJson: z.string().max(20_000)
});

const updateExamFormSchema = examMutableFormSchema.extend({
  examId: z.string().trim().min(1).max(128)
});

export default async function ExamsPage({ searchParams }: ExamsPageProps) {
  const params = (await searchParams) ?? {};
  const auth = await getSessionAuthState();
  if (!auth.user) redirect("/login?next=/admin/exams");

  const membership = auth.memberships.find((m) => ["owner", "admin", "editor"].includes(m.role)) ?? null;
  const canManage =
    Boolean(auth.context && hasInstitutionRole(auth.context, ["owner", "admin", "editor"])) || Boolean(membership);
  if (!membership || !canManage) {
    return <main className="mx-auto max-w-4xl px-6 py-10 text-sm">Insufficient permissions.</main>;
  }

  const supabase = await createSupabaseServerClient();
  const includeDeleted = params.error === "show_deleted" || (params as Record<string, string | undefined>).includeDeleted === "1";
  const { data: exams } = await supabase
    .from("exams")
    .select("id,title,description,status,duration_minutes,passing_score,shuffle_questions,shuffle_options,show_result_immediately,allow_review,max_attempts,settings,deleted_at,created_at,updated_at")
    .eq("institution_id", membership.institutionId)
    .order("updated_at", { ascending: false })
    .limit(100);
  const visibleExams = (exams ?? []).filter((e) => includeDeleted || !e.deleted_at);

  async function createExam(formData: FormData) {
    "use server";
    const auth = await getSessionAuthState();
    const membership = auth.memberships.find((m) => ["owner", "admin", "editor"].includes(m.role)) ?? null;
    const canManage =
      Boolean(auth.context && hasInstitutionRole(auth.context, ["owner", "admin", "editor"])) || Boolean(membership);
    if (!auth.user || !membership || !canManage) redirect(pageRedirect({ error: "forbidden" }));

    const raw = {
      title: formDataString(formData, "title"),
      description: formDataString(formData, "description"),
      durationMinutes: formDataString(formData, "durationMinutes") || "0",
      passingScoreRaw: formDataString(formData, "passingScore"),
      shuffleQuestions: formDataString(formData, "shuffleQuestions") || "true",
      shuffleOptions: formDataString(formData, "shuffleOptions") || "false",
      showResultImmediately: formDataString(formData, "showResultImmediately") || "true",
      allowReview: formDataString(formData, "allowReview") || "true",
      maxAttempts: formDataString(formData, "maxAttempts") || "1",
      settingsJson: formDataString(formData, "settingsJson") || "{}"
    };

    const parsedForm = parseServerActionForm(examMutableFormSchema, raw);
    if (!parsedForm.ok) {
      const fields = parsedForm.error.flatten().fieldErrors;
      if (fields.passingScoreRaw?.length) redirect(pageRedirect({ error: "invalid_passing_score" }));
      redirect(pageRedirect({ error: "invalid_input" }));
    }

    const {
      title,
      description,
      durationMinutes,
      passingScoreRaw,
      shuffleQuestions,
      shuffleOptions,
      showResultImmediately,
      allowReview,
      maxAttempts,
      settingsJson: settingsRaw
    } = parsedForm.data;
    const passingScore = passingScoreRaw ? Number(passingScoreRaw) : null;

    let settings: Record<string, unknown> = {};
    try {
      settings = parseSettingsObject(settingsRaw);
    } catch {
      redirect(pageRedirect({ error: "invalid_settings_json" }));
    }

    try {
      await assertUsageAllowed({ institutionId: membership.institutionId, target: "exams", requested: 1 });
    } catch {
      redirect(pageRedirect({ error: "exam_limit_reached" }));
    }

    const supabase = await createSupabaseServerClient();
    const { data: inserted, error } = await supabase
      .from("exams")
      .insert({
        institution_id: membership.institutionId,
        title,
        description: description || null,
        status: "draft",
        duration_minutes: durationMinutes,
        passing_score: passingScore,
        shuffle_questions: shuffleQuestions,
        shuffle_options: shuffleOptions,
        show_result_immediately: showResultImmediately,
        allow_review: allowReview,
        max_attempts: maxAttempts,
        settings,
        created_by: auth.user.id
      })
      .select("id")
      .single();

    if (error || !inserted) redirect(pageRedirect({ error: "create_failed" }));

    try {
      await incrementUsageCounter({ institutionId: membership.institutionId, metricKey: "exams_total", incrementBy: 1 });
    } catch {}
    try {
      await logAuditEvent({ institutionId: membership.institutionId, action: "exam.create", entityType: "exams", entityId: inserted.id });
    } catch {}

    redirect(pageRedirect({ status: "created" }));
  }

  async function updateExam(formData: FormData) {
    "use server";
    const auth = await getSessionAuthState();
    const membership = auth.memberships.find((m) => ["owner", "admin", "editor"].includes(m.role)) ?? null;
    const canManage =
      Boolean(auth.context && hasInstitutionRole(auth.context, ["owner", "admin", "editor"])) || Boolean(membership);
    if (!auth.user || !membership || !canManage) redirect(pageRedirect({ error: "forbidden" }));

    const raw = {
      examId: formDataString(formData, "examId"),
      title: formDataString(formData, "title"),
      description: formDataString(formData, "description"),
      durationMinutes: formDataString(formData, "durationMinutes") || "0",
      passingScoreRaw: formDataString(formData, "passingScore"),
      shuffleQuestions: formDataString(formData, "shuffleQuestions") || "true",
      shuffleOptions: formDataString(formData, "shuffleOptions") || "false",
      showResultImmediately: formDataString(formData, "showResultImmediately") || "true",
      allowReview: formDataString(formData, "allowReview") || "true",
      maxAttempts: formDataString(formData, "maxAttempts") || "1",
      settingsJson: formDataString(formData, "settingsJson") || "{}"
    };

    if (!raw.examId) redirect(pageRedirect({ error: "missing_exam_id" }));

    const parsedForm = parseServerActionForm(updateExamFormSchema, raw);
    if (!parsedForm.ok) {
      const fields = parsedForm.error.flatten().fieldErrors;
      if (fields.passingScoreRaw?.length) redirect(pageRedirect({ error: "invalid_passing_score" }));
      redirect(pageRedirect({ error: "invalid_input" }));
    }

    const {
      examId,
      title,
      description,
      durationMinutes,
      passingScoreRaw,
      shuffleQuestions,
      shuffleOptions,
      showResultImmediately,
      allowReview,
      maxAttempts,
      settingsJson: settingsRaw
    } = parsedForm.data;
    const passingScore = passingScoreRaw ? Number(passingScoreRaw) : null;

    let settings: Record<string, unknown> = {};
    try {
      settings = parseSettingsObject(settingsRaw);
    } catch {
      redirect(pageRedirect({ error: "invalid_settings_json" }));
    }

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("exams")
      .update({
        title,
        description: description || null,
        duration_minutes: durationMinutes,
        passing_score: passingScore,
        shuffle_questions: shuffleQuestions,
        shuffle_options: shuffleOptions,
        show_result_immediately: showResultImmediately,
        allow_review: allowReview,
        max_attempts: maxAttempts,
        settings
      })
      .eq("id", examId)
      .eq("institution_id", membership.institutionId)
      .is("deleted_at", null);

    if (error) redirect(pageRedirect({ error: "update_failed" }));
    redirect(pageRedirect({ status: "updated" }));
  }

  async function softDeleteExam(formData: FormData) {
    "use server";
    const auth = await getSessionAuthState();
    const membership = auth.memberships.find((m) => ["owner", "admin", "editor"].includes(m.role)) ?? null;
    if (!auth.user || !membership) redirect(pageRedirect({ error: "forbidden" }));
    const raw = { examId: formDataString(formData, "examId") };
    if (!raw.examId) redirect(pageRedirect({ error: "missing_exam_id" }));
    const parsedForm = parseServerActionForm(examIdFormSchema, raw);
    if (!parsedForm.ok) redirect(pageRedirect({ error: "invalid_input" }));
    const { examId } = parsedForm.data;
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("exams")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", examId)
      .eq("institution_id", membership.institutionId)
      .is("deleted_at", null);
    if (error) redirect(pageRedirect({ error: "delete_failed" }));
    redirect(pageRedirect({ status: "deleted" }));
  }

  async function restoreExam(formData: FormData) {
    "use server";
    const auth = await getSessionAuthState();
    const membership = auth.memberships.find((m) => ["owner", "admin", "editor"].includes(m.role)) ?? null;
    if (!auth.user || !membership) redirect(pageRedirect({ error: "forbidden" }));
    const raw = { examId: formDataString(formData, "examId") };
    if (!raw.examId) redirect(pageRedirect({ error: "missing_exam_id" }));
    const parsedForm = parseServerActionForm(examIdFormSchema, raw);
    if (!parsedForm.ok) redirect(pageRedirect({ error: "invalid_input" }));
    const { examId } = parsedForm.data;
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("exams")
      .update({ deleted_at: null })
      .eq("id", examId)
      .eq("institution_id", membership.institutionId);
    if (error) redirect(pageRedirect({ error: "restore_failed" }));
    redirect(pageRedirect({ status: "restored" }));
  }

  const errorCopy: Record<string, string> = {
    forbidden: "You do not have permission to manage exams.",
    invalid_input: "Required exam fields are missing or invalid.",
    invalid_passing_score: "Passing score must be between 0 and 100.",
    invalid_settings_json: "Settings JSON must be a valid object.",
    exam_limit_reached: "Exam limit reached for the current plan.",
    create_failed: "Failed to create exam.",
    update_failed: "Failed to update exam.",
    missing_exam_id: "Exam ID is missing.",
    delete_failed: "Failed to soft delete exam.",
    restore_failed: "Failed to restore exam."
  };

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Exam Builder</p>
            <h1 className="mt-3 text-2xl font-semibold text-slate-900">Exam Configuration (Phase 4.1)</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Draft exam form builder for configuration settings: duration, passing score, shuffle options, result visibility, and attempt settings.
            </p>
          </div>
          <Link href="/admin" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Dashboard
          </Link>
        </div>

        {params.error ? <Notice tone="error" text={errorCopy[params.error] ?? "Exam action failed."} /> : null}
        {params.status ? <Notice tone="success" text={`Exam ${params.status}.`} /> : null}

        <section className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="text-lg font-semibold text-slate-900">Create exam (draft)</h2>
          <ExamForm action={createExam} submitLabel="Create draft exam" />
        </section>

        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">Drafts and configured exams</h2>
            <div className="flex items-center gap-3 text-sm text-slate-500">
              <p>{visibleExams.length} shown / {(exams ?? []).length} total</p>
              <Link href={`/admin/exams${includeDeleted ? "" : "?includeDeleted=1"}`} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
                {includeDeleted ? "Hide deleted" : "Show deleted"}
              </Link>
            </div>
          </div>
          <div className="mt-4 space-y-4">
            {visibleExams.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                No exams configured yet.
              </div>
            ) : (
              visibleExams.map((exam) => (
                <details key={exam.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <summary className="cursor-pointer list-none">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-slate-900">{exam.title}</p>
                          <span className="rounded-md bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">{exam.status}</span>
                          {exam.deleted_at ? <span className="rounded-md bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">deleted</span> : null}
                          <Link href={`/admin/exams/${exam.id}/questions`} className="rounded-md border border-blue-300 bg-white px-2 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-50">
                            Question selection
                          </Link>
                          <Link href={`/admin/exams/${exam.id}/preview`} className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                            Preview
                          </Link>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {exam.duration_minutes} mins | pass {exam.passing_score ?? "n/a"}% | max attempts {exam.max_attempts}
                        </p>
                      </div>
                      <div className="text-xs text-slate-500">Updated {new Date(exam.updated_at).toLocaleString()}</div>
                    </div>
                  </summary>

                    <div className="mt-5 space-y-4">
                      <div className="flex flex-wrap items-center gap-2">
                        {exam.deleted_at ? (
                          <form action={restoreExam}>
                            <input type="hidden" name="examId" value={exam.id} />
                            <button className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">Restore</button>
                          </form>
                        ) : (
                          <form action={softDeleteExam}>
                            <input type="hidden" name="examId" value={exam.id} />
                            <button className="rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50">Soft delete</button>
                          </form>
                        )}
                      </div>
                      {!exam.deleted_at ? (
                        <div className="rounded-xl border border-slate-200 bg-white p-4">
                          <ExamForm
                            action={updateExam}
                            submitLabel="Save configuration"
                            existing={{
                              id: exam.id,
                              title: exam.title,
                              description: exam.description ?? "",
                              durationMinutes: exam.duration_minutes,
                              passingScore: exam.passing_score == null ? "" : String(exam.passing_score),
                              shuffleQuestions: exam.shuffle_questions,
                              shuffleOptions: exam.shuffle_options,
                              showResultImmediately: exam.show_result_immediately,
                              allowReview: exam.allow_review,
                              maxAttempts: exam.max_attempts,
                              settingsJson: JSON.stringify(exam.settings ?? {}, null, 2)
                            }}
                          />
                        </div>
                      ) : null}
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

function ExamForm({
  action,
  submitLabel,
  existing
}: {
  action: (formData: FormData) => Promise<void>;
  submitLabel: string;
  existing?: {
    id: string;
    title: string;
    description: string;
    durationMinutes: number;
    passingScore: string;
    shuffleQuestions: boolean;
    shuffleOptions: boolean;
    showResultImmediately: boolean;
    allowReview: boolean;
    maxAttempts: number;
    settingsJson: string;
  };
}) {
  return (
    <form action={action} className="mt-4 grid gap-4">
      {existing ? <input type="hidden" name="examId" value={existing.id} /> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Field label="Title">
          <input name="title" required defaultValue={existing?.title ?? ""} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm" />
        </Field>
        <Field label="Duration (minutes)">
          <input name="durationMinutes" type="number" min={1} required defaultValue={existing?.durationMinutes ?? 60} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm" />
        </Field>
      </div>

      <Field label="Description (optional)">
        <textarea name="description" rows={2} defaultValue={existing?.description ?? ""} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm" />
      </Field>

      <div className="grid gap-4 lg:grid-cols-3">
        <Field label="Passing score % (optional)">
          <input name="passingScore" type="number" min={0} max={100} step="0.01" defaultValue={existing?.passingScore ?? ""} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm" />
        </Field>
        <Field label="Max attempts">
          <input name="maxAttempts" type="number" min={1} required defaultValue={existing?.maxAttempts ?? 1} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm" />
        </Field>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <BoolSelect name="shuffleQuestions" label="Shuffle questions" value={existing?.shuffleQuestions ?? true} />
        <BoolSelect name="shuffleOptions" label="Shuffle options" value={existing?.shuffleOptions ?? false} />
        <BoolSelect name="showResultImmediately" label="Show result immediately" value={existing?.showResultImmediately ?? true} />
        <BoolSelect name="allowReview" label="Allow review" value={existing?.allowReview ?? true} />
      </div>

      <Field label="Settings JSON">
        <textarea name="settingsJson" rows={5} defaultValue={existing?.settingsJson ?? "{}"} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-mono text-xs" />
      </Field>

      <button className="justify-self-start rounded-xl border border-blue-300 bg-white px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50">
        {submitLabel}
      </button>
    </form>
  );
}

function BoolSelect({ name, label, value }: { name: string; label: string; value: boolean }) {
  return (
    <Field label={label}>
      <select name={name} defaultValue={value ? "true" : "false"} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm">
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    </Field>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-slate-700">{label}</label>
      {children}
    </div>
  );
}

function Notice({ tone, text }: { tone: "error" | "success"; text: string }) {
  const cls = tone === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-900";
  return <div className={`mt-5 rounded-xl border px-4 py-3 text-sm ${cls}`}>{text}</div>;
}
