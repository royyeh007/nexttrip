/** Time and date fields that open the device's picker instead of asking for typing. */

/** An empty date/time input is a blank box on a phone: show what it is for until something is picked. */
function Pick({ hint, empty, children }: { hint?: string; empty: boolean; children: React.ReactNode }) {
  return <span className="dtpick" data-empty={empty && hint ? "1" : "0"} data-hint={hint}>{children}</span>;
}

const pad = (v: string) => (/^\d:\d{2}$/.test(v) ? `0${v}` : /^\d{2}:\d{2}$/.test(v) ? v : "");

/** A stop's time. Kept the way the itinerary writes it: 「9:30」, not 「09:30」. */
export function TimeField({ value, onChange, hint }: { value: string; onChange: (v: string) => void; hint?: string }) {
  const v = pad(value.trim());
  return <Pick hint={hint} empty={!v}><input type="time" value={v} onChange={(e) => onChange(e.target.value.replace(/^0(\d:)/, "$1"))} /></Pick>;
}

/** A calendar date kept as YYYY-MM-DD. Something else already there (old free text) stays editable as text. */
export function DateField({ value, onChange, hint, label }: { value: string; onChange: (v: string) => void; hint?: string; label?: string }) {
  const ok = !value || /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!ok) return <input value={value} onChange={(e) => onChange(e.target.value)} aria-label={label ?? hint} />;
  return <Pick hint={hint} empty={!value}><input type="date" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label ?? hint} /></Pick>;
}

/** 「11/20」 ↔ a date near the trip: deadlines come before the trip ends, so the year is the latest one that still does. */
const dueIso = (due: string, tripEnd: string) => {
  const m = due.trim().match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const md = `${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const y = Number((tripEnd || new Date().toISOString()).slice(0, 4));
  return tripEnd && `${y}-${md}` > tripEnd ? `${y - 1}-${md}` : `${y}-${md}`;
};

/** A to-do's deadline: picked from the calendar, kept as the short 「11/20」 the list shows. Old free text stays as text. */
export function DueField({ value, onChange, tripEnd, hint }: { value: string; onChange: (v: string) => void; tripEnd: string; hint: string }) {
  const iso = value.trim() ? dueIso(value, tripEnd) : "";
  if (iso === null) return <input value={value} onChange={(e) => onChange(e.target.value)} aria-label={hint} />;
  return <Pick hint={hint} empty={!iso}><input type="date" value={iso} aria-label={hint} onChange={(e) => { const [, mo, da] = e.target.value.split("-"); onChange(mo && da ? `${Number(mo)}/${Number(da)}` : ""); }} /></Pick>;
}
