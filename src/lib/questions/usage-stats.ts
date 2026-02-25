import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function trackQuestionExposure(params: {
  institutionId: string;
  questionId: string;
  incrementBy?: number;
}) {
  const incrementBy = params.incrementBy ?? 1;
  const supabase = await createSupabaseServerClient();

  const { error: usageError } = await supabase.rpc("increment_usage_counter", {
    p_institution_id: params.institutionId,
    p_metric_key: "question_exposures",
    p_metric_period: "all_time",
    p_increment_by: incrementBy
  });
  if (usageError) throw usageError;

  const { error: questionError } = await supabase.rpc("increment_usage_counter", {
    p_institution_id: params.institutionId,
    p_metric_key: "question_analytics_updates",
    p_metric_period: "all_time",
    p_increment_by: incrementBy
  });
  if (questionError) throw questionError;

  const { data: row, error: rowErr } = await supabase
    .from("questions")
    .select("usage_count")
    .eq("id", params.questionId)
    .eq("institution_id", params.institutionId)
    .single();
  if (rowErr) throw rowErr;

  const nextUsageCount = Number((row as { usage_count?: number }).usage_count ?? 0) + incrementBy;
  const { error: updateQuestionErr } = await supabase
    .from("questions")
    .update({ usage_count: nextUsageCount })
    .eq("id", params.questionId)
    .eq("institution_id", params.institutionId);
  if (updateQuestionErr) throw updateQuestionErr;

  const { data: analytics, error: analyticsReadErr } = await supabase
    .from("question_analytics")
    .select("id, exposure_count")
    .eq("question_id", params.questionId)
    .eq("institution_id", params.institutionId)
    .maybeSingle();
  if (analyticsReadErr) throw analyticsReadErr;

  if (!analytics) {
    const { error: insertErr } = await supabase.from("question_analytics").insert({
      institution_id: params.institutionId,
      question_id: params.questionId,
      exposure_count: incrementBy
    });
    if (insertErr) throw insertErr;
    return;
  }

  const { error: updateErr } = await supabase
    .from("question_analytics")
    .update({
      exposure_count: Number((analytics as { exposure_count?: number }).exposure_count ?? 0) + incrementBy
    })
    .eq("id", (analytics as { id: string }).id);
  if (updateErr) throw updateErr;
}
