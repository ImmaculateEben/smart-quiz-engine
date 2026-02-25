import { getBaseUrl, readJsonFixture, postJson, pass, fail, summarizeResponse } from "./_http.mjs";

const { fixturePath, payload } = readJsonFixture("scripts/security/fixtures/replay-submit.json");
const attemptId = String(payload.attemptId ?? "").trim();

if (!attemptId) {
  fail(`Missing attemptId in fixture: ${fixturePath}`);
}

const url = `${getBaseUrl()}/api/candidate/attempts/${attemptId}/submit`;

const first = await postJson(url, {});
const second = await postJson(url, {});

const secondError =
  second.json && typeof second.json === "object" && second.json !== null ? String(second.json.error ?? "") : "";

const secondAllowed =
  (second.status === 400 && secondError === "ATTEMPT_NOT_EDITABLE") ||
  (second.status === 409 && secondError === "SUBMIT_IN_PROGRESS");

if (!first.ok) {
  fail("First submit request was expected to succeed.", [
    summarizeResponse("first", first),
    summarizeResponse("second", second)
  ]);
}

if (!secondAllowed) {
  fail("Replay submit request was not blocked with an expected response.", [
    summarizeResponse("first", first),
    summarizeResponse("second", second)
  ]);
}

pass("replay-submit", [summarizeResponse("first", first), summarizeResponse("second", second)]);
