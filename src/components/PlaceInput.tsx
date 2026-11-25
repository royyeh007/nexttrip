import { useEffect, useId, useRef, useState } from "react";
import { invoke } from "../supabase";
import { lang, t } from "../i18n";
import { MenuIcon } from "./Logo";

export interface PickedPlace { name: string; address: string; tel: string }
interface Suggestion { id: string; main: string; sub: string }

// 伺服器沒有設定金鑰（503）或這個人不能用時，這次開著網頁就不再問，輸入框照樣可以自己打字
let off = false;
const newSession = () => { const a = new Uint8Array(16); crypto.getRandomValues(a); return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join(""); };

/**
 * A text box that suggests real places while typing (Google, through the place-search function).
 * Typing still works as a plain text box: nothing has to be picked. Picking one hands back its name, address and phone (not its coordinates: Google's terms allow keeping those for 30 days only, so the route planner locates the address itself).
 * One "session" runs from the first keystroke to the pick (that is how Google bills it), then a new one starts.
 */
/** A city as the trip's place is written: 「日本・東京」 (the country comes from the last part of Google's second line). */
const cityText = (s: Suggestion, withCountry: boolean) => {
  const country = s.sub.split(/[,，、]/).map((x) => x.trim()).filter(Boolean).pop();
  return withCountry && country && country !== s.main ? (lang === "zh" ? `${country}・${s.main}` : `${s.main}, ${country}`) : s.main;
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
  const session = useRef(newSession());
  const typed = useRef(false);     // only search for what the person typed here, not for the name the form opened with
  const composing = useRef(false); // 注音／拼音選字中：等選完字再查
  const seq = useRef(0);
  const [tick, setTick] = useState(0); // the text often does not change when the IME commits, so the search needs its own nudge
  const listId = useId();

  useEffect(() => {
    if (off || !typed.current || composing.current) return;
    const q = value.trim();
    if (q.length < 2) { setItems([]); setOpen(false); return; }
    const mine = ++seq.current;
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
  }, [value, tick, tripId, near?.lat, near?.lon]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async (s: Suggestion) => {
    seq.current++; typed.current = false;
    setOpen(false); setItems([]);
    if (kind === "city") { onChange(cityText(s, withCountry)); session.current = newSession(); return; }
    setBusy(true);
    onChange(s.main);
    try {
      const d = await invoke<PickedPlace>("place-search", { trip_id: tripId, action: "details", place_id: s.id, session: session.current, lang }, { timeoutMs: 10_000 });
      onPick?.({ name: d.name || s.main, address: d.address || s.sub, tel: d.tel || "" });
    } catch {
      onPick?.({ name: s.main, address: s.sub, tel: "" }); // the details did not come: keep what the list already showed
    } finally { setBusy(false); session.current = newSession(); }
  };

  return (
    <span className="placeinput">
      <input
        value={value} placeholder={placeholder} autoComplete="off" role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        onChange={(e) => { typed.current = true; onChange(e.target.value); }}
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
      {open && (
        <span className="placelist" role="listbox" id={listId}>
          {items.map((s, i) => (
            <button key={s.id} type="button" role="option" id={`${listId}-${i}`} aria-selected={i === active} className={i === active ? "on" : undefined}
              onMouseDown={(e) => e.preventDefault()} onClick={() => pick(s)}>
              <MenuIcon name="pin" size={18} /><span><b>{s.main}</b>{s.sub && <small>{s.sub}</small>}</span>
            </button>
          ))}
          <small className="placeby" translate="no">Google Maps</small>
        </span>
      )}
    </span>
  );
}
