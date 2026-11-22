import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Sales Agent",
  description: "Multi-agent lead triage, qualification and reply drafting with MCP tools and human approval.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b border-[var(--border)] bg-[var(--panel)]">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
            <Link href="/" className="font-semibold">
              AI Sales Agent <span className="font-normal text-[var(--muted)]">· RouteWise</span>
            </Link>
            {user && (
              <nav className="flex flex-wrap items-center gap-4 text-sm text-[var(--muted)]">
                <Link href="/" className="hover:text-[var(--text)]">Inbox</Link>
                <Link href="/approvals" className="hover:text-[var(--text)]">Approvals</Link>
                <Link href="/sandbox" className="hover:text-[var(--text)]">CRM &amp; Calendar</Link>
                <span className="hidden h-4 w-px bg-[var(--border)] sm:block" />
                <span className="text-[var(--text)]">
                  {user.name}{" "}
                  <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-xs text-[var(--accent)]">
                    {user.roles.includes("sales-manager") ? "sales manager" : "viewer"}
                  </span>
                </span>
                <a href="/api/auth/logout" className="hover:text-[var(--text)]">Sign out</a>
              </nav>
            )}
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
