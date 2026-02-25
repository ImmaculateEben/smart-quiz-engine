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

async function parseResponse(response) {
  let json = null;
  let text = "";
  const contentType = (response.headers.get("content-type") || "").toLowerCase();

  if (contentType.includes("application/json")) {
    try {
      json = await response.json();
    } catch {
      json = null;
    }
  } else {
    try {
      text = await response.text();
    } catch {
      text = "";
    }
    return {
      ok: response.ok,
      status: response.status,
      json,
      text,
      contentType
    };
  }

  if (json === null) {
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
    text,
    contentType
  };
}

export async function request(url, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const headers = {
    "x-security-test": "phase-10-5",
    ...(options.headers && typeof options.headers === "object" ? options.headers : {})
  };
  const init = {
    method,
    headers
  };

  if (Object.prototype.hasOwnProperty.call(options, "jsonBody")) {
    init.body = JSON.stringify(options.jsonBody ?? {});
    if (!Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
      init.headers["content-type"] = "application/json";
    }
  } else if (Object.prototype.hasOwnProperty.call(options, "body")) {
    init.body = options.body;
  }

  const response = await fetch(url, init);
  return parseResponse(response);
}

export async function get(url, options = {}) {
  return request(url, { ...options, method: "GET" });
}

export async function postJson(url, body, options = {}) {
  return request(url, { ...options, method: "POST", jsonBody: body ?? {} });
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
  return `${label}: status=${res.status} ok=${res.ok} error=${errorCode || "-"}${res.contentType ? ` contentType=${res.contentType}` : ""}${res.text ? ` text=${res.text}` : ""}`;
}
