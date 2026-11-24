import { useEffect, useState } from "react";
import { MenuIcon } from "./Logo";
import { countryOf } from "../cards";
import { CURRENCIES, cachedRates, fmtMoney, fmtRate, homeCurrency, loadRates, localCurrency, quickAmounts, rateOf, setHomeCurrency, setLocalCurrency } from "../fx";
import type { Rates } from "../fx";
import { useTrip } from "../trip";
import { t } from "../i18n";

const parse = (s: string) => { const n = Number(s.replace(/[,\s]/g, "")); return Number.isFinite(n) && n >= 0 ? n : NaN; };

/** 匯率換算：上面是當地的貨幣，下面是自己國家的；兩邊都可以打字，另一邊跟著算。放在「捷徑」裡，站在店裡看價錢時用。 */
export function Currency() {
  const { current } = useTrip();
  const dest = countryOf(current?.place);
  const [local, setLocal] = useState(() => (current ? localCurrency(current.id, dest) : "JPY"));
  const [home, setHome] = useState(homeCurrency);
  const [rates, setRates] = useState<Rates | null>(cachedRates);
  const [loading, setLoading] = useState(true);
  // 使用者最後打字的是哪一邊、打了什麼；另一邊每次都用匯率算出來
  const [typed, setTyped] = useState<{ side: "local" | "home"; text: string }>({ side: "local", text: "" });
  useEffect(() => { let off = false; void loadRates().then((r) => { if (!off) { setRates(r); setLoading(false); } }); return () => { off = true; }; }, []);

  const rate = rateOf(rates, local, home);
  const n = parse(typed.text);
  const other = typed.text.trim() === "" || Number.isNaN(n) || rate == null ? "" : typed.side === "local" ? fmtMoney(n * rate, home) : fmtMoney(n / rate, local);
  const value = (side: "local" | "home") => (typed.side === side ? typed.text : other);
  const pickLocal = (c: string) => { setLocal(c); if (current) setLocalCurrency(current.id, c); };
  const pickHome = (c: string) => { setHome(c); setHomeCurrency(c); };
  const options = CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} {c.name}</option>);
  const old = rates ? Date.now() - rates.at > 36 * 3600_000 : false;
  return (
    <section className="fx" aria-labelledby="fx-title">
      <h4 id="fx-title"><MenuIcon name="coin" size={18} />{t("匯率換算")}</h4>
      <div className="fxrow">
        <select value={local} onChange={(e) => pickLocal(e.target.value)} aria-label={t("當地的貨幣")}>{options}</select>
        <input inputMode="decimal" value={value("local")} placeholder="0" aria-label={t("當地的金額")} onChange={(e) => setTyped({ side: "local", text: e.target.value })} onFocus={(e) => e.target.select()} />
      </div>
      <div className="fxrow">
        <select value={home} onChange={(e) => pickHome(e.target.value)} aria-label={t("自己的貨幣")}>{options}</select>
        <input inputMode="decimal" value={value("home")} placeholder="0" aria-label={t("換算後的金額")} onChange={(e) => setTyped({ side: "home", text: e.target.value })} onFocus={(e) => e.target.select()} />
      </div>
      <div className="fxquick">
        {quickAmounts(local).map((a) => <button key={a} type="button" onClick={() => setTyped({ side: "local", text: String(a) })}>{fmtMoney(a, local)}</button>)}
        {typed.text && <button type="button" className="clear" onClick={() => setTyped({ side: "local", text: "" })}>{t("清除")}</button>}
      </div>
      <small className={old ? "warn" : ""}>
        {rate != null && rates
          ? t(old ? "1 {from} = {rate} {to}。這是 {date} 的匯率（現在連不上網路，沒辦法更新）。刷卡實際用的匯率會略有不同。" : "1 {from} = {rate} {to}。{date} 的匯率，每天更新一次。刷卡實際用的匯率會略有不同。", { from: local, rate: fmtRate(rate), to: home, date: rates.date.replace(/-/g, "/") })
          : loading ? t("匯率載入中…") : t("現在拿不到匯率，連上網路後再打開一次。")}
      </small>
    </section>
  );
}
