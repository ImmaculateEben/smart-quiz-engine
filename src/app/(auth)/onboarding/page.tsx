import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSessionAuthState } from "@/lib/auth/session";
import { hashInviteToken } from "@/lib/auth/invitations";
import { logAuditEvent } from "@/lib/audit/log";
import { setUsageCounterValue } from "@/lib/usage/limits";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formDataString, parseServerActionForm } from "@/lib/http/server-action-validation";

type OnboardingPageProps = {
  searchParams?: Promise<{
    mode?: string;
    status?: string;
    error?: string;
    token?: string;
  }>;
};

function slugifyInstitutionName(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

function buildOnboardingRedirect(params: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) search.set(key, value);
  });
  const qs = search.toString();
  return qs ? `/onboarding?${qs}` : "/onboarding";
}

const ownerBootstrapFormSchema = z.object({
  institutionName: z.string().trim().min(1).max(200),
  displayName: z.string().trim().max(200),
  institutionSlug: z.string().trim().max(80),
  planCode: z.enum(["starter", "growth", "enterprise"]),
  timezone: z.string().trim().min(1).max(100),
  locale: z.string().trim().min(1).max(50)
});

const acceptInviteFormSchema = z.object({
  inviteToken: z.string().trim().min(1).max(512),
  displayName: z.string().trim().max(200)
});

export default async function OnboardingPage({ searchParams }: OnboardingPageProps) {
  const params = (await searchParams) ?? {};
  const authState = await getSessionAuthState();
  const user = authState.user;
  const hasMembership = authState.memberships.length > 0 || authState.context?.platformRole === "super_admin";
  const mode = params.mode === "invite" ? "invite" : "owner";
  const tokenParam = typeof params.token === "string" ? params.token : "";
  const canBootstrapOwner = Boolean(user) && !hasMembership;
  const canAcceptInvite = Boolean(user);

  async function bootstrapOwner(formData: FormData) {
    "use server";

    const authState = await getSessionAuthState();
    if (!authState.user) {
      redirect(buildOnboardingRedirect({ mode: "owner", error: "not_authenticated" }));
    }

    if (authState.memberships.length > 0 || authState.context?.platformRole === "super_admin") {
      redirect("/admin");
    }

    const raw = {
      institutionName: formDataString(formData, "institutionName"),
      displayName: formDataString(formData, "displayName"),
      institutionSlug: formDataString(formData, "institutionSlug"),
      planCode: (formDataString(formData, "planCode") || "starter").toLowerCase(),
      timezone: formDataString(formData, "timezone") || "UTC",
      locale: formDataString(formData, "locale") || "en-US"
    };

    if (!raw.institutionName) {
      redirect(buildOnboardingRedirect({ mode: "owner", error: "missing_institution_name" }));
    }
    const parsedForm = parseServerActionForm(ownerBootstrapFormSchema, raw);
    if (!parsedForm.ok) {
      redirect(buildOnboardingRedirect({ mode: "owner", error: "invalid_input" }));
    }
    const { institutionName, displayName, institutionSlug: requestedSlug, planCode, timezone, locale } = parsedForm.data;

    const baseSlug = slugifyInstitutionName(requestedSlug || institutionName);
    if (!baseSlug) {
      redirect(buildOnboardingRedirect({ mode: "owner", error: "invalid_slug" }));
    }

    const admin = createSupabaseAdminClient();

    const { data: existingProfile } = await admin
      .from("user_profiles")
      .select("user_id")
      .eq("user_id", authState.user.id)
      .maybeSingle();

    if (!existingProfile) {
      const { error: profileInsertError } = await admin.from("user_profiles").insert({
        user_id: authState.user.id,
        display_name: displayName || null
      });

      if (profileInsertError) {
        redirect(buildOnboardingRedirect({ mode: "owner", error: "profile_create_failed" }));
      }
    } else if (displayName) {
      await admin
        .from("user_profiles")
        .update({ display_name: displayName })
        .eq("user_id", authState.user.id);
    }

    let slug = baseSlug;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
      const { data: conflict } = await admin
        .from("institutions")
        .select("id")
        .eq("slug", candidate)
        .maybeSingle();
      if (!conflict) {
        slug = candidate;
        break;
      }
      if (attempt === 9) {
        redirect(buildOnboardingRedirect({ mode: "owner", error: "slug_unavailable" }));
      }
    }

    const { data: institution, error: institutionError } = await admin
      .from("institutions")
      .insert({
        slug,
        name: institutionName,
        created_by: authState.user.id,
        timezone,
        locale
      })
      .select("id")
      .single();

    if (institutionError || !institution) {
      redirect(buildOnboardingRedirect({ mode: "owner", error: "institution_create_failed" }));
    }

    const { error: membershipError } = await admin.from("institution_admins").insert({
      institution_id: institution.id,
      user_id: authState.user.id,
      role: "owner",
      is_active: true,
      invited_at: new Date().toISOString(),
      accepted_at: new Date().toISOString()
    });

    if (membershipError) {
      redirect(buildOnboardingRedirect({ mode: "owner", error: "membership_create_failed" }));
    }

    try {
      await setUsageCounterValue({
        institutionId: institution.id,
        metricKey: "admins_active",
        value: 1,
        metadata: { source: "owner_bootstrap" }
      });
    } catch {
      // Non-blocking in scaffold stage.
    }

    const { data: plan } = await admin
      .from("plan_limits")
      .select("id, code")
      .eq("code", planCode)
      .eq("is_active", true)
      .maybeSingle();

    if (plan?.id) {
      await admin.from("institution_plans").upsert(
        {
          institution_id: institution.id,
          plan_id: plan.id,
          metadata: { source: "onboarding.owner_bootstrap", plan_code: plan.code }
        },
        { onConflict: "institution_id" }
      );
    }

    redirect("/admin");
  }

  async function acceptInvite(formData: FormData) {
    "use server";

    const authState = await getSessionAuthState();
    if (!authState.user) {
      redirect(buildOnboardingRedirect({ mode: "invite", error: "not_authenticated" }));
    }

    const raw = {
      inviteToken: formDataString(formData, "inviteToken"),
      displayName: formDataString(formData, "displayName")
    };

    if (!raw.inviteToken) {
      redirect(buildOnboardingRedirect({ mode: "invite", error: "missing_invite_token" }));
    }
    const parsedForm = parseServerActionForm(acceptInviteFormSchema, raw);
    if (!parsedForm.ok) redirect(buildOnboardingRedirect({ mode: "invite", error: "invalid_input" }));
    const { inviteToken: rawToken, displayName } = parsedForm.data;

    const tokenHash = hashInviteToken(rawToken);
    const admin = createSupabaseAdminClient();

    const { data: invite } = await admin
      .from("admin_invitations")
      .select("id, institution_id, email, role, status, expires_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (!invite) {
      redirect(buildOnboardingRedirect({ mode: "invite", error: "invite_not_found" }));
    }

    if (invite.status !== "pending") {
      redirect(buildOnboardingRedirect({ mode: "invite", error: "invite_not_pending" }));
    }

    if (new Date(invite.expires_at).getTime() < Date.now()) {
      redirect(buildOnboardingRedirect({ mode: "invite", error: "invite_expired" }));
    }

    const userEmail = authState.user.email?.toLowerCase();
    if (!userEmail || userEmail !== String(invite.email).toLowerCase()) {
      redirect(buildOnboardingRedirect({ mode: "invite", error: "invite_email_mismatch" }));
    }

    const { data: existingProfile } = await admin
      .from("user_profiles")
      .select("user_id")
      .eq("user_id", authState.user.id)
      .maybeSingle();

    if (!existingProfile) {
      const { error: profileInsertError } = await admin.from("user_profiles").insert({
        user_id: authState.user.id,
        display_name: displayName || null
      });
      if (profileInsertError) {
        redirect(buildOnboardingRedirect({ mode: "invite", error: "profile_create_failed" }));
      }
    } else if (displayName) {
      await admin
        .from("user_profiles")
        .update({ display_name: displayName })
        .eq("user_id", authState.user.id);
    }

    const now = new Date().toISOString();
    const { error: adminMembershipError } = await admin.from("institution_admins").upsert(
      {
        institution_id: invite.institution_id,
        user_id: authState.user.id,
        role: invite.role,
        is_active: true,
        invited_at: now,
        accepted_at: now
      },
      { onConflict: "institution_id,user_id" }
    );

    if (adminMembershipError) {
      redirect(buildOnboardingRedirect({ mode: "invite", error: "membership_create_failed" }));
    }

    const { error: inviteUpdateError } = await admin
      .from("admin_invitations")
      .update({ status: "accepted" })
      .eq("id", invite.id);

    if (inviteUpdateError) {
      redirect(buildOnboardingRedirect({ mode: "invite", error: "invite_update_failed" }));
    }

    try {
      const { count } = await admin
        .from("institution_admins")
        .select("*", { count: "exact", head: true })
        .eq("institution_id", invite.institution_id)
        .eq("is_active", true);
      await setUsageCounterValue({
        institutionId: invite.institution_id,
        metricKey: "admins_active",
        value: count ?? 0,
        metadata: { source: "invite_acceptance" }
      });
    } catch {
      // Non-blocking in scaffold stage.
    }

    try {
      await logAuditEvent({
        institutionId: invite.institution_id,
        action: "admin.invite",
        entityType: "admin_invitations",
        entityId: invite.id,
        metadata: {
          operation: "accept_invitation",
          invited_email: invite.email,
          role: invite.role
        }
      });
    } catch {
      // Non-blocking in scaffold stage.
    }

    redirect("/admin");
  }

  const errorCopy: Record<string, string> = {
    not_authenticated: "Sign in before using onboarding.",
    missing_institution_name: "Institution name is required.",
    invalid_input: "One or more onboarding fields are invalid.",
    invalid_slug: "Institution slug is invalid. Use letters and numbers.",
    slug_unavailable: "Unable to reserve a unique institution slug. Try a different one.",
    profile_create_failed: "Could not create or update your user profile.",
    institution_create_failed: "Institution creation failed.",
    membership_create_failed: "Could not attach your admin membership.",
    missing_invite_token: "Invite token is required.",
    invite_not_found: "Invite token not found.",
    invite_not_pending: "This invite has already been used or is no longer active.",
    invite_expired: "This invite has expired.",
    invite_email_mismatch: "Invite email does not match your signed-in account.",
    invite_update_failed: "Membership was created but invite status could not be updated."
  };

  return (
    <main className="mx-auto max-w-5xl px-6 pb-16">
      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Clavis Setup</p>
            <h1 className="mt-3 text-2xl font-semibold text-slate-900">Institution Onboarding</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Complete first-time owner bootstrap or accept an admin invite. Both flows use privileged server actions
              because bootstrap and invite acceptance need writes before tenant RLS membership is established.
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
            <p className="text-slate-500">Auth state</p>
            <p className="font-medium text-slate-900">{user?.email ?? "Not signed in"}</p>
          </div>
        </div>

        {params.error ? (
          <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {errorCopy[params.error] ?? "Unable to complete onboarding."}
          </div>
        ) : null}

        {params.status === "ready" ? (
          <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Onboarding completed. Continue to the admin dashboard.
          </div>
        ) : null}

        {hasMembership ? (
          <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
            <h2 className="text-lg font-semibold text-emerald-950">Tenant access already configured</h2>
            <p className="mt-2 text-sm text-emerald-900">
              Your account already has platform or institution access. Continue to the admin workspace.
            </p>
            <div className="mt-4">
              <Link
                href="/admin"
                className="inline-flex rounded-xl bg-emerald-900 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
              >
                Open admin dashboard
              </Link>
            </div>
          </div>
        ) : null}

        <div className="mt-8 flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
          <Link
            href="/onboarding?mode=owner"
            className={`rounded-lg px-4 py-2 text-sm font-medium ${
              mode === "owner" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Owner bootstrap
          </Link>
          <Link
            href="/onboarding?mode=invite"
            className={`rounded-lg px-4 py-2 text-sm font-medium ${
              mode === "invite" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Accept invite
          </Link>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section className={`rounded-2xl border p-6 ${mode === "owner" ? "border-slate-300 bg-white" : "border-slate-200 bg-slate-50/70"}`}>
            <h2 className="text-lg font-semibold text-slate-900">Owner bootstrap</h2>
            <p className="mt-2 text-sm text-slate-600">
              Creates the first institution, assigns you as <code>owner</code>, and attaches a starter plan.
            </p>
            <form action={bootstrapOwner} className="mt-5 space-y-4">
              <Field label="Institution name" htmlFor="institutionName">
                <input
                  id="institutionName"
                  name="institutionName"
                  required
                  placeholder="Acme Training Institute"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:border-blue-500 focus:outline-none"
                />
              </Field>

              <Field label="Institution slug (optional)" htmlFor="institutionSlug">
                <input
                  id="institutionSlug"
                  name="institutionSlug"
                  placeholder="acme-training"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:border-blue-500 focus:outline-none"
                />
              </Field>

              <Field label="Your display name (optional)" htmlFor="ownerDisplayName">
                <input
                  id="ownerDisplayName"
                  name="displayName"
                  placeholder="Jane Doe"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:border-blue-500 focus:outline-none"
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Timezone" htmlFor="timezone">
                  <input
                    id="timezone"
                    name="timezone"
                    defaultValue="UTC"
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </Field>
                <Field label="Locale" htmlFor="locale">
                  <input
                    id="locale"
                    name="locale"
                    defaultValue="en-US"
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </Field>
              </div>

              <Field label="Initial plan profile" htmlFor="planCode">
                <select
                  id="planCode"
                  name="planCode"
                  defaultValue="starter"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="starter">Starter</option>
                  <option value="growth">Growth</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </Field>

              <button
                type="submit"
                disabled={!canBootstrapOwner}
                className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Create institution and continue
              </button>
            </form>
          </section>

          <section className={`rounded-2xl border p-6 ${mode === "invite" ? "border-slate-300 bg-white" : "border-slate-200 bg-slate-50/70"}`}>
            <h2 className="text-lg font-semibold text-slate-900">Accept admin invite</h2>
            <p className="mt-2 text-sm text-slate-600">
              Validates the invite token hash, confirms email match, activates your membership, and marks the invite
              as accepted.
            </p>
            <form action={acceptInvite} className="mt-5 space-y-4">
              <Field label="Invite token" htmlFor="inviteToken">
                <input
                  id="inviteToken"
                  name="inviteToken"
                  required
                  defaultValue={tokenParam}
                  placeholder="Paste invite token"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:border-blue-500 focus:outline-none"
                />
              </Field>

              <Field label="Your display name (optional)" htmlFor="inviteDisplayName">
                <input
                  id="inviteDisplayName"
                  name="displayName"
                  placeholder="Jane Doe"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:border-blue-500 focus:outline-none"
                />
              </Field>

              <button
                type="submit"
                disabled={!canAcceptInvite}
                className="w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-900 ring-1 ring-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Accept invitation
              </button>
            </form>
          </section>
        </div>

        <div className="mt-8 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          Requires <code>NEXT_PUBLIC_SUPABASE_URL</code>, <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, and{" "}
          <code>SUPABASE_SERVICE_ROLE_KEY</code> to be configured.
        </div>
      </div>
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
