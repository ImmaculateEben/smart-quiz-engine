import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSessionAuthState } from "@/lib/auth/session";
import { AdminNav } from "@/app/(admin)/admin-nav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const authState = await getSessionAuthState();

  if (!authState.user) {
    redirect("/login?next=/admin");
  }

  async function signOut() {
    "use server";

    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
    redirect("/login");
  }

  const userLabel =
    authState.profile?.displayName ||
    authState.user.email ||
    authState.user.id;

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200/80 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Clavis Admin</p>
            <p className="mt-1 text-sm text-slate-600">
              Signed in as <span className="font-medium text-slate-900">{userLabel}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <AdminNav />
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700 hover:bg-slate-50"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
