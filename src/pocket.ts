// 口袋名單：每個人自己收藏的地點，跟著帳號，不屬於任何行程（supabase/migrations/20261205000000_pocket.sql）。
// 這裡是資料和小工具；畫面在 components/PocketView.tsx。
import { useEffect, useSyncExternalStore } from "react";
import { supabase } from "./supabase";
import { shrink } from "./images";
import type { Kind, Stop } from "./data";
import { t } from "./i18n";

export interface PocketDetails { info?: string[]; rec?: string[]; tips?: string[]; ll?: [number, number] }
export interface PocketPlace {
  id: string; name: string; kind: Kind; category: string; city: string; q: string; addr: string; tel: string; s: string; note: string;
  details: PocketDetails; photos: string[]; created_at: string; updated_at: string;
}
/** What a person fills in (or what a stop brings over) before it has an id. */
export type PocketDraft = Pick<PocketPlace, "name" | "kind" | "category" | "city" | "q" | "addr" | "tel" | "s" | "note" | "details">;
/** This place was once on that trip's day. The trip name is kept even after the trip is deleted. */
export interface PocketUse { id: string; place_id: string; trip_id: string | null; trip_name: string; date_id: string; created_at: string }
export interface PocketShare { code: string; title: string; count: number; ids: string[]; created_at: string }
export interface SharedPocket { code: string; title: string; owner: string; mine: boolean; places: Omit<PocketPlace, "created_at" | "updated_at">[] }

export const MAX_PHOTOS = 3;
/** What the storage bucket accepts for one photo (after shrinking). */
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
/** The original file a person may pick: bigger than this is not even decoded. */
export const PHOTO_SOURCE_MAX_BYTES = 25 * 1024 * 1024;
export const POCKET_BUCKET = "pocket-photos";
export const POCKET_MAX = 500;

// ---------- pure helpers (tested in tests/pocket.test.ts) ----------

const MEAL = /^(早餐|午餐|晚餐|下午茶|點心|宵夜|元旦餐|Breakfast|Lunch|Dinner|Tea|Snack)[：:]\s*/i;
/** 「午餐：一蘭拉麵」 → 「一蘭拉麵」: in the pocket list a place is not tied to a meal. */
export const plainName = (n: string) => n.replace(MEAL, "").trim();
/** Two names are the same place when they match without case, spaces or the meal prefix. */
export const pocketKey = (n: string) => plainName(n).toLowerCase().replace(/[\s・·,，、.。()（）\-－—'’"]/g, "");

const clip = (s: string | undefined, n: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const clipList = (a: string[] | undefined) => (a ?? []).map((x) => clip(x, 300)).filter(Boolean).slice(0, 12);

/** A stop of a trip → a pocket place. Bookings, notes written by the family and who is going stay with the trip. */
export function placeFromStop(stop: Stop, city: string): PocketDraft {
  const details: PocketDetails = {};
  const info = clipList(stop.info), rec = clipList(stop.rec), tips = clipList(stop.tips);
  if (info.length) details.info = info;
  if (rec.length) details.rec = rec;
  if (tips.length) details.tips = tips;
  if (Array.isArray(stop.ll) && stop.ll.length === 2 && stop.ll.every((x) => Number.isFinite(x))) details.ll = [stop.ll[0], stop.ll[1]];
  const name = clip(plainName(stop.n) || stop.n, 120);
  return { name, kind: stop.k, category: "", city: clip(city, 60), q: clip(stop.q && stop.q !== stop.n ? stop.q : "", 300), addr: clip(stop.addr, 300), tel: clip(stop.tel, 60), s: clip(stop.s, 300), note: "", details };
}

/** A pocket place → a stop to put on a day. The person's own note and photos stay in the pocket list. */
export function stopFromPlace(p: Pick<PocketPlace, "name" | "kind" | "q" | "addr" | "tel" | "s" | "details">, time = ""): Stop {
  const out: Stop = { t: time.trim(), n: p.name, k: p.kind, q: p.q || [p.name, p.addr].filter(Boolean).join(" ") };
  if (p.s) out.s = p.s;
  if (p.addr) out.addr = p.addr;
  if (p.tel) out.tel = p.tel;
  if (p.details.info?.length) out.info = [...p.details.info];
  if (p.details.rec?.length) out.rec = [...p.details.rec];
  if (p.details.tips?.length) out.tips = [...p.details.tips];
  if (p.details.ll) out.ll = [p.details.ll[0], p.details.ll[1]];
  return out;
}

/** The pocket place that is this stop (same name), if the person saved it before. */
export const findInPocket = (list: PocketPlace[], name: string) => { const k = pocketKey(name); return k ? list.find((p) => pocketKey(p.name) === k) : undefined; };

/** The person's own categories, most used first. */
export function categoriesOf(list: Pick<PocketPlace, "category">[]): string[] {
  const n = new Map<string, number>();
  for (const p of list) if (p.category) n.set(p.category, (n.get(p.category) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hant")).map(([c]) => c);
}

export const GROUP_BY = ["category", "kind", "city"] as const;
export type GroupBy = (typeof GROUP_BY)[number];
const KIND_ORDER: Kind[] = ["food", "sight", "shop", "hotel", "move"];
/** Places in sections. `key` "" = no category / no city: that section goes last. Inside a section: by name. */
export function groupPlaces<P extends Pick<PocketPlace, "name" | "category" | "kind" | "city">>(list: P[], by: GroupBy): { key: string; items: P[] }[] {
  const groups = new Map<string, P[]>();
  for (const p of list) { const k = by === "kind" ? p.kind : by === "city" ? p.city : p.category; const arr = groups.get(k) ?? []; arr.push(p); groups.set(k, arr); }
  const rank = (k: string) => (by === "kind" ? KIND_ORDER.indexOf(k as Kind) : 0);
  return [...groups.entries()]
    .sort((a, b) => (a[0] === "" ? 1 : 0) - (b[0] === "" ? 1 : 0) || rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0], "zh-Hant"))
    .map(([key, items]) => ({ key, items: [...items].sort((a, b) => a.name.localeCompare(b.name, "zh-Hant")) }));
}

/** Does this place match what was typed in the search box (every word, anywhere in its text)? */
export function matchPlace(p: Pick<PocketPlace, "name" | "category" | "city" | "addr" | "s" | "note">, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [p.name, p.category, p.city, p.addr, p.s, p.note].join("\n").toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** Why this picture cannot be used, before anything is uploaded; null when it is fine. */
export function photoProblem(f: { name: string; type: string; size: number }, have: number): string | null {
  if (have >= MAX_PHOTOS) return t("一個地點最多 {n} 張照片，先刪掉一張再加", { n: MAX_PHOTOS });
  const ext = f.name.includes(".") ? f.name.split(".").pop()!.toLowerCase() : "";
  if (ext === "heic" || ext === "heif" || /heic|heif/i.test(f.type)) return t("iPhone 的 HEIC 照片不支援。請改傳截圖，或在相機設定選「最相容」再拍一次");
  if (!f.type.startsWith("image/")) return t("只能放照片（JPG、PNG、WebP）");
  if (f.size > PHOTO_SOURCE_MAX_BYTES) return t("照片太大（原檔上限 25 MB）");
  return null;
}

export const shareLink = (code: string) => `${location.origin}${location.pathname}#pocket=${code}`;
/** A pasted share link or a bare code → the code. */
export const shareCodeOf = (text: string) => (text.match(/pocket=([A-Za-z0-9]+)/)?.[1] ?? text).trim().toLowerCase();

// ---------- the share link a person arrived with: #pocket=CODE ----------
const LINK_KEY = "jp-pocket";
const linkStore = {
  get() { try { return localStorage.getItem(LINK_KEY); } catch { return null; } },
  set(v: string | null) { try { if (v === null) localStorage.removeItem(LINK_KEY); else localStorage.setItem(LINK_KEY, v); } catch { /* storage blocked */ } },
};
/** Call before rendering: takes `#pocket=CODE` out of the address and remembers it (the person may have to sign in first). */
export function capturePocketLink() {
  const m = location.hash.match(/^#pocket=([A-Za-z0-9]+)/);
  if (!m) return;
  linkStore.set(m[1].toLowerCase());
  history.replaceState(history.state, "", location.pathname + location.search);
}
export const pendingPocketLink = () => linkStore.get();
export const clearPocketLink = () => linkStore.set(null);

// ---------- database ----------

/** The database has not been upgraded yet: the pages hide the feature instead of showing an error. */
export class PocketNotReady extends Error {}
const COLS = "id, name, kind, category, city, q, addr, tel, s, note, details, photos, created_at, updated_at";
const fail = (e: { code?: string; message: string }): never => {
  if (e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST202" || e.code === "42883" || /does not exist|schema cache/i.test(e.message)) throw new PocketNotReady(t("這個功能要先升級資料庫（make db-push）"));
  throw new Error(/failed to fetch|network|load failed/i.test(e.message) ? t("連不上伺服器，檢查一下網路再試") : t(e.message));
};
const db = () => { if (!supabase) throw new Error(t("Supabase 還沒設定")); return supabase; };
const rowOf = (r: Record<string, unknown>): PocketPlace => ({
  ...(r as unknown as PocketPlace),
  details: r.details && typeof r.details === "object" && !Array.isArray(r.details) ? (r.details as PocketDetails) : {},
  photos: Array.isArray(r.photos) ? (r.photos as string[]) : [],
});

export const photoUrl = (path: string) => supabase?.storage.from(POCKET_BUCKET).getPublicUrl(path).data.publicUrl ?? "";
const randomName = () => { const a = new Uint8Array(12); crypto.getRandomValues(a); return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join(""); };
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Shrink a picture until the bucket takes it (longest side 1600, then 1100), upload it into this person's folder, return its path. */
async function uploadPhoto(uid: string, file: Blob): Promise<string> {
  const asFile = file instanceof File ? file : new File([file], "photo", { type: file.type });
  let blob = await shrink(asFile, 1600);
  if (blob.size > PHOTO_MAX_BYTES) blob = await shrink(asFile, 1100);
  if (!EXT[blob.type]) throw new Error(t("這張照片的格式不支援，請改傳 JPG、PNG 或截圖"));
  if (blob.size > PHOTO_MAX_BYTES) throw new Error(t("照片太大：縮小後還是超過 2 MB，請換一張或先裁切"));
  const path = `${uid}/${randomName()}.${EXT[blob.type]}`;
  const { error } = await db().storage.from(POCKET_BUCKET).upload(path, blob, { contentType: blob.type, cacheControl: "31536000" });
  if (error) throw new Error(/exceeded|too large|size/i.test(error.message) ? t("照片太大：縮小後還是超過 2 MB，請換一張或先裁切") : t(error.message));
  return path;
}
async function dropPhotos(paths: string[]) {
  if (!supabase || !paths.length) return;
  try { await supabase.storage.from(POCKET_BUCKET).remove(paths); } catch { /* a leftover file is not worth failing for */ }
}

async function userId(): Promise<string> {
  const { data } = await db().auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error(t("請先登入"));
  return id;
}

export const pocketApi = {
  async load(): Promise<{ places: PocketPlace[]; uses: PocketUse[] }> {
    const [p, u] = await Promise.all([
      db().from("pocket_places").select(COLS).order("created_at", { ascending: false }),
      db().from("pocket_uses").select("id, place_id, trip_id, trip_name, date_id, created_at").order("date_id", { ascending: false }),
    ]);
    if (p.error) fail(p.error);
    if (u.error) fail(u.error);
    return { places: (p.data ?? []).map(rowOf), uses: (u.data ?? []) as PocketUse[] };
  },
  async add(d: PocketDraft): Promise<PocketPlace> {
    const { data, error } = await db().from("pocket_places").insert(d).select(COLS).single();
    if (error) fail(error);
    return rowOf(data as Record<string, unknown>);
  },
  async update(id: string, patch: Partial<PocketDraft & { photos: string[] }>): Promise<PocketPlace> {
    const { data, error } = await db().from("pocket_places").update(patch).eq("id", id).select(COLS).single();
    if (error) fail(error);
    return rowOf(data as Record<string, unknown>);
  },
  async remove(p: Pick<PocketPlace, "id" | "photos">) {
    const { error } = await db().from("pocket_places").delete().eq("id", p.id);
    if (error) fail(error);
    await dropPhotos(p.photos);
  },
  /** Remember that this place is on that trip's day. Saying it twice is fine. */
  async recordUse(placeId: string, trip: { id: string; name: string }, dateId: string) {
    const { error } = await db().from("pocket_uses").upsert({ place_id: placeId, trip_id: trip.id, trip_name: trip.name.slice(0, 120) || "?", date_id: dateId }, { onConflict: "place_id,trip_id,date_id", ignoreDuplicates: true });
    if (error) fail(error);
  },
  async forgetUse(id: string) {
    const { error } = await db().from("pocket_uses").delete().eq("id", id);
    if (error) fail(error);
  },
  /** Add one picture. The list is read again first, so two phones adding at once cannot go past the limit unnoticed. */
  async addPhoto(placeId: string, file: File): Promise<PocketPlace> {
    const uid = await userId();
    const cur = await db().from("pocket_places").select("photos").eq("id", placeId).single();
    if (cur.error) fail(cur.error);
    const have = ((cur.data?.photos ?? []) as string[]);
    const problem = photoProblem(file, have.length);
    if (problem) throw new Error(problem);
    const path = await uploadPhoto(uid, file);
    const { data, error } = await db().from("pocket_places").update({ photos: [...have, path] }).eq("id", placeId).select(COLS).single();
    if (error) { await dropPhotos([path]); fail(error); }
    return rowOf(data as Record<string, unknown>);
  },
  async removePhoto(p: Pick<PocketPlace, "id" | "photos">, path: string): Promise<PocketPlace> {
    const { data, error } = await db().from("pocket_places").update({ photos: p.photos.filter((x) => x !== path) }).eq("id", p.id).select(COLS).single();
    if (error) fail(error);
    await dropPhotos([path]);
    return rowOf(data as Record<string, unknown>);
  },
  async shares(): Promise<PocketShare[]> {
    const { data, error } = await db().rpc("pocket_shares_mine");
    if (error) fail(error);
    return (data ?? []) as PocketShare[];
  },
  async share(ids: string[], title: string): Promise<string> {
    const { data, error } = await db().rpc("pocket_share_create", { p_ids: ids, p_title: title });
    if (error) fail(error);
    return data as string;
  },
  async unshare(code: string) {
    const { error } = await db().rpc("pocket_share_delete", { p_code: code });
    if (error) fail(error);
  },
  async shared(code: string): Promise<SharedPocket> {
    const { data, error } = await db().rpc("pocket_shared", { p_code: code });
    if (error) fail(error);
    const s = data as SharedPocket;
    return { ...s, places: (s.places ?? []).map((p) => ({ ...p, details: p.details && typeof p.details === "object" ? p.details : {}, photos: Array.isArray(p.photos) ? p.photos : [] })) };
  },
  /** Copy a friend's place into my list. Their photos are copied into my own folder (theirs can be deleted any time). */
  async adopt(p: SharedPocket["places"][number]): Promise<PocketPlace> {
    const uid = await userId();
    let row = await pocketApi.add({ name: p.name, kind: p.kind, category: p.category, city: p.city, q: p.q, addr: p.addr, tel: p.tel, s: p.s, note: p.note, details: p.details });
    const mine: string[] = [];
    for (const path of p.photos.slice(0, MAX_PHOTOS)) {
      try {
        const res = await fetch(photoUrl(path));
        if (!res.ok) continue;
        mine.push(await uploadPhoto(uid, await res.blob()));
      } catch { /* a picture that did not come over: the place is still saved */ }
    }
    if (mine.length) {
      try { row = await pocketApi.update(row.id, { photos: mine }); } catch { await dropPhotos(mine); }
    }
    return row;
  },
};

// ---------- one copy of the list for every page that shows it ----------
export interface PocketState { state: "idle" | "loading" | "ok" | "notready" | "error"; places: PocketPlace[]; uses: PocketUse[]; error: string | null }
let pocket: PocketState = { state: "idle", places: [], uses: [], error: null };
let owner: string | undefined;
let loading: Promise<void> | null = null;
const subs = new Set<() => void>();
const publish = (next: PocketState) => { pocket = next; subs.forEach((f) => f()); };

export function refreshPocket(): Promise<void> {
  if (loading) return loading;
  if (pocket.state === "idle") publish({ ...pocket, state: "loading" });
  const forWhom = owner;
  loading = pocketApi.load().then(
    (r) => { if (forWhom === owner) publish({ state: "ok", places: r.places, uses: r.uses, error: null }); },
    (e: Error) => { if (forWhom === owner) publish({ ...pocket, state: e instanceof PocketNotReady ? "notready" : pocket.state === "ok" ? "ok" : "error", error: e.message }); },
  ).finally(() => { loading = null; });
  return loading;
}
/** Put one saved row into the copy on screen without loading everything again. */
export function patchPocket(row: PocketPlace | { removed: string }) {
  if ("removed" in row) publish({ ...pocket, places: pocket.places.filter((p) => p.id !== row.removed), uses: pocket.uses.filter((u) => u.place_id !== row.removed) });
  else publish({ ...pocket, places: pocket.places.some((p) => p.id === row.id) ? pocket.places.map((p) => (p.id === row.id ? row : p)) : [row, ...pocket.places] });
}
/** The signed-in person's pocket list. Loaded once, shared by the pocket page and the trip pages. */
export function usePocket(uid: string | undefined): PocketState {
  const v = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => pocket);
  useEffect(() => {
    if (owner !== uid) { owner = uid; loading = null; pocket = { state: "idle", places: [], uses: [], error: null }; subs.forEach((f) => f()); }
    if (uid && pocket.state === "idle") void refreshPocket();
  }, [uid]);
  return v;
}
