export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <a href="/" className="text-sm font-medium text-slate-600 hover:text-slate-900">
          ← Back to Clavis home
        </a>
      </div>
      {children}
    </div>
  );
}
