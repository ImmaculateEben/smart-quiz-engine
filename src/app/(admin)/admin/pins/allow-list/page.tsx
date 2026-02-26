import type { Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSessionAuthState } from "@/lib/auth/session";
import { hasInstitutionRole } from "@/lib/auth/rbac";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formDataString, parseServerActionForm } from "@/lib/http/server-action-validation";

type PageProps = { searchParams?: Promise<Record<string, string | undefined>> };

function route(params: Record<string, string | undefined>): Route {
  const s = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v && s.set(k, v));
  const q = s.toString();
  return (q ? `/admin/pins/allow-list?${q}` : "/admin/pins/allow-list") as Route;
}

function parseIdentifiers(input: string) {
  return [...new Set(input.split(/[\r\n,;]+/).map((v) => v.trim()).filter(Boolean))];
}

const pinIdFormSchema = z.object({
  pinId: z.string().trim().min(1).max(128)
});

const addManualAllowListFormSchema = pinIdFormSchema.extend({
  candidateIdentifier: z.string().trim().min(1).max(320)
});

const importAllowListFormSchema = pinIdFormSchema.extend({
  csvIdentifiers: z.string().max(200_000)
});

const removeAllowListEntryFormSchema = pinIdFormSchema.extend({
  entryId: z.string().trim().min(1).max(128)
});

export default async function PinAllowListPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const auth = await getSessionAuthState();
  if (!auth.user) redirect("/login?next=/admin/pins/allow-list");
  const membership = auth.memberships.find((m) => ["owner", "admin"].includes(m.role)) ?? null;
  const canManage = Boolean(auth.context && hasInstitutionRole(auth.context, ["owner", "admin"])) || Boolean(membership);
  if (!membership || !canManage) return <main className="mx-auto max-w-4xl px-6 py-10 text-sm">Insufficient permissions.</main>;

  const supabase = await createSupabaseServerClient();
  const institutionId = membership.institutionId;
  const selectedPinId = sp.pinId ?? "";
  const [pinsRes, allowListRes] = await Promise.all([
    supabase
      .from("exam_pins")
      .select("id,pin_hint,status,exam_id,allow_list_enabled,created_at")
      .eq("institution_id", institutionId)
      .order("created_at", { ascending: false })
      .limit(200),
    selectedPinId
      ? supabase
          .from("pin_allow_list")
          .select("id,exam_pin_id,candidate_identifier,created_at")
          .eq("institution_id", institutionId)
          .eq("exam_pin_id", selectedPinId)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as Array<{ id: string; exam_pin_id: string; candidate_identifier: string; created_at: string }> })
  ]);

  async function addManual(formData: FormData) {
    "use server";
    const auth = await getSessionAuthState();
    const membership = auth.memberships.find((m) => ["owner", "admin"].includes(m.role)) ?? null;
    if (!auth.user || !membership) redirect(route({ error: "forbidden" }));
    const raw = {
      pinId: formDataString(formData, "pinId"),
      candidateIdentifier: formDataString(formData, "candidateIdentifier")
    };
    const parsedForm = parseServerActionForm(addManualAllowListFormSchema, raw);
    if (!parsedForm.ok) redirect(route({ error: "invalid_input", pinId: raw.pinId }));
    const { pinId, candidateIdentifier: identifier } = parsedForm.data;
    const supabase = await createSupabaseServerClient();
    await supabase.from("exam_pins").update({ allow_list_enabled: true }).eq("id", pinId).eq("institution_id", membership.institutionId);
    const { error } = await supabase.from("pin_allow_list").insert({
      institution_id: membership.institutionId,
      exam_pin_id: pinId,
      candidate_identifier: identifier
    });
    if (error) redirect(route({ error: String(error.message).toLowerCase().includes("unique") ? "duplicate_identifier" : "add_failed", pinId }));
    redirect(route({ status: "added", pinId }));
  }

  async function importCsv(formData: FormData) {
    "use server";
    const auth = await getSessionAuthState();
    const membership = auth.memberships.find((m) => ["owner", "admin"].includes(m.role)) ?? null;
    if (!auth.user || !membership) redirect(route({ error: "forbidden" }));
    const raw = {
      pinId: formDataString(formData, "pinId"),
      csvIdentifiers: formDataString(formData, "csvIdentifiers")
    };
    const parsedForm = parseServerActionForm(importAllowListFormSchema, raw);
    if (!parsedForm.ok) redirect(route({ error: "invalid_input", pinId: raw.pinId }));
    const { pinId, csvIdentifiers } = parsedForm.data;
    const identifiers = parseIdentifiers(csvIdentifiers).filter((v) => v.length <= 320).slice(0, 10_000);
    if (identifiers.length === 0) redirect(route({ error: "invalid_input", pinId }));
    const supabase = await createSupabaseServerClient();
    await supabase.from("exam_pins").update({ allow_list_enabled: true }).eq("id", pinId).eq("institution_id", membership.institutionId);
    const rows = identifiers.map((candidate_identifier) => ({
      institution_id: membership.institutionId,
      exam_pin_id: pinId,
      candidate_identifier
    }));
    const { error } = await supabase.from("pin_allow_list").upsert(rows, { onConflict: "exam_pin_id,candidate_identifier", ignoreDuplicates: true });
    if (error) redirect(route({ error: "import_failed", pinId }));
    redirect(route({ status: "imported", pinId }));
  }

  async function removeEntry(formData: FormData) {
    "use server";
    const auth = await getSessionAuthState();
    const membership = auth.memberships.find((m) => ["owner", "admin"].includes(m.role)) ?? null;
    if (!auth.user || !membership) redirect(route({ error: "forbidden" }));
    const raw = {
      pinId: formDataString(formData, "pinId"),
      entryId: formDataString(formData, "entryId")
    };
    const parsedForm = parseServerActionForm(removeAllowListEntryFormSchema, raw);
    if (!parsedForm.ok) redirect(route({ error: "invalid_input", pinId: raw.pinId }));
    const { pinId, entryId } = parsedForm.data;
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("pin_allow_list")
      .delete()
      .eq("id", entryId)
      .eq("exam_pin_id", pinId)
      .eq("institution_id", membership.institutionId);
    if (error) redirect(route({ error: "remove_failed", pinId }));
    redirect(route({ status: "removed", pinId }));
  }

  const errorCopy: Record<string, string> = {
    forbidden: "You do not have permission to manage allow lists.",
    invalid_input: "Select a PIN and provide one or more candidate identifiers.",
    duplicate_identifier: "Identifier already exists for this PIN.",
    add_failed: "Failed to add allow-list entry.",
    import_failed: "Failed to import allow-list CSV/text entries.",
    remove_failed: "Failed to remove allow-list entry."
  };

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">PIN Allow List</p>
            <h1 className="mt-3 text-2xl font-semibold text-slate-900">Allow List Management (Phase 5.3)</h1>
            <p className="mt-2 text-sm text-slate-600">Manual entry and CSV/text import for candidate identifiers bound to a specific PIN.</p>
          </div>
          <Link href="/admin/pins" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Back to PINs</Link>
        </div>

        {sp.error ? <Banner tone="error" text={errorCopy[sp.error] ?? "Allow-list action failed."} /> : null}
        {sp.status ? <Banner tone="success" text={`Allow-list ${sp.status}.`} /> : null}

        <div className="mt-8 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
            <h2 className="text-lg font-semibold text-slate-900">Select PIN</h2>
            <form method="get" className="mt-4">
              <select name="pinId" defaultValue={selectedPinId} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm">
                <option value="">Select PIN</option>
                {(pinsRes.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.pin_hint} | {p.status} | allow list {p.allow_list_enabled ? "on" : "off"}
                  </option>
                ))}
              </select>
              <button className="mt-3 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50">Load allow list</button>
            </form>

            <div className="mt-6 space-y-4">
              <form action={addManual} className="rounded-xl border border-slate-200 bg-white p-4">
                <input type="hidden" name="pinId" value={selectedPinId} />
                <h3 className="text-sm font-semibold text-slate-900">Manual entry</h3>
                <input name="candidateIdentifier" placeholder="student-id / email" className="mt-3 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm" />
                <button className="mt-3 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">Add entry</button>
              </form>

              <form action={importCsv} className="rounded-xl border border-slate-200 bg-white p-4">
                <input type="hidden" name="pinId" value={selectedPinId} />
                <h3 className="text-sm font-semibold text-slate-900">CSV / text import</h3>
                <p className="mt-1 text-xs text-slate-500">Paste comma, semicolon, or newline-separated identifiers.</p>
                <textarea name="csvIdentifiers" rows={8} className="mt-3 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-mono text-xs" />
                <button className="mt-3 rounded-xl border border-blue-300 bg-white px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50">Import entries</button>
              </form>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900">Allow-list entries</h2>
              <p className="text-sm text-slate-500">{(allowListRes.data ?? []).length} entries</p>
            </div>
            <div className="mt-4 space-y-3">
              {!selectedPinId ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">Select a PIN to manage its allow list.</div>
              ) : (allowListRes.data ?? []).length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">No allow-list entries for this PIN yet.</div>
              ) : (
                (allowListRes.data ?? []).map((entry) => (
                  <div key={entry.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-slate-900">{entry.candidate_identifier}</p>
                        <p className="mt-1 text-xs text-slate-500">Added {new Date(entry.created_at).toLocaleString()}</p>
                      </div>
                      <form action={removeEntry}>
                        <input type="hidden" name="pinId" value={selectedPinId} />
                        <input type="hidden" name="entryId" value={entry.id} />
                        <button className="rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50">Remove</button>
                      </form>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

function Banner({ tone, text }: { tone: "error" | "success"; text: string }) {
  const cls = tone === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-900";
  return <div className={`mt-5 rounded-xl border px-4 py-3 text-sm ${cls}`}>{text}</div>;
}
