import type { Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSessionAuthState } from "@/lib/auth/session";
import { hasInstitutionRole } from "@/lib/auth/rbac";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/log";
import { formDataString, parseServerActionForm } from "@/lib/http/server-action-validation";

type SettingsPageProps = {
  searchParams?: Promise<{
    status?: string;
    error?: string;
  }>;
};

function buildRedirect(params: Record<string, string | undefined>): Route {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const qs = search.toString();
  return (qs ? `/admin/settings?${qs}` : "/admin/settings") as Route;
}

const settingsFormSchema = z.object({
  name: z.string().trim().min(1).max(200),
  logoUrl: z.string().trim().max(500),
  timezone: z.string().trim().min(1).max(100),
  locale: z.string().trim().min(1).max(50),
  settingsJson: z.string().max(20_000)
});

export default async function InstitutionSettingsPage({ searchParams }: SettingsPageProps) {
  const params = (await searchParams) ?? {};
  const authState = await getSessionAuthState();

  if (!authState.user) {
    redirect("/login?next=/admin/settings");
  }

  const writableMembership =
    authState.memberships.find((membership) => ["owner", "admin"].includes(membership.role)) ?? null;
  const canManageSettings =
    (authState.context && hasInstitutionRole(authState.context, ["owner", "admin"])) ||
    Boolean(writableMembership);

  if (!writableMembership || !canManageSettings) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-6">
          <h1 className="text-xl font-semibold text-rose-950">Insufficient permissions</h1>
          <p className="mt-2 text-sm text-rose-900">
            Institution settings require an <code>owner</code> or <code>admin</code> role.
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
  const { data: institution, error: institutionError } = await supabase
    .from("institutions")
    .select("id, slug, name, status, logo_url, timezone, locale, settings, updated_at")
    .eq("id", writableMembership.institutionId)
    .single();

  if (institutionError || !institution) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-6">
          <h1 className="text-xl font-semibold text-rose-950">Institution not found</h1>
          <p className="mt-2 text-sm text-rose-900">
            Could not load institution settings for your current membership.
          </p>
        </section>
      </main>
    );
  }

  async function saveSettings(formData: FormData) {
    "use server";

    const authState = await getSessionAuthState();
    const membership =
      authState.memberships.find((item) => ["owner", "admin"].includes(item.role)) ?? null;
    const canManageSettings =
      (authState.context && hasInstitutionRole(authState.context, ["owner", "admin"])) ||
      Boolean(membership);

    if (!authState.user || !membership || !canManageSettings) {
      redirect(buildRedirect({ error: "forbidden" }));
    }

    const raw = {
      name: formDataString(formData, "name"),
      logoUrl: formDataString(formData, "logoUrl"),
      timezone: formDataString(formData, "timezone") || "UTC",
      locale: formDataString(formData, "locale") || "en-US",
      settingsJson: formDataString(formData, "settingsJson")
    };

    if (!raw.name) {
      redirect(buildRedirect({ error: "missing_name" }));
    }

    const parsedForm = parseServerActionForm(settingsFormSchema, raw);
    if (!parsedForm.ok) {
      redirect(buildRedirect({ error: "invalid_input" }));
    }

    const { name, logoUrl, timezone, locale, settingsJson: settingsText } = parsedForm.data;

    let parsedSettings: Record<string, unknown> = {};
    if (settingsText) {
      try {
        const value = JSON.parse(settingsText);
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          redirect(buildRedirect({ error: "invalid_settings_json" }));
        }
        parsedSettings = value as Record<string, unknown>;
      } catch {
        redirect(buildRedirect({ error: "invalid_settings_json" }));
      }
    }

    const supabase = await createSupabaseServerClient();
    const { data: before } = await supabase
      .from("institutions")
      .select("name, logo_url, timezone, locale, settings")
      .eq("id", membership.institutionId)
      .single();

    const { error } = await supabase
      .from("institutions")
      .update({
        name,
        logo_url: logoUrl || null,
        timezone,
        locale,
        settings: parsedSettings
      })
      .eq("id", membership.institutionId);

    if (error) {
      redirect(buildRedirect({ error: "save_failed" }));
    }

    try {
      await logAuditEvent({
        institutionId: membership.institutionId,
        action: "institution.settings_update",
        entityType: "institutions",
        entityId: membership.institutionId,
        metadata: {
          changed_fields: {
            name: before?.name !== name,
            logo_url: (before?.logo_url ?? null) !== (logoUrl || null),
            timezone: before?.timezone !== timezone,
            locale: before?.locale !== locale,
            settings: JSON.stringify(before?.settings ?? {}) !== JSON.stringify(parsedSettings)
          }
        }
      });
    } catch {
      // Non-blocking while scaffold matures.
    }

    redirect(buildRedirect({ status: "saved" }));
  }

  const errorMessages: Record<string, string> = {
    forbidden: "You do not have permission to update institution settings.",
    missing_name: "Institution name is required.",
    invalid_input: "One or more settings fields are invalid.",
    invalid_settings_json: "Settings JSON must be a valid JSON object.",
    save_failed: "Failed to save institution settings."
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Institution Settings</p>
            <h1 className="mt-3 text-2xl font-semibold text-slate-900">{institution.name}</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Tenant-scoped settings editor for institution profile data. Updates are written through RLS and logged to
              audit.
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
            <p className="text-slate-500">Context</p>
            <p className="font-semibold text-slate-900">{institution.slug}</p>
            <p className="text-xs text-slate-500">
              {institution.status} | {writableMembership.role}
            </p>
          </div>
        </div>

        {params.error ? (
          <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {errorMessages[params.error] ?? "Unable to update settings."}
          </div>
        ) : null}

        {params.status === "saved" ? (
          <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            Institution settings saved.
          </div>
        ) : null}

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
            <h2 className="text-lg font-semibold text-slate-900">Profile</h2>
            <form action={saveSettings} className="mt-4 space-y-4">
              <Field label="Institution name" htmlFor="name">
                <input
                  id="name"
                  name="name"
                  required
                  defaultValue={institution.name}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:border-blue-500 focus:outline-none"
                />
              </Field>

              <Field label="Logo URL (optional)" htmlFor="logoUrl">
                <input
                  id="logoUrl"
                  name="logoUrl"
                  type="url"
                  defaultValue={institution.logo_url ?? ""}
                  placeholder="https://cdn.example.com/logo.png"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:border-blue-500 focus:outline-none"
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Timezone" htmlFor="timezone">
                  <input
                    id="timezone"
                    name="timezone"
                    defaultValue={institution.timezone ?? "UTC"}
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </Field>
                <Field label="Locale" htmlFor="locale">
                  <input
                    id="locale"
                    name="locale"
                    defaultValue={institution.locale ?? "en-US"}
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </Field>
              </div>

              <Field label="Settings JSON" htmlFor="settingsJson">
                <textarea
                  id="settingsJson"
                  name="settingsJson"
                  rows={12}
                  defaultValue={JSON.stringify(institution.settings ?? {}, null, 2)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-mono text-xs focus:border-blue-500 focus:outline-none"
                />
              </Field>

              <button
                type="submit"
                className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Save settings
              </button>
            </form>
          </section>

          <aside className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="text-lg font-semibold text-slate-900">Metadata</h2>
              <dl className="mt-4 space-y-3 text-sm">
                <div>
                  <dt className="text-slate-500">Institution ID</dt>
                  <dd className="font-mono text-xs text-slate-800">{institution.id}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Slug</dt>
                  <dd className="text-slate-900">{institution.slug}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Status</dt>
                  <dd className="text-slate-900">{institution.status}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Updated at</dt>
                  <dd className="text-slate-900">{new Date(institution.updated_at).toLocaleString()}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="text-lg font-semibold text-slate-900">Next institution management work</h2>
              <ul className="mt-4 space-y-2 text-sm text-slate-600">
                <li>Logo upload to Supabase Storage and `file_assets` tracking.</li>
                <li>Institution CRUD for super admins.</li>
                <li>Timezone/locale validation and curated selectors.</li>
                <li>Branding settings schema validation.</li>
              </ul>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <Link
                href="/admin"
                className="inline-flex rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Back to dashboard
              </Link>
            </div>
          </aside>
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
