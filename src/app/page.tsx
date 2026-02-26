import Link from "next/link";

const platformHighlights = [
  {
    title: "Multi-tenant administration",
    copy: "Separate institutions, admins, roles, and governance controls in one platform workspace."
  },
  {
    title: "Question bank + exam builder",
    copy: "Create, import, organize, and compose exams with reusable subject-based question libraries."
  },
  {
    title: "PIN-based candidate access",
    copy: "Distribute controlled exam access with per-PIN usage limits, expiry windows, and allow-lists."
  },
  {
    title: "Integrity + analytics",
    copy: "Track suspicious events, calculate integrity scores, and review performance with export-ready reports."
  }
];

const workflowSteps = [
  {
    step: "01",
    title: "Create question banks",
    copy: "Structure questions by subject, difficulty, and type. Import in bulk or curate manually with review workflows."
  },
  {
    step: "02",
    title: "Assemble and publish exams",
    copy: "Configure timing, review policy, shuffle rules, and selected questions before pushing an exam live."
  },
  {
    step: "03",
    title: "Issue secure access",
    copy: "Generate PIN batches with expiry dates, usage limits, and optional allow-list enforcement for candidates."
  },
  {
    step: "04",
    title: "Monitor attempts in real time",
    copy: "Capture integrity signals, enforce server-side timing, and prevent duplicate submission races."
  },
  {
    step: "05",
    title: "Review results and exports",
    copy: "Analyze scores, integrity summaries, and question intelligence, then export reports for stakeholders."
  }
];

const featureGrid = [
  {
    eyebrow: "Authoring",
    title: "Question operations that scale",
    bullets: [
      "Subject-based organization",
      "XML import with validation",
      "Duplicate detection by content hash",
      "Soft delete and restore controls"
    ]
  },
  {
    eyebrow: "Delivery",
    title: "Controlled exam distribution",
    bullets: [
      "Exam sections and question selection",
      "PIN batches and usage limits",
      "Candidate resume support",
      "Server-side attempt lifecycle enforcement"
    ]
  },
  {
    eyebrow: "Security",
    title: "Hardening built into the stack",
    bullets: [
      "CSP and security headers",
      "CSRF same-origin enforcement",
      "Input validation with zod",
      "Replay and duplicate submit protection"
    ]
  },
  {
    eyebrow: "Insight",
    title: "Operational and assessment analytics",
    bullets: [
      "Exam score distributions",
      "Question intelligence views",
      "Integrity review queue",
      "CSV/PDF export workflows"
    ]
  }
];

const useCases = [
  { name: "Schools", text: "Coordinate departmental exams, mock tests, and term assessments with role-based admin access." },
  { name: "Training Academies", text: "Manage frequent cohorts, PIN-controlled sessions, and repeatable reporting pipelines." },
  { name: "Certification Teams", text: "Run controlled delivery flows with integrity scoring and post-exam audit visibility." }
];

const testimonials = [
  {
    quote:
      "We moved from scattered spreadsheets and one-off forms to a single workflow for question curation, publishing, and reporting.",
    name: "Amina Yusuf",
    role: "Assessment Lead, Brightgate College"
  },
  {
    quote:
      "The PIN controls and attempt integrity reviews changed how we supervise remote practice exams. Support overhead dropped immediately.",
    name: "Daniel Okoro",
    role: "Operations Manager, Crest Prep"
  },
  {
    quote:
      "Clavis gives our admins a cleaner process and our candidates a simpler exam experience without exposing the scoring logic.",
    name: "Ifeoma Nwankwo",
    role: "Program Director, ScholarPath Institute"
  }
];

function SectionHeading({
  id,
  label,
  title,
  copy
}: {
  id?: string;
  label: string;
  title: string;
  copy: string;
}) {
  return (
    <div id={id}>
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-700">{label}</p>
      <h2 className="mt-3 text-2xl font-semibold text-slate-950 sm:text-3xl">{title}</h2>
      <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600 sm:text-base">{copy}</p>
    </div>
  );
}

export default function HomePage() {
  return (
    <main className="relative overflow-x-clip bg-[radial-gradient(circle_at_10%_10%,#fde68a_0%,transparent_35%),radial-gradient(circle_at_85%_18%,#bfdbfe_0%,transparent_38%),linear-gradient(to_bottom,#f8fafc,#eef2ff_45%,#f8fafc)] [font-family:Space_Grotesk,ui-sans-serif,sans-serif]">
      <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(to_right,#cbd5e1_1px,transparent_1px),linear-gradient(to_bottom,#cbd5e1_1px,transparent_1px)] [background-size:32px_32px]" />

      <section className="relative border-b border-slate-200/80">
        <div className="mx-auto max-w-7xl px-6 py-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl border border-slate-900 bg-slate-950 text-sm font-bold text-white">
                C
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">Clavis</p>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Assessment OS</p>
              </div>
            </div>
            <nav className="flex flex-wrap items-center gap-2 text-sm">
              <a href="#about" className="rounded-full px-3 py-2 text-slate-700 hover:bg-white/80">About</a>
              <a href="#features" className="rounded-full px-3 py-2 text-slate-700 hover:bg-white/80">Features</a>
              <a href="#workflow" className="rounded-full px-3 py-2 text-slate-700 hover:bg-white/80">Workflow</a>
              <a href="#analytics" className="rounded-full px-3 py-2 text-slate-700 hover:bg-white/80">Analytics</a>
              <a href="#testimonials" className="rounded-full px-3 py-2 text-slate-700 hover:bg-white/80">Testimonials</a>
            </nav>
          </div>
        </div>
      </section>

      <section className="relative">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 py-16 lg:grid-cols-[1.08fr_0.92fr] lg:items-center lg:py-20">
          <div>
            <p className="inline-flex items-center rounded-full border border-amber-300 bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-900">
              Built for serious exam operations
            </p>
            <h1 className="mt-5 max-w-3xl text-4xl font-semibold leading-tight text-slate-950 sm:text-5xl lg:text-6xl">
              Run secure digital assessments with admin control, candidate simplicity, and audit-ready reporting.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-8 text-slate-600 sm:text-lg">
              Clavis helps institutions create question banks, publish exams, distribute access via PINs, score submissions,
              review integrity signals, and export results from one platform.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/admin"
                className="inline-flex items-center rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-[0_8px_24px_-12px_rgba(15,23,42,0.85)] transition hover:bg-slate-800"
              >
                Open Admin Workspace
              </Link>
              <Link
                href="/candidate"
                className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
              >
                Open Candidate Portal
              </Link>
            </div>
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <StatCard value="RLS" label="Tenant isolation design" />
              <StatCard value="PIN" label="Controlled exam access" />
              <StatCard value="PDF/CSV" label="Export-ready reporting" />
            </div>
          </div>

          <div className="relative">
            <div className="absolute -left-6 top-8 h-28 w-28 rounded-full bg-amber-300/60 blur-2xl" />
            <div className="absolute -right-8 bottom-10 h-32 w-32 rounded-full bg-blue-300/60 blur-2xl" />
            <div className="relative rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-[0_24px_80px_-40px_rgba(15,23,42,0.45)] backdrop-blur">
              <div className="rounded-2xl border border-slate-200 bg-slate-950 p-5 text-white">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Live session</p>
                    <p className="mt-1 text-lg font-semibold">Assessment Control Panel</p>
                  </div>
                  <span className="inline-flex items-center rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-semibold text-emerald-300">
                    Healthy
                  </span>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <PanelMetric label="Published Exams" value="18" hint="+3 this week" />
                  <PanelMetric label="Active PIN Batches" value="42" hint="2 expiring today" />
                  <PanelMetric label="Submissions" value="1,248" hint="Last 30 days" />
                  <PanelMetric label="Integrity Flags" value="27" hint="Needs review queue" />
                </div>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Exam performance snapshot</p>
                  <div className="mt-4 space-y-3">
                    {[
                      { label: "Pass rate", value: 78, tone: "bg-emerald-500" },
                      { label: "Avg score", value: 64, tone: "bg-blue-500" },
                      { label: "Completion", value: 92, tone: "bg-amber-500" }
                    ].map((row) => (
                      <div key={row.label}>
                        <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
                          <span>{row.label}</span>
                          <span>{row.value}%</span>
                        </div>
                        <div className="h-2.5 rounded-full bg-slate-200">
                          <div className={`h-2.5 rounded-full ${row.tone}`} style={{ width: `${row.value}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Integrity watch</p>
                  <div className="mt-3 space-y-2 text-sm">
                    {["tab_switch", "window_blur", "rapid_submit", "resume_conflict"].map((event, i) => (
                      <div key={event} className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2">
                        <span className="font-medium text-slate-800">{event}</span>
                        <span className={`text-xs font-semibold ${i < 2 ? "text-amber-700" : "text-slate-500"}`}>
                          {i < 2 ? "Review" : "Observed"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="relative border-y border-slate-200/70 bg-white/70 backdrop-blur">
        <div className="mx-auto max-w-7xl px-6 py-8">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {platformHighlights.map((item) => (
              <article key={item.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-900">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{item.copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="about" className="relative">
        <div className="mx-auto max-w-7xl px-6 py-16">
          <SectionHeading
            label="About"
            title="Designed for institutions that need control, consistency, and accountability"
            copy="Clavis is structured for real exam operations, not just quiz creation. It combines institutional boundaries, RBAC, exam publishing, candidate delivery, integrity review, and reporting in one workflow so teams can standardize how assessments are run."
          />

          <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-slate-900">What makes the workflow practical</h3>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {[
                  ["Admin roles", "Owner, admin, editor, and viewer access patterns for institutional teams."],
                  ["Question integrity", "Content hashing and validation help prevent duplicate clutter in the bank."],
                  ["Candidate resilience", "Resume flows and server-side timing enforcement improve recovery and fairness."],
                  ["Operational oversight", "Platform ops pages and audits support incident follow-up and support workflows."]
                ].map(([title, text]) => (
                  <div key={title} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-sm font-semibold text-slate-900">{title}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
                  </div>
                ))}
              </div>
            </div>

            <aside className="rounded-3xl border border-slate-900 bg-slate-950 p-6 text-white shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">Why teams choose Clavis</p>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-200">
                <li className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">Centralized exam lifecycle from authoring to export</li>
                <li className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">Security hardening built into API routes and server actions</li>
                <li className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">Scales from single campus operations to multi-tenant platform administration</li>
                <li className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">Clear separation of admin and candidate experiences</li>
              </ul>
            </aside>
          </div>
        </div>
      </section>

      <section id="features" className="relative border-t border-slate-200/70 bg-white/70">
        <div className="mx-auto max-w-7xl px-6 py-16">
          <SectionHeading
            label="Features"
            title="A complete assessment stack, not just a quiz screen"
            copy="Every section below represents a real operational surface already built into the product: question management, exam setup, candidate access, security hardening, integrity scoring, and exports."
          />

          <div className="mt-8 grid gap-5 md:grid-cols-2">
            {featureGrid.map((feature) => (
              <article key={feature.title} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">{feature.eyebrow}</p>
                <h3 className="mt-3 text-xl font-semibold text-slate-900">{feature.title}</h3>
                <ul className="mt-4 space-y-2 text-sm text-slate-600">
                  {feature.bullets.map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <span className="mt-1 h-2 w-2 rounded-full bg-slate-900" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="workflow" className="relative">
        <div className="mx-auto max-w-7xl px-6 py-16">
          <SectionHeading
            label="Workflow"
            title="From authoring to reporting in five clear stages"
            copy="Clavis is designed around operational flow. Teams can onboard admins, build content, publish exams, issue secure access, and review analytics without patching together separate tools."
          />

          <div className="mt-10 grid gap-4">
            {workflowSteps.map((item) => (
              <article key={item.step} className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-[80px_1fr] md:items-start">
                <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-900 bg-slate-950 text-lg font-semibold text-white">
                  {item.step}
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">{item.title}</h3>
                  <p className="mt-2 text-sm leading-7 text-slate-600">{item.copy}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="relative border-y border-slate-200/70 bg-gradient-to-r from-slate-950 to-slate-900 text-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-6 py-16 lg:grid-cols-[1.02fr_0.98fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-300">Security & Integrity</p>
            <h2 className="mt-3 text-2xl font-semibold sm:text-3xl">
              Candidate-facing simplicity backed by server-side enforcement.
            </h2>
            <p className="mt-4 text-sm leading-7 text-slate-300 sm:text-base">
              Clavis enforces critical attempt rules on the server, not just in the browser. That includes submission
              locking, timer enforcement, CSRF checks, request validation, and replay/duplicate submission protections.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {["CSP + headers", "CSRF mitigation", "Input validation (zod)", "Duplicate submit locking"].map((item) => (
                <div key={item} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100">
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">Operational review queue</p>
            <div className="mt-4 space-y-3">
              {[
                ["Integrity score", "72.5", "Flagged for review"],
                ["Attempt status", "submitted", "Protected by atomic submit lock"],
                ["Timer enforcement", "server-side", "Expired attempts auto-submit"],
                ["Audit trail", "enabled", "Admin actions and imports logged"]
              ].map(([label, value, hint]) => (
                <div key={label} className="rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-slate-300">{label}</span>
                    <span className="text-sm font-semibold text-white">{value}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">{hint}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="analytics" className="relative">
        <div className="mx-auto max-w-7xl px-6 py-16">
          <SectionHeading
            label="Analytics"
            title="Make decisions with exam-level and question-level insight"
            copy="Clavis includes analytics dashboards for score distribution, pass-rate trends, integrity summaries, and question intelligence, plus export routes for stakeholders who need offline reports."
          />

          <div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-lg font-semibold text-slate-900">Exam analytics dashboard snapshot</h3>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                  Last 30 days
                </span>
              </div>
              <div className="mt-6 grid gap-4 sm:grid-cols-4">
                <KpiCard label="Submissions" value="1,248" />
                <KpiCard label="Avg score" value="64.2%" />
                <KpiCard label="Pass rate" value="78.0%" />
                <KpiCard label="Avg integrity" value="91.4" />
              </div>
              <div className="mt-6 grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm font-semibold text-slate-900">Score distribution</p>
                  <div className="mt-4 space-y-3">
                    {[
                      ["0-19", 4],
                      ["20-39", 9],
                      ["40-59", 19],
                      ["60-79", 32],
                      ["80-100", 26]
                    ].map(([label, count]) => (
                      <div key={String(label)}>
                        <div className="mb-1 flex justify-between text-xs text-slate-600">
                          <span>{label}</span>
                          <span>{count}</span>
                        </div>
                        <div className="h-2.5 rounded-full bg-slate-200">
                          <div className="h-2.5 rounded-full bg-slate-900" style={{ width: `${Math.min(100, Number(count) * 3)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-sm font-semibold text-slate-900">Question intelligence highlights</p>
                  <div className="mt-3 space-y-2 text-sm">
                    {[
                      ["Q12", "Low discrimination", "Review wording"],
                      ["Q18", "High skip rate", "Check prerequisite coverage"],
                      ["Q21", "Option clustering", "Refine distractors"],
                      ["Q33", "Strong performance", "Keep in rotation"]
                    ].map(([id, status, action]) => (
                      <div key={String(id)} className="grid grid-cols-[64px_1fr] gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <span className="inline-flex h-8 items-center justify-center rounded-lg bg-white text-xs font-semibold text-slate-700">{id}</span>
                        <div>
                          <p className="font-medium text-slate-800">{status}</p>
                          <p className="text-xs text-slate-500">{action}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-slate-900">Reporting outputs</h3>
                <p className="mt-2 text-sm leading-7 text-slate-600">
                  Export exam results as CSV or PDF for academic boards, department heads, and compliance reporting.
                </p>
                <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
                  <span className="rounded-full bg-blue-100 px-3 py-1 text-blue-800">CSV exports</span>
                  <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">PDF summaries</span>
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">Filter by date/score</span>
                </div>
              </div>

              <div className="rounded-3xl border border-slate-900 bg-slate-950 p-6 text-white shadow-sm">
                <h3 className="text-lg font-semibold">Who this works for</h3>
                <div className="mt-4 space-y-3">
                  {useCases.map((item) => (
                    <div key={item.name} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <p className="text-sm font-semibold text-white">{item.name}</p>
                      <p className="mt-1 text-sm leading-6 text-slate-300">{item.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="testimonials" className="relative border-t border-slate-200/70 bg-white/70">
        <div className="mx-auto max-w-7xl px-6 py-16">
          <SectionHeading
            label="Testimonials"
            title="Trusted by teams upgrading from manual exam operations"
            copy="These examples reflect the kind of operational gains institutions expect when moving to a centralized assessment platform: fewer ad-hoc processes, clearer admin controls, and more reliable reporting."
          />

          <div className="mt-8 grid gap-5 lg:grid-cols-3">
            {testimonials.map((item, index) => (
              <blockquote
                key={item.name}
                className={`rounded-3xl border p-6 shadow-sm ${
                  index === 1 ? "border-amber-200 bg-amber-50/80" : "border-slate-200 bg-white"
                }`}
              >
                <p className="text-sm leading-7 text-slate-700">"{item.quote}"</p>
                <footer className="mt-5 border-t border-slate-200 pt-4">
                  <p className="text-sm font-semibold text-slate-900">{item.name}</p>
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-500">{item.role}</p>
                </footer>
              </blockquote>
            ))}
          </div>

          <div className="mt-10 rounded-3xl border border-slate-900 bg-slate-950 p-8 text-white shadow-sm">
            <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-300">Get started</p>
                <h3 className="mt-3 text-2xl font-semibold">Ready to launch your admin and candidate experience?</h3>
                <p className="mt-3 text-sm leading-7 text-slate-300">
                  Open the admin workspace to configure your institution, question bank, and exams, or jump straight to the
                  candidate portal to test the exam delivery flow.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
                <Link href="/admin" className="inline-flex items-center justify-center rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100">
                  Launch Admin Workspace
                </Link>
                <Link href="/candidate" className="inline-flex items-center justify-center rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-sm font-semibold text-white hover:bg-white/10">
                  Open Candidate Portal
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-lg font-semibold text-slate-900">{value}</p>
      <p className="text-xs uppercase tracking-[0.14em] text-slate-500">{label}</p>
    </div>
  );
}

function PanelMetric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <p className="text-xs uppercase tracking-[0.14em] text-slate-300">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
      <p className="text-xs text-slate-400">{hint}</p>
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}
