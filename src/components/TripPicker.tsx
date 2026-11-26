import { useEffect, useRef, useState } from "react";
import { PlaceInput } from "./PlaceInput";
import { supabase } from "../supabase";
import { useTrip } from "../trip";
import { dotDate, tripLength } from "../data";
import { fillTripDays } from "../days";
import { GuideView } from "./GuideView";
import { LogoMark, MenuIcon, PersonIcon, Wordmark } from "./Logo";
import { MyInvitations } from "./AccountView";
import { TripIcon, tripIconId } from "../tripIcons";
import { t } from "../i18n";
import { TripManage } from "./TripManage";
import { LeaveDialog } from "./LeaveDialog";
import { fakeNow, useNow } from "../now";
import { TRIP_SORTS, matchTrip, sortTrips, todayIn, tripStatus, type TripDates, type TripSort, type TripStatus } from "../tripList";

const SORT_KEY = "trip-sort";
const readSort = (): TripSort => { try { const v = localStorage.getItem(SORT_KEY) as TripSort; return TRIP_SORTS.includes(v) ? v : "time"; } catch { return "time"; } };
const sortLabel = (s: TripSort) => ({ time: t("照時間：進行中和快到的在前"), newest: t("出發日：新的在前"), recent: t("最近開過的在前"), name: t("照名稱") })[s];
/** 行程所在時區的今天；用 ?now= 預覽時跟著預覽的日期。 */
const todayOf = (trip: TripDates) => fakeNow()?.slice(0, 10) ?? todayIn(trip.tz);
function statusText(s: TripStatus): string {
  if (s.phase === "past") return t("已結束");
  if (s.phase === "soon") return s.days === 1 ? t("明天出發") : t("還有 {n} 天", { n: s.days });
  if (s.length === 1) return t("就是今天");
  return t("進行中・第 {d} 天，共 {n} 天", { d: s.days, n: s.length });
}

function CreateTrip({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const { session } = useTrip();
  const today = new Date().toISOString().slice(0, 10);
  const [name, setName] = useState("");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [place, setPlace] = useState("");
  const [famLabel, setFamLabel] = useState("");
  const [myName, setMyName] = useState<string>(session?.user.user_metadata?.full_name ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!supabase) return;
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc("create_trip", { p_name: name.trim(), p_start: start, p_end: end, p_place: place.trim(), p_family_label: famLabel.trim(), p_my_name: myName.trim() });
    if (error) { setErr(t(error.message)); setBusy(false); return; }
    // every date gets an empty "everyone" day so the trip is ready to fill in
    try { await fillTripDays(String(data), start, end, place); } catch { /* the days can be added later from the date strip */ }
    onCreated(String(data));
  };

  return (
    <div className="panel">
      <h3>{t("建立新行程")}</h3>
      <p className="note">{t("建立的人就是這個行程的管理員，之後可以邀請家人、管理團員。開始到結束的每一天會先建好空白的日子，城市先填主要城市，之後每一天可以各自改。")}</p>
      <div className="formgrid">
        <label>{t("行程名稱")}<input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("例：2027 春天京都")} /></label>
        <label>{t("主要城市")}<PlaceInput tripId="" kind="city" withCountry value={place} onChange={setPlace} placeholder={t("打幾個字找城市，例：東京")} /></label>
        <label>{t("開始日期")}<input type="date" value={start} onChange={(e) => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value); }} /></label>
        <label>{t("結束日期")}<input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></label>
        <label>{t("你們這一家叫什麼")}<input value={famLabel} onChange={(e) => setFamLabel(e.target.value)} placeholder={t("例：Lily 家")} /></label>
        <label>{t("你的名字")}<input value={myName} onChange={(e) => setMyName(e.target.value)} placeholder={t("例：小明")} /></label>
      </div>
      <div className="actions">
        <button type="button" className="btn primary" onClick={submit} disabled={busy || !name.trim() || !place.trim() || !start || !end}>{busy ? t("建立中…") : t("建立行程")}</button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>{t("取消")}</button>
      </div>
      {err && <p className="err">{err}</p>}
    </div>
  );
}

/** After sign-in: the trips this person is in, plus "create" and "join with a code". */
/** The same account button as inside a trip, with what makes sense before a trip is picked. */
function HomeMenu() {
  const { session, openAccount, signOut } = useTrip();
  const ref = useRef<HTMLDetailsElement>(null);
  const close = () => { if (ref.current) ref.current.open = false; };
  // tapping anywhere else closes it
  useEffect(() => {
    const away = (e: Event) => { if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false; };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, []);
  const full: string = session?.user.user_metadata?.full_name ?? session?.user.email?.split("@")[0] ?? t("我");
  return (
    <details className="menu" ref={ref}>
      <summary aria-label={t("帳號選單")} title={t("帳號・好友、登出")}>
        <PersonIcon />
        <span className="mname">{full.split(/\s+/)[0]}</span>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </summary>
      <div className="list">
        <small>{session?.user.email}</small>
        <button type="button" onClick={() => { close(); openAccount(); }}><MenuIcon name="friends" />{t("帳號・家人・好友")}</button>
        <button type="button" onClick={() => { close(); document.getElementById("guide-home")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}><MenuIcon name="guide" />{t("使用教學")}</button>
        <button type="button" onClick={signOut}><MenuIcon name="signout" />{t("登出")}</button>
      </div>
    </details>
  );
}

export function TripPicker() {
  const { memberships, enterTrip, setInvite, refreshMemberships } = useTrip();
  const [creating, setCreating] = useState(false);
  const [code, setCode] = useState("");
  const [q, setQ] = useState("");
  const [manage, setManage] = useState<string | null>(null);
  const [leave, setLeave] = useState<string | null>(null);
  const leaving = memberships.find((m) => m.trip_id === leave);
  const managing = memberships.find((m) => m.trip_id === manage && m.role === "admin");
  const [sort, setSort] = useState<TripSort>(readSort);
  useNow(); // 過了午夜，倒數和「進行中」要跟著變
  const shown = sortTrips(memberships.filter((m) => matchTrip(m.trip, q)), sort, todayOf);
  const pickSort = (v: TripSort) => { setSort(v); try { localStorage.setItem(SORT_KEY, v); } catch { /* ignore */ } };

  return (
    <div className="wrap pick">
      <header className="hero">
        <div className="fambar">
          <h1 className="brand"><LogoMark size={48} /><Wordmark height={26} /></h1>
          <HomeMenu />
        </div>
        <p className="note">{memberships.length ? t("選一個行程進去，或建立新的、加入別人的。") : t("這個網站只給被邀請的人用。輸入家人傳給你的邀請碼加入他們的行程；加入之後就可以建立自己的行程。")}</p>
      </header>

      <MyInvitations onJoined={async (id) => { await refreshMemberships(); enterTrip(id); }} />

      {memberships.length > 0 && (
        <>
          <h2>{t("我的行程")}</h2>
          {memberships.length > 1 && (
            <div className="tripfind">
              <label className="tripsearch">
                <MenuIcon name="search" size={20} />
                <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("找行程：名稱、城市或日期")} aria-label={t("找行程")} autoCapitalize="none" autoCorrect="off" enterKeyHint="search" />
              </label>
              <select value={sort} onChange={(e) => pickSort(e.target.value as TripSort)} aria-label={t("排序")}>
                {TRIP_SORTS.map((v) => <option key={v} value={v}>{sortLabel(v)}</option>)}
              </select>
            </div>
          )}
          {shown.length === 0 && (
            <div className="panel tripnone">
              <p className="note">{t("沒有符合「{q}」的行程。", { q: q.trim() })}</p>
              <button type="button" className="btn" onClick={() => setQ("")}>{t("看全部行程")}</button>
            </div>
          )}
          <div className="tripcards">
            {shown.map((m) => { const st = tripStatus(m.trip, todayOf(m.trip)); return (
              <div key={m.trip_id} className="tripwrap">
              <button type="button" className={`tripcard ${st.phase}${" canmanage"}`} onClick={() => enterTrip(m.trip_id)}>
                <TripIcon id={tripIconId(m.trip.settings)} size={48} />
                <span className="tn">{m.trip.name}</span>
                <span className={`tstat ${st.phase}`}>{statusText(st)}</span>
                <span className="td"><span>{dotDate(m.trip.start_date)} — {dotDate(m.trip.end_date)}</span><span>{tripLength(m.trip) === 1 ? t("1 天") : t("{n} 天", { n: tripLength(m.trip) })}</span></span>
                {m.trip.place && <span className="tp">{m.trip.place}</span>}
                <span className="tm">
                  {m.role === "admin" && <span className="tag admin">{t("管理員")}</span>}
                  {m.role === "viewer" && <span className="tag none">{t("觀察員")}</span>}
                  <span className="muted">{m.name ?? m.email ?? ""}</span>
                </span>
                <span className="go">{t("進入 ›")}</span>
              </button>
              {m.role === "admin" && (
                <button type="button" className="tripmore" onClick={() => setManage(m.trip_id)} aria-label={t("管理「{name}」：編輯、複製、刪除", { name: m.trip.name })} title={t("編輯、複製、刪除")}>
                  <MenuIcon name="more" size={18} />{t("管理")}
                </button>
              )}
              {m.role !== "admin" && (
                <button type="button" className="tripmore" onClick={() => setLeave(m.trip_id)} aria-label={t("退出「{name}」", { name: m.trip.name })}>
                  <MenuIcon name="leave" size={18} />{t("退出")}
                </button>
              )}
              </div>
            ); })}
          </div>
          {leaving && <LeaveDialog key={leaving.trip_id} trip={{ id: leaving.trip_id, name: leaving.trip.name }} onClose={() => setLeave(null)} />}
          {managing && <TripManage key={managing.trip_id} m={managing} onClose={() => setManage(null)} />}
        </>
      )}

      <h2>{memberships.length ? t("建立或加入") : t("加入")}</h2>
      {creating ? (
        <CreateTrip onCreated={async (id) => { await refreshMemberships(); enterTrip(id); }} onCancel={() => setCreating(false)} />
      ) : (
        <div className="panel startrow">
          {memberships.length > 0 && <button type="button" className="btn primary" onClick={() => setCreating(true)}>{t("＋ 建立新行程")}</button>}
          <div className="addrow pair">
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t("有邀請碼？貼在這裡")} aria-label={t("邀請碼")} autoCapitalize="none" autoCorrect="off" onKeyDown={(e) => e.key === "Enter" && code.trim() && setInvite(code.trim())} />
            <button type="button" className="btn" onClick={() => setInvite(code.trim())} disabled={!code.trim()}>{t("用邀請碼加入")}</button>
          </div>
        </div>
      )}
      <h2 id="guide-home">{t("使用教學")}</h2>
      <GuideView role="member" compact />
    </div>
  );
}
