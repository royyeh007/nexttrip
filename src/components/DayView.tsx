import { Fragment, useMemo, useRef, useState } from "react";
import { DayShare } from "./DayShare";
import { StopPeopleChip } from "./PeopleView";
import { SharedChip, rowFamilies } from "./SharedPanel";
import { MenuIcon } from "./Logo";
import { SplitNames, SplitNote } from "./Split";
import { NewStopSheet } from "./DetailSheet";
import { canEdit, famNames, hotelFor, isLeg, isViewer } from "../data";
import { DayWeatherPanel } from "./Weather";
import type { WeatherState } from "../useWeather";
import type { Day, Family, Leg, Stop } from "../data";
import { LegSheet } from "./LegSheet";
import { MODE, dayRouteURL, dirURL, linkLegs } from "../maps";
import type { LinkedLeg } from "../maps";
import { DownloadIcon, ModeIcon, RouteIcon } from "../icons";
import { FlightCard } from "./FlightStatus";
import { OptimizeDay } from "./OptimizeDay";
import { KIND, SEAL } from "../labels";
import { openForm } from "../form";
import { supabase } from "../supabase";
import { whereDay } from "../dayEdit";
import { useTrip } from "../trip";
import { fakeNow, setNowLine, startPreview, toMinutes, useNow, useNowLine } from "../now";
import { CardChip } from "./CardPick";

function LegRow({ leg, done, date, onEdit }: { leg: LinkedLeg; done?: boolean; date?: string; onEdit?: () => void }) {
  const { travel, label } = MODE[leg.leg];
  if (leg.leg === "flight") {
    return (
      <li className={`leg flight${done ? " done" : ""}`}>
        <span />
        <span className="rail" />
        <div className="flightwrap">
          <FlightCard text={leg.txt} date={date} />
          {onEdit && <button type="button" className="link legflightedit" onClick={onEdit}><MenuIcon name="rename" size={14} />改這段交通</button>}
        </div>
      </li>
    );
  }
  const inner = (
    <>
      <span className="mi"><ModeIcon mode={leg.leg} /></span>
      <span className="lt">
        {leg.txt}
        {leg.st && <> <span className={`seal ${leg.st}`}>{SEAL[leg.st]}</span></>}
      </span>
    </>
  );
  const canLink = travel && leg.from && leg.to && leg.from !== leg.to;
  return (
    <li className={`leg${done ? " done" : ""}`}>
      <span />
      <span className="rail" />
      {onEdit ? (
        // editable: the text opens the editor, the route link stays a link of its own
        <span className="legbox legrow">
          <button type="button" className="legedit" onClick={onEdit} aria-label={`改交通：${leg.txt}`}>{inner}</button>
          {canLink && <a className="go" href={dirURL(leg.from!, leg.to!, travel)} target="_blank" rel="noopener" aria-label={`${label}路線：${leg.txt}`}>路線 ↗</a>}
        </span>
      ) : canLink ? (
        <a href={dirURL(leg.from!, leg.to!, travel)} target="_blank" rel="noopener" aria-label={`${label}路線：${leg.txt}`}>
          {inner}
          <span className="go">路線 ↗</span>
        </a>
      ) : (
        <span className="legbox">{inner}</span>
      )}
    </li>
  );
}

function StopRow({ stop, done, date, day, split, onOpen }: { stop: Stop; done?: boolean; date?: string; day: Day; split?: boolean; onOpen: () => void }) {
  const sub = stop.s || stop.book?.[0] || stop.rec?.[0] || "";
  return (
    <li className={`stop${done ? " done" : ""}`}>
      <span className="t">{stop.t}</span>
      <span className={`k ${stop.k}`} aria-hidden="true">{KIND[stop.k]}</span>
      <button className="card" type="button" aria-haspopup="dialog" onClick={onOpen}>
        <div className="n">{stop.n}</div>
        {sub && <div className="s">{sub}</div>}
        <div className="row">
          {stop.st && <span className={`seal ${stop.st}`}>{SEAL[stop.st]}</span>}
          {stop.who && <span className="who">{stop.who}</span>}
          <SharedChip stop={stop} day={day} />
          {split ? <SplitNames stop={stop} day={day} /> : <StopPeopleChip stop={stop} day={day} />}
          {stop.ref && <span className="tag trip">↗ {stop.ref.name}</span>}
          <CardChip kind={stop.k} date={date} />
          {stop.memo && stop.memo.length > 0 && <span className="memo-n">備註 {stop.memo.length}</span>}
          <span className="more">詳細資訊 ›</span>
        </div>
      </button>
    </li>
  );
}

/** Read-only timeline used by the day page and by the proposal preview. On the current day it dims what is past and draws a "now" line. */
/** `onLeg` (only where the day can be edited): tapping a leg, or the "add transport" gap between two stops, calls it with the leg (or null) and the stop it leads to. */
export function Timeline({ day, onOpen, onLeg }: { day: Day; onOpen?: (s: Stop, arrive?: LinkedLeg) => void; onLeg?: (leg: Leg | null, next: Stop) => void }) {
  const { legs, arrive } = useMemo(() => linkLegs(day), [day]);
  const now = useNow();
  const isToday = useNowLine() && now.date === day.id;
  // index of the last stop whose time has passed; the line goes right after it (-1 = before everything)
  let lastDone = -1;
  if (isToday) day.items.forEach((it, i) => { if (!isLeg(it) && toMinutes(it.t) <= now.minutes) lastDone = i; });
  // consecutive stops with the same `par` (and the legs between them) are one 分頭行動 group; a lone stop with `par` is an ordinary stop
  const segments = useMemo(() => {
    const out: { par?: string; idx: number[] }[] = [];
    const items = day.items;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const par = !isLeg(it) ? it.par : undefined;
      if (!par) { out.push({ idx: [i] }); continue; }
      const idx = [i];
      let j = i + 1;
      for (;;) {
        let k = j;
        while (k < items.length && isLeg(items[k])) k++;
        const next = items[k];
        if (!next || isLeg(next) || next.par !== par) break;
        for (let x = j; x <= k; x++) idx.push(x);
        j = k + 1;
      }
      out.push(idx.length > 1 ? { par, idx } : { idx });
      i = j - 1;
    }
    return out;
  }, [day.items]);
  const nextStop = (i: number) => day.items.slice(i + 1).find((x): x is Stop => !isLeg(x));
  const line = <li className="nowline" key="now" aria-label={`現在 ${now.hhmm}`}><span className="lbl">現在 {now.hhmm}</span></li>;
  return (
    <ol className="tl">
      {isToday && lastDone < 0 && line}
      {segments.map((seg) => {
        const row = (i: number) => {
          const it = day.items[i];
          return (
            <Fragment key={i}>
              {isLeg(it) ? (
                <LegRow leg={legs.get(i)!} done={isToday && i <= lastDone} date={day.id} onEdit={onLeg && nextStop(i) ? () => onLeg(it, nextStop(i)!) : undefined} />
              ) : (
                <StopRow stop={it} done={isToday && i <= lastDone} date={day.id} day={day} split={!!seg.par} onOpen={() => onOpen?.(it, arrive.get(i))} />
              )}
              {/* two stops in a row with nothing between them: offer to say how to get there */}
              {onLeg && !isLeg(it) && day.items[i + 1] && !isLeg(day.items[i + 1]) && (
                <li className="leg addleg"><span /><span className="rail" /><button type="button" className="legadd" onClick={() => onLeg(null, day.items[i + 1] as Stop)}>＋ 加交通</button></li>
              )}
              {isToday && i === lastDone && line}
            </Fragment>
          );
        };
        if (!seg.par) return row(seg.idx[0]);
        // 分頭行動：同一個時段的幾站框在一起，每一站是一組人
        const after = day.items.slice(seg.idx[seg.idx.length - 1] + 1).find((it): it is Stop => !isLeg(it));
        return (
          <li key={`par-${seg.idx[0]}`} className="split">
            <div className="splithead"><b>分頭行動</b><span>同一個時段，{seg.idx.filter((i) => !isLeg(day.items[i])).length} 組人去不同的地方</span></div>
            <ol className="tl">{seg.idx.map(row)}</ol>
            <SplitNote day={day} par={seg.par} />
            {after && <p className="splitfoot">之後會合：{after.t} {after.n}</p>}
          </li>
        );
      })}
    </ol>
  );
}

/** Remove this family from a day: delete the row if it is theirs alone, otherwise just drop them from `fam`. */
async function removeDay(day: Day, familyId: string, tripId: string) {
  if (!supabase || !day.fam) return;
  const rest = day.fam.filter((f) => f !== familyId);
  const q = supabase.from("days");
  // exactly this row: a "contains this family" filter would also hit a joint row the family shares with others
  const { data, error } = rest.length === 0
    ? await whereDay(q.delete(), tripId, day).select("id")
    : await whereDay(q.update({ fam: rest, updated_at: new Date().toISOString() }), tripId, day).select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("沒有改到：這一天已經被改過，或你沒有權限。重新整理再試");
}

export function DayView({ day, family, onOpen, onRemoved, wx }: { day: Day; family: Family; onOpen: (s: Stop, arrive?: LinkedLeg) => void; onRemoved: () => void; wx: WeatherState }) {
  const { trip, current, member, reload, labelOf } = useTrip();
  const [busy, setBusy] = useState(false);
  const viewer = isViewer(member);
  const [optimizing, setOptimizing] = useState(false);
  const editable = canEdit(day.fam, member);
  const canOptimize = editable && day.items.filter((it) => !isLeg(it)).length >= 3;
  // title / city / hotel of this day, edited in place
  const [editMeta, setEditMeta] = useState(false);
  const [addingStop, setAddingStop] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [legEdit, setLegEdit] = useState<{ leg: Leg | null; next: Stop } | null>(null);
  const now = useNow();
  const menuRef = useRef<HTMLDetailsElement>(null);
  const closeMenu = () => { if (menuRef.current) menuRef.current.open = false; };
  const users = rowFamilies(trip.days, trip.families, day); // the families that see this very row
  const joint = users.length > 1;
  const [meta, setMeta] = useState({ title: day.title, city: day.city, hotel: hotelFor(day, family.id) });
  const [metaErr, setMetaErr] = useState<string | null>(null);
  const openMeta = () => { setMeta({ title: day.title, city: day.city, hotel: hotelFor(day, family.id) }); setMetaErr(null); setEditMeta(true); };
  const saveMeta = async () => {
    if (!supabase || !current) return;
    if (!meta.title.trim()) { setMetaErr("標題不能空"); return; }
    setBusy(true); setMetaErr(null);
    // several families use this row: the hotel typed here is this family's own (the others keep theirs)
    const where = joint ? { hotels: { ...(day.hotels ?? {}), [family.id]: meta.hotel.trim() } } : { hotel: meta.hotel.trim() };
    const { data, error } = await whereDay(supabase.from("days").update({ title: meta.title.trim(), city: meta.city.trim() || day.city, ...where, updated_at: new Date().toISOString() }), current.id, day).select("id");
    setBusy(false);
    if (error) { setMetaErr(error.message); return; }
    if (!data?.length) { setMetaErr("沒有存到：這一天已經被改過，或你沒有權限。重新整理再試"); return; }
    await reload();
    setEditMeta(false);
  };
  const own = !!day.fam && day.fam.includes(family.id);
  const shared = !day.fam;
  // `family` is the family on screen, which can be somebody else's: only offer "our own version" / "remove" to people who may write for it
  const mayWriteForFamily = canEdit([family.id], member);
  const hasSharedVersion = trip.days.some((d) => d.id === day.id && !d.fam);
  const empty = day.items.length === 0;
  const versionLabel = shared ? "大家一起的版本" : day.fam!.length > 1 ? `${famNames(day.fam!, labelOf)}一起的版本` : `${family.label}自己的版本`;
  // "delete this day" only when there is nothing to fall back to; with an everyone version, going back to it is done from the label above
  const canDelete = own && mayWriteForFamily && !hasSharedVersion;

  const remove = async () => {
    const msg = hasSharedVersion ? `要把 ${family.label}自己的 ${day.d} 版本刪掉，改回大家一起的版本嗎？` : `要把 ${day.d} 從${family.label}的行程拿掉嗎？`;
    if (!confirm(msg)) return;
    setBusy(true);
    // when everyone's version of this date exists the page stays on the date and shows that one; otherwise move off the deleted day
    try { await removeDay(day, family.id, current!.id); await reload(); if (!hasSharedVersion) onRemoved(); }
    catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <>
      <section className="dayhead">
        <div className="meta">
          <span>{day.d}（{day.w}）</span>
          <span className="hotel">{hotelFor(day, family.id) ? `住 ${hotelFor(day, family.id)}` : ""}</span>
          {(editable || canDelete || !empty) && (
            <details className="daymenu" ref={menuRef}>
              <summary aria-label="這一天的其他功能" title="改標題、優化順序、刪除"><MenuIcon name="more" size={18} /></summary>
              <div className="list">
                {editable && <button type="button" onClick={() => { closeMenu(); openMeta(); }}><MenuIcon name="rename" />改標題／城市／住宿</button>}
                {canOptimize && <button type="button" onClick={() => { closeMenu(); setOptimizing((v) => !v); }}><MenuIcon name="swap" />優化順序</button>}
                {!fakeNow() && now.date !== day.id && !empty && <button type="button" onClick={() => { closeMenu(); setNowLine(true); startPreview(day.id, now.hhmm, `#${day.id}`); }}><MenuIcon name="eye" />預覽旅行當天的樣子</button>}
                {canDelete && <button type="button" className="danger" onClick={() => { closeMenu(); remove(); }}><MenuIcon name="leave" />刪除這天</button>}
              </div>
            </details>
          )}
          <span className="verrow">
          {/* one way in for everything about "whose version is this": tap the label */}
            {mayWriteForFamily && trip.families.length > 1
              ? <button type="button" className={`tag versionbtn ${shared || (day.fam?.length ?? 0) > 1 ? "shared" : "own"}`} aria-expanded={sharing} onClick={() => setSharing((v) => !v)} disabled={busy} title="這一天和誰一起">{versionLabel}<span aria-hidden="true"> ▾</span></button>
              : <span className={`tag ${shared || (day.fam?.length ?? 0) > 1 ? "shared" : "own"}`}>{versionLabel}</span>}
          </span>
        </div>
        {sharing && <DayShare key={`${day.rowId}|${(day.fam ?? []).join(",")}`} day={day} family={family} onClose={() => setSharing(false)} />}
        {editMeta ? (
          <div className="daymeta-edit">
            <div className="formgrid">
              <label>標題<input value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} autoFocus onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) saveMeta(); if (e.key === "Escape") setEditMeta(false); }} /></label>
              <label>城市<input value={meta.city} onChange={(e) => setMeta({ ...meta, city: e.target.value })} placeholder="例：東京" /></label>
              <label>{joint ? `${family.label}那晚住哪（別家可以各填各的）` : "那晚住哪"}<input value={meta.hotel} onChange={(e) => setMeta({ ...meta, hotel: e.target.value })} placeholder="可空" /></label>
            </div>
            <div className="actions">
              <button type="button" className="btn primary" onClick={saveMeta} disabled={busy}>{busy ? "儲存中…" : "儲存"}</button>
              <button type="button" className="btn" onClick={() => setEditMeta(false)} disabled={busy}>取消</button>
            </div>
            {metaErr && <p className="err">{metaErr}</p>}
          </div>
        ) : (
          <h2>{day.title}</h2>
        )}
        {!empty && (
          <div className="actions">
            <a className="btn primary" href={dayRouteURL(day)} target="_blank" rel="noopener">
              <RouteIcon />開啟今天的 Google 地圖路線
            </a>
            {editable && <button type="button" className="btn" onClick={() => setAddingStop(true)}>＋ 加一站</button>}
          </div>
        )}
        <DayWeatherPanel date={day.id} city={day.city} wx={wx} />
      </section>
      {empty ? (
        <div className="pendingbox">
          <p>這天還沒有行程。</p>
          {viewer ? <p>等成員把內容補上。</p> : (
            <>
              <p>可以自己一站一站輸入；也可以到「上傳行程」傳表單或截圖，或點右下角「Trip醬」直接說這天要做什麼，確認後就會出現在這裡。</p>
              <div className="actions">
                {editable && <button type="button" className="btn primary" onClick={() => setAddingStop(true)}>＋ 自己輸入第一站</button>}
                <a className="btn" href="#upload"><DownloadIcon />上傳行程</a>
                <button type="button" className="btn" onClick={() => openForm(current?.name)}><DownloadIcon />下載填寫表單</button>
              </div>
            </>
          )}
        </div>
      ) : (
        <>
          {optimizing && <OptimizeDay key={day.id + (day.fam ?? []).join(",")} day={day} onClose={() => setOptimizing(false)} />}
          <Timeline day={day} onOpen={onOpen} onLeg={editable ? (leg, next) => setLegEdit({ leg, next }) : undefined} />
        </>
      )}
      {addingStop && <NewStopSheet day={day} onClose={() => setAddingStop(false)} />}
      {legEdit && <LegSheet day={day} leg={legEdit.leg} next={legEdit.next} onClose={() => setLegEdit(null)} />}
    </>
  );
}
