import { useEffect, useState } from "react";
import { PlaceInput } from "./PlaceInput";
import { supabase } from "../supabase";
import { useTrip } from "../trip";
import { addDays, daysBetween, type Membership } from "../data";
import { fillTripDays } from "../days";
import { removeTripImages } from "../images";
import { MenuIcon } from "./Logo";
import { TRIP_ICONS, TripIcon, tripIconId } from "../tripIcons";
import { t } from "../i18n";

type Tab = "edit" | "copy" | "delete";

/** 首頁行程卡片上的「管理」：不用進行程，就可以改基本資料、複製、刪除。只給這個行程的管理員。 */
export function TripManage({ m, onClose }: { m: Membership; onClose: () => void }) {
  const { refreshMemberships } = useTrip();
  const trip = m.trip;
  const [tab, setTab] = useState<Tab>("edit");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tab: Tab; text: string; bad?: boolean } | null>(null);

  // ---- 基本資料 ----
  const [name, setName] = useState(trip.name);
  const [place, setPlace] = useState(trip.place);
  const [start, setStart] = useState(trip.start_date);
  const [end, setEnd] = useState(trip.end_date);
  const [icon, setIcon] = useState(tripIconId(trip.settings));
  // 改開始日期時，已經排好的日子要不要一起移（預設要：不移的話舊的日子留在原地，新日期只有空白的日子）
  const [move, setMove] = useState(true);
  const delta = start ? daysBetween(trip.start_date, start) : 0;
  const pickStart = (v: string) => {
    if (v && start && end) { const by = daysBetween(start, v); setEnd(move ? addDays(end, by) : end < v ? v : end); }
    setStart(v);
  };
  // ---- 複製 ----
  const [copyName, setCopyName] = useState(t("{name}（複本）", { name: trip.name }).slice(0, 80));
  const [copyStart, setCopyStart] = useState(trip.start_date);
  // ---- 刪除 ----
  const [confirmName, setConfirmName] = useState("");

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [busy, onClose]);

  const fail = (tb: Tab, text: string) => { setMsg({ tab: tb, text, bad: true }); setBusy(false); };

  const save = async () => {
    if (!supabase) return;
    const changes: Record<string, unknown> = {};
    if (name.trim() !== trip.name) changes.name = name.trim().slice(0, 80);
    const shifting = move && delta !== 0;
    const datesChanged = start !== trip.start_date || end !== trip.end_date;
    if (!shifting && start !== trip.start_date) changes.start_date = start;
    if (end !== (shifting ? addDays(trip.end_date, delta) : trip.end_date)) changes.end_date = end;
    if (place.trim() !== trip.place) changes.place = place.trim().slice(0, 200);
    const iconChanged = icon !== tripIconId(trip.settings);
    if (Object.keys(changes).length === 0 && !iconChanged && !shifting) { setMsg({ tab: "edit", text: t("沒有改動") }); return; }
    setBusy(true); setMsg(null);
    let moved = 0;
    if (shifting) {
      // 先整份搬到新日期（行程的開始、結束也一起移），其他改動再照平常的存
      const { data: n, error: e1 } = await supabase.rpc("shift_trip", { p_trip: trip.id, p_start: start });
      if (e1) return fail("edit", t(e1.message));
      moved = Number(n) || 0;
    }
    if (iconChanged) {
      // the picture lives inside `settings` next to other things: read the row again and change only this key
      const { data: fresh, error: e0 } = await supabase.from("trips").select("settings").eq("id", trip.id).single();
      if (e0) return fail("edit", t(e0.message));
      changes.settings = { ...((fresh?.settings as Record<string, unknown> | null) ?? {}), icon };
    }
    if (Object.keys(changes).length) {
      const { data, error } = await supabase.from("trips").update(changes).eq("id", trip.id).select("id");
      if (error) { if (shifting) await refreshMemberships(); return fail("edit", t(error.message)); }
      if (!data?.length) return fail("edit", t("沒有存到：你可能已經不是管理員了"));
    }
    // dates extended → add the missing empty days
    let added = 0;
    if (datesChanged) {
      try {
        const { data: have } = await supabase.from("days").select("date_id").eq("trip_id", trip.id).is("fam", null);
        added = await fillTripDays(trip.id, start, end, place, (have ?? []).map((d) => String(d.date_id)));
      } catch { /* the days can be added later from the date strip */ }
    }
    await refreshMemberships();
    const parts = [t("已儲存")];
    if (moved) parts.push(t("{n} 個排好的日子移到新日期", { n: moved }));
    if (added) parts.push(t("補了 {n} 個空白日子", { n: added }));
    setMsg({ tab: "edit", text: parts.join(t("，")) });
    setBusy(false);
  };

  const copy = async () => {
    if (!supabase) return;
    setBusy(true); setMsg(null);
    const { error } = await supabase.rpc("copy_trip", { p_trip: trip.id, p_name: copyName.trim(), p_start: copyStart });
    if (error) return fail("copy", t(error.message));
    await refreshMemberships();
    setBusy(false);
    onClose();
  };

  const destroy = async () => {
    if (!supabase || confirmName.trim() !== trip.name) return;
    setBusy(true); setMsg(null);
    // the pictures on the info pages are public files: remove them first (afterwards nobody has the right to)
    await removeTripImages(trip.id);
    const { data, error } = await supabase.from("trips").delete().eq("id", trip.id).select("id");
    if (error) return fail("delete", t(error.message));
    if (!data?.length) return fail("delete", t("沒有刪掉：你可能已經不是管理員了"));
    await refreshMemberships();
    setBusy(false);
    onClose();
  };

  const length = daysBetween(trip.start_date, trip.end_date) + 1;
  const tabs: { id: Tab; icon: "rename" | "copy" | "trash"; label: string }[] = [
    { id: "edit", icon: "rename", label: t("編輯") },
    { id: "copy", icon: "copy", label: t("複製") },
    { id: "delete", icon: "trash", label: t("刪除") },
  ];
  const note = (tb: Tab) => msg?.tab === tb && <p className={msg.bad ? "err" : "note"} role="status">{msg.text}</p>;

  return (
    <>
      <div className="scrim" onClick={() => !busy && onClose()} />
      <aside className="sheet tripmanage" role="dialog" aria-modal="true" aria-labelledby="tm-title">
        <header>
          <div className="hd">
            <div className="st">{t("管理行程")}</div>
            <h3 id="tm-title">{trip.name}</h3>
          </div>
          <button type="button" className="x" onClick={onClose} disabled={busy} aria-label={t("關閉")}>×</button>
        </header>
        <div className="body">
          <div className="tmtabs" role="tablist">
            {tabs.map((x) => (
              <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} className={tab === x.id ? "on" : undefined} onClick={() => setTab(x.id)} disabled={busy}>
                <MenuIcon name={x.icon} size={20} />{x.label}
              </button>
            ))}
          </div>

          {tab === "edit" && (
            <div className="tmpane">
              <div className="formgrid">
                <label className="wide">{t("行程名稱")}<input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
                <label className="wide">{t("主要城市")}<PlaceInput tripId={trip.id} kind="city" withCountry value={place} onChange={setPlace} placeholder={t("打幾個字找城市，例：東京")} /></label>
                <label>{t("開始日期")}<input type="date" value={start} onChange={(e) => pickStart(e.target.value)} /></label>
                <label>{t("結束日期")}<input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></label>
              </div>
              {delta !== 0 && (
                <div className="tmmove">
                  <label className="check">
                    <input type="checkbox" checked={move} onChange={(e) => { setMove(e.target.checked); if (e.target.checked) setEnd(addDays(trip.end_date, delta)); }} />
                    <span>{delta > 0 ? t("已經排好的日子一起往後移 {n} 天", { n: delta }) : t("已經排好的日子一起往前移 {n} 天", { n: -delta })}</span>
                  </label>
                  <p className="note">{move
                    ? t("整份行程搬到新日期，每一天的內容不變。成員、待辦和聊天紀錄都留著。")
                    : t("不移：排好的日子留在原本的日期，新日期只會補上空白的日子。")}</p>
                </div>
              )}
              <p className="note">{t("延長日期時，多出來的日子會自動補上空白的「大家一起」版本。")}</p>
              <fieldset className="iconpick">
                <legend>{t("行程圖案")}</legend>
                <div className="icongrid">
                  {TRIP_ICONS.map((i) => (
                    <label key={i.id} className={i.id === icon ? "on" : undefined}>
                      <input type="radio" name="tm-icon" value={i.id} checked={i.id === icon} onChange={() => setIcon(i.id)} />
                      <TripIcon id={i.id} size={48} />
                      <span>{i.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="actions">
                <button type="button" className="btn primary" onClick={save} disabled={busy || !name.trim() || !start || !end || end < start}>{busy ? t("儲存中…") : t("儲存")}</button>
              </div>
              {note("edit")}
              <p className="note">{t("時區、家庭和成員要進行程的「管理」裡改。")}</p>
            </div>
          )}

          {tab === "copy" && (
            <div className="tmpane">
              <p className="note">{t("把這個行程整份複製成一個新的。會複製每一天的行程、各家、這趟誰會去、待辦（全部變回未完成）、聯絡資料和資訊頁。成員、邀請和聊天紀錄不會複製，新行程只有你一個人，你是管理員。")}</p>
              <div className="formgrid">
                <label className="wide">{t("新行程的名稱")}<input value={copyName} maxLength={80} onChange={(e) => setCopyName(e.target.value)} /></label>
                <label className="wide">{t("新行程的開始日期")}<input type="date" value={copyStart} onChange={(e) => setCopyStart(e.target.value)} /></label>
              </div>
              {copyStart && <p className="note">{copyStart === trip.start_date
                ? t("日期跟原本一樣。改開始日期，每一天會跟著移。")
                : t("每一天會跟著移：新行程是 {a} 到 {b}，一樣 {n} 天。", { a: copyStart, b: addDays(copyStart, length - 1), n: length })}</p>}
              <div className="actions">
                <button type="button" className="btn primary" onClick={copy} disabled={busy || !copyName.trim() || !copyStart}>{busy ? t("複製中…") : t("複製行程")}</button>
              </div>
              {note("copy")}
            </div>
          )}

          {tab === "delete" && (
            <div className="tmpane">
              <p className="note">{t("所有人的行程、待辦、聯絡資料、上傳和聊天紀錄都會刪掉，無法復原。輸入行程名稱「{name}」確認。", { name: trip.name })}</p>
              <div className="formgrid">
                <label className="wide">{t("行程名稱")}<input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={trip.name} autoCapitalize="none" autoCorrect="off" /></label>
              </div>
              <div className="actions">
                <button type="button" className="btn danger" onClick={destroy} disabled={busy || confirmName.trim() !== trip.name}>{busy ? t("刪除中…") : t("刪除行程")}</button>
              </div>
              {note("delete")}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
