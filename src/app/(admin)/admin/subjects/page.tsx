import type { Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSessionAuthState } from "@/lib/auth/session";
import { hasInstitutionRole } from "@/lib/auth/rbac";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formDataString, parseServerActionForm, zFormBooleanString } from "@/lib/http/server-action-validation";

type SubjectsPageProps = {
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
  return (qs ? `/admin/subjects?${qs}` : "/admin/subjects") as Route;
}

function parseSettingsJson(raw: string) {
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Settings JSON must be an object");
  }
  return parsed as Record<string, unknown>;
}

const subjectIdFormSchema = z.object({
  subjectId: z.string().trim().min(1).max(128)
});

const createSubjectFormSchema = z.object({
  name: z.string().trim().min(1).max(200),
  code: z.string().trim().max(64),
  settingsJson: z.string().max(20_000),
  isActive: zFormBooleanString
});

const updateSubjectFormSchema = createSubjectFormSchema.extend({
  subjectId: z.string().trim().min(1).max(128)
});

export default async function SubjectsPage({ searchParams }: SubjectsPageProps) {
  const params = (await searchParams) ?? {};
  const authState = await getSessionAuthState();

  if (!authState.user) {
    redirect("/login?next=/admin/subjects");
  }

  const writableMembership =
    authState.memberships.find((m) => ["owner", "admin", "editor"].includes(m.role)) ?? null;
  const canManageSubjects =
    Boolean(authState.context && hasInstitutionRole(authState.context, ["owner", "admin", "editor"])) ||
    Boolean(writableMembership);

  if (!writableMembership || !canManageSubjects) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-6">
          <h1 className="text-xl font-semibold text-rose-950">Insufficient permissions</h1>
          <p className="mt-2 text-sm text-rose-900">
            Subject management requires <code>owner</code>, <code>admin</code>, or <code>editor</code>.
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

  const [{ data: subjects }, { data: questions }] = await Promise.all([
    supabase
      .from("subjects")
      .select("id, code, name, settings, is_active, deleted_at, created_at, updated_at")
      .eq("institution_id", institutionId)
      .order("deleted_at", { ascending: true, nullsFirst: true })
      .order("name", { ascending: true }),
    supabase
      .from("questions")
      .select("id, subject_id, deleted_at")
      .eq("institution_id", institutionId)
  ]);

  const counts = new Map<string, { total: number; active: number }>();
  for (const q of (questions ?? []) as Array<{ subject_id: string; deleted_at: string | null }>) {
    const current = counts.get(q.subject_id) ?? { total: 0, active: 0 };
    current.total += 1;
    if (!q.deleted_at) current.active += 1;
    counts.set(q.subject_id, current);
  }

  async function createSubject(formData: FormData) {
    "use server";

    const authState = await getSessionAuthState();
    const membership =
      authState.memberships.find((m) => ["owner", "admin", "editor"].includes(m.role)) ?? null;
    const canManage =
      Boolean(authState.context && hasInstitutionRole(authState.context, ["owner", "admin", "editor"])) ||
      Boolean(membership);

    if (!authState.user || !membership || !canManage) {
      redirect(buildRedirect({ error: "forbidden" }));
    }

    const raw = {
      name: formDataString(formData, "name"),
      code: formDataString(formData, "code"),
      settingsJson: formDataString(formData, "settingsJson"),
      isActive: formDataString(formData, "isActive") || "true"
    };

    if (!raw.name) {
      redirect(buildRedirect({ error: "missing_name" }));
    }

    const parsedForm = parseServerActionForm(createSubjectFormSchema, raw);
    if (!parsedForm.ok) {
      redirect(buildRedirect({ error: "invalid_input" }));
    }

    const { name, code, settingsJson, isActive } = parsedForm.data;

    let settings: Record<string, unknown> = {};
    try {
      settings = parseSettingsJson(settingsJson);
    } catch {
      redirect(buildRedirect({ error: "invalid_settings_json" }));
    }

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("subjects").insert({
      institution_id: membership.institutionId,
      code: code || null,
      name,
      settings,
      is_active: isActive,
      created_by: authState.user.id
    });

    if (error) {
      if (String(error.message).toLowerCase().includes("unique")) {
        redirect(buildRedirect({ error: "duplicate_name" }));
      }
      redirect(buildRedirect({ error: "create_failed" }));
    }

    redirect(buildRedirect({ status: "created" }));
  }

  async function updateSubject(formData: FormData) {
    "use server";

    const authState = await getSessionAuthState();
    const membership =
      authState.memberships.find((m) => ["owner", "admin", "editor"].includes(m.role)) ?? null;
    const canManage =
      Boolean(authState.context && hasInstitutionRole(authState.context, ["owner", "admin", "editor"])) ||
      Boolean(membership);

    if (!authState.user || !membership || !canManage) {
      redirect(buildRedirect({ error: "forbidden" }));
    }

    const raw = {
      subjectId: formDataString(formData, "subjectId"),
      name: formDataString(formData, "name"),
      code: formDataString(formData, "code"),
      settingsJson: formDataString(formData, "settingsJson"),
      isActive: formDataString(formData, "isActive") || "false"
    };

    if (!raw.subjectId) redirect(buildRedirect({ error: "missing_subject_id" }));
    if (!raw.name) redirect(buildRedirect({ error: "missing_name" }));

    const parsedForm = parseServerActionForm(updateSubjectFormSchema, raw);
    if (!parsedForm.ok) {
      redirect(buildRedirect({ error: "invalid_input" }));
    }

    const { subjectId, name, code, settingsJson, isActive } = parsedForm.data;

    let settings: Record<string, unknown> = {};
    try {
      settings = parseSettingsJson(settingsJson);
    } catch {
      redirect(buildRedirect({ error: "invalid_settings_json" }));
    }

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("subjects")
      .update({
        name,
        code: code || null,
        settings,
        is_active: isActive
      })
      .eq("id", subjectId)
      .eq("institution_id", membership.institutionId);

    if (error) {
      if (String(error.message).toLowerCase().includes("unique")) {
        redirect(buildRedirect({ error: "duplicate_name" }));
      }
      redirect(buildRedirect({ error: "update_failed" }));
    }

    redirect(buildRedirect({ status: "updated" }));
  }

  async function softDeleteSubject(formData: FormData) {
    "use server";

    const authState = await getSessionAuthState();
    const membership =
      authState.memberships.find((m) => ["owner", "admin", "editor"].includes(m.role)) ?? null;
    const canManage =
      Boolean(authState.context && hasInstitutionRole(authState.context, ["owner", "admin", "editor"])) ||
      Boolean(membership);

    if (!authState.user || !membership || !canManage) {
      redirect(buildRedirect({ error: "forbidden" }));
    }

    const raw = { subjectId: formDataString(formData, "subjectId") };
    if (!raw.subjectId) redirect(buildRedirect({ error: "missing_subject_id" }));
    const parsedForm = parseServerActionForm(subjectIdFormSchema, raw);
    if (!parsedForm.ok) redirect(buildRedirect({ error: "invalid_input" }));
    const { subjectId } = parsedForm.data;

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("subjects")
      .update({
        deleted_at: new Date().toISOString(),
        is_active: false
      })
      .eq("id", subjectId)
      .eq("institution_id", membership.institutionId);

    if (error) {
      redirect(buildRedirect({ error: "delete_failed" }));
    }

    redirect(buildRedirect({ status: "deleted" }));
  }

  async function restoreSubject(formData: FormData) {
    "use server";

    const authState = await getSessionAuthState();
    const membership =
      authState.memberships.find((m) => ["owner", "admin", "editor"].includes(m.role)) ?? null;
    const canManage =
      Boolean(authState.context && hasInstitutionRole(authState.context, ["owner", "admin", "editor"])) ||
      Boolean(membership);

    if (!authState.user || !membership || !canManage) {
      redirect(buildRedirect({ error: "forbidden" }));
    }

    const raw = { subjectId: formDataString(formData, "subjectId") };
    if (!raw.subjectId) redirect(buildRedirect({ error: "missing_subject_id" }));
    const parsedForm = parseServerActionForm(subjectIdFormSchema, raw);
    if (!parsedForm.ok) redirect(buildRedirect({ error: "invalid_input" }));
    const { subjectId } = parsedForm.data;

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("subjects")
      .update({
        deleted_at: null
      })
      .eq("id", subjectId)
      .eq("institution_id", membership.institutionId);

    if (error) {
      redirect(buildRedirect({ error: "restore_failed" }));
    }

    redirect(buildRedirect({ status: "restored" }));
  }

  const errorMessages: Record<string, string> = {
    forbidden: "You do not have permission to manage subjects.",
    missing_subject_id: "Subject ID is missing.",
    missing_name: "Subject name is required.",
    invalid_input: "One or more subject form fields are invalid.",
    invalid_settings_json: "Settings JSON must be a valid JSON object.",
    duplicate_name: "A subject with this name already exists in the institution.",
    create_failed: "Failed to create subject.",
    update_failed: "Failed to update subject.",
    delete_failed: "Failed to soft delete subject.",
    restore_failed: "Failed to restore subject."
  };

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Subject Management</p>
            <h1 className="mt-3 text-2xl font-semibold text-slate-900">Subjects</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Phase 3.1 subject CRUD with soft delete/restore, subject settings editing, and question count tracking.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
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
            {errorMessages[params.error] ?? "Subject action failed."}
          </div>
        ) : null}

        {params.status ? (
          <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            {params.status === "created" && "Subject created."}
            {params.status === "updated" && "Subject updated."}
            {params.status === "deleted" && "Subject soft deleted."}
            {params.status === "restored" && "Subject restored."}
          </div>
        ) : null}

        <section className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="text-lg font-semibold text-slate-900">Create subject</h2>
          <form action={createSubject} className="mt-4 grid gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Subject name" htmlFor="create-name">
                <input
                  id="create-name"
                  name="name"
                  required
                  placeholder="Mathematics"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:border-blue-500 focus:outline-none"
                />
              </Field>
              <Field label="Code (optional)" htmlFor="create-code">
                <input
                  id="create-code"
                  name="code"
                  placeholder="MTH101"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:border-blue-500 focus:outline-none"
                />
              </Field>
            </div>
            <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
              <Field label="Settings JSON" htmlFor="create-settings">
                <textarea
                  id="create-settings"
                  name="settingsJson"
                  rows={4}
                  defaultValue={"{}"}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-mono text-xs focus:border-blue-500 focus:outline-none"
                />
              </Field>
              <Field label="Active" htmlFor="create-active">
                <select
                  id="create-active"
                  name="isActive"
                  defaultValue="true"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
              </Field>
            </div>
            <button
              type="submit"
              className="justify-self-start rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Create subject
            </button>
          </form>
        </section>

        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">Subject list</h2>
            <p className="text-sm text-slate-500">{(subjects ?? []).length} subjects</p>
          </div>
          <div className="mt-4 space-y-4">
            {(subjects ?? []).length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                No subjects created yet.
              </div>
            ) : (
              (subjects ?? []).map((subject) => {
                const qc = counts.get(subject.id) ?? { total: 0, active: 0 };
                const isDeleted = Boolean(subject.deleted_at);
                return (
                  <div key={subject.id} className="rounded-xl border border-slate-200 p-4">
                    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-slate-900">{subject.name}</p>
                          {subject.code ? (
                            <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                              {subject.code}
                            </span>
                          ) : null}
                          <span
                            className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                              isDeleted
                                ? "border-rose-200 bg-rose-50 text-rose-700"
                                : subject.is_active
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-amber-200 bg-amber-50 text-amber-700"
                            }`}
                          >
                            {isDeleted ? "deleted" : subject.is_active ? "active" : "inactive"}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          Questions: {qc.active} active / {qc.total} total
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {isDeleted ? (
                          <form action={restoreSubject}>
                            <input type="hidden" name="subjectId" value={subject.id} />
                            <button
                              type="submit"
                              className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                            >
                              Restore
                            </button>
                          </form>
                        ) : (
                          <form action={softDeleteSubject}>
                            <input type="hidden" name="subjectId" value={subject.id} />
                            <button
                              type="submit"
                              className="rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                            >
                              Soft delete
                            </button>
                          </form>
                        )}
                      </div>
                    </div>

                    <form action={updateSubject} className="grid gap-4">
                      <input type="hidden" name="subjectId" value={subject.id} />
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Name" htmlFor={`name-${subject.id}`}>
                          <input
                            id={`name-${subject.id}`}
                            name="name"
                            required
                            defaultValue={subject.name}
                            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:border-blue-500 focus:outline-none"
                          />
                        </Field>
                        <Field label="Code (optional)" htmlFor={`code-${subject.id}`}>
                          <input
                            id={`code-${subject.id}`}
                            name="code"
                            defaultValue={subject.code ?? ""}
                            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:border-blue-500 focus:outline-none"
                          />
                        </Field>
                      </div>
                      <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
                        <Field label="Settings JSON" htmlFor={`settings-${subject.id}`}>
                          <textarea
                            id={`settings-${subject.id}`}
                            name="settingsJson"
                            rows={5}
                            defaultValue={JSON.stringify(subject.settings ?? {}, null, 2)}
                            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-mono text-xs focus:border-blue-500 focus:outline-none"
                          />
                        </Field>
                        <Field label="Active" htmlFor={`active-${subject.id}`}>
                          <select
                            id={`active-${subject.id}`}
                            name="isActive"
                            defaultValue={subject.is_active ? "true" : "false"}
                            disabled={isDeleted}
                            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:border-blue-500 focus:outline-none disabled:opacity-60"
                          >
                            <option value="true">Active</option>
                            <option value="false">Inactive</option>
                          </select>
                        </Field>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-xs text-slate-500">
                          Updated {new Date(subject.updated_at).toLocaleString()}
                        </p>
                        <button
                          type="submit"
                          disabled={isDeleted}
                          className="rounded-xl border border-blue-300 bg-white px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Save subject
                        </button>
                      </div>
                    </form>
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
