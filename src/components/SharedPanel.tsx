import { useState } from "react";
import { useTrip } from "../trip";
import { canEdit, daysFor } from "../data";
import type { Day, Stop } from "../data";
import { sharedApi, sharedFamilies } from "../shared";
import { MenuIcon } from "./Logo";

/** The families that see this very row on this date (one family for an own version, several for a joint or everyone's version). */
export function rowFamilies(days: Day[], families: { id: string }[], day: Day) {
  return families.filter((f) => { const d = daysFor(days, f.id).find((x) => x.id === day.id); return !!d && (day.rowId ? d.rowId === day.rowId : d === day); }).map((f) => f.id);
}

/** 地點卡片上的小標籤：這一站和哪幾家一起。 */
export function SharedChip({ stop, day }: { stop: Stop; day: Day }) {
  const { trip, viewFam } = useTrip();
  const fams = sharedFamilies(trip.days, trip.families, day.id, stop.sid);
  if (fams.length < 2) return null;
  const mine = new Set([viewFam, ...rowFamilies(trip.days, trip.families, day)]);
  const others = fams.filter((f) => !mine.has(f)).map((f) => trip.families.find((x) => x.id === f)?.label ?? f);
  if (others.length === 0) return null;
  return <span className="tag together"><MenuIcon name="together" size={14} />{fams.length === trip.families.length ? "大家一起" : `和 ${others.join("、")}`}</span>;
}

/**
 * 地點詳細頁：和誰一起。點別家的名字 = 這一站也放進那一家那一天的行程；之後內容每一家同步，交通各家自己排。
 * 只有在「這一天不是每一家都看同一份」的時候才出現（大家一起的版本本來就每一家都看得到）。
 */
export function SharedPanel({ day, stop, onGone }: { day: Day; stop: Stop; onGone: () => void }) {
  const { current, member, trip, reload } = useTrip();
  const [busy, setBusy] = useState(false);
  if (!current || !member || trip.families.length < 2) return null;
  const here = rowFamilies(trip.days, trip.families, day);
  const joined = sharedFamilies(trip.days, trip.families, day.id, stop.sid);
  const others = trip.families.filter((f) => !here.includes(f.id));
  if (others.length === 0) return null;
  const editable = canEdit(day.fam, member) && !!day.rowId;
  const on = (f: string) => here.includes(f) || joined.includes(f);
  const shared = joined.filter((f) => !here.includes(f)).length > 0;
  const label = (f: string) => trip.families.find((x) => x.id === f)?.label ?? f;

  const run = async (work: () => Promise<unknown>, gone = false) => {
    if (busy) return;
    setBusy(true);
    try { await work(); await reload(); if (gone) onGone(); } catch (e) { alert(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const toggle = (f: string) => {
    if (on(f)) { if (confirm(`${label(f)}不一起了？這一站會從${label(f)}那一天的行程拿掉。`)) run(() => sharedApi.unshare(current.id, day.id, stop.sid!, [f])); }
    else run(() => sharedApi.share(current.id, day.rowId!, stop, [f]));
  };

  return (
    <div className="sec stoppeople shared">
      <h4>和誰一起</h4>
      <div className="chips">
        {trip.families.map((f) => (
          here.includes(f.id) ? <span key={f.id} className="chip on fixed">{f.label}</span>
            : editable ? <button key={f.id} type="button" className={`chip${on(f.id) ? " on" : " off"}`} aria-pressed={on(f.id)} disabled={busy} onClick={() => toggle(f.id)}>{on(f.id) ? f.label : `＋ ${f.label}`}</button>
            : on(f.id) ? <span key={f.id} className="chip on">{f.label}</span> : null
        ))}
      </div>
      {shared
        ? <p className="note">這一站是共同的：時間、訂位、備註、誰參加，任何一家改了每一家都會更新。前後的交通各家自己排。{editable && <> <button type="button" className="link danger" disabled={busy} onClick={() => { if (confirm(`整個取消「${stop.n}」？每一家那一天的行程都會把它拿掉。`)) run(() => sharedApi.unshare(current.id, day.id, stop.sid!, null), true); }}>整個取消</button></>}</p>
        : editable && <p className="note">各家那一天行程不同，但這一站要一起（例如一起吃飯）：點別家的名字，這一站就會出現在他們那一天的行程裡，之後內容每一家同步。</p>}
    </div>
  );
}
