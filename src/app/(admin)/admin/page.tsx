import Link from "next/link";
import { getSessionAuthState } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function AdminDashboardPage() {
  const authState = await getSessionAuthState();

  if (!authState.user) {
    return null;
  }

  const memberships = authState.memberships;
  const primary = memberships[0] ?? null;
  const hasInstitutionAccess = memberships.length > 0 || authState.context?.platformRole === "super_admin";
  const institutionId = primary?.institutionId ?? null;

  let stats: {
    subjects: number;
    questions: number;
    exams: number;
    publishedExams: number;
    activePins: number;
    admins: number;
    pendingInvites: number;
  } | null = null;

  let recentAuditLogs: Array<{
    id: string;
    action: string;
    entity_type: string | null;
    entity_id: string | null;
    created_at: string;
    metadata: unknown;
  }> = [];

  if (institutionId) {
    const supabase = await createSupabaseServerClient();

    const [
      subjectsCount,
      questionsCount,
      examsCount,
      publishedExamsCount,
      activePinsCount,
      adminsCount,
      pendingInvitesCount,
      auditLogsResult
    ] = await Promise.all([
      supabase
        .from("subjects")
        .select("*", { count: "exact", head: true })
        .eq("institution_id", institutionId)
        .is("deleted_at", null),
      supabase
        .from("questions")
        .select("*", { count: "exact", head: true })
        .eq("institution_id", institutionId)
        .is("deleted_at", null),
      supabase
        .from("exams")
        .select("*", { count: "exact", head: true })
        .eq("institution_id", institutionId)
        .is("deleted_at", null),
      supabase
        .from("exams")
        .select("*", { count: "exact", head: true })
        .eq("institution_id", institutionId)
        .eq("status", "published")
        .is("deleted_at", null),
      supabase
        .from("exam_pins")
        .select("*", { count: "exact", head: true })
        .eq("institution_id", institutionId)
        .eq("status", "active"),
      supabase
        .from("institution_admins")
        .select("*", { count: "exact", head: true })
        .eq("institution_id", institutionId)
        .eq("is_active", true),
      supabase
        .from("admin_invitations")
        .select("*", { count: "exact", head: true })
        .eq("institution_id", institutionId)
        .eq("status", "pending"),
      supabase
        .from("audit_logs")
        .select("id, action, entity_type, entity_id, created_at, metadata")
        .eq("institution_id", institutionId)
        .order("created_at", { ascending: false })
        .limit(8)
    ]);

    stats = {
      subjects: subjectsCount.count ?? 0,
      questions: questionsCount.count ?? 0,
      exams: examsCount.count ?? 0,
      publishedExams: publishedExamsCount.count ?? 0,
      activePins: activePinsCount.count ?? 0,
      admins: adminsCount.count ?? 0,
      pendingInvites: pendingInvitesCount.count ?? 0
    };
    recentAuditLogs = (auditLogsResult.data ?? []) as typeof recentAuditLogs;
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Dashboard</p>
            <h1 className="mt-3 text-2xl font-semibold text-slate-900">Clavis Admin Workspace</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Foundation dashboard wired to Supabase auth + RLS-scoped membership queries. This is the base for Phase 2
              institution management, RBAC, and audit-driven admin workflows.
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
            <p className="text-slate-500">Platform role</p>
            <p className="font-semibold text-slate-900">
              {authState.context?.platformRole ?? "institution_admin"}
            </p>
          </div>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Institutions" value={String(memberships.length)} />
          <MetricCard label="Primary role" value={primary?.role ?? "none"} />
          <MetricCard label="Access state" value={hasInstitutionAccess ? "ready" : "onboarding"} />
          <MetricCard label="User ID" value={`${authState.user.id.slice(0, 8)}...`} mono />
        </div>
      </section>

      {!hasInstitutionAccess ? (
        <section className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="text-lg font-semibold text-amber-950">No institution membership found</h2>
          <p className="mt-2 text-sm text-amber-900">
            Complete owner bootstrap or accept an invitation to create your tenant-scoped admin workspace.
          </p>
          <div className="mt-4">
            <Link
              href="/onboarding"
              className="inline-flex rounded-xl bg-amber-900 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800"
            >
              Continue onboarding
            </Link>
          </div>
        </section>
      ) : null}

      <section className="mt-6 grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Overview statistics</h2>
          <p className="mt-1 text-sm text-slate-600">
            Tenant-scoped operational summary loaded via RLS from core tables for the selected institution context.
          </p>

          {!stats ? (
            <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
              No tenant context selected yet. Complete onboarding to unlock institution statistics.
            </div>
          ) : (
            <>
              <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <MetricCard label="Subjects" value={String(stats.subjects)} />
                <MetricCard label="Questions" value={String(stats.questions)} />
                <MetricCard label="Exams" value={String(stats.exams)} />
                <MetricCard label="Published exams" value={String(stats.publishedExams)} />
                <MetricCard label="Active PINs" value={String(stats.activePins)} />
                <MetricCard label="Active admins" value={String(stats.admins)} />
              </div>
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Pending invitations</p>
                    <p className="text-xs text-slate-500">Open admin invites awaiting acceptance or revocation.</p>
                  </div>
                  <p className="text-2xl font-semibold text-slate-900">{stats.pendingInvites}</p>
                </div>
              </div>
            </>
          )}
        </div>

        <aside className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Next foundation steps</h2>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li>Start Phase 1.5 RLS validation tests for cross-tenant access prevention.</li>
              <li>Add audit logs for onboarding invite acceptance and future exam/PIN actions.</li>
              <li>Introduce institution context switching for multi-tenant admins.</li>
              <li>Add usage-limit metrics cards from `usage_counters` and `institution_plans`.</li>
            </ul>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Quick actions</h2>
            <div className="mt-4 grid gap-3">
              <Link
                href="/onboarding"
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Open onboarding
              </Link>
              <Link
                href="/admin/invitations"
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Manage admin invites
              </Link>
              <Link
                href="/admin/admins"
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Admin list
              </Link>
              <Link
                href="/admin/settings"
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Institution settings
              </Link>
              <Link
                href="/admin/usage"
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Usage limits
              </Link>
              <Link
                href="/admin/subjects"
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Subjects
              </Link>
              <Link
                href="/admin/questions"
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Questions
              </Link>
              <Link
                href="/admin/exams"
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Exams
              </Link>
              <Link
                href="/admin/analytics/exams"
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Exam analytics
              </Link>
              <Link
                href="/admin/pins"
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                PINs
              </Link>
              <Link
                href="/candidate"
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Candidate portal preview
              </Link>
              <Link
                href="/api/health"
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Health endpoint
              </Link>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Recent audit activity</h2>
            <div className="mt-4 space-y-3">
              {!institutionId ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                  Activity feed appears after onboarding creates a tenant membership.
                </div>
              ) : recentAuditLogs.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                  No audit events yet.
                </div>
              ) : (
                recentAuditLogs.map((log) => (
                  <div key={log.id} className="rounded-xl border border-slate-200 p-3">
                    <p className="text-sm font-medium text-slate-900">{log.action}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {log.entity_type ?? "entity"} {log.entity_id ? `| ${log.entity_id.slice(0, 8)}...` : ""} |{" "}
                      {new Date(log.created_at).toLocaleString()}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Institution memberships</h2>
        <p className="mt-1 text-sm text-slate-600">
          Loaded with tenant-scoped RLS reads from <code>institution_admins</code> and <code>institutions</code>.
        </p>

        <div className="mt-4 space-y-3">
          {memberships.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
              No memberships yet.
            </div>
          ) : (
            memberships.map((membership) => (
              <div key={`${membership.institutionId}:${membership.role}`} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-slate-900">{membership.institution?.name ?? membership.institutionId}</p>
                    <p className="text-sm text-slate-500">
                      {membership.institution?.slug ? `/${membership.institution.slug}` : "slug unavailable"} |{" "}
                      {membership.institution?.status ?? "status unknown"}
                    </p>
                  </div>
                  <span className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">
                    {membership.role}
                  </span>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
                  <p>Timezone: {membership.institution?.timezone ?? "UTC"}</p>
                  <p>Locale: {membership.institution?.locale ?? "en-US"}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </main>
  );
}

function MetricCard({
  label,
  value,
  mono
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-2 text-lg font-semibold text-slate-900 ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

