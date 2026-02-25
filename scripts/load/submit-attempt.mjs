import fs from "node:fs";
import path from "node:path";
import { runLoadTest, printSummary } from "./_runner.mjs";

const baseUrl = process.env.CLAVIS_BASE_URL || "http://localhost:3000";
const concurrency = Number(process.env.LOAD_CONCURRENCY || 25);
const totalRequests = Number(process.env.LOAD_TOTAL_REQUESTS || 500);
const payloadPath =
  process.env.LOAD_PAYLOAD_FILE || path.resolve(process.cwd(), "scripts/load/fixtures/submit-attempt.json");

const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
const attemptIds = Array.isArray(payload.attemptIds) ? payload.attemptIds : [];
if (attemptIds.length === 0) {
  console.error("No attemptIds found in fixture. Provide scripts/load/fixtures/submit-attempt.json");
  process.exit(1);
}

const endpointFor = (attemptId) =>
  `${baseUrl.replace(/\/$/, "")}/api/candidate/attempts/${attemptId}/submit`;

const summary = await runLoadTest({
  name: "submit-attempt",
  concurrency,
  totalRequests,
  requestFactory: async ({ index }) => {
    const attemptId = attemptIds[index % attemptIds.length];
    const res = await fetch(endpointFor(attemptId), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-load-test": "phase-7-5"
      }
    });
    return { ok: res.ok, status: res.status };
  }
});

printSummary(summary);
