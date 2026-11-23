import { useCallback, useEffect, useRef, useState } from "react";
import { InviteFriends } from "./AccountView";
import { TRIP_ICONS, TripIcon, tripIconId } from "../tripIcons";
import { supabase } from "../supabase";
import { removeTripImages } from "../images";
import { useTrip } from "../trip";
import { COMMON_TZ, ROLE_LABEL } from "../data";
import { fillTripDays } from "../days";
import type { InviteRow, Member, Role } from "../data";

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // 31 symbols, no look-alikes (0/o, 1/l/i)
/** `n` random symbols, each equally likely (bytes ≥ 248 are thrown away so no symbol is favoured). */
function randomId(n: number) {
  let out = "";
  while (out.length < n) for (const b of crypto.getRandomValues(new Uint8Array(n * 2))) { if (b < 248 && out.length < n) out += ALPHABET[b % 31]; }
  return out;
}
// 16 symbols ≈ 79 bits: cannot be guessed. (The old links had 6, about 30 bits, and never expired.)
const newCode = () => randomId(16);
const isEnter = (e: React.KeyboardEvent) => e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229;
const linkOf = (code: string) => `${location.origin}${location.pathname}#invite=${code}`;

function Members() {
  const { current, member: me, trip, refreshMemberships } = useTrip();
  const [rows, setRows] = useState<Member[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!supabase || !current) return;
    const { data, error } = await supabase.from("members").select("trip_id, user_id, email, family_id, role, name, last_opened_at").eq("trip_id", current.id).order("role").order("name");
    if (error) { setLoadErr(error.message); return; } // keep the list that is on screen rather than showing 「團員（0）」
    setLoadErr(null);
    setRows((data ?? []) as Member[]);
  }, [current]);
  useEffect(() => { load(); }, [load]);
  const run = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    setBusy(true);
    const { error } = await p;
    if (error) alert(error.message); else { await load(); await refreshMemberships(); }
    setBusy(false);
  };
  const setRole = (m: Member, role: Role) => {
    if (!supabase || !current) return;
    if (m.user_id === me?.user_id && role !== "admin" && !confirm(`把自己改成「${ROLE_LABEL[role]}」？改了之後你就進不了這個管理頁，要請其他管理員幫你改回來。`)) return;
    run(supabase.from("members").update({ role }).eq("trip_id", current.id).eq("user_id", m.user_id));
  };
  const setFamily = (m: Member, family_id: string) => supabase && current && run(supabase.from("members").update({ family_id }).eq("trip_id", current.id).eq("user_id", m.user_id));
  const remove = (m: Member) => supabase && current && confirm(`把 ${m.name ?? m.email} 從這個行程移除？他可以再用邀請連結加入。`) && run(supabase.from("members").delete().eq("trip_id", current.id).eq("user_id", m.user_id));
  return (
    <div className="panel admin">
      <h3>團員（{rows.length}）</h3>
      {loadErr && <p className="err">讀不到團員名單：{loadErr} <button type="button" className="link" onClick={load}>再試一次</button></p>}
      <p className="note">管理員可以改所有人的行程、管理邀請和團員；成員只能改自己家和大家一起的日子；觀察員只能看，不能改也不能用聊天機器人。每個行程至少要有一位管理員。</p>
      {rows.map((m) => (
        <div className="row" key={m.user_id}>
          <span className="person"><b>{m.name ?? "（沒有名字）"}</b><span className="muted"> {m.email}{m.user_id === me?.user_id ? "（你）" : ""}</span></span>
          <select value={m.family_id} onChange={(e) => setFamily(m, e.target.value)} disabled={busy} aria-label="哪一家">
            {trip.families.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
          <select value={m.role} onChange={(e) => setRole(m, e.target.value as Role)} disabled={busy} aria-label="角色">
            {(["member", "admin", "viewer"] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
          <button type="button" className="link" onClick={() => remove(m)} disabled={busy || m.user_id === me?.user_id}>移除</button>
        </div>
      ))}
    </div>
  );
}

function Invites() {
  const { current, member, trip } = useTrip();
  const [rows, setRows] = useState<InviteRow[]>([]);
  const [role, setRole] = useState<Role>("member");
  const [famPreset, setFamPreset] = useState("");
  const [maxUses, setMaxUses] = useState(20);
  const [days, setDays] = useState(30);
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!supabase || !current) return;
    const { data, error } = await supabase.from("invites").select("code, role, family_id, uses, max_uses, note, expires_at, created_at").eq("trip_id", current.id).order("created_at", { ascending: false });
    if (error) { setLoadErr(error.message); return; }
    setLoadErr(null);
    setRows((data ?? []) as InviteRow[]);
  }, [current]);
  useEffect(() => { load(); }, [load]);
  // an admin link is a key to the whole trip: one person, one use, unless the admin deliberately raises it
  const pickRole = (r: Role) => { setRole(r); setMaxUses(r === "admin" ? 1 : 20); if (r === "admin") setDays(7); };
  const create = async () => {
    if (!supabase || !current || busy) return;
    setBusy(true);
    const expires_at = new Date(Date.now() + days * 86400000).toISOString();
    const { error } = await supabase.from("invites").insert({ trip_id: current.id, code: newCode(), role, family_id: famPreset || null, max_uses: maxUses, note: note.trim().slice(0, 80) || null, created_by: member?.user_id, expires_at });
    setBusy(false);
    if (error) alert(error.message); else { setNote(""); load(); }
  };
  const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" });
  /** What is wrong with an invite, if anything (shown next to it). */
  const warn = (i: InviteRow) => (i.expires_at && new Date(i.expires_at).getTime() < Date.now() ? "已過期，不能用了"
    : i.uses >= i.max_uses ? "次數用完了"
    : !i.expires_at ? "⚠ 沒有期限（舊的邀請）。建議刪掉，重新產生一個"
    : i.code.length < 12 ? "⚠ 舊的短碼，比較容易被猜到。建議刪掉，重新產生一個"
    : null);
  const del = async (code: string) => {
    if (!supabase || !confirm("刪掉這個邀請連結？已經用它加入的人不受影響。")) return;
    const { error } = await supabase.from("invites").delete().eq("code", code);
    if (error) alert(error.message); else load();
  };
  const copy = async (code: string) => {
    try { await navigator.clipboard.writeText(linkOf(code)); setCopied(code); setTimeout(() => setCopied(null), 1500); } catch { prompt("複製這個連結", linkOf(code)); }
  };
  return (
    <div className="panel admin">
      <h3>邀請連結</h3>
      <p className="note">把連結傳給家人，點開用 Google 登入、選自己是哪一家就加入了。可以先幫對方選好是哪一家，或讓他自己選／新建。</p>
      {loadErr && <p className="err">讀不到邀請清單：{loadErr} <button type="button" className="link" onClick={load}>再試一次</button></p>}
      {rows.map((i) => (
        <div className="invite" key={i.code}>
          <code>{linkOf(i.code)}</code>
          <span className="muted">
            {ROLE_LABEL[i.role]}邀請{i.family_id && `・${trip.families.find((f) => f.id === i.family_id)?.label ?? i.family_id}`}{i.note && `・${i.note}`}・用了 {i.uses}/{i.max_uses}{i.expires_at && `・${fmtDay(i.expires_at)} 到期`}
            {warn(i) && <b className="invwarn">{warn(i)}</b>}
          </span>
          <button type="button" className="btn" onClick={() => copy(i.code)}>{copied === i.code ? "已複製" : "複製"}</button>
          <button type="button" className="link" onClick={() => del(i.code)}>刪除</button>
        </div>
      ))}
      <div className="formgrid">
        <label>角色
          <select value={role} onChange={(e) => pickRole(e.target.value as Role)}>
            <option value="member">成員（可以改自己家和大家一起的）</option>
            <option value="viewer">觀察員（只能看）</option>
            <option value="admin">管理員</option>
          </select>
        </label>
        <label>先選好是哪一家（可空）
          <select value={famPreset} onChange={(e) => setFamPreset(e.target.value)}>
            <option value="">讓對方自己選或新建</option>
            {trip.families.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </label>
        <label>可用次數<input type="number" min={1} max={500} value={maxUses} onChange={(e) => setMaxUses(Math.max(1, Number(e.target.value) || 1))} /></label>
        <label>幾天後失效
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[3, 7, 14, 30, 60].map((d) => <option key={d} value={d}>{d} 天</option>)}
          </select>
        </label>
        <label>備註（可空）<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例：給 Claire 家" maxLength={80} /></label>
      </div>
      {role === "admin" && <p className="note">管理員邀請預設只能用 1 次、7 天後失效：拿到連結的人可以改所有人的行程、刪掉整個行程。對方加入後這個連結就沒用了。</p>}
      <button type="button" className="btn primary" onClick={create} disabled={busy}>{busy ? "產生中…" : "產生新的邀請連結"}</button>
    </div>
  );
}

function Families() {
  const { current, trip, reload } = useTrip();
  const [label, setLabel] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [eLabel, setELabel] = useState("");
  const [members, setMembers] = useState<Record<string, number> | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    if (!supabase || !current) return;
    supabase.from("members").select("family_id").eq("trip_id", current.id).then(({ data, error }) => {
      if (error) { setMembers(null); return; } // unknown, not "nobody": deleting a family is refused until this is known
      const n: Record<string, number> = {};
      for (const r of data ?? []) n[r.family_id] = (n[r.family_id] ?? 0) + 1;
      setMembers(n);
    });
  }, [current, trip.families]);
  /** One write at a time; true when it worked (the forms only clear themselves then). */
  const run = async (write: () => PromiseLike<{ error: { message: string; code?: string } | null }>): Promise<boolean> => {
    if (lock.current) return false;
    lock.current = true; setBusy(true);
    try {
      const { error } = await write();
      if (error) { alert(error.code === "23503" ? "刪不掉：這一家還有上傳或提案的紀錄。資料庫升級後（make db-push）就可以刪了。" : error.message); return false; }
      await reload();
      return true;
    } finally { lock.current = false; setBusy(false); }
  };
  const add = async () => {
    if (!supabase || !current || !label.trim()) return;
    const row = { trip_id: current.id, id: "f" + randomId(6), name: label.trim().slice(0, 40), label: label.trim().slice(0, 40), sort: Math.max(-1, ...trip.families.map((_, i) => i)) + 1 };
    if (await run(() => supabase!.from("families").insert(row))) setLabel("");
  };
  const save = async (id: string) => { if (supabase && current && eLabel.trim() && await run(() => supabase!.from("families").update({ label: eLabel.trim().slice(0, 40), name: eLabel.trim().slice(0, 40) }).eq("trip_id", current.id).eq("id", id))) setEditing(null); };
  const del = async (id: string, lbl: string) => {
    if (!supabase || !current) return;
    if (!members) { alert("還不知道這一家有沒有人（讀不到團員名單），等一下再試。"); return; }
    if ((members[id] ?? 0) > 0) { alert("這一家還有成員，先把他們換到別家。"); return; }
    if (trip.days.some((d) => d.fam?.includes(id))) { alert("這一家還有自己的日子，先把那些日子刪掉。"); return; }
    // their own to-dos and contacts would stay in the database but nobody could see them any more
    if (trip.todos.some((t) => t.fam?.includes(id)) || trip.contacts.some((c) => c.fam?.includes(id))) { alert("這一家還有自己的待辦或聯絡資料，先到「待辦・聯絡」刪掉。"); return; }
    if (!confirm(`刪掉「${lbl}」？指定給這一家的邀請連結也會一起刪掉。`)) return;
    // an invite that names a family that no longer exists can only fail with 「沒有這一家」
    await supabase.from("invites").delete().eq("trip_id", current.id).eq("family_id", id);
    await run(() => supabase!.from("families").delete().eq("trip_id", current.id).eq("id", id));
  };
  return (
    <div className="panel admin">
      <h3>家庭</h3>
      <p className="note">同一家的人共用一份行程。加入的人也可以在加入時自己新建一家。</p>
      {trip.families.map((f) => (
        <div className="row" key={f.id}>
          {editing === f.id ? (
            <div className="inline">
              <input value={eLabel} onChange={(e) => setELabel(e.target.value)} aria-label="名稱" onKeyDown={(e) => { if (isEnter(e) && eLabel.trim()) save(f.id); if (e.key === "Escape") setEditing(null); }} autoFocus maxLength={40} />
              <button type="button" className="btn primary" onClick={() => save(f.id)} disabled={busy || !eLabel.trim()}>儲存</button>
              <button type="button" className="btn" onClick={() => setEditing(null)}>取消</button>
            </div>
          ) : (
            <>
              <span className="person"><b>{f.label}</b><span className="muted"> {members ? `${members[f.id] ?? 0} 人` : "…"}・{f.flights.length ? f.flights.join("／") : "沒有航班"}</span></span>
              <button type="button" className="link" onClick={() => { setEditing(f.id); setELabel(f.label); }}>改名</button>
              <button type="button" className="link" onClick={() => del(f.id, f.label)} disabled={busy}>刪除</button>
              <span />
            </>
          )}
        </div>
      ))}
      <div className="addrow pair">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="新的一家，例：Iris 家" maxLength={40} onKeyDown={(e) => { if (isEnter(e)) add(); }} />
        <button type="button" className="btn primary" onClick={add} disabled={busy || !label.trim()}>＋ 新增</button>
      </div>
    </div>
  );
}

function Settings() {
  const { current, trip, reload, refreshMemberships, leaveToPicker } = useTrip();
  const [name, setName] = useState(current?.name ?? "");
  const [start, setStart] = useState(current?.start_date ?? "");
  const [end, setEnd] = useState(current?.end_date ?? "");
  const [place, setPlace] = useState(current?.place ?? "");
  const [tz, setTz] = useState(current?.tz ?? "Asia/Tokyo");
  const [icon, setIcon] = useState(tripIconId(current?.settings));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState("");
  // What the form was filled from. The trip can change while this page is open (dates widened by confirming a proposal,
  // another admin renaming it): fields the person has not touched follow along, and saving sends only what they changed.
  const base = useRef({ name: current?.name ?? "", start: current?.start_date ?? "", end: current?.end_date ?? "", place: current?.place ?? "", tz: current?.tz ?? "Asia/Tokyo", icon: tripIconId(current?.settings) });
  useEffect(() => {
    if (!current) return;
    const b = base.current, now = { name: current.name, start: current.start_date, end: current.end_date, place: current.place, tz: current.tz || "Asia/Tokyo", icon: tripIconId(current.settings) };
    if (name === b.name) setName(now.name);
    if (start === b.start) setStart(now.start);
    if (end === b.end) setEnd(now.end);
    if (place === b.place) setPlace(now.place);
    if (tz === b.tz) setTz(now.tz);
    if (icon === b.icon) setIcon(now.icon);
    base.current = now;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-sync only when the trip itself changes, not on every keystroke
  }, [current]);
  const save = async () => {
    if (!supabase || !current) return;
    const b = base.current;
    const changes: Record<string, unknown> = {};
    if (name.trim() !== b.name) changes.name = name.trim().slice(0, 80);
    if (start !== b.start) changes.start_date = start;
    if (end !== b.end) changes.end_date = end;
    if (place.trim() !== b.place) changes.place = place.trim().slice(0, 200);
    if (tz !== b.tz) changes.tz = tz;
    if (Object.keys(changes).length === 0 && icon === b.icon) { setMsg("沒有改動"); return; }
    setBusy(true); setMsg(null);
    if (icon !== b.icon) {
      // the picture lives inside `settings` next to other things (the weather places): read the row again and change only this key
      const { data: fresh, error: e0 } = await supabase.from("trips").select("settings").eq("id", current.id).single();
      if (e0) { setMsg(e0.message); setBusy(false); return; }
      changes.settings = { ...((fresh?.settings as Record<string, unknown> | null) ?? {}), icon };
    }
    const { error } = await supabase.from("trips").update(changes).eq("id", current.id);
    if (error) { setMsg(error.message); setBusy(false); return; }
    // dates extended → add the missing empty days
    let added = 0;
    try { added = await fillTripDays(current.id, start, end, place, trip.days.filter((d) => !d.fam).map((d) => d.id)); } catch { /* ignore */ }
    await Promise.all([refreshMemberships(), reload()]);
    setMsg(added ? `已儲存，補了 ${added} 個空白日子` : "已儲存");
    setBusy(false);
  };
  const destroy = async () => {
    if (!supabase || !current || confirmName.trim() !== current.name) return;
    if (!confirm(`真的要刪掉「${current.name}」？所有家庭的行程、待辦、聊天紀錄都會一起消失，無法復原。`)) return;
    setBusy(true);
    // the pictures on the info pages are public files: remove them first (afterwards nobody has the right to)
    await removeTripImages(current.id);
    const { data, error } = await supabase.from("trips").delete().eq("id", current.id).select("id");
    if (!error && !data?.length) { alert("沒有刪掉：你可能已經不是管理員了"); setBusy(false); return; }
    if (error) { alert(error.message); setBusy(false); return; }
    await refreshMemberships();
    leaveToPicker();
  };
  const zones = COMMON_TZ.includes(tz) ? COMMON_TZ : [tz, ...COMMON_TZ];
  return (
    <>
      <div className="panel admin">
        <h3>行程設定</h3>
        <p className="note">延長日期時，多出來的日子會自動補上空白的「大家一起」版本。</p>
        <div className="formgrid">
          <label>行程名稱<input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>去哪裡<input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="例：日本・東京、長野" /></label>
          <label>開始日期<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label>結束日期<input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></label>
          <label>當地時區（「現在」的線、航班日期用）
            <select value={tz} onChange={(e) => setTz(e.target.value)}>{zones.map((z) => <option key={z} value={z}>{z}</option>)}</select>
          </label>
        </div>
        <fieldset className="iconpick">
          <legend>行程圖案（顯示在行程名稱旁邊和「我的行程」的卡片上）</legend>
          <div className="icongrid">
            {TRIP_ICONS.map((i) => (
              <label key={i.id} className={i.id === icon ? "on" : undefined}>
                <input type="radio" name="tripicon" value={i.id} checked={i.id === icon} onChange={() => setIcon(i.id)} />
                <TripIcon id={i.id} size={56} />
                <span>{i.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="actions">
          <button type="button" className="btn primary" onClick={save} disabled={busy || !name.trim() || !start || !end || end < start}>{busy ? "儲存中…" : "儲存"}</button>
          {msg && <span className="note" style={{ margin: 0 }}>{msg}</span>}
        </div>
      </div>
      <div className="panel admin dangerzone">
        <h3>刪除整個行程</h3>
        <p className="note">所有人的行程、待辦、聯絡資料、上傳和聊天紀錄都會刪掉，無法復原。輸入行程名稱「{current?.name}」確認。</p>
        <div className="addrow pair">
          <input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={current?.name} />
          <button type="button" className="btn danger" onClick={destroy} disabled={busy || confirmName.trim() !== current?.name}>刪除行程</button>
        </div>
      </div>
    </>
  );
}

/** #admin — trip administration (admins only). */
export function AdminView() {
  const { member } = useTrip();
  if (member?.role !== "admin") {
    return <section className="dayhead"><h2>管理行程</h2><p className="note">只有這個行程的管理員可以進來。</p></section>;
  }
  return (
    <>
      <section className="dayhead"><h2>管理行程</h2><p className="note">團員、邀請連結、家庭和行程設定。</p></section>
      <Members />
      <Invites />
      <InviteFriends />
      <Families />
      <Settings />
    </>
  );
}
