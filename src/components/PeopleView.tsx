import { useCallback, useEffect, useRef, useState } from "react";
import { useTrip } from "../trip";
import { canEdit, isViewer } from "../data";
import type { Day, Stop } from "../data";
import { NotReady, friendsApi } from "../friends";
import type { Person } from "../friends";
import { headcount, peopleApi, personLabel, refreshTripPeople, useTripPeople } from "../people";
import type { Household, HouseholdPerson, PersonKind, TripPerson } from "../people";
import { editDayItems, findStop } from "../dayEdit";
import { sharedFamilies, syncShared } from "../shared";
import { MenuIcon } from "./Logo";
import { t, tr } from "../i18n";

const msgOf = (e: unknown) => t(e instanceof Error ? e.message : String(e));
const DOT = t("・");
const kindText = (p: { kind: PersonKind; age: number | null }) => (p.kind === "adult" ? t("大人") : p.age !== null ? t("小孩・{age} 歲", { age: p.age }) : t("小孩"));

interface Draft { id: string | null; name: string; kind: PersonKind; age: string; birthday: string; note: string }
const blank: Draft = { id: null, name: "", kind: "child", age: "", birthday: "", note: "" };
const ageOf = (d: Draft) => (d.kind === "child" && !d.birthday && d.age.trim() !== "" ? Math.max(0, Math.min(120, Math.round(Number(d.age)) || 0)) : null);

/** Name, adult/child, age (or birthday), note: the same little form for a family member and for a guest on a trip. */
function PersonForm({ d, set, withBirthday }: { d: Draft; set: (d: Draft) => void; withBirthday: boolean }) {
  return (
    <div className="formgrid">
      <label>{t("名字")}<input value={d.name} onChange={(e) => set({ ...d, name: e.target.value })} maxLength={40} placeholder={t("例：安安")} /></label>
      <label>{t("大人或小孩")}
        <select value={d.kind} onChange={(e) => set({ ...d, kind: e.target.value as PersonKind })}>
          <option value="child">{t("小孩")}</option>
          <option value="adult">{t("大人")}</option>
        </select>
      </label>
      {d.kind === "child" && <label>{withBirthday ? t("年齡（有填生日就不用填）") : t("年齡")}<input type="number" inputMode="numeric" min={0} max={17} value={d.age} disabled={withBirthday && !!d.birthday} onChange={(e) => set({ ...d, age: e.target.value })} placeholder={t("例：7")} /></label>}
      {d.kind === "child" && withBirthday && <label>{t("生日（可空；填了年齡每年自動更新）")}<input type="date" value={d.birthday} onChange={(e) => set({ ...d, birthday: e.target.value })} /></label>}
      <label>{t("備註（可空）")}<input value={d.note} onChange={(e) => set({ ...d, note: e.target.value })} maxLength={200} placeholder={t("例：不吃牛、對花生過敏、要兒童椅")} /></label>
    </div>
  );
}

/** 帳號頁：我的家人。大人、小孩都不需要帳號；有帳號的大人連起來之後可以一起管理這份名單。 */
export function HouseholdPanel() {
  const [house, setHouse] = useState<Household | null>(null);
  const [friends, setFriends] = useState<Person[]>([]);
  const [ready, setReady] = useState<"loading" | "ok" | "notready" | "error">("loading");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const [picking, setPicking] = useState(false); // choosing a friend to add as a family member who has an account
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [h, f] = await Promise.all([peopleApi.household(), friendsApi.list().catch(() => [] as Person[])]);
      setHouse(h); setFriends(f); setReady("ok");
    } catch (e) { setReady(e instanceof NotReady ? "notready" : "error"); setMsg(msgOf(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const run = async (work: () => Promise<void>, done?: string) => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try { await work(); await load(); if (done) setMsg(done); } catch (e) { setMsg(msgOf(e)); } finally { setBusy(false); }
  };

  if (ready === "loading") return null;
  if (ready === "notready") return <div className="panel"><h3>{t("我的家人")}</h3><p className="note">{tr("這個功能要先升級資料庫才能用（管理員在電腦上跑 <code>make db-push</code>）。", { code: (c) => <code>{c}</code> })}</p></div>;
  if (ready === "error" || !house) return <div className="panel"><h3>{t("我的家人")}</h3><p className="err">{msg}</p><button type="button" className="btn" onClick={load}>{t("再試一次")}</button></div>;

  const edit = (p: HouseholdPerson) => setDraft({ id: p.id, name: p.name, kind: p.kind, age: p.birthday || p.age === null ? "" : String(p.age), birthday: p.birthday ?? "", note: p.note });
  const save = () => draft && run(async () => {
    await peopleApi.savePerson({ id: draft.id, name: draft.name.trim(), kind: draft.kind, age: ageOf(draft), birthday: draft.kind === "child" && draft.birthday ? draft.birthday : null, note: draft.note.trim() });
    setDraft(null);
  }, t("已儲存"));
  // a friend with an account joins the list in one step: make the adult, then tie it to their account (undo the first half if the second fails)
  const addFriend = (f: Person) => run(async () => {
    const id = await peopleApi.savePerson({ id: null, name: f.name, kind: "adult", age: null, birthday: null, note: "" });
    try { await peopleApi.linkAdult(id, f.user_id); }
    catch (e) { await peopleApi.removePerson(id).catch(() => { /* leave it: it shows in the list and can be removed by hand */ }); throw e; }
    setPicking(false);
  }, t("已經把 {name} 加進來，他現在也能管理這份名單", { name: f.name }));
  const accounts = house.people.filter((p) => p.user_id).length;
  const linkable = friends.filter((f) => !house.people.some((p) => p.user_id === f.user_id));

  return (
    <div className="panel admin">
      <h3>{t("我的家人（{n}）", { n: house.people.length })}</h3>
      <p className="note">{t("把會一起旅行的家人加進來，大人、小孩都可以，不需要有帳號。進到行程後勾選這趟誰會去，訂位、買票時就知道幾大幾小、小孩幾歲。生日只有你們家看得到。")}</p>
      {house.people.map((p) => (
        <div key={p.id} className="invite person">
          <span className="pname">
            <b>{p.name}{p.is_me && <span className="tag shared">{t("你")}</span>}</b>
            <small>{kindText(p)}{p.birthday && `${DOT}${t("生日 {date}", { date: p.birthday })}`}{p.note && `${DOT}${p.note}`}{p.user_id && !p.is_me && `${DOT}${t("帳號 {email}（可以一起管理這份名單）", { email: p.email ?? "" })}`}</small>
          </span>
          <button type="button" className="link" disabled={busy} onClick={() => edit(p)}>{t("編輯")}</button>
          {p.kind === "adult" && !p.user_id && linkable.length > 0 && <button type="button" className="link" disabled={busy} onClick={() => setLinking(linking === p.id ? null : p.id)}>{t("連結帳號")}</button>}
          {p.user_id && accounts > 1 && <button type="button" className="link" disabled={busy} onClick={() => { if (confirm(p.is_me ? t("離開這份家人名單？名單和你的名字都會留著，只是你不能再管理它；之後你會有一份自己的新名單。") : t("解除 {name} 的帳號連結？他會留在名單上，但不能再管理這份名單。", { name: p.name }))) run(() => peopleApi.unlink(p.id)); }}>{p.is_me ? t("離開名單") : t("解除連結")}</button>}
          {!p.user_id && <button type="button" className="link" disabled={busy} onClick={() => { if (confirm(t("把 {name} 從家人名單移除？他在各個行程的「誰會去」也會一起拿掉。", { name: p.name }))) run(() => peopleApi.removePerson(p.id)); }}>{t("移除")}</button>}
          {linking === p.id && (
            <div className="linkrow">
              <span className="note">{t("{name} 是哪一位好友？連結後他也能改這份名單。", { name: p.name })}</span>
              {linkable.map((f) => <button key={f.user_id} type="button" className="btn small" disabled={busy} onClick={() => run(async () => { await peopleApi.linkAdult(p.id, f.user_id); setLinking(null); }, t("已經把 {name} 連到 {friend} 的帳號", { name: p.name, friend: f.name }))}>{f.name}</button>)}
            </div>
          )}
        </div>
      ))}
      {draft ? (
        <>
          <PersonForm d={draft} set={setDraft} withBirthday />
          <div className="actions">
            <button type="button" className="btn primary" disabled={busy || !draft.name.trim()} onClick={save}>{busy ? t("儲存中…") : draft.id ? t("儲存") : t("加入名單")}</button>
            <button type="button" className="btn" disabled={busy} onClick={() => setDraft(null)}>{t("取消")}</button>
          </div>
        </>
      ) : picking ? (
        <div className="pickfriend">
          <p className="note">{t("選一位好友：他會以大人的身分加進名單，之後他也能修改這份名單、勾選這趟誰會去。")}</p>
          <div className="chips">
            {linkable.map((f) => <button key={f.user_id} type="button" className="btn" disabled={busy} onClick={() => addFriend(f)}>{f.name}</button>)}
          </div>
          <div className="actions"><button type="button" className="btn" disabled={busy} onClick={() => setPicking(false)}>{t("取消")}</button></div>
        </div>
      ) : (
        <>
          <div className="actions">
            <button type="button" className="btn primary" onClick={() => setDraft(blank)}>{t("＋ 加一位家人")}</button>
            {linkable.length > 0 && <button type="button" className="btn" onClick={() => setPicking(true)}>{t("＋ 加入有帳號的家人")}</button>}
          </div>
          {linkable.length === 0 && <p className="note">{t("家裡另一位大人也有帳號？先和他互加好友（下面的「我的好友碼」），這裡就會多一個「加入有帳號的家人」，加進來之後他也能管理這份名單。")}</p>}
        </>
      )}
      {msg && <p className="note" role="status">{msg}</p>}
    </div>
  );
}

/** 行程裡的「誰會去」頁（#people）：勾我們家這趟誰去、看每一家有誰、幫沒有帳號的人代填。 */
export function PeopleView({ embedded = false }: { embedded?: boolean }) {
  const { current, member, trip, openAccount } = useTrip();
  const tripId = current?.id;
  const people = useTripPeople(tripId);
  const [house, setHouse] = useState<Household | null>(null);
  const [guest, setGuest] = useState<(Draft & { family: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { peopleApi.household().then(setHouse, () => setHouse(null)); }, []);

  if (!tripId || !member) return null;
  if (people === null) return <section className="dayhead"><h2>{t("誰會去")}</h2><p className="note">{tr("這個功能要先升級資料庫才能用（管理員在電腦上跑 <code>make db-push</code>），或是現在連不上伺服器。", { code: (c) => <code>{c}</code> })}</p></section>;

  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try { await work(); await refreshTripPeople(tripId); } catch (e) { setMsg(msgOf(e)); } finally { setBusy(false); }
  };
  const going = new Set(people.filter((p) => p.mine).map((p) => p.person_id));
  const toggle = (id: string) => run(() => peopleApi.setTripPeople(tripId, (house?.people ?? []).map((p) => p.id).filter((x) => (x === id ? !going.has(x) : going.has(x)))));
  const admin = member.role === "admin";
  const mayAddFor = (fam: string) => admin || (!isViewer(member) && member.family_id === fam);
  const saveGuest = () => guest && run(async () => {
    await peopleApi.saveGuest(tripId, { id: guest.id, family: guest.family, name: guest.name.trim(), kind: guest.kind, age: ageOf(guest), note: guest.note.trim() });
    setGuest(null);
  });

  return (
    <>
      {embedded
        ? <p className="note foldnote">{t("全部 {n} 人：{detail}。訂位、買票時照這個數字；每個地點可以再選只有哪些人參加。", { n: people.length, detail: headcount(people) })}</p>
        : <section className="dayhead">
            <h2>{t("誰會去")}</h2>
            <p className="note">{t("全部 {n} 人：{detail}。訂位、買票時照這個數字；每個地點可以再選只有哪些人參加。", { n: people.length, detail: headcount(people) })}</p>
          </section>}

      <div className="panel admin">
        <h3>{t("我們家這趟誰會去")}</h3>
        {house && house.people.length > 0 ? (
          <div className="pickpeople">
            {house.people.map((p) => (
              <label key={p.id} className={going.has(p.id) ? "on" : undefined}>
                <input type="checkbox" checked={going.has(p.id)} disabled={busy} onChange={() => toggle(p.id)} />
                <span><b>{p.name}</b><small>{kindText(p)}</small></span>
              </label>
            ))}
          </div>
        ) : <p className="note">{t("你的家人名單還是空的。")}</p>}
        <p className="note">{tr("名單不對？到 <btn>帳號・好友 → 我的家人</btn> 新增或修改，改一次每個行程都會跟著更新。", { btn: (c) => <button type="button" className="link" onClick={openAccount}>{c}</button> })}</p>
      </div>

      {trip.families.map((f) => {
        const list = people.filter((p) => p.family_id === f.id);
        return (
          <div key={f.id} className="panel admin">
            <h3>{f.label}<small className="hc">{list.length ? t("{n} 人：{detail}", { n: list.length, detail: headcount(list) }) : t("還沒有人")}</small></h3>
            {list.map((p) => (
              <div key={p.id} className="invite person">
                <span className="pname"><b>{p.name}{p.guest && <span className="tag none">{t("代填")}</span>}</b><small>{kindText(p)}{p.note && `${DOT}${p.note}`}</small></span>
                {p.guest && mayAddFor(f.id) && <button type="button" className="link" disabled={busy} onClick={() => setGuest({ id: p.id, family: f.id, name: p.name, kind: p.kind, age: p.age === null ? "" : String(p.age), birthday: "", note: p.note })}>{t("編輯")}</button>}
                {(admin || (p.guest && mayAddFor(f.id))) && !p.mine && <button type="button" className="link" disabled={busy} onClick={() => { if (confirm(t("把 {name} 從這個行程拿掉？", { name: p.name }))) run(() => peopleApi.removeTripPerson(p.id)); }}>{t("拿掉")}</button>}
              </div>
            ))}
            {mayAddFor(f.id) && (guest?.family === f.id ? (
              <>
                <PersonForm d={guest} set={(d) => setGuest({ ...d, family: f.id })} withBirthday={false} />
                <div className="actions">
                  <button type="button" className="btn primary" disabled={busy || !guest.name.trim()} onClick={saveGuest}>{guest.id ? t("儲存") : t("加入#add")}</button>
                  <button type="button" className="btn" disabled={busy} onClick={() => setGuest(null)}>{t("取消")}</button>
                </div>
              </>
            ) : <button type="button" className="link" disabled={busy} onClick={() => setGuest({ ...blank, kind: "adult", family: f.id })}>{t("＋ 幫這一家代填一位（沒有帳號的人）")}</button>)}
          </div>
        );
      })}
      {msg && <p className="err" role="status">{msg}</p>}
    </>
  );
}

/** 行程頁上方的提醒：這個行程還沒選我們家誰會去。 */
export function PeopleBanner() {
  const { current, member } = useTrip();
  const people = useTripPeople(current?.id);
  if (!member || !people || people.some((p) => p.mine)) return null;
  return <a className="peoplebanner" href="#people"><MenuIcon name="people" size={20} />{t("這趟你們家誰會去？點這裡勾選，訂位時就知道幾大幾小 ›")}</a>;
}

/** The people who can be at a stop: everyone going from the families that have this stop (a shared stop: all of them; otherwise the families this day belongs to). */
export function relevantPeople(people: TripPerson[], day: Day, together: string[]) {
  if (together.length > 1) return people.filter((p) => together.includes(p.family_id));
  return day.fam ? people.filter((p) => day.fam!.includes(p.family_id)) : people;
}

/** 地點卡片上的小標籤：只有部分的人參加時顯示「3 人」。 */
export function StopPeopleChip({ stop, day }: { stop: Stop; day: Day }) {
  const { current, trip } = useTrip();
  const people = useTripPeople(current?.id);
  if (!stop.people || !people) return null;
  const all = relevantPeople(people, day, sharedFamilies(trip.days, trip.families, day.id, stop.sid));
  const n = all.filter((p) => stop.people!.includes(p.id)).length;
  if (n === all.length) return null;
  // on a day several families share: when everyone going is from one family, say which (that is the exception worth seeing)
  const going = new Set(all.filter((p) => stop.people!.includes(p.id)).map((p) => p.family_id));
  const only = new Set(all.map((p) => p.family_id)).size > 1 && going.size === 1 ? trip.families.find((f) => f.id === [...going][0])?.label : null;
  return <span className="who"><MenuIcon name="friends" size={14} />{only ? t("只有{family}（{n} 人）", { family: only, n }) : n === 1 ? t("1 人") : t("{n} 人", { n })}</span>;
}

/** 地點詳細頁：誰參加。預設全員；點名字可以拿掉或加回來。 */
export function StopPeople({ day, stop }: { day: Day; stop: Stop }) {
  const { current, member, trip, reload } = useTrip();
  const people = useTripPeople(current?.id);
  const [chosen, setChosen] = useState<string[] | undefined>(stop.people);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  // Taps are never refused: the names change at once, and one writer keeps saving the latest choice until nothing newer is waiting.
  // (The buttons used to be disabled during each save, so a quick second tap did nothing, and the reload after each save set the names back.)
  const want = useRef<{ v: string[] | undefined } | null>(null);
  const writing = useRef(false);
  const cur = useRef(chosen);
  cur.current = chosen;
  const latest = useRef({ day, stop });
  latest.current = { day, stop };
  useEffect(() => { if (!writing.current && !want.current) setChosen(stop.people); }, [stop]);
  if (!current || !people) return null;
  const all = relevantPeople(people, day, sharedFamilies(trip.days, trip.families, day.id, stop.sid));
  if (all.length === 0) return null;
  const editable = canEdit(day.fam, member);
  const on = (id: string) => !chosen || chosen.includes(id);
  const selected = all.filter((p) => on(p.id));

  const flush = async () => {
    if (writing.current) return;
    writing.current = true; setBusy(true);
    let saved = latest.current.stop.people;
    let problem: string | null = null;
    while (want.current) {
      const next = want.current.v;
      want.current = null;
      const { day: d, stop: st } = latest.current;
      const err = await editDayItems(current.id, d, (items) => {
        const i = findStop(items, st);
        if (i < 0) return null;
        const s = { ...(items[i] as Stop) };
        if (next) s.people = next; else delete s.people;
        return items.map((it, j) => (j === i ? s : it));
      });
      if (err) { if (!want.current) { problem = err; setChosen(saved); } continue; }
      saved = next;
      const warn = await syncShared(current.id, d, st.sid, { people: next ?? null });
      if (warn && !want.current) problem = warn;
    }
    writing.current = false; setBusy(false);
    await reload();
    if (problem) alert(t(problem));
  };
  const write = (next: string[] | undefined) => { setChosen(next); cur.current = next; want.current = { v: next }; void flush(); };
  const toggle = (id: string) => {
    const isOn = (x: string) => !cur.current || cur.current.includes(x); // the choice as last tapped, even if the screen has not redrawn yet
    const ids = all.map((p) => p.id).filter((x) => (x === id ? !isOn(x) : isOn(x)));
    write(ids.length === all.length ? undefined : ids); // everyone again = drop the field, so people added to the trip later are in by default
  };
  const text = t("{n} 人：{detail}", { n: selected.length, detail: headcount(selected) });
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { prompt(t("複製人數"), text); } };
  const famLabel = (id: string) => trip.families.find((f) => f.id === id)?.label ?? id;
  const fams = [...new Set(all.map((p) => p.family_id))];

  return (
    <div className="sec stoppeople">
      <h4>{t("誰參加")}</h4>
      {fams.map((f) => (
        <div key={f} className="chips">
          {fams.length > 1 && <small>{famLabel(f)}</small>}
          {all.filter((p) => p.family_id === f).map((p) => (
            editable
              ? <button key={p.id} type="button" className={`chip${on(p.id) ? " on" : ""}`} aria-pressed={on(p.id)} onClick={() => toggle(p.id)}>{personLabel(p)}</button>
              : <span key={p.id} className={`chip${on(p.id) ? " on" : ""}`}>{personLabel(p)}</span>
          ))}
        </div>
      ))}
      {editable && <p className="note">{t("預設全員參加。點名字可以拿掉或加回來。")}{" "}<button type="button" className="link" style={chosen ? undefined : { visibility: "hidden" }} tabIndex={chosen ? undefined : -1} aria-hidden={!chosen} onClick={() => write(undefined)}>{t("改回全員")}</button>{busy && <span className="saving" aria-live="polite">{t("儲存中…")}</span>}</p>}
      <p className="count"><b>{text}</b> <button type="button" className="copybtn" onClick={copy}>{copied ? t("已複製") : t("複製人數")}</button><small>{t("訂位時可以直接貼給餐廳")}</small></p>
    </div>
  );
}
