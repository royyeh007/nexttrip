import { useEffect, useState } from "react";
import { useTrip } from "../trip";
import { isLeg } from "../data";
import type { Day, Leg, Mode, Status, Stop } from "../data";
import { MODE } from "../maps";
import { editDayItems, findStop } from "../dayEdit";

const STATUS: { v: Status | ""; l: string }[] = [{ v: "", l: "不用訂" }, { v: "ok", l: "已訂" }, { v: "todo", l: "要訂" }, { v: "tbd", l: "待定" }];

/**
 * 直接改兩站之間的交通：點交通那一段就打開（`leg` 有值），或點「＋ 加交通」（`leg` 是 null，加在 `next` 這一站前面）。
 * 原本只能繞去點後面那一站 → 編輯 → 捲到表單最下面，而且「已訂／要訂」改不了。
 */
export function LegSheet({ day, leg, next, onClose }: { day: Day; leg: Leg | null; next: Stop; onClose: () => void }) {
  const { current, reload } = useTrip();
  const [mode, setMode] = useState<Mode>(leg?.leg ?? "walk");
  const [txt, setTxt] = useState(leg?.txt ?? "");
  const [st, setSt] = useState<Status | "">(leg?.st ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** Where this leg is in the day as it is now (someone may have changed the day since the page loaded). */
  const locate = (items: Day["items"]) => (leg ? items.findIndex((it) => isLeg(it) && it.leg === leg.leg && it.txt === leg.txt) : -1);
  const write = async (change: "save" | "remove") => {
    if (!current || busy) return;
    if (change === "save" && !txt.trim()) { setErr("寫一下怎麼去，例如「計程車約 10 分鐘」"); return; }
    setBusy(true); setErr(null);
    const e = await editDayItems(current.id, day, (items) => {
      const out = [...items];
      if (leg) {
        const i = locate(items);
        if (i < 0) return null;
        if (change === "remove") out.splice(i, 1);
        else { const nextLeg: Leg = { leg: mode, txt: txt.trim() }; if (st) nextLeg.st = st; out[i] = nextLeg; }
      } else {
        const i = findStop(items, next);
        if (i < 0) return null;
        const added: Leg = { leg: mode, txt: txt.trim() }; if (st) added.st = st;
        out.splice(i, 0, added);
      }
      return out;
    });
    setBusy(false);
    if (e) { setErr(e === "這個地點已經被改掉了，重新打開再試" ? "這一天剛剛被改過，關掉再試一次" : e); return; }
    await reload();
    onClose();
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="sheet" role="dialog" aria-modal="true" aria-labelledby="leg-title">
        <header>
          <div className="hd">
            <div className="st">{day.d}（{day.w}）・到「{next.n.length > 14 ? next.n.slice(0, 14) + "…" : next.n}」</div>
            <h3 id="leg-title">{leg ? "改交通" : "加交通"}</h3>
          </div>
          <button className="x" type="button" aria-label="關閉" onClick={onClose}>×</button>
        </header>
        <div className="body">
          <div className="sec editor">
            <div className="formgrid">
              <label>怎麼去
                <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
                  {(Object.keys(MODE) as Mode[]).map((m) => <option key={m} value={m}>{MODE[m].label}</option>)}
                </select>
              </label>
              <label>要不要訂票
                <select value={st} onChange={(e) => setSt(e.target.value as Status | "")}>{STATUS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select>
              </label>
            </div>
            <label className="full">說明<input value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="例：丸ノ内線 新宿 → 銀座，約 17 分" autoFocus onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) write("save"); }} /></label>
            {mode === "flight" && <p className="note">航班照「長榮 BR192 7:15 → 羽田 T3 11:00」這樣寫，行程上會顯示成航班卡片並帶出即時狀態。</p>}
            {err && <p className="err">{err}</p>}
            <div className="actions">
              <button type="button" className="btn primary" onClick={() => write("save")} disabled={busy}>{busy ? "儲存中…" : leg ? "儲存" : "加入"}</button>
              <button type="button" className="btn" onClick={onClose} disabled={busy}>取消</button>
              {leg && <button type="button" className="btn danger" onClick={() => { if (confirm("拿掉這一段交通？")) write("remove"); }} disabled={busy}>拿掉這一段</button>}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
