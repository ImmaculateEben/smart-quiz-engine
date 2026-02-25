import { CandidatePinEntryForm } from "./candidate-pin-entry-form";

export default function CandidateEntryPage() {
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold">Candidate PIN Entry</h1>
        <p className="mt-2 text-sm text-slate-600">
          Candidate start/resume entry flow with registration fields, rate-limited PIN validation, allow-list checks,
          and resumable attempt lookup.
        </p>
        <CandidatePinEntryForm />
      </div>
    </main>
  );
}
