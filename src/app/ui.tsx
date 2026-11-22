"use client";
// Small shared UI pieces.
import { useEffect, useRef } from "react";

const TONES: Record<string, string> = {
  lead: "accent", support: "warn", spam: "bad", other: "muted",
  new: "muted", queued: "warn", processing: "warn", running: "warn", awaiting_approval: "accent",
  done: "ok", completed: "ok", ignored: "muted", failed: "bad",
  pending: "accent", approved: "ok", rejected: "bad",
  high: "ok", medium: "warn", low: "muted",
  customer: "ok", qualified: "accent", meeting: "accent", disqualified: "bad",
};

export function Badge({ value, label }: { value: string | null | undefined; label?: string }) {
  if (!value) return null;
  const tone = TONES[value] ?? "muted";
  const style =
    tone === "muted"
      ? { color: "var(--muted)", background: "var(--bg)" }
      : { color: `var(--${tone})`, background: `var(--${tone}-soft)` };
  return (
    <span className="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium" style={style}>
      {label ?? value.replace(/_/g, " ")}
    </span>
  );
}

// Calls fn now and then every `ms` while `active` is true.
export function usePolling(fn: () => void, ms: number, active: boolean) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    saved.current();
  }, []);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => saved.current(), ms);
    return () => clearInterval(t);
  }, [ms, active]);
}

export async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

// Always in the sales team's time zone (Toronto), the same as the agents' meeting proposals.
export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Toronto", timeZoneName: "short",
  });
