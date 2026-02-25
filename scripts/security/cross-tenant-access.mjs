import { getBaseUrl, readJsonFixture, get, pass, fail, summarizeResponse } from "./_http.mjs";

function asTrimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isPlaceholder(value) {
  return /^REPLACE_WITH_/i.test(value);
}

const { fixturePath, payload } = readJsonFixture("scripts/security/fixtures/cross-tenant-access.json");
const cookie = asTrimmedString(process.env.SECURITY_COOKIE || payload.cookie);
const foreignExamId = asTrimmedString(payload.foreignExamId);
const format = asTrimmedString(payload.format).toLowerCase() === "pdf" ? "pdf" : "csv";
const routePath = asTrimmedString(payload.routePath) || "/api/admin/exports/exam-results";

if (!cookie) {
  fail(`Missing admin session cookie. Set fixture.cookie or SECURITY_COOKIE. Fixture: ${fixturePath}`);
}
if (isPlaceholder(cookie)) {
  fail("Fixture cookie is still a placeholder. Export a real authenticated admin session cookie first.");
}
if (!foreignExamId) {
  fail(`Missing foreignExamId in fixture: ${fixturePath}`);
}
if (isPlaceholder(foreignExamId)) {
  fail("Fixture foreignExamId is still a placeholder.");
}

const url = new URL(`${getBaseUrl()}${routePath}`);
url.searchParams.set("examId", foreignExamId);
url.searchParams.set("format", format);

const res = await get(url.toString(), {
  headers: {
    cookie,
    accept: format === "pdf" ? "application/pdf,application/json" : "text/csv,application/json"
  }
});

const errorCode =
  res.json && typeof res.json === "object" && res.json !== null ? String(res.json.error ?? "") : "";

const blockedAsForbidden = res.status === 403 && errorCode === "FORBIDDEN";
const blockedAsNotFound = res.status === 404 && errorCode === "EXAMS_NOT_FOUND";

if (!blockedAsForbidden && !blockedAsNotFound) {
  fail("Cross-tenant admin export access was not blocked as expected.", [
    `url=${url.toString()}`,
    summarizeResponse("crossTenantProbe", res),
    "Expected one of: 403 FORBIDDEN, 404 EXAMS_NOT_FOUND"
  ]);
}

pass("cross-tenant-access", [
  `fixture=${fixturePath}`,
  `url=${url.toString()}`,
  summarizeResponse("crossTenantProbe", res)
]);
