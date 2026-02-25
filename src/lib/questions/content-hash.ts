import { createHash } from "crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export function buildQuestionContentHash(input: {
  subjectId: string;
  questionType: string;
  prompt: string;
  options: unknown;
  correctAnswer: unknown;
  shortAnswerRules: unknown;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        subjectId: input.subjectId,
        questionType: input.questionType,
        prompt: input.prompt.trim(),
        options: input.options ?? null,
        correctAnswer: input.correctAnswer,
        shortAnswerRules: input.shortAnswerRules ?? null
      })
    )
    .digest("hex");
}

export async function findDuplicateQuestionByHash(params: {
  institutionId: string;
  contentHash: string;
  excludeQuestionId?: string;
}) {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("questions")
    .select("id, prompt, subject_id, question_type")
    .eq("institution_id", params.institutionId)
    .eq("content_hash", params.contentHash);

  if (params.excludeQuestionId) {
    query = query.neq("id", params.excludeQuestionId);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}
