import { useEffect, useRef, useState } from "react";
import type { ClipboardEvent, DragEvent, FormEvent } from "react";
import type { InfoBlock, InfoPage } from "../data";
import { Markdown, blocksToMd } from "../md";
import { CouponList, useCouponsOn } from "./Coupons";
import { invoke, supabase } from "../supabase";
import { IMAGE_BUCKET, droppedImages, removeImages, shrink } from "../images";
import { useTrip } from "../trip";

const OPEN_KEY = "jp-info-open";
/** The page that carries the live coupon list (nearby drugstores + barcode pictures) above its text. */
const COUPON_PAGE = "drug-coupons";
/** Jump to 其他資訊 and show this page (the chat's「存到其他資訊」uses it). Works whether or not the page is already open. */
export function openInfoPage(id: string) {
  try { sessionStorage.setItem(OPEN_KEY, id); } catch { /* storage blocked */ }
  window.dispatchEvent(new CustomEvent("jp-open-info", { detail: id }));
  if (location.hash !== "#info") location.hash = "#info";
}

// ---- legacy structured pages (seeded before pages became Markdown) ----
function Flow({ b }: { b: Extract<InfoBlock, { type: "flow" }> }) {
  return (
    <div className="flow">
      {b.h && <h4>{b.h}</h4>}
      <ol className="steps">
        {b.steps.map((s, i) => (
          <li key={i}>
            <span className="num" aria-hidden="true">{i + 1}</span>
            <div className="body">
              <b>{s.t}</b>
              <p>{s.d}</p>
              {b.branch && b.branch.after === i + 1 && (
                <div className="branch">
                  {b.branch.options.map((o) => (
                    <div className={`opt ${o.tone}`} key={o.label}>
                      <span className="lbl">{o.label}</span>
                      <b>{o.t}</b>
                      <p>{o.d}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Block({ b }: { b: InfoBlock }) {
  switch (b.type) {
    case "p": return <p className="lead">{b.text}</p>;
    case "list": return (<div className="sec">{b.h && <h4>{b.h}</h4>}<ul>{b.items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>);
    case "table": return (
      <div className="sec">
        {b.h && <h4>{b.h}</h4>}
        <div className="tablewrap"><table className="infotable"><thead><tr>{b.cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>{b.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div>
      </div>
    );
    case "flow": return <Flow b={b} />;
    case "sources": return (<div className="sec sources"><h4>資料來源</h4><ul>{b.items.map((s) => <li key={s.u}><a href={s.u} target="_blank" rel="noopener">{s.t}</a></li>)}</ul></div>);
  }
}

function fmtDate(s: string) {
  if (!s) return "";
  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("zh-TW");
}
const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10));

/** `seen` = the page's updated_at when editing started (null for a new page): saving checks nobody changed it since. */
interface Draft { id: string | null; title: string; body: string; seen: string | null }

// An unsaved draft survives a reload, a tap on a date, or the back swipe (it used to live only in the editor's memory).
const DRAFT_KEY = (tripId: string) => `jp-info-draft:${tripId}`;
const draftStore = {
  get(tripId: string): Draft | null { try { const v = JSON.parse(sessionStorage.getItem(DRAFT_KEY(tripId)) ?? "null"); return v && typeof v.title === "string" && typeof v.body === "string" ? v as Draft : null; } catch { return null; } },
  set(tripId: string, d: Draft | null) { try { if (d) sessionStorage.setItem(DRAFT_KEY(tripId), JSON.stringify(d)); else sessionStorage.removeItem(DRAFT_KEY(tripId)); } catch { /* storage blocked or full */ } },
};
const publicUrl = (path: string) => supabase?.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl ?? "";
const extOf = (type: string) => ({ "image/png": "png", "image/webp": "webp", "image/gif": "gif" } as Record<string, string>)[type] ?? "jpg";

/** Write or edit one page. 「✦ 幫我整理」 sends the text to the cheap formatting function (no web, no itinerary, daily cap). */
function Editor({ draft, onDone }: { draft: Draft; onDone: (id: string | null) => void }) {
  const { current, member, trip, reload } = useTrip();
  const [title, setTitle] = useState(draft.title);
  const [body, setBody] = useState(draft.body);
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [busy, setBusy] = useState<"save" | "tidy" | null>(null);
  const [uploading, setUploading] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [tidied, setTidied] = useState<string | null>(null);
  const [beforeTidy, setBeforeTidy] = useState<{ title: string; body: string } | null>(null);
  const [conflict, setConflict] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const tidyAbort = useRef<AbortController | null>(null);
  /** pictures uploaded while this editor was open: the ones that do not end up in the saved page are deleted again */
  const uploaded = useRef<string[]>([]);
  const tripId = current?.id ?? "";
  const dirty = title !== draft.title || body !== draft.body;

  // keep the draft on this device while it is unsaved; warn before a reload or closing the tab
  useEffect(() => { if (tripId && dirty) draftStore.set(tripId, { id: draft.id, title, body, seen: draft.seen }); }, [tripId, dirty, title, body, draft.id, draft.seen]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const otherBodies = () => trip.info.filter((p) => p.id !== draft.id).map((p) => p.body ?? "");
  const finish = (id: string | null) => { if (tripId) draftStore.set(tripId, null); onDone(id); };
  const cancel = () => {
    if (dirty && !confirm("還沒儲存，確定不要這些修改？")) return;
    // pictures added in this session that the page (as it was) does not use
    if (tripId) removeImages(droppedImages(uploaded.current.map((p) => `![](${publicUrl(p)})`).join(" "), draft.body, otherBodies(), tripId));
    finish(null);
  };

  /** Put a snippet where the cursor is (or at the end when previewing). */
  const insert = (snippet: string) => {
    const ta = taRef.current;
    setBody((b) => {
      const start = ta ? ta.selectionStart : b.length, end = ta ? ta.selectionEnd : b.length;
      const before = b.slice(0, start), after = b.slice(end);
      const pad = before && !/[\s|]$/.test(before) ? " " : "";
      return before + pad + snippet + (after && !/^[\s|]/.test(after) ? " " : "") + after;
    });
    setMode("write");
  };

  /** Upload pictures to this trip's folder and drop ![說明](網址) into the text; they show as thumbnails that open big. */
  const addImages = async (files: File[]) => {
    if (!supabase || !current) return;
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    setErr(null);
    setUploading((n) => n + imgs.length);
    for (const f of imgs) {
      try {
        const blob = await shrink(f);
        const path = `${current.id}/${newId()}${Date.now().toString(36)}.${extOf(blob.type)}`;
        const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, blob, { contentType: blob.type || "image/jpeg", cacheControl: "31536000" });
        if (error) throw new Error(/mime|type/i.test(error.message) ? "這種圖片格式不支援，請用 JPG 或 PNG" : error.message);
        uploaded.current.push(path);
        const url = publicUrl(path);
        const base = f.name.replace(/\.[^.]+$/, "").replace(/[[\]()]/g, "").trim();
        const alt = !base || /^(img|image|photo|dsc|pxl|screenshot|螢幕|截圖|unnamed|blob)/i.test(base) ? "圖片" : base;
        insert(`![${alt}](${url})`);
      } catch (e) { setErr(`圖片上傳失敗：${e instanceof Error ? e.message : String(e)}`); }
      finally { setUploading((n) => n - 1); }
    }
  };
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const fs = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
    if (fs.length) { e.preventDefault(); addImages(fs); }
  };
  const onDrop = (e: DragEvent<HTMLTextAreaElement>) => {
    const fs = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith("image/"));
    if (fs.length) { e.preventDefault(); addImages(fs); }
  };

  /** `asNew`: keep the text as a separate page (used when someone else changed the page meanwhile). */
  const save = async (asNew = false) => {
    if (!supabase || !current || !member || busy) return;
    const t = title.trim();
    if (!t) { setErr("要有標題"); return; }
    if (uploading > 0) { setErr("圖片還在上傳，等它傳完再儲存"); return; }
    setBusy("save"); setErr(null);
    const base = { title: asNew ? `${t}（${member.name ?? "我"}的版本）`.slice(0, 60) : t, body, blocks: null, updated_by: member.user_id, updated_by_name: member.name, updated_at: new Date().toISOString() };
    const editing = draft.id && !asNew;
    const id = editing ? draft.id! : newId();
    let error: { message: string } | null = null, saved = 1;
    if (editing) {
      // Save only if the page is still the version this editor opened with. Otherwise the other person's text would be
      // silently replaced; and a page that was deleted meanwhile (0 rows) used to look like a successful save.
      let q = supabase.from("info_pages").update(base).eq("trip_id", current.id).eq("id", id);
      if (draft.seen) q = q.eq("updated_at", draft.seen);
      const r = await q.select("id");
      error = r.error; saved = r.data?.length ?? 0;
    } else {
      const r = await supabase.from("info_pages").insert({ ...base, trip_id: current.id, id, sort: Math.max(-1, ...trip.info.map((p) => p.sort)) + 1, created_by: member.user_id });
      error = r.error;
    }
    setBusy(null);
    if (error) { setErr(error.message); return; }
    if (!saved) { setConflict(true); setErr("沒有存進去：這一頁在你編輯的時候被別人改過（或刪掉）了。你的內容還在上面，可以「另存成新的一頁」，或複製起來、取消後重新編輯。"); return; }
    // pictures this page no longer shows (taken out of the text, or uploaded and then removed) and no other page uses
    const before = [draft.body, ...uploaded.current.map((p) => `![](${publicUrl(p)})`)].join(" ");
    removeImages(droppedImages(asNew ? uploaded.current.map((p) => `![](${publicUrl(p)})`).join(" ") : before, body, otherBodies(), current.id));
    await reload();
    finish(id);
  };

  const tidy = async () => {
    if (!current || busy) return;
    const ac = new AbortController();
    tidyAbort.current = ac;
    setBusy("tidy"); setErr(null); setTidied(null);
    try {
      const r = await invoke<{ title: string; body: string; remaining: number }>("format-info", { trip_id: current.id, text: body, title: title.trim() || undefined }, { timeoutMs: 100_000, signal: ac.signal });
      setBeforeTidy({ title, body });
      setBody(r.body);
      if (!title.trim() && r.title) setTitle(r.title);
      setMode("preview");
      setTidied(`整理好了，看一下有沒有錯再儲存。今天還可以用 ${r.remaining} 次。`);
    } catch (e) { if (!ac.signal.aborted) setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); tidyAbort.current = null; }
  };
  const undoTidy = () => { if (!beforeTidy) return; setTitle(beforeTidy.title); setBody(beforeTidy.body); setBeforeTidy(null); setTidied(null); setMode("write"); };

  return (
    <form className="infoedit" onSubmit={(e: FormEvent) => { e.preventDefault(); save(); }}>
      {/* Enter in the title (the phone keyboard's "go" key) moves on to the text instead of saving an empty page */}
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="標題（例如：退稅流程、租車注意事項）" maxLength={60} required aria-label="標題"
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (!e.nativeEvent.isComposing && e.keyCode !== 229) { setMode("write"); setTimeout(() => taRef.current?.focus(), 0); } } }} />
      <div className="infoedit-bar">
        <div className="modebar" role="group" aria-label="寫或預覽">
          <button type="button" className={mode === "write" ? "on" : ""} onClick={() => setMode("write")}>寫</button>
          <button type="button" className={mode === "preview" ? "on" : ""} onClick={() => setMode("preview")}>預覽</button>
        </div>
        <span className="actions">
          <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={uploading > 0} title="上傳圖片，會變成文字旁的縮圖；也可以直接把圖貼進內容">
            {uploading > 0 ? `上傳中…（${uploading}）` : "🖼 加圖片"}
          </button>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addImages(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
          <button type="button" className="btn" onClick={tidy} disabled={!!busy || body.trim().length < 20} title="把貼進來的文字整理成條列或表格">
            {busy === "tidy" ? "整理中…" : "✦ 幫我整理"}
          </button>
        </span>
      </div>
      {mode === "write"
        ? <textarea ref={taRef} value={body} onChange={(e) => setBody(e.target.value)} rows={14} aria-label="內容" onPaste={onPaste} onDrop={onDrop}
            onDragOver={(e) => { if (Array.from(e.dataTransfer?.types ?? []).includes("Files")) e.preventDefault(); }}
            placeholder={"直接打字就好，一段一段寫。\n\n想要格式可以用：\n# 小標\n- 項目\n1. 步驟\n| 欄 | 欄 |\n[文字](網址)\n![說明](圖片網址)　← 按「加圖片」或直接貼圖"} />
        : <article className="info preview">{body.trim() ? <Markdown text={body} /> : <p className="note">還沒有內容。</p>}</article>}
      {tidied && <p className="note ok">{tidied}{beforeTidy && <> <button type="button" className="link" onClick={undoTidy}>還原成整理前的內容</button></>}</p>}
      {err && <p className="err">{err}</p>}
      <p className="note">「🖼 加圖片」或直接把圖貼進內容，會變成文字旁的小縮圖（例如商品照），點了放大。「✦ 幫我整理」會把從網站、LINE 複製來的一大段文字整理成條列或表格；它不會上網查，也不會加原文沒有的內容。每個行程每天最多 10 次，用完就自己手寫。</p>
      <div className="actions">
        <button type="submit" className="btn primary" disabled={!!busy || uploading > 0}>{busy === "save" ? "儲存中…" : uploading > 0 ? "圖片上傳中…" : "儲存"}</button>
        {conflict && <button type="button" className="btn" onClick={() => save(true)} disabled={!!busy || uploading > 0}>另存成新的一頁</button>}
        {busy === "tidy"
          ? <button type="button" className="btn" onClick={() => tidyAbort.current?.abort()}>取消整理</button>
          : <button type="button" className="btn" onClick={cancel} disabled={busy === "save"}>取消</button>}
      </div>
    </form>
  );
}

/** 其他資訊: pages anyone in the trip (except viewers) can write. Seeded pages keep their old layout until someone edits them. */
export function InfoView() {
  const { trip, member, current, reload } = useTrip();
  const pages = trip.info;
  const editable = !!member && member.role !== "viewer";
  const couponsOn = useCouponsOn();
  const [cur, setCur] = useState<string | null>(() => {
    try { const v = sessionStorage.getItem(OPEN_KEY); sessionStorage.removeItem(OPEN_KEY); return v; } catch { return null; }
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  // a draft left behind by a reload or by leaving the page: offer it back instead of losing it
  const [leftover, setLeftover] = useState<Draft | null>(() => (current && editable ? draftStore.get(current.id) : null));
  const [opening, setOpening] = useState(false);
  useEffect(() => {
    const on = (e: Event) => { setCur((e as CustomEvent<string>).detail); setDraft(null); };
    window.addEventListener("jp-open-info", on);
    return () => window.removeEventListener("jp-open-info", on);
  }, []);
  const page = pages.find((p) => p.id === cur) ?? pages[0];

  const startNew = () => { setLeftover(null); setDraft({ id: null, title: "", body: "", seen: null }); };
  const toDraft = (p: Pick<InfoPage, "id" | "title" | "body" | "blocks" | "updated_at">): Draft => ({ id: p.id, title: p.title, body: p.body?.trim() ? p.body : blocksToMd(p.blocks ?? []), seen: p.updated_at || null });
  // Start from the page as it is in the database right now, not the copy on screen (which can be minutes old):
  // editing a stale copy and saving it used to wipe out what someone else had just added.
  const startEdit = async (p: InfoPage) => {
    if (!supabase || !current || opening) return;
    setOpening(true);
    const { data, error } = await supabase.from("info_pages").select("id, title, body, blocks, updated_at").eq("trip_id", current.id).eq("id", p.id).maybeSingle();
    setOpening(false);
    if (error) { alert(`讀不到這一頁的最新內容（${error.message}），先不要編輯，等網路好一點再試`); return; }
    if (!data) { alert("這一頁已經被刪掉了"); await reload(); return; }
    setLeftover(null);
    setDraft(toDraft(data as InfoPage));
  };
  const remove = async (p: InfoPage) => {
    if (!supabase || !current || !confirm(`刪除「${p.title}」這一頁？大家都會看不到。`)) return;
    const { data, error } = await supabase.from("info_pages").delete().eq("trip_id", current.id).eq("id", p.id).select("id");
    if (error) { alert(error.message); return; }
    if (!data?.length) { alert("沒有刪掉：可能已經被別人刪了，或你沒有權限"); await reload(); return; }
    // the pictures only this page used are public files: delete them too
    removeImages(droppedImages(p.body ?? "", "", pages.filter((x) => x.id !== p.id).map((x) => x.body ?? ""), current.id));
    setCur(null);
    await reload();
  };

  return (
    <>
      <section className="dayhead">
        <div className="infohead">
          <h2>其他資訊</h2>
          {editable && !draft && <button type="button" className="btn" onClick={startNew}>＋ 新增一頁</button>}
        </div>
        <p className="note">{editable ? "大家都可以寫：入境、退稅、伴手禮、租車、要帶的東西……想到什麼就加一頁。Trip醬查到的答案也可以按「存到其他資訊」留在這裡。" : "成員整理的補充資料。"}</p>
      </section>
      {leftover && !draft && (
        <div className="notice leftover">
          <p>有一份還沒儲存的草稿：「{leftover.title || "（沒有標題）"}」。</p>
          <div className="actions">
            <button type="button" className="btn primary" onClick={() => { setDraft(leftover); setLeftover(null); }}>繼續編輯</button>
            <button type="button" className="btn" onClick={() => { if (current) draftStore.set(current.id, null); setLeftover(null); }}>丟掉</button>
          </div>
        </div>
      )}
      {draft ? (
        <Editor key={`${draft.id ?? "new"}|${draft.seen ?? ""}`} draft={draft} onDone={(id) => { setDraft(null); if (id) setCur(id); }} />
      ) : !page ? (
        <p className="note">還沒有內容。{editable && "按「＋ 新增一頁」開始。"}</p>
      ) : (
        <>
          <div className="infotabs" role="tablist" aria-label="資訊分頁">
            {pages.map((p) => <button key={p.id} type="button" role="tab" aria-selected={p.id === page.id} className={p.id === page.id ? "on" : ""} onClick={() => setCur(p.id)}>{p.title}</button>)}
          </div>
          <article className="info" key={page.id}>
            <div className="meta infometa">
              <span>更新於 {fmtDate(page.updated_at)}{page.updated_by_name ? `・${page.updated_by_name}` : ""}</span>
              {editable && (
                <span className="actions">
                  <button type="button" className="link" onClick={() => startEdit(page)} disabled={opening}>{opening ? "讀取中…" : "✎ 編輯"}</button>
                  <button type="button" className="link danger" onClick={() => remove(page)}>刪除</button>
                </span>
              )}
            </div>
            {page.id === COUPON_PAGE && couponsOn && <CouponList />}
            {page.body?.trim() ? <Markdown text={page.body} /> : (page.blocks ?? []).map((b, i) => <Block key={i} b={b} />)}
          </article>
        </>
      )}
    </>
  );
}
