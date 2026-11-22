"use client";
// Approval queue: every proposed action waiting for a human, across all emails.
import Link from "next/link";
import { useState } from "react";
import { ApprovalCard, type Approval } from "../approval-card";
import { usePolling } from "../ui";

type Item = Approval & { run_id: number; from_name: string; subject: string };

export default function ApprovalsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [canApprove, setCanApprove] = useState(false);
  const load = async () => {
    const [a, me] = await Promise.all([fetch("/api/approvals").then((r) => r.json()), fetch("/api/auth/me").then((r) => r.json())]);
    setItems((a.approvals ?? []).map((x: Item) => ({ ...x, status: "pending" })));
    setCanApprove(Boolean(me.user?.roles?.includes("sales-manager")));
  };
  usePolling(load, 5000, true);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Approval queue</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Human in the loop: the agents only propose. Approving sends the reply to the outbox, books the meeting or writes to the CRM.
        </p>
      </div>
      {items.length === 0 && <p className="text-sm text-[var(--muted)]">Nothing waiting for approval.</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {items.map((a) => (
          <div key={a.id} className="space-y-1">
            <Link href={`/runs/${a.run_id}`} className="text-xs text-[var(--accent)] hover:underline">
              {a.from_name}: {a.subject}
            </Link>
            <ApprovalCard a={a} canApprove={canApprove} onDone={load} />
          </div>
        ))}
      </div>
    </div>
  );
}
