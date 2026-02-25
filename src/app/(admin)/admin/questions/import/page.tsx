import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSessionAuthState } from "@/lib/auth/session";
import { hasInstitutionRole } from "@/lib/auth/rbac";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assertUsageAllowed, incrementUsageCounter } from "@/lib/usage/limits";
import { findDuplicateQuestionByHash } from "@/lib/questions/content-hash";
import { parseQuestionsXml, resolveImportedQuestions } from "@/lib/questions/xml-import";
import { logAuditEvent } from "@/lib/audit/log";
import { formDataString, parseServerActionForm } from "@/lib/http/server-action-validation";

type ImportPageProps = {
  searchParams?: Promise<{
    status?: string;
    error?: string;
    report?: string;
  }>;
};

function redirectTo(params: Record<string, string | undefined>) {
  const s = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v && s.set(k, v));
  const q = s.toString();
  return q ? `/admin/questions/import?${q}` : "/admin/questions/import";
}

const xmlImportFormSchema = z.object({
  xml: z.string().min(1).max(2_000_000),
  duplicateMode: z.enum(["skip", "error"])
});

export default async function QuestionXmlImportPage({ searchParams }: ImportPageProps) {
  const params = (await searchParams) ?? {};
  const auth = await getSessionAuthState();
  if (!auth.user) redirect("/login?next=/admin/questions/import");

  const membership = auth.memberships.find((m) => ["owner", "admin", "editor"].includes(m.role)) ?? null;
  const canManage =
    Boolean(auth.context && hasInstitutionRole(auth.context, ["owner", "admin", "editor"])) || Boolean(membership);
  if (!membership || !canManage) {
    return <main className="mx-auto max-w-4xl px-6 py-10 text-sm">Insufficient permissions.</main>;
  }

  const supabase = await createSupabaseServerClient();
  const { data: subjects } = await supabase
    .from("subjects")
    .select("id,name,code,deleted_at")
    .eq("institution_id", membership.institutionId)
    .is("deleted_at", null)
    .order("name");

  async function importXml(formData: FormData) {
    "use server";
    const auth = await getSessionAuthState();
    const membership = auth.memberships.find((m) => ["owner", "admin", "editor"].includes(m.role)) ?? null;
    const canManage =
      Boolean(auth.context && hasInstitutionRole(auth.context, ["owner", "admin", "editor"])) || Boolean(membership);
    if (!auth.user || !membership || !canManage) redirect(redirectTo({ error: "forbidden" }));

    const raw = {
      xml: formDataString(formData, "xml"),
      duplicateMode: formDataString(formData, "duplicateMode") || "skip"
    };
    if (!raw.xml) redirect(redirectTo({ error: "missing_xml" }));
    const parsedForm = parseServerActionForm(xmlImportFormSchema, raw);
    if (!parsedForm.ok) redirect(redirectTo({ error: "invalid_input" }));
    const { xml, duplicateMode: mode } = parsedForm.data;

    const supabase = await createSupabaseServerClient();
    const { data: subjects } = await supabase
      .from("subjects")
      .select("id,name,code,deleted_at")
      .eq("institution_id", membership.institutionId)
      .is("deleted_at", null);

    const parsed = parseQuestionsXml(xml);
    const resolved = resolveImportedQuestions({
      drafts: parsed.questions,
      subjects: ((subjects ?? []) as Array<{ id: string; name: string; code: string | null }>)
    });

    const errors: Array<{ index: number; message: string }> = [...parsed.errors, ...resolved.errors];
    const inserts: Array<Record<string, unknown>> = [];
    let duplicateSkipped = 0;
    let inserted = 0;

    for (let i = 0; i < resolved.resolved.length; i += 1) {
      const q = resolved.resolved[i];
      const rowIndex = i + 1;

      try {
        const duplicate = await findDuplicateQuestionByHash({
          institutionId: membership.institutionId,
          contentHash: q.contentHash
        });
        if (duplicate) {
          if (mode === "error") {
            errors.push({ index: rowIndex, message: "Duplicate question detected by hash" });
          } else {
            duplicateSkipped += 1;
          }
          continue;
        }
      } catch {
        // If duplicate precheck fails, DB unique constraint still protects inserts.
      }

      inserts.push({
        institution_id: membership.institutionId,
        subject_id: q.subjectId,
        question_type: q.questionType,
        prompt: q.prompt,
        explanation: q.explanation,
        options: q.options,
        correct_answer: q.correctAnswer,
        short_answer_rules: q.shortAnswerRules,
        difficulty: q.difficulty,
        tags: q.tags,
        source: q.source,
        content_hash: q.contentHash,
        stats: {},
        metadata: { import_source: "xml" },
        is_active: q.isActive,
        created_by: auth.user.id
      });
    }

    if (inserts.length > 0) {
      try {
        await assertUsageAllowed({
          institutionId: membership.institutionId,
          target: "questions",
          requested: inserts.length
        });
      } catch {
        redirect(redirectTo({ error: "question_limit_reached" }));
      }

      const { error } = await supabase.from("questions").insert(inserts);
      if (error) {
        errors.push({ index: 0, message: `Bulk insert failed: ${error.message}` });
      } else {
        inserted = inserts.length;
        try {
          await incrementUsageCounter({
            institutionId: membership.institutionId,
            metricKey: "questions_total",
            metricPeriod: "all_time",
            incrementBy: inserted
          });
        } catch {}
      }
    }

    try {
      await logAuditEvent({
        institutionId: membership.institutionId,
        action: "question.import",
        entityType: "questions",
        metadata: {
          format: "xml",
          parsed: parsed.questions.length,
          inserted,
          duplicate_skipped: duplicateSkipped,
          errors: errors.length
        }
      });
    } catch {}

    const report = Buffer.from(JSON.stringify({ parsed: parsed.questions.length, inserted, duplicateSkipped, errors })).toString("base64url");
    redirect(redirectTo({ status: "done", report }));
  }

  const report = params.report
    ? (() => {
        try {
          return JSON.parse(Buffer.from(params.report, "base64url").toString("utf8")) as {
            parsed: number;
            inserted: number;
            duplicateSkipped: number;
            errors: Array<{ index: number; message: string }>;
          };
        } catch {
          return null;
        }
      })()
    : null;

  const sampleXml = `<quiz version="1">
  <question type="mcq_single" subject="MTH101" difficulty="easy">
    <prompt>2 + 2 = ?</prompt>
    <options>
      <option correct="false">3</option>
      <option correct="true">4</option>
      <option correct="false">5</option>
    </options>
    <tags><tag>arithmetic</tag></tags>
  </question>
  <question type="true_false" subject="MTH101">
    <prompt>Zero is an even number.</prompt>
    <answer>true</answer>
  </question>
</quiz>`;

  const errorCopy: Record<string, string> = {
    forbidden: "You do not have permission to import questions.",
    missing_xml: "Paste XML content to import.",
    invalid_input: "Invalid XML import form input.",
    question_limit_reached: "Question limit would be exceeded by this import."
  };

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">XML Import</p>
            <h1 className="mt-3 text-2xl font-semibold text-slate-900">Question XML Import</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Phase 3.3 bulk import for v1 question types with subject resolution, duplicate detection via hash, and row-level error reporting.
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/admin/questions" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Back to questions
            </Link>
            <a href="/docs/question-import-xml-schema.md" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              XML schema docs
            </a>
          </div>
        </div>

        {params.error ? (
          <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {errorCopy[params.error] ?? "Import failed."}
          </div>
        ) : null}

        {params.status === "done" && report ? (
          <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <p className="font-semibold">Import completed</p>
            <p className="mt-1">Parsed: {report.parsed} | Inserted: {report.inserted} | Duplicate skipped: {report.duplicateSkipped} | Errors: {report.errors.length}</p>
          </div>
        ) : null}

        <div className="mt-8 grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
            <h2 className="text-lg font-semibold text-slate-900">Import XML</h2>
            <form action={importXml} className="mt-4 grid gap-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Duplicate handling</label>
                  <select name="duplicateMode" defaultValue="skip" className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm">
                    <option value="skip">Skip duplicates (Recommended)</option>
                    <option value="error">Report duplicates as errors</option>
                  </select>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                  Active subjects available for mapping: <span className="font-semibold text-slate-900">{(subjects ?? []).length}</span>
                </div>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">XML payload</label>
                <textarea
                  name="xml"
                  rows={22}
                  defaultValue={sampleXml}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-mono text-xs focus:border-blue-500 focus:outline-none"
                />
              </div>
              <button className="justify-self-start rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800">
                Parse and import
              </button>
            </form>
          </section>

          <aside className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="text-lg font-semibold text-slate-900">Subject mapping rules</h2>
              <ul className="mt-4 space-y-2 text-sm text-slate-600">
                <li>`subject` attribute matches subject `code` first, then subject `name`.</li>
                <li>Subjects are not auto-created during import.</li>
                <li>Deleted subjects are excluded from import resolution.</li>
              </ul>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="text-lg font-semibold text-slate-900">Supported question types</h2>
              <ul className="mt-4 space-y-2 text-sm text-slate-600">
                <li>
                  <code>mcq_single</code> via <code>{"<options><option correct=\"...\">..."}</code>
                </li>
                <li>
                  <code>mcq_multi</code> via multiple correct options
                </li>
                <li>
                  <code>true_false</code> via <code>{"<answer>true|false</answer>"}</code>
                </li>
                <li>
                  <code>short_answer</code> via <code>{"<answer>"}</code> + optional{" "}
                  <code>{"<shortAnswerRules>"}</code> JSON
                </li>
              </ul>
            </div>

            {report ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-6">
                <h2 className="text-lg font-semibold text-slate-900">Import error report</h2>
                <div className="mt-4 space-y-2 text-sm">
                  {report.errors.length === 0 ? (
                    <p className="text-slate-600">No errors reported.</p>
                  ) : (
                    report.errors.slice(0, 25).map((e, idx) => (
                      <div key={`${e.index}-${idx}`} className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800">
                        Row {e.index}: {e.message}
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </aside>
        </div>
      </section>
    </main>
  );
}
