import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "../supabase";
import { lang, t } from "../i18n";
import { MenuIcon } from "./Logo";

export interface PickedPlace { name: string; address: string; tel: string }
interface Suggestion { id: string; main: string; sub: string }

// 伺服器沒有設定金鑰（503）或這個人不能用時，這次開著網頁就不再問，輸入框照樣可以自己打字
let off = false;
// 「不用 Google 搜尋」：這台裝置記住，下次開表單還是不搜尋
const MANUAL_KEY = "place-search-manual";
const readManual = () => { try { return localStorage.getItem(MANUAL_KEY) === "1"; } catch { return false; } };
const writeManual = (v: boolean) => { try { if (v) localStorage.setItem(MANUAL_KEY, "1"); else localStorage.removeItem(MANUAL_KEY); } catch { /* private mode: only for this form */ } };
const newSession = () => { const a = new Uint8Array(16); crypto.getRandomValues(a); return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join(""); };

/**
 * A text box that suggests real places while typing (Google, through the place-search function).
 * Typing still works as a plain text box: nothing has to be picked. Picking one hands back its name, address and phone (not its coordinates: Google's terms allow keeping those for 30 days only, so the route planner locates the address itself).
 * One "session" runs from the first keystroke to the pick (that is how Google bills it), then a new one starts.
 */
/** A pasted Google Maps share link (maps.app.goo.gl/…, google.com/maps/…): looked up as a whole instead of searched letter by letter. */
const MAP_LINK = /https:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs|(?:www\.)?google\.[a-z.]{2,6}\/maps|maps\.google\.[a-z.]{2,6}\/)[^\s]*/i;

/** Country names in the reader's language, longest first: Google's second line in Chinese has no separator (「日本東京都」), so the country is the name it starts with. */
let regions: string[] | null = null;
const regionNames = () => {
  if (regions) return regions;
  const out = new Set<string>();
  try {
    const dn = new Intl.DisplayNames([lang === "zh" ? "zh-Hant-TW" : "en"], { type: "region" });
    const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (const a of A) for (const b of A) { const n = dn.of(a + b); if (n && n !== a + b) out.add(n); }
  } catch { /* 沒有 Intl.DisplayNames：就不帶國家 */ }
  if (lang === "zh") for (const n of ["臺灣", "韓國", "南韓"]) out.add(n);
  return (regions = [...out].sort((x, y) => y.length - x.length));
};
const countryOf = (sub: string) => {
  const parts = sub.split(/[,，、]/).map((x) => x.trim()).filter(Boolean);
  if (lang !== "zh") return parts.pop() ?? "";
  const hit = regionNames().find((n) => parts.some((x) => x.startsWith(n)));
  return hit ?? (parts.length === 1 && parts[0].length <= 4 ? parts[0] : "");
};
/** A city as the trip's place is written: 「日本・東京」. */
const cityText = (s: Suggestion, withCountry: boolean) => {
  const country = withCountry ? countryOf(s.sub) : "";
  return country && country !== s.main ? (lang === "zh" ? `${country}・${s.main}` : `${s.main}, ${country}`) : s.main;
};

/**
 * `kind="city"`: suggests cities only and just fills in the name (nothing else to fetch); works before a trip exists (`tripId` empty).
 * `withCountry` writes the country in front, the way a trip's main city is kept.
 */
export function PlaceInput({ tripId, value, onChange, onPick, near, placeholder, kind = "place", withCountry = false }: { tripId: string; value: string; onChange: (v: string) => void; onPick?: (p: PickedPlace) => void; near?: { lat: number; lon: number } | null; placeholder?: string; kind?: "place" | "city"; withCountry?: boolean }) {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const session = useRef(newSession());
  const [manual, setManual] = useState(readManual);
  const skip = useRef(false);      // 「直接用我打的字」：這一格不再跳清單，直到清空重打
  const typed = useRef(false);     // only search for what the person typed here, not for the name the form opened with
  const composing = useRef(false); // 注音／拼音選字中：等選完字再查
  const seq = useRef(0);
  const [tick, setTick] = useState(0); // the text often does not change when the IME commits, so the search needs its own nudge
  const listId = useId();
  const wrap = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const q = value.trim();
    if (!q) skip.current = false;
    if (off || manual || skip.current || !typed.current || composing.current) return;
    const mine = ++seq.current;
    const link = kind === "place" && tripId ? q.match(MAP_LINK)?.[0] : undefined;
    if (link) { setItems([]); setOpen(false); fromLink(link, mine); return; } // 也讓還在路上的舊查詢作廢：清空欄位後不該再跳出剛才的結果
    if (q.length < 2) { setItems([]); setOpen(false); return; }
    const h = setTimeout(async () => {
      try {
        const r = await invoke<{ suggestions: Suggestion[] }>("place-search", { ...(tripId ? { trip_id: tripId } : {}), action: "suggest", kind, input: q, session: session.current, lang, ...(near ? { lat: near.lat, lon: near.lon } : {}) }, { timeoutMs: 10_000 });
        if (mine !== seq.current) return;
        setItems(r.suggestions ?? []); setActive(-1); setOpen((r.suggestions ?? []).length > 0);
      } catch (e) {
        if (mine !== seq.current) return;
        // not set up, over today's limit, offline: stop asking for now and stay a plain text box
        if (/還沒設定|not set up|明天再試|tomorrow/i.test(e instanceof Error ? e.message : "")) off = true;
        setItems([]); setOpen(false);
      }
    }, 280);
    return () => clearTimeout(h);
  }, [value, tick, tripId, near?.lat, near?.lon, manual]); // eslint-disable-line react-hooks/exhaustive-deps

  // 欄位常在兩欄表單的右半邊：清單要夠寬才讀得到地址，所以往左伸出去，但不超出畫面
  useLayoutEffect(() => {
    if (!open || !wrap.current) return;
    const r = wrap.current.getBoundingClientRect(), vw = document.documentElement.clientWidth, pad = 12;
    const width = Math.min(Math.max(r.width, 340), vw - pad * 2);
    const left = Math.max(pad, Math.min(r.left, vw - pad - width)) - r.left;
    setBox({ left, width });
  }, [open, items.length]);
  // 手機鍵盤會蓋住下半個畫面：清單第一次打開時把欄位捲到上面，留位置給清單
  useEffect(() => {
    if (!open || !wrap.current || !window.matchMedia?.("(pointer:coarse)").matches) return;
    wrap.current.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [open]);

  // 貼上 Google 地圖的分享連結：整個連結交給後端找出是哪個地點，名稱、地址、電話一起帶入
  const fromLink = async (url: string, mine: number) => {
    setBusy(true); setNote("");
    try {
      const d = await invoke<PickedPlace>("place-search", { trip_id: tripId, action: "link", url, session: session.current, lang, ...(near ? { lat: near.lat, lon: near.lon } : {}) }, { timeoutMs: 15_000 });
      if (mine !== seq.current) return;
      typed.current = false;
      if (!d.name) throw new Error(t("這個連結裡找不到地點，改用打字找找看"));
      onChange(d.name);
      onPick?.({ name: d.name, address: d.address || "", tel: d.tel || "" });
    } catch (e) {
      if (mine === seq.current) setNote(e instanceof Error && e.message ? e.message : t("這個連結裡找不到地點，改用打字找找看"));
    } finally { if (mine === seq.current) setBusy(false); session.current = newSession(); }
  };

  const asTyped = () => { seq.current++; skip.current = true; setOpen(false); setItems([]); };
  const setMode = (v: boolean) => { writeManual(v); setManual(v); seq.current++; setOpen(false); setItems([]); setNote(""); if (!v) { skip.current = false; typed.current = true; setTick((n) => n + 1); } };

  const pick = async (s: Suggestion) => {
    seq.current++; typed.current = false;
    setOpen(false); setItems([]);
    if (kind === "city") { onChange(cityText(s, withCountry)); session.current = newSession(); return; }
    setBusy(true);
    onChange(s.main);
    try {
      const d = await invoke<PickedPlace>("place-search", { trip_id: tripId, action: "details", place_id: s.id, session: session.current, lang }, { timeoutMs: 10_000 });
      // 中文介面下 Google 的完整地址常是羅馬拼音（4-chōme-2-8 Shibakōen…），清單上那一行才是中文，所以中文優先用清單的
      // 名稱也一樣：清單上是「戶隱神社」，詳細資料回來卻是 Togakushi-Jinja Chusha，使用者點的是清單上那個名字
      const name = lang === "zh" ? s.main || d.name : d.name || s.main;
      onPick?.({ name, address: (lang === "zh" ? s.sub || d.address : d.address || s.sub) || "", tel: d.tel || "" });
    } catch {
      onPick?.({ name: s.main, address: s.sub, tel: "" }); // the details did not come: keep what the list already showed
    } finally { setBusy(false); session.current = newSession(); }
  };

  return (
    <span className="placeinput" ref={wrap}>
      <span className="placeicon" aria-hidden="true"><MenuIcon name={manual && kind === "place" ? "rename" : "pin"} size={18} /></span>
      <input
        value={value} placeholder={placeholder} autoComplete="off" role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        onChange={(e) => { typed.current = true; setNote(""); onChange(e.target.value); }}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={(e) => { composing.current = false; typed.current = true; onChange((e.target as HTMLInputElement).value); setTick((n) => n + 1); }}
        onFocus={() => { if (items.length) setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open || e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % items.length); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i <= 0 ? items.length - 1 : i - 1)); }
          else if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(items[active]); }
          else if (e.key === "Escape") setOpen(false);
        }}
      />
      {busy && <small className="placebusy" role="status">{t("帶入地址中…")}</small>}
      {!busy && note && <small className="placebusy err" role="alert">{note}</small>}
      {kind === "place" && !off && (
        <small className="placemode">
          {manual ? t("現在不搜尋，照你打的字。") : null}
          <button type="button" className="link" onClick={() => setMode(!manual)}>{manual ? t("改回用 Google 找地點") : t("不用 Google 搜尋，自己填")}</button>
        </small>
      )}
      {open && (
        <span className="placelist" role="listbox" id={listId} style={box ? { left: box.left, width: box.width, right: "auto" } : undefined}>
          {items.map((s, i) => (
            <button key={s.id} type="button" role="option" id={`${listId}-${i}`} aria-selected={i === active} className={i === active ? "on" : undefined}
              onMouseDown={(e) => e.preventDefault()} onClick={() => pick(s)}>
              <MenuIcon name="pin" size={18} /><span><b>{s.main}</b>{s.sub && <small>{s.sub}</small>}</span>
            </button>
          ))}
          <button type="button" className="astyped" onMouseDown={(e) => e.preventDefault()} onClick={asTyped}>
            <MenuIcon name="rename" size={18} /><span><b>{t("直接用「{text}」", { text: value.trim() })}</b><small>{t("不選清單上的地點，照我打的字")}</small></span>
          </button>
          <small className="placeby" translate="no">Google Maps</small>
        </span>
      )}
    </span>
  );
}
