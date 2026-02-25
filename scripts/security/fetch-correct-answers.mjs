import { getBaseUrl, readJsonFixture, get, postJson, pass, fail, summarizeResponse } from "./_http.mjs";

function asTrimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isPlaceholder(value) {
  return /^REPLACE_WITH_/i.test(value);
}

function ensureConfigured(name, value) {
  if (!value) {
    fail(`Missing ${name} in fixture.`);
  }
  if (isPlaceholder(value)) {
    fail(`Fixture value ${name} is still a placeholder.`, [`value=${value}`]);
  }
}

function getScanText(response) {
  if (response.json && typeof response.json === "object") {
    try {
      return JSON.stringify(response.json);
    } catch {
      return "";
    }
  }
  return String(response.text || "");
}

function findForbiddenMarkers(text, markers) {
  return markers.filter((marker) => marker && text.includes(marker));
}

const { fixturePath, payload } = readJsonFixture("scripts/security/fixtures/fetch-correct-answers.json");
const pageProbe = payload.pageProbe ?? null;
const resumeApiProbe = payload.resumeApiProbe ?? null;
const forbiddenMarkersRaw = Array.isArray(payload.forbiddenMarkers) ? payload.forbiddenMarkers : [];
const forbiddenMarkers = [
  ...new Set(
    (forbiddenMarkersRaw.length ? forbiddenMarkersRaw : ["correct_answer", "short_answer_rules"])
      .map((value) => asTrimmedString(value))
      .filter(Boolean)
  )
];

if (!pageProbe && !resumeApiProbe) {
  fail(`Fixture must include pageProbe and/or resumeApiProbe: ${fixturePath}`);
}

const baseUrl = getBaseUrl();
const lines = [
  `fixture=${fixturePath}`,
  `forbiddenMarkers=${forbiddenMarkers.join(",")}`
];

if (pageProbe) {
  const attemptId = asTrimmedString(pageProbe.attemptId);
  ensureConfigured("pageProbe.attemptId", attemptId);

  const pageRes = await get(`${baseUrl}/candidate/exam/${encodeURIComponent(attemptId)}`, {
    headers: { accept: "text/html" }
  });
  if (!pageRes.ok) {
    fail("Candidate exam page probe failed; expected a renderable page for payload inspection.", [
      summarizeResponse("pageProbe", pageRes)
    ]);
  }

  const hits = findForbiddenMarkers(getScanText(pageRes), forbiddenMarkers);
  if (hits.length > 0) {
    fail("Candidate exam page payload appears to expose forbidden answer-key fields.", [
      summarizeResponse("pageProbe", pageRes),
      `markers=${hits.join(",")}`
    ]);
  }

  lines.push(`${summarizeResponse("pageProbe", pageRes)} markersDetected=0`);
}

if (resumeApiProbe) {
  const pin = asTrimmedString(resumeApiProbe.pin);
  const examId = asTrimmedString(resumeApiProbe.examId);
  const candidateIdentifier = asTrimmedString(resumeApiProbe.candidateIdentifier);
  const candidateName = asTrimmedString(resumeApiProbe.candidateName);

  ensureConfigured("resumeApiProbe.pin", pin);
  ensureConfigured("resumeApiProbe.examId", examId);
  if (!candidateIdentifier && !candidateName) {
    fail("resumeApiProbe requires candidateIdentifier and/or candidateName.");
  }
  if (candidateIdentifier && isPlaceholder(candidateIdentifier)) {
    fail("Fixture value resumeApiProbe.candidateIdentifier is still a placeholder.", [
      `value=${candidateIdentifier}`
    ]);
  }
  if (candidateName && isPlaceholder(candidateName)) {
    fail("Fixture value resumeApiProbe.candidateName is still a placeholder.", [`value=${candidateName}`]);
  }

  const resumeRes = await postJson(
    `${baseUrl}/api/candidate/attempts/resume`,
    {
      pin,
      examId,
      candidateIdentifier,
      candidateName
    },
    {
      headers: {
        origin: baseUrl
      }
    }
  );

  if (resumeRes.status >= 500) {
    fail("Resume API probe failed with server error while checking for answer-key exposure.", [
      summarizeResponse("resumeApiProbe", resumeRes)
    ]);
  }

  const allowedStatuses = new Set([200, 401, 404, 409]);
  if (!allowedStatuses.has(resumeRes.status)) {
    fail("Resume API probe returned an unexpected status.", [summarizeResponse("resumeApiProbe", resumeRes)]);
  }

  const hits = findForbiddenMarkers(getScanText(resumeRes), forbiddenMarkers);
  if (hits.length > 0) {
    fail("Resume API response appears to expose forbidden answer-key fields.", [
      summarizeResponse("resumeApiProbe", resumeRes),
      `markers=${hits.join(",")}`
    ]);
  }

  lines.push(`${summarizeResponse("resumeApiProbe", resumeRes)} markersDetected=0`);
}

pass("fetch-correct-answers", lines);
