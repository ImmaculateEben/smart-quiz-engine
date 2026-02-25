"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ResultState =
  | { type: "idle" }
  | { type: "loading"; intent: "start" | "resume" }
  | { type: "success"; data: { examId: string; pinId: string; remainingUses: number; attemptId?: string | null } }
  | { type: "resumed"; data: { examId: string; attemptId: string } }
  | { type: "error"; message: string; status?: number };

export function CandidatePinEntryForm() {
  const router = useRouter();
  const [result, setResult] = useState<ResultState>({ type: "idle" });

  async function onSubmit(formData: FormData) {
    const intent = String(formData.get("intent") ?? "start") === "resume" ? "resume" : "start";
    setResult({ type: "loading", intent });

    const payload = {
      examId: String(formData.get("examId") ?? "").trim(),
      pin: String(formData.get("pin") ?? "").trim(),
      candidateIdentifier: String(formData.get("candidateIdentifier") ?? "").trim(),
      candidateName: String(formData.get("candidateName") ?? "").trim()
    };

    if (intent === "start" && !payload.candidateName) {
      setResult({ type: "error", message: "Candidate name is required to start an attempt." });
      return;
    }
    if (intent === "resume" && !payload.candidateName && !payload.candidateIdentifier) {
      setResult({ type: "error", message: "Provide candidate name or identifier to resume." });
      return;
    }

    try {
      const response = await fetch(intent === "resume" ? "/api/candidate/attempts/resume" : "/api/pins/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(intent === "resume" ? payload : { ...payload, startAttempt: true })
      });
      const data = await response.json();
      if (!response.ok) {
        const message =
          data.error === "RATE_LIMITED"
            ? "Too many failed attempts. Try again later."
            : data.error === "RESUME_NOT_FOUND"
              ? "No matching resumable attempt was found."
              : data.error === "RESUME_AMBIGUOUS"
                ? "More than one active attempt matched. Use a unique candidate identifier."
                : data.error === "ATTEMPT_NOT_RESUMABLE"
                  ? "The matched attempt is already submitted and cannot be resumed."
                  : data.error === "ATTEMPT_EXPIRED"
                    ? "The matched attempt has expired and was auto-submitted."
                    : data.error === "CANDIDATE_MATCH_REQUIRED"
                      ? "Provide candidate name or identifier to resume."
            : data.error === "INVALID_PIN"
              ? "PIN validation failed."
              : data.error === "CANDIDATE_NAME_REQUIRED"
                ? "Candidate name is required."
              : "Unable to validate PIN.";
        setResult({ type: "error", message, status: response.status });
        return;
      }
      if (data.attemptId) {
        router.push(`/candidate/exam/${data.attemptId}`);
        return;
      }
      if (intent === "resume") {
        setResult({
          type: "resumed",
          data: {
            examId: data.examId,
            attemptId: data.attemptId
          }
        });
        return;
      }
      setResult({
        type: "success",
        data: {
          examId: data.examId,
          pinId: data.pinId,
          remainingUses: data.remainingUses,
          attemptId: data.attemptId ?? null
        }
      });
    } catch {
      setResult({ type: "error", message: "Network error while validating PIN." });
    }
  }

  return (
    <div className="mt-6 space-y-4">
      <form action={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="examId" className="mb-2 block text-sm font-medium text-slate-700">
            Exam ID
          </label>
          <input
            id="examId"
            name="examId"
            required
            placeholder="Paste exam ID"
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="pin" className="mb-2 block text-sm font-medium text-slate-700">
            PIN
          </label>
          <input
            id="pin"
            name="pin"
            required
            autoComplete="one-time-code"
            placeholder="Enter exam PIN"
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm tracking-widest focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="candidateName" className="mb-2 block text-sm font-medium text-slate-700">
              Candidate name
            </label>
            <input
              id="candidateName"
              name="candidateName"
              placeholder="Jane Doe"
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="candidateIdentifier" className="mb-2 block text-sm font-medium text-slate-700">
              Candidate identifier
            </label>
            <input
              id="candidateIdentifier"
              name="candidateIdentifier"
              placeholder="student-id / email"
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>

        <button
          type="submit"
          name="intent"
          value="start"
          disabled={result.type === "loading"}
          className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {result.type === "loading" && result.intent === "start" ? "Starting..." : "Start exam"}
        </button>
        <button
          type="submit"
          name="intent"
          value="resume"
          disabled={result.type === "loading"}
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {result.type === "loading" && result.intent === "resume" ? "Finding attempt..." : "Resume existing attempt"}
        </button>
      </form>

      {result.type === "error" ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {result.message}
          {result.status ? ` (HTTP ${result.status})` : ""}
        </div>
      ) : null}

      {result.type === "success" ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          PIN validated for exam <code>{result.data.examId}</code>. Remaining uses: {result.data.remainingUses}.
        </div>
      ) : null}

      {result.type === "resumed" ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Resumed attempt for exam <code>{result.data.examId}</code>. Redirecting to your saved session...
        </div>
      ) : null}
    </div>
  );
}
