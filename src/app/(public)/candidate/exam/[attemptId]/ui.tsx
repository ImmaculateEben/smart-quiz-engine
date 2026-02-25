"use client";

import type { Dispatch, SetStateAction } from "react";
import { useEffect, useMemo, useState } from "react";

type Question = {
  id: string;
  examQuestionId: string;
  question_type: string;
  prompt: string;
  explanation: string | null;
  options: unknown;
  difficulty: string;
  tags: string[] | null;
  points: number;
  required: boolean;
};

export function CandidateExamInterface(props: {
  attempt: {
    id: string;
    examId: string;
    status: string;
    startedAt: string;
    expiresAt: string | null;
    currentQuestionIndex: number;
  };
  exam: {
    id: string;
    title: string;
    description: string | null;
    duration_minutes: number;
    shuffle_questions: boolean;
    shuffle_options: boolean;
    show_result_immediately: boolean;
    allow_review: boolean;
    max_attempts: number;
  };
  candidate: { id: string; fullName: string };
  questions: Question[];
  initialAnswers: Record<string, unknown>;
}) {
  const [index, setIndex] = useState(
    Math.min(Math.max(0, props.attempt.currentQuestionIndex ?? 0), Math.max(0, props.questions.length - 1))
  );
  const [answers, setAnswers] = useState<Record<string, unknown>>(props.initialAnswers ?? {});
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [submitState, setSubmitState] = useState<"idle" | "submitting" | "submitted" | "error">("idle");
  const [timeoutTriggered, setTimeoutTriggered] = useState(false);
  const [integrityCount, setIntegrityCount] = useState(0);

  const current = props.questions[index];
  const total = props.questions.length;
  const answeredCount = useMemo(
    () => props.questions.filter((q) => hasAnswer(answers[q.id])).length,
    [answers, props.questions]
  );

  const secondsRemaining = useCountdown(props.attempt.expiresAt);
  const showFiveMinuteWarning = Number.isFinite(secondsRemaining) && secondsRemaining > 0 && secondsRemaining <= 300;
  const showOneMinuteWarning = Number.isFinite(secondsRemaining) && secondsRemaining > 0 && secondsRemaining <= 60;

  useEffect(() => {
    const timer = setInterval(() => {
      void saveProgress(false);
    }, 30000);
    return () => clearInterval(timer);
  }, [index, answers]); // acceptable here for scaffold; saves latest closure data

  useEffect(() => {
    if (!Number.isFinite(secondsRemaining)) return;
    if (secondsRemaining > 0) return;
    if (timeoutTriggered || submitState === "submitting" || submitState === "submitted") return;
    setTimeoutTriggered(true);
    void submitAttempt();
  }, [secondsRemaining, timeoutTriggered, submitState]);

  useIntegrityTracking({
    attemptId: props.attempt.id,
    enabled: submitState !== "submitted",
    setIntegrityCount
  });

  async function saveProgress(showStatus = true) {
    if (!current) return;
    if (showStatus) setSaveState("saving");
    try {
      const response = await fetch(`/api/candidate/attempts/${props.attempt.id}/answers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          examId: props.attempt.examId,
          questionId: current.id,
          answerPayload: answers[current.id] ?? null,
          currentQuestionIndex: index,
          isFinal: false
        })
      });
      if (!response.ok) throw new Error("save_failed");
      setSaveState("saved");
      if (!showStatus) return;
      setTimeout(() => setSaveState("idle"), 1200);
    } catch {
      setSaveState("error");
    }
  }

  async function submitAttempt() {
    if (!current) return;
    setSubmitState("submitting");
    try {
      await saveProgress(false);
      const response = await fetch(`/api/candidate/attempts/${props.attempt.id}/submit`, { method: "POST" });
      if (!response.ok) {
        let errorCode = "";
        try {
          const payload = (await response.json()) as { error?: string };
          errorCode = String(payload.error ?? "");
        } catch {
          // Ignore parse failure and fall back to generic submit error handling.
        }
        if (response.status === 409 && errorCode === "SUBMIT_IN_PROGRESS") {
          setSubmitState("submitting");
          return;
        }
        if (response.status === 400 && errorCode === "ATTEMPT_NOT_EDITABLE") {
          setSubmitState("submitted");
          return;
        }
        throw new Error("submit_failed");
      }
      setSubmitState("submitted");
    } catch {
      setSubmitState("error");
    }
  }

  if (!current) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-semibold">No questions in this exam</h1>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="grid gap-6 lg:grid-cols-[0.3fr_0.7fr]">
        <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">{props.exam.title}</h1>
          <p className="mt-1 text-sm text-slate-600">{props.candidate.fullName}</p>
          <div className="mt-4 grid gap-3">
            <Stat label="Progress" value={`${answeredCount}/${total}`} />
            <Stat label="Question" value={`${index + 1}/${total}`} />
            <Stat label="Time Left" value={formatDuration(secondsRemaining)} danger={secondsRemaining <= 300} />
            <Stat label="Integrity Flags" value={String(integrityCount)} danger={integrityCount > 0} />
          </div>

          <div className="mt-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Navigate</p>
            <div className="grid grid-cols-5 gap-2 sm:grid-cols-6 lg:grid-cols-4">
              {props.questions.map((q, i) => {
                const active = i === index;
                const answered = hasAnswer(answers[q.id]);
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => setIndex(i)}
                    className={`rounded-lg border px-2 py-2 text-xs font-semibold ${
                      active
                        ? "border-slate-900 bg-slate-900 text-white"
                        : answered
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                    aria-label={`Go to question ${i + 1}`}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-5 space-y-2">
            <button
              type="button"
              onClick={() => void saveProgress(true)}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Save progress
            </button>
            <button
              type="button"
              onClick={() => void submitAttempt()}
              disabled={submitState === "submitting" || submitState === "submitted"}
              className="w-full rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {submitState === "submitting" ? "Submitting..." : submitState === "submitted" ? "Submitted" : "Submit attempt"}
            </button>
            <div className="text-xs text-slate-500">
              {saveState === "saving" && "Saving..."}
              {saveState === "saved" && "Saved."}
              {saveState === "error" && "Save failed."}
              {submitState === "error" && " Submission failed."}
            </div>
          </div>
        </aside>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          {showFiveMinuteWarning ? (
            <div className={`mb-4 rounded-xl border px-4 py-3 text-sm ${showOneMinuteWarning ? "border-rose-200 bg-rose-50 text-rose-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
              {showOneMinuteWarning ? "Less than 1 minute remaining. Save and review quickly." : "5-minute warning: your attempt will auto-submit at timeout."}
            </div>
          ) : null}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                Question {index + 1}
              </p>
              <p className="mt-2 text-lg font-semibold text-slate-900">{current.prompt}</p>
            </div>
            <div className="text-right text-xs text-slate-500">
              <p>{current.question_type}</p>
              <p>{current.difficulty}</p>
              <p>{current.points} pt{current.points === 1 ? "" : "s"}</p>
            </div>
          </div>

          <div className="mt-6">
            <QuestionAnswerInput
              question={current}
              value={answers[current.id]}
              onChange={(value) => setAnswers((prev) => ({ ...prev, [current.id]: value }))}
            />
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              disabled={index === 0}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Previous
            </button>
            <div className="h-2 flex-1 rounded-full bg-slate-100">
              <div
                className="h-2 rounded-full bg-slate-900 transition-all"
                style={{ width: `${Math.max(4, Math.round(((index + 1) / Math.max(1, total)) * 100))}%` }}
              />
            </div>
            <button
              type="button"
              onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
              disabled={index >= total - 1}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Next
            </button>
          </div>

          {current.explanation ? (
            <details className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <summary className="cursor-pointer text-sm font-medium text-slate-700">Question notes (internal preview only)</summary>
              <p className="mt-2 text-sm text-slate-600">{current.explanation}</p>
            </details>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function useIntegrityTracking({
  attemptId,
  enabled,
  setIntegrityCount
}: {
  attemptId: string;
  enabled: boolean;
  setIntegrityCount: Dispatch<SetStateAction<number>>;
}) {
  useEffect(() => {
    if (!enabled) return;

    type EventItem = {
      type: string;
      severity: "info" | "warning" | "critical";
      occurredAt: string;
      metadata?: Record<string, unknown>;
    };

    let destroyed = false;
    let queue: EventItem[] = [];
    let flushing = false;
    let lastTickAt = Date.now();
    let tickInterval: number | null = null;

    const enqueue = (
      type: string,
      severity: "info" | "warning" | "critical" = "info",
      metadata?: Record<string, unknown>
    ) => {
      if (destroyed) return;
      queue.push({ type, severity, occurredAt: new Date().toISOString(), metadata });
      if (queue.length >= 5) void flush(false);
    };

    const flush = async (useBeacon: boolean) => {
      if (flushing || queue.length === 0) return;
      flushing = true;
      const batch = queue.slice(0, 20);
      queue = queue.slice(batch.length);
      const body = JSON.stringify({ events: batch });

      try {
        if (useBeacon && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
          const sent = navigator.sendBeacon(`/api/candidate/attempts/${attemptId}/integrity`, new Blob([body], { type: "application/json" }));
          if (sent) setIntegrityCount((prev) => prev + batch.length);
          else queue = [...batch, ...queue];
        } else {
          const res = await fetch(`/api/candidate/attempts/${attemptId}/integrity`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
            keepalive: true
          });
          if (res.ok) setIntegrityCount((prev) => prev + batch.length);
          else queue = [...batch, ...queue];
        }
      } catch {
        queue = [...batch, ...queue];
      } finally {
        flushing = false;
      }
    };

    const onVisibility = () => {
      enqueue(document.hidden ? "tab_hidden" : "tab_visible", document.hidden ? "warning" : "info", {
        visibilityState: document.visibilityState
      });
      void flush(false);
    };

    const onFullscreen = () => {
      const active = Boolean(document.fullscreenElement);
      enqueue(active ? "fullscreen_entered" : "fullscreen_exited", active ? "info" : "warning");
      void flush(false);
    };

    const onBlur = () => enqueue("window_blur", "warning");
    const onFocus = () => enqueue("window_focus", "info");

    const onPageHide = () => {
      enqueue("suspicious_client_event", "info", { reason: "pagehide_flush" });
      void flush(true);
    };

    tickInterval = window.setInterval(() => {
      const now = Date.now();
      const driftMs = now - lastTickAt - 1000;
      if (Math.abs(driftMs) > 1500) {
        enqueue("timer_drift", "warning", { driftMs });
        void flush(false);
      }
      lastTickAt = now;
    }, 1000);

    const periodicFlush = window.setInterval(() => {
      void flush(false);
    }, 15000);

    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("fullscreenchange", onFullscreen);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      destroyed = true;
      if (tickInterval) window.clearInterval(tickInterval);
      window.clearInterval(periodicFlush);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("fullscreenchange", onFullscreen);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pagehide", onPageHide);
      if (queue.length > 0) {
        const body = JSON.stringify({ events: queue.slice(0, 20) });
        try {
          if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
            navigator.sendBeacon(`/api/candidate/attempts/${attemptId}/integrity`, new Blob([body], { type: "application/json" }));
          }
        } catch {}
      }
    };
  }, [attemptId, enabled, setIntegrityCount]);
}

function QuestionAnswerInput({
  question,
  value,
  onChange
}: {
  question: Question;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const options = Array.isArray(question.options) ? (question.options as unknown[]) : [];

  if (question.question_type === "mcq_single" || question.question_type === "true_false") {
    return (
      <fieldset className="space-y-3">
        <legend className="sr-only">Select one answer</legend>
        {options.map((opt, idx) => (
          <label key={idx} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 hover:bg-slate-50">
            <input
              type="radio"
              name={`q-${question.id}`}
              checked={value === idx || (question.question_type === "true_false" && value === (idx === 0))}
              onChange={() => onChange(question.question_type === "true_false" ? idx === 0 : idx)}
              className="mt-1"
            />
            <span className="text-sm text-slate-800">{String(opt)}</span>
          </label>
        ))}
      </fieldset>
    );
  }

  if (question.question_type === "mcq_multi") {
    const selected = Array.isArray(value) ? (value as number[]) : [];
    return (
      <fieldset className="space-y-3">
        <legend className="sr-only">Select one or more answers</legend>
        {options.map((opt, idx) => {
          const checked = selected.includes(idx);
          return (
            <label key={idx} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 hover:bg-slate-50">
              <input
                type="checkbox"
                checked={checked}
                onChange={() =>
                  onChange(
                    checked ? selected.filter((v) => v !== idx) : [...selected, idx].sort((a, b) => a - b)
                  )
                }
                className="mt-1"
              />
              <span className="text-sm text-slate-800">{String(opt)}</span>
            </label>
          );
        })}
      </fieldset>
    );
  }

  return (
    <div>
      <label htmlFor={`short-${question.id}`} className="mb-2 block text-sm font-medium text-slate-700">
        Your answer
      </label>
      <textarea
        id={`short-${question.id}`}
        rows={4}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none"
      />
    </div>
  );
}

function hasAnswer(value: unknown) {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return true;
  return Object.keys(value as object).length > 0;
}

function useCountdown(expiresAt: string | null) {
  const [seconds, setSeconds] = useState(() => {
    if (!expiresAt) return Number.POSITIVE_INFINITY;
    return Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  });

  useEffect(() => {
    if (!expiresAt) return;
    const timer = setInterval(() => {
      setSeconds(Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  return seconds;
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds)) return "No limit";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-sm font-semibold ${danger ? "text-rose-700" : "text-slate-900"}`}>{value}</p>
    </div>
  );
}
