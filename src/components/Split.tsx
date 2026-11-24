// 分頭行動：同一個時段，一組人去一個地方、另一組人去另一個地方。
// 存法：那幾站在行程裡排在一起、帶同一個 `par`；每一站用「誰參加」（people）記是哪一組。
import { useState } from "react";
import { useTrip } from "../trip";
import { canEdit, isLeg } from "../data";
import type { Day, Item, Stop } from "../data";
import { useTripPeople } from "../people";
import type { TripPerson } from "../people";
import { relevantPeople } from "./PeopleView";
import { editDayItems } from "../dayEdit";
import { MenuIcon } from "./Logo";
import { t, list, lang } from "../i18n";

export const splitMembers = (day: Day, par: string | undefined): Stop[] => (par ? day.items.filter((it): it is Stop => !isLeg(it) && it.par === par) : []);
export const newPar = () => "p" + Math.random().toString(36).slice(2, 10);

/** Who is in no group, who is in two, and whether the groups have been chosen at all. */
function check(all: TripPerson[], members: Stop[]) {
  const unset = members.some((m) => !m.people);
  const count = (p: TripPerson) => members.filter((m) => !m.people || m.people.includes(p.id)).length;
  return { unset, missing: unset ? [] : all.filter((p) => count(p) === 0), twice: unset ? [] : all.filter((p) => count(p) > 1) };
}

/** One line under a 分頭行動 box: everybody is in exactly one group, or who is not. */
export function SplitNote({ day, par }: { day: Day; par: string }) {
  const { current } = useTrip();
  const people = useTripPeople(current?.id);
  const members = splitMembers(day, par);
  if (!people || people.length === 0) return null;
  const all = relevantPeople(people, day, []);
  if (all.length === 0) return null;
  const { unset, missing, twice } = check(all, members);
  if (unset) return <p className="splitwarn">{t("還沒分組：點開每一站，在「誰參加」選這一組有誰。")}</p>;
  if (!missing.length && !twice.length) return <p className="splitok"><MenuIcon name="todo" size={15} />{t("{n} 個人都排到了，沒有人重複。", { n: all.length })}</p>;
  return (
    <p className="splitwarn">
      {missing.length > 0 && t("還沒排到：{names}。", { names: list(missing.map((p) => p.name)) })}
      {missing.length > 0 && twice.length > 0 && lang === "en" && " "}
      {twice.length > 0 && t("兩邊都有：{names}。", { names: list(twice.map((p) => p.name)) })}
    </p>
  );
}

/** On a card inside a 分頭行動 box: the names of this group. */
export function SplitNames({ stop, day }: { stop: Stop; day: Day }) {
  const { current } = useTrip();
  const people = useTripPeople(current?.id);
  if (!people || !stop.people) return null;
  const names = relevantPeople(people, day, []).filter((p) => stop.people!.includes(p.id)).map((p) => p.name);
  if (!names.length) return null;
  return <span className="who group">{names.length > 5 ? t("{names}…等 {n} 人", { names: list(names.slice(0, 5)), n: names.length }) : list(names)}</span>;
}

/** 地點詳細頁：這一站是分頭行動的其中一組。列出同時段的其他站，可以取消分頭。 */
export function SplitPanel({ day, stop }: { day: Day; stop: Stop }) {
  const { current, member, reload } = useTrip();
  const [busy, setBusy] = useState(false);
  if (!current || !stop.par) return null;
  const others = splitMembers(day, stop.par).filter((m) => !(m.n === stop.n && m.t === stop.t));
  if (others.length === 0) return null;
  const undo = async () => {
    if (!confirm(t("「{name}」不再是分頭行動？它會變回一般的一站（大家照順序去）。", { name: stop.n }))) return;
    setBusy(true);
    const err = await editDayItems(current.id, day, (items) => {
      const left = items.filter((it) => !isLeg(it) && it.par === stop.par && !(it.n === stop.n && it.t === stop.t)).length;
      return items.map((it): Item => {
        if (isLeg(it) || it.par !== stop.par) return it;
        // this stop leaves the group; when only one other is left, that one is no longer a group either
        if ((it.n === stop.n && it.t === stop.t) || left <= 1) { const s = { ...it }; delete s.par; return s; }
        return it;
      });
    });
    setBusy(false);
    if (err) alert(err); else await reload();
  };
  return (
    <div className="sec">
      <h4>{t("分頭行動")}</h4>
      <p>{t("同一個時段，另一組人在：{stops}", { stops: list(others.map((o) => `${o.t} ${o.n}`)) })}</p>
      <SplitNote day={day} par={stop.par} />
      {canEdit(day.fam, member) && <p className="note"><button type="button" className="link" disabled={busy} onClick={undo}>{t("不再分頭（變回一般的一站）")}</button></p>}
    </div>
  );
}
