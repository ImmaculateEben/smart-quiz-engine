import type { Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { z } from "zod";
import { getSessionAuthState } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { reprocessAttemptScoring } from "@/lib/scoring/reprocess-attempt";
import { formDataString, parseServerActionForm } from "@/lib/http/server-action-validation";

type Params = { ok?: string; error?: string; jobStatus?: string; caseStatus?: string };

const OPS_PATH = "/admin/platform/operations";
const jobIdFormSchema = z.object({
  jobId: z.string().trim().min(1).max(128)
});
const queueJobFormSchema = z.object({
  jobType: z.string().trim().min(1).max(100),
  institutionId: z.string().trim().max(128),
  source: z.string().trim().max(100),
  payloadJson: z.string().max(200_000)
});
const supportCaseCategorySchema = z.enum([
  "general",
  "import_failure",
  "scoring_failure",
  "tenant_access",
  "integrity_review"
]);
const supportCasePrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
const createCaseFormSchema = z.object({
  title: z.string().trim().min(1).max(200),
  metadataJson: z.string().max(200_000),
  category: supportCaseCategorySchema,
  priority: supportCasePrioritySchema,
  description: z.string().trim().max(10_000),
  institutionId: z.string().trim().max(128),
  relatedJobId: z.string().trim().max(128),
  assigneeUserId: z.string().trim().max(128)
});
const updateCaseFormSchema = z.object({
  caseId: z.string().trim().min(1).max(128),
  status: z.enum(["open", "in_progress", "waiting_customer", "resolved", "closed"]),
  assigneeUserId: z.string().trim().max(128),
  resolutionNotes: z.string().trim().max(10_000)
});

function toPath(params: Record<string, string | undefined>): Route {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) s.set(k, v);
  return (s.size ? `${OPS_PATH}?${s.toString()}` : OPS_PATH) as Route;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function asObj(v: unknown) {
  return isRecord(v) ? v : {};
}

function superAdmin(auth: Awaited<ReturnType<typeof getSessionAuthState>>) {
  return Boolean(auth.user && auth.profile?.platformRole === "super_admin");
}

export default async function PlatformOperationsPage({
  searchParams
}: {
  searchParams?: Promise<Params>;
}) {
  const sp = (await searchParams) ?? {};
  const auth = await getSessionAuthState();
  if (!superAdmin(auth)) {
    if (!auth.user) redirect("/login?next=/admin/platform/operations");
    return <main className="mx-auto max-w-4xl px-6 py-10 text-sm">Super admin access required.</main>;
  }

  const supabase = await createSupabaseServerClient();
  const [jobsRes, casesRes, importAuditsRes, attemptsRes, resultsRes] = await Promise.all([
    supabase
      .from("platform_operation_jobs")
      .select("id,institution_id,job_type,status,priority,payload,error_message,attempts_count,created_at,updated_at")
      .order("created_at", { ascending: false })
      .limit(80),
    supabase
      .from("platform_support_cases")
      .select("id,institution_id,related_job_id,title,category,status,priority,assignee_user_id,resolution_notes,created_at")
      .order("created_at", { ascending: false })
      .limit(60),
    supabase
      .from("audit_logs")
      .select("id,institution_id,action,metadata,created_at")
      .eq("action", "question.import")
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("exam_attempts")
      .select("id,institution_id,status,updated_at")
      .in("status", ["submitted", "auto_submitted"])
      .order("updated_at", { ascending: false })
      .limit(120),
    supabase.from("exam_results").select("attempt_id").limit(400)
  ]);

  const jobsRaw = (jobsRes.data ?? []) as Array<any>;
  const jobs = jobsRaw.filter((j) => (!sp.jobStatus ? true : j.status === sp.jobStatus));
  const jobCounts = jobsRaw.reduce<Record<string, number>>((acc, j) => {
    acc[j.status] = (acc[j.status] ?? 0) + 1;
    return acc;
  }, {});
  const casesRaw = (casesRes.data ?? []) as Array<any>;
  const supportCases = casesRaw.filter((c) => (!sp.caseStatus ? true : c.status === sp.caseStatus));
  const caseCounts = casesRaw.reduce<Record<string, number>>((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1;
    return acc;
  }, {});
  const failedImportAudits = ((importAuditsRes.data ?? []) as Array<any>).filter((a) => Number(asObj(a.metadata).errors ?? 0) > 0);
  const resultAttemptIds = new Set(((resultsRes.data ?? []) as Array<any>).map((r) => r.attempt_id));
  const scoringGaps = ((attemptsRes.data ?? []) as Array<any>).filter((a) => !resultAttemptIds.has(a.id)).slice(0, 15);

  async function queueJob(formData: FormData) {
    "use server";
    const auth = await getSessionAuthState();
    if (!superAdmin(auth)) redirect(toPath({ error: "forbidden" }));
    const parsedForm = parseServerActionForm(queueJobFormSchema, {
      jobType: formDataString(formData, "jobType"),
      institutionId: formDataString(formData, "institutionId"),
      source: formDataString(formData, "source") || "manual",
      payloadJson: formDataString(formData, "payloadJson") || "{}"
    });
    if (!parsedForm.ok) redirect(toPath({ error: "invalid_input" }));
    const { jobType, institutionId, source, payloadJson: payloadText } = parsedForm.data;

    const supabase = await createSupabaseServerClient();
    let payload: Record<string, unknown> = {};
    try {
      payload = asObj(JSON.parse(payloadText));
    } catch {
      redirect(toPath({ error: "invalid_payload" }));
    }
    const { data, error } = await supabase
      .from("platform_operation_jobs")
      .insert({
        institution_id: institutionId || null,
        job_type: jobType,
        status: "queued",
        requested_by: auth.user!.id,
        source: source || null,
        payload
      })
      .select("id,institution_id")
      .single();
    if (error || !data) redirect(toPath({ error: "job_queue_failed" }));
    await supabase.rpc("audit_log", {
      p_institution_id: data.institution_id ?? null,
      p_action: "platform.ops_job_queue",
      p_entity_type: "platform_operation_jobs",
      p_entity_id: data.id,
      p_metadata: { jobType, source }
    });
    redirect(toPath({ ok: "job_queued" }));
  }

  async function runJob(formData: FormData) {
    "use server";
    const auth = await getSessionAuthState();
    if (!superAdmin(auth)) redirect(toPath({ error: "forbidden" }));
    const parsedForm = parseServerActionForm(jobIdFormSchema, {
      jobId: formDataString(formData, "jobId")
    });
    if (!parsedForm.ok) redirect(toPath({ error: "invalid_input" }));
    const { jobId } = parsedForm.data;
    const supabase = await createSupabaseServerClient();
    const { data: job } = await supabase
      .from("platform_operation_jobs")
      .select("id,institution_id,job_type,payload,attempts_count")
      .eq("id", jobId)
      .single();
    if (!job) redirect(toPath({ error: "job_not_found" }));
    await supabase.from("platform_operation_jobs").update({
      status: "running",
      attempts_count: Number(job.attempts_count ?? 0) + 1,
      started_at: new Date().toISOString(),
      error_message: null
    }).eq("id", jobId);
    try {
      const payload = asObj(job.payload);
      if (job.job_type === "scoring_reprocess_attempt") {
        await reprocessAttemptScoring({ attemptId: String(payload.attemptId ?? "") });
      } else if (job.job_type === "error_monitoring_test") {
        throw new Error("Synthetic monitoring test error");
      }
      await supabase.from("platform_operation_jobs").update({
        status: "succeeded",
        result: { executedAt: new Date().toISOString(), note: job.job_type === "question_import_reprocess_review" ? "Manual XML re-import required; review queued." : "Completed" },
        completed_at: new Date().toISOString()
      }).eq("id", jobId);
      await supabase.rpc("audit_log", {
        p_institution_id: job.institution_id ?? null,
        p_action: "platform.ops_job_run",
        p_entity_type: "platform_operation_jobs",
        p_entity_id: jobId,
        p_metadata: { status: "succeeded", jobType: job.job_type }
      });
      redirect(toPath({ ok: "job_ran" }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Job execution failed";
      await supabase.from("platform_operation_jobs").update({
        status: "failed",
        error_message: msg,
        completed_at: new Date().toISOString()
      }).eq("id", jobId);
      await supabase.rpc("audit_log", {
        p_institution_id: job.institution_id ?? null,
        p_action: "platform.ops_job_run",
        p_entity_type: "platform_operation_jobs",
        p_entity_id: jobId,
        p_metadata: { status: "failed", jobType: job.job_type, error: msg }
      });
      redirect(toPath({ error: "job_run_failed" }));
    }
  }

  async function requeueJob(formData: FormData) {
    "use server";
    const auth = await getSessionAuthState();
    if (!superAdmin(auth)) redirect(toPath({ error: "forbidden" }));
    const parsedForm = parseServerActionForm(jobIdFormSchema, {
      jobId: formDataString(formData, "jobId")
    });
    if (!parsedForm.ok) redirect(toPath({ error: "invalid_input" }));
    const { jobId } = parsedForm.data;
    const supabase = await createSupabaseServerClient();
    await supabase.from("platform_operation_jobs").update({
      status: "queued",
      error_message: null,
      started_at: null,
      completed_at: null
    }).eq("id", jobId);
    redirect(toPath({ ok: "job_requeued" }));
  }

  async function createCase(formData: FormData) {
    "use server";
    const auth = await getSessionAuthState();
    if (!superAdmin(auth)) redirect(toPath({ error: "forbidden" }));
    const raw = {
      title: formDataString(formData, "title"),
      metadataJson: formDataString(formData, "metadataJson") || "{}",
      category: formDataString(formData, "category") || "general",
      priority: formDataString(formData, "priority") || "medium",
      description: formDataString(formData, "description"),
      institutionId: formDataString(formData, "institutionId"),
      relatedJobId: formDataString(formData, "relatedJobId"),
      assigneeUserId: formDataString(formData, "assigneeUserId")
    };
    if (!raw.title) redirect(toPath({ error: "missing_case_title" }));
    const parsedForm = parseServerActionForm(createCaseFormSchema, raw);
    if (!parsedForm.ok) redirect(toPath({ error: "invalid_input" }));
    const { title, metadataJson: metadataText, category, priority, description, institutionId, relatedJobId, assigneeUserId } =
      parsedForm.data;
    const supabase = await createSupabaseServerClient();
    let metadata: Record<string, unknown> = {};
    try {
      metadata = asObj(JSON.parse(metadataText));
    } catch {
      redirect(toPath({ error: "invalid_payload" }));
    }
    const { data } = await supabase.from("platform_support_cases").insert({
      title,
      category,
      priority,
      description: description || null,
      institution_id: institutionId || null,
      related_job_id: relatedJobId || null,
      assignee_user_id: assigneeUserId || null,
      created_by: auth.user!.id,
      metadata
    }).select("id,institution_id").single();
    if (data) {
      await supabase.rpc("audit_log", {
        p_institution_id: data.institution_id ?? null,
        p_action: "platform.support_case_create",
        p_entity_type: "platform_support_cases",
        p_entity_id: data.id,
        p_metadata: { category }
      });
    }
    redirect(toPath({ ok: "case_created" }));
  }

  async function updateCase(formData: FormData) {
    "use server";
    const auth = await getSessionAuthState();
    if (!superAdmin(auth)) redirect(toPath({ error: "forbidden" }));
    const parsedForm = parseServerActionForm(updateCaseFormSchema, {
      caseId: formDataString(formData, "caseId"),
      status: formDataString(formData, "status"),
      assigneeUserId: formDataString(formData, "assigneeUserId"),
      resolutionNotes: formDataString(formData, "resolutionNotes")
    });
    if (!parsedForm.ok) redirect(toPath({ error: "invalid_input" }));
    const { caseId, status, assigneeUserId, resolutionNotes } = parsedForm.data;
    const supabase = await createSupabaseServerClient();
    const { data: row } = await supabase.from("platform_support_cases").select("id,institution_id").eq("id", caseId).single();
    await supabase.from("platform_support_cases").update({
      status,
      assignee_user_id: assigneeUserId || null,
      resolution_notes: resolutionNotes || null,
      resolved_at: ["resolved", "closed"].includes(status) ? new Date().toISOString() : null
    }).eq("id", caseId);
    if (row) {
      await supabase.rpc("audit_log", {
        p_institution_id: row.institution_id ?? null,
        p_action: "platform.support_case_update",
        p_entity_type: "platform_support_cases",
        p_entity_id: row.id,
        p_metadata: { status }
      });
    }
    redirect(toPath({ ok: "case_updated" }));
  }

  const errors: Record<string, string> = {
    forbidden: "Super admin access required.",
    invalid_input: "Invalid operation input.",
    invalid_payload: "Invalid JSON payload.",
    job_queue_failed: "Failed to queue operation job.",
    job_not_found: "Operation job not found.",
    job_run_failed: "Operation job failed. Check the row error message.",
    missing_case_title: "Support case title is required."
  };

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Platform Ops</p>
            <h1 className="mt-3 text-2xl font-semibold text-slate-900">Operational Tooling</h1>
            <p className="mt-2 text-sm text-slate-600">Error monitoring setup checks, background jobs, reprocessing tools, and support workflow.</p>
          </div>
          <Link href="/admin/platform" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">Back to Platform</Link>
        </div>
        {sp.error ? <Banner tone="error" text={errors[sp.error] ?? "Action failed."} /> : null}
        {sp.ok ? <Banner tone="ok" text={sp.ok.replaceAll("_", " ")} /> : null}

        <div className="mt-8 grid gap-6 xl:grid-cols-2">
          <Card title="Error Monitoring Setup">
            <div className="grid gap-3 sm:grid-cols-2">
              <Stat label="SENTRY_DSN" value={process.env.SENTRY_DSN ? "configured" : "missing"} danger={!process.env.SENTRY_DSN} />
              <Stat label="NEXT_PUBLIC_SENTRY_DSN" value={process.env.NEXT_PUBLIC_SENTRY_DSN ? "configured" : "missing"} danger={!process.env.NEXT_PUBLIC_SENTRY_DSN} />
              <Stat label="Failed Jobs" value={String(jobCounts.failed ?? 0)} danger={(jobCounts.failed ?? 0) > 0} />
              <Stat label="Failed Imports" value={String(failedImportAudits.length)} danger={failedImportAudits.length > 0} />
            </div>
            <form action={queueJob} className="mt-4">
              <input type="hidden" name="jobType" value="error_monitoring_test" />
              <input type="hidden" name="source" value="monitoring_panel" />
              <input type="hidden" name="payloadJson" value='{"synthetic":true}' />
              <button className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">Queue synthetic monitoring test</button>
            </form>
          </Card>

          <Card title="Background Job Visibility">
            <form method="get" className="mb-3 flex flex-wrap gap-2">
              <select name="jobStatus" defaultValue={sp.jobStatus ?? ""} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
                <option value="">All statuses</option><option value="queued">queued</option><option value="running">running</option><option value="succeeded">succeeded</option><option value="failed">failed</option>
              </select>
              {sp.caseStatus ? <input type="hidden" name="caseStatus" value={sp.caseStatus} /> : null}
              <button className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">Filter</button>
            </form>
            <div className="space-y-2">
              {jobs.slice(0, 18).map((job) => (
                <div key={job.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs">
                      <p className="font-medium text-slate-900">{job.job_type}</p>
                      <p className="text-slate-500">{job.id}</p>
                      {job.error_message ? <p className="text-rose-700">{job.error_message}</p> : null}
                    </div>
                    <div className="flex gap-2">
                      <Badge text={job.status} />
                      <form action={runJob}><input type="hidden" name="jobId" value={job.id} /><button className="rounded-lg border border-slate-300 px-2 py-1 text-xs">Run</button></form>
                      <form action={requeueJob}><input type="hidden" name="jobId" value={job.id} /><button className="rounded-lg border border-slate-300 px-2 py-1 text-xs">Re-queue</button></form>
                    </div>
                  </div>
                </div>
              ))}
              {jobs.length === 0 ? <p className="text-sm text-slate-600">No jobs found.</p> : null}
            </div>
          </Card>
        </div>

        <div className="mt-8 grid gap-6 xl:grid-cols-2">
          <Card title="Reprocessing Tools">
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-slate-900">Failed scoring detection (missing result rows)</p>
                <div className="mt-2 space-y-2">
                  {scoringGaps.map((a) => (
                    <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-2">
                      <div className="text-xs text-slate-600">{a.id}</div>
                      <form action={queueJob}>
                        <input type="hidden" name="jobType" value="scoring_reprocess_attempt" />
                        <input type="hidden" name="institutionId" value={a.institution_id} />
                        <input type="hidden" name="source" value="scoring_gap_scan" />
                        <input type="hidden" name="payloadJson" value={JSON.stringify({ attemptId: a.id })} />
                        <button className="rounded-lg border border-slate-300 px-2 py-1 text-xs">Queue scoring reprocess</button>
                      </form>
                    </div>
                  ))}
                  {scoringGaps.length === 0 ? <p className="text-sm text-slate-600">No recent scoring gaps detected.</p> : null}
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-slate-900">Failed XML imports (review/reprocess workflow)</p>
                <div className="mt-2 space-y-2">
                  {failedImportAudits.slice(0, 10).map((a) => (
                    <div key={a.id} className="rounded-lg border border-slate-200 p-2">
                      <p className="text-xs text-slate-600">Audit {a.id} | errors: {String(asObj(a.metadata).errors ?? 0)}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <form action={queueJob}>
                          <input type="hidden" name="jobType" value="question_import_reprocess_review" />
                          <input type="hidden" name="institutionId" value={a.institution_id ?? ""} />
                          <input type="hidden" name="source" value="failed_import_audit" />
                          <input type="hidden" name="payloadJson" value={JSON.stringify({ auditLogId: a.id, importSummary: asObj(a.metadata) })} />
                          <button className="rounded-lg border border-slate-300 px-2 py-1 text-xs">Queue import review job</button>
                        </form>
                        <form action={createCase}>
                          <input type="hidden" name="title" value="Question import failure review" />
                          <input type="hidden" name="category" value="import_failure" />
                          <input type="hidden" name="priority" value="high" />
                          <input type="hidden" name="institutionId" value={a.institution_id ?? ""} />
                          <input type="hidden" name="description" value={`Review import audit ${a.id}. Original XML must be re-supplied.`} />
                          <input type="hidden" name="metadataJson" value={JSON.stringify({ auditLogId: a.id, importSummary: asObj(a.metadata) })} />
                          <button className="rounded-lg border border-slate-300 px-2 py-1 text-xs">Open support case</button>
                        </form>
                      </div>
                    </div>
                  ))}
                  {failedImportAudits.length === 0 ? <p className="text-sm text-slate-600">No recent failed imports.</p> : null}
                </div>
              </div>
            </div>
          </Card>

          <Card title="Admin Support Workflow">
            <div className="grid gap-3 sm:grid-cols-2">
              <Stat label="Open" value={String(caseCounts.open ?? 0)} danger={(caseCounts.open ?? 0) > 0} />
              <Stat label="In Progress" value={String(caseCounts.in_progress ?? 0)} />
              <Stat label="Waiting" value={String(caseCounts.waiting_customer ?? 0)} />
              <Stat label="Resolved/Closed" value={String((caseCounts.resolved ?? 0) + (caseCounts.closed ?? 0))} />
            </div>
            <form action={createCase} className="mt-4 grid gap-2">
              <input name="title" placeholder="Case title" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
              <textarea name="description" rows={3} placeholder="Issue summary" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
              <div className="grid gap-2 sm:grid-cols-2">
                <select name="category" defaultValue="general" className="rounded-xl border border-slate-300 px-3 py-2 text-sm"><option value="general">general</option><option value="import_failure">import_failure</option><option value="scoring_failure">scoring_failure</option><option value="tenant_access">tenant_access</option><option value="integrity_review">integrity_review</option></select>
                <select name="priority" defaultValue="medium" className="rounded-xl border border-slate-300 px-3 py-2 text-sm"><option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="urgent">urgent</option></select>
              </div>
              <input name="institutionId" placeholder="Institution ID (optional)" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
              <input name="relatedJobId" placeholder="Related job ID (optional)" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
              <input name="assigneeUserId" placeholder="Assignee user ID (optional)" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
              <textarea name="metadataJson" rows={2} defaultValue="{}" className="rounded-xl border border-slate-300 px-3 py-2 font-mono text-xs" />
              <button className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">Create support case</button>
            </form>
            <div className="mt-4 space-y-2">
              {supportCases.slice(0, 15).map((c) => (
                <details key={c.id} className="rounded-xl border border-slate-200 p-3">
                  <summary className="cursor-pointer list-none">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs">
                        <p className="font-medium text-slate-900">{c.title}</p>
                        <p className="text-slate-500">{c.id}</p>
                      </div>
                      <Badge text={c.status} />
                    </div>
                  </summary>
                  <form action={updateCase} className="mt-3 grid gap-2">
                    <input type="hidden" name="caseId" value={c.id} />
                    <div className="grid gap-2 sm:grid-cols-2">
                      <select name="status" defaultValue={c.status} className="rounded-xl border border-slate-300 px-3 py-2 text-sm"><option value="open">open</option><option value="in_progress">in_progress</option><option value="waiting_customer">waiting_customer</option><option value="resolved">resolved</option><option value="closed">closed</option></select>
                      <input name="assigneeUserId" defaultValue={c.assignee_user_id ?? ""} placeholder="Assignee user ID" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                    </div>
                    <textarea name="resolutionNotes" defaultValue={c.resolution_notes ?? ""} rows={2} placeholder="Resolution notes" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                    <button className="w-fit rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">Update case</button>
                  </form>
                </details>
              ))}
              {supportCases.length === 0 ? <p className="text-sm text-slate-600">No support cases found.</p> : null}
            </div>
          </Card>
        </div>
      </section>
    </main>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-6"><h2 className="text-lg font-semibold text-slate-900">{title}</h2><div className="mt-3">{children}</div></section>;
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className={`mt-1 font-semibold ${danger ? "text-rose-700" : "text-slate-900"}`}>{value}</p></div>;
}

function Badge({ text }: { text: string }) {
  const cls = text === "failed" ? "border-rose-300 text-rose-700" : text === "running" ? "border-blue-300 text-blue-700" : text === "queued" ? "border-amber-300 text-amber-700" : "border-slate-300 text-slate-700";
  return <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${cls}`}>{text}</span>;
}

function Banner({ tone, text }: { tone: "ok" | "error"; text: string }) {
  return <div className={`mt-5 rounded-xl border px-4 py-3 text-sm ${tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-rose-200 bg-rose-50 text-rose-800"}`}>{text}</div>;
}
