import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import type { PostgrestError, Session } from "@supabase/supabase-js";
import { cache, clearInvite, lastUid, readSignal, rememberUid, setStoredInvite, setStoredTrip, storedInvite, storedTrip, supabase } from "./supabase";
import { labelOf as labelIn } from "./data";
import type { ContactRow, Day, Family, FamilyId, InfoBlock, InfoPage, Member, Membership, TodoRow, Trip } from "./data";
import type { Card } from "./cards";
import { setTimezone } from "./now";

export interface TripData { families: Family[]; days: Day[]; todos: TodoRow[]; contacts: ContactRow[]; notes: Record<string, string>; info: InfoPage[] }
/** 信用卡：大家共用的卡片庫 + 這個人勾了哪幾張。`available` false = 資料庫還沒升級（沒有這兩張表）。 */
export interface CardsState { ready: boolean; available: boolean; catalog: Card[]; mine: string[] }
/** signedout → (join: an invite code is waiting) → pick: choose/create/join a trip → ready: inside a trip */
export type Phase = "noconfig" | "loading" | "signedout" | "join" | "pick" | "ready" | "error";
/**
 * How fresh the data on screen is. `message` is set when the last refresh failed (weak signal, offline): the page keeps
 * showing what it had instead of replacing everything with an error. `at` = when the data on screen was loaded.
 */
export interface SyncState { message: string | null; at: number | null; offline: boolean }

interface Ctx {
  phase: Phase;
  error: string | null;
  session: Session | null;
  /** every trip this person belongs to */
  memberships: Membership[];
  /** the open trip and this person's row in it */
  current: Trip | null;
  member: Member | null;
  trip: TripData;
  /** Which family's itinerary is on screen. */
  viewFam: FamilyId;
  setViewFam: (f: FamilyId) => void;
  labelOf: (id: FamilyId) => string;
  /** pending invite code (from a #invite= link or typed in) */
  invite: string | null;
  setInvite: (code: string | null) => void;
  enterTrip: (id: string) => void;
  leaveToPicker: () => void;
  reload: () => Promise<void>;
  /** Apply a small change that was just saved to the copy on screen, instead of loading the whole trip again. */
  patchTrip: (fn: (t: TripData) => TripData) => void;
  refreshMemberships: () => Promise<void>;
  /** 信用卡資料（不分行程，跟著人） */
  cards: CardsState;
  reloadCards: () => Promise<void>;
  signOut: () => Promise<void>;
  sync: SyncState;
  /** Try again after a failed load or when the network is back. */
  retry: () => Promise<void>;
}

const EMPTY: TripData = { families: [], days: [], todos: [], contacts: [], notes: {}, info: [] };
const NO_CARDS: CardsState = { ready: false, available: true, catalog: [], mine: [] };
const TripContext = createContext<Ctx | null>(null);

const NO_COPY = "沒有網路，這支手機上也沒有存過這個行程。連上網路後再試";
const friendly = (msg: string) => (/abort|timed? ?out|timeout/i.test(msg) ? "網路太慢，等太久沒有回應" : /failed to fetch|network|load failed/i.test(msg) ? "連不上伺服器（沒有網路？）" : msg);
/** "The table is not there" (database not upgraded yet), as opposed to a network hiccup. */
const missingTable = (e: PostgrestError | null) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache/i.test(e.message));

// What the "did anything change?" poll compares. reload() computes the same thing from the rows it just loaded,
// so a save made on this device does not look like somebody else's change on the next poll.
interface SigRows {
  days: { id?: string; fam: FamilyId[] | null; updated_at?: string | null }[];
  todos: { id: string; done: boolean; due: string; text: string; sort: number }[];
  contacts: { id: string; name: string; value: string; sort: number }[];
  info: { id: string; updated_at: string; sort: number }[] | null;
  families: { id: string; name: string; label: string; flights: string[] }[];
  extras: { key: string; data: unknown }[];
}
const byId = <T extends { id?: string }>(rows: T[]) => [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
const signature = (r: SigRows) => JSON.stringify([
  byId(r.days).map((d) => [d.id, d.fam, d.updated_at]),
  byId(r.todos).map((t) => [t.id, t.done, t.due, t.text, t.sort]),
  byId(r.contacts).map((c) => [c.id, c.name, c.value, c.sort]),
  r.info ? byId(r.info).map((p) => [p.id, p.updated_at, p.sort]) : null,
  byId(r.families).map((f) => [f.id, f.name, f.label, f.flights]),
  [...r.extras].filter((e) => e.key !== "info").sort((a, b) => a.key.localeCompare(b.key)).map((e) => [e.key, e.data]),
]);

export function TripProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  // Signed in before on this device, but the session cannot be refreshed right now (no network): show the cached trip, read-only.
  const [offlineUid, setOfflineUid] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [membershipsLoaded, setMembershipsLoaded] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [invite, setInviteState] = useState<string | null>(() => storedInvite());
  const [trip, setTrip] = useState<TripData>(EMPTY);
  const [tripLoaded, setTripLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sync, setSync] = useState<{ message: string | null; at: number | null }>({ message: null, at: null });
  const [viewFam, setViewFam] = useState<FamilyId | null>(null);
  const [cards, setCards] = useState<CardsState>(NO_CARDS);
  // what is already on screen (so a failed refresh keeps it instead of putting up the full-page error)
  const have = useRef<{ memberships: boolean; trip: string | null }>({ memberships: false, trip: null });
  const currentIdRef = useRef<string | null>(null);
  currentIdRef.current = currentId;

  /** A load failed: full-page error only when there is nothing to show; otherwise keep the page and say the data may be old. */
  const failed = useCallback((msg: string, hadData: boolean) => {
    if (hadData) setSync((s) => ({ ...s, message: friendly(msg) }));
    else setError(friendly(msg));
  }, []);

  // 1. session (supabase-js also picks up the ?code= from the Google redirect; we then clean the URL)
  useEffect(() => {
    if (!supabase) return;
    let done = false;
    const offline = () => { if (!done) { done = true; setOfflineUid(lastUid()); setAuthReady(true); } };
    // Expired token + stalled connection: do not sit on 「載入中…」; fall back to the cached trip until the refresh comes through.
    const slow = setTimeout(offline, 8000);
    supabase.auth.getSession().then(({ data, error }) => {
      clearTimeout(slow);
      if (data.session) { done = true; rememberUid(data.session.user.id); setOfflineUid(null); setSession(data.session); setAuthReady(true); }
      else if (error && (isAuthRetryableFetchError(error) || navigator.onLine === false)) offline();
      else { done = true; setSession(null); setAuthReady(true); }
      if (location.search.includes("code=")) history.replaceState(null, "", location.pathname + location.hash);
    }, offline);
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (s) { done = true; rememberUid(s.user.id); setOfflineUid(null); setSession(s); setAuthReady(true); }
      else if (event === "SIGNED_OUT") { done = true; setOfflineUid(null); setSession(null); setAuthReady(true); }
    });
    return () => { clearTimeout(slow); sub.subscription.unsubscribe(); };
  }, []);

  const uid = session?.user.id ?? offlineUid ?? undefined;
  const readOnly = !session && !!offlineUid;

  // 2. which trips this person is in (the copy from last time first, then the real thing)
  const refreshMemberships = useCallback(async () => {
    if (!supabase || !uid) { setMemberships([]); setMembershipsLoaded(true); have.current.memberships = false; return; }
    // no valid token: a query would come back empty (RLS), not as an error. Show the saved copy, or say there is none.
    if (readOnly) { if (!have.current.memberships) setError(NO_COPY); return; }
    const { data, error } = await supabase.from("members")
      .select("trip_id, user_id, email, family_id, role, name, last_opened_at, trips(id, name, start_date, end_date, place, tz, settings, created_by, created_at)")
      .eq("user_id", uid).abortSignal(readSignal());
    if (error) { failed(error.message, have.current.memberships); return; }
    const rows = ((data ?? []) as unknown as (Member & { trips: Trip | Trip[] | null })[])
      .map(({ trips, ...m }) => ({ ...m, trip: (Array.isArray(trips) ? trips[0] : trips) as Trip }))
      .filter((m) => !!m.trip)
      .sort((a, b) => (b.last_opened_at ?? "").localeCompare(a.last_opened_at ?? ""));
    cache.set(`memberships:${uid}`, rows);
    // keep the same array when nothing changed, so `current`/`member` keep their identity and nothing downstream re-runs
    setMemberships((prev) => (JSON.stringify(prev) === JSON.stringify(rows) ? prev : rows));
    setMembershipsLoaded(true);
    have.current.memberships = true;
    setError(null);
  }, [uid, readOnly, failed]);
  useEffect(() => {
    if (!authReady) return;
    const cached = uid ? cache.get<Membership[]>(`memberships:${uid}`) : null;
    if (cached) { setMemberships((prev) => (JSON.stringify(prev) === JSON.stringify(cached.data) ? prev : cached.data)); setMembershipsLoaded(true); have.current.memberships = true; }
    else if (!have.current.memberships) setMembershipsLoaded(!uid);
    refreshMemberships();
  }, [authReady, uid, refreshMemberships]);

  // 3. which trip to open: the one this device was in last, else the most recently opened anywhere; none → picker
  useEffect(() => {
    if (!membershipsLoaded) return;
    if (currentId && memberships.some((m) => m.trip_id === currentId)) return;
    if (currentId) { setCurrentId(null); setStoredTrip(null); setPickerOpen(true); return; } // was removed from that trip
    if (pickerOpen) return;
    const remembered = storedTrip();
    const pick = (remembered && memberships.find((m) => m.trip_id === remembered)) ?? memberships[0];
    if (pick) setCurrentId(pick.trip_id);
  }, [membershipsLoaded, memberships, currentId, pickerOpen]);

  const current = useMemo(() => memberships.find((m) => m.trip_id === currentId)?.trip ?? null, [memberships, currentId]);
  const member = useMemo<Member | null>(() => {
    const m = memberships.find((x) => x.trip_id === currentId);
    // offline with an expired session: nothing can be saved, so behave like a viewer (no edit buttons, no chat)
    return m ? { trip_id: m.trip_id, user_id: m.user_id, email: m.email, family_id: m.family_id, role: readOnly ? "viewer" : m.role, name: m.name, last_opened_at: m.last_opened_at } : null;
  }, [memberships, currentId, readOnly]);
  useEffect(() => { setTimezone(current?.tz); }, [current?.tz]);

  const enterTrip = useCallback((id: string) => {
    setCurrentId(id); setStoredTrip(id); setPickerOpen(false); setViewFam(null); setTripLoaded(false);
    supabase?.rpc("open_trip", { p_trip: id }).then(() => { /* remembered server-side too */ }, () => { /* ignore */ });
    setMemberships((ms) => ms.map((m) => (m.trip_id === id ? { ...m, last_opened_at: new Date().toISOString() } : m)));
    if (location.hash.startsWith("#admin")) location.hash = "";
  }, []);
  const leaveToPicker = useCallback(() => { setPickerOpen(true); setCurrentId(null); setStoredTrip(null); setTrip(EMPTY); setTripLoaded(false); have.current.trip = null; setViewFam(null); }, []);
  const setInvite = useCallback((code: string | null) => { if (code) setStoredInvite(code); else clearInvite(); setInviteState(code); }, []);

  // 3b. this person's credit cards and the shared catalog (not per trip); a missing table just hides the feature
  const reloadCards = useCallback(async () => {
    if (!supabase || !uid) { setCards(NO_CARDS); return; }
    if (readOnly) return;
    const [cat, mine] = await Promise.all([
      supabase.from("card_catalog").select("id, name, short, bank, country, network, fx_fee, rates, cap, conditions, source, checked_at, created_by, updated_by_name, updated_at").order("bank").order("name").abortSignal(readSignal()),
      supabase.from("my_cards").select("card_id").eq("user_id", uid).order("added_at").abortSignal(readSignal()),
    ]);
    if (cat.error || mine.error) {
      // the tables are not there yet → hide the feature; a network failure → keep whatever is on screen (the cached copy)
      if (missingTable(cat.error) || missingTable(mine.error)) setCards({ ready: true, available: false, catalog: [], mine: [] });
      else setCards((c) => (c.ready ? c : { ready: true, available: true, catalog: [], mine: [] }));
      return;
    }
    // the catalog is written by many people: make sure every row has the shape the pages expect before it gets anywhere
    const catalog = (cat.data ?? []).map((c) => ({ ...c, fx_fee: Number(c.fx_fee) || 0, rates: Array.isArray(c.rates) ? c.rates : [], network: Array.isArray(c.network) ? c.network : [], name: String(c.name ?? ""), short: String(c.short ?? ""), bank: String(c.bank ?? "") })) as Card[];
    const next: CardsState = { ready: true, available: true, catalog, mine: (mine.data ?? []).map((m) => m.card_id) };
    cache.set(`cards:${uid}`, next);
    setCards(next);
  }, [uid, readOnly]);
  useEffect(() => {
    const cached = uid ? cache.get<CardsState>(`cards:${uid}`) : null;
    if (cached?.data?.ready) setCards(cached.data);
    reloadCards();
  }, [uid, reloadCards]);

  // 4. the open trip's content (RLS limits it to trips this person is in)
  const sigRef = useRef<string>("");
  const reload = useCallback(async () => {
    const id = currentId;
    if (!supabase || !id) return;
    if (readOnly) { if (have.current.trip !== id) setError(NO_COPY); return; }
    const [f, d, x, t, c, ip] = await Promise.all([
      supabase.from("families").select("id, name, label, flights").eq("trip_id", id).order("sort").abortSignal(readSignal()),
      supabase.from("days").select("id, date_id, fam, d, w, city, title, hotel, items, updated_at").eq("trip_id", id).abortSignal(readSignal()),
      supabase.from("extras").select("key, data").eq("trip_id", id).abortSignal(readSignal()),
      supabase.from("todos").select("id, fam, due, text, done, sort, created_at").eq("trip_id", id).order("sort").order("created_at").abortSignal(readSignal()),
      supabase.from("contacts").select("id, fam, name, value, sort, created_at").eq("trip_id", id).order("sort").order("created_at").abortSignal(readSignal()),
      supabase.from("info_pages").select("id, title, body, blocks, sort, updated_at, updated_by_name").eq("trip_id", id).order("sort").order("updated_at").abortSignal(readSignal()),
    ]);
    // The person switched trips while this was in flight: these rows belong to the other trip, drop them.
    if (currentIdRef.current !== id) return;
    const err = f.error ?? d.error ?? x.error ?? t.error ?? c.error;
    if (err) { failed(err.message, have.current.trip === id); return; }
    const extras = Object.fromEntries((x.data ?? []).map((e) => [e.key, e.data]));
    // 其他資訊：info_pages；資料庫還沒升級（沒有這張表）時退回舊的 extras.info。網路失敗時留著畫面上原本的。
    const legacy: { id: string; title: string; updated?: string; blocks: InfoBlock[] }[] = Array.isArray(extras.info) ? extras.info : [];
    const data: TripData = {
      families: (f.data ?? []) as Family[],
      days: (d.data ?? []).map((r) => ({ rowId: r.id as string, id: r.date_id, fam: r.fam, d: r.d, w: r.w, city: r.city, title: r.title, hotel: r.hotel, items: r.items })),
      todos: (t.data ?? []) as TodoRow[],
      contacts: (c.data ?? []) as ContactRow[],
      notes: extras.notes ?? {},
      info: !ip.error ? (ip.data ?? []) as InfoPage[]
        : missingTable(ip.error) ? legacy.map((p, i) => ({ id: p.id, title: p.title, body: "", blocks: p.blocks, sort: i, updated_at: p.updated ?? "", updated_by_name: null }))
        : [],
    };
    const infoFailed = !!ip.error && !missingTable(ip.error);
    setTrip((prev) => (infoFailed ? { ...data, info: have.current.trip === id ? prev.info : [] } : data));
    setTripLoaded(true);
    have.current.trip = id;
    if (!infoFailed) cache.set(`trip:${id}`, data);
    sigRef.current = signature({ days: d.data ?? [], todos: (t.data ?? []) as TodoRow[], contacts: (c.data ?? []) as ContactRow[], info: ip.error ? null : (ip.data ?? []), families: (f.data ?? []) as Family[], extras: x.data ?? [] });
    setError(null);
    setSync({ message: infoFailed ? friendly(ip.error!.message) : null, at: Date.now() });
  }, [currentId, readOnly, failed]);
  useEffect(() => {
    if (!currentId) return;
    if (have.current.trip !== currentId) {
      // first paint from the copy saved on this device; the network refresh below replaces it
      const cached = cache.get<TripData>(`trip:${currentId}`);
      if (cached?.data?.days) { setTrip(cached.data); setTripLoaded(true); have.current.trip = currentId; setSync({ message: null, at: cached.at }); }
      else { setTripLoaded(false); }
    }
    reload();
  }, [currentId, reload]);

  const patchTrip = useCallback((fn: (t: TripData) => TripData) => {
    setTrip((t) => { const next = fn(t); if (currentIdRef.current) cache.set(`trip:${currentIdRef.current}`, next); return next; });
  }, []);

  // Other people's changes: every 5 minutes (and when the page comes back into view) ask only "did anything change?"
  // with small queries (ids and timestamps); do the full reload only when the answer is yes.
  const polling = useRef({ busy: false, last: 0 });
  const checkForChanges = useCallback(async () => {
    const id = currentId;
    const p = polling.current;
    // visibilitychange and focus both fire when the tab comes back: one check is enough
    if (!supabase || !id || readOnly || document.visibilityState !== "visible" || p.busy || Date.now() - p.last < 15_000) return;
    p.busy = true; p.last = Date.now();
    try {
      const [d, t, c, ip, f, x] = await Promise.all([
        supabase.from("days").select("id, fam, updated_at").eq("trip_id", id).abortSignal(readSignal()),
        supabase.from("todos").select("id, done, due, text, sort").eq("trip_id", id).abortSignal(readSignal()),
        supabase.from("contacts").select("id, name, value, sort").eq("trip_id", id).abortSignal(readSignal()),
        supabase.from("info_pages").select("id, updated_at, sort").eq("trip_id", id).abortSignal(readSignal()),
        supabase.from("families").select("id, name, label, flights").eq("trip_id", id).abortSignal(readSignal()),
        supabase.from("extras").select("key, data").eq("trip_id", id).abortSignal(readSignal()),
      ]);
      if (currentIdRef.current !== id) return;
      const err = d.error ?? t.error ?? c.error ?? f.error ?? x.error;
      if (err) { setSync((s) => ({ ...s, message: friendly(err.message) })); return; }
      const sig = signature({ days: d.data ?? [], todos: t.data ?? [], contacts: c.data ?? [], info: ip.error ? null : (ip.data ?? []), families: f.data ?? [], extras: x.data ?? [] });
      if (sigRef.current && sig !== sigRef.current) await reload();
      else setSync((s) => ({ message: null, at: s.at === null ? null : Date.now() }));
    } finally { p.busy = false; }
  }, [currentId, readOnly, reload]);

  const retry = useCallback(async () => {
    if (!supabase) return;
    setError(null);
    if (!session) {
      // back online: a successful refresh fires onAuthStateChange, which sets the session and re-runs the loads
      const { data } = await supabase.auth.getSession();
      if (data.session) return;
    }
    await refreshMemberships();
    await reload();
  }, [session, refreshMemberships, reload]);

  useEffect(() => {
    if (!currentId) return;
    const onVis = () => { if (document.visibilityState === "visible") checkForChanges(); };
    const onOnline = () => { retry(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    window.addEventListener("online", onOnline);
    const timer = setInterval(checkForChanges, 300_000);
    return () => { document.removeEventListener("visibilitychange", onVis); window.removeEventListener("focus", onVis); window.removeEventListener("online", onOnline); clearInterval(timer); };
  }, [currentId, checkForChanges, retry]);

  const signOut = async () => {
    await supabase?.auth.signOut().catch(() => { /* offline: the local session is cleared below anyway */ });
    cache.clearAll();
    have.current = { memberships: false, trip: null };
    setError(null); setSync({ message: null, at: null }); setOfflineUid(null); setSession(null);
    setMemberships([]); setCurrentId(null); setPickerOpen(false); setViewFam(null); setTrip(EMPTY); setTripLoaded(false); setCards(NO_CARDS);
  };

  const phase: Phase =
    !supabase ? "noconfig"
    : error ? "error"
    : !authReady ? "loading"
    : !uid ? "signedout"
    : invite && session ? "join"
    : !membershipsLoaded ? "loading"
    : !current ? (memberships.length === 0 || pickerOpen || !memberships.some((m) => m.trip_id === (storedTrip() ?? memberships[0]?.trip_id)) ? "pick" : "loading")
    : !tripLoaded ? "loading"
    : "ready";

  const families = trip.families;
  const labelOf = useCallback((id: FamilyId) => labelIn(families, id), [families]);
  const syncState = useMemo<SyncState>(() => ({ message: readOnly ? "沒有網路，登入狀態沒辦法更新" : sync.message, at: sync.at, offline: readOnly }), [sync, readOnly]);

  return (
    <TripContext.Provider value={{
      phase, error, session, memberships, current, member, trip,
      viewFam: viewFam ?? member?.family_id ?? families[0]?.id ?? "",
      setViewFam, labelOf, invite, setInvite, enterTrip, leaveToPicker, reload, patchTrip, refreshMemberships, signOut, cards, reloadCards,
      sync: syncState, retry,
    }}>
      {children}
    </TripContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTrip() {
  const ctx = useContext(TripContext);
  if (!ctx) throw new Error("useTrip outside TripProvider");
  return ctx;
}
