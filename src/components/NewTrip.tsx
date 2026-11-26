import { useRef, useState } from "react";
import { PlaceInput } from "./PlaceInput";
import { invoke, supabase } from "../supabase";
import { useTrip } from "../trip";
import { addDays, daysBetween } from "../data";
import type { Proposal } from "../data";
import { fillTripDays } from "../days";
import { MAX_UPLOAD_CHARS, UPLOAD_ACCEPT, fileProblem, storeUpload } from "../upload";
import { MAX_PROMPT_DAYS, MOVES, PACES, WANTS, buildTripPrompt, proposalRange, shiftProposal, type Move, type Pace, type Want } from "../tripPrompt";
import { DEST_TAGS, REGIONS, pickDestination, type DestTag, type Destination, type Region } from "../destinations";
import { ProposalDays, applyProposal } from "./Proposals";
import { MenuIcon } from "./Logo";
import { lang, t } from "../i18n";

type Mode = "manual" | "upload" | "ai";
interface Guess { name: string | null; place: string | null; start_date: string | null; end_date: string | null }
/** 讀出來、等使用者補基本資料的行程。`from` 是讀到的第一天（使用者改開始日期時，每一天跟著移）。 */
interface Parsed { id: string; proposal: Proposal; from: string; span: number; missing: string[]; /** 內容沒有日期：每一天先從今天排起，等使用者選開始日期 */ undated: boolean }

const wantLabel = (w: Want) => ({ sight: t("景點"), food: t("餐廳"), hotel: t("住宿"), shop: t("購物"), move: t("交通方式") })[w];
const paceLabel = (p: Pace) => ({ easy: t("輕鬆"), normal: t("普通"), full: t("緊湊") })[p];
const regionLabel = (r: Region) => ({ neasia: t("東北亞"), seasia: t("東南亞"), europe: t("歐洲"), namerica: t("北美"), oceania: t("大洋洲"), other: t("中東、非洲、中南美") })[r];
const destTagLabel = (g: DestTag) => ({ city: t("城市"), food: t("美食"), nature: t("自然風景"), beach: t("海邊"), history: t("古蹟文化"), snow: t("雪"), kids: t("帶小孩") })[g];
const moveLabel = (m: Move) => ({ any: t("都可以"), transit: t("大眾運輸"), car: t("自己開車"), charter: t("包車、計程車") })[m];

/**
 * 首頁「建立新行程」。三種方式：
 * 自己填基本資料；上傳現成的行程（檔案、截圖或文字），讀出來後補上缺的基本資料；
 * 或選條件產生一段提示，貼給自己慣用的 AI，把回答貼回來（之後跟上傳一樣）。
 */
export function NewTrip({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const { session } = useTrip();
  const today = new Date().toLocaleDateString("sv-SE");
  const [mode, setMode] = useState<Mode>("manual");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // ---- 基本資料（自己填，或讀出來之後補） ----
  const [name, setName] = useState("");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [place, setPlace] = useState("");
  const [famLabel, setFamLabel] = useState("");
  const [myName, setMyName] = useState<string>(session?.user.user_metadata?.full_name ?? "");

  // ---- 上傳 ----
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  // 讀檔要先有一個行程放檔案：先建一個暫時的，按取消就刪掉
  const [draft, setDraft] = useState<{ tripId: string; familyId: string } | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [startSet, setStartSet] = useState(false);

  // ---- 給 AI 的提示 ----
  const [aiPlace, setAiPlace] = useState("");
  const [aiStart, setAiStart] = useState("");
  const [aiDays, setAiDays] = useState(5);
  const [people, setPeople] = useState("");
  const [want, setWant] = useState<Want[]>([...WANTS]);
  const [pace, setPace] = useState<Pace>("normal");
  const [move, setMove] = useState<Move>("any");
  const [booked, setBooked] = useState("");
  const [notes, setNotes] = useState("");
  const [copied, setCopied] = useState(false);
  // 還沒決定去哪裡：隨機推薦（每次打開都是收起來的，條件都可以不選）
  const [lucky, setLucky] = useState(false);
  const [region, setRegion] = useState<Region | "">("");
  const [destTags, setDestTags] = useState<DestTag[]>([]);
  const [drawn, setDrawn] = useState<Destination | null | "none">(null);
  const draw = () => {
    const d = pickDestination({ region, tags: destTags }, drawn && drawn !== "none" ? drawn.zh : undefined);
    setDrawn(d ?? "none");
    if (d) setAiPlace(lang === "en" ? d.en : d.zh);
  };
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const prompt = aiPlace.trim() ? buildTripPrompt({ place: aiPlace, start: aiStart, days: aiDays, people, want, pace, move, booked, notes }, lang) : "";

  const pickFile = (f: File | null) => {
    if (fileRef.current) fileRef.current.value = "";
    const problem = f ? fileProblem(f) : null;
    setErr(problem);
    setFile(problem ? null : f);
  };

  const copyPrompt = async () => {
    if (!prompt) return;
    try { await navigator.clipboard.writeText(prompt); }
    catch { promptRef.current?.select(); try { document.execCommand("copy"); } catch { /* the text stays selected: copy by hand */ } }
    setCopied(true); setTimeout(() => setCopied(false), 2500);
  };

  const discard = async () => {
    if (!supabase || !draft) return;
    await supabase.from("trips").delete().eq("id", draft.tripId);
    setDraft(null); setParsed(null);
  };
  const cancel = async () => { setBusy(t("取消中…")); try { await discard(); } finally { setBusy(null); onCancel(); } };

  /** 自己填：照原本的方式建立。 */
  const create = async () => {
    if (!supabase) return;
    setBusy(t("建立中…")); setErr(null);
    await discard();
    const { data, error } = await supabase.rpc("create_trip", { p_name: name.trim(), p_start: start, p_end: end, p_place: place.trim(), p_family_label: famLabel.trim(), p_my_name: myName.trim() });
    if (error) { setErr(t(error.message)); setBusy(null); return; }
    // every date gets an empty "everyone" day so the trip is ready to fill in
    try { await fillTripDays(String(data), start, end, place); } catch { /* the days can be added later from the date strip */ }
    onCreated(String(data));
  };

  /** 上傳或貼上的內容交給 Trip醬讀成行程。 */
  const read = async () => {
    if (!supabase || !session || busy || (!file && !text.trim())) return;
    if (text.trim().length > MAX_UPLOAD_CHARS) { setErr(t("一次最多貼 30,000 個字，請分成幾次（例如一次兩三天）")); return; }
    setErr(null);
    try {
      let d = draft;
      if (!d) {
        setBusy(t("準備中…"));
        const { data, error } = await supabase.rpc("create_trip", { p_name: t("新行程（還沒完成）"), p_start: today, p_end: today, p_place: "", p_family_label: famLabel.trim(), p_my_name: myName.trim() });
        if (error) throw new Error(error.message);
        const { data: me, error: e2 } = await supabase.from("members").select("family_id").eq("trip_id", String(data)).eq("user_id", session.user.id).single();
        if (e2 || !me) { await supabase.from("trips").delete().eq("id", String(data)); throw new Error(e2?.message ?? t("建立不了，稍後再試")); }
        d = { tripId: String(data), familyId: String(me.family_id) };
        setDraft(d);
      }
      let path: string | undefined;
      if (file) { setBusy(t("上傳檔案中…")); path = await storeUpload(d.tripId, d.familyId, file); }
      setBusy(t("Trip醬讀取中，大約 20–60 秒…"));
      const res = await invoke<{ id: string; proposal: Proposal; trip?: Guess }>("parse-upload", { trip_id: d.tripId, path, text: text.trim() || undefined, lang, fresh: true });
      const range = proposalRange(res.proposal);
      if (!range) throw new Error(t("這份內容裡讀不到行程。換一個檔案，或直接貼行程文字試試"));
      const g = res.trip ?? { name: null, place: null, start_date: null, end_date: null };
      // 行程的日期至少要包住讀到的每一天
      const s = g.start_date && g.start_date < range.first ? g.start_date : range.first;
      const e = g.end_date && g.end_date > range.last ? g.end_date : range.last;
      const missing = [!g.name?.trim() && t("行程名稱"), !(g.place?.trim() || aiPlace.trim()) && t("主要城市"), !g.start_date && t("開始日期")].filter((x): x is string => !!x);
      setName((g.name ?? "").slice(0, 80)); setPlace((g.place?.trim() || aiPlace.trim()).slice(0, 200));
      setStart(s); setEnd(e);
      setParsed({ id: res.id, proposal: res.proposal, from: s, span: daysBetween(s, range.last), missing, undated: !g.start_date });
      setStartSet(false);
    } catch (e) {
      setErr(e instanceof Error ? t(e.message) : String(e));
    } finally { setBusy(null); }
  };

  /** 讀出來的行程：開始日期一改，結束日期和每一天都跟著移。 */
  const delta = parsed && start ? daysBetween(parsed.from, start) : 0;
  const pickStart = (v: string) => {
    if (parsed && v && start && end) setEnd(addDays(end, daysBetween(start, v)));
    else if (v && end < v) setEnd(v);
    setStart(v); setStartSet(true);
  };
  const minEnd = parsed && start ? addDays(start, parsed.span) : start;

  /** 補好基本資料：寫進行程，把讀到的每一天放進去。 */
  const finish = async () => {
    if (!supabase || !session || !draft || !parsed) return;
    setBusy(t("建立中…")); setErr(null);
    try {
      const { data, error } = await supabase.from("trips").update({ name: name.trim().slice(0, 80), place: place.trim().slice(0, 200), start_date: start, end_date: end }).eq("id", draft.tripId).select("id");
      if (error) throw new Error(error.message);
      if (!data?.length) throw new Error(t("沒有存到：你可能已經不是管理員了"));
      if (famLabel.trim()) await supabase.from("families").update({ name: famLabel.trim().slice(0, 40), label: famLabel.trim().slice(0, 40) }).eq("trip_id", draft.tripId).eq("id", draft.familyId);
      if (myName.trim()) await supabase.rpc("set_my_name", { p_trip: draft.tripId, p_name: myName.trim().slice(0, 40) });
      const p = shiftProposal(parsed.proposal, delta);
      await applyProposal(parsed.id, p, draft.tripId, [], [], session.user.id);
      try { await fillTripDays(draft.tripId, start, end, place, p.days.map((d) => d.id)); } catch { /* the days can be added later from the date strip */ }
      onCreated(draft.tripId);
    } catch (e) {
      setErr(e instanceof Error ? t(e.message) : String(e));
      setBusy(null);
    }
  };

  const basics = (
    <div className="formgrid">
      <label className={parsed && !name.trim() ? "need" : undefined}>{t("行程名稱")}<input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={t("例：2027 春天京都")} /></label>
      <label className={parsed && !place.trim() ? "need" : undefined}>{t("主要城市")}<PlaceInput tripId="" kind="city" withCountry value={place} onChange={setPlace} placeholder={t("打幾個字找城市，例：東京")} /></label>
      <label className={parsed?.undated && !startSet ? "need" : undefined}>{t("開始日期")}<input type="date" value={start} onChange={(e) => pickStart(e.target.value)} /></label>
      <label>{t("結束日期")}<input type="date" value={end} min={minEnd} onChange={(e) => setEnd(e.target.value)} /></label>
      <label>{t("你們這一家叫什麼")}<input value={famLabel} maxLength={40} onChange={(e) => setFamLabel(e.target.value)} placeholder={t("例：Lily 家")} /></label>
      <label>{t("你的名字")}<input value={myName} maxLength={40} onChange={(e) => setMyName(e.target.value)} placeholder={t("例：小明")} /></label>
    </div>
  );
  const ready = !!name.trim() && !!place.trim() && !!start && !!end && end >= minEnd;

  // ---------- 讀好了：補基本資料，看一眼內容，建立 ----------
  if (parsed) {
    return (
      <div className="panel newtrip">
        <h3>{t("補上基本資料")}</h3>
        <p className="note">{parsed.missing.length
          ? t("行程讀好了，共 {n} 天。這幾項讀不到，請補上：{list}。其他的看一下對不對。", { n: parsed.proposal.days.length, list: parsed.missing.join(t("、")) })
          : t("行程讀好了，共 {n} 天。基本資料看一下對不對，要改可以直接改。", { n: parsed.proposal.days.length })}</p>
        {basics}
        {parsed.undated && <p className="note">{t("內容裡沒有日期：選好開始日期，每一天會照順序排下去。")}</p>}
        {!parsed.undated && delta !== 0 && <p className="note">{delta > 0 ? t("每一天會跟著往後移 {n} 天。", { n: delta }) : t("每一天會跟著往前移 {n} 天。", { n: -delta })}</p>}
        <div className="resultbox">
          <p><b>{t("Trip醬讀出來的內容：")}</b></p>
          <ProposalDays p={shiftProposal(parsed.proposal, delta)} />
        </div>
        <div className="actions">
          <button type="button" className="btn primary" onClick={finish} disabled={!!busy || !ready}>{busy ?? t("建立行程")}</button>
          <button type="button" className="btn" onClick={() => { setParsed(null); setErr(null); }} disabled={!!busy}>{t("重新讀一次")}</button>
          <button type="button" className="btn" onClick={cancel} disabled={!!busy}>{t("取消")}</button>
        </div>
        {!ready && !busy && <p className="note">{t("行程名稱、主要城市和日期都填好才能建立。")}</p>}
        {err && <p className="err">{err}</p>}
      </div>
    );
  }

  const tabs: { id: Mode; icon: "rename" | "upload" | "spark"; label: string }[] = [
    { id: "manual", icon: "rename", label: t("自己填") },
    { id: "upload", icon: "upload", label: t("上傳行程") },
    { id: "ai", icon: "spark", label: t("請 AI 排") },
  ];
  const paste = (placeholder: string) => (
    <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} maxLength={MAX_UPLOAD_CHARS} />
  );
  const readRow = (
    <div className="actions">
      <button type="button" className="btn primary" onClick={read} disabled={!!busy || (!file && !text.trim())}>{busy ?? t("讀成行程")}</button>
      <button type="button" className="btn" onClick={cancel} disabled={!!busy}>{t("取消")}</button>
    </div>
  );

  return (
    <div className="panel newtrip">
      <h3>{t("建立新行程")}</h3>
      <div className="tmtabs" role="tablist">
        {tabs.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={mode === x.id} className={mode === x.id ? "on" : undefined} onClick={() => { setMode(x.id); setErr(null); }} disabled={!!busy}>
            <MenuIcon name={x.icon} size={20} />{x.label}
          </button>
        ))}
      </div>

      {mode === "manual" && (
        <div className="tmpane">
          <p className="note">{t("建立的人就是這個行程的管理員，之後可以邀請家人、管理團員。開始到結束的每一天會先建好空白的日子，城市先填主要城市，之後每一天可以各自改。")}</p>
          {basics}
          <div className="actions">
            <button type="button" className="btn primary" onClick={create} disabled={!!busy || !ready}>{busy ?? t("建立行程")}</button>
            <button type="button" className="btn" onClick={cancel} disabled={!!busy}>{t("取消")}</button>
          </div>
        </div>
      )}

      {mode === "upload" && (
        <div className="tmpane uploadform">
          <p className="note">{t("已經有排好的行程？傳檔案、截圖、PDF，或直接貼文字。Trip醬讀出來之後，你再補上缺的基本資料（名稱、城市、日期）就建好了。")}</p>
          <label className="filepick">
            <input ref={fileRef} type="file" accept={UPLOAD_ACCEPT} onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
            <span>{file ? file.name : t("選檔案：表單 xlsx、截圖、PDF")}</span>
          </label>
          {paste(t("或直接貼行程文字，例如：12/26 15:00 到機場，17:00 飯店 check-in，18:30 晚餐 ○○…"))}
          {readRow}
        </div>
      )}

      {mode === "ai" && (
        <div className="tmpane uploadform">
          <p className="note">{t("還沒有行程？選好條件，這裡會產生一段文字。複製後貼給你平常用的 AI（ChatGPT、Gemini、Claude 都可以），再把它的回答整段貼回來。")}</p>
          <h4 className="step"><b>1</b>{t("選條件")}</h4>
          <div className="formgrid">
            <label className="wide">{t("去哪裡")}<PlaceInput tripId="" kind="city" withCountry value={aiPlace} onChange={setAiPlace} placeholder={t("打幾個字找城市，例：東京")} /></label>
            <div className="wide lucky">
              <button type="button" className="link" aria-expanded={lucky} onClick={() => setLucky((v) => !v)}><MenuIcon name="spark" size={16} />{lucky ? t("收起隨機推薦") : t("還沒決定？隨機推薦一個")}</button>
              {lucky && (
                <div className="luckybox">
                  <label>{t("地區（可以不選）")}<select value={region} onChange={(e) => setRegion(e.target.value as Region | "")}><option value="">{t("都可以")}</option>{REGIONS.map((r) => <option key={r} value={r}>{regionLabel(r)}</option>)}</select></label>
                  <fieldset className="wantpick optional">
                    <legend>{t("想玩什麼（可以不選）")}</legend>
                    <div className="chips">
                      {DEST_TAGS.map((g) => { const on = destTags.includes(g); return (
                        <button key={g} type="button" className={`chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => setDestTags(on ? destTags.filter((x) => x !== g) : [...destTags, g])}>{destTagLabel(g)}</button>
                      ); })}
                    </div>
                  </fieldset>
                  <div className="actions">
                    <button type="button" className="btn" onClick={draw}>{drawn && drawn !== "none" ? t("再抽一個") : t("幫我抽一個")}</button>
                  </div>
                  {drawn === "none" && <p className="note">{t("這個組合沒有適合的，少選一個條件再抽。")}</p>}
                  {drawn && drawn !== "none" && <p className="note drawn"><b>{lang === "en" ? drawn.en : drawn.zh}</b>{t("：")}{lang === "en" ? drawn.whyEn : drawn.whyZh}{t("。已經填到「去哪裡」，不喜歡就再抽一個，或自己改。")}</p>}
                </div>
              )}
            </div>
            <label>{t("開始日期（還沒決定可以不填）")}<input type="date" value={aiStart} onChange={(e) => setAiStart(e.target.value)} /></label>
            <label>{t("玩幾天")}<input type="number" inputMode="numeric" min={1} max={MAX_PROMPT_DAYS} value={aiDays} onChange={(e) => setAiDays(Math.min(MAX_PROMPT_DAYS, Math.max(1, Number(e.target.value) || 1)))} /></label>
            <label className="wide">{t("誰要去")}<input value={people} maxLength={120} onChange={(e) => setPeople(e.target.value)} placeholder={t("例：2 大人、2 小孩（6 歲、9 歲）")} /></label>
            <label>{t("步調")}<select value={pace} onChange={(e) => setPace(e.target.value as Pace)}>{PACES.map((p) => <option key={p} value={p}>{paceLabel(p)}</option>)}</select></label>
            <label>{t("交通")}<select value={move} onChange={(e) => setMove(e.target.value as Move)}>{MOVES.map((m) => <option key={m} value={m}>{moveLabel(m)}</option>)}</select></label>
          </div>
          <fieldset className="wantpick">
            <legend>{t("要推薦什麼（不選就是全部）")}</legend>
            <div className="chips">
              {WANTS.map((w) => { const on = want.includes(w); return (
                <button key={w} type="button" className={`chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => setWant(on ? want.filter((x) => x !== w) : [...want, w])}>{wantLabel(w)}</button>
              ); })}
            </div>
          </fieldset>
          <div className="formgrid">
            <label className="wide">{t("已經訂好的（沒有可以不填）")}<input value={booked} maxLength={300} onChange={(e) => setBooked(e.target.value)} placeholder={t("例：4/1 住京都車站前的飯店；4/3 晚上訂了壽司")} /></label>
            <label className="wide">{t("其他要求")}<input value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} placeholder={t("例：想看櫻花、不吃生食、要推嬰兒車")} /></label>
          </div>

          <h4 className="step"><b>2</b>{t("複製這段，貼給你的 AI")}</h4>
          {prompt ? (
            <>
              <textarea ref={promptRef} className="promptbox" rows={7} readOnly value={prompt} onFocus={(e) => e.currentTarget.select()} aria-label={t("給 AI 的提示")} />
              <div className="actions">
                <button type="button" className="btn primary" onClick={copyPrompt}><MenuIcon name="copy" size={18} />{copied ? t("已複製") : t("複製")}</button>
              </div>
            </>
          ) : <p className="note">{t("先填「去哪裡」，這裡就會出現可以複製的文字。")}</p>}

          <h4 className="step"><b>3</b>{t("把 AI 的回答整段貼回來")}</h4>
          {paste(t("AI 回答的那一整塊，直接貼在這裡"))}
          {readRow}
        </div>
      )}
      {err && <p className="err">{err}</p>}
    </div>
  );
}
