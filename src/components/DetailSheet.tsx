import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { TimeField } from "./Pickers";
import { PlaceInput } from "./PlaceInput";
import { placeByKey, placesFor } from "../weather";
import { FlightStatus } from "./FlightStatus";
import { askClaude } from "./Chat";
import { famNames, isLeg, isViewer } from "../data";
import type { Day, Item, Kind, Leg, Memo, Mode, Status, Stop } from "../data";
import { supabase } from "../supabase";
import { canEdit } from "../data";
import { useTrip } from "../trip";
import { MODE, dirURL, placeURL } from "../maps";
import type { LinkedLeg } from "../maps";
import { ModeIcon, PinIcon } from "../icons";
import { KIND_NAME, SEAL } from "../labels";
import { editDayItems, findStop, removeStopAt, sameDayRow, sortByTime } from "../dayEdit";
import { CardSection } from "./CardPick";
import { MenuIcon, SuitcaseIcon } from "./Logo";
import { StopPeople, relevantPeople } from "./PeopleView";
import { SplitPanel, newPar } from "./Split";
import { useTripPeople } from "../people";
import { SharedPanel, rowFamilies } from "./SharedPanel";
import { contentPatch, sharedFamilies, syncShared } from "../shared";
import { t, tr, wk } from "../i18n";

function Copy({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const copy = () => {
    const selectIt = () => {
      if (!ref.current) return;
      const r = document.createRange();
      r.selectNodeContents(ref.current);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(r);
    };
    try {
      navigator.clipboard.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }, selectIt);
    } catch { selectIt(); }
  };
  return (
    <span className="copy">
      <code ref={ref}>{value}</code>
      <button type="button" onClick={copy}>{done ? t("已複製") : t("複製")}</button>
    </span>
  );
}

const List = ({ items }: { items: string[] }) => <ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>;

/** Notes on a stop: anyone who can edit this day (own family, or a shared day) can add one; you can delete your own. */
function Memos({ day, stop }: { day: Day; stop: Stop }) {
  const { member, current, reload } = useTrip();
  const [memos, setMemos] = useState<Memo[]>(stop.memo ?? []);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const editable = canEdit(day.fam, member);
  useEffect(() => { setMemos(stop.memo ?? []); }, [stop]);

  // `change` works on the notes as they are in the database right now, not on the copy this sheet opened with:
  // two people adding a note to the same stop within a few minutes used to lose the first one.
  const write = async (change: (fresh: Memo[]) => Memo[]) => {
    if (!current || busy) return;
    setBusy(true);
    let saved: Memo[] | null = null;
    const err = await editDayItems(current.id, day, (items) => {
      const idx = findStop(items, stop);
      if (idx < 0) return null;
      const next = change((items[idx] as Stop).memo ?? []);
      saved = next;
      return items.map((it, i) => { if (i !== idx) return it; const s = { ...(it as Stop) }; if (next.length) s.memo = next; else delete s.memo; return s; });
    });
    if (err) alert(err);
    else {
      if (saved) setMemos(saved);
      setText("");
      const warn = saved ? await syncShared(current.id, day, stop.sid, { memo: (saved as Memo[]).length ? saved : null }) : null;
      if (warn) alert(warn);
      reload();
    }
    setBusy(false);
  };
  const add = () => {
    if (!member || !text.trim()) return;
    const memo: Memo = { by: member.user_id, name: member.name ?? t("家人"), text: text.trim().slice(0, 1000), at: new Date().toISOString() };
    write((fresh) => [...fresh, memo]);
  };
  const del = (m: Memo) => { if (confirm(t("刪掉這則備註？"))) write((fresh) => fresh.filter((x) => !(x.by === m.by && x.at === m.at && x.text === m.text))); };

  return (
    <div className="sec memos">
      <h4>{t("備註")}</h4>
      {memos.length === 0 && <p className="note">{t("還沒有備註。")}</p>}
      <ul>
        {memos.map((m, i) => (
          <li key={i}>
            <span className="who-when">{m.name}・{new Date(m.at).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" })}</span>
            <span className="mtext">{m.text}</span>
            {member?.user_id === m.by && <button type="button" className="link" onClick={() => del(m)} disabled={busy}>{t("刪")}</button>}
          </li>
        ))}
      </ul>
      {editable ? (
        <div className="addrow memo-add">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("加一則備註，例：記得帶護照影本")} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) add(); }} />
          <button type="button" className="btn primary" onClick={add} disabled={busy || !text.trim()}>{t("＋ 新增")}</button>
        </div>
      ) : (
        <p className="note">{isViewer(member) ? t("觀察員只能看，不能加備註。") : t("這是別家的行程，只能看不能加備註。")}</p>
      )}
    </div>
  );
}

// ---------- quick edit / add ----------
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const STATUS_OPTS: { v: Status | ""; l: string }[] = [{ v: "", l: t("不用訂") }, { v: "ok", l: t("已訂") }, { v: "todo", l: t("要訂") }, { v: "tbd", l: t("待定") }];

interface Draft { t: string; n: string; k: Kind; st: Status | ""; q: string; addr: string; tel: string; who: string; s: string; book: string; rec: string; info: string; tips: string; legMode: Mode | ""; legTxt: string; ref: string }
const draftOf = (stop: Stop | null, arrive: Leg | undefined): Draft => ({
  t: stop?.t ?? "", n: stop?.n ?? "", k: stop?.k ?? "sight", st: stop?.st ?? "", q: stop?.q ?? "", addr: stop?.addr ?? "", tel: stop?.tel ?? "", who: stop?.who ?? "", s: stop?.s ?? "",
  book: (stop?.book ?? []).join("\n"), rec: (stop?.rec ?? []).join("\n"), info: (stop?.info ?? []).join("\n"), tips: (stop?.tips ?? []).join("\n"),
  legMode: arrive?.leg ?? "", legTxt: arrive?.txt ?? "",
  ref: stop?.ref?.trip ?? "",
});
function stopOf(d: Draft, base?: Stop): Stop {
  const out: Stop = { ...(base ?? {}), t: d.t.trim(), n: d.n.trim(), k: d.k, q: d.q.trim() || d.n.trim() };
  const set = <K extends keyof Stop>(k: K, v: Stop[K] | undefined | "") => { if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) delete out[k]; else out[k] = v as Stop[K]; };
  set("st", d.st || undefined); set("who", d.who.trim()); set("s", d.s.trim()); set("addr", d.addr.trim()); set("tel", d.tel.trim());
  set("book", lines(d.book)); set("rec", lines(d.rec)); set("info", lines(d.info)); set("tips", lines(d.tips));
  // the saved coordinates belong to the old place: a renamed or re-addressed stop has to be located again (route optimisation trusts `ll`)
  if (base && (out.n !== base.n || out.q !== base.q || (out.addr ?? "") !== (base.addr ?? ""))) delete out.ll;
  return out;
}

/** Form for one stop (edit it, or add a new one after it) plus the leg that leads into it. */
type EditorMode = "edit" | "add" | "new";
const short = (n: string) => (n.length > 12 ? n.slice(0, 12) + "…" : n);
/** A text box as tall as what is in it (long lines wrap, so count those too), between 2 and 8 rows. */
const rowsOf = (v: string) => Math.max(2, Math.min(8, v.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 16)), 0)));
/** `new` = a stop typed in from the day page (no stop to hang it after): it goes where its time puts it. */
function StopEditor({ day, stop, arrive, mode, onDone, onCancel }: { day: Day; stop: Stop; arrive?: Leg; mode: EditorMode; onDone: (key: { t: string; n: string }) => void; onCancel: () => void }) {
  const { current, reload, memberships, trip, labelOf } = useTrip();
  const users = rowFamilies(trip.days, trip.families, day);
  // 分頭行動: the new stop happens at the same time as `stop`, for another group of people
  const [split, setSplit] = useState<"" | "pick" | "child" | "adult">("");
  const goers = useTripPeople(current?.id);
  const group = goers ? relevantPeople(goers, day, []) : [];
  const canPreset = !stop.par && group.some((p) => p.kind === "child") && group.some((p) => p.kind === "adult");
  const otherTrips = memberships.filter((m) => m.trip_id !== current?.id);
  // suggestions lean towards the city this day is in (when the weather already knows where that is)
  const nearPlace = placeByKey(placesFor(day.id, day.city).slice(-1)[0] ?? "");
  const near = nearPlace ? { lat: nearPlace.lat, lon: nearPlace.lon } : null;
  const [d, setD] = useState<Draft>(() => (mode === "edit" ? draftOf(stop, arrive) : { ...draftOf(null, undefined), t: stop.t }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 細節預設收起來；編輯時如果訂位、提醒、交通這些已經有內容就先打開（地址和電話收著時另外顯示一行）
  const [more, setMore] = useState(() => mode === "edit" && !!(d.who || d.ref || d.book || d.rec || d.info || d.tips || d.legMode || d.legTxt));
  const up = <K extends keyof Draft>(k: K) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setD((x) => ({ ...x, [k]: e.target.value }));
  const hasArrive = mode === "new" ? day.items.some((it) => !isLeg(it)) : mode === "add" || !!arrive || day.items.findIndex((it) => !isLeg(it)) !== day.items.indexOf(stop);

  const save = async () => {
    if (!current) return;
    if (!d.n.trim()) { setErr(t("名稱不能空")); return; }
    if (d.t.trim() && !/^\d{1,2}:\d{2}$/.test(d.t.trim())) { setErr(t("時間請用 H:MM，例如 9:30、14:00")); return; }
    setBusy(true); setErr(null);
    const next = stopOf(d, mode === "edit" ? stop : undefined);
    // The link to another trip: only touch it when this person changed the choice. Someone who is not in the linked trip
    // (it is not in their list) used to wipe the link for everyone just by editing the time.
    const refTrip = otherTrips.find((m) => m.trip_id === d.ref);
    if (mode === "edit" && d.ref === (stop.ref?.trip ?? "")) { if (stop.ref) next.ref = stop.ref; else delete next.ref; }
    else if (refTrip) next.ref = { trip: refTrip.trip_id, name: refTrip.trip.name };
    else delete next.ref;
    const leg: Leg | null = d.legMode && d.legTxt.trim() ? { leg: d.legMode, txt: d.legTxt.trim() } : null;
    const timeChanged = mode !== "edit" || d.t.trim() !== stop.t;
    let refPeople: string[] | undefined;
    const e = await editDayItems(current.id, day, (items) => {
      if (mode === "new") return sortByTime([...items, ...(leg ? [leg, next] : [next])]);
      const idx = findStop(items, stop);
      if (idx < 0) return null;
      const out: Item[] = [...items];
      if (mode === "add" && split) {
        // the stop we are adding after and the new one become one 分頭行動 group, next to each other
        const ref = { ...(items[idx] as Stop) };
        ref.par = ref.par ?? newPar();
        const added: Stop = { ...next, par: ref.par };
        if (split === "child" || split === "adult") {
          added.people = group.filter((p) => p.kind === split).map((p) => p.id);
          ref.people = refPeople = group.filter((p) => p.kind !== split).map((p) => p.id);
        }
        out[idx] = ref;
        out.splice(idx + 1, 0, ...(leg ? [leg, added] : [added]));
        return sortByTime(out);
      }
      if (mode === "edit") {
        // notes come from the row as it is now (someone may have added one while this form was open)
        const memo = (items[idx] as Stop).memo;
        const kept = { ...next, ...((items[idx] as Stop).sid ? { sid: (items[idx] as Stop).sid } : {}) };
        out[idx] = memo?.length ? { ...kept, memo } : (() => { const s = { ...kept }; delete s.memo; return s; })();
        const prevIsLeg = idx > 0 && isLeg(out[idx - 1]);
        if (leg && prevIsLeg) out[idx - 1] = { ...(out[idx - 1] as Leg), leg: leg.leg, txt: leg.txt };
        else if (leg && !prevIsLeg) out.splice(idx, 0, leg);
        else if (!leg && prevIsLeg && d.legTxt.trim() === "") out.splice(idx - 1, 1);
      } else {
        out.splice(idx + 1, 0, ...(leg ? [leg, next] : [next]));
      }
      return timeChanged ? sortByTime(out) : out;
    });
    if (e) { setBusy(false); setErr(e); return; }
    // shared with other families: their copies get the same content (and move to the new time)
    const warn = mode === "edit" ? await syncShared(current.id, day, stop.sid, contentPatch({ ...next, sid: stop.sid }))
      : refPeople ? await syncShared(current.id, day, stop.sid, { people: refPeople }) : null;
    setBusy(false);
    if (warn) alert(warn);
    await reload();
    onDone({ t: next.t, n: next.n });
  };

  return (
    <div className="sec editor">
      {mode !== "new" && <h4>{mode === "edit" ? t("編輯這一站") : t("在這站後面加一站")}</h4>}
      {users.length > 1 && <p className="note">{users.length === trip.families.length ? (users.length === 2 ? t("這一天是大家共用的同一份：這裡改了，兩家看到的都會變。") : t("這一天是大家共用的同一份：這裡改了，每一家看到的都會變。")) : (users.length === 2 ? t("這一天是{names}共用的同一份：這裡改了，兩家看到的都會變。", { names: famNames(users, labelOf) }) : t("這一天是{names}共用的同一份：這裡改了，每一家看到的都會變。", { names: famNames(users, labelOf) }))}</p>}
      {mode === "add" && (
        <label className="full">{t("和「{name}」的關係", { name: short(stop.n) })}
          <select value={split} onChange={(e) => setSplit(e.target.value as typeof split)}>
            <option value="">{t("接在它後面（大家一起去）")}</option>
            <option value="pick">{t("同時進行，分頭行動（誰去哪一邊之後再選）")}</option>
            {canPreset && <option value="child">{t("同時進行：小孩去新的這一站，大人留在原本那一站")}</option>}
            {canPreset && <option value="adult">{t("同時進行：大人去新的這一站，小孩留在原本那一站")}</option>}
          </select>
        </label>
      )}
      <div className="formgrid">
        <label>{t("時間")}<TimeField value={d.t} onChange={(v) => setD((x) => ({ ...x, t: v }))} hint={t("選時間")} /></label>
        <label>{t("名稱")}<PlaceInput tripId={current?.id ?? ""} value={d.n} placeholder={t("店名或地圖連結")} near={near}
          onChange={(v) => setD((x) => ({ ...x, n: v }))}
          onPick={(p) => setD((x) => {
            const q = [p.name, p.address].filter(Boolean).join(" ").trim();
            return { ...x, n: p.name, q, addr: p.address, tel: p.tel || x.tel };
          })} /></label>
        <label>{t("類型")}<select value={d.k} onChange={up("k")}>{(Object.keys(KIND_NAME) as Kind[]).map((k) => <option key={k} value={k}>{KIND_NAME[k]}</option>)}</select></label>
        <label>{t("訂位狀態")}<select value={d.st} onChange={up("st")}>{STATUS_OPTS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select></label>
      </div>
      <label className="full">{t("一句話說明")}<input value={d.s} onChange={up("s")} /></label>
      {!more && (d.addr || d.tel) && <p className="note pickedline">{[d.addr, d.tel].filter(Boolean).join("・")}</p>}
      <button type="button" className="morebtn" aria-expanded={more} onClick={() => setMore((v) => !v)}>
        <span><b>{t("更多細節")}</b><small>{t("地址、電話、訂位、提醒、交通")}</small></span>
        <svg className="foldchev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {more && (<>
        <div className="formgrid">
          <label>{t("地址")}<input value={d.addr} onChange={up("addr")} /></label>
          <label>{t("電話")}<input value={d.tel} onChange={up("tel")} inputMode="tel" /></label>
          <label>{t("地圖上要搜尋的字")}<input value={d.q} onChange={up("q")} placeholder={t("空白就用名稱")} /></label>
          <label>{t("只有誰去（可空）")}<input value={d.who} onChange={up("who")} placeholder={t("例：4 位女生")} /></label>
          {mode !== "new" && (otherTrips.length > 0 || (mode === "edit" && stop.ref)) && (
            <label>{t("連到另一個行程（可空）")}
              <select value={d.ref} onChange={up("ref")}>
                <option value="">{t("不連結")}</option>
                {mode === "edit" && stop.ref && !otherTrips.some((m) => m.trip_id === stop.ref!.trip) && <option value={stop.ref.trip}>{t("{name}（你不在這個行程裡）", { name: stop.ref.name })}</option>}
                {otherTrips.map((m) => <option key={m.trip_id} value={m.trip_id}>{m.trip.name}</option>)}
              </select>
            </label>
          )}
        </div>
        <div className="formgrid">
          <label>{t("訂位資訊（一行一項）")}<textarea rows={rowsOf(d.book)} value={d.book} onChange={up("book")} /></label>
          <label>{t("推薦（一行一項）")}<textarea rows={rowsOf(d.rec)} value={d.rec} onChange={up("rec")} /></label>
          <label>{t("資訊（一行一項）")}<textarea rows={rowsOf(d.info)} value={d.info} onChange={up("info")} /></label>
          <label>{t("提醒（一行一項）")}<textarea rows={rowsOf(d.tips)} value={d.tips} onChange={up("tips")} /></label>
        </div>
        {hasArrive && (
          <div className="formgrid">
            <label>{t("從上一站怎麼去")}
              <select value={d.legMode} onChange={up("legMode")}>
                <option value="">{t("（不填）")}</option>
                {(Object.keys(MODE) as Mode[]).map((m) => <option key={m} value={m}>{MODE[m].label}</option>)}
              </select>
            </label>
            <label>{t("交通說明")}<input value={d.legTxt} onChange={up("legTxt")} placeholder={t("例：計程車約 10 分鐘")} /></label>
          </div>
        )}
      </>)}
      <div className="actions">
        <button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? t("儲存中…") : mode === "edit" ? t("儲存") : t("加入#add")}</button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>{t("取消")}</button>
      </div>
      {mode === "edit" && <p className="note">{t("改了時間會自動照時間重新排序。")}</p>}
      {err && <p className="err">{err}</p>}
    </div>
  );
}

/** A stop that points at another trip: people who are in that trip too see its day and can jump over. */
function RefPanel({ stop, day }: { stop: Stop; day: Day }) {
  const { memberships, enterTrip } = useTrip();
  const ref = stop.ref;
  const m = ref ? memberships.find((x) => x.trip_id === ref.trip) : undefined;
  const [items, setItems] = useState<Item[] | null>(null);
  const [failed, setFailed] = useState(false);
  const refTrip = ref?.trip, famId = m?.family_id;
  useEffect(() => {
    setFailed(false);
    if (!supabase || !refTrip || !famId) { setItems(null); return; }
    let alive = true;
    supabase.from("days").select("fam, items").eq("trip_id", refTrip).eq("date_id", day.id).then(({ data, error }) => {
      if (!alive) return;
      if (error) { setFailed(true); return; }
      const rows = (data ?? []) as { fam: string[] | null; items: Item[] }[];
      const pick = rows.find((r) => r.fam?.includes(famId)) ?? rows.find((r) => !r.fam) ?? rows[0];
      setItems(pick ? pick.items : []);
    });
    return () => { alive = false; };
  }, [refTrip, famId, day.id]);
  if (!ref) return null;
  const stops = (items ?? []).filter((i): i is Stop => !isLeg(i));
  const go = () => { location.hash = `#${day.id}`; enterTrip(ref.trip); };
  return (
    <div className="sec refpanel">
      <h4>{t("連到另一個行程")}</h4>
      {!m ? <p className="note">{t("「{name}」：你沒有加入那個行程，看不到內容。", { name: ref.name })}</p> : (
        <>
          <p>{tr(failed ? "<b>{name}</b>（讀不到那邊的行程，可能是網路問題）" : items === null ? "<b>{name}</b>（載入中…）" : stops.length === 0 ? "<b>{name}</b>：{date} 那邊還沒有地點" : "<b>{name}</b>：{date} 有 {n} 個地點", { b: (c) => <b>{c}</b> }, { name: m.trip.name, date: day.d, n: stops.length })}</p>
          {stops.length > 0 && (
            <ul className="refstops">
              {stops.slice(0, 6).map((s, i) => <li key={i}><span className="t">{s.t}</span>{s.n}</li>)}
              {stops.length > 6 && <li className="muted">{t("…還有 {n} 個", { n: stops.length - 6 })}</li>}
            </ul>
          )}
          <button type="button" className="btn primary" onClick={go}>{t("前往「{trip}」的 {date} ›", { trip: m.trip.name, date: day.d })}</button>
        </>
      )}
    </div>
  );
}

export function DetailSheet({ day: day0, stop: stop0, arrive: arrive0, onClose }: { day: Day; stop: Stop; arrive?: LinkedLeg; onClose: () => void }) {
  const { member, current, trip, reload } = useTrip();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [key, setKey] = useState({ t: stop0.t, n: stop0.n });
  const [mode, setMode] = useState<"view" | "edit" | "add">("view");
  const [busy, setBusy] = useState(false);

  // Follow the live data: after an edit (ours or someone else's) show the current version of this stop
  const { day, stop, arrive } = useMemo(() => {
    const d = trip.days.find((x) => sameDayRow(x, day0)) ?? day0;
    const idx = findStop(d.items, key);
    const s = idx >= 0 ? (d.items[idx] as Stop) : stop0;
    const prev = idx > 0 && isLeg(d.items[idx - 1]) ? (d.items[idx - 1] as Leg) : undefined;
    const a: LinkedLeg | undefined = prev ? { ...prev, from: arrive0?.from, to: s.q } : (idx < 0 ? arrive0 : undefined);
    return { day: d, stop: s, arrive: a };
  }, [trip.days, day0, stop0, arrive0, key]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [onClose]);

  const editable = canEdit(day.fam, member);
  const codes = (stop.book ?? [])
    .map((b) => b.match(/(?:編號|番號|番号|ID|確認碼|確認號|訂位碼|訂房碼|代碼|代號|Confirmation|Booking|Reservation|Ref\.?|No\.?)[：:#\s]*([A-Za-z0-9-]{5,})/i)?.[1])
    .filter((c): c is string => !!c);
  const travel = arrive ? MODE[arrive.leg].travel : null;
  const info = [...(stop.s ? [stop.s] : []), ...(stop.info ?? [])];
  // what comes after this stop: the leg out of it and the next stop
  const idx = day.items.indexOf(stop);
  const nextItem = idx >= 0 ? day.items[idx + 1] : undefined;
  const departLeg = nextItem && isLeg(nextItem) ? nextItem : undefined;
  const nextStop = day.items.slice(idx + 1).find((it): it is Stop => !isLeg(it));
  const ask = () => { onClose(); setTimeout(() => askClaude(t("「{name}」（{date}）這個地方幫我查一下：營業時間或開放時間、怎麼去、要注意什麼、有什麼推薦。", { name: stop.n, date: day.d })), 50); };

  const remove = async () => {
    const others = sharedFamilies(trip.days, trip.families, day.id, stop.sid).length > 1;
    if (!current || !confirm(others ? t("把「{name}」從我們這一份 {date} 的行程拿掉？\n\n這是和別家一起的地點：其他家的行程裡還會留著。要每一家都取消，請用上面「和誰一起」裡的「整個取消」。", { name: stop.n, date: day.d }) : t("把「{name}」從 {date} 的行程刪掉？", { name: stop.n, date: day.d }))) return;
    setBusy(true);
    const err = await editDayItems(current.id, day, (items) => { const i = findStop(items, stop); return i < 0 ? null : removeStopAt(items, i); });
    setBusy(false);
    if (err) { alert(err); return; }
    await reload();
    onClose();
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="sheet" role="dialog" aria-modal="true" aria-labelledby="sh-title">
        <header>
          <div className="hd">
            <div className="st">
              {t("{d}（{w}）{time}", { d: day.d, w: wk(day.w), time: stop.t })} ・ {KIND_NAME[stop.k]}{stop.who && ` ・ ${stop.who}`}
            </div>
            <h3 id="sh-title">{stop.n}</h3>
            {stop.st && <div className="seal-wrap"><span className={`seal ${stop.st}`}>{SEAL[stop.st]}</span></div>}
          </div>
          <button ref={closeRef} className="x" type="button" aria-label={t("關閉")} onClick={onClose}>×</button>
        </header>
        <div className="body">
          {mode !== "view" ? (
            <StopEditor key={mode} day={day} stop={stop} arrive={arrive} mode={mode} onDone={(k) => { setKey(k); setMode("view"); }} onCancel={() => setMode("view")} />
          ) : (
            <>
              <div className="acts">
                <a className="btn primary" href={placeURL(stop.q)} target="_blank" rel="noopener"><PinIcon />{t("在 Google 地圖開啟")}</a>
                {arrive && travel && arrive.from && arrive.from !== stop.q && (
                  <a className="btn" href={dirURL(arrive.from, stop.q, travel)} target="_blank" rel="noopener">
                    <ModeIcon mode={arrive.leg} />{t("從上一站過來")}
                  </a>
                )}
              </div>
              {editable && (
                <div className="acts editacts">
                  <button type="button" className="btn" onClick={() => setMode("edit")} disabled={busy}><MenuIcon name="rename" size={18} />{t("編輯")}</button>
                  <button type="button" className="btn" onClick={() => setMode("add")} disabled={busy}>{t("＋ 之後加一站")}</button>
                  <button type="button" className="btn danger" onClick={remove} disabled={busy}>{busy ? t("刪除中…") : t("刪除這一站")}</button>
                </div>
              )}
              <RefPanel stop={stop} day={day} />
              <SplitPanel day={day} stop={stop} />
              <SharedPanel day={day} stop={stop} onGone={onClose} />
              <StopPeople day={day} stop={stop} />
              {arrive && <div className="sec"><h4>{t("怎麼去")}</h4><p>{arrive.txt}</p></div>}
              {(departLeg || nextStop) && (
                <div className="sec">
                  <h4>{t("接下來")}</h4>
                  {departLeg && <p><ModeIcon mode={departLeg.leg} /> {departLeg.txt}</p>}
                  {departLeg?.leg === "flight" && <FlightStatus text={departLeg.txt} date={day.id} />}
                  {nextStop && <p className="muted">{t("下一站 {time} {name}", { time: nextStop.t, name: nextStop.n })}</p>}
                </div>
              )}
              {stop.book && (
                <div className="sec"><h4>{t("訂位資訊")}</h4><div className={`bookbox ${stop.st ?? ""}`}><List items={stop.book} /></div></div>
              )}
              {(stop.addr || stop.tel || codes.length > 0) && (
                <div className="sec">
                  <dl className="kv">
                    {stop.addr && <><dt>{t("地址")}</dt><dd>{stop.addr}</dd></>}
                    {stop.tel && <><dt>{t("電話")}</dt><dd><Copy value={stop.tel} /></dd></>}
                    {codes.map((c) => <Fragment key={c}><dt>{t("訂位碼")}</dt><dd><Copy value={c} /></dd></Fragment>)}
                  </dl>
                </div>
              )}
              {stop.rec && <div className="sec"><h4>{t("推薦")}</h4><List items={stop.rec} /></div>}
              {info.length > 0 && <div className="sec"><h4>{t("資訊")}</h4><List items={info} /></div>}
              {stop.tips && <div className="sec"><h4>{t("提醒")}</h4><List items={stop.tips} /></div>}
              <CardSection kind={stop.k} date={day.id} />
              <Memos day={day} stop={stop} />
              {!isViewer(member) && (
                <div className="sec askrow">
                  <button type="button" className="btn" onClick={ask}><SuitcaseIcon size={20} />{t("Trip醬：查這個地點")}</button>
                  <span className="note">{t("資料不夠的話，讓它上網查營業時間、怎麼去、推薦。")}</span>
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}

/** 從當天的頁面手動加一站（不用先點開別的地點）：照時間排進去；空白的一天也可以用。 */
export function NewStopSheet({ day, onClose }: { day: Day; onClose: () => void }) {
  const blank: Stop = { t: "", n: "", q: "", k: "sight" };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="sheet" role="dialog" aria-modal="true" aria-labelledby="ns-title">
        <header>
          <div className="hd">
            <div className="st">{t("{d}（{w}）", { d: day.d, w: wk(day.w) })}</div>
            <h3 id="ns-title">{t("加一站")}</h3>
          </div>
          <button className="x" type="button" aria-label={t("關閉")} onClick={onClose}>×</button>
        </header>
        <div className="body">
          <StopEditor day={day} stop={blank} mode="new" onDone={onClose} onCancel={onClose} />
        </div>
      </aside>
    </>
  );
}
