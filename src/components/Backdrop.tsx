// 會動的背景：固定在整個畫面後面、和 logo 同一種畫法的風景（天空在上、地面在畫面底部），依行程的地點、季節、圖案自動選。
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

// 畫布比手機寬很多（-600 到 1000，中間 0–400 是主角）：手機只看到中間那一段，電腦的寬螢幕則看到兩邊延伸出去的山、海、雲，
// 所以不管螢幕多寬，東西都是同樣大小，不會被放大成只剩一朵雲。
const LEFT = -600, WIDTH = 1600;
const Cloud = ({ x, y, s = 1, cls }: { x: number; y: number; s?: number; cls: string }) => (
  <g className={`bd-cloud ${cls}`} transform={`translate(${x} ${y}) scale(${s})`}>
    <path className="bd-o" fill="#fff" d="M10 26a12 12 0 0 1 4-23 16 16 0 0 1 30 2 11 11 0 0 1 6 21Z" />
  </g>
);
/** Clouds at three heights, spread over the whole width. */
const Clouds = () => <>{[[-520, 260, 0.9, "a"], [-250, 470, 0.7, "b"], [-60, 640, 0.6, "a"], [30, 230, 1, "a"], [240, 460, 0.8, "b"], [520, 300, 0.9, "b"], [700, 560, 0.7, "a"], [880, 220, 1, "a"]].map(([x, y, sc, c], k) => <Cloud key={k} x={x as number} y={y as number} s={sc as number} cls={c as string} />)}</>;
const Sun = ({ x = 326, y = 150 }: { x?: number; y?: number }) => <circle className="bd-o bd-sun" cx={x} cy={y} r="24" fill="#ffd257" />;
/** The paper plane from the logo, with the dotted line it leaves behind. */
const Plane = () => (
  <g transform="translate(0 300)">
    <path className="bd-trail" d="M-10 150 Q110 40 250 92" />
    <g className="bd-plane" transform="translate(250 78)">
      <path className="bd-o" fill="#fff" d="M0 16 L40 0 L26 38 L17 23 Z" />
      <path className="bd-o" fill="none" d="M17 23 L40 0" />
    </g>
  </g>
);
/** Everything that stands on the ground is drawn near y = 120–320 and moved to the bottom of the tall canvas. */
const GROUND = "translate(0 560)";
/** The same piece of ground side by side, so it reaches both edges of a wide screen. */
const Across = ({ children }: { children: React.ReactNode }) => <g transform={GROUND}>{[-2, -1, 1, 2, 0].map((k) => <g key={k} transform={`translate(${k * 420} ${Math.abs(k) % 2 ? 14 : 0})`}>{children}</g>)}</g>;
const Mountains = () => (
  <Across>
    <path className="bd-o" fill="#d5e7f4" d="M210 320 L300 140 L404 300 V320 Z" />
    <path className="bd-o" fill="#b9d9ee" d="M28 320 L150 118 Q178 96 206 118 L330 320 Z" />
    <path className="bd-o" fill="#fff" d="M150 118 Q178 96 206 118 L224 148 L204 138 L190 154 L178 138 L166 154 L152 138 L132 148 Z" />
  </Across>
);
const Hills = () => <Across><path className="bd-o" fill="#cfe9d8" d="M-10 240 Q110 110 230 190 Q300 140 410 180 L420 190 V320 H-10 Z" /></Across>;
/** Things drifting down (or up) the whole screen, spread over the whole width. */
const scatter = (n: number, cls: string, base: number, draw: (i: number) => React.ReactNode) => Array.from({ length: n }, (_, i) => (
  <g key={i} className={cls} style={{ animationDuration: `${base + (i % 5) * (base / 4)}s`, animationDelay: `${-(i * 2.9)}s` }} transform={`translate(${LEFT + ((i * 127) % WIDTH)} 0)`}>{draw(i)}</g>
));

export function Art({ scene }: { scene: Scene }) {
  switch (scene) {
    case "snow": return <><Sun /><Clouds /><Mountains />{scatter(64, "bd-fall", 22, (i) => <circle className="bd-o" r={2.4 + (i % 3)} fill="#fff" />)}</>;
    case "sakura": return <><Sun /><Clouds /><Mountains />{scatter(56, "bd-fall", 22, (i) => <ellipse className="bd-o bd-spin" rx={4 + (i % 2)} ry="2.6" fill="#ffc2d1" />)}</>;
    case "fuji": return <><Sun /><Clouds /><Mountains /></>;
    case "sea": return (
      <>
        <Sun x={70} /><Clouds />
        <g transform={GROUND}>
          <g className="bd-bob" transform="translate(236 96)">
            <rect className="bd-o" x="34" y="0" width="16" height="26" rx="3" fill="#ffd257" />
            <rect className="bd-o" x="14" y="22" width="60" height="24" rx="5" fill="#fff" />
            <path className="bd-o" fill="#e9573f" d="M0 44 h88 l-10 26 a7 7 0 0 1 -6 4 h-56 a7 7 0 0 1 -6 -4 Z" />
          </g>
          {[0, 1, 2].map((r) => <path key={r} className={`bd-o bd-wave w${r}`} fill={["#a9d6ef", "#c3e2f4", "#dceef9"][r]} d={`M${LEFT - 120} ${160 + r * 22} q20 -14 40 0${" t40 0".repeat(46)} V320 H${LEFT - 120} Z`} />)}
        </g>
      </>
    );
    case "lantern": return (
      <>
        <Clouds /><Hills />
        {scatter(24, "bd-rise", 30, (i) => (
          <g transform={`scale(${0.7 + (i % 3) * 0.18})`}>
            <path className="bd-o" fill="#e9573f" d="M-9 -12 q9 -8 18 0 l3 20 q-12 6 -24 0 Z" />
            <rect className="bd-o" x="-6" y="8" width="12" height="5" rx="2" fill="#ffd257" />
          </g>
        ))}
      </>
    );
    case "hills": return (
      <>
        <Sun /><Clouds /><Hills />
        <g transform={GROUND}><path className="bd-o" fill="#ffd257" d="M96 196 L128 142 L160 196 Z" /><path className="bd-o" fill="#e9573f" d="M128 166 L116 196 H140 Z" /></g>
      </>
    );
    default: return <><Sun /><Clouds /><Plane /></>;
  }
}

/** Stays put behind every page while the content scrolls over it. Purely decorative. */
export function Backdrop() {
  const { current } = useTrip();
  const on = useBackdropOn();
  if (!on) return null;
  const scene = sceneFor(current);
  return (
    <div className="backdrop" aria-hidden="true" data-scene={scene}>
      <svg viewBox={`${LEFT} 0 ${WIDTH} 860`} preserveAspectRatio="xMidYMax slice" focusable="false"><Art scene={scene} /></svg>
    </div>
  );
}
