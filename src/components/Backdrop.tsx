// 會動的背景：固定在整個畫面後面、和 logo 同一種畫法的風景（天空在上、地面在畫面底部），依行程的地點、季節、圖案自動選。
// 不是圖片檔，是現場畫的 SVG，動的部分只用 CSS（位移、旋轉），不吃電也不用下載。
// 每個人可以在「帳號・家人・好友 → 外觀」關掉（記在這支手機上）；系統設定「減少動態效果」時只顯示不動的畫面。
import { useSyncExternalStore } from "react";
import { useTrip } from "../trip";
import type { Trip } from "../data";
import { BACKDROP_COLORS } from "../../supabase/functions/_shared/backdrops";
import { useLandmark } from "../backdropStore";
import { fakeNow, useNow } from "../now";

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
// ---- 畫面上是哪一天：城市（決定地標）、日期（決定季節）、那天的天氣 ----
export type Sky = "sun" | "partly" | "cloud" | "fog" | "rain" | "snow" | "storm";
export interface BackdropContext { city: string; date: string; weather: Sky | null; /** longitude of that city, when known: decides day or night there */ lon?: number | null; /** minutes that city is ahead of UTC right now, when known */ offsetMin?: number | null }
let ctx: BackdropContext = { city: "", date: "", weather: null };
/** The day page tells the backdrop what is on screen: which city, which date, and that day's weather there (null = not known yet). */
export function setBackdropContext(next: BackdropContext) {
  if (next.city === ctx.city && next.date === ctx.date && next.weather === ctx.weather && (next.lon ?? null) === (ctx.lon ?? null) && (next.offsetMin ?? null) === (ctx.offsetMin ?? null)) return;
  ctx = next; subs.forEach((f) => f());
}
const useContext = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => ctx);

export type Season = "spring" | "summer" | "autumn" | "winter";
/** The season on that date where the trip goes (the seasons are the other way round south of the equator). */
export function seasonOf(date: string, tripText: string): Season {
  const m = Number(date.slice(5, 7)) || new Date().getMonth() + 1;
  const south = /澳洲|紐西蘭|雪梨|墨爾本|布里斯本|奧克蘭|皇后鎮|南非|阿根廷|智利|秘魯|australia|new zealand/i.test(tripText);
  const north: Season = m >= 3 && m <= 5 ? "spring" : m >= 6 && m <= 8 ? "summer" : m >= 9 && m <= 11 ? "autumn" : "winter";
  return south ? ({ spring: "autumn", summer: "winter", autumn: "spring", winter: "summer" } as const)[north] : north;
}
export type Phase = "dawn" | "day" | "dusk" | "night";
/** Morning light, daytime, sunset, night: from the local time in the city on screen (minutes since midnight). */
export const phaseOf = (minutes: number): Phase => (minutes >= 300 && minutes < 420 ? "dawn" : minutes >= 420 && minutes < 990 ? "day" : minutes >= 990 && minutes < 1140 ? "dusk" : "night");

const Tree = ({ x, h = 1 }: { x: number; h?: number }) => (
  <g transform={`translate(${x} 320) scale(${h})`}>
    <rect className="bd-o" x="-4" y="-22" width="8" height="22" fill={BACKDROP_COLORS.N} />
    <path className="bd-o bd-treetop" fill={BACKDROP_COLORS.G} d="M0 -96 L24 -58 H10 L30 -22 H-30 L-10 -58 H-24 Z" />
  </g>
);
/** The little face the logo's suitcase has: two eyes, cheeks, a smile. (x, y) is the point between the eyes. */
export const Face = ({ x, y, s = 1 }: { x: number; y: number; s?: number }) => (
  <g className="bd-face" transform={`translate(${x} ${y}) scale(${s})`}>
    <ellipse cx="-27" cy="10" rx="8" ry="5.5" fill="#ffab98" /><ellipse cx="27" cy="10" rx="8" ry="5.5" fill="#ffab98" />
    <circle cx="-15" cy="0" r="5.4" fill="#1b2740" /><circle cx="15" cy="0" r="5.4" fill="#1b2740" />
    <path d="M-8 9 q8 8 16 0" fill="none" stroke="#1b2740" strokeWidth="4.6" strokeLinecap="round" />
  </g>
);
const PATH_OK = /^[MmLlHhVvCcSsQqTtAaZz0-9\s,.-]+$/;
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 5000;
const color = (v: unknown): string | null => (typeof v === "string" && v in BACKDROP_COLORS ? BACKDROP_COLORS[v as keyof typeof BACKDROP_COLORS] : null);
const path = (v: unknown): string | null => (typeof v === "string" && v.length <= 700 && PATH_OK.test(v) ? v : null);
/**
 * Draw one element from its shape list. The list can come from the database, so nothing in it is trusted:
 * only these shape kinds, only numbers where numbers go, only the palette's colours, only path commands in a path.
 * Anything else is skipped, so bad data can make an ugly picture but never run or load anything.
 */
export function ShapeArt({ shapes }: { shapes: unknown }) {
  if (!Array.isArray(shapes)) return null;
  return (
    <>
      {shapes.slice(0, 80).map((raw, i) => {
        if (!Array.isArray(raw)) return null;
        const [t, a, b, c, d, e, f] = raw as unknown[];
        const fill = color(a);
        switch (t) {
          case "r": return fill && [b, c, d, e].every(num) ? <rect key={i} className="bd-o" fill={fill} x={b as number} y={c as number} width={d as number} height={e as number} rx={num(f) ? Math.max(f, 4) : 4} /> : null;
          case "face": return [a, b, c].every(num) ? <Face key={i} x={a as number} y={b as number} s={c as number} /> : null;
          case "c": return fill && [b, c, d].every(num) ? <circle key={i} className="bd-o" fill={fill} cx={b as number} cy={c as number} r={d as number} /> : null;
          case "e": return fill && [b, c, d, e].every(num) ? <ellipse key={i} className="bd-o" fill={fill} cx={b as number} cy={c as number} rx={d as number} ry={e as number} /> : null;
          case "p": { const dd = path(b); return fill && dd ? <path key={i} className="bd-o" fill={fill} d={dd} /> : null; }
          case "l": { const dd = path(a); return dd ? <path key={i} className="bd-o" fill="none" d={dd} /> : null; }
          case "tree": return num(a) && num(b) ? <Tree key={i} x={a} h={b} /> : null;
          case "plane": return [a, b, c].every(num) ? (
            <g key={i} className="bd-plane" transform={`translate(${a} ${b}) scale(${c})`}><path className="bd-o" fill="#fff" d="M0 16 L40 0 L26 38 L17 23 Z" /><path className="bd-o" fill="none" d="M17 23 L40 0" /></g>
          ) : null;
          case "steam": return num(a) && num(b) ? <path key={i} className="bd-o bd-steam" style={{ animationDelay: `${-(i % 3) * 1.3}s` }} fill="none" d={`M${a} ${b} q-10 -14 0 -28 q10 -14 0 -28`} /> : null;
          default: return null;
        }
      })}
    </>
  );
}

const Sun = ({ x = 326, y = 150, low = false }: { x?: number; y?: number; low?: boolean }) => <g className="bd-sun"><circle className="bd-o" cx={x} cy={y} r="27" fill={low ? "#ffb057" : "#ffd257"} /><Face x={x} y={y - 3} s={0.6} /></g>;
const Moon = ({ x = 326, y = 150 }: { x?: number; y?: number }) => <g className="bd-sun"><circle className="bd-o" cx={x} cy={y} r="27" fill="#fff3c4" /><circle cx={x + 9} cy={y - 10} r="5" fill="#f0dc9a" /><circle cx={x - 12} cy={y + 12} r="3.5" fill="#f0dc9a" /><Face x={x} y={y - 2} s={0.55} /></g>;
const Stars = () => <>{Array.from({ length: 34 }, (_, i) => (
  <path key={i} className="bd-o bd-twinkle" style={{ animationDelay: `${-(i % 7) * 0.6}s` }} fill="#ffd257" transform={`translate(${LEFT + ((i * 211) % WIDTH)} ${40 + ((i * 97) % 520)}) scale(${0.5 + (i % 3) * 0.2})`} d="M0 -12 L3.5 -3.5 L12 0 L3.5 3.5 L0 12 L-3.5 3.5 L-12 0 L-3.5 -3.5 Z" />
))}</>;
/** The paper plane from the logo, with the dotted line it leaves behind. */
const Plane = () => (
  <g transform="translate(0 300)">
    {/* 虛線尾端對準飛機的中線（機頭 290,78 到機尾凹口 267,101 那條 45 度線），從機尾正後方接上來 */}
    <path className="bd-trail" d="M-10 150 Q189 179 259 109" />
    <g className="bd-plane" transform="translate(250 78)">
      <path className="bd-o" fill="#fff" d="M0 16 L40 0 L26 38 L17 23 Z" />
      <path className="bd-o" fill="none" d="M17 23 L40 0" />
    </g>
  </g>
);
/** Everything that stands on the ground is drawn near y = 120–320 and moved to the bottom of the tall canvas. */
const GROUND = "translate(0 450)";
/** The strip under the horizon, down to the bottom edge: snow, grass or sand, so what stands on the ground is not standing on nothing. */
const Floor = ({ fill }: { fill: string }) => <rect x={LEFT} y="768" width={WIDTH} height="96" fill={fill} />;
/** The same piece of ground side by side, so it reaches both edges of a wide screen. */
const Across = ({ children }: { children: React.ReactNode }) => <g transform={GROUND}>{[-2, -1, 1, 2, 0].map((k) => <g key={k} transform={`translate(${k * 420} ${Math.abs(k) % 2 ? 14 : 0})`}>{children}</g>)}</g>;
const Mountains = ({ snowy }: { snowy: boolean }) => (
  <Across>
    <path className="bd-o" fill={snowy ? "#d5e7f4" : "#cfe6d6"} d="M210 322 L300 140 L404 300 V322 Z" />
    <path className="bd-o" fill={snowy ? "#b9d9ee" : "#a8d8c0"} d="M28 322 L150 118 Q178 96 206 118 L330 322 Z" />
    <path className="bd-o" fill="#fff" d="M150 118 Q178 96 206 118 L224 148 L204 138 L190 154 L178 138 L166 154 L152 138 L132 148 Z" />
    <Face x={178} y={196} s={0.9} />
  </Across>
);
const Hills = ({ fill }: { fill: string }) => <Across><path className="bd-o" fill={fill} d="M-10 240 Q110 110 230 190 Q300 140 410 180 L420 190 V320 H-10 Z" /></Across>;
/** Things drifting down (or up) the whole screen, spread over the whole width. */
const scatter = (n: number, cls: string, base: number, draw: (i: number) => React.ReactNode) => Array.from({ length: n }, (_, i) => (
  <g key={i} className={cls} style={{ animationDuration: `${base + (i % 5) * (base / 4)}s`, animationDelay: `${-(i * (base / 7.5))}s` }} transform={`translate(${LEFT + ((i * 127) % WIDTH)} 0)`}>{draw(i)}</g>
));

const TINT: Record<Phase, [string, number] | null> = { dawn: ["#ffcfa8", 0.55], day: null, dusk: ["#ffab7a", 0.6], night: ["#24325e", 0.9] };
const GRASS: Record<Season, string> = { spring: "#dcf0d6", summer: "#cdebc5", autumn: "#f1e3bf", winter: "#e6efe2" };
export const TREE: Record<Season, string> = { spring: "#8fd9a6", summer: "#6cc48d", autumn: "#f2a65a", winter: "#a9d6bd" };

/**
 * The whole picture, back to front: the light of the time of day → sun or moon and stars → clouds (more and greyer in bad weather)
 * → the land (mountains, sea or hills, in the season's colours) → `children` (the city's landmark) → what is falling (rain, snow, petals, leaves).
 */
export function Art({ scene, phase = "day", season = "summer", weather = null, children }: { scene: Scene; phase?: Phase; season?: Season; weather?: Sky | null; children?: React.ReactNode }) {
  const mountains = scene === "snow" || scene === "sakura" || scene === "fuji";
  const cold = mountains && season === "winter";            // only places with real winters turn white
  const wet = weather === "rain" || weather === "storm";
  const snowing = weather === "snow" || (weather === null && cold);
  const overcast = wet || weather === "snow" || weather === "cloud" || weather === "fog";
  const night = phase === "night";
  const tint = TINT[phase];
  const cloudFill = overcast ? "#e4e9f0" : "#fff";
  const spots: [number, number, number, string][] = [[30, 230, 1, "a"], [520, 300, 0.9, "b"], [-250, 470, 0.7, "b"], [240, 460, 0.8, "b"], [-520, 260, 0.9, "a"], [880, 220, 1, "a"], [-60, 640, 0.6, "a"], [700, 560, 0.7, "a"], [150, 330, 1.1, "b"], [-380, 360, 1, "a"], [420, 180, 1.1, "a"], [620, 420, 0.9, "b"]];
  const clouds = spots.slice(0, overcast ? 12 : weather === "partly" ? 8 : 4);
  return (
    <>
      {tint && <rect x={LEFT} y="0" width={WIDTH} height="864" fill={tint[0]} opacity={tint[1]} />}
      {night ? <><Stars /><Moon x={scene === "sea" ? 70 : 326} /></> : !overcast && <Sun x={scene === "sea" ? 70 : 326} y={phase === "day" ? 150 : 430} low={phase !== "day"} />}
      {clouds.map(([x, y, sc, c], k) => <g key={k} className={`bd-cloud ${c}`} transform={`translate(${x} ${y}) scale(${sc})`}><path className="bd-o" fill={cloudFill} d="M10 26a12 12 0 0 1 4-23 16 16 0 0 1 30 2 11 11 0 0 1 6 21Z" />{!overcast && <Face x={30} y={13} s={0.36} />}</g>)}
      {scene === "sky" && <Plane />}
      {mountains && <><Mountains snowy={season === "winter" || season === "autumn"} /><Floor fill={cold ? "#f3f7fa" : GRASS[season]} /></>}
      {(scene === "lantern" || scene === "hills") && <><Hills fill={season === "autumn" ? "#e8dcae" : "#cfe9d8"} /><Floor fill={season === "autumn" ? "#e8dcae" : "#cfe9d8"} /></>}
      {scene === "sea" && (
        <g transform={GROUND}>
          <g className="bd-bob" transform="translate(236 96)">
            <rect className="bd-o" x="34" y="0" width="16" height="26" rx="3" fill="#ffd257" />
            <rect className="bd-o" x="14" y="22" width="60" height="24" rx="5" fill="#fff" />
            <path className="bd-o" fill="#e9573f" d="M0 44 h88 l-10 26 a7 7 0 0 1 -6 4 h-56 a7 7 0 0 1 -6 -4 Z" />
            <Face x={44} y={56} s={0.5} />
          </g>
          {[0, 1, 2].map((r) => <path key={r} className={`bd-o bd-wave w${r}`} fill={["#a9d6ef", "#c3e2f4", "#dceef9"][r]} d={`M${LEFT - 120} ${160 + r * 22} q20 -14 40 0${" t40 0".repeat(46)} V420 H${LEFT - 120} Z`} />)}
        </g>
      )}
      {children}
      {scene === "lantern" && scatter(14, "bd-rise", 30, (i) => (
        <g transform={`scale(${0.7 + (i % 3) * 0.18})`}>
          <path className="bd-o" fill="#e9573f" d="M-9 -12 q9 -8 18 0 l3 20 q-12 6 -24 0 Z" />
          <rect className="bd-o" x="-6" y="8" width="12" height="5" rx="2" fill="#ffd257" />
        </g>
      ))}
      {wet ? Array.from({ length: 90 }, (_, i) => {
        // each streak falls along its own slant (the line leans the way it moves), at its own speed and starting point
        const dur = 0.85 + (i % 6) * 0.11;
        return <g key={i} className="bd-rainfall" style={{ animationDuration: `${dur}s`, animationDelay: `${-(((i * 0.618) % 1) * dur)}s` }} transform={`translate(${LEFT + ((i * 173) % (WIDTH + 280))} 0)`}><path className="bd-rain" d={`M0 0 l${-5 - (i % 3)} ${17 + (i % 3) * 3.4}`} /></g>;
      })
        : snowing ? scatter(64, "bd-fall", 22, (i) => <circle className="bd-o" r={2.6 + (i % 3)} fill="#fff" />)
        : season === "spring" ? scatter(30, "bd-fall", 24, (i) => <ellipse className="bd-o bd-spin" rx={4 + (i % 2)} ry="2.8" fill="#ffc2d1" />)
        : season === "autumn" ? scatter(30, "bd-fall", 20, (i) => <path className="bd-o bd-spin" fill={i % 2 ? "#f2a65a" : "#e9573f"} d="M0 -6 Q6 0 0 7 Q-6 0 0 -6 Z" />)
        : null}
    </>
  );
}

/** Stays put behind every page while the content scrolls over it. Purely decorative. */
export function Backdrop() {
  const { current } = useTrip();
  const on = useBackdropOn();
  const { city, date, weather, lon, offsetMin } = useContext();
  const now = useNow();
  const mark = useLandmark(on ? current : null, city);
  if (!on) return null;
  const scene = sceneFor(current);
  const season = seasonOf(date || current?.start_date || now.date, `${current?.name ?? ""} ${current?.place ?? ""}`);
  // 白天晚上看「畫面上那一天的城市」現在幾點：一個行程可能跨好幾個時區（芝加哥那一天和東京那一天），
  // 所以不用整個行程的時區，改用那個城市的經度算當地的太陽時間（經度每 15 度差一小時）。還不知道城市在哪就用行程的時區。
  // now 每 30 秒更新一次，這裡跟著重算；用 ?now= 預覽某一天時照預覽的時間。
  const utc = new Date();
  // 知道那個城市跟 UTC 差多少（抓現在天氣時一起拿到）就用真正的當地時間；還沒拿到先用經度估。
  const shift = offsetMin ?? (lon == null ? null : Math.round(lon * 4));
  const phase = phaseOf(fakeNow() || shift == null ? now.minutes : (((utc.getUTCHours() * 60 + utc.getUTCMinutes() + shift) % 1440) + 1440) % 1440);
  return (
    <div className="backdrop" aria-hidden="true" data-scene={scene} data-landmark={mark?.id} data-phase={phase} data-season={season} data-weather={current ? weather ?? undefined : undefined}
      style={{ "--bd-tree": TREE[season] } as React.CSSProperties}>
      <svg viewBox={`${LEFT} 0 ${WIDTH} 860`} preserveAspectRatio="xMidYMax slice" focusable="false">
        <Art scene={scene} phase={phase} season={season} weather={current ? weather : null}>
          {mark && <g key={mark.id} className="bd-in" transform="translate(-30 398) scale(1.15)"><ShapeArt shapes={mark.shapes} /></g>}
        </Art>
      </svg>
    </div>
  );
}
