import type { Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSessionAuthState } from "@/lib/auth/session";
import { hasInstitutionRole } from "@/lib/auth/rbac";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assertUsageAllowed, incrementUsageCounter } from "@/lib/usage/limits";
import { logAuditEvent } from "@/lib/audit/log";
import { buildQuestionContentHash, findDuplicateQuestionByHash } from "@/lib/questions/content-hash";
import { formDataString, parseServerActionForm, zFormBooleanString } from "@/lib/http/server-action-validation";

const QTYPES = ["mcq_single", "mcq_multi", "true_false", "short_answer"] as const;
const DIFFS = ["easy", "medium", "hard"] as const;
type QType = (typeof QTYPES)[number];
type Difficulty = (typeof DIFFS)[number];

function qsRedirect(params: Record<string, string | undefined>): Route {
  const s = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v && s.set(k, v));
  const q = s.toString();
  return (q ? `/admin/questions?${q}` : "/admin/questions") as Route;
}

function parseObject(raw: string) {
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid object");
  return parsed as Record<string, unknown>;
}

const questionIdFormSchema = z.object({
  questionId: z.string().trim().min(1).max(128)
});

const createQuestionFormSchema = z.object({
  subjectId: z.string().trim().min(1).max(128),
  questionType: z.enum(QTYPES),
  prompt: z.string().trim().min(1).max(10_000),
  difficulty: z.enum(DIFFS),
  optionsJson: z.string().max(200_000),
  correctAnswerJson: z.string().max(200_000),
  shortAnswerRulesJson: z.string().max(200_000),
  tagsCsv: z.string().max(4_000),
  source: z.string().trim().max(500),
  isActive: zFormBooleanString
});

export default async function QuestionsPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const auth = await getSessionAuthState();
  if (!auth.user) redirect("/login?next=/admin/questions");

  const membership = auth.memberships.find((m) => ["owner", "admin", "editor"].includes(m.role)) ?? null;
  const canManage =
    Boolean(auth.context && hasInstitutionRole(auth.context, ["owner", "admin", "editor"])) || Boolean(membership);
  if (!membership || !canManage) {
    return <main className="mx-auto max-w-4xl px-6 py-10 text-sm">Insufficient permissions.</main>;
  }

  const institutionId = membership.institutionId;
  const supabase = await createSupabaseServerClient();
  const includeDeleted = params.includeDeleted === "1";
  const q = (params.q ?? "").toLowerCase();
  const typeFilter = QTYPES.includes(params.type as QType) ? (params.type as QType) : "";
  const difficultyFilter = DIFFS.includes(params.difficulty as Difficulty) ? (params.difficulty as Difficulty) : "";
  const subjectFilter = params.subject ?? "";

  const [{ data: subjects }, { data: rows }] = await Promise.all([
    supabase.from("subjects").select("id,name,code,deleted_at").eq("institution_id", institutionId).order("name"),
    supabase
      .from("questions")
      .select("id,subject_id,question_type,prompt,options,correct_answer,short_answer_rules,difficulty,tags,source,is_active,deleted_at,created_at")
      .eq("institution_id", institutionId)
      .order("created_at", { ascending: false })
      .limit(200)
  ]);

  const subjectMap = new Map((subjects ?? []).map((s) => [s.id, s]));
  const filtered = (rows ?? []).filter((r) => {
    if (!includeDeleted && r.deleted_at) return false;
    if (typeFilter && r.question_type !== typeFilter) return false;
    if (difficultyFilter && r.difficulty !== difficultyFilter) return false;
    if (subjectFilter && r.subject_id !== subjectFilter) return false;
    if (q && !`${r.prompt} ${(r.tags ?? []).join(" ")} ${r.source ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });

  async function createQuestion(formData: FormData) {
    "use server";
    const auth = await getSessionAuthState();
    const membership = auth.memberships.find((m) => ["owner", "admin", "editor"].includes(m.role)) ?? null;
    const canManage =
      Boolean(auth.context && hasInstitutionRole(auth.context, ["owner", "admin", "editor"])) || Boolean(membership);
    if (!auth.user || !membership || !canManage) redirect(qsRedirect({ error: "forbidden" }));

    const raw = {
      subjectId: formDataString(formData, "subjectId"),
      questionType: formDataString(formData, "questionType"),
      prompt: formDataString(formData, "prompt"),
      difficulty: formDataString(formData, "difficulty") || "medium",
      optionsJson: formDataString(formData, "optionsJson") || "[]",
      correctAnswerJson: formDataString(formData, "correctAnswerJson"),
      shortAnswerRulesJson: formDataString(formData, "shortAnswerRulesJson") || "{}",
      tagsCsv: formDataString(formData, "tagsCsv"),
      source: formDataString(formData, "source"),
      isActive: formDataString(formData, "isActive") || "true"
    };

    const parsedForm = parseServerActionForm(createQuestionFormSchema, raw);
    if (!parsedForm.ok) redirect(qsRedirect({ error: "invalid_input" }));

    const {
      subjectId,
      questionType,
      prompt,
      difficulty,
      optionsJson,
      correctAnswerJson,
      shortAnswerRulesJson,
      tagsCsv,
      source,
      isActive
    } = parsedForm.data;
    const tags = tagsCsv
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

    let options: unknown = null;
    let correctAnswer: unknown = null;
    let shortAnswerRules: unknown = null;
    try {
      options = questionType === "true_false" ? ["True", "False"] : questionType === "short_answer" ? null : JSON.parse(optionsJson);
      correctAnswer = JSON.parse(correctAnswerJson);
      shortAnswerRules = questionType === "short_answer" ? parseObject(shortAnswerRulesJson) : null;
    } catch {
      redirect(qsRedirect({ error: "invalid_payload" }));
    }

    try {
      await assertUsageAllowed({ institutionId: membership.institutionId, target: "questions", requested: 1 });
    } catch {
      redirect(qsRedirect({ error: "question_limit_reached" }));
    }

    const contentHash = buildQuestionContentHash({ subjectId, questionType, prompt, options, correctAnswer, shortAnswerRules });
    try {
      const duplicate = await findDuplicateQuestionByHash({ institutionId: membership.institutionId, contentHash });
      if (duplicate) redirect(qsRedirect({ error: "duplicate_question" }));
    } catch {
      // Fall back to DB unique constraint if duplicate precheck fails.
    }
    const { error } = await (await createSupabaseServerClient()).from("questions").insert({
      institution_id: membership.institutionId,
      subject_id: subjectId,
      question_type: questionType,
      prompt,
      options,
      correct_answer: correctAnswer,
      short_answer_rules: shortAnswerRules,
      difficulty,
      tags,
      source: source || null,
      content_hash: contentHash,
      stats: {},
      metadata: {},
      is_active: isActive,
      created_by: auth.user.id
    });
    if (error) {
      redirect(qsRedirect({ error: String(error.message).toLowerCase().includes("unique") ? "duplicate_question" : "create_failed" }));
    }

    try {
      await incrementUsageCounter({ institutionId: membership.institutionId, metricKey: "questions_total", incrementBy: 1 });
    } catch {}
    redirect(qsRedirect({ status: "created" }));
  }

  async function softDeleteQuestion(formData: FormData) {
    "use server";
    const auth = await getSessionAuthState();
    const membership = auth.memberships.find((m) => ["owner", "admin", "editor"].includes(m.role)) ?? null;
    if (!auth.user || !membership) redirect(qsRedirect({ error: "forbidden" }));
    const raw = { questionId: formDataString(formData, "questionId") };
    const parsedForm = parseServerActionForm(questionIdFormSchema, raw);
    if (!parsedForm.ok) redirect(qsRedirect({ error: "invalid_input" }));
    const { questionId: id } = parsedForm.data;
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("questions").update({ deleted_at: new Date().toISOString(), is_active: false }).eq("id", id).eq("institution_id", membership.institutionId);
    if (error) redirect(qsRedirect({ error: "delete_failed" }));
    try { await logAuditEvent({ institutionId: membership.institutionId, action: "question.delete", entityType: "questions", entityId: id }); } catch {}
    redirect(qsRedirect({ status: "deleted" }));
  }

  async function restoreQuestion(formData: FormData) {
    "use server";
    const auth = await getSessionAuthState();
    const membership = auth.memberships.find((m) => ["owner", "admin", "editor"].includes(m.role)) ?? null;
    if (!auth.user || !membership) redirect(qsRedirect({ error: "forbidden" }));
    const raw = { questionId: formDataString(formData, "questionId") };
    const parsedForm = parseServerActionForm(questionIdFormSchema, raw);
    if (!parsedForm.ok) redirect(qsRedirect({ error: "invalid_input" }));
    const { questionId: id } = parsedForm.data;
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("questions").update({ deleted_at: null }).eq("id", id).eq("institution_id", membership.institutionId);
    if (error) redirect(qsRedirect({ error: "restore_failed" }));
    try { await logAuditEvent({ institutionId: membership.institutionId, action: "question.restore", entityType: "questions", entityId: id }); } catch {}
    redirect(qsRedirect({ status: "restored" }));
  }

  const errorCopy: Record<string, string> = {
    forbidden: "You do not have permission to manage questions.",
    invalid_input: "Invalid or missing required input.",
    invalid_payload: "Options/correct-answer JSON does not match the selected question type.",
    question_limit_reached: "Question limit reached for this plan.",
    duplicate_question: "Duplicate question detected by content hash.",
    create_failed: "Failed to create question.",
    delete_failed: "Failed to soft delete question.",
    restore_failed: "Failed to restore question."
  };

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Question Bank</p>
            <h1 className="mt-3 text-2xl font-semibold text-slate-900">Questions (Phase 3.2)</h1>
            <p className="mt-2 text-sm text-slate-600">v1 type creation, filters/search, preview, and soft delete/restore.</p>
          </div>
          <Link href="/admin/subjects" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Subjects
          </Link>
          <Link href="/admin/questions/import" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            XML import
          </Link>
        </div>

        {params.error ? <Banner tone="error" text={errorCopy[params.error] ?? "Question action failed."} /> : null}
        {params.status ? <Banner tone="success" text={`Question ${params.status}.`} /> : null}

        <section className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="text-lg font-semibold text-slate-900">Create question</h2>
          <form action={createQuestion} className="mt-4 grid gap-4">
            <div className="grid gap-4 lg:grid-cols-3">
              <SelectField name="subjectId" label="Subject" options={(subjects ?? []).filter((s) => !s.deleted_at).map((s) => ({ value: s.id, label: s.name }))} required />
              <SelectField name="questionType" label="Type" options={QTYPES.map((v) => ({ value: v, label: v }))} defaultValue="mcq_single" />
              <SelectField name="difficulty" label="Difficulty" options={DIFFS.map((v) => ({ value: v, label: v }))} defaultValue="medium" />
            </div>
            <TextField name="prompt" label="Prompt" required />
            <div className="grid gap-4 xl:grid-cols-3">
              <JsonField name="optionsJson" label="Options JSON (MCQ)" defaultValue={'["Option A","Option B"]'} />
              <JsonField name="correctAnswerJson" label="Correct Answer JSON" defaultValue={"0"} required />
              <JsonField name="shortAnswerRulesJson" label="Short Answer Rules JSON" defaultValue={"{}"} />
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <TextField name="tagsCsv" label="Tags (comma-separated)" />
              <TextField name="source" label="Source (optional)" />
              <SelectField name="isActive" label="Active" options={[{ value: "true", label: "Active" }, { value: "false", label: "Inactive" }]} defaultValue="true" />
            </div>
            <button className="justify-self-start rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800">Create question</button>
          </form>
        </section>

        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">Filters</h2>
          <form method="get" className="mt-4 grid gap-4 lg:grid-cols-[2fr_1fr_1fr_1fr_auto_auto]">
            <input name="q" defaultValue={params.q ?? ""} placeholder="Search prompt/tags/source" className="rounded-xl border border-slate-300 px-4 py-3 text-sm" />
            <select name="subject" defaultValue={subjectFilter} className="rounded-xl border border-slate-300 px-4 py-3 text-sm">
              <option value="">All subjects</option>
              {(subjects ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select name="type" defaultValue={typeFilter} className="rounded-xl border border-slate-300 px-4 py-3 text-sm">
              <option value="">All types</option>
              {QTYPES.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <select name="difficulty" defaultValue={difficultyFilter} className="rounded-xl border border-slate-300 px-4 py-3 text-sm">
              <option value="">All difficulty</option>
              {DIFFS.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <label className="flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-3 text-sm"><input type="checkbox" name="includeDeleted" value="1" defaultChecked={includeDeleted} />Deleted</label>
            <button className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium hover:bg-slate-50">Apply</button>
          </form>
        </section>

        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between"><h2 className="text-lg font-semibold text-slate-900">Question list</h2><p className="text-sm text-slate-500">{filtered.length} shown</p></div>
          <div className="mt-4 space-y-4">
            {filtered.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">No questions found.</div> : filtered.map((row) => {
              const deleted = Boolean(row.deleted_at);
              return (
                <details key={row.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <summary className="cursor-pointer list-none">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap gap-2 text-xs">
                          <span className="rounded-md bg-slate-200 px-2 py-0.5">{row.question_type}</span>
                          <span className="rounded-md bg-slate-200 px-2 py-0.5">{row.difficulty}</span>
                          {deleted ? <span className="rounded-md bg-rose-100 px-2 py-0.5 text-rose-700">deleted</span> : null}
                        </div>
                        <p className="mt-2 font-semibold text-slate-900">{row.prompt}</p>
                        <p className="mt-1 text-xs text-slate-500">Subject: {subjectMap.get(row.subject_id)?.name ?? row.subject_id}</p>
                      </div>
                      {deleted ? (
                        <form action={restoreQuestion}><input type="hidden" name="questionId" value={row.id} /><button className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">Restore</button></form>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Link href={`/admin/questions/${row.id}`} className="rounded-lg border border-blue-300 bg-white px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50">Edit</Link>
                          <form action={softDeleteQuestion}><input type="hidden" name="questionId" value={row.id} /><button className="rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50">Soft delete</button></form>
                        </div>
                      )}
                    </div>
                  </summary>
                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Preview</p>
                      <p className="mt-2 text-sm text-slate-900">{row.prompt}</p>
                      {Array.isArray(row.options) ? (
                        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-700">
                          {row.options.map((o, i) => <li key={i}>{String(o)}</li>)}
                        </ol>
                      ) : null}
                      <pre className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">{JSON.stringify(row.correct_answer, null, 2)}</pre>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Metadata</p>
                      <p className="mt-2 text-xs text-slate-500">Tags: {(row.tags ?? []).join(", ") || "none"}</p>
                      <p className="mt-1 text-xs text-slate-500">Source: {row.source ?? "n/a"}</p>
                      <p className="mt-1 text-xs text-slate-500">Active: {String(row.is_active)}</p>
                      <p className="mt-1 text-xs text-slate-500">Created: {new Date(row.created_at).toLocaleString()}</p>
                      {row.question_type === "short_answer" ? (
                        <pre className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">{JSON.stringify(row.short_answer_rules ?? {}, null, 2)}</pre>
                      ) : null}
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        </section>
      </section>
    </main>
  );
}

function Banner({ tone, text }: { tone: "error" | "success"; text: string }) {
  const cls = tone === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-900";
  return <div className={`mt-5 rounded-xl border px-4 py-3 text-sm ${cls}`}>{text}</div>;
}
function TextField({ name, label, required }: { name: string; label: string; required?: boolean }) {
  return <div><label className="mb-2 block text-sm font-medium text-slate-700">{label}</label><input name={name} required={required} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm" /></div>;
}
function JsonField({ name, label, defaultValue, required }: { name: string; label: string; defaultValue: string; required?: boolean }) {
  return <div><label className="mb-2 block text-sm font-medium text-slate-700">{label}</label><textarea name={name} rows={4} required={required} defaultValue={defaultValue} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-mono text-xs" /></div>;
}
function SelectField({
  name, label, options, defaultValue, required
}: { name: string; label: string; options: Array<{ value: string; label: string }>; defaultValue?: string; required?: boolean }) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-slate-700">{label}</label>
      <select name={name} defaultValue={defaultValue} required={required} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm">
        {!defaultValue ? <option value="">Select</option> : null}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
