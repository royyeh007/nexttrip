import { useState } from "react";
import { addDays, canEdit, dateOf } from "../data";
import type { Family } from "../data";
import { supabase } from "../supabase";
import { useTrip } from "../trip";
import { t } from "../i18n";
import { PlaceInput } from "./PlaceInput";


/** Small form to add a date for this family (e.g. an earlier arrival or later departure). */
export function AddDay({ family, onDone }: { family: Family; onDone: (dateId?: string) => void }) {
  const { trip, current, member, reload } = useTrip();
  const min = current ? addDays(current.start_date, -14) : "";
  const max = current ? addDays(current.end_date, 14) : "";
  const [date, setDate] = useState(current?.start_date ?? "");
  // 預設跟行程最後一天同一個城市（加的多半是前後多待幾天）；這趟出現過的城市列成按鈕，點一下就好
  const used = [...new Set(trip.days.map((d) => d.city).filter((c) => c && c !== t("待定") && c.length <= 10 && !/[、，,・]/.test(c)))].slice(0, 6);
  const [city, setCity] = useState(trip.days[trip.days.length - 1]?.city ?? "");
  const [title, setTitle] = useState("");
  const [hotel, setHotel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!supabase || !current) return;
    setErr(null);
    if (!date || date < min || date > max) { setErr(t("日期要在 {min} 到 {max} 之間（行程前後兩週內）", { min, max })); return; }
    if (trip.days.some((d) => d.id === date && d.fam?.includes(family.id))) { setErr(t("這天已經有{label}的行程了", { label: family.label })); return; }
    if (!canEdit([family.id], member)) { setErr(t("你現在看的是{label}，只能幫自己家加日子。先切回「看我們家」。", { label: family.label })); return; }
    setBusy(true);
    const { d, w } = dateOf(date);
    const { error } = await supabase.from("days").insert({ trip_id: current.id, date_id: date, fam: [family.id], d, w, city: city.trim() || t("待定"), title: title.trim() || `${family.label} ${d}`, hotel: hotel.trim(), items: [] });
    if (error) { setErr(t(error.message)); setBusy(false); return; }
    await reload();
    setBusy(false);
    onDone(date);
  };

  return (
    <div className="panel addday">
      <h3>{t("幫{label}加一天", { label: family.label })}</h3>
      <p className="note">{t("加了之後可以上傳表單／截圖，或點右下角「Trip醬」直接說那天要做什麼。")}</p>
      <div className="grid">
        <label>{t("日期")}<input type="date" value={date} min={min} max={max} onChange={(e) => setDate(e.target.value)} /></label>
        <label>{t("城市")}<PlaceInput tripId={current?.id ?? ""} kind="city" value={city} onChange={setCity} placeholder={t("打幾個字找城市")} />
          {used.length > 1 && <span className="chips">{used.map((c) => <button key={c} type="button" className="chip-btn" aria-pressed={c === city} onClick={() => setCity(c)}>{c}</button>)}</span>}
        </label>
        <label>{t("標題（可空）")}<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("例：提早到東京・迪士尼")} /></label>
        <label>{t("那晚住哪（可空）")}<input value={hotel} onChange={(e) => setHotel(e.target.value)} placeholder={t("例：Conrad Tokyo")} /></label>
      </div>
      <div className="actions">
        <button type="button" className="btn primary" onClick={submit} disabled={busy}>{busy ? t("加入中…") : t("加入這一天")}</button>
        <button type="button" className="btn" onClick={() => onDone()} disabled={busy}>{t("取消")}</button>
      </div>
      {err && <p className="err">{err}</p>}
    </div>
  );
}
