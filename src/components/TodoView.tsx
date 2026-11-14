import { useRef, useState } from "react";
import { canEdit, contactsFromDays, daysFor, isViewer } from "../data";
import type { ContactRow, FamilyId, TodoRow } from "../data";
import { supabase } from "../supabase";
import { useTrip } from "../trip";
import { HScroll } from "./HScroll";

type Scope = "mine" | "shared";
const visible = <T extends { fam: FamilyId[] | null }>(rows: T[], fam: FamilyId) => rows.filter((r) => !r.fam || r.fam.includes(fam));
const famOf = (scope: Scope, mine: FamilyId) => (scope === "shared" ? null : [mine]);

function Tag({ fam }: { fam: FamilyId[] | null }) {
  const { labelOf } = useTrip();
  return <span className={`tag ${fam ? "own" : "shared"}`}>{fam ? fam.map((f) => labelOf(f)).join("＋") : "大家一起"}</span>;
}

function ScopePick({ value, onChange, mine }: { value: Scope; onChange: (s: Scope) => void; mine: FamilyId }) {
  const { labelOf } = useTrip();
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as Scope)} aria-label="給誰看">
      <option value="mine">{labelOf(mine)}</option>
      <option value="shared">大家一起</option>
    </select>
  );
}

type Write = PromiseLike<{ error: { message: string } | null; data?: unknown[] | null }>;
/**
 * One write at a time (a second Enter while the first is still saving is ignored), and the caller learns whether it
 * worked: the forms used to clear themselves even when the save failed, and a held Enter key added the item twice.
 */
function useRun() {
  const { reload } = useTrip();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const run = async (write: () => Write): Promise<boolean> => {
    if (lock.current) return false;
    lock.current = true; setBusy(true);
    try {
      const { error, data } = await write();
      if (error) { alert(error.message); return false; }
      if (Array.isArray(data) && data.length === 0) { alert("沒有改到：這一筆可能已經被刪掉，或你沒有權限"); await reload(); return false; }
      await reload();
      return true;
    } finally { lock.current = false; setBusy(false); }
  };
  return { busy, run };
}
/** Enter that really means "submit": not the Enter that picks a candidate while typing Chinese (Safari reports that one as keyCode 229). */
const isEnter = (e: React.KeyboardEvent) => e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229;

function Todos({ fam, compact = false }: { fam: FamilyId; compact?: boolean }) {
  const { trip, member, labelOf, current, patchTrip } = useTrip();
  const mine = member!.family_id;
  const viewFam = fam;
  const rows = visible(trip.todos, viewFam);
  const [due, setDue] = useState(""); const [text, setText] = useState(""); const [scope, setScope] = useState<Scope>("mine");
  const [editing, setEditing] = useState<string | null>(null); const [eDue, setEDue] = useState(""); const [eText, setEText] = useState("");
  const { busy, run } = useRun();
  // ticks show at once and are saved in the background; a failed save puts the box back
  const [ticking, setTicking] = useState<Record<string, boolean>>({});

  const add = async () => {
    if (!supabase || !text.trim()) return;
    if (await run(() => supabase!.from("todos").insert({ trip_id: current!.id, fam: famOf(scope, mine), due: due.trim().slice(0, 60), text: text.trim().slice(0, 300), created_by: member!.user_id }))) { setDue(""); setText(""); }
  };
  const toggle = async (r: TodoRow, done: boolean) => {
    if (!supabase) return;
    setTicking((m) => ({ ...m, [r.id]: done }));
    const { data, error } = await supabase.from("todos").update({ done }).eq("id", r.id).select("id");
    if (error || !data?.length) alert(error?.message ?? "沒有改到：這一筆可能已經被刪掉，或你沒有權限");
    else patchTrip((t) => ({ ...t, todos: t.todos.map((x) => (x.id === r.id ? { ...x, done } : x)) }));
    setTicking((m) => { const next = { ...m }; delete next[r.id]; return next; });
  };
  const save = async (r: TodoRow) => { if (supabase && eText.trim() && await run(() => supabase!.from("todos").update({ due: eDue.trim().slice(0, 60), text: eText.trim().slice(0, 300) }).eq("id", r.id).select("id"))) setEditing(null); };
  const del = (r: TodoRow) => { if (supabase && confirm(`刪掉「${r.text}」？`)) run(() => supabase!.from("todos").delete().eq("id", r.id).select("id")); };

  const list = (
      <ul className="todo">
        {rows.map((r) => (
          <li key={r.id}>
            <input type="checkbox" id={`td-${r.id}`} checked={ticking[r.id] ?? r.done} disabled={r.id in ticking || !canEdit(r.fam, member)} onChange={(e) => toggle(r, e.target.checked)} />
            {editing === r.id ? (
              <div className="editrow">
                <input value={eDue} onChange={(e) => setEDue(e.target.value)} placeholder="時間（例：11/20 前）" />
                <input value={eText} onChange={(e) => setEText(e.target.value)} placeholder="要做什麼" onKeyDown={(e) => { if (isEnter(e)) save(r); }} />
                <div className="actions"><button type="button" className="btn primary" onClick={() => save(r)} disabled={busy || !eText.trim()}>儲存</button><button type="button" className="btn" onClick={() => setEditing(null)} disabled={busy}>取消</button></div>
              </div>
            ) : (
              <label htmlFor={`td-${r.id}`}>
                <span className={`when ${(ticking[r.id] ?? r.done) ? "done" : ""}`}>{r.due || "—"} <Tag fam={r.fam} /></span>
                <span className="what">{r.text}</span>
              </label>
            )}
            {editing !== r.id && canEdit(r.fam, member) && (
              <span className="rowacts">
                <button type="button" className="link" onClick={() => { setEditing(r.id); setEDue(r.due); setEText(r.text); }}>改</button>
                <button type="button" className="link" onClick={() => del(r)} disabled={busy}>刪</button>
              </span>
            )}
          </li>
        ))}
        {rows.length === 0 && <li className="note">還沒有項目。</li>}
      </ul>
  );
  if (compact) return list;
  return (
    <div className="panel">
      <h3>要訂、要搶的</h3>
      <p className="note">{viewFam === mine ? "大家一起的和你們家的都在這裡，勾選全家都看得到。" : `這是${labelOf(viewFam)}的清單；你新增的會加到自己家或大家一起。`}</p>
      {list}
      {!isViewer(member) && <div className="addrow">
        <input value={due} onChange={(e) => setDue(e.target.value)} placeholder="時間（例：11/20 前）" />
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="要做什麼" onKeyDown={(e) => { if (isEnter(e)) add(); }} />
        <ScopePick value={scope} onChange={setScope} mine={mine} />
        <button type="button" className="btn primary" onClick={add} disabled={busy || !text.trim()}>＋ 新增</button>
      </div>}
    </div>
  );
}

function Contacts({ fam, compact = false }: { fam: FamilyId; compact?: boolean }) {
  const { trip, member, current } = useTrip();
  const mine = member!.family_id;
  const viewFam = fam;
  const rows = visible(trip.contacts, viewFam);
  const [name, setName] = useState(""); const [value, setValue] = useState(""); const [scope, setScope] = useState<Scope>("mine");
  const [editing, setEditing] = useState<string | null>(null); const [eName, setEName] = useState(""); const [eValue, setEValue] = useState("");
  const { busy, run } = useRun();

  const add = async () => {
    if (!supabase || !name.trim() || !value.trim()) return;
    if (await run(() => supabase!.from("contacts").insert({ trip_id: current!.id, fam: famOf(scope, mine), name: name.trim().slice(0, 80), value: value.trim().slice(0, 200), created_by: member!.user_id }))) { setName(""); setValue(""); }
  };
  const save = async (r: ContactRow) => { if (supabase && eName.trim() && eValue.trim() && await run(() => supabase!.from("contacts").update({ name: eName.trim().slice(0, 80), value: eValue.trim().slice(0, 200) }).eq("id", r.id).select("id"))) setEditing(null); };
  const del = (r: ContactRow) => { if (supabase && confirm(`刪掉「${r.name}」？`)) run(() => supabase!.from("contacts").delete().eq("id", r.id).select("id")); };
  const href = (v: string) => (v.includes("@") ? `mailto:${v}` : /^[+\d][\d\s-]{6,}$/.test(v) ? `tel:${v.replace(/[\s-]/g, "")}` : null);

  const fromTrip = contactsFromDays(daysFor(trip.days, viewFam));
  const list = (
      <div className="contacts">
        {fromTrip.map((c) => (
          <div key={c.value} className="fromtrip">
            <span className="cname">{c.name} <span className="tag trip">{c.d} 行程</span></span>
            <span className="cval">{href(c.value) ? <a href={href(c.value)!}>{c.value}</a> : c.value}</span>
          </div>
        ))}
        {rows.map((r) => editing === r.id ? (
          <div className="editrow" key={r.id}>
            <input value={eName} onChange={(e) => setEName(e.target.value)} placeholder="名稱" />
            <input value={eValue} onChange={(e) => setEValue(e.target.value)} placeholder="電話或 email" onKeyDown={(e) => { if (isEnter(e)) save(r); }} />
            <div className="actions"><button type="button" className="btn primary" onClick={() => save(r)} disabled={busy || !eName.trim() || !eValue.trim()}>儲存</button><button type="button" className="btn" onClick={() => setEditing(null)} disabled={busy}>取消</button></div>
          </div>
        ) : (
          <div key={r.id}>
            <span className="cname">{r.name} <Tag fam={r.fam} /></span>
            <span className="cval">{href(r.value) ? <a href={href(r.value)!}>{r.value}</a> : r.value}</span>
            {canEdit(r.fam, member) && (
              <span className="rowacts">
                <button type="button" className="link" onClick={() => { setEditing(r.id); setEName(r.name); setEValue(r.value); }}>改</button>
                <button type="button" className="link" onClick={() => del(r)}>刪</button>
              </span>
            )}
          </div>
        ))}
        {rows.length === 0 && fromTrip.length === 0 && <p className="note">還沒有聯絡資料。</p>}
      </div>
  );
  if (compact) return list;
  return (
    <div className="panel">
      <h3>聯絡資料</h3>
      <p className="note">有「行程」標籤的是從行程裡的地點自動帶出來的（電話、email），行程改了會跟著變；下面可以再自己加。</p>
      {list}
      {!isViewer(member) && <div className="addrow">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="名稱（例：飯店訂房）" />
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="電話或 email" onKeyDown={(e) => { if (isEnter(e)) add(); }} />
        <ScopePick value={scope} onChange={setScope} mine={mine} />
        <button type="button" className="btn primary" onClick={add} disabled={busy || !name.trim() || !value.trim()}>＋ 新增</button>
      </div>}
    </div>
  );
}

export function TodoView() {
  const { trip, viewFam, labelOf } = useTrip();
  const [mode, setMode] = useState<"one" | "all">("one");
  return (
    <>
      <section className="dayhead"><h2>待辦與聯絡資料</h2></section>
      <div className="toolbar">
        <div className="modebar" role="group" aria-label="顯示方式">
          <button type="button" className={mode === "one" ? "on" : ""} onClick={() => setMode("one")}>只看 {labelOf(viewFam)}</button>
          <button type="button" className={mode === "all" ? "on" : ""} onClick={() => setMode("all")}>看所有家</button>
        </div>
      </div>
      {mode === "one" ? (
        <>
          <Todos fam={viewFam} />
          <Contacts fam={viewFam} />
        </>
      ) : (
        <>
          <h3 className="allh">要訂、要搶的</h3>
          <HScroll hint="← 左右滑動看每一家 →" deps={trip.todos.length}>
            {trip.families.map((f) => (
              <section className="famcol" key={f.id}>
                <header><b>{f.label}</b></header>
                <Todos fam={f.id} compact />
              </section>
            ))}
          </HScroll>
          <h3 className="allh">聯絡資料</h3>
          <HScroll hint="" deps={trip.contacts.length}>
            {trip.families.map((f) => (
              <section className="famcol" key={f.id}>
                <header><b>{f.label}</b></header>
                <Contacts fam={f.id} compact />
              </section>
            ))}
          </HScroll>
          <p className="note">要新增項目請切回「只看」模式。</p>
        </>
      )}
    </>
  );
}
