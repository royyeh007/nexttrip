// 口袋名單：自己收藏的地點。從帳號選單進來；行程裡的地點可以存進來，這裡的地點也可以加到行程。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTrip } from "../trip";
import { canEdit, daysFor, dotDate } from "../data";
import type { Day, Kind, Stop } from "../data";
import { supabase } from "../supabase";
import { KIND, KIND_NAME } from "../labels";
import { placeURL } from "../maps";
import { editDayItems, sortByTime } from "../dayEdit";
import { Lightbox, openImage } from "../md";
import { LogoMark, MenuIcon, Wordmark } from "./Logo";
import { PlaceInput } from "./PlaceInput";
import { TimeField } from "./Pickers";
import {
  GROUP_BY, MAX_PHOTOS, POCKET_MAX, PocketNotReady, categoriesOf, clearPocketLink, findInPocket, groupPlaces, matchPlace, patchPocket, pendingPocketLink,
  photoProblem, photoUrl, placeFromStop, pocketApi, refreshPocket, shareCodeOf, shareLink, stopFromPlace, usePocket,
} from "../pocket";
import type { GroupBy, PocketDraft, PocketPlace, PocketShare, PocketUse, SharedPocket } from "../pocket";
import { t, wk } from "../i18n";

const msgOf = (e: unknown) => t(e instanceof Error ? e.message : String(e));
const KINDS: Kind[] = ["food", "sight", "shop", "hotel", "move"];
const Chevron = () => <svg className="foldchev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>;
const groupLabel = (by: GroupBy, key: string) => (by === "kind" ? KIND_NAME[key as Kind] ?? key : key || (by === "city" ? t("沒有填城市") : t("未分類")));
const byLabel = (by: GroupBy) => ({ category: t("照分類"), kind: t("照種類"), city: t("照城市") })[by];
const subLine = (p: Pick<PocketPlace, "city" | "category" | "addr">, skip?: GroupBy) => [skip !== "city" && p.city, skip !== "category" && p.category, p.addr].filter(Boolean).join("・");

/** 口袋名單的獨立頁面：不屬於任何行程，從帳號選單進來，「返回」回到原本那一頁。 */
export function PocketPage() {
  const { closeAccount, signOut } = useTrip();
  return (
    <div className="wrap acctpage pocketpage">
      <header className="hero">
        <div className="fambar">
          <button type="button" className="btn small" onClick={closeAccount}>{t("‹ 返回")}</button>
          <button type="button" className="link who-am-i" onClick={signOut}>{t("登出")}</button>
        </div>
        <h1 className="brand"><LogoMark size={44} /><Wordmark height={26} /></h1>
      </header>
      <PocketView />
      <Lightbox />
    </div>
  );
}

function PocketView() {
  const { session, memberships } = useTrip();
  const pk = usePocket(session?.user.id);
  const [q, setQ] = useState("");
  const [by, setBy] = useState<GroupBy>("category");
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<string | null>(() => pendingPocketLink());
  const [shares, setShares] = useState<PocketShare[]>([]);
  const [made, setMade] = useState<{ code: string; title: string; n: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const madeRef = useRef<HTMLDivElement>(null);
  // place search needs a trip to count the usage against: any trip this person can edit
  const searchTrip = memberships.find((m) => m.role !== "viewer")?.trip_id ?? "";

  const loadShares = useCallback(async () => { try { setShares(await pocketApi.shares()); } catch { /* the list of links is not worth an error */ } }, []);
  useEffect(() => { void refreshPocket(); void loadShares(); }, [loadShares]);

  const share = async (ids: string[], title: string) => {
    setMsg(null);
    try {
      // the same set of places was shared before: hand out that link again instead of piling up new ones
      const same = shares.find((s) => s.ids.length === ids.length && ids.every((id) => s.ids.includes(id)));
      const code = same?.code ?? await pocketApi.share(ids, title);
      setMade({ code, title: same?.title ?? title, n: ids.length });
      if (!same) void loadShares();
      setTimeout(() => madeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }), 60);
    } catch (e) { setMsg(msgOf(e)); }
  };
  const closeIncoming = () => { clearPocketLink(); setIncoming(null); };

  const cats = useMemo(() => categoriesOf(pk.places), [pk.places]);
  const shown = useMemo(() => pk.places.filter((p) => matchPlace(p, q)), [pk.places, q]);
  const groups = useMemo(() => groupPlaces(shown, by), [shown, by]);
  const searching = q.trim() !== "";
  const card = (p: PocketPlace) => (
    <PlaceCard key={p.id} place={p} uses={pk.uses.filter((u) => u.place_id === p.id)} cats={cats} skip={searching ? undefined : by} searchTrip={searchTrip}
      open={openId === p.id} onToggle={() => setOpenId(openId === p.id ? null : p.id)} onShare={() => share([p.id], p.name)} />
  );

  return (
    <>
      <section className="dayhead">
        <h2 className="pockettitle"><MenuIcon name="pocket" size={30} />{t("口袋名單")}</h2>
        <p className="note">{t("把想去的地點收在這裡，不屬於任何行程。排行程的時候可以直接從這裡加進去。只有你自己看得到，除非你分享出去。")}</p>
      </section>
      {incoming && <SharedBox code={incoming} mine={pk.places} onClose={closeIncoming} />}
      {(pk.state === "loading" || pk.state === "idle") && <p className="note">{t("載入中…")}</p>}
      {pk.state === "notready" && <div className="panel"><p className="note">{pk.error}</p></div>}
      {pk.state === "error" && <div className="panel"><p className="err">{pk.error}</p><button type="button" className="btn" onClick={() => refreshPocket()}>{t("再試一次")}</button></div>}
      {pk.state === "ok" && (
        <>
          {pk.places.length > 0 && (
            <div className="tripfind pocketfind">
              <label className="tripsearch">
                <MenuIcon name="search" size={20} />
                <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("找地點：名稱、分類、城市或備註")} aria-label={t("找地點")} autoCapitalize="none" autoCorrect="off" enterKeyHint="search" />
              </label>
              <select value={by} onChange={(e) => setBy(e.target.value as GroupBy)} aria-label={t("怎麼分組")}>
                {GROUP_BY.map((g) => <option key={g} value={g}>{byLabel(g)}</option>)}
              </select>
            </div>
          )}
          <div className="actions pocketacts">
            <button type="button" className="btn primary" aria-expanded={adding} onClick={() => setAdding((v) => !v)}>{t("＋ 新增地點")}</button>
            {pk.places.length > 1 && <button type="button" className="btn" onClick={() => share(pk.places.map((p) => p.id), t("我的口袋名單"))}><MenuIcon name="share" size={18} />{t("分享全部")}</button>}
          </div>
          {adding && (
            <div className="panel">
              <PlaceForm cats={cats} searchTrip={searchTrip} existing={pk.places} onCancel={() => setAdding(false)}
                onSave={async (d) => { const row = await pocketApi.add(d); patchPocket(row); setAdding(false); setQ(""); setOpenId(row.id); }} />
            </div>
          )}
          {made && (
            <div ref={madeRef}><ShareDone made={made} onClose={() => setMade(null)} /></div>
          )}
          {msg && <p className="err" role="alert">{msg}</p>}
          {pk.places.length === 0 && !adding && (
            <div className="pendingbox">
              <p>{t("口袋名單還是空的。")}</p>
              <p>{t("兩種加法：在這裡按「＋ 新增地點」；或在行程裡點開一個地點，按「加到口袋名單」。")}</p>
            </div>
          )}
          {pk.places.length > 0 && shown.length === 0 && (
            <div className="panel tripnone">
              <p className="note">{t("沒有符合「{q}」的地點。", { q: q.trim() })}</p>
              <button type="button" className="btn" onClick={() => setQ("")}>{t("看全部地點")}</button>
            </div>
          )}
          {searching || groups.length === 1 ? (
            shown.length > 0 && (
              <div className="pgroup flat">
                {!searching && <h3 className="pghead">{groupLabel(by, groups[0].key)}<span className="hc">{groups[0].items.length === 1 ? t("1 個地點") : t("{n} 個地點", { n: groups[0].items.length })}</span></h3>}
                <div className="plist">{(searching ? shown : groups[0].items).map(card)}</div>
              </div>
            )
          ) : groups.map((g) => (
            // 有好幾類：每一類預設收起來；裡面有打開的地點（例如剛新增的）就跟著打開
            <details key={`${by}:${g.key}`} className="pgroup" open={g.items.some((p) => p.id === openId) || undefined}
              onToggle={(e) => { if (!e.currentTarget.open && g.items.some((p) => p.id === openId)) setOpenId(null); }}>
              <summary><b>{groupLabel(by, g.key)}</b><span className="hc">{g.items.length === 1 ? t("1 個地點") : t("{n} 個地點", { n: g.items.length })}</span><Chevron /></summary>
              <div className="plist">
                {g.items.map(card)}
                {g.items.length > 1 && <button type="button" className="link pgshare" onClick={() => share(g.items.map((p) => p.id), groupLabel(by, g.key))}>{t("分享這一類（{n} 個地點）", { n: g.items.length })}</button>}
              </div>
            </details>
          ))}
          <SharesFold shares={shares} onChanged={loadShares} onOpen={(code) => { setIncoming(code); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
        </>
      )}
    </>
  );
}

// ---------- one place ----------

function PlaceCard({ place: p, uses, cats, skip, searchTrip, open, onToggle, onShare }: { place: PocketPlace; uses: PocketUse[]; cats: string[]; skip?: GroupBy; searchTrip: string; open: boolean; onToggle: () => void; onShare: () => void }) {
  const [mode, setMode] = useState<"" | "edit" | "trip">("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ text: string; trip: string; date: string } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) { setMode(""); setErr(null); setDone(null); } else setTimeout(() => ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 60); }, [open]);
  const { enterTrip } = useTrip();
  const sub = subLine(p, skip);
  const remove = async () => {
    if (!confirm(t("把「{name}」從口袋名單刪掉？備註和照片會一起刪除。已經排進行程的地點不受影響。", { name: p.name }))) return;
    setBusy(true); setErr(null);
    try { await pocketApi.remove(p); patchPocket({ removed: p.id }); } catch (e) { setErr(msgOf(e)); setBusy(false); }
  };
  const lists: [string, string[] | undefined][] = [[t("推薦"), p.details.rec], [t("資訊"), p.details.info], [t("提醒"), p.details.tips]];
  return (
    <div className={`pcard${open ? " open" : ""}`} ref={ref}>
      <button type="button" className="phead" aria-expanded={open} onClick={onToggle}>
        <span className={`k ${p.kind}`} aria-hidden="true">{KIND[p.kind]}</span>
        <span className="pname"><b>{p.name}</b>{sub && <small>{sub}</small>}</span>
        {(p.photos.length > 0 || uses.length > 0) && (
          <span className="pmeta">
            {p.photos.length > 0 && <span><MenuIcon name="image" size={15} />{p.photos.length}</span>}
            {uses.length > 0 && <span><MenuIcon name="switch" size={15} />{uses.length}</span>}
          </span>
        )}
        <Chevron />
      </button>
      {open && (
        <div className="pbody">
          <div className="acts">
            <a className="btn primary" href={placeURL(p.q || [p.name, p.addr].filter(Boolean).join(" "))} target="_blank" rel="noopener"><MenuIcon name="pin" size={18} />{t("地圖")}</a>
            <button type="button" className="btn" aria-pressed={mode === "trip"} disabled={busy} onClick={() => { setDone(null); setMode(mode === "trip" ? "" : "trip"); }}><MenuIcon name="switch" size={18} />{t("加到行程")}</button>
            <button type="button" className="btn" disabled={busy} onClick={onShare}><MenuIcon name="share" size={18} />{t("分享")}</button>
            <button type="button" className="btn" aria-pressed={mode === "edit"} disabled={busy} onClick={() => setMode(mode === "edit" ? "" : "edit")}><MenuIcon name="rename" size={18} />{t("編輯")}</button>
            <button type="button" className="btn danger" disabled={busy} onClick={remove}><MenuIcon name="trash" size={18} />{t("刪除")}</button>
          </div>
          {err && <p className="err" role="alert">{err}</p>}
          {done && <p className="note ok" role="status">{done.text} <button type="button" className="link" onClick={() => enterTrip(done.trip, `#${done.date}`)}>{t("去看那一天 ›")}</button></p>}
          {mode === "trip" && <AddToTrip place={p} onCancel={() => setMode("")} onDone={(d) => { setDone(d); setMode(""); }} />}
          {mode === "edit" ? (
            <PlaceForm place={p} cats={cats} searchTrip={searchTrip} onCancel={() => setMode("")}
              onSave={async (d) => { patchPocket(await pocketApi.update(p.id, d)); setMode(""); }} />
          ) : (
            <>
              {(p.s || p.addr || p.tel || p.city || p.category) && (
                <dl className="kv">
                  {p.s && <><dt>{t("說明")}</dt><dd>{p.s}</dd></>}
                  {p.category && <><dt>{t("分類")}</dt><dd>{p.category}</dd></>}
                  {p.city && <><dt>{t("城市")}</dt><dd>{p.city}</dd></>}
                  {p.addr && <><dt>{t("地址")}</dt><dd>{p.addr}</dd></>}
                  {p.tel && <><dt>{t("電話")}</dt><dd><a href={`tel:${p.tel.replace(/[^\d+]/g, "")}`}>{p.tel}</a></dd></>}
                </dl>
              )}
              {lists.map(([h, items]) => items?.length ? <div key={h} className="sec"><h4>{h}</h4><ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div> : null)}
              <NoteBox place={p} />
              <Photos place={p} />
              <div className="sec">
                <h4>{t("排進過的行程")}</h4>
                {uses.length === 0 ? <p className="note">{t("還沒有排進任何行程。")}</p> : <UsesList uses={uses} />}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function UsesList({ uses }: { uses: PocketUse[] }) {
  const { memberships, enterTrip } = useTrip();
  return (
    <ul className="puses">
      {uses.map((u) => {
        const m = u.trip_id ? memberships.find((x) => x.trip_id === u.trip_id) : undefined;
        const when = u.date_id ? dotDate(u.date_id) : "";
        return (
          <li key={u.id}>
            {m ? <button type="button" className="link" onClick={() => enterTrip(m.trip_id, u.date_id ? `#${u.date_id}` : undefined)}>{m.trip.name}</button> : <span>{u.trip_name}</span>}
            {when && <small>{when}</small>}
            {!m && <small>{u.trip_id ? t("（你已經不在這個行程裡）") : t("（行程已經刪除）")}</small>}
          </li>
        );
      })}
    </ul>
  );
}

function NoteBox({ place: p }: { place: PocketPlace }) {
  const [text, setText] = useState(p.note);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<string | null>(null);
  useEffect(() => { setText(p.note); }, [p.note]);
  const save = async () => {
    setBusy(true); setState(null);
    try { patchPocket(await pocketApi.update(p.id, { note: text.trim() })); setState(t("已儲存")); } catch (e) { setState(msgOf(e)); } finally { setBusy(false); }
  };
  return (
    <div className="sec pnote">
      <h4>{t("我的備註")}</h4>
      <textarea value={text} maxLength={2000} rows={Math.max(2, Math.min(8, text.split("\n").length + 1))} onChange={(e) => { setText(e.target.value); setState(null); }} placeholder={t("例：朋友推薦的，要點招牌鰻魚飯；週一公休")} aria-label={t("我的備註")} />
      {(text.trim() !== p.note || state) && (
        <div className="actions">
          {text.trim() !== p.note && <button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? t("儲存中…") : t("儲存備註")}</button>}
          {text.trim() !== p.note && <button type="button" className="btn" disabled={busy} onClick={() => setText(p.note)}>{t("取消")}</button>}
          {state && <span className="note" role="status">{state}</span>}
        </div>
      )}
    </div>
  );
}

function Photos({ place: p }: { place: PocketPlace }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const add = async (files: FileList | null) => {
    const list = [...(files ?? [])];
    if (input.current) input.current.value = "";
    if (!list.length) return;
    setBusy(true); setErr(null);
    let have = p.photos.length;
    try {
      for (const f of list) {
        const problem = photoProblem(f, have);
        if (problem) { setErr(problem); break; }
        patchPocket(await pocketApi.addPhoto(p.id, f));
        have++;
      }
    } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); }
  };
  const remove = async (path: string) => {
    if (!confirm(t("刪掉這張照片？"))) return;
    setBusy(true); setErr(null);
    try { patchPocket(await pocketApi.removePhoto(p, path)); } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); }
  };
  return (
    <div className="sec pphotos">
      <h4>{t("照片（{n}／{max}）", { n: p.photos.length, max: MAX_PHOTOS })}</h4>
      <div className="pthumbs">
        {p.photos.map((path, i) => (
          <figure key={path}>
            <button type="button" className="pthumb" onClick={() => openImage(photoUrl(path), p.name)} title={t("點一下放大")}>
              <img src={photoUrl(path)} alt={t("{name} 的照片 {i}", { name: p.name, i: i + 1 })} loading="lazy" decoding="async" />
            </button>
            <button type="button" className="link danger" disabled={busy} onClick={() => remove(path)}>{t("刪除")}</button>
          </figure>
        ))}
        {p.photos.length < MAX_PHOTOS && (
          <label className={`pthumb add${busy ? " busy" : ""}`}>
            <MenuIcon name="image" size={24} />
            <span>{busy ? t("上傳中…") : t("加照片")}</span>
            <input ref={input} type="file" accept="image/*" multiple hidden disabled={busy} onChange={(e) => add(e.target.files)} />
          </label>
        )}
      </div>
      <p className="note">{t("最多 {max} 張。照片會自動縮小再存，縮小後每張上限 2 MB。", { max: MAX_PHOTOS })}</p>
      {err && <p className="err" role="alert">{err}</p>}
    </div>
  );
}

// ---------- add / edit form ----------

function PlaceForm({ place, cats, searchTrip, existing, onSave, onCancel }: { place?: PocketPlace; cats: string[]; searchTrip: string; existing?: PocketPlace[]; onSave: (d: PocketDraft) => Promise<void>; onCancel: () => void }) {
  const [d, setD] = useState<PocketDraft>(() => place
    ? { name: place.name, kind: place.kind, category: place.category, city: place.city, q: place.q, addr: place.addr, tel: place.tel, s: place.s, note: place.note, details: place.details }
    : { name: "", kind: "food", category: "", city: "", q: "", addr: "", tel: "", s: "", note: "", details: {} });
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bad, setBad] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const up = <K extends keyof PocketDraft>(k: K) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setD((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    const name = d.name.trim();
    if (!name) { setBad(t("還沒填名稱：這個地點叫什麼？")); return; }
    if (existing && findInPocket(existing, name)) { setBad(t("口袋名單裡已經有「{name}」了", { name })); return; }
    if (existing && existing.length >= POCKET_MAX) { setErr(t("口袋名單最多 {n} 個地點", { n: POCKET_MAX })); return; }
    setBusy(true); setErr(null); setBad(null);
    // the saved coordinates belong to the old place: a renamed or re-addressed place has to be located again
    const details = place && (name !== place.name || d.addr.trim() !== place.addr) ? (() => { const x = { ...d.details }; delete x.ll; return x; })() : d.details;
    try { await onSave({ ...d, name, category: d.category.trim(), city: d.city.trim(), q: d.q.trim(), addr: d.addr.trim(), tel: d.tel.trim(), s: d.s.trim(), note: d.note.trim(), details }); }
    catch (e) { setErr(e instanceof PocketNotReady ? e.message : msgOf(e)); setBusy(false); }
  };
  return (
    <div className="editor pform">
      <h4>{place ? t("編輯這個地點") : t("新增地點")}</h4>
      <label className={`full${bad ? " bad" : ""}`}>{t("名稱")}
        <PlaceInput tripId={searchTrip} value={d.name} placeholder={searchTrip ? t("打字找地點，或貼上地圖連結") : t("地點名稱")}
          onChange={(v) => { setBad(null); setD((x) => ({ ...x, name: v })); }}
          onPick={(pl) => setD((x) => ({ ...x, name: pl.name, q: [pl.name, pl.address].filter(Boolean).join(" ").trim(), addr: pl.address, tel: pl.tel || x.tel }))} />
        {bad && <small className="fielderr" role="alert">{bad}</small>}
      </label>
      {!more && (d.addr || d.tel) && <p className="note pickedline">{[d.addr, d.tel].filter(Boolean).join("・")}</p>}
      <div className="formgrid">
        <label>{t("種類")}<select value={d.kind} onChange={up("kind")}>{KINDS.map((k) => <option key={k} value={k}>{KIND_NAME[k]}</option>)}</select></label>
        <label>{t("城市（可空）")}<input value={d.city} onChange={up("city")} maxLength={60} placeholder={t("例：京都")} /></label>
      </div>
      <label className="full">{t("分類（自己取，可空）")}<input value={d.category} onChange={up("category")} maxLength={30} placeholder={t("例：想吃的甜點、帶爸媽去")} /></label>
      {cats.length > 0 && (
        <div className="chips catchips" role="group" aria-label={t("用過的分類")}>
          {cats.slice(0, 12).map((c) => <button key={c} type="button" className={`chip${d.category.trim() === c ? " on" : ""}`} aria-pressed={d.category.trim() === c} onClick={() => setD((x) => ({ ...x, category: x.category.trim() === c ? "" : c }))}>{c}</button>)}
        </div>
      )}
      <label className="full">{t("我的備註（可空）")}<textarea rows={2} value={d.note} maxLength={2000} onChange={up("note")} placeholder={t("例：朋友推薦的，要點招牌鰻魚飯；週一公休")} /></label>
      <button type="button" className="morebtn" aria-expanded={more} onClick={() => setMore((v) => !v)}>
        <span><b>{t("更多細節")}</b><small>{t("地址、電話、一句話說明")}</small></span>
        <Chevron />
      </button>
      {more && (
        <div className="formgrid">
          <label className="wide">{t("地址")}<input value={d.addr} onChange={up("addr")} maxLength={300} /></label>
          <label>{t("電話")}<input value={d.tel} onChange={up("tel")} inputMode="tel" maxLength={60} /></label>
          <label className="wide">{t("一句話說明")}<input value={d.s} onChange={up("s")} maxLength={300} /></label>
        </div>
      )}
      {!place && <p className="note">{t("照片在存好之後加：點開這個地點就有「加照片」。")}</p>}
      <div className="actions">
        <button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? t("儲存中…") : place ? t("儲存") : t("加到口袋名單")}</button>
        <button type="button" className="btn" disabled={busy} onClick={onCancel}>{t("取消")}</button>
      </div>
      {err && <p className="err" role="alert">{err}</p>}
    </div>
  );
}

// ---------- pocket → trip ----------

type DayRow = { id: string; date_id: string; fam: string[] | null; d: string; w: string; city: string; title: string; hotel: string; items: Day["items"] };

function AddToTrip({ place, onDone, onCancel }: { place: PocketPlace; onDone: (d: { text: string; trip: string; date: string }) => void; onCancel: () => void }) {
  const { memberships } = useTrip();
  const trips = useMemo(() => memberships.filter((m) => m.role !== "viewer"), [memberships]);
  const [tripId, setTripId] = useState(trips.length === 1 ? trips[0].trip_id : "");
  const [days, setDays] = useState<Day[] | null>(null);
  const [dayKey, setDayKey] = useState("");
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const m = trips.find((x) => x.trip_id === tripId);

  useEffect(() => {
    setDays(null); setDayKey(""); setErr(null);
    if (!supabase || !m) return;
    let alive = true;
    supabase.from("days").select("id, date_id, fam, d, w, city, title, hotel, items").eq("trip_id", m.trip_id).then(({ data, error }) => {
      if (!alive) return;
      if (error) { setErr(t("讀不到那個行程的日期，可能是網路問題")); return; }
      const all: Day[] = ((data ?? []) as DayRow[]).map((r) => ({ rowId: r.id, id: r.date_id, fam: r.fam, d: r.d, w: r.w, city: r.city, title: r.title, hotel: r.hotel, items: r.items }));
      // the days this person's family sees, and may change
      setDays(daysFor(all, m.family_id).filter((d) => canEdit(d.fam, m)));
    });
    return () => { alive = false; };
  }, [m]);

  const keyOf = (d: Day) => d.rowId ?? d.id;
  const day = days?.find((d) => keyOf(d) === dayKey);
  const save = async () => {
    if (!m || !day) return;
    if (time.trim() && !/^\d{1,2}:\d{2}$/.test(time.trim())) { setErr(t("時間請用 H:MM，例如 9:30、14:00")); return; }
    setBusy(true); setErr(null);
    const stop: Stop = stopFromPlace(place, time);
    const e = await editDayItems(m.trip_id, day, (items) => sortByTime([...items, stop]));
    if (e) { setErr(e); setBusy(false); return; }
    try { await pocketApi.recordUse(place.id, { id: m.trip_id, name: m.trip.name }, day.id); await refreshPocket(); } catch { /* the stop is in the trip; the history line is only a nicety */ }
    onDone({ text: t("已經加到「{trip}」的 {date}。", { trip: m.trip.name, date: day.d }), trip: m.trip_id, date: day.id });
  };

  if (trips.length === 0) return <div className="ptrip"><p className="note">{t("你還沒有可以編輯的行程。先建立或加入一個行程，再把地點加進去。")}</p></div>;
  return (
    <div className="ptrip">
      <div className="formgrid">
        <label>{t("加到哪個行程")}
          <select value={tripId} onChange={(e) => setTripId(e.target.value)}>
            {trips.length > 1 && <option value="">{t("請選擇")}</option>}
            {trips.map((x) => <option key={x.trip_id} value={x.trip_id}>{x.trip.name}</option>)}
          </select>
        </label>
        {m && days && days.length > 0 && (
          <label>{t("哪一天")}
            <select value={dayKey} onChange={(e) => setDayKey(e.target.value)}>
              <option value="">{t("請選擇")}</option>
              {days.map((d) => <option key={keyOf(d)} value={keyOf(d)}>{[`${d.d}（${wk(d.w)}）`, d.city, d.title].filter(Boolean).join("・")}</option>)}
            </select>
          </label>
        )}
        {day && <label>{t("時間（可空）")}<TimeField value={time} onChange={setTime} hint={t("選時間")} /></label>}
      </div>
      {m && !days && !err && <p className="note">{t("載入中…")}</p>}
      {m && days && days.length === 0 && <p className="note">{t("這個行程還沒有你可以改的日期。先進行程按「＋ 加一天」。")}</p>}
      {day && <p className="note">{day.fam && day.fam.length === 1 ? t("會照時間排進那一天；沒填時間就排在最後。") : t("那一天是幾家共用的同一份：加進去之後每一家都看得到。會照時間排，沒填時間就排在最後。")}</p>}
      <div className="actions">
        <button type="button" className="btn primary" disabled={busy || !day} onClick={save}>{busy ? t("加入中…") : t("加到這一天")}</button>
        <button type="button" className="btn" disabled={busy} onClick={onCancel}>{t("取消")}</button>
      </div>
      {err && <p className="err" role="alert">{err}</p>}
    </div>
  );
}

// ---------- sharing ----------

function CopyLink({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const link = shareLink(code);
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { prompt(t("複製這個分享連結"), link); }
  };
  return <button type="button" className="btn" onClick={copy}><MenuIcon name="copy" size={18} />{copied ? t("已複製") : t("複製連結")}</button>;
}

function ShareDone({ made, onClose }: { made: { code: string; title: string; n: number }; onClose: () => void }) {
  const link = shareLink(made.code);
  const canSend = typeof navigator !== "undefined" && typeof navigator.share === "function";
  return (
    <div className="panel pshare" role="status">
      <h3>{made.n === 1 ? t("分享連結：{title}", { title: made.title }) : t("分享連結：{title}（{n} 個地點）", { title: made.title, n: made.n })}</h3>
      <div className="invite"><code>{link}</code></div>
      <div className="actions">
        <CopyLink code={made.code} />
        {canSend && <button type="button" className="btn primary" onClick={() => { navigator.share({ title: made.title, url: link }).catch(() => { /* the person closed the share sheet */ }); }}><MenuIcon name="share" size={18} />{t("傳給朋友")}</button>}
        <button type="button" className="btn" onClick={onClose}>{t("關掉")}</button>
      </div>
      <p className="note">{t("朋友要先登入這個網站才打得開，打開後可以把地點存到他自己的口袋名單。他會看到名稱、地址、說明、你的備註和照片；看不到你排進過哪些行程。你之後改了內容，他打開看到的是新的。不想再分享，到最下面「分享出去的連結」刪掉。")}</p>
    </div>
  );
}

function SharesFold({ shares, onChanged, onOpen }: { shares: PocketShare[]; onChanged: () => Promise<void>; onOpen: (code: string) => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const remove = async (s: PocketShare) => {
    if (!confirm(t("刪掉「{title}」這個分享連結？連結會立刻失效；朋友已經存到自己名單的地點不受影響。", { title: s.title || t("沒有標題") }))) return;
    setBusy(true); setErr(null);
    try { await pocketApi.unshare(s.code); await onChanged(); } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); }
  };
  return (
    <details className="pgroup pshares">
      <summary><b>{t("分享")}</b><span className="hc">{shares.length === 0 ? t("打開朋友的連結、管理我分享的") : shares.length === 1 ? t("我分享了 1 個連結") : t("我分享了 {n} 個連結", { n: shares.length })}</span><Chevron /></summary>
      <div className="plist">
        <p className="note">{t("朋友傳來口袋名單的連結：直接點開就可以，或貼在這裡。")}</p>
        <div className="addrow pair">
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t("貼上朋友的分享連結")} autoCapitalize="none" autoCorrect="off" aria-label={t("朋友的分享連結")} />
          <button type="button" className="btn" disabled={!code.trim()} onClick={() => { onOpen(shareCodeOf(code)); setCode(""); }}>{t("打開")}</button>
        </div>
        {shares.length > 0 && <h4 className="psub">{t("我分享出去的連結")}</h4>}
        {shares.map((s) => (
          <div key={s.code} className="invite person">
            <span className="pname"><b>{s.title || t("沒有標題")}</b><small>{s.count === 1 ? t("1 個地點") : t("{n} 個地點", { n: s.count })}・{dotDate(s.created_at.slice(0, 10))}</small></span>
            <CopyLink code={s.code} />
            <button type="button" className="link danger" disabled={busy} onClick={() => remove(s)}>{t("刪除連結")}</button>
          </div>
        ))}
        {err && <p className="err" role="alert">{err}</p>}
      </div>
    </details>
  );
}

/** A friend's shared places: look, then copy the ones you want into your own list. */
function SharedBox({ code, mine, onClose }: { code: string; mine: PocketPlace[]; onClose: () => void }) {
  const [data, setData] = useState<SharedPocket | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setData(null); setErr(null);
    pocketApi.shared(code).then((d) => { if (alive) setData(d); }, (e) => { if (alive) setErr(msgOf(e)); });
    return () => { alive = false; };
  }, [code]);
  const adopt = async (list: SharedPocket["places"]) => {
    setErr(null);
    try {
      for (const p of list) { setBusy(p.id); patchPocket(await pocketApi.adopt(p)); }
    } catch (e) { setErr(msgOf(e)); } finally { setBusy(null); }
  };
  const fresh = (data?.places ?? []).filter((p) => !findInPocket(mine, p.name));
  return (
    <div className="panel pshared">
      {!data && !err && <p className="note">{t("打開朋友分享的口袋名單…")}</p>}
      {err && <p className="err" role="alert">{err}</p>}
      {data && (
        <>
          <h3>{data.mine ? t("你分享的：{title}", { title: data.title || t("口袋名單") }) : t("{name} 分享給你：{title}", { name: data.owner, title: data.title || t("口袋名單") })}</h3>
          <p className="note">{data.mine ? t("這是你自己分享的連結，朋友打開會看到下面這些。") : data.places.length === 0 ? t("這個連結裡的地點已經被對方刪掉了。") : t("想去的按「存到我的口袋名單」，會複製一份到你自己的名單，之後對方改了或刪了都不影響你。")}</p>
          <div className="plist">
            {data.places.map((p) => {
              const have = !!findInPocket(mine, p.name);
              return (
                <div key={p.id} className="pcard shared">
                  <div className="phead static">
                    <span className={`k ${p.kind}`} aria-hidden="true">{KIND[p.kind]}</span>
                    <span className="pname"><b>{p.name}</b>{subLine(p) && <small>{subLine(p)}</small>}</span>
                    {!data.mine && (have
                      ? <span className="tag shared">{t("已經有了")}</span>
                      : <button type="button" className="btn small" disabled={busy !== null} onClick={() => adopt([p])}>{busy === p.id ? t("存入中…") : t("存到我的口袋名單")}</button>)}
                  </div>
                  {(p.s || p.note || p.photos.length > 0) && (
                    <div className="pbody">
                      {p.s && <p>{p.s}</p>}
                      {p.note && <p className="pquote">{p.note}</p>}
                      {p.photos.length > 0 && <div className="pthumbs">{p.photos.map((path) => <button key={path} type="button" className="pthumb" onClick={() => openImage(photoUrl(path), p.name)} title={t("點一下放大")}><img src={photoUrl(path)} alt={p.name} loading="lazy" decoding="async" /></button>)}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
      <div className="actions">
        {data && !data.mine && fresh.length > 1 && <button type="button" className="btn primary" disabled={busy !== null} onClick={() => adopt(fresh)}>{busy ? t("存入中…") : t("全部存起來（{n} 個）", { n: fresh.length })}</button>}
        <button type="button" className="btn" disabled={busy !== null} onClick={onClose}>{t("關掉")}</button>
      </div>
    </div>
  );
}

// ---------- inside a trip ----------

/** 地點詳細頁的按鈕：把這一站存進口袋名單。已經存過的會顯示「已在口袋名單」，並記下它在這個行程出現過。 */
export function SaveToPocket({ day, stop }: { day: Day; stop: Stop }) {
  const { session, current } = useTrip();
  const pk = usePocket(session?.user.id);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const have = pk.state === "ok" ? findInPocket(pk.places, stop.n) : undefined;
  const haveId = have?.id, tripId = current?.id, tripName = current?.name;
  const noted = !!have && pk.uses.some((u) => u.place_id === have.id && u.trip_id === tripId && u.date_id === day.id);
  // already saved (maybe from another trip): this trip goes into its history too
  useEffect(() => {
    if (!haveId || noted || !tripId || !tripName) return;
    pocketApi.recordUse(haveId, { id: tripId, name: tripName }, day.id).then(() => refreshPocket(), () => { /* only a history line */ });
  }, [haveId, noted, tripId, tripName, day.id]);
  if (pk.state !== "ok" || !current || stop.ref) return null;
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const row = await pocketApi.add(placeFromStop(stop, day.city));
      patchPocket(row);
      await pocketApi.recordUse(row.id, { id: current.id, name: current.name }, day.id).catch(() => { /* only a history line */ });
      await refreshPocket();
    } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); }
  };
  return (
    <>
      <button type="button" className={`btn${have ? " saved" : ""}`} disabled={busy || !!have} onClick={save} title={have ? t("帳號選單 → 口袋名單 可以看到") : t("收藏這個地點，以後別的行程也可以直接加")}>
        <MenuIcon name="pocket" size={18} />{have ? t("已在口袋名單") : busy ? t("加入中…") : t("加到口袋名單")}
      </button>
      {err && <span className="err" role="alert">{err}</span>}
    </>
  );
}

/** 加一站的表單裡：從口袋名單挑一個地點帶進來。預設收起來。 */
export function PocketPick({ city, onPick }: { city?: string; onPick: (p: PocketPlace) => void }) {
  const { session } = useTrip();
  const pk = usePocket(session?.user.id);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const here = (p: PocketPlace) => (city && p.city && (p.city.includes(city) || city.includes(p.city)) ? 0 : 1);
    return pk.places.filter((p) => matchPlace(p, q)).sort((a, b) => here(a) - here(b) || a.name.localeCompare(b.name, "zh-Hant"));
  }, [pk.places, q, city]);
  if (pk.state !== "ok" || pk.places.length === 0) return null;
  return (
    <div className="pocketpick">
      <button type="button" className="morebtn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span><b><MenuIcon name="pocket" size={18} />{t("從口袋名單選")}</b><small>{pk.places.length === 1 ? t("你收藏了 1 個地點") : t("你收藏了 {n} 個地點", { n: pk.places.length })}</small></span>
        <Chevron />
      </button>
      {open && (
        <div className="pocketpicklist">
          {pk.places.length > 6 && <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("找地點：名稱、分類、城市或備註")} aria-label={t("找地點")} autoCapitalize="none" autoCorrect="off" />}
          {list.length === 0 && <p className="note">{t("沒有符合的地點。")}</p>}
          {list.slice(0, 60).map((p) => (
            <button key={p.id} type="button" className="phead" onClick={() => { onPick(p); setOpen(false); setQ(""); }}>
              <span className={`k ${p.kind}`} aria-hidden="true">{KIND[p.kind]}</span>
              <span className="pname"><b>{p.name}</b>{subLine(p) && <small>{subLine(p)}</small>}</span>
            </button>
          ))}
          {list.length > 60 && <p className="note">{t("還有 {n} 個，打字找比較快。", { n: list.length - 60 })}</p>}
        </div>
      )}
    </div>
  );
}
