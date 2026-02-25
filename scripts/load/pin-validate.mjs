import fs from "node:fs";
import path from "node:path";
import { runLoadTest, printSummary } from "./_runner.mjs";

const baseUrl = process.env.CLAVIS_BASE_URL || "http://localhost:3000";
const endpoint = `${baseUrl.replace(/\/$/, "")}/api/pins/validate`;
const concurrency = Number(process.env.LOAD_CONCURRENCY || 50);
const totalRequests = Number(process.env.LOAD_TOTAL_REQUESTS || 1000);
const payloadPath =
  process.env.LOAD_PAYLOAD_FILE || path.resolve(process.cwd(), "scripts/load/fixtures/pin-validate.json");

const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));

const summary = await runLoadTest({
  name: "pin-validate",
  concurrency,
  totalRequests,
  requestFactory: async ({ index, workerId }) => {
    const requestId = `pin-${workerId}-${index}`;
    const body = {
      ...payload,
      candidateIdentifier:
        payload.candidateIdentifier && String(payload.candidateIdentifier).includes("{n}")
          ? String(payload.candidateIdentifier).replace("{n}", String(index))
          : payload.candidateIdentifier,
      candidateName:
        payload.candidateName && String(payload.candidateName).includes("{n}")
          ? String(payload.candidateName).replace("{n}", String(index))
          : payload.candidateName,
      requestId
    };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-load-test": "phase-7-5"
      },
      body: JSON.stringify(body)
    });

    return { ok: res.ok, status: res.status };
  }
});

printSummary(summary);
