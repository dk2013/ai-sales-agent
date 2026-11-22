"use client";
// The sandbox systems the agents work with: CRM, calendar and outbox. Shows the effect of approved actions.
import { useState } from "react";
import { Badge, fmtTime, postJson, usePolling } from "../ui";

interface Data {
  contacts: { id: number; name: string; email: string; company: string | null; fleet_size: number | null; stage: string; updated_at: string; deals: { plan: string; vehicles: number; monthly_value: string | null; stage: string }[] | null; last_activity: string | null }[];
  events: { id: number; title: string; starts_at: string; ends_at: string; attendee_email: string | null }[];
  outbox: { id: number; to_email: string; subject: string; body: string; sent_at: string }[];
}

export default function SandboxPage() {
  const [data, setData] = useState<Data | null>(null);
  const [canReset, setCanReset] = useState(false);
  const load = async () => {
    const [d, me] = await Promise.all([fetch("/api/sandbox").then((r) => r.json()), fetch("/api/auth/me").then((r) => r.json())]);
    setData(d);
    setCanReset(Boolean(me.user?.roles?.includes("sales-manager")));
  };
  usePolling(load, 10000, true);
  if (!data) return <p className="text-sm text-[var(--muted)]">Loading…</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">CRM, calendar &amp; outbox</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Sandbox versions of HubSpot, Google Calendar and Gmail. In a real deployment the same MCP tools call those APIs.
          </p>
        </div>
        {canReset && (
          <button
            className="btn-ghost"
            onClick={async () => {
              if (!confirm("Reset the sandbox? Runs, approvals and changes will be removed.")) return;
              await postJson("/api/sandbox/reset");
              await load();
            }}
          >
            Reset sandbox
          </button>
        )}
      </div>

      <section className="card overflow-x-auto p-0">
        <div className="px-4 pt-3 text-sm font-medium">CRM contacts</div>
        <table className="mt-2 w-full text-sm">
          <thead className="text-left text-[var(--muted)]">
            <tr>
              <th className="px-4 py-2 font-normal">Contact</th>
              <th className="px-4 py-2 font-normal">Stage</th>
              <th className="px-4 py-2 font-normal">Deal</th>
              <th className="px-4 py-2 font-normal">Last activity</th>
            </tr>
          </thead>
          <tbody>
            {data.contacts.map((c) => (
              <tr key={c.id} className="border-t border-[var(--border)] align-top">
                <td className="px-4 py-2">
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-[var(--muted)]">{c.company} · {c.email}</div>
                </td>
                <td className="px-4 py-2"><Badge value={c.stage} /></td>
                <td className="px-4 py-2">
                  {c.deals?.[0] && (
                    <span>
                      {c.deals[0].plan} · {c.deals[0].vehicles} veh. · {c.deals[0].monthly_value ? `$${Number(c.deals[0].monthly_value).toLocaleString()}/mo` : "custom"}{" "}
                      <span className="text-xs text-[var(--muted)]">({c.deals[0].stage})</span>
                    </span>
                  )}
                </td>
                <td className="max-w-sm px-4 py-2 text-[var(--muted)]">{c.last_activity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <div className="text-sm font-medium">Upcoming meetings</div>
          <ul className="mt-2 space-y-1 text-sm">
            {data.events.map((e) => (
              <li key={e.id} className={e.attendee_email ? "font-medium" : "text-[var(--muted)]"}>
                {fmtTime(e.starts_at)} · {e.title}
                {e.attendee_email ? ` · ${e.attendee_email}` : ""}
              </li>
            ))}
          </ul>
        </section>
        <section className="card">
          <div className="text-sm font-medium">Outbox (sent after approval)</div>
          {data.outbox.length === 0 && <p className="mt-2 text-sm text-[var(--muted)]">Nothing sent yet.</p>}
          <ul className="mt-2 space-y-3 text-sm">
            {data.outbox.map((m) => (
              <li key={m.id}>
                <div className="text-xs text-[var(--muted)]">{fmtTime(m.sent_at)} · to {m.to_email}</div>
                <div className="font-medium">{m.subject}</div>
                <p className="line-clamp-3 whitespace-pre-wrap text-[var(--muted)]">{m.body}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
