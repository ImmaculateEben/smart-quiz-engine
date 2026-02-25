import { buildQuestionContentHash } from "@/lib/questions/content-hash";

export type ImportedQuestionDraft = {
  questionType: "mcq_single" | "mcq_multi" | "true_false" | "short_answer";
  subjectRef: string;
  difficulty: "easy" | "medium" | "hard";
  source: string | null;
  isActive: boolean;
  prompt: string;
  explanation: string | null;
  tags: string[];
  options: string[] | null;
  correctAnswer: unknown;
  shortAnswerRules: Record<string, unknown> | null;
};

export type ImportedQuestionResolved = ImportedQuestionDraft & {
  subjectId: string;
  contentHash: string;
};

export type XmlImportParseResult = {
  questions: ImportedQuestionDraft[];
  errors: Array<{ index: number; message: string }>;
};

function decodeXml(text: string) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function getAttrMap(tag: string) {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(/([a-zA-Z_:][\w:.-]*)\s*=\s*"([^"]*)"/g)) {
    attrs[match[1]] = decodeXml(match[2]);
  }
  return attrs;
}

function getSingleTag(inner: string, tag: string) {
  const match = inner.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1].trim()) : null;
}

function getTagMany(inner: string, tag: string) {
  return [...inner.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "gi"))].map((m) =>
    decodeXml(m[1].trim())
  );
}

function parseQuestion(index: number, rawQuestion: string): ImportedQuestionDraft {
  const openTag = rawQuestion.match(/^<question\b([^>]*)>/i);
  if (!openTag) throw new Error("Missing <question> tag");
  const attrs = getAttrMap(openTag[1] ?? "");

  const type = attrs.type as ImportedQuestionDraft["questionType"];
  if (!["mcq_single", "mcq_multi", "true_false", "short_answer"].includes(type)) {
    throw new Error("Invalid question type");
  }
  const difficulty = (attrs.difficulty ?? "medium") as ImportedQuestionDraft["difficulty"];
  if (!["easy", "medium", "hard"].includes(difficulty)) throw new Error("Invalid difficulty");
  const subjectRef = (attrs.subject ?? "").trim();
  if (!subjectRef) throw new Error("Missing subject attribute");
  const isActive = (attrs.active ?? "true").toLowerCase() !== "false";
  const source = attrs.source?.trim() || null;

  const inner = rawQuestion.replace(/^<question\b[^>]*>/i, "").replace(/<\/question>$/i, "");
  const prompt = getSingleTag(inner, "prompt");
  if (!prompt) throw new Error("Missing <prompt>");
  const explanation = getSingleTag(inner, "explanation");
  const tagsBlock = inner.match(/<tags>([\s\S]*?)<\/tags>/i)?.[1] ?? "";
  const tags = getTagMany(tagsBlock, "tag").filter(Boolean);

  let options: string[] | null = null;
  let correctAnswer: unknown = null;
  let shortAnswerRules: Record<string, unknown> | null = null;

  if (type === "mcq_single" || type === "mcq_multi") {
    const optionsInner = inner.match(/<options>([\s\S]*?)<\/options>/i)?.[1];
    if (!optionsInner) throw new Error("Missing <options> for MCQ question");
    const parsedOptions = [...optionsInner.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)];
    if (parsedOptions.length < 2) throw new Error("MCQ requires at least 2 options");

    options = [];
    const correctIndexes: number[] = [];
    parsedOptions.forEach((m, i) => {
      const optionAttrs = getAttrMap(m[1] ?? "");
      const text = decodeXml((m[2] ?? "").trim());
      if (!text) throw new Error(`Empty option text at option ${i + 1}`);
      options!.push(text);
      if ((optionAttrs.correct ?? "false").toLowerCase() === "true") correctIndexes.push(i);
    });

    if (type === "mcq_single") {
      if (correctIndexes.length !== 1) throw new Error("mcq_single requires exactly one correct option");
      correctAnswer = correctIndexes[0];
    } else {
      if (correctIndexes.length < 1) throw new Error("mcq_multi requires at least one correct option");
      correctAnswer = correctIndexes;
    }
  } else if (type === "true_false") {
    options = ["True", "False"];
    const answer = (getSingleTag(inner, "answer") ?? "").toLowerCase();
    if (!["true", "false"].includes(answer)) throw new Error("true_false <answer> must be true or false");
    correctAnswer = answer === "true";
  } else {
    const answer = getSingleTag(inner, "answer");
    if (!answer) throw new Error("short_answer requires <answer>");
    correctAnswer = answer;
    const rulesText = getSingleTag(inner, "shortAnswerRules");
    if (rulesText) {
      try {
        const parsed = JSON.parse(rulesText);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("shortAnswerRules must be JSON object");
        }
        shortAnswerRules = parsed as Record<string, unknown>;
      } catch {
        throw new Error("Invalid <shortAnswerRules> JSON");
      }
    } else {
      shortAnswerRules = {};
    }
  }

  return {
    questionType: type,
    subjectRef,
    difficulty,
    source,
    isActive,
    prompt,
    explanation,
    tags,
    options,
    correctAnswer,
    shortAnswerRules
  };
}

export function parseQuestionsXml(xml: string): XmlImportParseResult {
  const cleaned = xml.replace(/^\uFEFF/, "").trim();
  const rootMatch = cleaned.match(/<quiz\b[^>]*>([\s\S]*)<\/quiz>/i);
  if (!rootMatch) {
    return { questions: [], errors: [{ index: 0, message: "Root <quiz>...</quiz> not found" }] };
  }

  const inner = rootMatch[1];
  const blocks = [...inner.matchAll(/<question\b[\s\S]*?<\/question>/gi)].map((m) => m[0]);
  if (blocks.length === 0) {
    return { questions: [], errors: [{ index: 0, message: "No <question> entries found" }] };
  }

  const questions: ImportedQuestionDraft[] = [];
  const errors: Array<{ index: number; message: string }> = [];
  blocks.forEach((block, idx) => {
    try {
      questions.push(parseQuestion(idx + 1, block));
    } catch (error) {
      errors.push({ index: idx + 1, message: error instanceof Error ? error.message : "Unknown parse error" });
    }
  });

  return { questions, errors };
}

export function resolveImportedQuestions(params: {
  drafts: ImportedQuestionDraft[];
  subjects: Array<{ id: string; name: string; code: string | null }>;
}) {
  const subjectByCode = new Map<string, { id: string }>();
  const subjectByName = new Map<string, { id: string }>();
  params.subjects.forEach((s) => {
    if (s.code) subjectByCode.set(s.code.toLowerCase(), { id: s.id });
    subjectByName.set(s.name.toLowerCase(), { id: s.id });
  });

  const resolved: ImportedQuestionResolved[] = [];
  const errors: Array<{ index: number; message: string }> = [];

  params.drafts.forEach((draft, idx) => {
    const key = draft.subjectRef.toLowerCase();
    const subject = subjectByCode.get(key) ?? subjectByName.get(key);
    if (!subject) {
      errors.push({ index: idx + 1, message: `Subject not found: ${draft.subjectRef}` });
      return;
    }
    const contentHash = buildQuestionContentHash({
      subjectId: subject.id,
      questionType: draft.questionType,
      prompt: draft.prompt,
      options: draft.options,
      correctAnswer: draft.correctAnswer,
      shortAnswerRules: draft.shortAnswerRules
    });
    resolved.push({ ...draft, subjectId: subject.id, contentHash });
  });

  return { resolved, errors };
}
