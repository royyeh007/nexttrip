import { useCallback, useEffect, useState } from "react";
import { useTrip } from "../trip";
import { ROLE_LABEL, dotDate } from "../data";
import type { Role } from "../data";
import { supabase } from "../supabase";
import { NotReady, friendCodeOf, friendLink, friendsApi, refreshInvitations, useInvitations } from "../friends";
import type { Person, Profile, SentInvitation, TripInvitation } from "../friends";
import { TripIcon, tripIconId } from "../tripIcons";
import { LogoMark, Wordmark } from "./Logo";

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const PersonLine = ({ p }: { p: Person }) => <span className="pname"><b>{p.name}</b>{p.email && <small>{p.email}</small>}</span>;

/** 帳號・好友的獨立頁面：不屬於任何行程，從帳號選單或選行程頁進來，「返回」回到原本那一頁。 */
export function AccountPage() {
  const { closeAccount, signOut } = useTrip();
  return (
    <div className="wrap acctpage">
      <header className="hero">
        <div className="fambar">
          <button type="button" className="btn small" onClick={closeAccount}>‹ 返回</button>
          <button type="button" className="link who-am-i" onClick={signOut}>登出</button>
        </div>
        <h1 className="brand"><LogoMark size={44} /><Wordmark height={26} /></h1>
      </header>
      <AccountView />
    </div>
  );
}

/** 帳號・好友的內容：顯示名稱、好友碼、好友清單、同行的人。 */
function AccountView() {
  const { session } = useTrip();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [friends, setFriends] = useState<Person[]>([]);
  const [others, setOthers] = useState<Person[]>([]);
  const [state, setState] = useState<"loading" | "ok" | "notready" | "error">("loading");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, f, o] = await Promise.all([friendsApi.profile(), friendsApi.list(), friendsApi.coTravellers()]);
      setProfile(p); setFriends(f); setOthers(o); setName((n) => n || p.name); setState("ok");
    } catch (e) { setState(e instanceof NotReady ? "notready" : "error"); setMsg(msgOf(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  /** One action at a time; the message under the panel says what happened. */
  const run = async (work: () => Promise<string | void>) => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try { const m = await work(); await load(); if (m) setMsg(m); } catch (e) { setMsg(msgOf(e)); } finally { setBusy(false); }
  };
  const copy = async () => {
    if (!profile) return;
    try { await navigator.clipboard.writeText(friendLink(profile.friend_code)); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { prompt("複製這個好友連結", friendLink(profile.friend_code)); }
  };

  return (
    <>
      <section className="dayhead"><h2>帳號・好友</h2><p className="note">{session?.user.email}</p></section>
      {state === "loading" && <p className="note">載入中…</p>}
      {state === "notready" && <div className="panel"><p className="note">好友和帳號設定要先升級資料庫才能用（管理員在電腦上跑 <code>make db-push</code>）。</p></div>}
      {state === "error" && <div className="panel"><p className="err">{msg}</p><button type="button" className="btn" onClick={load}>再試一次</button></div>}
      {state === "ok" && profile && (
        <>
          <div className="panel admin">
            <h3>顯示名稱</h3>
            <p className="note">好友清單和你收到、送出的邀請裡，別人看到的是這個名字。每個行程裡的名字可以另外改（帳號選單 → 改我的名字）。</p>
            <div className="addrow pair">
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="例：Roy" aria-label="顯示名稱" />
              <button type="button" className="btn" disabled={busy || name.trim() === profile.name} onClick={() => run(async () => { await friendsApi.setName(name.trim()); return "已儲存"; })}>儲存</button>
            </div>
          </div>

          <div className="panel admin">
            <h3>我的好友碼</h3>
            <p className="note">把連結傳給對方，他點開、登入後你們就互為好友。之後建立行程可以直接邀他，不用再傳邀請連結。</p>
            <div className="invite">
              <code>{profile.friend_code}</code>
              <button type="button" className="btn" onClick={copy}>{copied ? "已複製" : "複製好友連結"}</button>
              <button type="button" className="link" disabled={busy} onClick={() => { if (confirm("換一個新的好友碼？舊的連結會立刻失效，已經加的好友不受影響。")) run(async () => { await friendsApi.resetCode(); return "已換成新的好友碼"; }); }}>換一個新的</button>
            </div>
            <div className="addrow pair">
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="貼上對方的好友碼或好友連結" autoCapitalize="none" autoCorrect="off" aria-label="對方的好友碼" />
              <button type="button" className="btn primary" disabled={busy || !code.trim()} onClick={() => run(async () => { const p = await friendsApi.add(friendCodeOf(code)); setCode(""); return `已經和 ${p.name} 成為好友`; })}>加好友</button>
            </div>
          </div>

          <div className="panel admin">
            <h3>好友（{friends.length}）</h3>
            {friends.length === 0 && <p className="note">還沒有好友。把上面的好友連結傳給家人朋友，或從下面「一起旅行過的人」直接加。</p>}
            {friends.map((p) => (
              <div key={p.user_id} className="invite person">
                <PersonLine p={p} />
                <button type="button" className="link" disabled={busy} onClick={() => { if (confirm(`解除和 ${p.name} 的好友關係？你們還在同一個行程的話，行程不受影響。`)) run(async () => { await friendsApi.remove(p.user_id); }); }}>解除好友</button>
              </div>
            ))}
          </div>

          {others.length > 0 && (
            <div className="panel admin">
              <h3>一起旅行過的人</h3>
              <p className="note">跟你在同一個行程裡、還不是好友的人。</p>
              {others.map((p) => (
                <div key={p.user_id} className="invite person">
                  <PersonLine p={p} />
                  <button type="button" className="btn" disabled={busy} onClick={() => run(async () => { await friendsApi.addUser(p.user_id); return `已經和 ${p.name} 成為好友`; })}>＋ 加好友</button>
                </div>
              ))}
            </div>
          )}
          {msg && <p className="note" role="status">{msg}</p>}
        </>
      )}
    </>
  );
}

/** 管理頁：直接邀請好友加入這個行程；對方在「我的行程」那一頁選加入或不加入。 */
export function InviteFriends() {
  const { current, openAccount } = useTrip();
  const [friends, setFriends] = useState<Person[] | null>(null);
  const [sent, setSent] = useState<SentInvitation[]>([]);
  const [inTrip, setInTrip] = useState<Set<string>>(new Set());
  const [role, setRole] = useState<Role>("member");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const tripId = current?.id;

  const load = useCallback(async () => {
    if (!tripId || !supabase) return;
    try {
      const [f, s, m] = await Promise.all([friendsApi.list(), friendsApi.sent(tripId), supabase.from("members").select("user_id").eq("trip_id", tripId)]);
      setFriends(f); setSent(s); setInTrip(new Set((m.data ?? []).map((r) => r.user_id as string)));
    } catch (e) { if (!(e instanceof NotReady)) setMsg(msgOf(e)); setFriends(null); }
  }, [tripId]);
  useEffect(() => { load(); }, [load]);
  if (!tripId || friends === null) return null; // database not upgraded yet: the invite links above still work

  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try { await work(); await load(); } catch (e) { setMsg(msgOf(e)); } finally { setBusy(false); }
  };
  const asked = new Map(sent.map((s) => [s.user_id, s]));
  const canInvite = friends.filter((f) => !inTrip.has(f.user_id) && asked.get(f.user_id)?.status !== "pending");

  return (
    <div className="panel admin">
      <h3>邀請好友</h3>
      <p className="note">不用傳連結：對方打開網站，在「我的行程」那一頁會看到邀請，可以選加入或不加入。要先互為好友（<button type="button" className="link" onClick={openAccount}>帳號・好友</button>）。</p>
      {sent.map((s) => (
        <div key={s.id} className="invite person">
          <PersonLine p={s} />
          <span className={`status ${s.status === "pending" ? "pending" : "rejected"}`}>{s.status === "pending" ? "等對方回覆" : "對方選了不加入"}</span>
          <span className="muted">{ROLE_LABEL[s.role]}</span>
          <button type="button" className="link" disabled={busy} onClick={() => run(() => friendsApi.cancel(s.id))}>{s.status === "pending" ? "收回" : "清掉"}</button>
        </div>
      ))}
      {canInvite.length > 0 && (
        <label>邀請時的角色
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="member">成員（可以改自己家和大家一起的）</option>
            <option value="viewer">觀察員（只能看）</option>
            <option value="admin">管理員</option>
          </select>
        </label>
      )}
      {canInvite.map((p) => (
        <div key={p.user_id} className="invite person">
          <PersonLine p={p} />
          <button type="button" className="btn" disabled={busy} onClick={() => run(() => friendsApi.invite(tripId, p.user_id, role))}>{asked.has(p.user_id) ? "再邀一次" : "邀請"}</button>
        </div>
      ))}
      {friends.length === 0 && <p className="note">你還沒有好友。</p>}
      {friends.length > 0 && canInvite.length === 0 && sent.length === 0 && <p className="note">你的好友都已經在這個行程裡了。</p>}
      {msg && <p className="err">{msg}</p>}
    </div>
  );
}

function InvitationCard({ inv, onJoined }: { inv: TripInvitation; onJoined: (tripId: string) => void }) {
  const { session } = useTrip();
  const [fam, setFam] = useState<string>(inv.families.length ? "" : "new");
  const [newFam, setNewFam] = useState("");
  const [name, setName] = useState<string>(session?.user.user_metadata?.full_name ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ready = fam === "new" ? !!newFam.trim() : !!fam;
  const answer = async (accept: boolean) => {
    if (busy) return;
    if (!accept && !confirm(`不加入「${inv.trip.name}」？邀請你的人會看到你選了不加入，之後他可以再邀一次。`)) return;
    setBusy(true); setErr(null);
    try {
      const id = await friendsApi.respond(inv.id, accept, fam === "new" ? null : fam, fam === "new" ? newFam.trim() : null, name.trim() || null);
      await refreshInvitations();
      if (accept && id) onJoined(id);
    } catch (e) { setErr(msgOf(e)); setBusy(false); }
  };
  return (
    <div className="panel invitation">
      <div className="invhead">
        <TripIcon id={tripIconId(inv.trip.settings)} size={48} />
        <div>
          <h3>{inv.trip.name}</h3>
          <p className="note">{dotDate(inv.trip.start_date)} — {dotDate(inv.trip.end_date)}{inv.trip.place && ` ・ ${inv.trip.place}`}</p>
          <p className="note">{inv.invited_by ? `${inv.invited_by} 邀請你加入` : "你收到邀請"}{inv.role !== "member" && `（${ROLE_LABEL[inv.role]}${inv.role === "viewer" ? "：只能看" : ""}）`}</p>
        </div>
      </div>
      <div className="formgrid">
        <label>{inv.role === "viewer" ? "跟著看哪一家的行程" : "你是哪一家"}
          <select value={fam} onChange={(e) => setFam(e.target.value)}>
            {inv.families.length > 0 && <option value="">請選擇</option>}
            {inv.families.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            <option value="new">＋ 新的一家</option>
          </select>
        </label>
        {fam === "new" && <label>新的一家叫什麼<input value={newFam} onChange={(e) => setNewFam(e.target.value)} maxLength={40} placeholder="例：Iris 家" /></label>}
        <label>你在這個行程裡的名字<input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} /></label>
      </div>
      <div className="actions">
        <button type="button" className="btn primary" disabled={busy || !ready} onClick={() => answer(true)}>{busy ? "處理中…" : "加入"}</button>
        <button type="button" className="btn" disabled={busy} onClick={() => answer(false)}>不加入</button>
        {err && <span className="err">{err}</span>}
      </div>
    </div>
  );
}

/** 選行程頁最上面：我收到、還沒回覆的行程邀請。 */
export function MyInvitations({ onJoined }: { onJoined: (tripId: string) => void }) {
  const { session } = useTrip();
  const list = useInvitations(session?.user.id);
  if (list.length === 0) return null;
  return (
    <>
      <h2>行程邀請（{list.length}）</h2>
      {list.map((inv) => <InvitationCard key={inv.id} inv={inv} onJoined={onJoined} />)}
    </>
  );
}
