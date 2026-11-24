import { useEffect, useRef, useState } from "react";
import { KIND } from "../labels";
import { MenuIcon } from "./Logo";
import { COUNTRY_NAME, payReminders, tx, NETWORK_NAME, RATE_KIND_NAME, STOP_KINDS, explain, pct } from "../cards";
import type { Pick, StopKind } from "../cards";
import { useNow } from "../now";
import { useTrip } from "../trip";
import { t, tr } from "../i18n";
import { useRecommend } from "./CardPick";
import { openCoupons, useCouponsOn } from "./Coupons";
import { Currency } from "./Currency";

const ORDER: StopKind[] = ["food", "shop", "hotel", "move", "sight"];
/** Visa / Mastercard / JCB are taken almost everywhere in Japan; AmEx, Discover and UnionPay often are not at small shops. */
const WIDELY = ["visa", "mastercard", "jcb"];
const widelyAccepted = (p: Pick) => p.card.network.length === 0 || p.card.network.some((n) => WIDELY.includes(n));

/** The pocket card: five big rows, one per kind of purchase, each with the card to pull out and a fallback when the shop refuses AmEx. */
function QuickPickSheet({ onClose }: { onClose: () => void }) {
  const r = useRecommend();
  const { current } = useTrip();
  const now = useNow();
  const closeRef = useRef<HTMLButtonElement>(null);
  const couponsOn = useCouponsOn();
  // today's promotions while travelling, the first day's otherwise
  const date = current && now.date >= current.start_date && now.date <= current.end_date ? now.date : current?.start_date;
  const closeFn = useRef(onClose);
  closeFn.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); closeFn.current(); } };
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("keydown", onKey, true); prev?.focus?.(); };
  }, []);
  const rows = ORDER.filter((k) => STOP_KINDS.includes(k)).map((k) => {
    const picks = r.pick(k, date);
    const top = picks[0];
    const fallback = top && !widelyAccepted(top) ? picks.find(widelyAccepted) : undefined;
    return { k, top, fallback };
  });
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="dialog quickpick" role="dialog" aria-modal="true" aria-labelledby="qp-title">
        <header>
          <div>
            <h3 id="qp-title">{t("捷徑")}</h3>
            <small>{r.enabled ? t("現在刷哪張：在{country}，依你勾的 {n} 張卡算。結帳幣別選當地貨幣。", { country: COUNTRY_NAME[r.dest], n: r.mine.length }) : t("站在店門口最常用的東西。")}</small>
          </div>
          <button ref={closeRef} type="button" className="x" aria-label={t("關閉")} onClick={onClose}>×</button>
        </header>
        <Currency />
        {couponsOn && <button type="button" className="btn big qpshort" onClick={() => { onClose(); openCoupons(); }}><MenuIcon name="coupon" size={20} />{t("藥妝優惠券")}<small>{t("出示條碼、找附近的店")}</small></button>}
        {!r.enabled && <p className="note qptip">{tr(r.on ? "到 <a>信用卡</a> 勾你有的卡，這裡就會列出吃飯、買東西、飯店、交通、門票各刷哪張。" : "到 <a>信用卡</a> 勾你有的卡並打開推薦開關，這裡就會列出吃飯、買東西、飯店、交通、門票各刷哪張。", { a: (c) => <a href="#cards" onClick={onClose}>{c}</a> })}</p>}
        {r.enabled && <ul className="qprows">
          {rows.map(({ k, top, fallback }) => top && (
            <li key={k} className={top.stale ? "stale" : ""}>
              <span className={`k ${k}`} aria-hidden="true">{KIND[k]}</span>
              <div className="qpmain">
                <span className="qpl">{RATE_KIND_NAME[k]}</span>
                <span className="qpcard">{top.card.name}</span>
                <span className="qpwhy">{explain(top)}{top.stale ? t("・優惠標示已到期，要確認") : ""}</span>
                {top.rate?.cond && <span className="qpcond">{tx(top.card, top.rate.cond)}</span>}
                {fallback && <span className="qpfb">{tr("不收 {nets} 就用 <b>{card}</b>（淨 {net}）", { b: (c) => <b>{c}</b> }, { nets: top.card.network.map((n) => NETWORK_NAME[n] ?? n).join(t("／")), card: fallback.card.short || fallback.card.name, net: pct(fallback.net) })}</span>}
              </div>
              <b className={`qpnet${top.net < 0 ? " neg" : ""}`}>{pct(top.net)}</b>
            </li>
          ))}
        </ul>}
        <ul className="qpreminds">
          {payReminders(r.dest).map((line) => <li key={line} className="qpremind"><MenuIcon name="warn" size={18} /><span>{line}</span></li>)}
        </ul>
        <div className="actions">
          <a className="btn" href="#cards" onClick={onClose}><MenuIcon name="cards" size={18} />{t("管理我的信用卡")}</a>
          <button type="button" className="btn primary" onClick={onClose}>{t("關閉")}</button>
        </div>
      </div>
    </>
  );
}

/** Bottom-left floating 「捷徑」 button (always there inside a trip): the currency converter, which card to pull out (when the person has cards and the switch is on) and, on a Japan trip, the drugstore coupons. */
export function QuickPickFab() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="cardfab" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} title={t("捷徑：匯率換算、現在刷哪張卡、藥妝優惠券")}><MenuIcon name="bolt" size={18} />{t("捷徑")}</button>
      {open && <QuickPickSheet onClose={() => setOpen(false)} />}
    </>
  );
}
