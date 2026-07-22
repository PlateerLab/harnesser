"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { User } from "@/lib/types";
import { logout } from "./useUser";
import { Badge } from "./ui";

/** 관리자/평가자 공통 상단 내비게이션 셸 */
export function Shell({ user, children }: { user: User; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const links = [
    ...(user.role === "admin"
      ? [
          { href: "/admin/problems", label: "문제" },
          { href: "/admin/assessments", label: "시험" },
          { href: "/admin/users", label: "사용자" },
        ]
      : []),
    { href: "/review", label: "응시 리뷰" },
  ];

  return (
    <div className="min-h-screen">
      <nav className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <Link href="/" className="font-black">
              Harnesser<span className="text-violet-500">.</span>
            </Link>
            <div className="flex gap-1">
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                    pathname.startsWith(l.href)
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {l.label}
                </Link>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-600">{user.name}</span>
            <Badge value={user.role} />
            <button
              onClick={() => logout(router)}
              className="text-sm text-slate-400 hover:text-slate-600"
            >
              로그아웃
            </button>
          </div>
        </div>
      </nav>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
