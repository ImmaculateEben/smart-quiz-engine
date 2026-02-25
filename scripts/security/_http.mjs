import fs from "node:fs";
import path from "node:path";

export function getBaseUrl() {
  return (process.env.CLAVIS_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
}

export function readJsonFixture(defaultRelativePath) {
  const fixturePath =
    process.env.SECURITY_PAYLOAD_FILE || path.resolve(process.cwd(), defaultRelativePath);
  return {
    fixturePath,
    payload: JSON.parse(fs.readFileSync(fixturePath, "utf8"))
  };
}

export async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-security-test": "phase-10-5"
    },
    body: JSON.stringify(body ?? {})
  });

  let json = null;
  let text = "";
  try {
    json = await response.json();
  } catch {
    try {
      text = await response.text();
    } catch {
      text = "";
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    json,
    text
  };
}

export function printCaseResult(name, details) {
  console.log(`Security test: ${name}`);
  for (const line of details) console.log(line);
}

export function fail(message, extraLines = []) {
  printCaseResult("FAILED", [message, ...extraLines]);
  process.exit(1);
}

export function pass(name, lines) {
  printCaseResult(name, [`PASS`, ...lines]);
}

export function summarizeResponse(label, res) {
  const errorCode =
    res?.json && typeof res.json === "object" && res.json !== null ? String(res.json.error ?? "") : "";
  return `${label}: status=${res.status} ok=${res.ok} error=${errorCode || "-"}${res.text ? ` text=${res.text}` : ""}`;
}
