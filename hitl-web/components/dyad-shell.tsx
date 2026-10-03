"use client";

import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/hitl", label: "Gates" },
  { href: "/runtime", label: "Runtime" },
];

export function DyadShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <main>
      <header>
        <div>
          <h1>wewebplus</h1>
          <nav className="nav" aria-label="DYAD">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={pathname === link.href ? "page" : undefined}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <UserButton />
      </header>
      {children}
    </main>
  );
}
