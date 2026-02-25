import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSessionAuthState } from "@/lib/auth/session";
import { hasInstitutionRole } from "@/lib/auth/rbac";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildQuestionContentHash, findDuplicateQuestionByHash } from "@/lib/questions/content-hash";
import { formDataString, parseServerActionForm, zFormBooleanString } from "@/lib/http/server-action-validation";

const QTYPES = ["mcq_single", "mcq_multi", "true_false", "short_answer"] as const;
const DIFFS = ["easy", "medium", "hard"] as const;
type QType = (typeof QTYPES)[number];
type Difficulty = (typeof DIFFS)[number];

function parseObj(raw: string) {
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid object");
  return parsed as Record<string, unknown>;
}

const questionEditorSaveFormSchema = z.object({
  subjectId: z.string().trim().min(1).max(128),
  questionType: z.enum(QTYPES),
  prompt: z.string().trim().min(1).max(10_000),
  explanation: z.string().trim().max(10_000),
  difficulty: z.enum(DIFFS),
  optionsJson: z.string().max(200_000),
  correctAnswerJson: z.string().max(200_000),
  shortAnswerRulesJson: z.string().max(200_000),
  tagsCsv: z.string().max(4_000),
  source: z.string().trim().max(500),
  statsJson: z.string().max(200_000),
  metadataJson: z.string().max(200_000),
  isActive: zFormBooleanString
});

export default async function QuestionEditorPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ status?: string; error?: string }>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const auth = await getSessionAuthState();
  if (!auth.user) redirect(`/login?next=/admin/questions/${id}`);

  const membership = auth.memberships.find((m) => ["owner", "admin", "editor"].includes(m.role)) ?? null;
  const canManage =
    Boolean(auth.context && hasInstitutionRole(auth.context, ["owner", "admin", "editor"])) || Boolean(membership);
  if (!membership || !canManage) return <main className="mx-auto max-w-4xl px-6 py-10 text-sm">Insufficient permissions.</main>;

  const supabase = await createSupabaseServerClient();
  const [{ data: subjects }, { data: question }] = await Promise.all([
    supabase.from("subjects").select("id,name,code,deleted_at").eq("institution_id", membership.institutionId).order("name"),
    supabase
      .from("questions")
      .select("id,subject_id,question_type,prompt,explanation,options,correct_answer,short_answer_rules,difficulty,tags,source,stats,metadata,is_active,deleted_at")
      .eq("id", id)
      .eq("institution_id", membership.institutionId)
      .single()
  ]);

  if (!question) return <main className="mx-auto max-w-4xl px-6 py-10 text-sm">Question not found.</main>;

  async function save(formData: FormData) {
    "use server";
    const auth = await getSessionAuthState();
    const membership = auth.memberships.find((m) => ["owner", "admin", "editor"].includes(m.role)) ?? null;
    const canManage =
      Boolean(auth.context && hasInstitutionRole(auth.context, ["owner", "admin", "editor"])) || Boolean(membership);
    if (!auth.user || !membership || !canManage) redirect(`/admin/questions/${id}?error=forbidden`);

    const raw = {
      subjectId: formDataString(formData, "subjectId"),
      questionType: formDataString(formData, "questionType"),
      prompt: formDataString(formData, "prompt"),
      explanation: formDataString(formData, "explanation"),
      difficulty: formDataString(formData, "difficulty") || "medium",
      optionsJson: formDataString(formData, "optionsJson") || "[]",
      correctAnswerJson: formDataString(formData, "correctAnswerJson"),
      shortAnswerRulesJson: formDataString(formData, "shortAnswerRulesJson") || "{}",
      tagsCsv: formDataString(formData, "tagsCsv"),
      source: formDataString(formData, "source"),
      statsJson: formDataString(formData, "statsJson") || "{}",
      metadataJson: formDataString(formData, "metadataJson") || "{}",
      isActive: formDataString(formData, "isActive") || "true"
    };
    const parsedForm = parseServerActionForm(questionEditorSaveFormSchema, raw);
    if (!parsedForm.ok) redirect(`/admin/questions/${id}?error=invalid_input`);

    const {
      subjectId,
      questionType,
      prompt,
      explanation,
      difficulty,
      optionsJson,
      correctAnswerJson,
      shortAnswerRulesJson,
      tagsCsv,
      source,
      statsJson,
      metadataJson,
      isActive
    } = parsedForm.data;
    const tags = tagsCsv.split(",").map((v) => v.trim()).filter(Boolean);

    let options: unknown = null;
    let correctAnswer: unknown = null;
    let shortAnswerRules: unknown = null;
    let stats: Record<string, unknown> = {};
    let metadata: Record<string, unknown> = {};
    try {
      options =
        questionType === "true_false" ? ["True", "False"] : questionType === "short_answer" ? null : JSON.parse(optionsJson);
      correctAnswer = JSON.parse(correctAnswerJson);
      shortAnswerRules = questionType === "short_answer" ? parseObj(shortAnswerRulesJson) : null;
      stats = parseObj(statsJson);
      metadata = parseObj(metadataJson);
    } catch {
      redirect(`/admin/questions/${id}?error=invalid_payload`);
    }

    const contentHash = buildQuestionContentHash({ subjectId, questionType, prompt, options, correctAnswer, shortAnswerRules });
    try {
      const duplicate = await findDuplicateQuestionByHash({
        institutionId: membership.institutionId,
        contentHash,
        excludeQuestionId: id
      });
      if (duplicate) redirect(`/admin/questions/${id}?error=duplicate`);
    } catch {
      // Fall back to DB unique constraint handling.
    }
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("questions").update({
      subject_id: subjectId,
      question_type: questionType,
      prompt,
      explanation: explanation || null,
      options,
      correct_answer: correctAnswer,
      short_answer_rules: shortAnswerRules,
      difficulty,
      tags,
      source: source || null,
      stats,
      metadata,
      is_active: isActive,
      content_hash: contentHash
    }).eq("id", id).eq("institution_id", membership.institutionId);

    if (error) {
      redirect(`/admin/questions/${id}?error=${String(error.message).toLowerCase().includes("unique") ? "duplicate" : "save_failed"}`);
    }
    redirect(`/admin/questions/${id}?status=saved`);
  }

  const err: Record<string, string> = {
    forbidden: "You do not have permission to edit questions.",
    invalid_input: "Required fields are missing or invalid.",
    invalid_payload: "JSON payload is invalid for the selected type.",
    duplicate: "Duplicate question detected by content hash.",
    save_failed: "Failed to save question."
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Question Editor</p>
            <h1 className="mt-3 text-2xl font-semibold text-slate-900">Edit question</h1>
            <p className="mt-2 text-sm text-slate-600">Dedicated editor page for Phase 3.2 question bank workflows.</p>
          </div>
          <div className="flex gap-2">
            <Link href="/admin/questions" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Back to questions</Link>
          </div>
        </div>
        {sp.error ? <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{err[sp.error] ?? "Editor action failed."}</div> : null}
        {sp.status === "saved" ? <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">Question saved.</div> : null}

        <div className="mt-8 grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <form action={save} className="grid gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-6">
            <div className="grid gap-4 lg:grid-cols-3">
              <Field label="Subject"><select name="subjectId" defaultValue={question.subject_id} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm">{(subjects ?? []).filter((s) => !s.deleted_at).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
              <Field label="Type"><select name="questionType" defaultValue={question.question_type} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm">{QTYPES.map((v) => <option key={v} value={v}>{v}</option>)}</select></Field>
              <Field label="Difficulty"><select name="difficulty" defaultValue={question.difficulty} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm">{DIFFS.map((v) => <option key={v} value={v}>{v}</option>)}</select></Field>
            </div>
            <Field label="Prompt"><textarea name="prompt" rows={3} defaultValue={question.prompt} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm" /></Field>
            <Field label="Explanation"><textarea name="explanation" rows={2} defaultValue={question.explanation ?? ""} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm" /></Field>
            <div className="grid gap-4 xl:grid-cols-3">
              <Field label="Options JSON"><textarea name="optionsJson" rows={5} defaultValue={JSON.stringify(question.options ?? [], null, 2)} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-mono text-xs" /></Field>
              <Field label="Correct Answer JSON"><textarea name="correctAnswerJson" rows={5} defaultValue={JSON.stringify(question.correct_answer, null, 2)} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-mono text-xs" /></Field>
              <Field label="Short Answer Rules JSON"><textarea name="shortAnswerRulesJson" rows={5} defaultValue={JSON.stringify(question.short_answer_rules ?? {}, null, 2)} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-mono text-xs" /></Field>
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <Field label="Tags CSV"><input name="tagsCsv" defaultValue={(question.tags ?? []).join(", ")} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm" /></Field>
              <Field label="Source"><input name="source" defaultValue={question.source ?? ""} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm" /></Field>
              <Field label="Active"><select name="isActive" defaultValue={question.is_active ? "true" : "false"} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm"><option value="true">Active</option><option value="false">Inactive</option></select></Field>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <Field label="Stats JSON"><textarea name="statsJson" rows={4} defaultValue={JSON.stringify(question.stats ?? {}, null, 2)} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-mono text-xs" /></Field>
              <Field label="Metadata JSON"><textarea name="metadataJson" rows={4} defaultValue={JSON.stringify(question.metadata ?? {}, null, 2)} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-mono text-xs" /></Field>
            </div>
            <button className="justify-self-start rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800">Save question</button>
          </form>

          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-slate-900">Preview</h2>
            <p className="mt-3 text-sm text-slate-900">{question.prompt}</p>
            {Array.isArray(question.options) ? (
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-slate-700">
                {question.options.map((o, i) => <li key={i}>{String(o)}</li>)}
              </ol>
            ) : null}
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Correct answer</p>
              <pre className="mt-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">{JSON.stringify(question.correct_answer, null, 2)}</pre>
            </div>
            <p className="mt-3 text-xs text-slate-500">Type: {question.question_type} | Difficulty: {question.difficulty}</p>
          </div>
        </div>
      </section>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-2 block text-sm font-medium text-slate-700">{label}</label>{children}</div>;
}
