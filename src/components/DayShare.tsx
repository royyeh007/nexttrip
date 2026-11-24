import { useState } from "react";
import { useTrip } from "../trip";
import { daysFor } from "../data";
import type { Day, Family } from "../data";
import { supabase } from "../supabase";
import { t, list } from "../i18n";

/**
 * 「這一天和誰一起」：一個地方決定這一家這一天跟哪幾家看同一份行程。
 * 取代原本分開的「做一份我們家的版本」「改回大家一起的版本」，並加上「和某幾家共用」。
 * 資料庫那邊是 day_set_sharing（會動到別家的那一天，所以不是前端直接寫）。
 */
export function DayShare({ day, family, onClose }: { day: Day; family: Family; onClose: () => void }) {
  const { current, member, trip, reload } = useTrip();
  const others = trip.families.filter((f) => f.id !== family.id);
  const hasEveryone = trip.days.some((d) => d.id === day.id && !d.fam);
  const rowOf = (f: string) => daysFor(trip.days, f).find((d) => d.id === day.id);
  const [mode, setMode] = useState<"everyone" | "pick">(day.fam ? "pick" : "everyone");
  const [picked, setPicked] = useState<string[]>(() => (day.fam ?? []).filter((f) => f !== family.id));
  const [base, setBase] = useState(family.id);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!current || !member) return null;
  const admin = member.role === "admin";
  const label = (f: string) => trip.families.find((x) => x.id === f)?.label ?? f;

  // a family "has its own plan" when the day it sees is not everyone's, is not the row we are on, and has something in it
  const ownPlan = (f: string) => { const r = rowOf(f); return !!r && !!r.fam && r.rowId !== day.rowId && r.items.length > 0; };
  const group = [family.id, ...picked];
  const withPlans = picked.filter(ownPlan);
  const effBase = group.includes(base) ? base : family.id;
  // whose plan is replaced by the shared one
  const replaced = group.filter((f) => f !== effBase && (f === family.id ? rowOf(effBase)?.rowId !== day.rowId && day.items.length > 0 && !!day.fam : ownPlan(f)));
  const blocked = !admin && replaced.some((f) => f !== family.id);
  const unchanged = mode === "everyone" ? !day.fam : !!day.fam && effBase === family.id && [...(day.fam ?? [])].sort().join() === [...group].sort().join();

  const apply = async () => {
    if (!supabase || busy) return;
    if (mode === "pick" && replaced.length > 0 && !confirm(t("{names}那一天原本的行程會被「{base}」那一份取代，原本那一份會刪掉。確定嗎？", { names: list(replaced.map(label)), base: label(effBase) }))) return;
    if (mode === "everyone" && day.fam && day.items.length > 0 && !confirm(day.fam.length > 1 ? t("改回大家一起的版本？{family}會離開這一份（其他家不受影響）。", { family: family.label }) : t("改回大家一起的版本？{family}自己的這一份會刪掉。", { family: family.label }))) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("day_set_sharing", mode === "everyone"
      ? { p_trip: current.id, p_date: day.id, p_everyone: true, p_family: family.id }
      : { p_trip: current.id, p_date: day.id, p_with: picked, p_base: effBase, p_family: family.id });
    if (error) { setBusy(false); setErr(error.code === "PGRST202" ? t("這個功能要先升級資料庫（make db-push）") : t(error.message)); return; }
    await reload();
    setBusy(false);
    onClose();
  };

  return (
    <div className="panel dayshare">
      <h3>{t("{family}這一天和誰一起", { family: family.label })}</h3>
      <div className="sharechoices">
        {hasEveryone && (
          <label className={mode === "everyone" ? "on" : undefined}>
            <input type="radio" name="dayshare" checked={mode === "everyone"} onChange={() => setMode("everyone")} />
            <span><b>{t("大家一起")}</b><small>{t("每一家看同一份，誰改了大家都看到")}</small></span>
          </label>
        )}
        <label className={mode === "pick" ? "on" : undefined}>
          <input type="radio" name="dayshare" checked={mode === "pick"} onChange={() => setMode("pick")} />
          <span><b>{picked.length ? t("和 {names} 一起", { names: list(picked.map(label)) }) : t("只有我們家")}</b><small>{t("在下面點要一起的家；都不點就是自己一份")}</small></span>
        </label>
      </div>
      {mode === "pick" && (
        <>
          <div className="chips">
            <span className="chip on fixed">{family.label}</span>
            {others.map((f) => {
              const on = picked.includes(f.id);
              return <button key={f.id} type="button" className={`chip${on ? " on" : " off"}`} aria-pressed={on} disabled={busy} onClick={() => setPicked(on ? picked.filter((x) => x !== f.id) : [...picked, f.id])}>{on ? f.label : `＋ ${f.label}`}</button>;
            })}
          </div>
          {withPlans.length > 0 && (
            <label className="basepick">{t("用哪一份當共用的行程")}
              <select value={effBase} onChange={(e) => setBase(e.target.value)}>
                <option value={family.id}>{t("{family}現在這一份（{n} 站）", { family: family.label, n: day.items.filter((it) => !("leg" in it)).length })}</option>
                {withPlans.map((f) => <option key={f} value={f}>{t("{family}那一份（{n} 站）", { family: label(f), n: rowOf(f)!.items.filter((it) => !("leg" in it)).length })}</option>)}
              </select>
            </label>
          )}
          {picked.length > 0 && <p className="note">{t("共用之後是同一份：任何一家改了，這幾家都會變。住宿可以各填各的；只有某一站不一起，可以在那一站的「誰參加」調整。")}</p>}
          {blocked && <p className="err">{t("{names}那一天已經有自己排好的行程，不能直接蓋掉。可以在上面改成用他們那一份，或請管理員處理。", { names: list(replaced.filter((f) => f !== family.id).map(label)) })}</p>}
        </>
      )}
      {err && <p className="err">{err}</p>}
      <div className="actions">
        <button type="button" className="btn primary" onClick={apply} disabled={busy || unchanged || (mode === "pick" && blocked)}>{busy ? t("處理中…") : t("套用")}</button>
        <button type="button" className="btn" onClick={onClose} disabled={busy}>{t("取消")}</button>
      </div>
    </div>
  );
}
