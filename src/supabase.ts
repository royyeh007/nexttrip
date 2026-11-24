import { createClient } from "@supabase/supabase-js";
import type { FunctionsHttpError } from "@supabase/supabase-js";
import { t } from "./i18n";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** null when the .env / GitHub variables are not set yet; the app then shows a setup notice. */
export const supabase = url && key ? createClient(url, key) : null;

/** How long a database read may take before we give up and keep showing what we have (weak signal abroad). */
export const READ_TIMEOUT_MS = 20_000;
export const readSignal = () => AbortSignal.timeout(READ_TIMEOUT_MS);

/**
 * Call an Edge Function and surface its JSON `error` message as a thrown Error.
 * AI calls can take a minute; without a timeout a stalled connection leaves the button spinning forever.
 * Pass `signal` to let the person cancel.
 */
export async function invoke<T>(name: string, body: Record<string, unknown>, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<T> {
  if (!supabase) throw new Error(t("Supabase 還沒設定"));
  const timeout = opts.timeoutMs ?? 150_000;
  let res;
  try {
    res = await supabase.functions.invoke<T>(name, { body, timeout, signal: opts.signal });
  } catch (e) {
    throw new Error(opts.signal?.aborted ? t("已取消") : t(e instanceof Error ? e.message : String(e)));
  }
  const { data, error } = res;
  if (error) {
    if (opts.signal?.aborted) throw new Error(t("已取消"));
    const ctx = (error as FunctionsHttpError).context;
    let msg = error.message;
    try { const j = await ctx?.json(); if (j?.error) msg = j.error; } catch { /* not json */ }
    if (/abort|timed? ?out|timeout/i.test(msg)) msg = t("等太久沒有回應，可能是網路不穩，稍後再試");
    else if (/failed to (send|fetch)|network|load failed/i.test(msg)) msg = t("連不上伺服器，檢查一下網路再試");
    else msg = t(msg);
    throw new Error(msg);
  }
  return data as T;
}

const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string | null) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* storage blocked or full */ } },
};

const INVITE_KEY = "jp-invite";
/** `#invite=CODE` in the URL: remember it for the join screen and take it out of the hash. Call before rendering. */
export function captureInvite() {
  const m = location.hash.match(/^#invite=([A-Za-z0-9_-]+)/);
  if (!m) return;
  store.set(INVITE_KEY, m[1]);
  history.replaceState(null, "", location.pathname + location.search);
}
export const storedInvite = () => store.get(INVITE_KEY);
export const setStoredInvite = (code: string) => store.set(INVITE_KEY, code);
export const clearInvite = () => store.set(INVITE_KEY, null);

const TRIP_KEY = "jp-trip";
/** The trip this device was in last; the app opens straight into it on the next visit. */
export const storedTrip = () => store.get(TRIP_KEY);
export const setStoredTrip = (id: string | null) => store.set(TRIP_KEY, id);

// ---- 上次載入的資料留一份在這支手機上：沒訊號時還看得到行程，有訊號時先顯示再更新 ----
const CACHE_PREFIX = "jp-cache:";
const UID_KEY = "jp-last-uid";
export interface Cached<T> { at: number; data: T }
export const cache = {
  get<T>(key: string): Cached<T> | null {
    const raw = store.get(CACHE_PREFIX + key);
    if (!raw) return null;
    try { const v = JSON.parse(raw) as Cached<T>; return v && typeof v.at === "number" ? v : null; } catch { return null; }
  },
  set<T>(key: string, data: T) { store.set(CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), data })); },
  /** Sign-out: nothing of this person's trips stays on a shared phone. */
  clearAll() {
    try { for (const k of Object.keys(localStorage)) if (k.startsWith(CACHE_PREFIX)) localStorage.removeItem(k); } catch { /* storage blocked */ }
    store.set(UID_KEY, null);
  },
};
/** Who was signed in on this device last (so the cached trip can be shown when the session cannot be refreshed offline). */
export const lastUid = () => store.get(UID_KEY);
export const rememberUid = (uid: string) => store.set(UID_KEY, uid);
