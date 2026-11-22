"use client";
// One agent run: the email, what each agent concluded, the full tool-call timeline, and the proposals to approve.
import Link from "next/link";
import { use, useState } from "react";
import { ApprovalCard, type Approval } from "../../approval-card";
import { Badge, fmtTime, usePolling } from "../../ui";

interface Step { id: number; agent: string; kind: string; name: string | null; data: any; ms: number | null }
interface RunData {
  run: { id: number; status: string; model: string; error: string | null; result: any; tokens: number; cost_usd: number; started_at: string; finished_at: string | null };
  email: { from_name: string; from_email: string; subject: string; body: string; received_at: string; category: string | null };
  steps: Step[];
  approvals: Approval[];
}

const AGENT_COLORS: Record<string, string> = { triage: "#8b5cf6", qualify: "#0ea5e9", draft: "#f59e0b", support: "#f59e0b", orchestrator: "#64748b", human: "#16a34a" };

function StepRow({ s }: { s: Step }) {
  const [open, setOpen] = useState(false);
  const label =
    s.kind === "tool_call" ? `calls ${s.name}` :
    s.kind === "tool_result" ? `${s.name} → ${s.data?.ok ? "ok" : "error"}` :
    s.kind === "llm" ? `LLM ${s.name}${s.data?.tool_calls?.length ? `: ${s.data.tool_calls.join(", ")}` : ""}` :
    s.kind === "handoff" ? s.name : s.kind === "output" ? (s.name ?? "result") : s.name ?? s.kind;
  return (
    <li className="border-l-2 py-1 pl-3" style={{ borderColor: AGENT_COLORS[s.agent] ?? "var(--border)" }}>
      <button onClick={() => setOpen(!open)} className="flex w-full items-baseline gap-2 text-left text-sm">
        <span className="w-20 shrink-0 text-xs font-medium" style={{ color: AGENT_COLORS[s.agent] }}>{s.agent}</span>
        <span className="flex-1">{label}</span>
        {s.ms !== null && <span className="text-xs text-[var(--muted)]">{(s.ms / 1000).toFixed(1)}s</span>}
        {s.data && <span className="text-xs text-[var(--muted)]">{open ? "▾" : "▸"}</span>}
      </button>
      {open && s.data && (
        <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--bg)] p-2 text-xs">
          {typeof s.data?.result === "string" ? s.data.result : JSON.stringify(s.data, null, 2)}
        </pre>
      )}
    </li>
  );
}

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<RunData | null>(null);
  const [canApprove, setCanApprove] = useState(false);
  const load = async () => {
    const [r, me] = await Promise.all([fetch(`/api/runs/${id}`).then((x) => x.json()), fetch("/api/auth/me").then((x) => x.json())]);
    setData(r);
    setCanApprove(Boolean(me.user?.roles?.includes("sales-manager")));
  };
  usePolling(load, 1500, !data || data.run.status === "running");
  if (!data) return <p className="text-sm text-[var(--muted)]">Loading…</p>;
  if (!data.run) return <p className="text-sm text-[var(--bad)]">Run not found.</p>;

  const { run, email, steps, approvals } = data;
  const t = run.result?.triage;
  const q = run.result?.qualification;
  const toolCalls = steps.filter((s) => s.kind === "tool_call").length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/" className="text-sm text-[var(--accent)] hover:underline">← Inbox</Link>
        <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
          <Badge value={run.status} />
          <span>{run.model}</span>
          <span>{toolCalls} tool calls</span>
          <span>{run.tokens.toLocaleString()} tokens · ${run.cost_usd.toFixed(4)}</span>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr]">
        <div className="space-y-4">
          <div className="card">
            <div className="text-xs text-[var(--muted)]">{fmtTime(email.received_at)} · {email.from_name} &lt;{email.from_email}&gt;</div>
            <div className="mt-1 font-medium">{email.subject}</div>
            <p className="mt-2 whitespace-pre-wrap text-sm">{email.body}</p>
          </div>

          {t && (
            <div className="card space-y-1 text-sm">
              <div className="flex items-center gap-2 font-medium">
                Triage <Badge value={t.category} />
                {t.suspicious_instructions && <Badge value="failed" label="contains instructions to the AI" />}
              </div>
              <p>{t.summary}</p>
              <p className="text-[var(--muted)]">
                {[t.company, t.fleet_size ? `${t.fleet_size} vehicles` : null, t.wants_meeting ? `wants a meeting${t.meeting_preference ? ` (${t.meeting_preference})` : ""}` : null, t.nonprofit ? "non-profit" : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          )}

          {q && (
            <div className="card space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-2 font-medium">
                Qualification <Badge value={q.priority} label={`${q.priority} · score ${q.score}`} />
                {q.plan !== "unknown" && <Badge value="qualified" label={q.plan} />}
                {q.existing_customer && <Badge value="customer" label={`customer${q.current_plan ? ` on ${q.current_plan}` : ""}`} />}
              </div>
              {q.quote_summary && <p>{q.quote_summary}</p>}
              <ul className="list-disc pl-5 text-[var(--muted)]">
                {q.reasons.map((r: string) => <li key={r}>{r}</li>)}
              </ul>
              {q.answers.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs text-[var(--muted)]">Answers from the knowledge base (RAG assistant):</div>
                  {q.answers.map((a: any) => (
                    <div key={a.question} className="rounded-lg bg-[var(--bg)] p-2">
                      <div className="font-medium">{a.question}</div>
                      <div>{a.answer}</div>
                      {a.source && <div className="text-xs text-[var(--muted)]">Source: {a.source}</div>}
                    </div>
                  ))}
                </div>
              )}
              {q.missing_info.length > 0 && <p className="text-[var(--muted)]">Missing: {q.missing_info.join(", ")}</p>}
            </div>
          )}

          <div className="card">
            <div className="mb-2 text-sm font-medium">Timeline</div>
            <ol className="space-y-1">{steps.map((s) => <StepRow key={s.id} s={s} />)}</ol>
            {run.status === "running" && <p className="mt-2 text-xs text-[var(--muted)]">Agents are working…</p>}
            {run.error && <p className="mt-2 text-sm text-[var(--bad)]">{run.error}</p>}
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-sm font-medium">Proposed actions</h2>
          {approvals.map((a) => (
            <ApprovalCard key={a.id} a={a} canApprove={canApprove} onDone={load} />
          ))}
          {approvals.length === 0 && run.status !== "running" && (
            <p className="text-sm text-[var(--muted)]">No actions proposed (for example spam or a non-sales email).</p>
          )}
        </div>
      </div>
    </div>
  );
}
