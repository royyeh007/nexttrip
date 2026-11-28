import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { daysFor, dotDate, isViewer } from "./data";
import type { Day, FamilyId, Stop } from "./data";
import { useWeather } from "./useWeather";
import { ChipWeather } from "./components/Weather";
import { DayView } from "./components/DayView";
import { DetailSheet } from "./components/DetailSheet";
import { TodoView } from "./components/TodoView";
import { UploadView } from "./components/Upload";
import { ChatWidget } from "./components/Chat";
import { AddDay } from "./components/AddDay";
import { AllFamiliesDay } from "./components/AllFamiliesDay";
import { FlightStatus } from "./components/FlightStatus";
import { InfoView } from "./components/InfoView";
import { Lightbox } from "./md";
import { AdminView } from "./components/AdminView";
import { Overview } from "./components/Overview";
import { GuideView } from "./components/GuideView";
import { CardsView } from "./components/CardsView";
import { QuickPickFab } from "./components/QuickPick";
import { CouponHost, openCoupons, useCouponsOn } from "./components/Coupons";
import { MenuIcon, PaperPlane, PersonIcon } from "./components/Logo";
import { TripIcon, tripIconId } from "./tripIcons";
import { AccountPage } from "./components/AccountView";
import { PocketPage } from "./components/PocketView";
import { pendingPocketLink } from "./pocket";
import { setBackdropContext } from "./components/Backdrop";
import { TripLoader } from "./components/Loader";
import { describe, fetchCurrent, placeByKey, placesFor } from "./weather";
import type { CurrentSky } from "./weather";
import { PeopleBanner } from "./components/PeopleView";
import { useInvitations, usePendingFriend } from "./friends";
import { Login } from "./components/Login";
import { JoinTrip } from "./components/JoinTrip";
import { TripPicker } from "./components/TripPicker";
import { supabase } from "./supabase";
import { LeaveDialog } from "./components/LeaveDialog";
import { useTrip } from "./trip";
import { endPreview, fakeNow, setNowLine, startPreview, useNow, useNowLine } from "./now";
import { useScrollEdges } from "./useScrollEdges";
import type { LinkedLeg } from "./maps";
import { t, tr, wk, list } from "./i18n";

const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

const PAGES = ["overview", "todo", "upload", "info", "cards", "admin", "guide", "people"];
function currentView(dayIds: string[], dayKey: string, todayId?: string) {
  const h = location.hash.slice(1);
  if (PAGES.includes(h) || dayIds.includes(h)) return h;
  if (todayId && dayIds.includes(todayId)) return todayId; // during the trip, open on today
  const s = store.get(dayKey) ?? "";
  if (PAGES.includes(s) || dayIds.includes(s)) return s;
  return dayIds[0] ?? "todo";
}

export interface Selected { day: Day; stop: Stop; arrive?: LinkedLeg }

function Notice({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="wrap pick">
      <header className="hero"><h1>{title}</h1></header>
      <div className="notice">{children}</div>
    </div>
  );
}

/** 「載入中…」，等了一陣子還沒好就給一個出口（訊號很差時不要讓人對著空白畫面乾等）。 */
/** 載入畫面一出現就至少留這麼久：資料太快回來時動畫才不會閃一下就不見。 */
const MIN_LOADING_MS = 1500;
function useMinLoading(loading: boolean): boolean {
  const since = useRef<number | null>(loading ? Date.now() : null);
  const [held, setHeld] = useState(loading);
  useEffect(() => {
    if (loading) { if (since.current === null) since.current = Date.now(); setHeld(true); return; }
    if (since.current === null) return;
    const left = MIN_LOADING_MS - (Date.now() - since.current);
    const done = () => { since.current = null; setHeld(false); };
    if (left <= 0) { done(); return; }
    const timer = setTimeout(done, left);
    return () => clearTimeout(timer);
  }, [loading]);
  return loading || held;
}

function Loading() {
  const [slow, setSlow] = useState(false);
  // 載入的時候畫面上只有動畫：後面那幅會動的背景先收起來，載完才出現
  useLayoutEffect(() => { document.documentElement.dataset.loading = "1"; return () => { delete document.documentElement.dataset.loading; }; }, []);
  useEffect(() => { const timer = setTimeout(() => setSlow(true), 7000); return () => clearTimeout(timer); }, []);
  return (
    <div className="wrap pick loadingpage">
      <TripLoader label={t("載入中…")} />
      {slow && <div className="notice"><p>{t("網路有點慢，還在等回應。")}</p><div className="actions"><button type="button" className="btn" onClick={() => location.reload()}>{t("重新整理")}</button></div></div>}
    </div>
  );
}

const clock = (at: number) => new Date(at).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

/** 更新失敗或離線時的提示：畫面照樣顯示原本的資料，不會整頁換成錯誤。 */
function SyncBar() {
  const { sync, retry } = useTrip();
  const [busy, setBusy] = useState(false);
  if (!sync.message) return null;
  return (
    <div className="syncbar" role="status">
      <span><MenuIcon name="warn" size={16} />{sync.at ? (sync.offline ? t("{msg}。畫面上是 {time} 的資料，現在只能看、不能改。", { msg: sync.message, time: clock(sync.at) }) : t("{msg}。畫面上是 {time} 的資料。", { msg: sync.message, time: clock(sync.at) })) : sync.offline ? t("{msg}。畫面上可能不是最新的，現在只能看、不能改。", { msg: sync.message }) : t("{msg}。畫面上可能不是最新的。", { msg: sync.message })}</span>
      <button type="button" className="btn" disabled={busy} onClick={async () => { setBusy(true); try { await retry(); } finally { setBusy(false); } }}>{busy ? t("重試中…") : t("再試一次")}</button>
    </div>
  );
}

export default function App() {
  const { phase, error, invite, setInvite, signOut, retry, refreshMemberships, enterTrip, session, openAccount, accountPage } = useTrip();
  // 帶著朋友的口袋名單分享連結進來：登入後直接打開口袋名單（這次開網頁只自動開一次）
  const openedShare = useRef(false);
  useEffect(() => {
    if (openedShare.current || (phase !== "ready" && phase !== "pick") || !pendingPocketLink()) return;
    openedShare.current = true;
    openAccount("pocket");
  }, [phase, openAccount]);
  usePendingFriend(phase === "ready" || phase === "pick" || phase === "account" ? session?.user.id : undefined);
  const loading = useMinLoading(phase === "loading");
  if (loading && phase !== "noconfig" && phase !== "error") return <Loading />;
  if (phase === "noconfig") {
    return (
      <Notice title={t("還沒接上 Supabase")}>
        <p>{tr("本機請在 <c>.env.local</c> 填 <c>VITE_SUPABASE_URL</c> 和 <c>VITE_SUPABASE_ANON_KEY</c>；GitHub Pages 請在 repo 的 Variables 設同名變數。做法在 SETUP.md。", { c: (c) => <code>{c}</code> })}</p>
      </Notice>
    );
  }
  if (phase === "error") {
    return (
      <Notice title={t("讀不到資料")}>
        <p className="err">{error}</p>
        <div className="actions"><button type="button" className="btn primary" onClick={() => { retry(); }}>{t("再試一次")}</button><button type="button" className="btn" onClick={signOut}>{t("登出")}</button></div>
      </Notice>
    );
  }
  if (phase === "signedout") return <Login invite={invite} />;
  if (phase === "join" && invite) {
    return <JoinTrip code={invite} onDone={async (tripId) => { setInvite(null); await refreshMemberships(); enterTrip(tripId); }} onCancel={() => setInvite(null)} />;
  }
  if (phase === "account") return accountPage === "pocket" ? <PocketPage /> : <AccountPage />;
  if (phase === "pick") return <TripPicker />;
  return <Main />;
}


/** The account menu in the hero: switch trip, admin, rename, leave, sign out. */
function TripMenu() {
  const { current, member, leaveToPicker, openAccount, refreshMemberships, signOut } = useTrip();
  const ref = useRef<HTMLDetailsElement>(null);
  const [leaving, setLeaving] = useState(false);
  const close = () => { if (ref.current) ref.current.open = false; };
  useEffect(() => {
    const open = () => { if (ref.current) { ref.current.open = true; ref.current.scrollIntoView({ block: "center", behavior: "smooth" }); } };
    window.addEventListener("jp-open-menu", open);
    return () => window.removeEventListener("jp-open-menu", open);
  }, []);
  const rename = async () => {
    if (!supabase || !current) return;
    const name = prompt(t("你在這個行程裡顯示的名字"), member?.name ?? "");
    if (name === null) return;
    const { error } = await supabase.rpc("set_my_name", { p_trip: current.id, p_name: name });
    if (error) alert(t(error.message)); else await refreshMemberships();
    close();
  };
  const leave = () => { close(); setLeaving(true); };
  const short = (member?.name ?? member?.email?.split("@")[0] ?? t("我")).split(/\s+/)[0];
  const pending = useInvitations(member?.user_id).length;
  return (
    <>
    {leaving && <LeaveDialog onClose={() => setLeaving(false)} />}
    <details className="menu" ref={ref}>
      <summary aria-label={t("帳號與行程選單")} title={t("切換行程、管理、登出")}>
        <PersonIcon />
        <span className="mname">{short}</span>
        {pending > 0 && <span className="dot" aria-label={pending === 1 ? t("有 1 個行程邀請") : t("有 {n} 個行程邀請", { n: pending })} />}
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </summary>
      <div className="list">
        <small>{member?.name ?? member?.email}</small>
        <button type="button" onClick={() => { close(); leaveToPicker(); }}><MenuIcon name="switch" />{t("切換行程")}{pending > 0 && <b className="badge">{pending === 1 ? t("1 個邀請") : t("{n} 個邀請", { n: pending })}</b>}</button>
        <button type="button" onClick={() => { close(); openAccount(); }}><MenuIcon name="friends" />{t("帳號・家人・好友")}</button>
        <button type="button" onClick={() => { close(); openAccount("pocket"); }}><MenuIcon name="pocket" />{t("口袋名單")}</button>
        <a href="#admin" onClick={close}><MenuIcon name="admin" />{t("管理這個行程")}</a>
        <a href="#cards" onClick={close}><MenuIcon name="cards" />{t("我的信用卡")}</a>
        <a href="#guide" onClick={close}><MenuIcon name="guide" />{t("使用教學")}</a>
        <button type="button" onClick={rename}><MenuIcon name="rename" />{t("改我的名字")}</button>
        <button type="button" className="danger" onClick={leave}><MenuIcon name="leave" />{t("退出這個行程")}</button>
        <button type="button" onClick={signOut}><MenuIcon name="signout" />{t("登出")}</button>
      </div>
    </details>
    </>
  );
}

function Main() {
  const { member, current, trip, viewFam, setViewFam } = useTrip();
  const couponsOn = useCouponsOn();
  const fam = trip.families.find((f) => f.id === viewFam) ?? { id: viewFam, name: viewFam, label: viewFam || t("我們家"), flights: [] };
  const tripId = current?.id ?? "";
  const dayKey = `jp-day:${tripId}`;

  // "one" = this family's itinerary; "all" = every family side by side. Always starts on "one" so people land on their own itinerary.
  const [mode, setMode] = useState<"one" | "all">("one");

  // The days this family sees (shared + its own); in "all" mode, every date any family has
  const famDays = useMemo(() => daysFor(trip.days, viewFam), [trip.days, viewFam]);
  const allDays = useMemo(() => {
    const byDate = new Map<string, Day>();
    for (const d of trip.days) { const cur = byDate.get(d.id); if (!cur || (cur.fam && !d.fam)) byDate.set(d.id, d); }
    return [...byDate.values()].sort((a, b) => a.id.localeCompare(b.id));
  }, [trip.days]);
  const days = mode === "all" ? allDays : famDays;
  // In "one" mode, other families' own versions are not shown; say so
  const othersOwn = useMemo(() => {
    const m = new Map<string, Day[]>();
    for (const d of trip.days) {
      if (!d.fam || d.fam.includes(viewFam)) continue;
      for (const f of d.fam) { const arr = m.get(f) ?? []; if (!arr.some((x) => x.id === d.id)) arr.push(d); m.set(f, arr); }
    }
    return [...m.entries()].map(([f, ds]) => ({ f, ds: ds.sort((a, b) => a.id.localeCompare(b.id)).map((d) => d.d) }));
  }, [trip.days, viewFam]);
  const dayIds = useMemo(() => days.map((d) => d.id), [days]);
  const route = useMemo(() => { const r: string[] = []; for (const d of famDays) if (r[r.length - 1] !== d.city) r.push(d.city); return r; }, [famDays]);
  const idsRef = useRef(dayIds);
  idsRef.current = dayIds;
  const now = useNow();
  const nowLine = useNowLine();
  const todayId = now.date;

  const [view, setView] = useState(() => currentView(dayIds, dayKey, todayId));
  const [selected, setSelected] = useState<Selected | null>(null);
  const [adding, setAdding] = useState(false);
  const wx = useWeather(current, trip.days);
  // from the day before leaving until the last day: that is when flight status and the "now" line are worth the room
  const daysApart = (a: string, b: string) => (Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86_400_000;
  const travelling = !!current && daysApart(todayId, current.start_date) >= -1 && daysApart(todayId, current.end_date) <= 0;
  const [flightsPick, setFlightsOpen] = useState<boolean | null>(null);
  const flightsOpen = flightsPick ?? travelling;

  useEffect(() => {
    const onHash = () => { setSelected(null); setAdding(false); setView(currentView(idsRef.current, dayKey)); window.scrollTo({ top: 0 }); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [dayKey]);
  useEffect(() => {
    const onAdd = () => { const first = idsRef.current[0]; if (first && location.hash !== `#${first}`) location.hash = `#${first}`; setTimeout(() => setAdding(true), 0); };
    window.addEventListener("jp-add-day", onAdd);
    return () => window.removeEventListener("jp-add-day", onAdd);
  }, []);
  // If the viewed family changes (or a day is removed), keep the view valid
  useEffect(() => { if (!PAGES.includes(view) && !dayIds.includes(view)) setView(dayIds[0] ?? "todo"); }, [dayIds, view]);

  // The address always says which day or page is showing (arriving without a #, or when the day in the # went away):
  // rewrite it in place, no new history entry. Without this, Back to an address with no # showed the last-viewed day, i.e. nothing moved.
  useEffect(() => {
    if (!viewFam || (history.state as { jpPicker?: boolean } | null)?.jpPicker) return;
    if (location.hash.slice(1) !== view) history.replaceState(history.state, "", `#${view}`);
  }, [view, viewFam]);
  useEffect(() => {
    store.set(dayKey, view);
    document.querySelector(`nav.days [data-id="${view}"]`)?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [view, viewFam, dayKey]);

  useEffect(() => { document.title = `${fam.label}・${current?.name ?? t("行程")}`; }, [fam.label, current?.name]);
  // the backdrop follows the day on screen: its city (landmark), its date (season) and its weather there; on the other pages it keeps the last one
  const onScreen = days.find((d) => d.id === view);
  // The backdrop shows that city as it is right now (time of day and current weather), not the forecast for the trip date.
  // The place list fills in after the weather panel loads, so look the place up again when it does.
  const placeKeyOnScreen = useMemo(() => {
    if (!onScreen) return null;
    const keys = placesFor(onScreen.id, onScreen.city, wx.dayPlaces);
    return keys[keys.length - 1] ?? null;
  }, [onScreen, wx.data, wx.dayPlaces]); // eslint-disable-line react-hooks/exhaustive-deps
  const [nowSky, setNowSky] = useState<{ key: string; sky: CurrentSky } | null>(null);
  useEffect(() => {
    const place = placeKeyOnScreen ? placeByKey(placeKeyOnScreen) : undefined;
    if (!place) return;
    let off = false;
    const load = () => { void fetchCurrent(place).then((sky) => { if (!off && sky) setNowSky({ key: place.key, sky }); }); };
    load();
    const timer = setInterval(load, 15 * 60_000);
    return () => { off = true; clearInterval(timer); };
  }, [placeKeyOnScreen]);
  const skyNow = nowSky && nowSky.key === placeKeyOnScreen ? nowSky.sky : null;
  const lonOnScreen = placeKeyOnScreen ? placeByKey(placeKeyOnScreen)?.lon ?? null : null;
  useEffect(() => {
    if (onScreen) setBackdropContext({ city: onScreen.city, date: onScreen.id, weather: skyNow ? describe(skyNow.code).icon : null, lon: lonOnScreen, offsetMin: skyNow?.offsetMin ?? null });
  }, [onScreen, skyNow, lonOnScreen, tripId]);
  useEffect(() => () => setBackdropContext({ city: "", date: "", weather: null }), [tripId]);

  // Scroll affordance for the date strip: fades + arrows that disappear at the ends
  const { ref: navRef, edge, update: updateEdge, scrollBy: scrollDays } = useScrollEdges<HTMLElement>(dayIds);

  const close = useCallback(() => setSelected(null), []);
  const cur = days.find((d) => d.id === view);
  const othersToday = cur ? othersOwn.filter(({ ds }) => ds.includes(cur.d)).map(({ f }) => trip.families.find((x) => x.id === f)?.label ?? f) : [];
  const first = famDays[0], last = famDays[famDays.length - 1];

  return (
    <>
      <div className="wrap">
        <header className={`hero${PAGES.includes(view) ? " compact" : ""}`}>
          <div className="fambar">
            <span className="fampill">{fam.label}</span>
            <select className="famselect" value={viewFam} aria-label={t("看哪一家的行程")} onChange={(e) => setViewFam(e.target.value as FamilyId)}>
              {[...trip.families].sort((a, b) => (a.id === member?.family_id ? -1 : b.id === member?.family_id ? 1 : 0)).map((f) => <option key={f.id} value={f.id}>{f.id === member?.family_id ? t("看我們家（{label}）", { label: f.label }) : t("看 {label}", { label: f.label })}</option>)}
            </select>
            <TripMenu />
          </div>
          <div className="eyebrow">
            {first && last ? `${dotDate(first.id)} — ${dotDate(last.id)} ・ ${famDays.length === 1 ? t("1 天") : t("{n} 天", { n: famDays.length })}` : current ? `${dotDate(current.start_date)} — ${dotDate(current.end_date)}` : ""}
            {current?.place && <> ・ {current.place.split(/(?<=[、，,・])/).map((seg, i) => <span key={i} className="nb">{seg}</span>)}</>}
          </div>
          <div className="titlerow"><TripIcon id={tripIconId(current?.settings)} size={48} /><h1>{current?.name ?? t("行程")}</h1></div>
          {route.length > 0 && (
            <div className="route">
              <PaperPlane />
              {route.map((c, i) => (
                <span key={i} className="nb">{c}{i < route.length - 1 && <i className="trail" aria-hidden="true" />}</span>
              ))}
            </div>
          )}
          <div className="flights">
            {fam.flights.length > 0
              ? fam.flights.map((f) => <span key={f} className="flight">{f}</span>)
              : <span className="flight muted">{t("去回航班待補")}</span>}
            {trip.notes.shared && <span className="flight">{trip.notes.shared}</span>}
            {fam.flights.length > 0 && <button type="button" className="link flighttoggle" aria-expanded={flightsOpen} onClick={() => setFlightsOpen(!flightsOpen)}>{flightsOpen ? t("收起航班狀態") : t("航班狀態")}<span aria-hidden="true">{flightsOpen ? " ▴" : " ▾"}</span></button>}
          </div>
          {fam.flights.length > 0 && flightsOpen && (
            <div className="flightlive">
              {fam.flights.map((f) => <FlightStatus key={f} text={f} />)}
            </div>
          )}
          <div className="quick">
            <a className="btn" href="#overview" aria-current={view === "overview" ? "page" : undefined}><MenuIcon name="overview" size={18} />{t("總覽")}</a>
            <a className="btn" href="#todo" aria-current={view === "todo" ? "page" : undefined}><MenuIcon name="todo" size={18} />{t("待辦・聯絡#nav")}</a>
            {!isViewer(member) && <a className="btn" href="#upload" aria-current={view === "upload" ? "page" : undefined}><MenuIcon name="upload" size={18} />{t("上傳行程")}</a>}
            {(trip.info.length > 0 || !isViewer(member)) && <a className="btn" href="#info" aria-current={view === "info" ? "page" : undefined}><MenuIcon name="info" size={18} />{t("其他資訊")}</a>}
            <a className="btn" href="#cards" aria-current={view === "cards" ? "page" : undefined}><MenuIcon name="cards" size={18} />{t("信用卡")}</a>
            {couponsOn && <button type="button" className="btn" onClick={() => openCoupons()}><MenuIcon name="coupon" size={18} />{t("藥妝優惠券#nav")}</button>}
            <a className="btn" href="#admin" aria-current={view === "admin" || view === "people" ? "page" : undefined}><MenuIcon name="admin" size={18} />{t("管理")}</a>
          </div>
        </header>

        <div className={`daysbar${edge.start ? " at-start" : ""}${edge.end ? " at-end" : ""}`}>
          <button type="button" className="scrollbtn left" onClick={() => scrollDays(-1)} aria-label={t("往前幾天")} tabIndex={-1}>‹</button>
          <nav className="days" ref={navRef} onScroll={updateEdge} aria-label={t("選擇日期")}>
            {days.map((d) => (
              <a key={d.id} href={`#${d.id}`} data-id={d.id} className={[d.items.length === 0 ? "pending" : "", d.id === todayId ? "today" : ""].join(" ").trim() || undefined} aria-current={view === d.id ? "page" : undefined}>
                <span className="dd">{d.d}</span>
                <span className="dc">{wk(d.w)}・{d.city}</span>
                <ChipWeather date={d.id} city={d.city} wx={wx} />
              </a>
            ))}
            {!isViewer(member) && (
              <button type="button" className="add" onClick={() => { setAdding(true); }} aria-expanded={adding}>
                <span className="dd">＋</span><span className="dc">{t("加一天")}</span>
              </button>
            )}
          </nav>
          <button type="button" className="scrollbtn right" onClick={() => scrollDays(1)} aria-label={t("往後幾天")} tabIndex={-1}>›</button>
        </div>

        <main>
          <SyncBar />
          {fakeNow() && (
            <div className="previewbar">
              <span>{t("預覽模式：假裝現在是 {date} {time}（當地時間）", { date: now.date.slice(5).replace("-", "/"), time: now.hhmm })}</span>
              <button type="button" className="btn" onClick={endPreview}>{t("結束預覽")}</button>
            </div>
          )}
          {!PAGES.includes(view) && (
            <div className="toolbar">
              <div className="modebar" role="group" aria-label={t("顯示方式")}>
                <button type="button" className={mode === "one" ? "on" : ""} onClick={() => setMode("one")}>{t("只看 {label}", { label: fam.label })}</button>
                <button type="button" className={mode === "all" ? "on" : ""} onClick={() => setMode("all")}>{t("看所有家")}</button>
              </div>
              {(travelling || !!fakeNow()) && <div className="nowctl">
                <label className="switch" title={t("旅行當天打開時，行程上會有一條標示現在時間的線")}>
                  <input type="checkbox" checked={nowLine} onChange={(e) => setNowLine(e.target.checked)} />
                  <span className="track" aria-hidden="true" />
                  <span>{t("「現在」的線")}</span>
                </label>
                {nowLine && !fakeNow() && cur && todayId !== cur.id && (
                  <button type="button" className="link" onClick={() => startPreview(cur.id, now.hhmm, `#${cur.id}`)}>{t("旅行當天才會出現・預覽")}</button>
                )}
              </div>}
            </div>
          )}
          {!PAGES.includes(view) && mode === "one" && cur && othersToday.length > 0 && (
            <p className="note othersown">
              {tr("{names}這一天有自己的版本。<btn>看所有家</btn>", { btn: (c) => <button type="button" className="link" onClick={() => setMode("all")}>{c}</button> }, { names: list(othersToday) })}
            </p>
          )}
          {view !== "people" && <PeopleBanner />}
          {adding && <AddDay family={fam} onDone={(id) => { setAdding(false); if (id) location.hash = `#${id}`; }} />}
          {view === "overview" ? <Overview onOpen={(day, stop, arrive) => setSelected({ day, stop, arrive })} />
            : view === "todo" ? <TodoView />
            : view === "upload" ? <UploadView />
            : view === "info" ? <InfoView />
            : view === "cards" ? <CardsView />
            : view === "admin" ? <AdminView />
            : view === "guide" ? <GuideView role={member?.role ?? "member"} />
            : view === "people" ? <AdminView focus="people" />
            : cur && mode === "all" ? <AllFamiliesDay dateId={cur.id} onOpen={(day, stop, arrive) => setSelected({ day, stop, arrive })} />
            : cur ? <DayView key={`${cur.id}|${(cur.fam ?? []).join(",")}|${fam.id}`} day={cur} family={fam} wx={wx} onOpen={(stop, arrive) => setSelected({ day: cur, stop, arrive })} onRemoved={() => { location.hash = `#${dayIds.find((id) => id !== cur.id) ?? "todo"}`; }} />
            : !adding && (
              <section className="dayhead">
                <h2>{t("還沒有行程")}</h2>
                <p className="note">{isViewer(member) ? t("這個行程還沒有內容。") : t("按日期列的「＋ 加一天」先把日期加進來，再用「上傳行程」或右下角「Trip醬」把內容補上。")}</p>
              </section>
            )}
        </main>
      </div>
      {!isViewer(member) && <ChatWidget />}
      <QuickPickFab />
      <CouponHost />
      {selected && <DetailSheet {...selected} onClose={close} />}
      <Lightbox />
    </>
  );
}
