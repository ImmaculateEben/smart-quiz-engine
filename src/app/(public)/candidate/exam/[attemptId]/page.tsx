import { notFound } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { CandidateExamInterface } from "./ui";

export default async function CandidateExamPage({
  params
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;
  const admin = createSupabaseAdminClient();

  const { data: attempt } = await admin
    .from("exam_attempts")
    .select("id,institution_id,exam_id,status,started_at,expires_at,current_question_index,shuffled_question_order,candidate_id")
    .eq("id", attemptId)
    .single();
  if (!attempt) return notFound();

  const [{ data: exam }, { data: candidate }, { data: examQuestions }, { data: questionRows }, { data: answers }] =
    await Promise.all([
      admin
        .from("exams")
        .select("id,title,description,duration_minutes,shuffle_questions,shuffle_options,show_result_immediately,allow_review,max_attempts")
        .eq("id", attempt.exam_id)
        .eq("institution_id", attempt.institution_id)
        .single(),
      admin
        .from("candidates")
        .select("id,full_name,registration_data")
        .eq("id", attempt.candidate_id)
        .eq("institution_id", attempt.institution_id)
        .single(),
      admin
        .from("exam_questions")
        .select("id,question_id,display_order,points,required")
        .eq("exam_id", attempt.exam_id)
        .eq("institution_id", attempt.institution_id)
        .order("display_order", { ascending: true }),
      admin
        .from("questions")
        .select("id,question_type,prompt,explanation,options,difficulty,tags")
        .eq("institution_id", attempt.institution_id)
        .is("deleted_at", null),
      admin
        .from("attempt_answers")
        .select("question_id,answer_payload,saved_at,version_no")
        .eq("attempt_id", attempt.id)
        .eq("institution_id", attempt.institution_id)
    ]);

  if (!exam || !candidate) return notFound();

  const order = Array.isArray(attempt.shuffled_question_order) ? (attempt.shuffled_question_order as string[]) : [];
  const eqMap = new Map((examQuestions ?? []).map((eq) => [eq.question_id, eq]));
  const qMap = new Map((questionRows ?? []).map((q) => [q.id, q]));
  const orderedQuestionIds = order.length > 0 ? order : (examQuestions ?? []).map((eq) => eq.question_id);
  const questions = orderedQuestionIds
    .map((id) => {
      const q = qMap.get(id);
      const eq = eqMap.get(id);
      if (!q || !eq) return null;
      return {
        ...q,
        examQuestionId: eq.id,
        points: eq.points,
        required: eq.required
      };
    })
    .filter(Boolean);
  const answersMap = new Map((answers ?? []).map((a) => [a.question_id, a]));

  return (
    <CandidateExamInterface
      attempt={{
        id: attempt.id,
        examId: attempt.exam_id,
        status: attempt.status,
        startedAt: attempt.started_at,
        expiresAt: attempt.expires_at,
        currentQuestionIndex: attempt.current_question_index
      }}
      exam={exam}
      candidate={{ id: candidate.id, fullName: candidate.full_name }}
      questions={questions as Array<{
        id: string;
        examQuestionId: string;
        question_type: string;
        prompt: string;
        explanation: string | null;
        options: unknown;
        difficulty: string;
        tags: string[] | null;
        points: number;
        required: boolean;
      }>}
      initialAnswers={Object.fromEntries(
        [...answersMap.entries()].map(([qid, row]) => [qid, (row as { answer_payload: unknown }).answer_payload])
      )}
    />
  );
}
