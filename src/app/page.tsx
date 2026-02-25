export default function HomePage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Clavis</p>
        <h1 className="mt-3 text-3xl font-bold text-slate-900">Enterprise Assessment Platform</h1>
        <p className="mt-3 max-w-2xl text-slate-600">
          Foundation scaffold for a multi-tenant examination system built with Next.js and Supabase.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <a className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 font-medium hover:bg-slate-100" href="/admin">
            Admin Workspace
          </a>
          <a className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 font-medium hover:bg-slate-100" href="/candidate">
            Candidate Portal
          </a>
        </div>
      </section>
    </main>
  );
}
