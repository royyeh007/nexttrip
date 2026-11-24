import { useState } from "react";
import { addDays, canEdit, dateOf } from "../data";
import type { Family } from "../data";
import { supabase } from "../supabase";
import { useTrip } from "../trip";
import { t } from "../i18n";

const CITIES = ["東京", "長野", "輕井澤", "草津", "成田", "橫濱", "鎌倉", "箱根", "河口湖", "日光", "京都", "大阪", "名古屋", "福岡", "札幌", "沖繩", "首爾", "台北", "其他"];

/** Small form to add a date for this family (e.g. an earlier arrival or later departure). */
export function AddDay({ family, onDone }: { family: Family; onDone: (dateId?: string) => void }) {
  const { trip, current, member, reload } = useTrip();
  const min = current ? addDays(current.start_date, -14) : "";
  const max = current ? addDays(current.end_date, 14) : "";
  const [date, setDate] = useState(current?.start_date ?? "");
  const [city, setCity] = useState(trip.days[0]?.city ?? "");
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
        <label>{t("城市")}
          <select value={CITIES.includes(city) ? city : "其他"} onChange={(e) => setCity(e.target.value === "其他" ? "" : e.target.value)}>
            {CITIES.map((c) => <option key={c} value={c}>{c === "其他" ? t("其他") : c}</option>)}
          </select>
        </label>
        {!CITIES.includes(city) && <label>{t("城市名稱")}<input value={city} onChange={(e) => setCity(e.target.value)} placeholder={t("例：大阪")} /></label>}
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
