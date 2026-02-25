import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionAuthState } from "@/lib/auth/session";
import { hasInstitutionRole } from "@/lib/auth/rbac";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toCsv } from "@/lib/export/csv";
import { buildSimplePdf } from "@/lib/export/pdf";

function parseNumberParam(value: string | null) {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseDateParam(value: string | null, end = false) {
  if (!value) return null;
  const iso = end ? `${value}T23:59:59.999Z` : `${value}T00:00:00.000Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const YYYY_MM_DD_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const exportFiltersSchema = z
  .object({
    examIds: z.array(z.string().trim().min(1).max(128)).min(1).max(100),
    dateFrom: z.string().regex(YYYY_MM_DD_REGEX).optional(),
    dateTo: z.string().regex(YYYY_MM_DD_REGEX).optional(),
    minPercentage: z.coerce.number().min(0).max(100).optional(),
    maxPercentage: z.coerce.number().min(0).max(100).optional()
  })
  .refine(
    (value) =>
      value.minPercentage == null || value.maxPercentage == null || value.minPercentage <= value.maxPercentage,
    {
      message: "minPercentage must be less than or equal to maxPercentage"
    }
  );

export async function GET(request: Request) {
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "pdf" ? "pdf" : "csv";
  const rawExamIds = [
    ...url.searchParams.getAll("examIds"),
    ...((url.searchParams.get("examId") ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean))
  ];
  const rawMinPercentage = url.searchParams.get("minPercentage");
  const rawMaxPercentage = url.searchParams.get("maxPercentage");
  const parsedFilters = exportFiltersSchema.safeParse({
    examIds: [...new Set(rawExamIds.filter(Boolean))],
    dateFrom: url.searchParams.get("dateFrom") || undefined,
    dateTo: url.searchParams.get("dateTo") || undefined,
    minPercentage: rawMinPercentage == null || rawMinPercentage === "" ? undefined : rawMinPercentage,
    maxPercentage: rawMaxPercentage == null || rawMaxPercentage === "" ? undefined : rawMaxPercentage
  });
  if (!parsedFilters.success) {
    return NextResponse.json(
      { error: "INVALID_FILTERS", details: parsedFilters.error.flatten() },
      { status: 400 }
    );
  }

  const { examIds, dateFrom: rawDateFrom, dateTo: rawDateTo, minPercentage, maxPercentage } = parsedFilters.data;
  const dateFrom = parseDateParam(rawDateFrom ?? null, false);
  const dateTo = parseDateParam(rawDateTo ?? null, true);

  const auth = await getSessionAuthState();
  const membership = auth.memberships.find((m) => ["owner", "admin", "editor", "viewer"].includes(m.role)) ?? null;
  const canView =
    Boolean(auth.user) &&
    (Boolean(auth.context && hasInstitutionRole(auth.context, ["owner", "admin", "editor", "viewer"])) ||
      Boolean(membership));

  if (!auth.user || !membership || !canView) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  if (format === "pdf" && examIds.length !== 1) {
    return NextResponse.json({ error: "PDF_SINGLE_EXAM_ONLY" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const examsQuery = supabase
    .from("exams")
    .select("id,title,status,passing_score")
    .eq("institution_id", membership.institutionId)
    .in("id", examIds);
  const { data: exams } = await examsQuery;
  const allowedExamIds = new Set((exams ?? []).map((e) => e.id));
  const validExamIds = examIds.filter((id) => allowedExamIds.has(id));
  if (validExamIds.length === 0) {
    return NextResponse.json({ error: "EXAMS_NOT_FOUND" }, { status: 404 });
  }

  let resultsQuery = supabase
    .from("exam_results")
    .select("attempt_id,exam_id,candidate_id,total_questions,answered_questions,correct_count,incorrect_count,score,percentage,grade_letter,integrity_score,created_at")
    .eq("institution_id", membership.institutionId)
    .in("exam_id", validExamIds)
    .order("created_at", { ascending: false })
    .limit(5000);

  if (dateFrom) resultsQuery = resultsQuery.gte("created_at", dateFrom);
  if (dateTo) resultsQuery = resultsQuery.lte("created_at", dateTo);
  if (minPercentage != null) resultsQuery = resultsQuery.gte("percentage", minPercentage);
  if (maxPercentage != null) resultsQuery = resultsQuery.lte("percentage", maxPercentage);

  const { data: results } = await resultsQuery;
  const resultRows = results ?? [];

  const candidateIds = [...new Set(resultRows.map((r) => r.candidate_id).filter(Boolean))];
  const attemptIds = [...new Set(resultRows.map((r) => r.attempt_id).filter(Boolean))];
  const [{ data: candidates }, { data: attempts }] = await Promise.all([
    candidateIds.length
      ? supabase.from("candidates").select("id,full_name").eq("institution_id", membership.institutionId).in("id", candidateIds)
      : Promise.resolve({ data: [] }),
    attemptIds.length
      ? supabase.from("exam_attempts").select("id,status,submitted_at").eq("institution_id", membership.institutionId).in("id", attemptIds)
      : Promise.resolve({ data: [] })
  ]);
  const examMap = new Map((exams ?? []).map((e) => [e.id, e]));
  const candidateMap = new Map((candidates ?? []).map((c) => [c.id, c]));
  const attemptMap = new Map((attempts ?? []).map((a) => [a.id, a]));

  const exportRows = resultRows.map((r) => {
    const exam = examMap.get(r.exam_id);
    const candidate = candidateMap.get(r.candidate_id);
    const attempt = attemptMap.get(r.attempt_id);
    const passingScore = exam?.passing_score == null ? null : Number(exam.passing_score);
    const pct = Number(r.percentage ?? 0);
    return {
      exam_id: r.exam_id,
      exam_title: exam?.title ?? r.exam_id,
      candidate_id: r.candidate_id,
      candidate_name: candidate?.full_name ?? "",
      attempt_id: r.attempt_id,
      attempt_status: attempt?.status ?? "",
      submitted_at: r.created_at,
      total_questions: r.total_questions,
      answered_questions: r.answered_questions,
      correct_count: r.correct_count,
      incorrect_count: r.incorrect_count,
      score: r.score,
      percentage: r.percentage,
      grade_letter: r.grade_letter,
      integrity_score: r.integrity_score,
      passing_score: passingScore,
      passed: passingScore == null ? "" : pct >= passingScore
    };
  });

  if (format === "csv") {
    const csv = toCsv(exportRows, [
      "exam_id",
      "exam_title",
      "candidate_id",
      "candidate_name",
      "attempt_id",
      "attempt_status",
      "submitted_at",
      "total_questions",
      "answered_questions",
      "correct_count",
      "incorrect_count",
      "score",
      "percentage",
      "grade_letter",
      "integrity_score",
      "passing_score",
      "passed"
    ]);
    const filename = validExamIds.length > 1 ? "exam-results-bulk.csv" : `exam-results-${validExamIds[0]}.csv`;
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`
      }
    });
  }

  const exam = examMap.get(validExamIds[0]);
  const percentages = exportRows.map((r) => Number(r.percentage ?? 0));
  const avgPct = percentages.length ? percentages.reduce((a, b) => a + b, 0) / percentages.length : 0;
  const integrityVals = exportRows.map((r) => Number(r.integrity_score ?? 100));
  const avgIntegrity = integrityVals.length ? integrityVals.reduce((a, b) => a + b, 0) / integrityVals.length : 0;
  const passingScore = exam?.passing_score == null ? null : Number(exam.passing_score);
  const passCount =
    passingScore == null ? null : exportRows.filter((r) => Number(r.percentage ?? 0) >= passingScore).length;
  const lines = [
    `Exam: ${exam?.title ?? validExamIds[0]}`,
    `Exported rows: ${exportRows.length}`,
    `Average percentage: ${avgPct.toFixed(2)}%`,
    `Average integrity score: ${avgIntegrity.toFixed(2)}`,
    `Pass rate: ${passCount == null || exportRows.length === 0 ? "n/a" : `${((passCount / exportRows.length) * 100).toFixed(2)}%`}`,
    `Filters: dateFrom=${url.searchParams.get("dateFrom") ?? ""}, dateTo=${url.searchParams.get("dateTo") ?? ""}, minPercentage=${url.searchParams.get("minPercentage") ?? ""}, maxPercentage=${url.searchParams.get("maxPercentage") ?? ""}`,
    "",
    "Recent submissions:",
    ...exportRows.slice(0, 25).map(
      (r, i) =>
        `${i + 1}. ${r.candidate_name || r.candidate_id} | ${r.percentage}% | grade ${r.grade_letter || "-"} | integrity ${r.integrity_score ?? "-"} | ${r.submitted_at}`
    )
  ];
  const pdf = buildSimplePdf({
    title: `Clavis Exam Report - ${exam?.title ?? validExamIds[0]}`,
    lines
  });
  return new NextResponse(pdf, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="exam-report-${validExamIds[0]}.pdf"`
    }
  });
}
