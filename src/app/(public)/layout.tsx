export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-blue-50/60 to-transparent" />
      <div className="relative">{children}</div>
    </div>
  );
}
