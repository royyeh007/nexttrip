import { isLeg } from "./data";
import type { Day, Item, Leg, Stop } from "./data";
import { toMinutes } from "./now";
import { supabase } from "./supabase";

/** Same row of `days` (same date and same fam set)? */
export const sameDayRow = (a: Day, b: Day) => a.id === b.id && JSON.stringify(a.fam ?? null) === JSON.stringify(b.fam ?? null);

/** Index of this stop in a (possibly re-read) item list: by time+name, then by name alone. */
export function findStop(items: Item[], key: { t: string; n: string }) {
  let idx = items.findIndex((it) => !isLeg(it) && it.t === key.t && it.n === key.n);
  if (idx < 0) idx = items.findIndex((it) => !isLeg(it) && it.n === key.n);
  return idx;
}

/**
 * Narrow a `days` query to exactly this row. A date can have several rows (everyone's, one family's own, a joint one):
 * `fam @> [family]` ("contains") also matches the joint row, so a delete or an edit meant for one row hit both.
 * By row id when we have it; otherwise by the whole `fam` array (equal, not "contains").
 * (Typed loosely on purpose: the PostgREST builders are too deeply generic for a structural constraint.)
 */
export function whereDay<T>(q: T, tripId: string, day: Pick<Day, "rowId" | "id" | "fam">): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = q as any;
  if (day.rowId) return b.eq("id", day.rowId) as T;
  const r = b.eq("trip_id", tripId).eq("date_id", day.id);
  return (day.fam ? r.eq("fam", `{${day.fam.join(",")}}`) : r.is("fam", null)) as T;
}

/**
 * Change one day's items with a re-read first, so an edit never overwrites what someone else changed while the sheet was open.
 * `mutate` gets the fresh items and returns the new list (or null to abort). Returns an error message or null.
 */
export async function editDayItems(tripId: string, day: Day, mutate: (items: Item[]) => Item[] | null): Promise<string | null> {
  if (!supabase) return "Supabase 還沒設定";
  const { data: fresh, error: readErr } = await whereDay(supabase.from("days").select("id, items, updated_at"), tripId, day).maybeSingle();
  if (readErr || !fresh) return readErr?.message ?? "這一天已經不存在了";
  const next = mutate(fresh.items as Item[]);
  if (!next) return "這個地點已經被改掉了，重新打開再試";
  // only if nobody saved this row between our read and our write (otherwise their change would be lost)
  const { data: saved, error } = await supabase.from("days").update({ items: next, updated_at: new Date().toISOString() })
    .eq("id", fresh.id as string).eq("updated_at", fresh.updated_at as string).select("id");
  if (error) return error.message;
  if (!saved?.length) return "剛剛有人也改了這一天，請再按一次";
  return null;
}

/** Stops in time order, each keeping the leg(s) that lead into it. Unsortable times → unchanged. */
export function sortByTime(items: Item[]): Item[] {
  const units: { legs: Leg[]; stop: Stop }[] = [];
  let legs: Leg[] = [];
  for (const it of items) { if (isLeg(it)) legs.push(it); else { units.push({ legs, stop: it }); legs = []; } }
  if (units.some((u) => isNaN(toMinutes(u.stop.t)))) return items;
  const sorted = [...units].sort((a, b) => toMinutes(a.stop.t) - toMinutes(b.stop.t));
  return [...sorted.flatMap((u) => [...u.legs, u.stop]), ...legs];
}

/** Remove a stop together with the leg that led into it (or, for the first stop, the leg out of it). */
export function removeStopAt(items: Item[], idx: number): Item[] {
  const out = [...items];
  if (idx > 0 && isLeg(out[idx - 1])) out.splice(idx - 1, 2);
  else if (idx + 1 < out.length && isLeg(out[idx + 1])) out.splice(idx, 2);
  else out.splice(idx, 1);
  return out;
}
