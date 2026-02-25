type QuestionType = "mcq_single" | "mcq_multi" | "true_false" | "short_answer";

type ScoreAttemptInput = {
  exam: {
    id: string;
    passingScore: number | null;
  };
  examQuestions: Array<{
    questionId: string;
    points: number;
  }>;
  questions: Array<{
    id: string;
    subjectId: string;
    questionType: string;
    correctAnswer: unknown;
    shortAnswerRules: unknown;
  }>;
  answers: Array<{
    questionId: string;
    answerPayload: unknown;
  }>;
};

type SubjectBucket = {
  totalQuestions: number;
  answeredQuestions: number;
  correctCount: number;
  incorrectCount: number;
  score: number;
  possibleScore: number;
  percentage: number;
};

export type ScoreAttemptOutput = {
  totalQuestions: number;
  answeredQuestions: number;
  correctCount: number;
  incorrectCount: number;
  score: number;
  percentage: number;
  gradeLetter: string | null;
  passed: boolean | null;
  subjectBreakdown: Record<string, SubjectBucket>;
  analyticsSnapshot: Record<string, unknown>;
  questionOutcomes: Array<{
    questionId: string;
    subjectId: string;
    answered: boolean;
    correct: boolean;
    pointsAwarded: number;
    possiblePoints: number;
    answerPayload: unknown;
  }>;
};

export function hasAnswerPayload(value: unknown) {
  return hasAnswer(value);
}

export function isQuestionAnswerCorrect(params: {
  questionType: string;
  correctAnswer: unknown;
  shortAnswerRules: unknown;
  answerPayload: unknown;
}) {
  return evaluateAnswer({
    questionType: params.questionType as QuestionType,
    correctAnswer: params.correctAnswer,
    shortAnswerRules: params.shortAnswerRules,
    answerPayload: params.answerPayload
  });
}

export function scoreAttempt(input: ScoreAttemptInput): ScoreAttemptOutput {
  const qMap = new Map(input.questions.map((q) => [q.id, q]));
  const aMap = new Map(input.answers.map((a) => [a.questionId, a.answerPayload]));

  let totalQuestions = 0;
  let answeredQuestions = 0;
  let correctCount = 0;
  let incorrectCount = 0;
  let totalPossiblePoints = 0;
  let awardedPoints = 0;
  const subjectBreakdown: Record<string, SubjectBucket> = {};
  const questionOutcomes: ScoreAttemptOutput["questionOutcomes"] = [];

  for (const eq of input.examQuestions) {
    const q = qMap.get(eq.questionId);
    if (!q) continue;

    totalQuestions += 1;
    const points = round2(Number(eq.points || 0));
    totalPossiblePoints = round2(totalPossiblePoints + points);

    const subjectId = q.subjectId || "unknown";
    const bucket = (subjectBreakdown[subjectId] ??= {
      totalQuestions: 0,
      answeredQuestions: 0,
      correctCount: 0,
      incorrectCount: 0,
      score: 0,
      possibleScore: 0,
      percentage: 0
    });
    bucket.totalQuestions += 1;
    bucket.possibleScore = round2(bucket.possibleScore + points);

    const answerPayload = aMap.get(eq.questionId);
    const answered = hasAnswer(answerPayload);
    if (answered) {
      answeredQuestions += 1;
      bucket.answeredQuestions += 1;
    }

    const correct = evaluateAnswer({
      questionType: q.questionType as QuestionType,
      correctAnswer: q.correctAnswer,
      shortAnswerRules: q.shortAnswerRules,
      answerPayload
    });

    if (correct) {
      correctCount += 1;
      bucket.correctCount += 1;
      awardedPoints = round2(awardedPoints + points);
      bucket.score = round2(bucket.score + points);
    } else {
      incorrectCount += 1;
      bucket.incorrectCount += 1;
    }

    questionOutcomes.push({
      questionId: q.id,
      subjectId,
      answered,
      correct,
      pointsAwarded: correct ? points : 0,
      possiblePoints: points,
      answerPayload
    });
  }

  for (const bucket of Object.values(subjectBreakdown)) {
    bucket.percentage = bucket.possibleScore > 0 ? round2((bucket.score / bucket.possibleScore) * 100) : 0;
  }

  const percentage = totalPossiblePoints > 0 ? round2((awardedPoints / totalPossiblePoints) * 100) : 0;
  const gradeLetter = gradeFromPercentage(percentage);
  const passingScore = input.exam.passingScore;
  const passed = typeof passingScore === "number" ? percentage >= passingScore : null;

  return {
    totalQuestions,
    answeredQuestions,
    correctCount,
    incorrectCount,
    score: awardedPoints,
    percentage,
    gradeLetter,
    passed,
    subjectBreakdown,
    analyticsSnapshot: {
      gradingVersion: "v1",
      totalPossiblePoints,
      passingScore,
      passed
    },
    questionOutcomes
  };
}

function evaluateAnswer(params: {
  questionType: QuestionType;
  correctAnswer: unknown;
  shortAnswerRules: unknown;
  answerPayload: unknown;
}) {
  if (!hasAnswer(params.answerPayload)) return false;

  switch (params.questionType) {
    case "mcq_single":
      return toInt(params.answerPayload) !== null && toInt(params.answerPayload) === toInt(params.correctAnswer);
    case "mcq_multi":
      return sameNumberSet(asNumberArray(params.answerPayload), asNumberArray(params.correctAnswer));
    case "true_false": {
      const user = toBoolean(params.answerPayload);
      const correct = toBoolean(params.correctAnswer);
      return user !== null && correct !== null && user === correct;
    }
    case "short_answer":
      return evaluateShortAnswer(params.answerPayload, params.correctAnswer, params.shortAnswerRules);
    default:
      return false;
  }
}

function evaluateShortAnswer(answerPayload: unknown, correctAnswer: unknown, shortAnswerRules: unknown) {
  const rules = isRecord(shortAnswerRules) ? shortAnswerRules : {};
  const caseSensitive = rules.caseSensitive === true;
  const trim = rules.trim !== false;
  const collapseWhitespace = rules.collapseWhitespace !== false;

  const acceptedRaw: string[] = [];
  if (typeof correctAnswer === "string") acceptedRaw.push(correctAnswer);
  if (Array.isArray(correctAnswer)) {
    for (const value of correctAnswer) {
      if (typeof value === "string") acceptedRaw.push(value);
    }
  }
  if (Array.isArray(rules.acceptedAnswers)) {
    for (const value of rules.acceptedAnswers) {
      if (typeof value === "string") acceptedRaw.push(value);
    }
  }
  const normalizedAnswer = normalizeString(String(answerPayload ?? ""), { caseSensitive, trim, collapseWhitespace });
  if (!normalizedAnswer) return false;

  const accepted = new Set(
    acceptedRaw
      .map((v) => normalizeString(v, { caseSensitive, trim, collapseWhitespace }))
      .filter(Boolean)
  );
  return accepted.has(normalizedAnswer);
}

function normalizeString(
  value: string,
  opts: { caseSensitive: boolean; trim: boolean; collapseWhitespace: boolean }
) {
  let next = value;
  if (opts.trim) next = next.trim();
  if (opts.collapseWhitespace) next = next.replace(/\s+/g, " ");
  if (!opts.caseSensitive) next = next.toLowerCase();
  return next;
}

function hasAnswer(value: unknown) {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return false;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toInt(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number.parseInt(value.trim(), 10);
  return null;
}

function asNumberArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((v) => toInt(v)).filter((v): v is number => v !== null))].sort((a, b) => a - b);
}

function sameNumberSet(left: number[], right: number[]) {
  if (left.length === 0 || right.length === 0) return false;
  if (left.length !== right.length) return false;
  return left.every((v, i) => v === right[i]);
}

function toBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (lower === "true") return true;
    if (lower === "false") return false;
  }
  return null;
}

function gradeFromPercentage(percentage: number) {
  if (!Number.isFinite(percentage)) return null;
  if (percentage >= 90) return "A";
  if (percentage >= 80) return "B";
  if (percentage >= 70) return "C";
  if (percentage >= 60) return "D";
  return "F";
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
