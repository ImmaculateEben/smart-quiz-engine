import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSessionAuthState } from "@/lib/auth/session";
import { hasInstitutionRole } from "@/lib/auth/rbac";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assertUsageAllowed, incrementUsageCounter } from "@/lib/usage/limits";
import { buildPinHint, generateRawPin, hashPin, type PinCharset } from "@/lib/pins/generate";
import { logAuditEvent } from "@/lib/audit/log";
import { formDataString, parseServerActionForm, zFormBooleanString } from "@/lib/http/server-action-validation";

type PageProps = {
  searchParams?: Promise<Record<string, string | undefined>>;
};

function route(params: Record<string, string | undefined>) {
  const s = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v && s.set(k, v));
  const q = s.toString();
  return q ? `/admin/pins?${q}` : "/admin/pins";
}

type GenerationReport = {
  batchId: string | null;
  count: number;
  rawPins: string[];
  examId: string;
  expiresAt: string | null;
};

const pinCharsetSchema = z.enum(["numeric", "alnum_upper"]);

const generatePinsFormSchema = z.object({
  examId: z.string().trim().min(1).max(128),
  batchName: z.string().trim().max(200),
  prefix: z.string().trim().max(20),
  quantity: z.coerce.number().int().min(1).max(1000),
  length: z.coerce.number().int().min(4).max(24),
  charset: pinCharsetSchema,
  maxUses: z.coerce.number().int().min(1).max(1000),
  expiresAtRaw: z
    .string()
    .trim()
    .max(64)
    .refine((value) => !value || !Number.isNaN(Date.parse(value)), { message: "Invalid expiry date" }),
  allowListEnabled: zFormBooleanString
});

const pinIdFormSchema = z.object({
  pinId: z.string().trim().min(1).max(128)
});

const batchIdFormSchema = z.object({
  batchId: z.string().trim().min(1).max(128)
});

export default async function PinsPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const auth = await getSessionAuthState();
  if (!auth.user) redirect("/login?next=/admin/pins");
  const membership = auth.memberships.find((m) => ["owner", "admin"].includes(m.role)) ?? null;
  const canManage =
    Boolean(auth.context && hasInstitutionRole(auth.context, ["owner", "admin"])) || Boolean(membership);
  if (!membership || !canManage) return <main className="mx-auto max-w-4xl px-6 py-10 text-sm">Insufficient permissions.</main>;

  const supabase = await createSupabaseServerClient();
  const institutionId = membership.institutionId;
  const [examsRes, batchesRes, pinsRes] = await Promise.all([
    supabase
      .from("exams")
      .select("id,title,status")
      .eq("institution_id", institutionId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false }),
    supabase
      .from("pin_batches")
      .select("id,exam_id,batch_name,prefix,quantity,expires_at,usage_limit_per_pin,created_at")
      .eq("institution_id", institutionId)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("exam_pins")
      .select("id,exam_id,batch_id,pin_hint,status,max_uses,uses_count,expires_at,allow_list_enabled,created_at")
      .eq("institution_id", institutionId)
      .order("created_at", { ascending: false })
      .limit(200)
  ]);
  const examMap = new Map((examsRes.data ?? []).map((e) => [e.id, e]));

  async function generatePins(formData: FormData) {
    "use server";
    const auth = await getSessionAuthState();
    const membership = auth.memberships.find((m) => ["owner", "admin"].includes(m.role)) ?? null;
    const canManage =
      Boolean(auth.context && hasInstitutionRole(auth.context, ["owner", "admin"])) || Boolean(membership);
    if (!auth.user || !membership || !canManage) redirect(route({ error: "forbidden" }));

    const raw = {
      examId: formDataString(formData, "examId"),
      batchName: formDataString(formData, "batchName"),
      prefix: formDataString(formData, "prefix"),
      quantity: formDataString(formData, "quantity") || "1",
      length: formDataString(formData, "length") || "8",
      charset: formDataString(formData, "charset") || "alnum_upper",
      maxUses: formDataString(formData, "maxUses") || "1",
      expiresAtRaw: formDataString(formData, "expiresAt"),
      allowListEnabled: formDataString(formData, "allowListEnabled") || "false"
    };

    const parsedForm = parseServerActionForm(generatePinsFormSchema, raw);
    if (!parsedForm.ok) {
      const fields = parsedForm.error.flatten().fieldErrors;
      if (fields.length?.length) redirect(route({ error: "invalid_length" }));
      if (fields.charset?.length) redirect(route({ error: "invalid_charset" }));
      if (fields.maxUses?.length) redirect(route({ error: "invalid_max_uses" }));
      if (fields.expiresAtRaw?.length) redirect(route({ error: "invalid_expiry" }));
      redirect(route({ error: "invalid_input" }));
    }

    const {
      examId,
      batchName,
      prefix: rawPrefix,
      quantity,
      length,
      charset,
      maxUses,
      expiresAtRaw,
      allowListEnabled
    } = parsedForm.data;
    const prefix = rawPrefix.toUpperCase();
    const expiresAt = expiresAtRaw ? new Date(expiresAtRaw).toISOString() : null;

    try {
      await assertUsageAllowed({ institutionId: membership.institutionId, target: "pins", requested: quantity });
    } catch {
      redirect(route({ error: "pin_limit_reached" }));
    }

    const supabase = await createSupabaseServerClient();
    const { data: exam } = await supabase
      .from("exams")
      .select("id")
      .eq("id", examId)
      .eq("institution_id", membership.institutionId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!exam) redirect(route({ error: "exam_not_found" }));

    const { data: batch, error: batchErr } = await supabase
      .from("pin_batches")
      .insert({
        institution_id: membership.institutionId,
        exam_id: examId,
        batch_name: batchName,
        prefix: prefix || null,
        quantity,
        expires_at: expiresAt,
        usage_limit_per_pin: maxUses,
        created_by: auth.user.id,
        metadata: { charset, length }
      })
      .select("id")
      .single();
    if (batchErr || !batch) redirect(route({ error: "batch_create_failed" }));

    const rawPins: string[] = [];
    const inserts: Array<Record<string, unknown>> = [];
    const seenHashes = new Set<string>();
    let guard = 0;
    while (inserts.length < quantity && guard < quantity * 20) {
      guard += 1;
      const raw = generateRawPin({ length, charset, prefix });
      const pinHash = hashPin(raw);
      if (seenHashes.has(pinHash)) continue;
      seenHashes.add(pinHash);
      rawPins.push(raw);
      inserts.push({
        institution_id: membership.institutionId,
        exam_id: examId,
        batch_id: batch.id,
        pin_hash: pinHash,
        pin_hint: buildPinHint(raw),
        status: "active",
        max_uses: maxUses,
        allow_list_enabled: allowListEnabled,
        expires_at: expiresAt,
        created_by: auth.user.id,
        metadata: { charset, length, prefix: prefix || null }
      });
    }
    if (inserts.length !== quantity) redirect(route({ error: "pin_generation_failed" }));

    const { error: insertErr } = await supabase.from("exam_pins").insert(inserts);
    if (insertErr) redirect(route({ error: String(insertErr.message).toLowerCase().includes("unique") ? "pin_collision" : "pin_insert_failed" }));

    try {
      await incrementUsageCounter({
        institutionId: membership.institutionId,
        metricKey: "pins_generated",
        metricPeriod: new Date().toISOString().slice(0, 7),
        incrementBy: quantity
      });
    } catch {}

    try {
      await logAuditEvent({
        institutionId: membership.institutionId,
        action: "pin.generate",
        entityType: "pin_batches",
        entityId: batch.id,
        metadata: { exam_id: examId, quantity, prefix, max_uses: maxUses, expires_at: expiresAt }
      });
    } catch {}

    const report: GenerationReport = { batchId: batch.id, count: quantity, rawPins, examId, expiresAt };
    const reportEncoded = Buffer.from(JSON.stringify(report)).toString("base64url");
    redirect(route({ status: "generated", report: reportEncoded }));
  }

  async function deactivatePin(formData: FormData) {
    "use server";
    const auth = await getSessionAuthState();
    const membership = auth.memberships.find((m) => ["owner", "admin"].includes(m.role)) ?? null;
    if (!auth.user || !membership) redirect(route({ error: "forbidden" }));
    const raw = { pinId: formDataString(formData, "pinId") };
    if (!raw.pinId) redirect(route({ error: "missing_pin_id" }));
    const parsedForm = parseServerActionForm(pinIdFormSchema, raw);
    if (!parsedForm.ok) redirect(route({ error: "invalid_input" }));
    const { pinId } = parsedForm.data;
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("exam_pins")
      .update({ status: "revoked" })
      .eq("id", pinId)
      .eq("institution_id", membership.institutionId)
      .eq("status", "active");
    if (error) redirect(route({ error: "deactivate_failed" }));
    redirect(route({ status: "revoked" }));
  }

  async function revokeBatch(formData: FormData) {
    "use server";
    const auth = await getSessionAuthState();
    const membership = auth.memberships.find((m) => ["owner", "admin"].includes(m.role)) ?? null;
    if (!auth.user || !membership) redirect(route({ error: "forbidden" }));
    const raw = { batchId: formDataString(formData, "batchId") };
    if (!raw.batchId) redirect(route({ error: "missing_batch_id" }));
    const parsedForm = parseServerActionForm(batchIdFormSchema, raw);
    if (!parsedForm.ok) redirect(route({ error: "invalid_input" }));
    const { batchId } = parsedForm.data;
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("exam_pins")
      .update({ status: "revoked" })
      .eq("batch_id", batchId)
      .eq("institution_id", membership.institutionId)
      .eq("status", "active");
    if (error) redirect(route({ error: "batch_revoke_failed" }));
    redirect(route({ status: "batch_revoked" }));
  }

  const report = sp.report
    ? (() => {
        try {
          return JSON.parse(Buffer.from(sp.report, "base64url").toString("utf8")) as GenerationReport;
        } catch {
          return null;
        }
      })()
    : null;

  const errorCopy: Record<string, string> = {
    forbidden: "You do not have permission to manage PINs.",
    invalid_input: "Invalid exam or quantity (1-1000).",
    invalid_length: "PIN length must be between 4 and 24.",
    invalid_charset: "Invalid PIN charset.",
    invalid_max_uses: "Max uses must be between 1 and 1000.",
    invalid_expiry: "Expiry date is invalid.",
    pin_limit_reached: "PIN generation limit reached for the current month/plan.",
    exam_not_found: "Exam not found.",
    batch_create_failed: "Failed to create PIN batch.",
    pin_generation_failed: "Failed to generate enough unique PINs.",
    pin_collision: "PIN hash collision encountered during insert. Retry generation.",
    pin_insert_failed: "Failed to save generated PINs.",
    missing_pin_id: "PIN ID is missing.",
    deactivate_failed: "Failed to deactivate PIN.",
    missing_batch_id: "Batch ID is missing.",
    batch_revoke_failed: "Failed to revoke batch PINs."
  };

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">PIN System</p>
            <h1 className="mt-3 text-2xl font-semibold text-slate-900">PIN Generation & Management (Phase 5)</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Secure hashed PIN generation, bulk batch creation, exam binding, expiry/max-use settings, and PIN management.
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/admin/pins/allow-list" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Allow lists
            </Link>
            <Link href="/admin" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Dashboard
            </Link>
          </div>
        </div>

        {sp.error ? <Notice tone="error" text={errorCopy[sp.error] ?? "PIN action failed."} /> : null}
        {sp.status ? <Notice tone="success" text={sp.status === "generated" ? "PINs generated successfully." : sp.status === "revoked" ? "PIN revoked." : `Status: ${sp.status}`} /> : null}

        <div className="mt-8 grid gap-6 xl:grid-cols-[1fr_1fr]">
          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
            <h2 className="text-lg font-semibold text-slate-900">Generate PINs</h2>
            <form action={generatePins} className="mt-4 grid gap-4">
              <Field label="Exam">
                <select name="examId" required className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm">
                  <option value="">Select exam</option>
                  {(examsRes.data ?? []).map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.title} ({e.status})
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Batch name">
                  <input name="batchName" defaultValue="PIN Batch" className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm" />
                </Field>
                <Field label="Prefix (optional)">
                  <input name="prefix" placeholder="MIDTERM-" className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm uppercase" />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Quantity">
                  <input name="quantity" type="number" min={1} max={1000} defaultValue={20} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm" />
                </Field>
                <Field label="PIN length">
                  <input name="length" type="number" min={4} max={24} defaultValue={8} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm" />
                </Field>
                <Field label="Charset">
                  <select name="charset" defaultValue="alnum_upper" className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm">
                    <option value="alnum_upper">Alnum Upper</option>
                    <option value="numeric">Numeric</option>
                  </select>
                </Field>
                <Field label="Max uses / PIN">
                  <input name="maxUses" type="number" min={1} max={1000} defaultValue={1} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm" />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Expiry date/time (optional)">
                  <input name="expiresAt" type="datetime-local" className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm" />
                </Field>
                <Field label="Allow list enabled">
                  <select name="allowListEnabled" defaultValue="false" className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm">
                    <option value="false">No</option>
                    <option value="true">Yes</option>
                  </select>
                </Field>
              </div>
              <button className="justify-self-start rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800">
                Generate batch
              </button>
            </form>
          </section>

          <section className="space-y-6">
            {report ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
                <h2 className="text-lg font-semibold text-emerald-950">Generated PIN export</h2>
                <p className="mt-2 text-sm text-emerald-900">
                  Batch: {report.batchId ?? "n/a"} | Count: {report.count}
                </p>
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-900">CSV</p>
                  <textarea
                    readOnly
                    rows={10}
                    value={["pin", ...report.rawPins].join("\n")}
                    className="mt-2 w-full rounded-xl border border-emerald-300 bg-white px-4 py-3 font-mono text-xs text-slate-900"
                  />
                </div>
              </div>
            ) : null}

            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="text-lg font-semibold text-slate-900">Recent batches</h2>
              <div className="mt-4 space-y-3">
                {(batchesRes.data ?? []).length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">No PIN batches yet.</div>
                ) : (
                  (batchesRes.data ?? []).map((b) => (
                    <div key={b.id} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-slate-900">{b.batch_name}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {examMap.get(b.exam_id)?.title ?? b.exam_id} | qty {b.quantity} | max uses {b.usage_limit_per_pin}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            prefix {b.prefix ?? "none"} | expires {b.expires_at ? new Date(b.expires_at).toLocaleString() : "none"}
                          </p>
                        </div>
                        <form action={revokeBatch}>
                          <input type="hidden" name="batchId" value={b.id} />
                          <button className="rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50">
                            Revoke batch
                          </button>
                        </form>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        </div>

        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">PIN management</h2>
            <p className="text-sm text-slate-500">{(pinsRes.data ?? []).length} recent PINs</p>
          </div>
          <div className="mt-4 space-y-3">
            {(pinsRes.data ?? []).length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">No PINs generated yet.</div>
            ) : (
              (pinsRes.data ?? []).map((pin) => (
                <div key={pin.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-slate-900">{pin.pin_hint}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {examMap.get(pin.exam_id)?.title ?? pin.exam_id} | status {pin.status} | uses {pin.uses_count}/{pin.max_uses}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        batch {pin.batch_id ?? "n/a"} | expires {pin.expires_at ? new Date(pin.expires_at).toLocaleString() : "none"} | allow list {pin.allow_list_enabled ? "on" : "off"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {pin.status === "active" ? (
                        <form action={deactivatePin}>
                          <input type="hidden" name="pinId" value={pin.id} />
                          <button className="rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50">Deactivate</button>
                        </form>
                      ) : (
                        <span className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-500">{pin.status}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
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

function Notice({ tone, text }: { tone: "error" | "success"; text: string }) {
  const cls = tone === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-900";
  return <div className={`mt-5 rounded-xl border px-4 py-3 text-sm ${cls}`}>{text}</div>;
}
