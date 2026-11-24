import { useState } from "react";
import { daysFor, hotelFor } from "../data";
import type { Day, Stop } from "../data";
import type { LinkedLeg } from "../maps";
import { useTrip } from "../trip";
import { useScrollEdges } from "../useScrollEdges";
import { Timeline } from "./DayView";
import { t, wk } from "../i18n";

/** One date, every family side by side: each column is that family's effective version (own fork or the shared one). */
export function AllFamiliesDay({ dateId, onOpen }: { dateId: string; onOpen: (day: Day, s: Stop, arrive?: LinkedLeg) => void }) {
  const { trip } = useTrip();
  // families that use the same row that day (everyone's version, or a version a few families share) are one column, not the same thing repeated
  const cols: { families: typeof trip.families; day: Day | null }[] = [];
  for (const f of trip.families) {
    const day = daysFor(trip.days, f.id).find((d) => d.id === dateId) ?? null;
    const same = day ? cols.find((c) => c.day && (c.day.rowId ? c.day.rowId === day.rowId : c.day === day)) : undefined;
    if (same) same.families.push(f); else cols.push({ families: [f], day });
  }
  const names = (fs: typeof trip.families) => fs.map((f) => f.label).join("＋");
  const any = cols.find((c) => c.day)?.day;
  const { ref, edge, update, scrollBy } = useScrollEdges<HTMLDivElement>(dateId);
  const [active, setActive] = useState(0);

  // which column is (mostly) on screen → highlighted tab
  const onScroll = () => {
    update();
    const el = ref.current;
    if (!el) return;
    const kids = Array.from(el.children) as HTMLElement[];
    const x = el.scrollLeft + 24;
    let i = 0;
    kids.forEach((k, n) => { if (k.offsetLeft <= x) i = n; });
    setActive(i);
  };
  const jump = (i: number) => {
    const el = ref.current;
    const col = el?.children[i] as HTMLElement | undefined;
    if (el && col) el.scrollTo({ left: col.offsetLeft - el.offsetLeft, behavior: "smooth" });
  };

  return (
    <>
      <section className="dayhead">
        <div className="meta"><span>{any ? t("{d}（{w}）", { d: any.d, w: wk(any.w) }) : dateId}</span><span className="hotel">{t("所有家的這一天")}</span></div>
        <h2>{t("{n} 家同一天", { n: trip.families.length })}</h2>
      </section>
      <div className="famtabs" role="tablist" aria-label={t("跳到哪一家")}>
        {cols.map((c, i) => (
          <button key={c.families[0].id} type="button" role="tab" aria-selected={active === i} className={active === i ? "on" : ""} onClick={() => jump(i)}>{names(c.families)}</button>
        ))}
        <span className="hint">{t("← 左右滑動看每一家 →")}</span>
      </div>
      <div className={`allbar${edge.start ? " at-start" : ""}${edge.end ? " at-end" : ""}`}>
        <button type="button" className="scrollbtn left" onClick={() => scrollBy(-1, 0.5)} aria-label={t("往左")} tabIndex={-1}>‹</button>
        <div className="allgrid" ref={ref} onScroll={onScroll}>
          {cols.map(({ families, day }) => (
            <section className="famcol" key={families[0].id}>
              <header>
                <b>{names(families)}</b>
                {day ? <span className={`tag ${families.length > 1 ? "shared" : "own"}`}>{families.length === trip.families.length ? t("大家一起") : families.length > 1 ? t("一起的版本") : t("自己的版本")}</span> : <span className="tag none">{t("沒有行程")}</span>}
              </header>
              {day && (
                <>
                  <div className="sub">{day.title}{[...new Set(families.map((f) => hotelFor(day, f.id)).filter(Boolean))].length > 1
                    ? families.filter((f) => hotelFor(day, f.id)).map((f) => <span key={f.id}><br />{t("{label}住 {hotel}", { label: f.label, hotel: hotelFor(day, f.id) })}</span>)
                    : hotelFor(day, families[0].id) && <><br />{t("住 {hotel}", { hotel: hotelFor(day, families[0].id) })}</>}</div>
                  {day.items.length === 0
                    ? <p className="note">{t("還沒有內容")}</p>
                    : <Timeline day={day} onOpen={(s, a) => onOpen(day, s, a)} />}
                </>
              )}
              {!day && <p className="note">{t("{names}這天不在行程裡。", { names: names(families) })}</p>}
            </section>
          ))}
        </div>
        <button type="button" className="scrollbtn right" onClick={() => scrollBy(1, 0.5)} aria-label={t("往右")} tabIndex={-1}>›</button>
      </div>
    </>
  );
}
