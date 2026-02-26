import type { Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSessionAuthState } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formDataString, parseServerActionForm } from "@/lib/http/server-action-validation";

type PlatformPageParams = {
  q?: string;
  status?: string;
  page?: string;
  error?: string;
  ok?: string;
};

function qs(path: Route, params: Record<string, string | undefined>): Route {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) s.set(k, v);
  const q = s.toString();
  return (q ? `${path}?${q}` : path) as Route;
}

function ensureSuperAdmin(auth: Awaited<ReturnType<typeof getSessionAuthState>>) {
  if (!auth.user) redirect("/login?next=/admin/platform");
  if (auth.profile?.platformRole !== "super_admin") {
    return false;
  }
  return true;
}

const institutionStatusUpdateFormSchema = z.object({
  institutionId: z.string().trim().min(1).max(128),
  nextStatus: z.enum(["active", "suspended"]),
  reason: z.string().trim().max(2_000)
});

const supportOverrideToolSchema = z.enum([
  "read_only_support_review",
  "retry_scoring_review",
  "import_reprocessing_review",
  "temporary_policy_override_review"
]);

const supportOverrideFormSchema = z.object({
  institutionId: z.string().trim().min(1).max(128),
  tool: supportOverrideToolSchema,
  note: z.string().trim().max(5_000)
});

export default async function PlatformAdminPage({
  searchParams
}: {
  searchParams?: Promise<PlatformPageParams>;
}) {
  const sp = (await searchParams) ?? {};
  const auth = await getSessionAuthState();
  if (!ensureSuperAdmin(auth)) {
    return <main className="mx-auto max-w-4xl px-6 py-10 text-sm">Super admin access required.</main>;
  }

  const supabase = await createSupabaseServerClient();
  const q = (sp.q ?? "").trim().toLowerCase();
  const statusFilter = (sp.status ?? "").trim().toLowerCase();

  const [
    institutionsRes,
    institutionsCountRes,
    activeInstitutionsCountRes,
    suspendedInstitutionsCountRes,
    adminsCountRes,
    attemptsCountRes,
    resultsCountRes,
    auditCountRes,
    recentAuditsRes
  ] = await Promise.all([
    supabase
      .from("institutions")
      .select("id,slug,name,status,timezone,locale,created_at,updated_at,settings")
      .order("updated_at", { ascending: false })
      .limit(120),
    supabase.from("institutions").select("*", { count: "exact", head: true }),
    supabase.from("institutions").select("*", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("institutions").select("*", { count: "exact", head: true }).eq("status", "suspended"),
    supabase.from("institution_admins").select("*", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("exam_attempts").select("*", { count: "exact", head: true }),
    supabase.from("exam_results").select("*", { count: "exact", head: true }),
    supabase.from("audit_logs").select("*", { count: "exact", head: true }),
    supabase
      .from("audit_logs")
      .select("id,institution_id,action,entity_type,entity_id,metadata,created_at,actor_user_id")
      .order("created_at", { ascending: false })
      .limit(50)
  ]);

  const institutions = (institutionsRes.data ?? []).filter((row) => {
    if (statusFilter && row.status !== statusFilter) return false;
    if (q && !`${row.name} ${row.slug} ${row.id}`.toLowerCase().includes(q)) return false;
    return true;
  });

  async function updateInstitutionStatus(formData: FormData) {
    "use server";
    const auth = await getSessionAuthState();
    if (!auth.user || auth.profile?.platformRole !== "super_admin") {
      redirect(qs("/admin/platform", { error: "forbidden" }));
    }
    const parsedForm = parseServerActionForm(institutionStatusUpdateFormSchema, {
      institutionId: formDataString(formData, "institutionId"),
      nextStatus: formDataString(formData, "nextStatus"),
      reason: formDataString(formData, "reason")
    });
    if (!parsedForm.ok) redirect(qs("/admin/platform", { error: "invalid_input" }));
    const { institutionId, nextStatus, reason } = parsedForm.data;

    const supabase = await createSupabaseServerClient();
    const { data: current } = await supabase
      .from("institutions")
      .select("id,status,settings")
      .eq("id", institutionId)
      .single();
    if (!current) redirect(qs("/admin/platform", { error: "institution_not_found" }));

    const settings =
      current.settings && typeof current.settings === "object" && !Array.isArray(current.settings)
        ? (current.settings as Record<string, unknown>)
        : {};
    const { error } = await supabase
      .from("institutions")
      .update({
        status: nextStatus,
        settings: {
          ...settings,
          platformStatusOverride: {
            status: nextStatus,
            reason: reason || null,
            updatedAt: new Date().toISOString(),
            updatedByUserId: auth.user.id
          }
        }
      })
      .eq("id", institutionId);
    if (error) redirect(qs("/admin/platform", { error: "status_update_failed" }));

    await supabase.rpc("audit_log", {
      p_institution_id: institutionId,
      p_action: nextStatus === "suspended" ? "platform.institution_suspend" : "platform.institution_reactivate",
      p_entity_type: "institutions",
      p_entity_id: institutionId,
      p_metadata: { reason: reason || null, actor_platform_role: "super_admin" }
    });

    redirect(qs("/admin/platform", { ok: nextStatus === "suspended" ? "suspended" : "reactivated" }));
  }

  async function runSupportOverride(formData: FormData) {
    "use server";
    const auth = await getSessionAuthState();
    if (!auth.user || auth.profile?.platformRole !== "super_admin") {
      redirect(qs("/admin/platform", { error: "forbidden" }));
    }
    const parsedForm = parseServerActionForm(supportOverrideFormSchema, {
      institutionId: formDataString(formData, "institutionId"),
      tool: formDataString(formData, "tool"),
      note: formDataString(formData, "note")
    });
    if (!parsedForm.ok) redirect(qs("/admin/platform", { error: "invalid_input" }));
    const { institutionId, tool, note } = parsedForm.data;

    const supabase = await createSupabaseServerClient();
    const { data: row } = await supabase
      .from("institutions")
      .select("id,settings")
      .eq("id", institutionId)
      .single();
    if (!row) redirect(qs("/admin/platform", { error: "institution_not_found" }));

    const settings =
      row.settings && typeof row.settings === "object" && !Array.isArray(row.settings)
        ? (row.settings as Record<string, unknown>)
        : {};
    const supportOverrides = Array.isArray(settings.supportOverrides) ? [...(settings.supportOverrides as unknown[])] : [];
    supportOverrides.unshift({
      tool,
      note: note || null,
      actorUserId: auth.user.id,
      createdAt: new Date().toISOString()
    });

    await supabase
      .from("institutions")
      .update({
        settings: {
          ...settings,
          supportOverrides: supportOverrides.slice(0, 20)
        }
      })
      .eq("id", institutionId);

    await supabase.rpc("audit_log", {
      p_institution_id: institutionId,
      p_action: "platform.support_override",
      p_entity_type: "institutions",
      p_entity_id: institutionId,
      p_metadata: { tool, note: note || null }
    });

    redirect(qs("/admin/platform", { ok: "override_logged" }));
  }

  const err: Record<string, string> = {
    forbidden: "Super admin access required.",
    invalid_input: "Invalid platform action input.",
    institution_not_found: "Institution not found.",
    status_update_failed: "Failed to update institution status."
  };

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Platform Admin</p>
            <h1 className="mt-3 text-2xl font-semibold text-slate-900">Super Admin Controls</h1>
            <p className="mt-2 text-sm text-slate-600">
              Manage institutions, view platform-wide analytics and audits, suspend/reactivate tenants, and record support override actions.
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
            <p className="text-slate-500">Role</p>
            <p className="font-semibold text-slate-900">{auth.profile?.platformRole}</p>
            <Link
              href="/admin/platform/operations"
              className="mt-2 inline-flex rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Open ops tooling
            </Link>
          </div>
        </div>

        {sp.error ? (
          <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {err[sp.error] ?? "Platform action failed."}
          </div>
        ) : null}
        {sp.ok ? (
          <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            {sp.ok === "suspended"
              ? "Institution suspended."
              : sp.ok === "reactivated"
                ? "Institution reactivated."
                : sp.ok === "override_logged"
                  ? "Support override logged."
                  : "Action completed."}
          </div>
        ) : null}

        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Institutions" value={String(institutionsCountRes.count ?? 0)} />
          <Stat label="Active" value={String(activeInstitutionsCountRes.count ?? 0)} />
          <Stat label="Suspended" value={String(suspendedInstitutionsCountRes.count ?? 0)} danger={(suspendedInstitutionsCountRes.count ?? 0) > 0} />
          <Stat label="Active Admins" value={String(adminsCountRes.count ?? 0)} />
          <Stat label="Attempts" value={String(attemptsCountRes.count ?? 0)} />
          <Stat label="Results" value={String(resultsCountRes.count ?? 0)} />
          <Stat label="Audit Logs" value={String(auditCountRes.count ?? 0)} />
          <Stat label="Visible Rows" value={String(institutions.length)} />
        </div>

        <section className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="text-lg font-semibold text-slate-900">Institution Management</h2>
          <form method="get" className="mt-4 grid gap-4 lg:grid-cols-[2fr_1fr_auto]">
            <input
              name="q"
              defaultValue={sp.q ?? ""}
              placeholder="Search by name / slug / id"
              className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm"
            />
            <select
              name="status"
              defaultValue={sp.status ?? ""}
              className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm"
            >
              <option value="">All statuses</option>
              <option value="active">active</option>
              <option value="suspended">suspended</option>
              <option value="archived">archived</option>
            </select>
            <button className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium hover:bg-slate-50">
              Apply
            </button>
          </form>

          <div className="mt-4 space-y-3">
            {institutions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                No institutions match the current filter.
              </div>
            ) : (
              institutions.map((institution) => (
                <details key={institution.id} className="rounded-xl border border-slate-200 bg-white p-4">
                  <summary className="cursor-pointer list-none">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900">{institution.name}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          /{institution.slug} | {institution.id}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${institution.status === "suspended" ? "border-rose-300 text-rose-700" : "border-slate-300 text-slate-700"}`}>
                          {institution.status}
                        </span>
                        <span className="text-xs text-slate-500">{new Date(institution.updated_at).toLocaleString()}</span>
                      </div>
                    </div>
                  </summary>

                  <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr]">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Suspend / Reactivate</p>
                      <form action={updateInstitutionStatus} className="mt-3 space-y-3">
                        <input type="hidden" name="institutionId" value={institution.id} />
                        <select
                          name="nextStatus"
                          defaultValue={institution.status === "suspended" ? "active" : "suspended"}
                          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm"
                        >
                          <option value="active">active</option>
                          <option value="suspended">suspended</option>
                        </select>
                        <input
                          name="reason"
                          placeholder="Reason (required operationally, not enforced)"
                          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm"
                        />
                        <button className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50">
                          Update status
                        </button>
                      </form>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Support Override (Logged)</p>
                      <form action={runSupportOverride} className="mt-3 space-y-3">
                        <input type="hidden" name="institutionId" value={institution.id} />
                        <select name="tool" defaultValue="read_only_support_review" className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm">
                          <option value="read_only_support_review">read_only_support_review</option>
                          <option value="retry_scoring_review">retry_scoring_review</option>
                          <option value="import_reprocessing_review">import_reprocessing_review</option>
                          <option value="temporary_policy_override_review">temporary_policy_override_review</option>
                        </select>
                        <textarea
                          name="note"
                          rows={3}
                          placeholder="Support note / ticket reference"
                          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm"
                        />
                        <button className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50">
                          Log override action
                        </button>
                      </form>
                    </div>
                  </div>
                </details>
              ))
            )}
          </div>
        </section>

        <section className="mt-8 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-slate-900">Global Analytics Snapshot</h2>
            <p className="mt-2 text-sm text-slate-600">
              Platform-wide counts across tenants for operations and capacity visibility.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Mini label="Institutions" value={String(institutionsCountRes.count ?? 0)} />
              <Mini label="Active Admins" value={String(adminsCountRes.count ?? 0)} />
              <Mini label="Attempts" value={String(attemptsCountRes.count ?? 0)} />
              <Mini label="Results" value={String(resultsCountRes.count ?? 0)} />
              <Mini label="Audit Events" value={String(auditCountRes.count ?? 0)} />
              <Mini label="Suspended" value={String(suspendedInstitutionsCountRes.count ?? 0)} />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-slate-900">Platform-wide Audit Logs</h2>
            <p className="mt-2 text-sm text-slate-600">Latest audit events across all institutions (super admin view).</p>
            <div className="mt-4 space-y-3">
              {(recentAuditsRes.data ?? []).length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                  No audit logs found.
                </div>
              ) : (
                (recentAuditsRes.data ?? []).map((log) => (
                  <div key={log.id} className="rounded-xl border border-slate-200 p-3">
                    <p className="text-sm font-medium text-slate-900">{log.action}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      institution: {log.institution_id ?? "platform"} | {log.entity_type ?? "entity"} | {log.entity_id ?? "-"}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">{new Date(log.created_at).toLocaleString()}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-2 text-lg font-semibold ${danger ? "text-rose-700" : "text-slate-900"}`}>{value}</p>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 font-semibold text-slate-900">{value}</p>
    </div>
  );
}
