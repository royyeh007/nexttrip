// 好友、個人檔案、行程邀請：全部經過資料庫函式（supabase/migrations/20261124000000_friends.sql）。
import { useEffect, useSyncExternalStore } from "react";
import { supabase } from "./supabase";
import type { Role } from "./data";
import { t } from "./i18n";

export interface Person { user_id: string; name: string; email: string | null }
export interface Profile { name: string; friend_code: string }
/** An invitation this person received and has not answered. */
export interface TripInvitation {
  id: string; role: Role; created_at: string; invited_by: string | null;
  trip: { id: string; name: string; start_date: string; end_date: string; place: string; settings: { icon?: string } };
  families: { id: string; label: string }[];
}
/** An invitation a trip sent out (admin page). */
export interface SentInvitation extends Person { id: string; role: Role; status: "pending" | "declined"; created_at: string }

/** The database has not been upgraded yet (the functions do not exist): the pages hide these features instead of showing an error. */
export class NotReady extends Error {}

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error(t("Supabase 還沒設定"));
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") throw new NotReady(t("這個功能要先升級資料庫（make db-push）"));
    throw new Error(/failed to fetch|network|load failed/i.test(error.message) ? t("連不上伺服器，檢查一下網路再試") : t(error.message));
  }
  return data as T;
}

export const friendsApi = {
  profile: () => call<Profile>("my_profile"),
  setName: (name: string) => call<void>("set_profile_name", { p_name: name }),
  resetCode: () => call<string>("reset_friend_code"),
  add: (code: string) => call<Person>("add_friend", { p_code: code }),
  addUser: (user: string) => call<Person>("add_friend_user", { p_user: user }),
  remove: (user: string) => call<void>("remove_friend", { p_user: user }),
  list: () => call<Person[]>("my_friends"),
  coTravellers: () => call<Person[]>("my_co_travellers"),
  invite: (trip: string, user: string, role: Role) => call<void>("invite_friend", { p_trip: trip, p_user: user, p_role: role }),
  cancel: (id: string) => call<void>("cancel_invitation", { p_id: id }),
  invitations: () => call<TripInvitation[]>("my_invitations"),
  sent: (trip: string) => call<SentInvitation[]>("trip_invitations_list", { p_trip: trip }),
  respond: (id: string, accept: boolean, family: string | null, newFamily: string | null, name: string | null) =>
    call<string | null>("respond_invitation", { p_id: id, p_accept: accept, p_family: family, p_new_family: newFamily, p_name: name }),
};

export const friendLink = (code: string) => `${location.origin}${location.pathname}#friend=${code}`;
/** A pasted friend link or a bare code → the code. */
export const friendCodeOf = (text: string) => (text.match(/friend=([A-Za-z0-9]+)/)?.[1] ?? text).trim().toLowerCase();

// ---- 好友連結：#friend=CODE。先記下來（可能還沒登入），登入後加好友 ----
const FRIEND_KEY = "jp-friend";
const store = {
  get() { try { return localStorage.getItem(FRIEND_KEY); } catch { return null; } },
  set(v: string | null) { try { if (v === null) localStorage.removeItem(FRIEND_KEY); else localStorage.setItem(FRIEND_KEY, v); } catch { /* storage blocked */ } },
};
/** Call before rendering: takes `#friend=CODE` out of the address and remembers it. */
export function captureFriend() {
  const m = location.hash.match(/^#friend=([A-Za-z0-9]+)/);
  if (!m) return;
  store.set(m[1]);
  history.replaceState(history.state, "", location.pathname + location.search);
}
let adding = false;
/** Once signed in: use the remembered friend link, tell the person what happened. */
export function usePendingFriend(uid: string | undefined) {
  useEffect(() => {
    const code = store.get();
    if (!uid || !code || adding) return;
    adding = true;
    friendsApi.add(code).then(
      (p) => { store.set(null); alert(t("已經和 {name} 成為好友。之後可以在「管理 → 邀請好友」直接邀他加入行程。", { name: p.name })); },
      (e: Error) => { store.set(null); alert(t("好友連結沒有成功：{err}", { err: t(e.message) })); },
    ).finally(() => { adding = false; });
  }, [uid]);
}

// ---- 我收到的邀請：選行程頁和帳號選單都要看，放在一個共用的地方 ----
let invitations: TripInvitation[] = [];
const subs = new Set<() => void>();
export async function refreshInvitations() {
  let next: TripInvitation[] = [];
  try { next = await friendsApi.invitations(); } catch { /* not upgraded yet, or offline: show none */ }
  if (JSON.stringify(next) !== JSON.stringify(invitations)) { invitations = next; subs.forEach((f) => f()); }
}
export function useInvitations(uid: string | undefined) {
  const v = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => invitations);
  useEffect(() => {
    if (!uid) { invitations = []; return; }
    refreshInvitations();
    const onVis = () => { if (document.visibilityState === "visible") refreshInvitations(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [uid]);
  return v;
}
