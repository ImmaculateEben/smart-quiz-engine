import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionAuthState } from "@/lib/auth/session";
import { getInstitutionUsageSnapshot, getUsageWarnings, syncStorageUsageCounter } from "@/lib/usage/limits";

export default async function UsageLimitsPage() {
  const authState = await getSessionAuthState();

  if (!authState.user) {
    redirect("/login?next=/admin/usage");
  }

  const membership = authState.memberships[0] ?? null;
  if (!membership) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <h1 className="text-xl font-semibold text-amber-950">No institution context</h1>
          <p className="mt-2 text-sm text-amber-900">
            Complete onboarding before viewing usage limits.
          </p>
          <div className="mt-4">
            <Link
              href="/onboarding"
              className="inline-flex rounded-xl bg-amber-900 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800"
            >
              Go to onboarding
            </Link>
          </div>
        </section>
      </main>
    );
  }

  try {
    await syncStorageUsageCounter(membership.institutionId);
  } catch {
    // Storage sync is best-effort until file upload flows are fully implemented.
  }
  const snapshot = await getInstitutionUsageSnapshot(membership.institutionId);
  const warnings = getUsageWarnings(snapshot);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Usage Limits</p>
            <h1 className="mt-3 text-2xl font-semibold text-slate-900">
              {membership.institution?.name ?? membership.institutionId}
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Phase 2.5 usage-limit skeleton preview using plan limits + usage counters/capacity checks.
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
            <p className="text-slate-500">Plan</p>
            <p className="font-semibold text-slate-900">{snapshot.plan.planName ?? "Unassigned"}</p>
            <p className="text-xs text-slate-500">{snapshot.plan.planCode ?? "none"}</p>
          </div>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <UsageCard
            label="Questions"
            current={snapshot.metrics.questions.current}
            limit={snapshot.metrics.questions.limit}
            period={snapshot.metrics.questions.period}
          />
          <UsageCard
            label="Exams"
            current={snapshot.metrics.exams.current}
            limit={snapshot.metrics.exams.limit}
            period={snapshot.metrics.exams.period}
          />
          <UsageCard
            label="PINs Generated"
            current={snapshot.metrics.pins.current}
            limit={snapshot.metrics.pins.limit}
            period={snapshot.metrics.pins.period}
          />
          <UsageCard
            label="Admin Seats Reserved"
            current={snapshot.metrics.adminInviteCapacity.currentReserved}
            limit={snapshot.metrics.adminInviteCapacity.limit}
            period="all_time"
            sublabel={`${snapshot.metrics.adminInviteCapacity.activeAdmins} active + ${snapshot.metrics.adminInviteCapacity.pendingInvites} pending`}
          />
          <UsageCard
            label="Storage (MB)"
            current={Math.round(snapshot.metrics.storage.currentMb)}
            limit={snapshot.metrics.storage.limitMb == null ? null : Math.round(snapshot.metrics.storage.limitMb)}
            period="all_time"
            sublabel={`${snapshot.metrics.storage.currentMb.toFixed(2)} MB exact`}
          />
          <UsageCard
            label="Admin Invites Sent (monthly)"
            current={snapshot.metrics.adminInvitesSent.monthly}
            limit={null}
            period={snapshot.metrics.adminInvitesSent.period}
            sublabel={`All-time: ${snapshot.metrics.adminInvitesSent.allTime}`}
          />
        </div>

        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">Usage warnings & prompts</h2>
          <p className="mt-2 text-sm text-slate-600">
            Actions are blocked when hard limits are exceeded. Near-limit warnings are shown here to prompt cleanup or upgrades.
          </p>
          <div className="mt-4 space-y-3">
            {warnings.length === 0 ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                No usage warnings. Current usage is within configured thresholds.
              </div>
            ) : (
              warnings.map((warning) => (
                <div
                  key={warning.key}
                  className={`rounded-xl border p-4 text-sm ${
                    warning.tone === "critical"
                      ? "border-rose-200 bg-rose-50 text-rose-900"
                      : "border-amber-200 bg-amber-50 text-amber-900"
                  }`}
                >
                  <p className="font-semibold">{warning.title}</p>
                  <p className="mt-1">{warning.message}</p>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="text-lg font-semibold text-slate-900">Guarded API examples</h2>
          <p className="mt-2 text-sm text-slate-600">
            Sample route for testing limit guard responses (`429`) used by question/exam/PIN creation flows.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <a
              href="/api/admin/usage/check?target=questions&requested=1"
              className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Check question limit (API)
            </a>
            <a
              href="/api/admin/usage/check?target=pins&requested=50"
              className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Check PIN limit (API)
            </a>
          </div>
        </div>

        <div className="mt-8">
          <Link
            href="/admin"
            className="inline-flex rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Back to dashboard
          </Link>
        </div>
      </section>
    </main>
  );
}

function UsageCard({
  label,
  current,
  limit,
  period,
  sublabel
}: {
  label: string;
  current: number;
  limit: number | null;
  period: string;
  sublabel?: string;
}) {
  const percent = limit && limit > 0 ? Math.min(100, Math.round((current / limit) * 100)) : null;
  const tone =
    percent == null ? "bg-slate-200" : percent >= 90 ? "bg-rose-500" : percent >= 70 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-semibold text-slate-900">
        {current} <span className="text-sm font-normal text-slate-500">/ {limit ?? "unlimited"}</span>
      </p>
      <p className="mt-1 text-xs text-slate-500">Period: {period}</p>
      {sublabel ? <p className="mt-1 text-xs text-slate-500">{sublabel}</p> : null}
      <div className="mt-3 h-2 rounded-full bg-slate-100">
        <div className={`h-2 rounded-full ${tone}`} style={{ width: `${percent ?? 8}%` }} />
      </div>
    </div>
  );
}
