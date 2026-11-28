import { Fragment } from "react";
import { ACTION_RE, guideFor, quickStart, roleNames, roleSummary } from "../../supabase/functions/_shared/guide";
import type { GuideRole } from "../../supabase/functions/_shared/guide";
import { askClaude } from "./Chat";
import { useTrip } from "../trip";
import { MenuIcon, PersonIcon, SuitcaseIcon } from "./Logo";
import { lang, t } from "../i18n";

/**
 * The guide's text is shared with the chat helper, so it names buttons with plain characters (🧳 Trip醬, 👤 你的名字).
 * On the page those are swapped for the pictures the real buttons use, so what the guide shows is what the person will look for.
 */
const TARGET_ICON: Record<string, Parameters<typeof MenuIcon>[0]["name"]> = { switch: "switch", people: "people", admin: "admin", overview: "overview", todo: "todo", upload: "upload", info: "info", cards: "cards", pocket: "pocket" };
const SECTION_ICON: Record<string, Parameters<typeof MenuIcon>[0]["name"]> = { enter: "switch", view: "overview", edit: "rename", info: "info", cards: "cards", people: "people", pocket: "pocket", todo: "todo", admin: "admin", viewer: "eye", faq: "question" };
function Label({ target, label, size = 18 }: { target: string; label: string; size?: number }) {
  const text = label.replace(/^(🧳|👤|👪|⚙|☷|✓|↑|ⓘ|💳)\s*/u, "");
  if (target === "chat") return <><SuitcaseIcon size={size} />{text}</>;
  if (target === "menu") return <><PersonIcon size={size - 2} />{text}</>;
  if (TARGET_ICON[target]) return <><MenuIcon name={TARGET_ICON[target]} size={size} />{text}</>;
  return <>{label}</>;
}

/** Buttons inside the guide jump to the real feature: a page, the chat, the account menu, the add-day form. */
function useGo(interactive: boolean) {
  const { leaveToPicker, openAccount } = useTrip();
  return (target: string) => {
    if (!interactive) return;
    switch (target) {
      case "chat": askClaude(""); break;
      case "menu": window.dispatchEvent(new CustomEvent("jp-open-menu")); break;
      case "switch": leaveToPicker(); break;
      case "pocket": openAccount("pocket"); return;
      case "addday": window.dispatchEvent(new CustomEvent("jp-add-day")); break;
      default: location.hash = `#${target}`;
    }
    if (target !== "menu") window.scrollTo({ top: 0, behavior: "smooth" });
  };
}

/** Text with `[[target|label]]` markers rendered as buttons. */
function Rich({ text, go, interactive }: { text: string; go: (t: string) => void; interactive: boolean }) {
  const parts: (string | { t: string; l: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(ACTION_RE)) {
    if (m.index! > last) parts.push(text.slice(last, m.index));
    parts.push({ t: m[1], l: m[2] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return (
    <>
      {parts.map((p, i) => typeof p === "string"
        ? <Fragment key={i}>{p}</Fragment>
        : interactive
          ? <button key={i} type="button" className="gbtn" onClick={() => go(p.t)}><Label target={p.t} label={p.l} /></button>
          : <span key={i} className="gbtn static"><Label target={p.t} label={p.l} /></span>)}
    </>
  );
}

/** The how-to page, showing only what this role can do. `compact` = the read-only version on the trip picker. */
export function GuideView({ role, compact = false }: { role: GuideRole; compact?: boolean }) {
  const sections = guideFor(role, lang);
  const go = useGo(!compact);
  return (
    <>
      {!compact && (
        <section className="dayhead">
          <h2>{t("使用教學")}</h2>
          <div className="gcard">
            <div className="grole"><span className={`tag ${role === "admin" ? "admin" : role === "viewer" ? "none" : "shared"}`}>{roleNames(lang)[role]}</span><span>{roleSummary(lang)[role]}</span></div>
            <div className="gquick">
              <small>{t("常用")}</small>
              {quickStart(lang)[role].map((a) => <button key={a.target} type="button" className="btn" onClick={() => go(a.target)}><Label target={a.target} label={a.label} size={20} /></button>)}
            </div>
          </div>
        </section>
      )}
      <div className={`guide${compact ? " compact" : ""}`}>
        {sections.map((s) => (
          <details key={s.id} className="gsec">
            <summary>
              <span className="gicon" aria-hidden="true">{s.id === "chat" ? <SuitcaseIcon size={26} /> : SECTION_ICON[s.id] ? <MenuIcon name={SECTION_ICON[s.id]} size={24} /> : s.icon}</span>
              <span className="gtitle"><h3>{s.title}</h3>{s.lead && <small><Rich text={s.lead} go={go} interactive={!compact} /></small>}</span>
              <span className="chev" aria-hidden="true">›</span>
            </summary>
            <ol className="gsteps">
              {s.items.map((it, j) => <li key={j}><Rich text={it.text} go={go} interactive={!compact} /></li>)}
            </ol>
          </details>
        ))}
        {role !== "viewer" && !compact && (
          <div className="gcard gask">
            <span>{t("還有問題？")}</span>
            <button type="button" className="btn primary" onClick={() => go("chat")}><SuitcaseIcon size={22} />{t("Trip醬：這個網站怎麼用")}</button>
          </div>
        )}
      </div>
    </>
  );
}
