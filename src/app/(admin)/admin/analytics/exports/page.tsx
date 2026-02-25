import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionAuthState } from "@/lib/auth/session";
import { hasInstitutionRole } from "@/lib/auth/rbac";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function AnalyticsExportsPage() {
  const auth = await getSessionAuthState();
  if (!auth.user) redirect("/login?next=/admin/analytics/exports");

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

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Exports</p>
            <h1 className="mt-3 text-2xl font-semibold text-slate-900">Analytics Exports & Reports</h1>
            <p className="mt-2 text-sm text-slate-600">
              Export exam result datasets as CSV, generate PDF summary reports, and run bulk exports across multiple exams.
            </p>
            <p className="mt-2 text-sm">
              <Link href="/admin/analytics/exams" className="font-medium text-blue-700 hover:text-blue-800">
                Open exam analytics dashboard &rarr;
              </Link>
            </p>
          </div>
        </div>

        <section className="mt-8 grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
            <h2 className="text-lg font-semibold text-slate-900">CSV Export (single / bulk)</h2>
            <p className="mt-1 text-sm text-slate-600">
              Select one or more exams and optional filters to download result rows as CSV.
            </p>
            <form method="get" action="/api/admin/exports/exam-results" className="mt-4 grid gap-4">
              <input type="hidden" name="format" value="csv" />
              <Field label="Exams (select one or more)">
                <select
                  name="examIds"
                  multiple
                  size={Math.min(12, Math.max(4, (exams ?? []).length))}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm"
                >
                  {(exams ?? []).map((exam) => (
                    <option key={exam.id} value={exam.id}>
                      {exam.title} ({exam.status})
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Date From">
                  <input type="date" name="dateFrom" className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm" />
                </Field>
                <Field label="Date To">
                  <input type="date" name="dateTo" className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm" />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Min Percentage">
                  <input type="number" min={0} max={100} step="0.01" name="minPercentage" className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm" />
                </Field>
                <Field label="Max Percentage">
                  <input type="number" min={0} max={100} step="0.01" name="maxPercentage" className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm" />
                </Field>
              </div>
              <button className="justify-self-start rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800">
                Download CSV
              </button>
            </form>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-slate-900">PDF Summary Report</h2>
            <p className="mt-1 text-sm text-slate-600">
              Generate a single-exam PDF summary (overview + filtered recent submissions). Use one exam only.
            </p>
            <form method="get" action="/api/admin/exports/exam-results" className="mt-4 grid gap-4">
              <input type="hidden" name="format" value="pdf" />
              <Field label="Exam">
                <select name="examId" required className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm">
                  <option value="">Select exam</option>
                  {(exams ?? []).map((exam) => (
                    <option key={exam.id} value={exam.id}>
                      {exam.title} ({exam.status})
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Date From">
                  <input type="date" name="dateFrom" className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm" />
                </Field>
                <Field label="Date To">
                  <input type="date" name="dateTo" className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm" />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Min Percentage">
                  <input type="number" min={0} max={100} step="0.01" name="minPercentage" className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm" />
                </Field>
                <Field label="Max Percentage">
                  <input type="number" min={0} max={100} step="0.01" name="maxPercentage" className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm" />
                </Field>
              </div>
              <button className="justify-self-start rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-50">
                Download PDF
              </button>
            </form>
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
              PDF export is a dependency-free generated summary report for roadmap coverage. CSV remains the detailed/raw export.
            </div>
          </div>
        </section>
      </section>
    </main>
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
