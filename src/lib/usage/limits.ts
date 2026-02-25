import { createSupabaseServerClient } from "@/lib/supabase/server";

export type UsageLimitKey =
  | "max_questions"
  | "max_exams"
  | "max_pins_per_month"
  | "max_admins"
  | "max_storage_mb";

export type UsageMetricKey =
  | "questions_total"
  | "exams_total"
  | "pins_generated"
  | "admins_active"
  | "admin_invites_sent"
  | "storage_bytes";

export type UsageMetricPeriod = "all_time" | string;

export type UsageLimitDefinition = {
  metricKey: UsageMetricKey;
  limitKey: UsageLimitKey;
  period: "all_time" | "monthly";
};

export const USAGE_LIMIT_DEFINITIONS = {
  questions: { metricKey: "questions_total", limitKey: "max_questions", period: "all_time" },
  exams: { metricKey: "exams_total", limitKey: "max_exams", period: "all_time" },
  pins: { metricKey: "pins_generated", limitKey: "max_pins_per_month", period: "monthly" },
  admins: { metricKey: "admins_active", limitKey: "max_admins", period: "all_time" }
} satisfies Record<string, UsageLimitDefinition>;

export type UsageGuardTarget = keyof typeof USAGE_LIMIT_DEFINITIONS;

export class UsageLimitExceededError extends Error {
  code = "USAGE_LIMIT_EXCEEDED" as const;
  constructor(
    message: string,
    public details: {
      target: UsageGuardTarget;
      limitKey: UsageLimitKey;
      metricKey: UsageMetricKey;
      period: UsageMetricPeriod;
      current: number;
      requested: number;
      limit: number;
    }
  ) {
    super(message);
  }
}

export function getMonthlyMetricPeriod(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export async function getInstitutionPlanLimits(institutionId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("institution_plans")
    .select("institution_id, plan_id, plan_limits:plan_id (id, code, name, limits)")
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (error) throw error;

  const plan = (data as
    | {
        institution_id: string;
        plan_id: string;
        plan_limits?: { id: string; code: string; name: string; limits: Record<string, unknown> } | null;
      }
    | null) ?? null;

  return {
    institutionId,
    planId: plan?.plan_id ?? null,
    planCode: plan?.plan_limits?.code ?? null,
    planName: plan?.plan_limits?.name ?? null,
    limits: (plan?.plan_limits?.limits as Record<string, unknown> | undefined) ?? {}
  };
}

export async function getUsageCounterValue(
  institutionId: string,
  metricKey: UsageMetricKey,
  metricPeriod: UsageMetricPeriod
) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("usage_counters")
    .select("metric_value")
    .eq("institution_id", institutionId)
    .eq("metric_key", metricKey)
    .eq("metric_period", metricPeriod)
    .maybeSingle();

  if (error) throw error;
  return Number((data as { metric_value?: number } | null)?.metric_value ?? 0);
}

export async function incrementUsageCounter(params: {
  institutionId: string;
  metricKey: UsageMetricKey;
  metricPeriod?: UsageMetricPeriod;
  incrementBy?: number;
}) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("increment_usage_counter", {
    p_institution_id: params.institutionId,
    p_metric_key: params.metricKey,
    p_metric_period: params.metricPeriod ?? "all_time",
    p_increment_by: params.incrementBy ?? 1
  });
  if (error) throw error;
}

export async function setUsageCounterValue(params: {
  institutionId: string;
  metricKey: UsageMetricKey;
  metricPeriod?: UsageMetricPeriod;
  value: number;
  metadata?: Record<string, unknown>;
}) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("usage_counters").upsert(
    {
      institution_id: params.institutionId,
      metric_key: params.metricKey,
      metric_period: params.metricPeriod ?? "all_time",
      metric_value: Math.max(0, Math.trunc(params.value)),
      metadata: params.metadata ?? {}
    },
    { onConflict: "institution_id,metric_key,metric_period" }
  );

  if (error) throw error;
}

export async function getUsageLimitCheck(params: {
  institutionId: string;
  target: UsageGuardTarget;
  requested?: number;
}) {
  const requested = params.requested ?? 1;
  const definition = USAGE_LIMIT_DEFINITIONS[params.target];
  const period = definition.period === "monthly" ? getMonthlyMetricPeriod() : "all_time";

  const [plan, current] = await Promise.all([
    getInstitutionPlanLimits(params.institutionId),
    getUsageCounterValue(params.institutionId, definition.metricKey, period)
  ]);

  const rawLimit = plan.limits[definition.limitKey];
  const limit = typeof rawLimit === "number" ? rawLimit : Number(rawLimit ?? NaN);
  const hasLimit = Number.isFinite(limit) && limit >= 0;
  const allowed = !hasLimit || current + requested <= limit;

  return {
    target: params.target,
    definition,
    period,
    requested,
    current,
    limit: hasLimit ? limit : null,
    allowed,
    planCode: plan.planCode,
    planName: plan.planName
  };
}

export async function assertUsageAllowed(params: {
  institutionId: string;
  target: UsageGuardTarget;
  requested?: number;
}) {
  const result = await getUsageLimitCheck(params);
  if (!result.allowed && result.limit != null) {
    throw new UsageLimitExceededError(
      `Usage limit exceeded for ${result.target}`,
      {
        target: result.target,
        limitKey: result.definition.limitKey,
        metricKey: result.definition.metricKey,
        period: result.period,
        current: result.current,
        requested: result.requested,
        limit: result.limit
      }
    );
  }
  return result;
}

export async function getInstitutionUsageSnapshot(institutionId: string) {
  const [questions, exams, pins, admins, adminInviteCapacity, adminInvitesSent, storage, plan] = await Promise.all([
    getUsageLimitCheck({ institutionId, target: "questions" }),
    getUsageLimitCheck({ institutionId, target: "exams" }),
    getUsageLimitCheck({ institutionId, target: "pins" }),
    getUsageLimitCheck({ institutionId, target: "admins" }),
    getAdminInviteCapacityCheck(institutionId),
    getAdminInviteTrackingSnapshot(institutionId),
    getStorageUsageCheck(institutionId),
    getInstitutionPlanLimits(institutionId)
  ]);

  return {
    plan,
    metrics: {
      questions,
      exams,
      pins,
      admins,
      adminInviteCapacity,
      adminInvitesSent,
      storage
    }
  };
}

export async function getAdminInviteCapacityCheck(institutionId: string, requested = 1) {
  const supabase = await createSupabaseServerClient();
  const [plan, activeAdminsCount, pendingInvitesCount] = await Promise.all([
    getInstitutionPlanLimits(institutionId),
    supabase
      .from("institution_admins")
      .select("*", { count: "exact", head: true })
      .eq("institution_id", institutionId)
      .eq("is_active", true),
    supabase
      .from("admin_invitations")
      .select("*", { count: "exact", head: true })
      .eq("institution_id", institutionId)
      .eq("status", "pending")
  ]);

  const rawLimit = plan.limits.max_admins;
  const limit = typeof rawLimit === "number" ? rawLimit : Number(rawLimit ?? NaN);
  const hasLimit = Number.isFinite(limit) && limit >= 0;
  const activeAdmins = activeAdminsCount.count ?? 0;
  const pendingInvites = pendingInvitesCount.count ?? 0;
  const currentReserved = activeAdmins + pendingInvites;
  const allowed = !hasLimit || currentReserved + requested <= limit;

  return {
    target: "adminInvites" as const,
    limitKey: "max_admins" as const,
    requested,
    activeAdmins,
    pendingInvites,
    currentReserved,
    limit: hasLimit ? limit : null,
    allowed,
    planCode: plan.planCode,
    planName: plan.planName
  };
}

export async function getAdminInviteTrackingSnapshot(institutionId: string) {
  const [allTime, monthly] = await Promise.all([
    getUsageCounterValue(institutionId, "admin_invites_sent", "all_time"),
    getUsageCounterValue(institutionId, "admin_invites_sent", getMonthlyMetricPeriod())
  ]);
  return {
    metricKey: "admin_invites_sent" as const,
    allTime,
    monthly,
    period: getMonthlyMetricPeriod()
  };
}

export async function syncStorageUsageCounter(institutionId: string) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("file_assets")
    .select("size_bytes")
    .eq("institution_id", institutionId);
  const totalBytes = (data ?? []).reduce((sum, row) => sum + Math.max(0, Number(row.size_bytes ?? 0)), 0);
  await setUsageCounterValue({
    institutionId,
    metricKey: "storage_bytes",
    metricPeriod: "all_time",
    value: totalBytes,
    metadata: { source: "file_assets_sum", synced_at: new Date().toISOString() }
  });
  return totalBytes;
}

export async function getStorageUsageCheck(institutionId: string) {
  const [plan, currentBytes] = await Promise.all([
    getInstitutionPlanLimits(institutionId),
    getUsageCounterValue(institutionId, "storage_bytes", "all_time")
  ]);
  const rawMb = plan.limits.max_storage_mb;
  const limitMb = typeof rawMb === "number" ? rawMb : Number(rawMb ?? NaN);
  const hasLimit = Number.isFinite(limitMb) && limitMb >= 0;
  const limitBytes = hasLimit ? Math.round(limitMb * 1024 * 1024) : null;
  const percent = limitBytes && limitBytes > 0 ? currentBytes / limitBytes : null;
  return {
    target: "storage" as const,
    metricKey: "storage_bytes" as const,
    currentBytes,
    currentMb: Math.round((currentBytes / (1024 * 1024)) * 100) / 100,
    limitMb: hasLimit ? limitMb : null,
    limitBytes,
    allowed: limitBytes == null ? true : currentBytes <= limitBytes,
    percentUsed: percent == null ? null : Math.round(percent * 10000) / 100,
    planCode: plan.planCode,
    planName: plan.planName
  };
}

export function getUsageWarnings(snapshot: Awaited<ReturnType<typeof getInstitutionUsageSnapshot>>) {
  const warnings: Array<{
    key: string;
    tone: "warning" | "critical";
    title: string;
    message: string;
  }> = [];

  const checks = [
    { key: "questions", label: "Questions", check: snapshot.metrics.questions },
    { key: "exams", label: "Exams", check: snapshot.metrics.exams },
    { key: "pins", label: "PINs", check: snapshot.metrics.pins },
    { key: "admins", label: "Admin seats", check: snapshot.metrics.admins }
  ] as const;

  for (const item of checks) {
    const limit = item.check.limit;
    if (limit == null || limit <= 0) continue;
    const percent = (item.check.current / limit) * 100;
    if (percent >= 100) {
      warnings.push({
        key: item.key,
        tone: "critical",
        title: `${item.label} limit reached`,
        message: `Current usage (${item.check.current}) has reached the plan limit (${limit}). New actions will be blocked.`
      });
    } else if (percent >= 80) {
      warnings.push({
        key: item.key,
        tone: "warning",
        title: `${item.label} nearing limit`,
        message: `${Math.round(percent)}% of the plan limit is used (${item.check.current}/${limit}). Consider cleanup or upgrading.`
      });
    }
  }

  if (snapshot.metrics.adminInviteCapacity.limit != null) {
    const reserved = snapshot.metrics.adminInviteCapacity.currentReserved;
    const limit = snapshot.metrics.adminInviteCapacity.limit;
    const percent = limit > 0 ? (reserved / limit) * 100 : 0;
    if (percent >= 100) {
      warnings.push({
        key: "admin-invite-capacity",
        tone: "critical",
        title: "Admin seat capacity reached",
        message: "Active admins plus pending invites have reached the seat limit. New invites are blocked."
      });
    } else if (percent >= 80) {
      warnings.push({
        key: "admin-invite-capacity",
        tone: "warning",
        title: "Admin seat capacity nearly full",
        message: `${reserved}/${limit} seats are reserved (active + pending invites).`
      });
    }
  }

  if (snapshot.metrics.storage.limitMb != null && snapshot.metrics.storage.percentUsed != null) {
    if (snapshot.metrics.storage.percentUsed >= 100) {
      warnings.push({
        key: "storage",
        tone: "critical",
        title: "Storage limit reached",
        message: `${snapshot.metrics.storage.currentMb} MB used of ${snapshot.metrics.storage.limitMb} MB. Uploads should be blocked until cleaned up or upgraded.`
      });
    } else if (snapshot.metrics.storage.percentUsed >= 80) {
      warnings.push({
        key: "storage",
        tone: "warning",
        title: "Storage nearing limit",
        message: `${snapshot.metrics.storage.currentMb} MB used of ${snapshot.metrics.storage.limitMb} MB (${Math.round(snapshot.metrics.storage.percentUsed)}%).`
      });
    }
  }

  return warnings;
}
