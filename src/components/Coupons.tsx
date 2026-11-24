import { useEffect, useRef, useState } from "react";
import { MenuIcon } from "./Logo";
import { COUPONS, distText, expired, loadBaked, locate, nearby, searchLink, supportsWebp, untilText, walkLink, webpOf } from "../coupons";
import type { Coupon, Here, Shop } from "../coupons";
import { countryOf } from "../cards";
import { useNow } from "../now";
import { useTrip } from "../trip";
import { lang, t, tr } from "../i18n";

/** Between the discount tiers (and after them): 「・」 in Chinese, " · " in English. The English tier texts are written with the same separator. */
const SEP = lang === "en" ? " · " : "・";

const EVENT = "jp-open-coupons";
/** Open the coupon list (no id) or one coupon's barcode picture straight away (id). */
export const openCoupons = (id?: string) => window.dispatchEvent(new CustomEvent<string | undefined>(EVENT, { detail: id }));

/** Coupons only make sense on a Japan trip. */
export function useCouponsOn(): boolean {
  const { current } = useTrip();
  return countryOf(current?.place ?? "") === "jp";
}

/**
 * Fetch the barcode pictures in the background so tapping one shows it at once, even with a weak signal later.
 * Only the small WebP versions (about 2 MB for all ten; the service worker then keeps them on the phone), and not at all
 * when the phone is in data-saver mode. Browsers without WebP load the JPEG only for the coupon that is opened.
 */
let warmed = false;
function warm() {
  if (warmed) return;
  warmed = true;
  void loadBaked();
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
  if (saveData) return;
  supportsWebp().then((ok) => {
    if (!ok) return;
    for (const c of COUPONS) { const src = webpOf(c); if (src) { const i = new Image(); i.decoding = "async"; i.src = src; } }
  });
}

type Near = { state: "idle" } | { state: "busy"; step: string } | { state: "error"; msg: string; here: Here | null } | { state: "done"; shops: Shop[]; radius: number; live: boolean; here: Here };

/** The list: "find drugstores near me" on top, then every coupon as a big button. Used inline on the info page and inside the dialog. */
export function CouponList() {
  const now = useNow();
  const [near, setNear] = useState<Near>({ state: "idle" });
  useEffect(warm, []);
  const find = async () => {
    let here: Here | null = null;
    try {
      setNear({ state: "busy", step: t("定位中…") });
      here = await locate();
      setNear({ state: "busy", step: t("找附近的藥妝店…") });
      const r = await nearby(here);
      setNear({ state: "done", ...r, here });
    } catch (e) {
      setNear({ state: "error", msg: e instanceof Error ? t(e.message) : t("出錯了"), here });
    }
  };
  const usable = COUPONS.filter((c) => !expired(c, now.date)), gone = COUPONS.filter((c) => expired(c, now.date));
  return (
    <div className="coupons">
      <div className="cpnear">
        <button type="button" className="btn primary big" onClick={find} disabled={near.state === "busy"}>{near.state === "busy" ? near.step : near.state === "done" ? <><MenuIcon name="pin" size={18} />{t("重新找附近的藥妝")}</> : <><MenuIcon name="pin" size={18} />{t("找附近的藥妝")}</>}</button>
        {near.state === "idle" && <p className="note">{t("用手機定位找走路到得了的店，直接配好優惠券。位置只在這支手機上用，不會存下來。")}</p>}
        {near.state === "error" && <p className="note warn">{near.msg} <a href={searchLink(near.here)} target="_blank" rel="noopener">{t("改用 Google 地圖找藥妝店 ›")}</a></p>}
        {near.state === "done" && (
          near.shops.length === 0
            ? <p className="note">{tr("附近 3 公里內沒有找到可以用券的藥妝店。<a>用 Google 地圖找 ›</a>", { a: (c) => <a href={searchLink(near.here)} target="_blank" rel="noopener">{c}</a> })}</p>
            : <>
              {!near.shops.some((s) => s.coupon) && <p className="note">{t("附近的店都沒有優惠券。")}</p>}
              {near.radius > 800 && near.shops.some((s) => s.coupon) && <p className="note">{t("800 公尺內沒有可以用券的店，以下是 3 公里內的。")}</p>}
              <ul className="cpshops">
                {near.shops.map((s) => (
                  <li key={s.key} className={s.coupon ? "" : "none"}>
                    <div className="cpmain">
                      <b>{s.coupon?.name ?? s.name}{s.branch ? ` ${s.branch}` : ""}</b>
                      <span className="cpsub">{distText(s.dist)}{SEP}{s.coupon ? s.coupon.tiers : t("{name}・沒有優惠券", { name: s.name })}</span>
                      {s.coupon && expired(s.coupon, now.date) && <span className="cpwarn"><MenuIcon name="warn" size={14} />{t("券已過期")}</span>}
                    </div>
                    <div className="cpact">
                      {s.coupon && <button type="button" className="btn primary" onClick={() => openCoupons(s.coupon!.id)}>{t("出示券")}</button>}
                      <a className="btn" href={walkLink(s)} target="_blank" rel="noopener" aria-label={t("走路到 {name}", { name: s.name })}>{t("走過去")}</a>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="note">{tr("店家來自 OpenStreetMap，可能漏店；分店有沒有免稅櫃台要進門看 TAX FREE。<a>Google 地圖找更多 ›</a>", { a: (c) => <a href={searchLink(near.here)} target="_blank" rel="noopener">{c}</a> })}</p>
            </>
        )}
      </div>
      <h4 className="cphead">{t("全部優惠券")}<small>{t("點一下直接顯示條碼")}</small></h4>
      <div className="cpgrid">
        {[...usable, ...gone].map((c) => (
          <button key={c.id} type="button" className={`cpcard${expired(c, now.date) ? " gone" : ""}`} onClick={() => openCoupons(c.id)}>
            <b>{c.name}</b>
            <span className="cpsign">{c.sign}</span>
            <span className="cptiers">{c.tiers.split(SEP).map((x, i) => <span key={i} className="nb">{i > 0 && SEP}{x}</span>)}</span>
            <span className="cpuntil">{expired(c, now.date) ? <><MenuIcon name="warn" size={14} />{t("已過期")}</> : untilText(c)}{c.img ? "" : t("・要連網")}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** One coupon, full screen on white so the till scanner reads it: the picture itself, or a big button for the two chains that only take a live web page. */
function CouponView({ coupon, onClose }: { coupon: Coupon; onClose: () => void }) {
  const now = useNow();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  return (
    <div className="cpview" role="dialog" aria-modal="true" aria-label={t("{name} 優惠券", { name: coupon.name })}>
      <header>
        <div>
          <h3>{coupon.name}<small>{coupon.sign}</small></h3>
          <p>{coupon.tiers}{SEP}{expired(coupon, now.date) ? <><MenuIcon name="warn" size={14} />{t("券上的期限已過，問店員還收不收")}</> : untilText(coupon)}</p>
        </div>
        <button ref={closeRef} type="button" className="x" aria-label={t("關閉")} onClick={onClose}>×</button>
      </header>
      <div className="cpbody">
        <p className="cptip">{tr("結帳<b>前</b>連同護照一起給店員，一筆只能用一張。{note}", { b: (c) => <b>{c}</b> }, { note: coupon.note })}</p>
        {coupon.img
          ? <picture><source srcSet={webpOf(coupon)} type="image/webp" /><img src={coupon.img} alt={t("{name} 優惠券條碼：{tiers}", { name: coupon.name, tiers: coupon.tiers })} /></picture>
          : <a className="btn primary big" href={coupon.url} target="_blank" rel="noopener">{t("開啟 {name} 的優惠券網頁 ›", { name: coupon.name })}</a>}
        {coupon.img && <p className="note">{t("掃不到就把螢幕亮度調到最高，用兩指放大那一級的條碼。")}</p>}
      </div>
    </div>
  );
}

/** Mounted once in the app: shows the list dialog and/or one coupon when something calls openCoupons(). */
export function CouponHost() {
  const [list, setList] = useState(false);
  const [coupon, setCoupon] = useState<Coupon | null>(null);
  const listClose = useRef<HTMLButtonElement>(null);
  // the list dialog takes the keyboard focus when it opens and gives it back to whatever opened it
  useEffect(() => {
    if (!list) return;
    const prev = document.activeElement as HTMLElement | null;
    listClose.current?.focus();
    return () => { prev?.focus?.(); };
  }, [list]);
  useEffect(() => {
    const on = (e: Event) => {
      const id = (e as CustomEvent<string | undefined>).detail;
      const c = id ? COUPONS.find((x) => x.id === id) : undefined;
      if (c) setCoupon(c); else setList(true);
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  const active = list || !!coupon;
  useEffect(() => {
    if (!active) return;
    // Esc closes the coupon first, then the list under it
    const onKey = (e: KeyboardEvent) => { if (e.key !== "Escape") return; e.stopPropagation(); if (coupon) setCoupon(null); else setList(false); };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [active, coupon]);
  return (
    <>
      {/* the list stays mounted under an open coupon so the nearby results are still there on the way back */}
      {list && (
        <>
          <div className="scrim" onClick={() => setList(false)} />
          <div className="dialog quickpick cpdialog" role="dialog" aria-modal="true" aria-labelledby="cp-title">
            <header>
              <div><h3 id="cp-title">{t("藥妝優惠券")}</h3><small>{t("免稅之外再折 3～8%，結帳前出示。")}</small></div>
              <button ref={listClose} type="button" className="x" aria-label={t("關閉")} onClick={() => setList(false)}>×</button>
            </header>
            <CouponList />
          </div>
        </>
      )}
      {coupon && <CouponView coupon={coupon} onClose={() => setCoupon(null)} />}
    </>
  );
}
