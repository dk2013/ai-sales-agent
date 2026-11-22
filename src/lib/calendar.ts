// Free meeting slots: business days, 10:00–16:00 in the sales team's time zone, not overlapping events.
import { config } from "./config";
import { pool } from "./db";

const STEP_MIN = 30;
const DAY_START = 10; // local hour
const DAY_END = 16;

function localParts(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return {
    weekday: parts.weekday as string,
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    day: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

export function slotLabel(date: Date, timeZone = config.timeZone): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(date);
}

export function isBusinessSlot(start: Date, durationMin: number, timeZone = config.timeZone): boolean {
  const s = localParts(start, timeZone);
  const end = new Date(start.getTime() + durationMin * 60_000);
  const e = localParts(end, timeZone);
  const weekday = !["Sat", "Sun"].includes(s.weekday);
  const startsOk = s.hour >= DAY_START;
  const endsOk = e.day === s.day && (e.hour < DAY_END || (e.hour === DAY_END && e.minute === 0));
  return weekday && startsOk && endsOk;
}

export async function isFree(start: Date, durationMin: number): Promise<boolean> {
  const end = new Date(start.getTime() + durationMin * 60_000);
  const { rows } = await pool.query(
    "SELECT 1 FROM calendar_events WHERE starts_at < $2 AND ends_at > $1 LIMIT 1",
    [start.toISOString(), end.toISOString()],
  );
  return rows.length === 0;
}

export interface Slot {
  start: string; // ISO, pass back to propose_meeting
  label: string; // human readable in the business time zone
}

export async function freeSlots(days = 7, durationMin = 30, now = new Date(), maxPerDay = 3, maxTotal = 9): Promise<Slot[]> {
  const from = new Date(now.getTime() + 2 * 3600_000); // not earlier than 2 hours from now
  from.setUTCMinutes(Math.ceil(from.getUTCMinutes() / STEP_MIN) * STEP_MIN, 0, 0);
  const until = new Date(now.getTime() + days * 86_400_000);
  const { rows: events } = await pool.query<{ starts_at: Date; ends_at: Date }>(
    "SELECT starts_at, ends_at FROM calendar_events WHERE ends_at > $1 AND starts_at < $2",
    [from.toISOString(), until.toISOString()],
  );

  const slots: Slot[] = [];
  const perDay = new Map<string, number>();
  for (let t = from.getTime(); t < until.getTime() && slots.length < maxTotal; t += STEP_MIN * 60_000) {
    const start = new Date(t);
    if (!isBusinessSlot(start, durationMin)) continue;
    const end = t + durationMin * 60_000;
    if (events.some((e) => e.starts_at.getTime() < end && e.ends_at.getTime() > t)) continue;
    const day = localParts(start, config.timeZone).day;
    if ((perDay.get(day) ?? 0) >= maxPerDay) continue;
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
    slots.push({ start: start.toISOString(), label: slotLabel(start) });
    t += 90 * 60_000; // spread suggestions within a day (morning, midday, afternoon)
  }
  return slots;
}
