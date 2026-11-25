import { useEffect, useMemo, useRef, useState } from "react";
import { DateField } from "./Pickers";
import { MenuIcon } from "./Logo";
import { COUNTRY_NAME, COUNTRY_ORDER, NETWORKS, NETWORK_NAME, RATE_KIND_NAME, STOP_KINDS, WHERE_NAME, currencyOf, explain, explainShort, localTips, tx, isAbroad, pct, rank, setCardsOn } from "../cards";
import type { Card, CardRate, Country, RateKind, RateWhere } from "../cards";
import { isViewer } from "../data";
import { invoke, supabase } from "../supabase";
import { useTrip } from "../trip";
import { useRecommend } from "./CardPick";
import { list, t, tr } from "../i18n";

const newId = () => "c-" + (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10));
const fmtDate = (s: string | null | undefined) => (s ? s.replace(/-/g, "/") : "");
const COUNTRIES = COUNTRY_ORDER;
/** The rates of this card that matter at the destination, bonus categories only (for the catalog rows). */
const bonusesAt = (c: Card, dest: Country) => {
  const abroad = isAbroad(c, dest);
  return (Array.isArray(c.rates) ? c.rates : []).filter((x) => x && x.kind !== "all" && (x.where === "home" ? !abroad : x.where === "overseas" ? abroad : x.where === dest));
};

// ---------- the editor for one catalog entry ----------
interface RateDraft { where: RateWhere; kind: RateKind; rate: string; note: string; until: string; cond: string }
interface Draft { id: string; name: string; short: string; bank: string; country: Country; network: string[]; fx_fee: string; rates: RateDraft[]; cap: string; conditions: string; source: string; checked_at: string }
const emptyRate = (where: RateWhere): RateDraft => ({ where, kind: "all", rate: "", note: "", until: "", cond: "" });
const draftOf = (c: Card | null, name = "", country: Country = "us"): Draft => ({
  id: c?.id ?? newId(), name: c?.name ?? name, short: c?.short ?? "", bank: c?.bank ?? "", country: c?.country ?? country, network: c?.network ?? [], fx_fee: String(c?.fx_fee ?? (country === "tw" ? 1.5 : 0)),
  rates: c ? c.rates.map((r) => ({ where: r.where, kind: r.kind, rate: String(r.rate), note: r.note ?? "", until: r.until ?? "", cond: r.cond ?? "" })) : [emptyRate("overseas"), { ...emptyRate("overseas"), kind: "food" }, { ...emptyRate("overseas"), kind: "hotel" }],
  cap: c?.cap ?? "", conditions: c?.conditions ?? "", source: c?.source ?? "", checked_at: c?.checked_at ?? new Date().toISOString().slice(0, 10),
});
interface LookupResult { card: Partial<Card> & { note?: string }; remaining: number }
/** Only a real web address becomes a link (the catalog is written by many people and by the AI lookup). */
const isHttp = (s: string | null | undefined) => !!s && /^https?:\/\/\S+$/i.test(s.trim());

function CardEditor({ card, name, country, onDone, onCancel }: { card: Card | null; name?: string; country?: Country; onDone: (id: string) => void; onCancel: () => void }) {
  const { member, current, reloadCards } = useTrip();
  const [d, setD] = useState<Draft>(() => draftOf(card, name, country));
  const [busy, setBusy] = useState<"save" | "ai" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const lookupAbort = useRef<AbortController | null>(null);
  // The form sits at the top of the page; 「改資料」 can be pressed far down in the catalog. Bring the form into view.
  useEffect(() => { boxRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }); boxRef.current?.querySelector("input")?.focus({ preventScroll: true }); }, []);
  const up = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const upRate = (i: number, patch: Partial<RateDraft>) => setD((x) => ({ ...x, rates: x.rates.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));

  /** Sonnet looks the card up online (issuer page + card sites) and fills the form; the person checks it before saving. */
  const lookup = async () => {
    if (!current || !d.name.trim()) { setErr(t("先填卡片名稱")); return; }
    const ac = new AbortController();
    lookupAbort.current = ac;
    setBusy("ai"); setErr(null); setAiNote(null);
    try {
      const res = await invoke<LookupResult>("card-lookup", { trip_id: current.id, name: d.name.trim(), country: d.country }, { timeoutMs: 140_000, signal: ac.signal });
      const c = res.card;
      setD((x) => ({
        ...x,
        name: c.name || x.name, short: c.short ?? x.short, bank: c.bank ?? x.bank, country: c.country ?? x.country, network: c.network ?? x.network,
        fx_fee: c.fx_fee != null ? String(c.fx_fee) : x.fx_fee,
        rates: c.rates?.length ? c.rates.map((r) => ({ where: r.where, kind: r.kind, rate: String(r.rate), note: r.note ?? "", until: r.until ?? "", cond: r.cond ?? "" })) : x.rates,
        cap: c.cap ?? x.cap, conditions: c.conditions ?? x.conditions, source: isHttp(c.source) ? c.source!.trim() : x.source, checked_at: new Date().toISOString().slice(0, 10),
      }));
      setAiNote((c.note ? c.note + " " : "") + t("請對照銀行公告看一下再儲存。（今天還可以查 {n} 次）", { n: res.remaining }));
    } catch (e) { if (!ac.signal.aborted) setErr(t(e instanceof Error ? e.message : String(e))); }
    finally { setBusy(null); lookupAbort.current = null; }
  };

  const save = async () => {
    if (!supabase || !member) return;
    if (!d.name.trim()) { setErr(t("卡片名稱不能空")); return; }
    const fee = Number(d.fx_fee);
    if (isNaN(fee) || fee < 0 || fee > 10) { setErr(t("手續費請填 0～10 之間的數字（%）")); return; }
    const rates: CardRate[] = [];
    for (const r of d.rates) {
      if (r.rate.trim() === "") continue;
      const n = Number(r.rate);
      if (isNaN(n) || n < 0 || n > 50) { setErr(t("回饋請填 0～50 之間的數字（%）")); return; }
      if (r.until && !/^\d{4}-\d{2}-\d{2}$/.test(r.until)) { setErr(t("到期日請用 YYYY-MM-DD")); return; }
      const row: CardRate = { where: r.where, kind: r.kind, rate: n };
      if (r.note.trim()) row.note = r.note.trim();
      if (r.until) row.until = r.until;
      if (r.cond.trim()) row.cond = r.cond.trim();
      rates.push(row);
    }
    const source = d.source.trim();
    if (source && !isHttp(source)) { setErr(t("來源網址要以 https:// 開頭（或留白）")); return; }
    setBusy("save"); setErr(null);
    // shown to everyone in every trip as 「○○ 改過」: a display name, never the e-mail address
    const who = member.name?.trim() || t("成員");
    const row = { id: d.id, name: d.name.trim(), short: d.short.trim() || d.name.trim().slice(0, 8), bank: d.bank.trim(), country: d.country, network: d.network, fx_fee: fee, rates, cap: d.cap.trim(), conditions: d.conditions.trim(), source: d.source.trim(), checked_at: d.checked_at || null, updated_by: member.user_id, updated_by_name: who, updated_at: new Date().toISOString() };
    let error: { message: string } | null = null, saved = 1;
    if (card) {
      // only if the card is still the version this form opened with (someone else may have updated the rates meanwhile)
      let q = supabase.from("card_catalog").update(row).eq("id", d.id);
      if (card.updated_at) q = q.eq("updated_at", card.updated_at);
      const r = await q.select("id");
      error = r.error; saved = r.data?.length ?? 0;
    } else {
      const r = await supabase.from("card_catalog").insert({ ...row, created_by: member.user_id });
      error = r.error;
    }
    setBusy(null);
    if (error) { setErr(/row-level security|permission/i.test(error.message) ? t("沒有權限改卡片庫（觀察員只能勾自己有的卡）") : t(error.message)); return; }
    if (!saved) { setErr(t("沒有存進去：這張卡在你編輯的時候被別人改過（或刪掉）了，或你沒有權限。按取消後重新打開「改資料」再改一次。")); await reloadCards(); return; }
    await reloadCards();
    // 英文對照：存好之後在背景請 AI 把新的中文句子翻成英文（不擋畫面；失敗也沒關係，英文畫面先顯示中文）
    if (current) void invoke("translate-card", { trip_id: current.id, card_id: d.id }).then(() => reloadCards()).catch(() => { /* 沒翻到：英文畫面先顯示中文 */ });
    onDone(d.id);
  };

  return (
    <div className="gcard cardedit" ref={boxRef}>
      <h3>{card ? t("編輯「{name}」", { name: card.name }) : t("新增一張卡到卡片庫")}</h3>
      <p className="note">{t("回饋填「在那裡買那類東西可以拿到的總回饋 %」（已含基本回饋；點數卡換成約略的 %，例：3x 點數以 1.5¢ 計 ≈ 4.5%）。「出國」＝發卡國以外都適用。沒把握的欄位留白就好，或先按「幫我查這張卡」。")}</p>
      <div className="formgrid">
        <label>{t("卡片名稱")}<input value={d.name} onChange={(e) => up("name", e.target.value)} placeholder={t("例：Chase Sapphire Preferred")} maxLength={80} /></label>
        <label>{t("短名（標籤用）")}<input value={d.short} onChange={(e) => up("short", e.target.value)} placeholder={t("例：CSP")} maxLength={10} /></label>
        <label>{t("銀行")}<input value={d.bank} onChange={(e) => up("bank", e.target.value)} placeholder={t("例：Chase")} maxLength={60} /></label>
        <label>{t("發卡國")}<select value={d.country} onChange={(e) => up("country", e.target.value as Country)}>{COUNTRIES.map((c) => <option key={c} value={c}>{COUNTRY_NAME[c]}</option>)}</select></label>
        <label>{t("海外交易手續費 %")}<input value={d.fx_fee} onChange={(e) => up("fx_fee", e.target.value)} inputMode="decimal" placeholder={t("美國卡常見 0 或 3；英國 0 或 2.99；台灣 1.5")} /></label>
      </div>
      <div className="netpick" role="group" aria-label={t("發卡組織")}>
        <span className="lbl">{t("組織")}</span>
        {NETWORKS.map((n) => (
          <label key={n} className={`pill${d.network.includes(n) ? " on" : ""}`}>
            <input type="checkbox" checked={d.network.includes(n)} onChange={(e) => up("network", e.target.checked ? [...d.network, n] : d.network.filter((x) => x !== n))} />{NETWORK_NAME[n]}
          </label>
        ))}
      </div>
      <div className="rates">
        <div className="rhead"><span>{t("在哪裡")}</span><span>{t("買什麼")}</span><span>{t("回饋 %")}</span><span>{t("說明")}</span><span>{t("到期")}</span><span>{t("條件")}</span><span /></div>
        {d.rates.map((r, i) => (
          <div className="rrow" key={i}>
            <select value={r.where} onChange={(e) => upRate(i, { where: e.target.value as RateWhere })} aria-label={t("在哪裡")}>{(Object.keys(WHERE_NAME) as RateWhere[]).map((w) => <option key={w} value={w}>{WHERE_NAME[w]}</option>)}</select>
            <select value={r.kind} onChange={(e) => upRate(i, { kind: e.target.value as RateKind })} aria-label={t("買什麼")}>{(Object.keys(RATE_KIND_NAME) as RateKind[]).map((k) => <option key={k} value={k}>{RATE_KIND_NAME[k]}</option>)}</select>
            <input value={r.rate} onChange={(e) => upRate(i, { rate: e.target.value })} inputMode="decimal" placeholder="3" aria-label={t("回饋 %")} />
            <input value={r.note} onChange={(e) => upRate(i, { note: e.target.value })} placeholder={t("例：3x 點數以 1.5¢ 計")} aria-label={t("說明")} />
            <DateField value={r.until} onChange={(v) => upRate(i, { until: v })} hint={t("到期日")} />
            <input value={r.cond} onChange={(e) => upRate(i, { cond: e.target.value })} placeholder={t("要登錄、上限…")} aria-label={t("條件")} />
            <button type="button" className="link" onClick={() => setD((x) => ({ ...x, rates: x.rates.filter((_, j) => j !== i) }))} aria-label={t("刪這一列")}>✕</button>
          </div>
        ))}
        <button type="button" className="link" onClick={() => setD((x) => ({ ...x, rates: [...x.rates, emptyRate("overseas")] }))}>{t("＋ 加一列回饋")}</button>
      </div>
      <div className="formgrid">
        <label>{t("回饋上限")}<input value={d.cap} onChange={(e) => up("cap", e.target.value)} placeholder={t("例：無上限")} maxLength={300} /></label>
        <label>{t("重要條件")}<input value={d.conditions} onChange={(e) => up("conditions", e.target.value)} placeholder={t("例：年費 $95；超市加碼只限美國境內")} maxLength={600} /></label>
        <label>{t("來源網址")}<input value={d.source} onChange={(e) => up("source", e.target.value)} placeholder="https://…" inputMode="url" maxLength={500} /></label>
        <label>{t("查證日期")}<DateField value={d.checked_at} onChange={(v) => up("checked_at", v)} /></label>
      </div>
      <div className="actions">
        <button type="button" className="btn primary" onClick={save} disabled={!!busy}>{busy === "save" ? t("儲存中…") : t("儲存")}</button>
        {busy === "ai"
          ? <button type="button" className="btn" onClick={() => lookupAbort.current?.abort()}>{t("取消查詢")}</button>
          : <button type="button" className="btn" onClick={onCancel} disabled={busy === "save"}>{t("取消")}</button>}
        {!isViewer(member) && <button type="button" className="btn" onClick={lookup} disabled={!!busy} title={t("AI 上網查這張卡目前的海外手續費和回饋，填進表單給你核對")}>{busy === "ai" ? t("查詢中…（約 30 秒）") : <><MenuIcon name="spark" size={16} />{t("幫我查這張卡")}</>}</button>}
      </div>
      {aiNote && <p className="note">{aiNote}</p>}
      {err && <p className="err">{err}</p>}
    </div>
  );
}

/** One card in a list: name, country, network, fee, what it earns at the destination, the maintenance line. */
function CardRow({ c, dest, date, mine, actions }: { c: Card; dest: Country; date?: string; mine: boolean; actions: React.ReactNode }) {
  const best = rank([c], "all", dest, date)[0];
  const bonuses = bonusesAt(c, dest);
  const abroad = isAbroad(c, dest);
  return (
    <li>
      <div className="cmain">
        <span><b>{c.name}</b><span className={`tag cc ${c.country}`}>{COUNTRY_NAME[c.country] ?? c.country}</span>{mine && <span className="tag shared">{t("我有")}</span>}</span>
        <span className="cmeta">{c.bank}{c.network.length > 0 && t(" ・ {nets}", { nets: c.network.map((n) => NETWORK_NAME[n] ?? n).join(t("／")) })}{abroad ? t(" ・ 海外手續費 {fee}", { fee: pct(c.fx_fee) }) : t(" ・ 在發卡國內，不收海外手續費")}</span>
        <span className="cwhy">{t("{country}一般消費：{why}", { country: COUNTRY_NAME[dest], why: explain(best) })}{best.stale ? t("（優惠標示已到期，要確認）") : ""}</span>
        {bonuses.length > 0 && <span className="cwhy">{list(bonuses.map((x) => `${RATE_KIND_NAME[x.kind]} ${pct(x.rate)}${x.note ? t("（{note}）", { note: tx(c, x.note) }) : ""}`))}</span>}
        {(c.conditions || c.cap) && <span className="cwhy muted">{[c.conditions, c.cap].filter(Boolean).map((x) => tx(c, x)).join(" ")}</span>}
        <span className="cmeta">{t("查證 {date}", { date: fmtDate(c.checked_at) })}{c.updated_by_name ? t(" ・ {name} 改過", { name: c.updated_by_name }) : ""}{isHttp(c.source) && <>{t(" ・ ")}<a href={c.source.trim()} target="_blank" rel="noopener noreferrer">{t("來源 ↗")}</a></>}</span>
      </div>
      <div className="cacts">{actions}</div>
    </li>
  );
}

// ---------- the page ----------
export function CardsView() {
  const { member, current, cards, reloadCards, memberships } = useTrip();
  const r = useRecommend();
  // same rules as the database: writing the shared catalog needs member/admin in at least one trip; deleting needs the creator or an admin of any trip
  const canWrite = memberships.some((m) => m.role !== "viewer") && !isViewer(member);
  const [opening, setOpening] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<{ card: Card | null; name?: string; addToMine?: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Country | "all">("all");
  const dest = r.dest;
  const destName = COUNTRY_NAME[dest];
  const date0 = current?.start_date, date1 = current?.end_date;

  const mineSet = useMemo(() => new Set(cards.mine), [cards.mine]);
  const sorted = useMemo(() => [...cards.catalog].sort((a, b) => COUNTRY_ORDER.indexOf(a.country) - COUNTRY_ORDER.indexOf(b.country) || a.bank.localeCompare(b.bank) || a.name.localeCompare(b.name)), [cards.catalog]);
  const counts = useMemo(() => { const m: Partial<Record<Country, number>> = {}; for (const c of cards.catalog) m[c.country] = (m[c.country] ?? 0) + 1; return m; }, [cards.catalog]);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return sorted.filter((c) => !mineSet.has(c.id) && `${c.name} ${c.short} ${c.bank} ${COUNTRY_NAME[c.country]}`.toLowerCase().includes(s)).slice(0, 8);
  }, [q, sorted, mineSet]);

  const add = async (id: string) => {
    if (!supabase || !member) return;
    setBusy(id); setErr(null);
    const { error } = await supabase.from("my_cards").insert({ user_id: member.user_id, card_id: id });
    setBusy(null);
    if (error && !/duplicate/i.test(error.message)) { setErr(t(error.message)); return; }
    setQ("");
    await reloadCards();
  };
  const remove = async (id: string) => {
    if (!supabase || !member) return;
    setBusy(id); setErr(null);
    const { error } = await supabase.from("my_cards").delete().eq("user_id", member.user_id).eq("card_id", id);
    setBusy(null);
    if (error) { setErr(t(error.message)); return; }
    await reloadCards();
  };
  const del = async (c: Card) => {
    if (!supabase || !confirm(t("把「{name}」從卡片庫刪掉？有勾這張卡的人也會一起失去它。", { name: c.name }))) return;
    setBusy(c.id); setErr(null);
    const { data, error } = await supabase.from("card_catalog").delete().eq("id", c.id).select("id");
    setBusy(null);
    if (error) { setErr(t(error.message)); return; }
    if (!data?.length) setErr(t("沒有刪掉：只有建立這張卡的人或管理員可以刪"));
    await reloadCards();
  };
  const canDelete = (c: Card) => !!member && canWrite && (c.created_by === member.user_id || memberships.some((m) => m.role === "admin"));
  // Open the form on the card as it is in the database now: the copy on screen was loaded when the page opened,
  // and saving an old copy would undo an update someone else made since.
  const edit = async (c: Card) => {
    if (!supabase || opening) return;
    setOpening(c.id); setErr(null);
    const { data, error } = await supabase.from("card_catalog").select("id, name, short, bank, country, network, fx_fee, rates, cap, conditions, source, checked_at, en, created_by, updated_by_name, updated_at").eq("id", c.id).maybeSingle();
    setOpening(null);
    if (error) { setErr(t("讀不到這張卡的最新資料（{why}），等網路好一點再改", { why: error.message })); return; }
    if (!data) { setErr(t("這張卡已經被刪掉了")); await reloadCards(); return; }
    setEditing({ card: { ...data, fx_fee: Number(data.fx_fee) || 0, rates: Array.isArray(data.rates) ? data.rates : [], network: Array.isArray(data.network) ? data.network : [] } as Card });
  };

  if (cards.ready && !cards.available) {
    return (
      <section className="dayhead">
        <h2>{t("信用卡")}</h2>
        <p className="note">{tr("資料庫還沒升級到有信用卡的版本（要跑 <code>make db-push</code>）。升級後這裡可以勾你有的卡，每一站會標出刷哪張最划算。", { code: (c) => <code>{c}</code> })}</p>
      </section>
    );
  }

  // the plan: for each kind of spending, the best of my cards (at the trip's first day); flag promos that end before the trip ends
  const plan = STOP_KINDS.map((k) => ({ k, picks: r.mine.length ? rank(r.mine, k, dest, date0) : [] }));
  const endsEarly = r.mine.length && date1 ? STOP_KINDS.some((k) => rank(r.mine, k, dest, date1)[0]?.stale) : false;

  return (
    <>
      <section className="dayhead">
        <h2>{t("信用卡")}</h2>
        <p className="note">{t("勾你有的卡（美國、英國、台灣的都可以），每一站就會標出在{country}刷哪張最划算：回饋最多、手續費最少（淨回饋 ＝ 回饋 − 海外交易手續費）。卡片庫是大家一起維護的，優惠會變，請以銀行公告為準。", { country: destName })}</p>
      </section>

      <div className="toolbar">
        <label className="switch" title={t("開著的話，每一站旁邊會有一個小標籤寫推薦刷哪張")}>
          <input type="checkbox" checked={r.on} onChange={(e) => setCardsOn(e.target.checked)} />
          <span className="track" aria-hidden="true" />
          <span>{t("每一站顯示推薦的卡")}</span>
        </label>
        {!r.on && <span className="note" style={{ margin: 0 }}>{t("關掉後行程上不會出現信用卡標籤，這一頁還是可以看。")}</span>}
      </div>

      {editing && <CardEditor key={`${editing.card?.id ?? "new"}|${editing.card?.updated_at ?? ""}`} card={editing.card} name={editing.name} country={filter === "all" ? "us" : filter} onCancel={() => setEditing(null)} onDone={async (id) => { if (editing.addToMine) await add(id); setEditing(null); }} />}

      <div className="gcard mycards">
        <h3>{t("我的卡")} {r.mine.length > 0 && <small className="muted">{t("{n} 張", { n: r.mine.length })}</small>}</h3>
        {!cards.ready ? <p className="note">{t("載入中…")}</p> : r.mine.length === 0 ? (
          <p className="note">{t("還沒有卡。在下面打卡名或銀行加入（例：Sapphire、Amex Gold、Barclaycard、CUBE）；卡片庫沒有的可以新增一張，讓 AI 幫查。")}</p>
        ) : (
          <ul className="cardlist">
            {r.mine.map((c) => (
              <CardRow key={c.id} c={c} dest={dest} date={date0} mine={false} actions={<>
                {canWrite && <button type="button" className="link" onClick={() => edit(c)} disabled={opening === c.id}>{opening === c.id ? t("讀取中…") : <><MenuIcon name="rename" size={14} />{t("改資料")}</>}</button>}
                <button type="button" className="link" onClick={() => remove(c.id)} disabled={busy === c.id}>{t("移除")}</button>
              </>} />
            ))}
          </ul>
        )}
        <div className="addcard">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("加一張卡：打卡名或銀行，例：Sapphire、Venture、Amex、Barclaycard、CUBE")} aria-label={t("搜尋卡片庫")} />
          {q.trim() && (
            <ul className="hits">
              {matches.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => add(c.id)} disabled={busy === c.id}>
                    <b>{c.name} <span className={`tag cc ${c.country}`}>{COUNTRY_NAME[c.country]}</span></b>
                    <small>{t("{bank} ・ {country}一般 {why}", { bank: c.bank, country: destName, why: explainShort(rank([c], "all", dest, date0)[0]) })}</small>
                  </button>
                </li>
              ))}
              {canWrite
                ? <li><button type="button" className="new" onClick={() => { setEditing({ card: null, name: q.trim().slice(0, 80), addToMine: true }); }}>{t("＋ 卡片庫沒有「{q}」，新增一張（可以讓 AI 幫查）", { q: q.trim() })}</button></li>
                : matches.length === 0 && <li><span className="note">{t("卡片庫沒有「{q}」。觀察員不能新增卡片，請成員幫忙加。", { q: q.trim() })}</span></li>}
            </ul>
          )}
        </div>
        {err && <p className="err">{err}</p>}
      </div>

      {r.mine.length > 0 && (
        <div className="gcard plan">
          <h3>{t("這趟怎麼刷")}</h3>
          <p className="note">{endsEarly ? t("依消費類型算的推薦（以 {date} 的優惠計）。有些優惠標示在行程結束前到期，那幾天的站會有黃色三角形提醒。", { date: fmtDate(date0) }) : t("依消費類型算的推薦（以 {date} 的優惠計）。", { date: fmtDate(date0) })}</p>
          <div className="tablewrap">
            <table className="infotable plantable">
              <thead><tr><th>{t("類型")}</th><th>{t("推薦")}</th><th>{t("淨回饋")}</th><th>{t("為什麼／條件")}</th></tr></thead>
              <tbody>
                {plan.map(({ k, picks }) => {
                  const p = picks[0];
                  return (
                    <tr key={k}>
                      <td>{RATE_KIND_NAME[k]}</td>
                      <td><MenuIcon name="cards" size={15} />{p.card.short || p.card.name}{p.stale && <MenuIcon name="warn" size={14} />}</td>
                      <td className={p.net < 0 ? "neg" : ""}>{pct(p.net)}</td>
                      <td>{explain(p)}{p.rate?.cond ? t("；{cond}", { cond: tx(p.card, p.rate.cond) }) : ""}{picks.length > 1 ? t("。其次 {cards}", { cards: list(picks.slice(1, 3).map((x) => `${x.card.short || x.card.name} ${pct(x.net)}`)) }) : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="gcard tips">
        <h3>{t("在{country}刷卡的小提醒", { country: destName })}</h3>
        <ul>
          <li>{currencyOf(dest)
            ? tr("店員或機器問要用哪種幣別結帳，一律選<b>當地貨幣（{cur}）</b>。選自己國家的幣別（DCC）會用店家較差的匯率換算，多付 3～7%。", { b: (c) => <b>{c}</b> }, { cur: currencyOf(dest) })
            : tr("店員或機器問要用哪種幣別結帳，一律選<b>當地貨幣</b>。選自己國家的幣別（DCC）會用店家較差的匯率換算，多付 3～7%。", { b: (c) => <b>{c}</b> })}</li>
          <li>{tr("<b>海外交易手續費</b>才是大頭：美國卡常見 3%、英國卡 2.99%、台灣卡 1.5%；沒有這筆費用的旅遊卡（Sapphire、Venture、Amex Gold/Platinum、Barclaycard Rewards、Halifax Clarity…）出國時通常勝過回饋高但收 3% 的卡。表上的「淨回饋」已經扣掉了。", { b: (c) => <b>{c}</b> })}</li>
          <li>{t("美國卡的「超市」「加油」加碼多半只限美國境內；餐廳、旅遊類多數全球適用。英國 Amex 的 MR 點數價值偏低，查卡片時注意換算。")}</li>
          {localTips(dest).map((tip) => <li key={tip}>{tr(tip, { b: (c) => <b>{c}</b> })}</li>)}
          <li>{tr("很多加碼要<b>先登錄</b>或在 App 切換方案；到期日多寫到年底，跨年後的條款銀行多在 12 月才公告。", { b: (c) => <b>{c}</b> })}</li>
        </ul>
      </div>

      <details className="gsec catalog">
        <summary>
          <span className="gicon" aria-hidden="true">🗂</span>
          <span className="gtitle"><h3>{t("卡片庫（{n} 張）", { n: cards.catalog.length })}</h3><small>{t("大家共用；看到優惠變了就按「改資料」更新，誰改的會記下來。")}</small></span>
          <span className="chev" aria-hidden="true">›</span>
        </summary>
        <div className="catbody">
          <div className="catbar">
            <div className="modebar" role="group" aria-label={t("哪一國的卡")}>
              <button type="button" className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>{t("全部")}</button>
              {COUNTRIES.filter((c) => counts[c]).map((c) => <button key={c} type="button" className={filter === c ? "on" : ""} onClick={() => setFilter(c)}>{COUNTRY_NAME[c]} {counts[c]}</button>)}
            </div>
            {canWrite && <button type="button" className="btn" onClick={() => setEditing({ card: null })}>{t("＋ 新增一張卡")}</button>}
          </div>
          <ul className="cardlist">
            {sorted.filter((c) => filter === "all" || c.country === filter).map((c) => (
              <CardRow key={c.id} c={c} dest={dest} date={date0} mine={mineSet.has(c.id)} actions={<>
                {mineSet.has(c.id)
                  ? <button type="button" className="link" onClick={() => remove(c.id)} disabled={busy === c.id}>{t("移除")}</button>
                  : <button type="button" className="link" onClick={() => add(c.id)} disabled={busy === c.id}>{t("＋ 我有這張")}</button>}
                {canWrite && <button type="button" className="link" onClick={() => edit(c)} disabled={opening === c.id}>{opening === c.id ? t("讀取中…") : <><MenuIcon name="rename" size={14} />{t("改資料")}</>}</button>}
                {canDelete(c) && <button type="button" className="link danger" onClick={() => del(c)} disabled={busy === c.id}>{t("刪除")}</button>}
              </>} />
            ))}
          </ul>
        </div>
      </details>
    </>
  );
}
