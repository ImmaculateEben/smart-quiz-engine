import { getBaseUrl, readJsonFixture, postJson, pass, fail, summarizeResponse } from "./_http.mjs";

const { fixturePath, payload } = readJsonFixture("scripts/security/fixtures/duplicate-submit.json");
const attemptId = String(payload.attemptId ?? "").trim();
const concurrency = Number(process.env.SECURITY_CONCURRENCY || payload.concurrency || 5);

if (!attemptId) {
  fail(`Missing attemptId in fixture: ${fixturePath}`);
}
if (!Number.isFinite(concurrency) || concurrency < 2 || concurrency > 100) {
  fail(`Invalid SECURITY_CONCURRENCY value: ${String(concurrency)}`);
}

const url = `${getBaseUrl()}/api/candidate/attempts/${attemptId}/submit`;

const results = await Promise.all(
  Array.from({ length: concurrency }, () => postJson(url, {}))
);

const successCount = results.filter((r) => r.ok).length;
const invalids = results.filter((r) => {
  if (r.ok) return false;
  const errorCode =
    r.json && typeof r.json === "object" && r.json !== null ? String(r.json.error ?? "") : "";
  return !(
    (r.status === 409 && errorCode === "SUBMIT_IN_PROGRESS") ||
    (r.status === 400 && errorCode === "ATTEMPT_NOT_EDITABLE")
  );
});

if (successCount !== 1 || invalids.length > 0) {
  fail("Duplicate submit concurrency protection did not match expected behavior.", [
    `concurrency=${concurrency}`,
    `successCount=${successCount}`,
    ...results.map((r, i) => summarizeResponse(`req${i + 1}`, r))
  ]);
}

pass("duplicate-submit", [
  `concurrency=${concurrency}`,
  `successCount=${successCount}`,
  ...results.map((r, i) => summarizeResponse(`req${i + 1}`, r))
]);
