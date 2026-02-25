export type IntegrityEventRow = {
  event_type: string;
  severity: string | null;
  metadata?: unknown;
  created_at?: string | null;
};

export type IntegrityScoreResult = {
  score: number;
  flagged: boolean;
  reviewStatus: "needs_review" | "clear";
  eventCount: number;
  severityCounts: { info: number; warning: number; critical: number };
  typeCounts: Record<string, number>;
  reasons: string[];
  summary: Record<string, unknown>;
};

const EVENT_WEIGHTS: Record<string, number> = {
  tab_hidden: 5,
  tab_visible: 0,
  fullscreen_exited: 12,
  fullscreen_entered: 0,
  timer_drift: 4,
  window_blur: 3,
  window_focus: 0,
  suspicious_client_event: 6
};

const SEVERITY_WEIGHTS: Record<string, number> = {
  info: 0,
  warning: 2,
  critical: 8
};

export function calculateIntegrityScore(events: IntegrityEventRow[]): IntegrityScoreResult {
  const severityCounts = { info: 0, warning: 0, critical: 0 };
  const typeCounts: Record<string, number> = {};
  let penalty = 0;

  for (const event of events) {
    const type = String(event.event_type ?? "").trim() || "unknown";
    const severity = normalizeSeverity(event.severity);
    severityCounts[severity] += 1;
    typeCounts[type] = Number(typeCounts[type] ?? 0) + 1;

    penalty += Number(EVENT_WEIGHTS[type] ?? 2);
    penalty += Number(SEVERITY_WEIGHTS[severity] ?? 0);

    if (type === "timer_drift") {
      const driftMs = getNumericMetadata(event.metadata, "driftMs");
      if (typeof driftMs === "number") {
        if (Math.abs(driftMs) >= 10000) penalty += 8;
        else if (Math.abs(driftMs) >= 5000) penalty += 4;
      }
    }
  }

  const score = clamp(100 - penalty, 0, 100);
  const reasons: string[] = [];
  if ((typeCounts.fullscreen_exited ?? 0) > 0) reasons.push("Fullscreen exited during attempt");
  if ((typeCounts.tab_hidden ?? 0) >= 2) reasons.push("Multiple tab/background switches detected");
  if ((typeCounts.timer_drift ?? 0) > 0) reasons.push("Client timer anomalies recorded");
  if (severityCounts.critical > 0) reasons.push("Critical integrity events recorded");
  if (events.length >= 10) reasons.push("High volume of integrity events");

  const flagged =
    score < 75 ||
    severityCounts.critical > 0 ||
    (typeCounts.fullscreen_exited ?? 0) >= 1 ||
    (typeCounts.tab_hidden ?? 0) >= 3 ||
    (typeCounts.timer_drift ?? 0) >= 2;

  return {
    score,
    flagged,
    reviewStatus: flagged ? "needs_review" : "clear",
    eventCount: events.length,
    severityCounts,
    typeCounts,
    reasons,
    summary: {
      scoreVersion: "v1",
      penalty,
      ...typeCounts,
      severityCounts
    }
  };
}

function normalizeSeverity(value: string | null | undefined): "info" | "warning" | "critical" {
  if (value === "critical" || value === "warning" || value === "info") return value;
  return "info";
}

function getNumericMetadata(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value * 100) / 100));
}
