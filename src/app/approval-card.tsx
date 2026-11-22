"use client";
// One proposed action with Approve / Reject. Replies can be edited before approving.
import { useState } from "react";
import { Badge, postJson } from "./ui";

export interface Approval {
  id: number;
  kind: "send_reply" | "book_meeting" | "update_crm";
  status: string;
  payload: Record<string, any>;
  decided_by?: string | null;
  result?: Record<string, unknown> | null;
}

const TITLES = { send_reply: "Send reply", book_meeting: "Book meeting", update_crm: "Update CRM" };

export function ApprovalCard({ a, canApprove, onDone }: { a: Approval; canApprove: boolean; onDone: () => void }) {
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState<string>(a.payload.subject ?? "");
  const [body, setBody] = useState<string>(a.payload.body ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = a.payload;

  const decide = async (decision: "approve" | "reject") => {
    setBusy(true);
    setError(null);
    try {
      await postJson(`/api/approvals/${a.id}`, editing && decision === "approve" ? { decision, subject, body } : { decision });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium">{TITLES[a.kind]}</div>
        <Badge value={a.status} label={a.status === "pending" ? "waiting for approval" : `${a.status}${a.decided_by ? ` by ${a.decided_by}` : ""}`} />
      </div>

      {p.warnings?.length > 0 && (
        <div className="rounded-lg bg-[var(--warn-soft)] p-2 text-sm text-[var(--warn)]">
          {p.warnings.map((w: string) => (
            <div key={w}>⚠ {w}</div>
          ))}
        </div>
      )}

      {a.kind === "send_reply" &&
        (editing ? (
          <div className="space-y-2 text-sm">
            <input value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full rounded-lg border border-[var(--border)] bg-transparent px-2 py-1" />
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} className="w-full rounded-lg border border-[var(--border)] bg-transparent px-2 py-1" />
          </div>
        ) : (
          <div className="text-sm">
            <div className="text-[var(--muted)]">To: {p.to}</div>
            <div className="font-medium">{p.subject}{p.edited ? " (edited)" : ""}</div>
            <p className="mt-2 whitespace-pre-wrap">{p.body}</p>
          </div>
        ))}

      {a.kind === "book_meeting" && (
        <div className="text-sm">
          <div className="font-medium">{p.title}</div>
          <div>{p.label ?? p.start} · {p.duration_minutes} min</div>
          <div className="text-[var(--muted)]">with {p.attendee}</div>
        </div>
      )}

      {a.kind === "update_crm" && (
        <div className="text-sm">
          <div>
            <span className="font-medium">{p.contact?.name}</span>
            {p.contact?.company ? `, ${p.contact.company}` : ""} · <Badge value={p.stage} />
          </div>
          <div className="text-[var(--muted)]">
            {p.contact?.email}
            {p.contact?.fleet_size ? ` · ${p.contact.fleet_size} vehicles` : ""}
            {p.deal?.vehicles ? ` · new deal for ${p.deal.vehicles} vehicles (plan and price set by the pricing rules)` : ""}
          </div>
          <p className="mt-1">{p.note}</p>
        </div>
      )}

      {a.result && <pre className="overflow-x-auto rounded-lg bg-[var(--bg)] p-2 text-xs text-[var(--muted)]">{JSON.stringify(a.result)}</pre>}
      {error && <p className="text-sm text-[var(--bad)]">{error}</p>}

      {a.status === "pending" &&
        (canApprove ? (
          <div className="flex flex-wrap gap-2">
            <button className="btn" disabled={busy} onClick={() => decide("approve")}>
              {editing ? "Save & approve" : "Approve"}
            </button>
            {a.kind === "send_reply" && !editing && (
              <button className="btn-ghost" disabled={busy} onClick={() => setEditing(true)}>Edit</button>
            )}
            <button className="btn-ghost" disabled={busy} onClick={() => decide("reject")}>Reject</button>
          </div>
        ) : (
          <p className="text-xs text-[var(--muted)]">Read-only role: only a sales manager can approve.</p>
        ))}
    </div>
  );
}
