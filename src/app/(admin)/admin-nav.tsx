"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  href: Route;
  label: string;
  match: string[];
};

const NAV_ITEMS: NavItem[] = [
  { href: "/admin", label: "Dashboard", match: ["/admin"] },
  { href: "/onboarding", label: "Onboarding", match: ["/onboarding"] },
  { href: "/admin/invitations", label: "Invitations", match: ["/admin/invitations"] },
  { href: "/admin/admins", label: "Admins", match: ["/admin/admins"] },
  { href: "/admin/subjects", label: "Subjects", match: ["/admin/subjects"] },
  { href: "/admin/questions", label: "Questions", match: ["/admin/questions"] },
  { href: "/admin/exams", label: "Exams", match: ["/admin/exams"] },
  { href: "/admin/analytics/exams", label: "Analytics", match: ["/admin/analytics"] },
  { href: "/admin/analytics/questions", label: "Q Intelligence", match: ["/admin/analytics/questions"] },
  { href: "/admin/analytics/exports", label: "Exports", match: ["/admin/analytics/exports"] },
  { href: "/admin/pins", label: "PINs", match: ["/admin/pins"] },
  { href: "/admin/integrity", label: "Integrity", match: ["/admin/integrity"] },
  { href: "/admin/usage", label: "Usage", match: ["/admin/usage"] },
  { href: "/admin/platform", label: "Platform", match: ["/admin/platform"] },
  { href: "/admin/platform/operations", label: "Ops", match: ["/admin/platform/operations"] },
  { href: "/admin/settings", label: "Settings", match: ["/admin/settings"] }
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap items-center gap-2 text-sm">
      {NAV_ITEMS.map((item) => {
        const isActive = item.match.some((path) =>
          path === "/admin" ? pathname === "/admin" : pathname.startsWith(path)
        );

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-lg px-3 py-2 transition ${
              isActive
                ? "bg-slate-900 text-white"
                : "text-slate-700 hover:bg-slate-100"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
