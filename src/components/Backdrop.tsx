// 會動的背景：頁面最上面一幅和 logo 同一種畫法的小風景，依行程的地點、季節、圖案自動選。
// 不是圖片檔，是現場畫的 SVG，動的部分只用 CSS（位移、旋轉），不吃電也不用下載。
// 每個人可以在「帳號・家人・好友 → 外觀」關掉（記在這支手機上）；系統設定「減少動態效果」時只顯示不動的畫面。
import { useSyncExternalStore } from "react";
import { useTrip } from "../trip";
import type { Trip } from "../data";

const KEY = "jp-backdrop";
const subs = new Set<() => void>();
const read = () => { try { return localStorage.getItem(KEY) !== "off"; } catch { return true; } };
export function setBackdropOn(on: boolean) {
  try { if (on) localStorage.removeItem(KEY); else localStorage.setItem(KEY, "off"); } catch { /* storage blocked: the choice lasts until the page is closed */ }
  subs.forEach((f) => f());
}
export const useBackdropOn = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, read);

export type Scene = "sky" | "snow" | "sakura" | "fuji" | "sea" | "lantern" | "hills";
/** Which little landscape fits this trip: the place first, then the picture the admin chose, then the season. */
export function sceneFor(trip: Pick<Trip, "name" | "place" | "start_date" | "settings"> | null): Scene {
  if (!trip) return "sky";
  const text = `${trip.name} ${trip.place}`.toLowerCase();
  const icon = trip.settings?.icon ?? "";
  const month = Number(trip.start_date.slice(5, 7));
  if (/郵輪|遊輪|cruise|海島|沖繩|夏威夷|峇里|關島|帛琉|馬爾地夫|beach|island/.test(text) || icon === "ship" || icon === "island") return "sea";
  if (/日本|東京|京都|大阪|北海道|長野|輕井澤|福岡|九州|japan|tokyo/.test(text) || ["fuji", "snowman", "onsen", "sakura", "ramen", "onigiri"].includes(icon)) {
    if (icon === "sakura" || month === 3 || month === 4) return "sakura";
    if (icon === "snowman" || month === 12 || month <= 2) return "snow";
    return "fuji";
  }
  if (/台灣|臺灣|台北|臺北|台中|台南|高雄|花蓮|taiwan/.test(text) || icon === "boba") return "lantern";
  if (icon === "tent" || icon === "mountain") return "hills";
  return "sky";
}

const Cloud = ({ x, y, s = 1, cls }: { x: number; y: number; s?: number; cls: string }) => (
  <g className={`bd-cloud ${cls}`} transform={`translate(${x} ${y}) scale(${s})`}>
    <path className="bd-o" fill="#fff" d="M10 26a12 12 0 0 1 4-23 16 16 0 0 1 30 2 11 11 0 0 1 6 21Z" />
  </g>
);
const Sun = ({ x = 326, y = 62 }: { x?: number; y?: number }) => <circle className="bd-o bd-sun" cx={x} cy={y} r="24" fill="#ffd257" />;
/** The paper plane from the logo, with the dotted line it leaves behind. */
const Plane = () => (
  <g>
    <path className="bd-trail" d="M-10 150 Q110 40 250 92" />
    <g className="bd-plane" transform="translate(250 78)">
      <path className="bd-o" fill="#fff" d="M0 16 L40 0 L26 38 L17 23 Z" />
      <path className="bd-o" fill="none" d="M17 23 L40 0" />
    </g>
  </g>
);
const Mountains = ({ cap }: { cap: boolean }) => (
  <g>
    <path className="bd-o" fill="#d5e7f4" d="M210 320 L300 140 L404 300 V320 Z" />
    <path className="bd-o" fill="#b9d9ee" d="M28 320 L150 118 Q178 96 206 118 L330 320 Z" />
    {cap && <path className="bd-o" fill="#fff" d="M150 118 Q178 96 206 118 L224 148 L204 138 L190 154 L178 138 L166 154 L152 138 L132 148 Z" />}
  </g>
);
const fall = (n: number, draw: (i: number) => React.ReactNode) => Array.from({ length: n }, (_, i) => (
  <g key={i} className="bd-fall" style={{ animationDuration: `${9 + (i % 5) * 2.3}s`, animationDelay: `${-(i * 1.7)}s` }} transform={`translate(${(i * 53) % 400} 0)`}>{draw(i)}</g>
));

export function Art({ scene }: { scene: Scene }) {
  switch (scene) {
    case "snow": return <><Sun /><Cloud x={30} y={40} cls="a" /><Mountains cap />{fall(16, (i) => <circle className="bd-o" r={2.4 + (i % 3)} fill="#fff" />)}</>;
    case "sakura": return <><Sun /><Cloud x={40} y={46} cls="a" /><Mountains cap />{fall(14, (i) => <ellipse className="bd-o bd-spin" rx={4 + (i % 2)} ry="2.6" fill="#ffc2d1" />)}</>;
    case "fuji": return <><Sun /><Cloud x={24} y={40} cls="a" /><Cloud x={250} y={104} s={0.7} cls="b" /><Mountains cap /></>;
    case "sea": return (
      <>
        <Sun x={70} y={64} /><Cloud x={220} y={36} cls="a" /><Cloud x={110} y={92} s={0.7} cls="b" />
        <g className="bd-bob" transform="translate(236 96)">
          <rect className="bd-o" x="34" y="0" width="16" height="26" rx="3" fill="#ffd257" />
          <rect className="bd-o" x="14" y="22" width="60" height="24" rx="5" fill="#fff" />
          <path className="bd-o" fill="#e9573f" d="M0 44 h88 l-10 26 a7 7 0 0 1 -6 4 h-56 a7 7 0 0 1 -6 -4 Z" />
        </g>
        {[0, 1, 2].map((r) => <path key={r} className={`bd-o bd-wave w${r}`} fill={["#a9d6ef", "#c3e2f4", "#dceef9"][r]} d={`M-80 ${160 + r * 22} q20 -14 40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 V320 H-80 Z`} />)}
      </>
    );
    case "lantern": return (
      <>
        <Cloud x={20} y={44} cls="a" /><Cloud x={250} y={30} s={0.8} cls="b" />
        <path className="bd-o" fill="#cfe9d8" d="M-10 240 Q90 140 190 202 Q270 130 410 190 V320 H-10 Z" />
        {Array.from({ length: 7 }, (_, i) => (
          <g key={i} className="bd-rise" style={{ animationDuration: `${13 + (i % 4) * 3}s`, animationDelay: `${-(i * 2.6)}s` }} transform={`translate(${30 + ((i * 97) % 340)} 0) scale(${0.7 + (i % 3) * 0.18})`}>
            <path className="bd-o" fill="#e9573f" d="M-9 -12 q9 -8 18 0 l3 20 q-12 6 -24 0 Z" />
            <rect className="bd-o" x="-6" y="8" width="12" height="5" rx="2" fill="#ffd257" />
          </g>
        ))}
      </>
    );
    case "hills": return (
      <>
        <Sun /><Cloud x={30} y={50} cls="a" /><Cloud x={210} y={90} s={0.7} cls="b" />
        <path className="bd-o" fill="#cfe9d8" d="M-10 240 Q110 110 230 190 Q300 140 410 180 V320 H-10 Z" />
        <path className="bd-o" fill="#ffd257" d="M96 196 L128 142 L160 196 Z" /><path className="bd-o" fill="#e9573f" d="M128 166 L116 196 H140 Z" />
      </>
    );
    default: return <><Sun /><Cloud x={18} y={150} cls="a" /><Cloud x={292} y={128} s={0.8} cls="b" /><Cloud x={150} y={212} s={0.6} cls="a" /><Plane /></>;
  }
}

/** Sits behind the top of every page. Purely decorative. */
export function Backdrop() {
  const { current } = useTrip();
  const on = useBackdropOn();
  if (!on) return null;
  const scene = sceneFor(current);
  return (
    <div className="backdrop" aria-hidden="true" data-scene={scene}>
      <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMin slice" focusable="false"><Art scene={scene} /></svg>
    </div>
  );
}
