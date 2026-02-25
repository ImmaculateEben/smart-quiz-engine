import { redirect } from "next/navigation";
import { z } from "zod";
import { getSessionAuthState } from "@/lib/auth/session";
import { hasInstitutionRole } from "@/lib/auth/rbac";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formDataString, parseServerActionForm } from "@/lib/http/server-action-validation";

const integrityReviewUpdateFormSchema = z.object({
  attemptId: z.string().trim().min(1).max(128),
  reviewStatus: z.enum(["needs_review", "reviewed", "cleared", "flagged"])
});

function getMeta(obj: unknown) {
  return obj && typeof obj === "object" && !Array.isArray(obj) ? (obj as Record<string, unknown>) : {};
}

export default async function IntegrityReviewPage({
  searchParams
}: {
  searchParams?: Promise<{ status?: string; error?: string; flagged?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const auth = await getSessionAuthState();
  if (!auth.user) redirect("/login?next=/admin/integrity");

  const membership = auth.memberships.find((m) => ["owner", "admin"].includes(m.role)) ?? null;
  const canReview =
    Boolean(auth.context && hasInstitutionRole(auth.context, ["owner", "admin"])) || Boolean(membership);
  if (!membership || !canReview) {
    return <main className="mx-auto max-w-4xl px-6 py-10 text-sm">Insufficient permissions.</main>;
  }

  const flaggedOnly = sp.flagged !== "0";
  const supabase = await createSupabaseServerClient();

  const { data: attempts } = await supabase
    .from("exam_attempts")
    .select(
      "id,exam_id,candidate_id,status,submitted_at,created_at,integrity_score,integrity_events_count,attempt_metadata"
    )
    .eq("institution_id", membership.institutionId)
    .not("submitted_at", "is", null)
    .order("submitted_at", { ascending: false })
    .limit(120);

  const rows = (attempts ?? []).filter((a) => {
    const meta = getMeta(a.attempt_metadata);
    const flagged = meta.integrityFlagged === true || (typeof a.integrity_score === "number" && a.integrity_score < 75);
    return flaggedOnly ? flagged : true;
  });

  const attemptIds = rows.map((r) => r.id);
  const examIds = [...new Set(rows.map((r) => r.exam_id).filter(Boolean))];
  const candidateIds = [...new Set(rows.map((r) => r.candidate_id).filter(Boolean))];

  const [{ data: exams }, { data: candidates }, { data: results }, { data: events }] = await Promise.all([
    examIds.length
      ? supabase.from("exams").select("id,title").eq("institution_id", membership.institutionId).in("id", examIds)
      : Promise.resolve({ data: [] }),
    candidateIds.length
      ? supabase.from("candidates").select("id,full_name").eq("institution_id", membership.institutionId).in("id", candidateIds)
      : Promise.resolve({ data: [] }),
    attemptIds.length
      ? supabase
          .from("exam_results")
          .select("attempt_id,percentage,grade_letter,integrity_score,created_at")
          .eq("institution_id", membership.institutionId)
          .in("attempt_id", attemptIds)
      : Promise.resolve({ data: [] }),
    attemptIds.length
      ? supabase
          .from("attempt_integrity_events")
          .select("attempt_id,event_type,severity,created_at")
          .eq("institution_id", membership.institutionId)
          .in("attempt_id", attemptIds)
          .order("created_at", { ascending: false })
          .limit(300)
      : Promise.resolve({ data: [] })
  ]);

  const examMap = new Map((exams ?? []).map((e) => [e.id, e.title]));
  const candidateMap = new Map((candidates ?? []).map((c) => [c.id, c.full_name]));
  const resultMap = new Map((results ?? []).map((r) => [r.attempt_id, r]));
  const eventsByAttempt = new Map<string, Array<{ event_type: string; severity: string | null; created_at: string }>>();
  for (const event of events ?? []) {
    const list = eventsByAttempt.get(event.attempt_id) ?? [];
    if (list.length < 5) list.push(event as { event_type: string; severity: string | null; created_at: string });
    eventsByAttempt.set(event.attempt_id, list);
  }

  async function updateReviewStatus(formData: FormData) {
    "use server";
    const auth = await getSessionAuthState();
    const membership = auth.memberships.find((m) => ["owner", "admin"].includes(m.role)) ?? null;
    const canReview =
      Boolean(auth.context && hasInstitutionRole(auth.context, ["owner", "admin"])) || Boolean(membership);
    if (!auth.user || !membership || !canReview) redirect("/admin/integrity?error=forbidden");

    const parsedForm = parseServerActionForm(integrityReviewUpdateFormSchema, {
      attemptId: formDataString(formData, "attemptId"),
      reviewStatus: formDataString(formData, "reviewStatus")
    });
    if (!parsedForm.ok) redirect("/admin/integrity?error=invalid_input");
    const { attemptId, reviewStatus } = parsedForm.data;

    const supabase = await createSupabaseServerClient();
    const { data: row } = await supabase
      .from("exam_attempts")
      .select("attempt_metadata")
      .eq("id", attemptId)
      .eq("institution_id", membership.institutionId)
      .single();
    const meta = getMeta(row?.attempt_metadata);
    const nextMeta = {
      ...meta,
      integrityReviewStatus: reviewStatus,
      integrityReviewedAt: new Date().toISOString(),
      integrityReviewedByUserId: auth.user.id,
      integrityFlagged: reviewStatus === "cleared" ? false : reviewStatus === "flagged" ? true : Boolean(meta.integrityFlagged)
    };
    const { error } = await supabase
      .from("exam_attempts")
      .update({ attempt_metadata: nextMeta })
      .eq("id", attemptId)
      .eq("institution_id", membership.institutionId);
    if (error) redirect("/admin/integrity?error=save_failed");
    redirect("/admin/integrity?status=review_updated");
  }

  const errorCopy: Record<string, string> = {
    forbidden: "You do not have permission to review integrity flags.",
    invalid_input: "Invalid review update input.",
    save_failed: "Failed to update review status."
  };

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Integrity Review</p>
            <h1 className="mt-3 text-2xl font-semibold text-slate-900">Attempt integrity queue</h1>
            <p className="mt-2 text-sm text-slate-600">
              Review suspicious attempts flagged during submission scoring and inspect recent client integrity events.
            </p>
          </div>
          <form method="get" className="flex items-center gap-2 text-sm">
            <label className="flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2">
              <input type="checkbox" name="flagged" value="1" defaultChecked={flaggedOnly} />
              Flagged only
            </label>
            <button className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-medium hover:bg-slate-50">
              Apply
            </button>
          </form>
        </div>

        {sp.error ? (
          <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {errorCopy[sp.error] ?? "Integrity review action failed."}
          </div>
        ) : null}
        {sp.status === "review_updated" ? (
          <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            Review status updated.
          </div>
        ) : null}

        <div className="mt-8 space-y-4">
          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-600">
              No attempts in the current queue.
            </div>
          ) : (
            rows.map((attempt) => {
              const meta = getMeta(attempt.attempt_metadata);
              const result = resultMap.get(attempt.id);
              const recent = eventsByAttempt.get(attempt.id) ?? [];
              const reviewStatus = String(meta.integrityReviewStatus ?? (meta.integrityFlagged ? "needs_review" : "clear"));
              const flagged = meta.integrityFlagged === true || (typeof attempt.integrity_score === "number" && attempt.integrity_score < 75);

              return (
                <div key={attempt.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {examMap.get(attempt.exam_id) ?? attempt.exam_id}
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        Candidate: {candidateMap.get(attempt.candidate_id) ?? attempt.candidate_id}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Attempt: <code>{attempt.id}</code>
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                      <Badge label="Integrity" value={formatNum(attempt.integrity_score)} tone={flagged ? "warn" : "ok"} />
                      <Badge label="Events" value={String(attempt.integrity_events_count ?? 0)} tone={(attempt.integrity_events_count ?? 0) > 0 ? "warn" : "neutral"} />
                      <Badge label="Score" value={result ? `${formatNum(result.percentage)}%` : "-"} tone="neutral" />
                      <Badge label="Review" value={reviewStatus} tone={reviewStatus === "cleared" ? "ok" : reviewStatus === "reviewed" ? "neutral" : "warn"} />
                    </div>
                  </div>

                  {recent.length > 0 ? (
                    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recent integrity events</p>
                      <ul className="mt-2 space-y-1 text-sm text-slate-700">
                        {recent.map((event, idx) => (
                          <li key={`${attempt.id}-${idx}`}>
                            <span className="font-medium">{event.event_type}</span>
                            {" "}
                            <span className="text-slate-500">({event.severity ?? "info"})</span>
                            {" "}
                            <span className="text-slate-400">{event.created_at}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <form action={updateReviewStatus} className="mt-4 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="attemptId" value={attempt.id} />
                    <select
                      name="reviewStatus"
                      defaultValue={["needs_review", "reviewed", "cleared", "flagged"].includes(reviewStatus) ? reviewStatus : "needs_review"}
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                    >
                      <option value="needs_review">needs_review</option>
                      <option value="reviewed">reviewed</option>
                      <option value="cleared">cleared</option>
                      <option value="flagged">flagged</option>
                    </select>
                    <button className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50">
                      Update review
                    </button>
                  </form>
                </div>
              );
            })
          )}
        </div>
      </section>
    </main>
  );
}

function Badge({
  label,
  value,
  tone
}: {
  label: string;
  value: string;
  tone: "ok" | "warn" | "neutral";
}) {
  const toneClass =
    tone === "ok"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-slate-200 bg-white text-slate-800";
  return (
    <div className={`rounded-lg border px-3 py-2 ${toneClass}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}

function formatNum(value: unknown) {
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (value == null) return "-";
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : String(value);
}
