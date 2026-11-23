// 背景的地標從哪裡來：元素庫（backdrop_elements）和「這個城市用哪一個」的配對（backdrop_places）都在資料庫，所有行程共用。
// 順序：資料庫記過的配對 → 元素自己的關鍵字 → 都沒有就請 match-place 函式讓 AI 從現成的元素挑一個（挑完記進資料庫，之後不再問）。
// 打包在程式裡的那一份（_shared/backdrops.ts）是備份：沒訊號、資料庫還沒升級、還沒載到的時候照樣有地標。
import { useEffect, useSyncExternalStore } from "react";
import { cache, invoke, supabase } from "./supabase";
import { BACKDROP_ELEMENTS, matchByKeyword } from "../supabase/functions/_shared/backdrops";
import type { BackdropElement } from "../supabase/functions/_shared/backdrops";
import type { Trip } from "./data";

type Element = Pick<BackdropElement, "id" | "name" | "keywords"> & { shapes: unknown };
interface Library { elements: Element[]; places: Record<string, string | null> }
const KEY = "backdrops";
const norm = (city: string) => city.trim().toLowerCase().slice(0, 60);

let lib: Library = { elements: BACKDROP_ELEMENTS, places: {} };
let loaded = false, loading = false;
const asked = new Set<string>(); // cities already sent to match-place in this visit
const subs = new Set<() => void>();
const set = (next: Library) => { lib = next; subs.forEach((f) => f()); };

/** What is in the database wins over the copy built into the app (same id = the newer drawing); ids only in the app stay available. */
function merge(rows: Element[]): Element[] {
  const byId = new Map<string, Element>(BACKDROP_ELEMENTS.map((e) => [e.id, e]));
  for (const r of rows) byId.set(r.id, r);
  return [...byId.values()];
}

async function load() {
  if (loaded || loading || !supabase) return;
  loading = true;
  const saved = cache.get<Library>(KEY);
  if (saved?.data?.elements?.length) set({ elements: merge(saved.data.elements), places: saved.data.places ?? {} });
  try {
    const [el, pl] = await Promise.all([
      supabase.from("backdrop_elements").select("id, name, keywords, shapes"),
      supabase.from("backdrop_places").select("place, element_id"),
    ]);
    if (!el.error && !pl.error) {
      const fresh: Library = { elements: (el.data ?? []) as Element[], places: Object.fromEntries((pl.data ?? []).map((r) => [r.place as string, (r.element_id as string | null) ?? null])) };
      cache.set(KEY, fresh);
      set({ elements: merge(fresh.elements), places: fresh.places });
      loaded = true;
    }
  } catch { /* offline or the tables are not there yet: the built-in copy is in use */ }
  loading = false;
}

function resolve(city: string): { element: Element | null; known: boolean } {
  const key = norm(city);
  if (!key) return { element: null, known: true };
  if (key in lib.places) { const id = lib.places[key]; return { element: lib.elements.find((e) => e.id === id) ?? null, known: true }; }
  const id = matchByKeyword(key, lib.elements);
  return id ? { element: lib.elements.find((e) => e.id === id) ?? null, known: true } : { element: null, known: false };
}

/** A city nothing matches: ask once (per visit) for the best existing element; the answer is stored for everybody. */
async function ask(tripId: string, city: string) {
  const key = norm(city);
  if (!loaded || asked.has(key) || !navigator.onLine) return;
  asked.add(key);
  try {
    const res = await invoke<{ element_id: string | null }>("match-place", { trip_id: tripId, city }, { timeoutMs: 30_000 });
    const places = { ...lib.places, [key]: res.element_id ?? null };
    cache.set(KEY, { elements: lib.elements, places });
    set({ ...lib, places });
  } catch { /* no landmark for this city this time; the trip's general scene still shows */ }
}

/** The landmark for the city on screen (null = none: only the trip's general scene). */
export function useLandmark(trip: Pick<Trip, "id"> | null, city: string): { id: string; shapes: unknown } | null {
  const l = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => lib);
  const tripId = trip?.id;
  useEffect(() => { if (tripId) load(); }, [tripId]);
  const { element, known } = tripId ? resolve(city) : { element: null, known: true };
  useEffect(() => { if (tripId && city && !known) ask(tripId, city); }, [tripId, city, known, l]);
  return element ? { id: element.id, shapes: element.shapes } : null;
}
