import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formDataString, parseServerActionForm } from "@/lib/http/server-action-validation";

type LoginPageProps = {
  searchParams?: Promise<{
    next?: string;
    sent?: string;
    error?: string;
  }>;
};

function sanitizeNextPath(value?: string) {
  if (!value || !value.startsWith("/")) return "/admin";
  if (value.startsWith("//")) return "/admin";
  return value;
}

const loginFormSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  next: z.string().max(2_000)
});

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = (await searchParams) ?? {};
  const nextPath = sanitizeNextPath(params.next);
  const sent = params.sent === "1";
  const error = params.error;

  async function sendMagicLink(formData: FormData) {
    "use server";

    const raw = {
      email: formDataString(formData, "email").toLowerCase(),
      next: formDataString(formData, "next")
    };
    if (!raw.email) {
      const next = sanitizeNextPath(raw.next);
      redirect(`/login?error=missing_email&next=${encodeURIComponent(next)}`);
    }
    const parsedForm = parseServerActionForm(loginFormSchema, raw);
    if (!parsedForm.ok) {
      const next = sanitizeNextPath(raw.next);
      redirect(`/login?error=invalid_email&next=${encodeURIComponent(next)}`);
    }
    const { email, next: rawNext } = parsedForm.data;
    const next = sanitizeNextPath(rawNext);

    const headerStore = await headers();
    const forwardedHost = headerStore.get("x-forwarded-host");
    const forwardedProto = headerStore.get("x-forwarded-proto");
    const host = forwardedHost ?? headerStore.get("host");
    const protocol = forwardedProto ?? "http";
    const origin = host ? `${protocol}://${host}` : "http://localhost:3000";

    try {
      const supabase = await createSupabaseServerClient();
      const { error: signInError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`
        }
      });

      if (signInError) {
        redirect(`/login?error=auth_request_failed&next=${encodeURIComponent(next)}`);
      }
    } catch {
      redirect(`/login?error=env_not_ready&next=${encodeURIComponent(next)}`);
    }

    redirect(`/login?sent=1&next=${encodeURIComponent(next)}`);
  }

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Clavis Admin</p>
        <h1 className="mt-3 text-2xl font-semibold">Sign in to Clavis</h1>
        <p className="mt-2 text-sm text-slate-600">
          Invite-ready magic-link sign in for institution administrators. Configure Supabase env vars before use.
        </p>

        {sent ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Magic link sent. Check your email and return here to continue.
          </div>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error === "missing_email" && "Enter an email address."}
            {error === "invalid_email" && "Enter a valid email address."}
            {error === "auth_request_failed" && "Unable to request a sign-in link from Supabase."}
            {error === "callback_failed" && "Sign-in link validation failed or expired. Request a new link."}
            {error === "env_not_ready" && "Supabase environment variables are missing or invalid."}
            {!["missing_email", "invalid_email", "auth_request_failed", "callback_failed", "env_not_ready"].includes(error) &&
              "Unable to sign in right now."}
          </div>
        ) : null}

        <form action={sendMagicLink} className="mt-6 space-y-4">
          <input type="hidden" name="next" value={nextPath} />
          <div>
            <label htmlFor="email" className="mb-2 block text-sm font-medium text-slate-700">
              Work email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="admin@institution.edu"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none ring-0 placeholder:text-slate-400 focus:border-blue-500"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            Send magic link
          </button>
        </form>

        <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          New institution setup will use the onboarding flow at <code>/onboarding</code> (invite or owner bootstrap).
        </div>
      </div>
    </main>
  );
}
