import { getBaseUrl, readJsonFixture, postJson, pass, fail, summarizeResponse } from "./_http.mjs";

const { fixturePath, payload } = readJsonFixture("scripts/security/fixtures/timer-manipulation.json");
const saveProbe = payload.saveAnswerProbe ?? null;
const submitProbe = payload.submitProbe ?? null;

if (!saveProbe && !submitProbe) {
  fail(`Fixture must include saveAnswerProbe and/or submitProbe: ${fixturePath}`);
}

const lines = [`fixture=${fixturePath}`];

if (saveProbe) {
  const attemptId = String(saveProbe.attemptId ?? "").trim();
  const examId = String(saveProbe.examId ?? "").trim();
  const questionId = String(saveProbe.questionId ?? "").trim();
  if (!attemptId || !examId || !questionId) {
    fail("saveAnswerProbe requires attemptId, examId, and questionId.");
  }

  const saveRes = await postJson(
    `${getBaseUrl()}/api/candidate/attempts/${attemptId}/answers`,
    {
      examId,
      questionId,
      answerPayload: saveProbe.answerPayload ?? { type: "security_probe" },
      currentQuestionIndex: 0,
      isFinal: false
    }
  );
  const saveError =
    saveRes.json && typeof saveRes.json === "object" && saveRes.json !== null
      ? String(saveRes.json.error ?? "")
      : "";
  const saveAllowed =
    (saveRes.status === 409 && saveError === "ATTEMPT_EXPIRED") ||
    (saveRes.status === 400 && saveError === "ATTEMPT_NOT_EDITABLE");
  if (!saveAllowed) {
    fail("Timer manipulation save probe did not return an expected server-side timer enforcement response.", [
      summarizeResponse("saveProbe", saveRes)
    ]);
  }
  lines.push(summarizeResponse("saveProbe", saveRes));
}

if (submitProbe) {
  const attemptId = String(submitProbe.attemptId ?? "").trim();
  if (!attemptId) {
    fail("submitProbe requires attemptId.");
  }
  const submitRes = await postJson(
    `${getBaseUrl()}/api/candidate/attempts/${attemptId}/submit`,
    {}
  );
  const submitError =
    submitRes.json && typeof submitRes.json === "object" && submitRes.json !== null
      ? String(submitRes.json.error ?? "")
      : "";
  const finalStatus =
    submitRes.json && typeof submitRes.json === "object" && submitRes.json !== null
      ? String(submitRes.json.finalStatus ?? "")
      : "";

  const submitAllowed =
    (submitRes.status === 200 && finalStatus === "auto_submitted") ||
    (submitRes.status === 400 && submitError === "ATTEMPT_NOT_EDITABLE") ||
    (submitRes.status === 409 && submitError === "SUBMIT_IN_PROGRESS");

  if (!submitAllowed) {
    fail("Timer manipulation submit probe did not return an expected response.", [
      summarizeResponse("submitProbe", submitRes),
      `finalStatus=${finalStatus || "-"}`
    ]);
  }

  lines.push(`${summarizeResponse("submitProbe", submitRes)} finalStatus=${finalStatus || "-"}`);
}

pass("timer-manipulation", lines);
