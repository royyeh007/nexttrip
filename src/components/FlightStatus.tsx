import { useEffect, useState } from "react";
import { ModeIcon } from "../icons";
import { invoke } from "../supabase";
import { useNow } from "../now";
import { tripRange } from "../data";
import type { DateRange } from "../data";
import { useTrip } from "../trip";
import { parseFlightText } from "../../supabase/functions/_shared/flightText";

/** "去 BR192 12/26 松山 07:15 → 羽田 T3 11:00（座位 42B）" → parsed pieces (the airline/number/date part is shared with the server) */
export function parseFlight(text: string, fallbackDate?: string, range?: DateRange | null) {
  const p = parseFlightText(text, range, fallbackDate);
  if (!p) return null;
  const has = (a: string) => p.airports.includes(a);
  const airline = (text.slice(0, p.index).replace(/^(去|回)\s*/, "").replace(/\d{1,2}\/\d{1,2}/, "").trim()) || p.airline;
  const extra = text.match(/[（(]([^（）()]*)[）)]/)?.[1] ?? "";
  const route = text.replace(/[（(][^（）()]*[）)]/g, "").replace(/^(去|回)\s*/, "").replace(p.match, "").replace(/\d{1,2}\/\d{1,2}/, "").trim().replace(/^[\s・,，]+/, "");
  return { airline: p.airline, number: p.number, code: `${p.airline}${p.number}`, airlineName: airline, route, extra, date: p.date, viaHaneda: has("HND"), viaNarita: has("NRT"), viaSongshan: has("TSA"), viaTaoyuan: has("TPE") };
}

export interface Status { source?: string; airport: string; airportName: string; kind: "arr" | "dep"; sched: string; est: string | null; actual: string | null; delayMin: number | null; remark: string; terminal: string; gate: string; counter: string; baggage?: string; updated: string }
export interface Result { statuses: Status[]; note?: string; phase?: "info" | "eve" | "live"; fetchedAt?: string; query?: { airline: string; number: string; date: string } }

// ---- one shared copy per flight ----
// The same flight is on screen in several places at once (the header, the timeline, the detail sheet, every column of
// 「看所有家」). Each used to call the function by itself and keep its own timer. Now they all read one entry here,
// and flights that are asked for at the same moment go out as a single request (the function takes up to 10).
interface Entry { key: string; tripId: string; q: { airline: string; number: string; date: string }; res?: Result; err: string | null; at: number; loading: boolean; listeners: Set<() => void> }
const entries = new Map<string, Entry>();
const queue = new Set<Entry>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;
const notify = (e: Entry) => { for (const l of e.listeners) l(); };

async function flush() {
  flushTimer = undefined;
  const byTrip = new Map<string, Entry[]>();
  for (const e of queue) byTrip.set(e.tripId, [...(byTrip.get(e.tripId) ?? []), e]);
  queue.clear();
  for (const [tripId, all] of byTrip) for (let i = 0; i < all.length; i += 10) {
    const batch = all.slice(i, i + 10);
    try {
      const r = await invoke<{ results: Result[] }>("flight-status", { trip_id: tripId, flights: batch.map((e) => e.q) }, { timeoutMs: 40_000 });
      for (const e of batch) {
        const hit = r.results.find((x) => x.query && x.query.airline.toUpperCase() === e.q.airline && Number(x.query.number) === Number(e.q.number) && x.query.date === e.q.date) ?? (batch.length === 1 ? r.results[0] : undefined);
        e.res = hit ?? e.res ?? { statuses: [] }; e.err = null; e.at = Date.now(); e.loading = false; notify(e);
      }
    } catch (err) {
      for (const e of batch) { e.err = err instanceof Error ? err.message : String(err); e.at = Date.now(); e.loading = false; notify(e); }
    }
  }
}
function request(e: Entry) {
  if (e.loading) return;
  e.loading = true;
  queue.add(e);
  flushTimer ??= setTimeout(flush, 30);
}
const dayGap = (a: string, b: string) => (new Date(a + "T00:00:00Z").getTime() - new Date(b + "T00:00:00Z").getTime()) / 86400000;

/** Status for one flight line: every 3 minutes on the day, every 30 minutes before it, once for a flight that is over. */
export function useFlightStatus(text: string, date?: string) {
  const { current } = useTrip();
  const f = parseFlight(text, date, current ? tripRange(current) : null);
  const now = useNow();
  const [, bump] = useState(0);
  // The date on a flight line is the local date at the departure airport. The trip's clock is the destination's, which is
  // still on yesterday for most of the departure day when flying from far away: the phone's own date counts as "today" too.
  const localDate = new Date().toLocaleDateString("sv-SE");
  const today = !!f && (f.date === now.date || f.date === localDate);
  const tripId = current?.id;
  const key = f && tripId ? `${tripId}|${f.code}|${f.date}` : null;
  const over = !!f && dayGap(now.date, f.date) > 1.5 && dayGap(localDate, f.date) > 1.5;
  useEffect(() => {
    if (!key || !f || !tripId) return;
    let e = entries.get(key);
    if (!e) { e = { key, tripId, q: { airline: f.airline, number: f.number, date: f.date }, err: null, at: 0, loading: false, listeners: new Set() }; entries.set(key, e); }
    const entry = e;
    const listener = () => bump((n) => n + 1);
    entry.listeners.add(listener);
    const every = today ? 180_000 : 1_800_000;
    // ask now only if nobody has asked recently; afterwards on a timer, but not for a flight that is already over, and not while the tab is in the background
    const refresh = () => { if (document.visibilityState === "visible" && Date.now() - entry.at >= every - 5000) request(entry); };
    if (!entry.at) request(entry); else refresh();
    const t = over ? undefined : setInterval(refresh, every);
    return () => { entry.listeners.delete(listener); if (t) clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `f` is rebuilt every render; `key` covers the fields that matter
  }, [key, today, over]);
  const entry = key ? entries.get(key) : undefined;
  const res = entry?.res, err = entry?.res ? null : entry?.err ?? null;
  const isLive = today && (!res?.phase || res.phase === "live");
  return { f, res, err, today, isLive };
}

export const delayText = (st: Status) => (st.delayMin == null ? "" : st.delayMin > 0 ? `晚 ${st.delayMin} 分` : st.delayMin < 0 ? `早 ${-st.delayMin} 分` : "準時");
export const toneOf = (st: Status) => (st.delayMin != null && st.delayMin >= 15 ? "bad" : st.delayMin != null && st.delayMin < 0 ? "ok" : "");

function Links({ f }: { f: NonNullable<ReturnType<typeof parseFlight>> }) {
  return (
    <span className="fl-links">
      <a href={`https://www.flightradar24.com/data/flights/${f.code.toLowerCase()}`} target="_blank" rel="noopener">Flightradar24</a>
      {f.viaNarita && <a href="https://www.narita-airport.jp/en/flight/" target="_blank" rel="noopener">成田官網</a>}
      {f.viaHaneda && <a href="https://tokyo-haneda.com/en/flight/" target="_blank" rel="noopener">羽田官網</a>}
      {f.viaTaoyuan && <a href="https://www.taoyuan-airport.com/flight_depart" target="_blank" rel="noopener">桃園官網</a>}
    </span>
  );
}

function Meta({ res, f, today }: { res: Result | undefined; f: NonNullable<ReturnType<typeof parseFlight>>; today: boolean }) {
  const when = res?.fetchedAt ? new Date(res.fetchedAt).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : null;
  const phaseLabel = res?.phase === "live" ? "當天即時" : res?.phase === "eve" ? "出發前一天查的" : res?.phase === "info" ? "新增時查的" : today ? "即時" : "";
  const src = res?.statuses[0]?.source;
  const upd = !res?.fetchedAt && res?.statuses[0]?.updated ? `更新 ${res.statuses[0].updated.slice(-5)}` : null;
  return <div className="fl-status muted">{src && `資料來源：${src}`}{phaseLabel && `・${phaseLabel}`}{when && `・${when}`}{upd && `・${upd}`}{res?.note && `・${res.note}`} <Links f={f} /></div>;
}

function Line({ st, today }: { st: Status; today: boolean }) {
  const delay = delayText(st);
  return (
    <div className={`fl-status live ${today ? toneOf(st) : ""}`}>
      <span className="fl-tag">{st.airportName}{today ? " LIVE" : ""}</span>
      <span>{st.kind === "arr" ? "抵達" : "起飛"}{today ? "預定" : "表定"} {st.sched}{today && st.actual ? `，實際 ${st.actual}` : today && st.est ? `，預計 ${st.est}` : ""}{today && delay && `（${delay}）`}</span>
      {today && st.remark && <span className="fl-remark">{st.remark}</span>}
      <span className="muted">
        {st.terminal && `T${st.terminal} `}
        {today && st.gate ? `登機門 ${st.gate}` : st.kind === "dep" ? (today ? "登機門未公布" : "登機門當天公布") : ""}
        {today && st.counter && st.kind === "dep" && `・櫃台 ${st.counter}`}
        {today && st.baggage && st.kind === "arr" && `・行李轉盤 ${st.baggage}`}
      </span>
    </div>
  );
}

/** Compact lines (hero and detail sheet). */
export function FlightStatus({ text, date }: { text: string; date?: string }) {
  const { f, res, err, today, isLive } = useFlightStatus(text, date);
  if (!f) return null;
  if (err) return <div className="fl-status muted">即時狀態抓不到：{err} <Links f={f} /></div>;
  if (res === undefined) return <div className="fl-status muted">航班狀態載入中…</div>;
  if (res.statuses.length === 0) return <div className="fl-status muted">{today ? "今天還查不到" : "還沒有"} {f.code} 的航班資料{res.note ? `（${res.note}）` : ""} <Links f={f} /></div>;
  return <>{res.statuses.map((st) => <Line key={st.airport + st.kind} st={st} today={isLive} />)}<Meta res={res} f={f} today={today} /></>;
}

/** Big card for the timeline: flight number + on-time status in large type, gate / counter / carousel in large type. */
export function FlightCard({ text, date }: { text: string; date?: string }) {
  const { f, res, err, today, isLive } = useFlightStatus(text, date);
  if (!f) return <span className="legbox">{text}</span>;
  const dep = res?.statuses.find((s) => s.kind === "dep");
  const arr = res?.statuses.find((s) => s.kind === "arr");
  const main = dep ?? arr;
  const status = isLive && main ? (main.actual && main.kind === "dep" ? (main.remark || "已起飛") : main.remark || delayText(main) || "") : "";
  const delay = isLive && main ? delayText(main) : "";
  const tone = isLive && main ? toneOf(main) : "";
  const gate = isLive ? (dep?.gate || (arr && !dep ? arr.gate : "")) : "";
  const gateLabel = gate ? `登機門 ${gate}` : today ? "登機門 未公布" : "登機門 當天公布";
  return (
    <div className={`flightcard ${tone}`}>
      <div className="fc-top">
        <span className="fc-code"><ModeIcon mode="flight" />{f.airlineName && f.airlineName !== f.code ? `${f.airlineName} ` : ""}{f.code}</span>
        {(status || delay) && <span className={`fc-status ${tone}`}>{status}{delay && status !== delay ? `・${delay}` : ""}</span>}
        {!isLive && today && res && res.statuses.length > 0 && <span className="fc-status">今天的即時資料載入中</span>}
      </div>
      <div className="fc-route">{f.route}</div>
      {main && (isLive || res?.phase) && (
        <div className="fc-times muted">
          {dep && <span>起飛{isLive ? "預定" : "表定"} {dep.sched}{isLive && dep.actual ? `・實際 ${dep.actual}` : isLive && dep.est ? `・預計 ${dep.est}` : ""}</span>}
          {arr && <span>抵達{isLive ? "預定" : "表定"} {arr.sched}{isLive && arr.actual ? `・實際 ${arr.actual}` : isLive && arr.est ? `・預計 ${arr.est}` : ""}</span>}
        </div>
      )}
      <div className="fc-gate">
        <span className={`fc-big${gate ? "" : " quiet"}`}>{gateLabel}</span>
        {dep?.terminal && <span className="fc-mid">T{dep.terminal}</span>}
        {isLive && dep?.counter && <span className="fc-mid">櫃台 {dep.counter}</span>}
        {isLive && arr?.baggage && <span className="fc-mid">行李轉盤 {arr.baggage}</span>}
      </div>
      {f.extra && <div className="fc-extra muted">{f.extra}</div>}
      {err ? <div className="fl-status muted">即時狀態抓不到：{err} <Links f={f} /></div> : res === undefined ? <div className="fl-status muted">載入中…</div> : <Meta res={res} f={f} today={today} />}
    </div>
  );
}
