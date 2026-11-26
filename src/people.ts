// 我的家人（帳號層級）和每個行程誰會去：全部經過資料庫函式（supabase/migrations/20261125000000_household.sql）。
import { useEffect, useSyncExternalStore } from "react";
import { supabase } from "./supabase";
import { NotReady } from "./friends";
import { t, list } from "./i18n";

export type PersonKind = "adult" | "child";
/** One person on my family list. `age` = today; `birthday` is only ever sent to the people who manage this list. */
export interface HouseholdPerson { id: string; name: string; kind: PersonKind; birthday: string | null; age: number | null; note: string; user_id: string | null; is_me: boolean; email: string | null }
export interface Household { id: string; people: HouseholdPerson[] }
/** Someone going on a trip. `age` = on the trip's first day. `guest` = typed in for this trip only (no family list behind it). */
export interface TripPerson { id: string; family_id: string; guest: boolean; name: string; kind: PersonKind; age: number | null; note: string; user_id: string | null; person_id: string | null; mine: boolean }

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error(t("Supabase 還沒設定"));
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") throw new NotReady(t("這個功能要先升級資料庫（make db-push）"));
    throw new Error(/failed to fetch|network|load failed/i.test(error.message) ? t("連不上伺服器，檢查一下網路再試") : t(error.message));
  }
  return data as T;
}

export const peopleApi = {
  household: () => call<Household>("my_household"),
  savePerson: (p: { id: string | null; name: string; kind: PersonKind; age: number | null; birthday: string | null; note: string }) =>
    call<string>("household_save_person", { p_id: p.id, p_name: p.name, p_kind: p.kind, p_age: p.age, p_birthday: p.birthday, p_note: p.note }),
  removePerson: (id: string) => call<void>("household_remove_person", { p_id: id }),
  linkAdult: (person: string, user: string) => call<void>("household_link_adult", { p_person: person, p_user: user }),
  unlink: (person: string) => call<void>("household_unlink", { p_person: person }),
  tripPeople: (trip: string) => call<TripPerson[]>("trip_people_list", { p_trip: trip }),
  setTripPeople: (trip: string, people: string[]) => call<void>("set_trip_people", { p_trip: trip, p_people: people }),
  saveGuest: (trip: string, g: { id: string | null; family: string; name: string; kind: PersonKind; age: number | null; note: string }) =>
    call<string>("trip_guest_save", { p_trip: trip, p_id: g.id, p_family: g.family, p_name: g.name, p_kind: g.kind, p_age: g.age, p_note: g.note }),
  removeTripPerson: (id: string) => call<void>("trip_person_remove", { p_id: id }),
};

/** 「4 大人＋3 小孩（7、9、11 歲）」: what a restaurant or a ticket counter asks for. */
export function headcount(people: { kind: PersonKind; age: number | null }[]): string {
  const adults = people.filter((p) => p.kind === "adult").length;
  const kids = people.filter((p) => p.kind === "child");
  if (!people.length) return t("還沒有人");
  const ages = kids.map((k) => k.age).filter((a): a is number => a !== null).sort((a, b) => a - b);
  const n = kids.length, a = list(ages.map(String));
  const kidText = !n ? "" : !ages.length ? (n === 1 ? t("1 小孩") : t("{n} 小孩", { n })) : ages.length < n ? t("{n} 小孩（{ages} 歲，其他沒填年齡）", { n, ages: a }) : n === 1 ? t("1 小孩（{ages} 歲）", { ages: a }) : t("{n} 小孩（{ages} 歲）", { n, ages: a });
  const adultText = !adults ? "" : adults === 1 ? t("1 大人") : t("{n} 大人", { n: adults });
  return adultText && kidText ? t("{adults}＋{kids}", { adults: adultText, kids: kidText }) : adultText || kidText;
}
export const personLabel = (p: { name: string; kind: PersonKind; age: number | null }) => (p.kind === "child" ? (p.age !== null ? t("{name}（{age} 歲）", { name: p.name, age: p.age }) : t("{name}（小孩）", { name: p.name })) : p.name);

/**
 * 一次代填好幾位：「Yenchih、Amie、小宇 9 歲」→ 三個人。用頓號、逗號、分號或換行分開。
 * 名字後面有年齡（9 歲、9y、(9)）或寫「小孩」就是小孩，其他是大人。最多 20 位，名字最多 40 字。
 */
export function parseGuests(text: string): { name: string; kind: PersonKind; age: number | null }[] {
  const out: { name: string; kind: PersonKind; age: number | null }[] = [];
  for (const raw of text.split(/[、,，;；\n]+/)) {
    let s = raw.replace(/\s+/g, " ").trim();
    if (!s) continue;
    let kind: PersonKind = "adult", age: number | null = null;
    // 年齡前面要有空格或括號，不然就要有「歲」這種單位（R2D2 的 2 不是年齡）
    const a = s.match(/(?:[\s(（]+(\d{1,2})\s*(?:歲|岁|才|y\/?o|yrs?|years? old|y)?|(\d{1,2})\s*(?:歲|岁|才))\s*[)）]?$/i);
    if (a && a.index! > 0) { const n = Number(a[1] ?? a[2]); s = s.slice(0, a.index).trim(); if (n < 18) { kind = "child"; age = n; } }
    const k = s.match(/[\s(（]*(小孩|小朋友|兒童|child|kid|大人|成人|adult)\s*[)）]?$/i);
    if (k && k.index! > 0) { s = s.slice(0, k.index).trim(); if (!/大人|成人|adult/i.test(k[1])) kind = "child"; else if (age === null) kind = "adult"; }
    s = s.replace(/[\s(（:：]+$/, "").slice(0, 40);
    if (s) out.push({ name: s, kind, age });
    if (out.length >= 20) break;
  }
  return out;
}

/** 這一站有哪幾家一個人都沒去（`going` 沒給 = 全員）。在這一站行程裡的每一家至少要有一個人去。 */
export function familiesWithNobody(all: { id: string; family_id: string }[], going: string[] | undefined): string[] {
  if (!going) return [];
  const on = new Set(going);
  return [...new Set(all.map((p) => p.family_id))].filter((f) => !all.some((p) => p.family_id === f && on.has(p.id)));
}

// ---- 這個行程誰會去：行程頁、地點詳細頁、成員頁都要看，共用一份 ----
/** `null` = not loaded, or the database has not been upgraded: the pages then simply leave the feature out. */
let state: { trip: string; people: TripPerson[] | null } = { trip: "", people: null };
const subs = new Set<() => void>();
let wanted = "";
export async function refreshTripPeople(trip: string) {
  wanted = trip;
  let next: TripPerson[] | null = null;
  try { next = await peopleApi.tripPeople(trip); } catch { /* not upgraded yet, offline, or no longer in this trip */ }
  if (wanted !== trip) return; // switched to another trip while this was on its way
  if (state.trip !== trip || JSON.stringify(next) !== JSON.stringify(state.people)) { state = { trip, people: next }; subs.forEach((f) => f()); }
}
export function useTripPeople(trip: string | undefined): TripPerson[] | null {
  const s = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state);
  useEffect(() => { if (trip) refreshTripPeople(trip); }, [trip]);
  return trip && s.trip === trip ? s.people : null;
}
