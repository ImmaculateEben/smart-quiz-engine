import type { Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSessionAuthState } from "@/lib/auth/session";
import { hasInstitutionRole } from "@/lib/auth/rbac";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { generateInviteToken, hashInviteToken } from "@/lib/auth/invitations";
import { logAuditEvent } from "@/lib/audit/log";
import { getAdminInviteCapacityCheck, getMonthlyMetricPeriod, incrementUsageCounter } from "@/lib/usage/limits";
import { formDataString, parseServerActionForm } from "@/lib/http/server-action-validation";

type InvitationsPageProps = {
  searchParams?: Promise<{
    status?: string;
    error?: string;
    token?: string;
    email?: string;
  }>;
};

function buildRedirect(params: Record<string, string | undefined>): Route {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) search.set(key, value);
  });
  const qs = search.toString();
  return (qs ? `/admin/invitations?${qs}` : "/admin/invitations") as Route;
}

function isValidRole(role: string): role is "owner" | "admin" | "editor" | "viewer" {
  return ["owner", "admin", "editor", "viewer"].includes(role);
}

const invitationRoleSchema = z.enum(["owner", "admin", "editor", "viewer"]);

const createInvitationFormSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  role: invitationRoleSchema,
  expiresInDays: z.coerce.number().int().min(1).max(30)
});

const revokeInvitationFormSchema = z.object({
  inviteId: z.string().trim().min(1).max(128)
});

export default async function AdminInvitationsPage({ searchParams }: InvitationsPageProps) {
  const params = (await searchParams) ?? {};
  const authState = await getSessionAuthState();

  if (!authState.user) {
    redirect("/login?next=/admin/invitations");
  }

  const writableMembership =
    authState.memberships.find((membership) => ["owner", "admin"].includes(membership.role)) ?? null;
  const primaryMembership = writableMembership ?? authState.memberships[0] ?? null;
  const context = authState.context;

  const canManageInvites =
    Boolean(primaryMembership && context && hasInstitutionRole(context, ["owner", "admin"])) ||
    authState.memberships.some((membership) => ["owner", "admin"].includes(membership.role));

  if (!primaryMembership || !canManageInvites) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-6">
          <h1 className="text-xl font-semibold text-rose-950">Insufficient permissions</h1>
          <p className="mt-2 text-sm text-rose-900">
            Admin invitations require an <code>owner</code> or <code>admin</code> role in an institution.
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
  const institutionId = primaryMembership.institutionId;

  const { data: invitations } = await supabase
    .from("admin_invitations")
    .select("id, email, role, status, expires_at, created_at, metadata")
    .eq("institution_id", institutionId)
    .order("created_at", { ascending: false })
    .limit(50);

  async function createInvitation(formData: FormData) {
    "use server";

    const authState = await getSessionAuthState();
    const canManageInvites =
      Boolean(authState.context && hasInstitutionRole(authState.context, ["owner", "admin"])) ||
      authState.memberships.some((membership) => ["owner", "admin"].includes(membership.role));

    if (!authState.user || !canManageInvites) {
      redirect(buildRedirect({ error: "forbidden" }));
    }

    const membership =
      authState.memberships.find((item) => ["owner", "admin"].includes(item.role)) ?? authState.memberships[0];
    if (!membership) {
      redirect(buildRedirect({ error: "no_institution" }));
    }

    const raw = {
      email: formDataString(formData, "email").toLowerCase(),
      role: formDataString(formData, "role").toLowerCase(),
      expiresInDays: formDataString(formData, "expiresInDays") || "7"
    };
    const parsedForm = parseServerActionForm(createInvitationFormSchema, raw);
    if (!parsedForm.ok) {
      const fields = parsedForm.error.flatten().fieldErrors;
      if (fields.email?.length) redirect(buildRedirect({ error: "invalid_email" }));
      if (fields.role?.length) redirect(buildRedirect({ error: "invalid_role" }));
      if (fields.expiresInDays?.length) redirect(buildRedirect({ error: "invalid_expiry" }));
      redirect(buildRedirect({ error: "create_failed" }));
    }

    const { email, role, expiresInDays } = parsedForm.data;

    const token = generateInviteToken();
    const tokenHash = hashInviteToken(token);
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

    const capacity = await getAdminInviteCapacityCheck(membership.institutionId, 1);
    if (!capacity.allowed) {
      redirect(buildRedirect({ error: "admin_limit_reached" }));
    }

    const supabase = await createSupabaseServerClient();
    const { data: inserted, error } = await supabase
      .from("admin_invitations")
      .insert({
        institution_id: membership.institutionId,
        email,
        role,
        token_hash: tokenHash,
        status: "pending",
        expires_at: expiresAt,
        invited_by: authState.user.id,
        metadata: {
          invite_source: "admin_ui",
          expires_in_days: expiresInDays
        }
      })
      .select("id")
      .single();

    if (error || !inserted) {
      redirect(buildRedirect({ error: "create_failed" }));
    }

    try {
      await incrementUsageCounter({
        institutionId: membership.institutionId,
        metricKey: "admin_invites_sent",
        metricPeriod: "all_time",
        incrementBy: 1
      });
      await incrementUsageCounter({
        institutionId: membership.institutionId,
        metricKey: "admin_invites_sent",
        metricPeriod: getMonthlyMetricPeriod(),
        incrementBy: 1
      });
    } catch {
      // Non-blocking tracking update.
    }

    try {
      await logAuditEvent({
        institutionId: membership.institutionId,
        action: "admin.invite",
        entityType: "admin_invitations",
        entityId: inserted.id,
        metadata: { email, role, expiresAt }
      });
    } catch {
      // Keep invite creation successful even if audit log fails in early scaffold stages.
    }

    redirect(
      buildRedirect({
        status: "created",
        token,
        email
      })
    );
  }

  async function revokeInvitation(formData: FormData) {
    "use server";

    const authState = await getSessionAuthState();
    const canManageInvites =
      Boolean(authState.context && hasInstitutionRole(authState.context, ["owner", "admin"])) ||
      authState.memberships.some((membership) => ["owner", "admin"].includes(membership.role));

    if (!authState.user || !canManageInvites) {
      redirect(buildRedirect({ error: "forbidden" }));
    }

    const membership =
      authState.memberships.find((item) => ["owner", "admin"].includes(item.role)) ?? authState.memberships[0];
    if (!membership) {
      redirect(buildRedirect({ error: "no_institution" }));
    }

    const raw = { inviteId: formDataString(formData, "inviteId") };
    if (!raw.inviteId) {
      redirect(buildRedirect({ error: "missing_invite_id" }));
    }
    const parsedForm = parseServerActionForm(revokeInvitationFormSchema, raw);
    if (!parsedForm.ok) redirect(buildRedirect({ error: "missing_invite_id" }));
    const { inviteId } = parsedForm.data;

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("admin_invitations")
      .update({ status: "revoked" })
      .eq("id", inviteId)
      .eq("institution_id", membership.institutionId)
      .in("status", ["pending"]);

    if (error) {
      redirect(buildRedirect({ error: "revoke_failed" }));
    }

    try {
      await logAuditEvent({
        institutionId: membership.institutionId,
        action: "admin.invite",
        entityType: "admin_invitations",
        entityId: inviteId,
        metadata: { operation: "revoke_invitation" }
      });
    } catch {
      // Non-blocking for scaffold stage.
    }

    redirect(buildRedirect({ status: "revoked" }));
  }

  const errorMessages: Record<string, string> = {
    forbidden: "You do not have permission to manage invitations.",
    no_institution: "No active institution context found.",
    invalid_email: "Enter a valid email address.",
    invalid_role: "Select a valid invitation role.",
    invalid_expiry: "Expiry must be between 1 and 30 days.",
    admin_limit_reached: "Admin seat limit reached for the current plan (active admins + pending invites).",
    create_failed: "Failed to create invitation.",
    missing_invite_id: "Invitation ID is missing.",
    revoke_failed: "Failed to revoke invitation."
  };

  const inviteLink =
    params.token != null ? `/onboarding?mode=invite&token=${encodeURIComponent(params.token)}` : null;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Admin Invitations</p>
            <h1 className="mt-3 text-2xl font-semibold text-slate-900">Invite institution administrators</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Creates hashed invite tokens in <code>admin_invitations</code> and provides a one-time token to share
              with the invitee for onboarding acceptance.
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
            <p className="text-slate-500">Institution</p>
            <p className="font-semibold text-slate-900">
              {primaryMembership.institution?.name ?? primaryMembership.institutionId}
            </p>
            <p className="text-xs text-slate-500">{primaryMembership.role}</p>
          </div>
        </div>

        {params.error ? (
          <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {errorMessages[params.error] ?? "Invitation action failed."}
          </div>
        ) : null}

        {params.status === "created" && params.token ? (
          <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <p className="font-semibold">Invitation created for {params.email ?? "invitee"}.</p>
            <p className="mt-1">Share this token once (raw token is not stored):</p>
            <div className="mt-3 overflow-x-auto rounded-lg border border-emerald-300 bg-white px-3 py-2 font-mono text-xs">
              {params.token}
            </div>
            {inviteLink ? (
              <div className="mt-3">
                <p className="text-xs text-emerald-800">Invitee onboarding link</p>
                <div className="mt-1 overflow-x-auto rounded-lg border border-emerald-300 bg-white px-3 py-2 font-mono text-xs">
                  {inviteLink}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {params.status === "revoked" ? (
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Invitation revoked.
          </div>
        ) : null}

        <div className="mt-8 grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
            <h2 className="text-lg font-semibold text-slate-900">Create invitation</h2>
            <form action={createInvitation} className="mt-4 space-y-4">
              <Field label="Invitee email" htmlFor="email">
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  placeholder="admin@institution.edu"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:border-blue-500 focus:outline-none"
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Role" htmlFor="role">
                  <select
                    id="role"
                    name="role"
                    defaultValue="admin"
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:border-blue-500 focus:outline-none"
                  >
                    <option value="admin">Admin</option>
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                    <option value="owner">Owner</option>
                  </select>
                </Field>

                <Field label="Expires in (days)" htmlFor="expiresInDays">
                  <input
                    id="expiresInDays"
                    name="expiresInDays"
                    type="number"
                    min={1}
                    max={30}
                    defaultValue={7}
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </Field>
              </div>

              <button
                type="submit"
                className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Generate invitation token
              </button>
            </form>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900">Recent invitations</h2>
              <Link
                href="/admin"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Back to dashboard
              </Link>
            </div>

            <div className="mt-4 space-y-3">
              {(invitations ?? []).length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                  No invitations created yet.
                </div>
              ) : (
                (invitations ?? []).map((invite) => {
                  const expired = new Date(invite.expires_at).getTime() < Date.now();
                  return (
                    <div key={invite.id} className="rounded-xl border border-slate-200 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-slate-900">{invite.email}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {invite.role} | {invite.status} | expires {new Date(invite.expires_at).toLocaleString()}
                          </p>
                          {expired && invite.status === "pending" ? (
                            <p className="mt-1 text-xs font-medium text-amber-700">Expired (pending status not yet swept)</p>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2">
                          {invite.status === "pending" ? (
                            <form action={revokeInvitation}>
                              <input type="hidden" name="inviteId" value={invite.id} />
                              <button
                                type="submit"
                                className="rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                              >
                                Revoke
                              </button>
                            </form>
                          ) : (
                            <span className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-500">
                              {invite.status}
                            </span>
                          )}
                        </div>
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

function Field({
  label,
  htmlFor,
  children
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-2 block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
    </div>
  );
}
