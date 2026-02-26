import type { Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSessionAuthState } from "@/lib/auth/session";
import { hasInstitutionRole } from "@/lib/auth/rbac";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/log";
import { setUsageCounterValue } from "@/lib/usage/limits";
import { formDataString, parseServerActionForm, zFormBooleanString } from "@/lib/http/server-action-validation";

type AdminsPageProps = {
  searchParams?: Promise<{
    status?: string;
    error?: string;
  }>;
};

const INSTITUTION_ROLES = ["owner", "admin", "editor", "viewer"] as const;
type InstitutionRoleValue = (typeof INSTITUTION_ROLES)[number];
const updateAdminRoleFormSchema = z.object({
  memberId: z.string().trim().min(1).max(128),
  role: z.enum(INSTITUTION_ROLES)
});
const toggleAdminActiveFormSchema = z.object({
  memberId: z.string().trim().min(1).max(128),
  nextActive: zFormBooleanString
});

function buildRedirect(params: Record<string, string | undefined>): Route {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) search.set(key, value);
  });
  const qs = search.toString();
  return (qs ? `/admin/admins?${qs}` : "/admin/admins") as Route;
}

export default async function AdminListPage({ searchParams }: AdminsPageProps) {
  const params = (await searchParams) ?? {};
  const authState = await getSessionAuthState();

  if (!authState.user) {
    redirect("/login?next=/admin/admins");
  }

  const writableMembership =
    authState.memberships.find((membership) => ["owner", "admin"].includes(membership.role)) ?? null;
  const canManageAdmins =
    Boolean(authState.context && hasInstitutionRole(authState.context, ["owner", "admin"])) ||
    Boolean(writableMembership);

  if (!writableMembership || !canManageAdmins) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-6">
          <h1 className="text-xl font-semibold text-rose-950">Insufficient permissions</h1>
          <p className="mt-2 text-sm text-rose-900">
            Admin management requires an <code>owner</code> or <code>admin</code> role.
          </p>
          <div className="mt-4">
            <Link
              href="/admin"
              className="inline-flex rounded-xl bg-rose-900 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-800"
            >
              Back to dashboard
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const supabase = await createSupabaseServerClient();
  const institutionId = writableMembership.institutionId;

  const { data: admins } = await supabase
    .from("institution_admins")
    .select("id, user_id, role, is_active, invited_by, invited_at, accepted_at, created_at, updated_at")
    .eq("institution_id", institutionId)
    .order("created_at", { ascending: true });

  const userIds = [...new Set((admins ?? []).map((a) => a.user_id))];
  let profileMap = new Map<string, { display_name: string | null }>();

  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("user_id, display_name")
      .in("user_id", userIds);

    profileMap = new Map(
      ((profiles ?? []) as Array<{ user_id: string; display_name: string | null }>).map((p) => [p.user_id, p])
    );
  }

  const rows = (admins ?? []).map((row) => ({
    ...row,
    displayName: profileMap.get(row.user_id)?.display_name ?? null,
    isCurrentUser: row.user_id === authState.user!.id
  }));

  async function updateAdminRole(formData: FormData) {
    "use server";

    const authState = await getSessionAuthState();
    const managerMembership =
      authState.memberships.find((membership) => ["owner", "admin"].includes(membership.role)) ?? null;
    const canManageAdmins =
      Boolean(authState.context && hasInstitutionRole(authState.context, ["owner", "admin"])) ||
      Boolean(managerMembership);

    if (!authState.user || !managerMembership || !canManageAdmins) {
      redirect(buildRedirect({ error: "forbidden" }));
    }

    const raw = {
      memberId: formDataString(formData, "memberId"),
      role: formDataString(formData, "role").toLowerCase()
    };

    if (!raw.memberId) {
      redirect(buildRedirect({ error: "missing_member_id" }));
    }
    if (!raw.role) redirect(buildRedirect({ error: "invalid_role" }));

    const parsedForm = parseServerActionForm(updateAdminRoleFormSchema, raw);
    if (!parsedForm.ok) {
      const fields = parsedForm.error.flatten().fieldErrors;
      if (fields.role?.length) redirect(buildRedirect({ error: "invalid_role" }));
      redirect(buildRedirect({ error: "invalid_input" }));
    }
    const { memberId, role: nextRole } = parsedForm.data;

    const supabase = await createSupabaseServerClient();
    const { data: target, error: targetError } = await supabase
      .from("institution_admins")
      .select("id, institution_id, user_id, role, is_active")
      .eq("id", memberId)
      .eq("institution_id", managerMembership.institutionId)
      .single();

    if (targetError || !target) {
      redirect(buildRedirect({ error: "member_not_found" }));
    }

    const actorIsOwner = managerMembership.role === "owner";
    const targetIsOwner = target.role === "owner";
    const promotingToOwner = nextRole === "owner";

    if (!actorIsOwner && (targetIsOwner || promotingToOwner)) {
      redirect(buildRedirect({ error: "owner_role_restricted" }));
    }

    if (target.role === nextRole) {
      redirect(buildRedirect({ status: "role_unchanged" }));
    }

    if (targetIsOwner && nextRole !== "owner" && target.is_active) {
      const { data: activeOwners } = await supabase
        .from("institution_admins")
        .select("id")
        .eq("institution_id", managerMembership.institutionId)
        .eq("role", "owner")
        .eq("is_active", true);

      if ((activeOwners ?? []).length <= 1) {
        redirect(buildRedirect({ error: "last_owner" }));
      }
    }

    const { error: updateError } = await supabase
      .from("institution_admins")
      .update({ role: nextRole })
      .eq("id", memberId)
      .eq("institution_id", managerMembership.institutionId);

    if (updateError) {
      redirect(buildRedirect({ error: "role_update_failed" }));
    }

    try {
      await logAuditEvent({
        institutionId: managerMembership.institutionId,
        action: "admin.role_change",
        entityType: "institution_admins",
        entityId: memberId,
        metadata: {
          operation: "update_role",
          from_role: target.role,
          to_role: nextRole,
          target_user_id: target.user_id
        }
      });
    } catch {
      // Non-blocking in scaffold stage.
    }

    redirect(buildRedirect({ status: "role_updated" }));
  }

  async function toggleAdminActive(formData: FormData) {
    "use server";

    const authState = await getSessionAuthState();
    const managerMembership =
      authState.memberships.find((membership) => ["owner", "admin"].includes(membership.role)) ?? null;
    const canManageAdmins =
      Boolean(authState.context && hasInstitutionRole(authState.context, ["owner", "admin"])) ||
      Boolean(managerMembership);

    if (!authState.user || !managerMembership || !canManageAdmins) {
      redirect(buildRedirect({ error: "forbidden" }));
    }

    const raw = {
      memberId: formDataString(formData, "memberId"),
      nextActive: formDataString(formData, "nextActive")
    };
    if (!raw.memberId) {
      redirect(buildRedirect({ error: "missing_member_id" }));
    }
    const parsedForm = parseServerActionForm(toggleAdminActiveFormSchema, raw);
    if (!parsedForm.ok) redirect(buildRedirect({ error: "invalid_input" }));
    const { memberId, nextActive } = parsedForm.data;

    const supabase = await createSupabaseServerClient();
    const { data: target, error: targetError } = await supabase
      .from("institution_admins")
      .select("id, institution_id, user_id, role, is_active")
      .eq("id", memberId)
      .eq("institution_id", managerMembership.institutionId)
      .single();

    if (targetError || !target) {
      redirect(buildRedirect({ error: "member_not_found" }));
    }

    if (target.user_id === authState.user.id && !nextActive) {
      redirect(buildRedirect({ error: "cannot_deactivate_self" }));
    }

    if (!nextActive && target.role === "owner") {
      const { data: activeOwners } = await supabase
        .from("institution_admins")
        .select("id")
        .eq("institution_id", managerMembership.institutionId)
        .eq("role", "owner")
        .eq("is_active", true);

      if ((activeOwners ?? []).length <= 1) {
        redirect(buildRedirect({ error: "last_owner" }));
      }
    }

    const { error: updateError } = await supabase
      .from("institution_admins")
      .update({ is_active: nextActive })
      .eq("id", memberId)
      .eq("institution_id", managerMembership.institutionId);

    if (updateError) {
      redirect(buildRedirect({ error: "toggle_failed" }));
    }

    try {
      const { count } = await supabase
        .from("institution_admins")
        .select("*", { count: "exact", head: true })
        .eq("institution_id", managerMembership.institutionId)
        .eq("is_active", true);
      await setUsageCounterValue({
        institutionId: managerMembership.institutionId,
        metricKey: "admins_active",
        value: count ?? 0,
        metadata: { source: "admin_toggle" }
      });
    } catch {
      // Non-blocking while usage counters are rolling out.
    }

    try {
      await logAuditEvent({
        institutionId: managerMembership.institutionId,
        action: "admin.role_change",
        entityType: "institution_admins",
        entityId: memberId,
        metadata: {
          operation: nextActive ? "activate_admin" : "deactivate_admin",
          target_user_id: target.user_id,
          role: target.role
        }
      });
    } catch {
      // Non-blocking in scaffold stage.
    }

    redirect(buildRedirect({ status: nextActive ? "activated" : "deactivated" }));
  }

  const errorMessages: Record<string, string> = {
    forbidden: "You do not have permission to manage admins.",
    missing_member_id: "Admin membership ID is missing.",
    invalid_input: "Invalid admin action input.",
    member_not_found: "Admin membership not found.",
    invalid_role: "Invalid institution role.",
    cannot_deactivate_self: "You cannot deactivate your own admin access from this page.",
    last_owner: "You cannot deactivate the last active owner.",
    owner_role_restricted: "Only an owner can assign or modify the owner role.",
    toggle_failed: "Failed to update admin status.",
    role_update_failed: "Failed to update admin role."
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Admin Management</p>
            <h1 className="mt-3 text-2xl font-semibold text-slate-900">Institution administrators</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Tenant-scoped admin list view with activation/deactivation controls for <code>owner</code> and{" "}
              <code>admin</code> users.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/admin/invitations"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Manage invitations
            </Link>
            <Link
              href="/admin"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Dashboard
            </Link>
          </div>
        </div>

        {params.error ? (
          <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {errorMessages[params.error] ?? "Admin management action failed."}
          </div>
        ) : null}

        {params.status ? (
          <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            {params.status === "activated" && "Admin access activated."}
            {params.status === "deactivated" && "Admin access deactivated."}
            {params.status === "role_updated" && "Admin role updated."}
            {params.status === "role_unchanged" && "No role change was needed."}
          </div>
        ) : null}

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <StatCard label="Total admins" value={String(rows.length)} />
          <StatCard label="Active" value={String(rows.filter((r) => r.is_active).length)} />
          <StatCard label="Owners" value={String(rows.filter((r) => r.role === "owner").length)} />
        </div>

        <section className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-slate-900">Admin list</h2>
          <div className="mt-4 space-y-3">
            {rows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                No institution admins found.
              </div>
            ) : (
              rows.map((row) => {
                const statusTone = row.is_active
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-slate-200 bg-white text-slate-600";
                const nextActive = !row.is_active;
                const disableDeactivateSelf = row.isCurrentUser && !nextActive;
                const actorIsOwner = writableMembership.role === "owner";
                const roleEditRestricted = !actorIsOwner && (row.role === "owner");

                return (
                  <div key={row.id} className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-slate-900">
                            {row.displayName || `${row.user_id.slice(0, 8)}...`}
                          </p>
                          {row.isCurrentUser ? (
                            <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                              You
                            </span>
                          ) : null}
                          <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusTone}`}>
                            {row.is_active ? "active" : "inactive"}
                          </span>
                        </div>
                        <p className="mt-1 font-mono text-xs text-slate-500">{row.user_id}</p>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                          <span className="rounded-md bg-slate-100 px-2 py-1">{row.role}</span>
                          <span>Accepted: {row.accepted_at ? new Date(row.accepted_at).toLocaleString() : "pending"}</span>
                          <span>Created: {new Date(row.created_at).toLocaleString()}</span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <form action={updateAdminRole} className="flex items-center gap-2">
                          <input type="hidden" name="memberId" value={row.id} />
                          <select
                            name="role"
                            defaultValue={row.role}
                            disabled={roleEditRestricted}
                            className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs focus:border-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {INSTITUTION_ROLES.map((role) => (
                              <option key={role} value={role}>
                                {role}
                              </option>
                            ))}
                          </select>
                          <button
                            type="submit"
                            disabled={roleEditRestricted}
                            className="rounded-lg border border-blue-300 bg-white px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Save role
                          </button>
                        </form>
                        <form action={toggleAdminActive}>
                          <input type="hidden" name="memberId" value={row.id} />
                          <input type="hidden" name="nextActive" value={String(nextActive)} />
                          <button
                            type="submit"
                            disabled={disableDeactivateSelf}
                            className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                              nextActive
                                ? "border border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50"
                                : "border border-rose-300 bg-white text-rose-700 hover:bg-rose-50"
                            } disabled:cursor-not-allowed disabled:opacity-50`}
                          >
                            {nextActive ? "Activate" : "Deactivate"}
                          </button>
                        </form>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}
