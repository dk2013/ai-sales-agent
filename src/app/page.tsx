"use client";
// Inbox: incoming sales emails, what the agents decided, and buttons to run them.
import Link from "next/link";
import { useState } from "react";
import { Badge, fmtTime, postJson, usePolling } from "./ui";

interface Email {
  id: number;
  from_name: string;
  from_email: string;
  subject: string;
  received_at: string;
  status: string;
  category: string | null;
  run_id: number | null;
  run_status: string | null;
  priority: string | null;
  plan: string | null;
  pending: number;
}

const BUSY = ["queued", "processing"];

export default function InboxPage() {
  const [emails, setEmails] = useState<Email[]>([]);
  const [canRun, setCanRun] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    const [e, me] = await Promise.all([fetch("/api/emails").then((r) => r.json()), fetch("/api/auth/me").then((r) => r.json())]);
    setEmails(e.emails ?? []);
    setCanRun(Boolean(me.user?.roles?.includes("sales-manager")));
  };
  const busy = emails.some((e) => BUSY.includes(e.status));
  usePolling(load, 2000, busy);

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setMessage(null);
    try {
      await fn();
      if (done) setMessage(done);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
    await load();
  };

  const counts = {
    new: emails.filter((e) => e.status === "new").length,
    waiting: emails.reduce((n, e) => n + e.pending, 0),
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Sales inbox</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Agents triage each email, qualify leads with CRM, pricing and knowledge-base tools (via MCP), and draft actions.
            Nothing is sent, booked or saved until a sales manager approves it.
          </p>
        </div>
        {canRun && (
          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost" onClick={() => act(() => postJson("/api/emails/simulate"), "A new email arrived.")}>
              Simulate new email
            </button>
            <button className="btn" disabled={!counts.new} onClick={() => act(() => postJson("/api/emails/run-all"))}>
              Run agents on {counts.new} new
            </button>
          </div>
        )}
      </div>

      {message && <p className="text-sm text-[var(--muted)]">{message}</p>}
      {counts.waiting > 0 && (
        <Link href="/approvals" className="card block border-[var(--accent)] text-sm">
          <strong>{counts.waiting}</strong> proposed action{counts.waiting === 1 ? "" : "s"} waiting for approval →
        </Link>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="text-left text-[var(--muted)]">
            <tr>
              <th className="px-4 py-2 font-normal">From</th>
              <th className="px-4 py-2 font-normal">Subject</th>
              <th className="px-4 py-2 font-normal">Type</th>
              <th className="px-4 py-2 font-normal">Lead</th>
              <th className="px-4 py-2 font-normal">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {emails.map((e) => (
              <tr key={e.id} className="border-t border-[var(--border)] align-top">
                <td className="px-4 py-2">
                  <div className="font-medium">{e.from_name}</div>
                  <div className="text-xs text-[var(--muted)]">{fmtTime(e.received_at)}</div>
                </td>
                <td className="max-w-xs px-4 py-2">{e.subject}</td>
                <td className="px-4 py-2"><Badge value={e.category} /></td>
                <td className="px-4 py-2">
                  {e.priority && <Badge value={e.priority} label={`${e.priority}${e.plan && e.plan !== "unknown" ? ` · ${e.plan}` : ""}`} />}
                </td>
                <td className="px-4 py-2">
                  <Badge value={e.status} label={e.status === "awaiting_approval" ? `${e.pending} to approve` : undefined} />
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-right">
                  {e.run_id && (
                    <Link href={`/runs/${e.run_id}`} className="text-[var(--accent)] hover:underline">
                      View run
                    </Link>
                  )}
                  {canRun && ["new", "failed", "done", "ignored"].includes(e.status) && (
                    <button className="ml-3 text-[var(--accent)] hover:underline" onClick={() => act(() => postJson(`/api/emails/${e.id}/run`))}>
                      {e.run_id ? "Re-run" : "Run agents"}
                    </button>
                  )}
                  {BUSY.includes(e.status) && <span className="text-xs text-[var(--muted)]">working…</span>}
                </td>
              </tr>
            ))}
            {emails.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-[var(--muted)]">
                  The inbox is empty.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
