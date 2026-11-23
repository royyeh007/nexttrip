// 行程圖案：每個行程的管理員可以挑一個（存在 trips.settings.icon）。
// 和 App 圖示同一種畫法：512 的方格、深藍粗線、平塗色塊、多半有張小臉。顏色是固定的（像貼紙），不跟深色模式變。
// 要加新圖案：在 TRIP_ICONS 加一筆，圖畫在中間 110–400 的範圍內。id 存進資料庫之後不要改名。
import type { ReactNode } from "react";

const INK = "#1b2740", RED = "#e9573f", YELLOW = "#ffd257", BLUE = "#7cc4e8", PINK = "#ffab98", GREEN = "#7ccf9b", BROWN = "#c98a5b", WHITE = "#fff";
const BUTTER = "#ffe7a8", SKY = "#cfe8f7", MINT = "#d3f0df", ROSE = "#ffdcd4", LILAC = "#e4dcfb";

/** Two eyes, cheeks and a smile, centred on (x, y). */
function Face({ x, y, gap = 28, cheeks = true }: { x: number; y: number; gap?: number; cheeks?: boolean }) {
  return (
    <g stroke="none">
      {cheeks && <ellipse cx={x - gap - 22} cy={y + 20} rx="14" ry="9" fill={PINK} />}
      {cheeks && <ellipse cx={x + gap + 22} cy={y + 20} rx="14" ry="9" fill={PINK} />}
      <circle cx={x - gap} cy={y} r="9" fill={INK} />
      <circle cx={x + gap} cy={y} r="9" fill={INK} />
      <path d={`M${x - 15} ${y + 20} q15 14 30 0`} fill="none" stroke={INK} strokeWidth="8" strokeLinecap="round" />
    </g>
  );
}

export interface TripIconDef { id: string; label: string; tile: string; art: ReactNode }

export const TRIP_ICONS: TripIconDef[] = [
  { id: "suitcase", label: "行李箱", tile: BUTTER, art: (
    <g transform="rotate(-5 256 300)">
      <circle cx="188" cy="404" r="13" fill={INK} />
      <circle cx="324" cy="404" r="13" fill={INK} />
      <path d="M210 198 v-26 a22 22 0 0 1 22 -22 h48 a22 22 0 0 1 22 22 v26" fill="none" />
      <rect x="138" y="198" width="236" height="196" rx="42" fill={RED} />
      <circle cx="186" cy="348" r="17" fill={BLUE} strokeWidth="8" />
      <path d="M330 326 l7 15 16 2 -12 11 3 16 -14 -8 -14 8 3 -16 -12 -11 16 -2 z" fill={YELLOW} strokeWidth="8" />
      <Face x={256} y={276} />
    </g>
  ) },
  { id: "plane", label: "飛機", tile: SKY, art: (
    <>
      <g stroke="none" fill={WHITE}><circle cx="150" cy="380" r="22" /><circle cx="182" cy="386" r="28" /><circle cx="218" cy="384" r="20" /><circle cx="352" cy="142" r="18" /><circle cx="378" cy="146" r="14" /></g>
      <g transform="rotate(-12 256 260)">
        <path d="M152 226 L126 150 L184 150 L222 222 Z" fill={RED} />
        <rect x="112" y="212" width="292" height="104" rx="52" fill={WHITE} />
        <path d="M232 292 L196 386 L258 386 L318 296 Z" fill={RED} />
        <circle cx="176" cy="258" r="12" fill={BLUE} strokeWidth="8" />
        <circle cx="216" cy="258" r="12" fill={BLUE} strokeWidth="8" />
        <Face x={330} y={250} gap={24} />
      </g>
    </>
  ) },
  { id: "train", label: "火車", tile: SKY, art: (
    <>
      <rect x="188" y="374" width="40" height="30" rx="8" fill={INK} />
      <rect x="284" y="374" width="40" height="30" rx="8" fill={INK} />
      <rect x="148" y="130" width="216" height="252" rx="62" fill={WHITE} />
      <rect x="155" y="270" width="202" height="24" fill={BLUE} stroke="none" />
      <rect x="182" y="170" width="148" height="70" rx="22" fill={BLUE} />
      <circle cx="184" cy="340" r="11" fill={YELLOW} strokeWidth="8" />
      <circle cx="328" cy="340" r="11" fill={YELLOW} strokeWidth="8" />
      <Face x={256} y={318} gap={24} cheeks={false} />
      <path d="M132 420 h248" fill="none" />
    </>
  ) },
  { id: "car", label: "開車", tile: MINT, art: (
    <>
      <rect x="216" y="160" width="80" height="40" rx="10" fill={YELLOW} />
      <path d="M164 280 L198 204 a16 16 0 0 1 14 -8 h88 a16 16 0 0 1 14 8 L348 280 Z" fill={RED} />
      <path d="M200 268 L220 222 h72 L312 268 Z" fill={SKY} strokeWidth="9" />
      <rect x="104" y="264" width="304" height="100" rx="38" fill={RED} />
      <circle cx="176" cy="368" r="34" fill={INK} /><circle cx="176" cy="368" r="10" fill={WHITE} stroke="none" />
      <circle cx="336" cy="368" r="34" fill={INK} /><circle cx="336" cy="368" r="10" fill={WHITE} stroke="none" />
      <Face x={256} y={304} gap={24} />
    </>
  ) },
  { id: "ship", label: "郵輪", tile: SKY, art: (
    <>
      <g stroke="none" fill={WHITE}><circle cx="318" cy="128" r="18" /><circle cx="344" cy="112" r="13" /></g>
      <rect x="232" y="152" width="52" height="84" rx="10" fill={YELLOW} />
      <rect x="160" y="226" width="192" height="80" rx="16" fill={WHITE} />
      <circle cx="204" cy="262" r="12" fill={BLUE} strokeWidth="8" />
      <circle cx="256" cy="262" r="12" fill={BLUE} strokeWidth="8" />
      <circle cx="308" cy="262" r="12" fill={BLUE} strokeWidth="8" />
      <path d="M104 298 h304 l-34 86 a24 24 0 0 1 -22 14 h-192 a24 24 0 0 1 -22 -14 Z" fill={RED} />
      <Face x={256} y={334} />
      <path d="M100 420 q26 -20 52 0 t52 0 t52 0 t52 0 t52 0 t52 0" fill="none" stroke={WHITE} strokeWidth="12" />
    </>
  ) },
  { id: "balloon", label: "熱氣球", tile: SKY, art: (
    <>
      <path d="M234 366 v32 M278 366 v32" fill="none" strokeWidth="9" />
      <rect x="224" y="394" width="64" height="44" rx="10" fill={BROWN} />
      <path d="M256 104 C170 104 128 170 128 228 C128 294 196 336 228 370 h56 C316 336 384 294 384 228 C384 170 342 104 256 104 Z" fill={RED} />
      <path d="M256 104 C218 150 210 300 240 370 h32 C302 300 294 150 256 104 Z" fill={YELLOW} strokeWidth="9" />
      <Face x={256} y={226} gap={34} />
    </>
  ) },
  { id: "globe", label: "環遊世界", tile: LILAC, art: (
    <>
      <circle cx="256" cy="262" r="128" fill={BLUE} />
      <path d="M176 196 q44 -34 84 -6 q16 38 -26 50 q-20 30 -50 12 q-24 -24 -8 -56 z" fill={GREEN} strokeWidth="8" />
      <path d="M296 300 q44 -16 62 16 q-6 44 -48 46 q-36 -18 -14 -62 z" fill={GREEN} strokeWidth="8" />
      <Face x={262} y={268} gap={26} />
    </>
  ) },
  { id: "fuji", label: "富士山", tile: ROSE, art: (
    <>
      <circle cx="368" cy="150" r="34" fill={RED} />
      <path d="M92 400 L204 172 Q256 132 308 172 L420 400 Z" fill={BLUE} />
      <path d="M204 172 Q256 132 308 172 L336 230 L302 208 L278 238 L256 210 L234 238 L210 208 L176 230 Z" fill={WHITE} strokeWidth="10" />
      <Face x={256} y={308} />
    </>
  ) },
  { id: "mountain", label: "爬山", tile: MINT, art: (
    <>
      <circle cx="370" cy="150" r="30" fill={YELLOW} />
      <path d="M214 396 L320 220 L416 396 Z" fill="#a9dfbd" />
      <path d="M96 396 L212 176 L328 396 Z" fill={GREEN} />
      <path d="M212 176 L246 240 L226 228 L212 250 L198 228 L178 240 Z" fill={WHITE} strokeWidth="10" />
      <Face x={212} y={318} gap={24} />
    </>
  ) },
  { id: "snowman", label: "雪人", tile: SKY, art: (
    <>
      <g stroke="none" fill={WHITE}><circle cx="136" cy="170" r="9" /><circle cx="384" cy="210" r="9" /><circle cx="150" cy="300" r="7" /><circle cx="372" cy="120" r="7" /><circle cx="392" cy="330" r="8" /></g>
      <circle cx="256" cy="336" r="90" fill={WHITE} />
      <circle cx="256" cy="204" r="66" fill={WHITE} />
      <rect x="290" y="262" width="28" height="62" rx="12" fill={RED} />
      <rect x="190" y="248" width="132" height="30" rx="15" fill={RED} />
      <circle cx="256" cy="330" r="8" fill={INK} stroke="none" /><circle cx="256" cy="366" r="8" fill={INK} stroke="none" />
      <Face x={256} y={194} gap={24} />
    </>
  ) },
  { id: "onsen", label: "溫泉", tile: MINT, art: (
    <>
      <path d="M196 236 q-18 -22 0 -44 q18 -22 0 -44 M256 236 q-18 -22 0 -44 q18 -22 0 -44 M316 236 q-18 -22 0 -44 q18 -22 0 -44" fill="none" />
      <path d="M130 290 h252 l-18 104 a22 22 0 0 1 -22 18 h-172 a22 22 0 0 1 -22 -18 Z" fill={BROWN} />
      <ellipse cx="256" cy="290" rx="126" ry="28" fill={BLUE} />
      <Face x={256} y={346} />
    </>
  ) },
  { id: "sakura", label: "賞櫻", tile: MINT, art: (
    <>
      {[0, 72, 144, 216, 288].map((a) => <ellipse key={a} cx="256" cy="170" rx="50" ry="70" fill="#ffc2d1" transform={`rotate(${a} 256 262)`} />)}
      <circle cx="256" cy="262" r="50" fill={YELLOW} />
      <Face x={256} y={254} gap={18} cheeks={false} />
    </>
  ) },
  { id: "island", label: "海島", tile: SKY, art: (
    <>
      <path d="M112 400 Q256 280 400 400 Z" fill={YELLOW} />
      <path d="M240 340 Q228 268 254 200 L282 206 Q260 270 272 338 Z" fill={BROWN} />
      <path d="M268 200 C236 132 156 146 128 212 C176 204 228 216 268 200 Z" fill={GREEN} strokeWidth="10" />
      <path d="M268 200 C300 132 380 146 408 212 C360 204 308 216 268 200 Z" fill={GREEN} strokeWidth="10" />
      <path d="M268 200 C262 150 214 108 166 112 C196 140 224 186 268 200 Z" fill={GREEN} strokeWidth="10" />
      <path d="M268 200 C274 150 322 108 370 112 C340 140 312 186 268 200 Z" fill={GREEN} strokeWidth="10" />
      <Face x={256} y={366} gap={22} cheeks={false} />
    </>
  ) },
  { id: "tent", label: "露營", tile: MINT, art: (
    <>
      <circle cx="372" cy="148" r="26" fill={YELLOW} />
      <path d="M256 150 v-40" fill="none" /><path d="M256 110 l40 14 -40 14 z" fill={RED} strokeWidth="8" />
      <path d="M108 392 L256 150 L404 392 Z" fill={YELLOW} />
      <path d="M256 268 L204 392 L308 392 Z" fill={RED} />
      <Face x={256} y={222} gap={18} cheeks={false} />
      <path d="M92 392 h328" fill="none" />
    </>
  ) },
  { id: "castle", label: "樂園", tile: ROSE, art: (
    <>
      <path d="M256 112 v-34" fill="none" /><path d="M256 78 l36 12 -36 12 z" fill={YELLOW} strokeWidth="8" />
      <rect x="136" y="240" width="56" height="160" fill={WHITE} />
      <rect x="320" y="240" width="56" height="160" fill={WHITE} />
      <path d="M124 244 L164 176 L204 244 Z" fill={BLUE} />
      <path d="M308 244 L348 176 L388 244 Z" fill={BLUE} />
      <rect x="220" y="180" width="72" height="100" fill={WHITE} />
      <path d="M206 184 L256 112 L306 184 Z" fill={RED} />
      <rect x="176" y="270" width="160" height="130" fill={WHITE} />
      <path d="M232 400 v-40 a24 24 0 0 1 48 0 v40 Z" fill={BROWN} />
      <Face x={256} y={298} gap={24} cheeks={false} />
    </>
  ) },
  { id: "camera", label: "拍照", tile: LILAC, art: (
    <>
      <rect x="202" y="156" width="92" height="56" rx="14" fill={BLUE} />
      <rect x="120" y="196" width="272" height="192" rx="36" fill={BLUE} />
      <rect x="326" y="222" width="38" height="24" rx="9" fill={YELLOW} strokeWidth="8" />
      <circle cx="256" cy="296" r="64" fill={WHITE} />
      <circle cx="256" cy="296" r="34" fill={INK} stroke="none" />
      <circle cx="244" cy="284" r="10" fill={WHITE} stroke="none" />
      <g stroke="none" fill={PINK}><ellipse cx="160" cy="330" rx="13" ry="9" /><ellipse cx="352" cy="330" rx="13" ry="9" /></g>
    </>
  ) },
  { id: "ramen", label: "美食", tile: BUTTER, art: (
    <>
      <path d="M306 250 L388 128 M336 256 L412 150" fill="none" strokeWidth="11" />
      <rect x="214" y="392" width="84" height="22" rx="9" fill={RED} />
      <path d="M116 270 a140 132 0 0 0 280 0 Z" fill={RED} />
      <ellipse cx="256" cy="270" rx="140" ry="34" fill="#ffe2a0" />
      <ellipse cx="212" cy="266" rx="26" ry="15" fill={WHITE} strokeWidth="8" /><circle cx="212" cy="266" r="8" fill={YELLOW} stroke="none" />
      <circle cx="286" cy="266" r="17" fill={WHITE} strokeWidth="8" /><circle cx="286" cy="266" r="6" fill={PINK} stroke="none" />
      <Face x={256} y={330} />
    </>
  ) },
  { id: "onigiri", label: "飯糰", tile: BUTTER, art: (
    <>
      <path d="M256 132 Q288 132 306 166 L386 314 Q410 372 348 384 H164 Q102 372 126 314 L206 166 Q224 132 256 132 Z" fill={WHITE} />
      <path d="M204 318 h104 v66 h-104 Z" fill={INK} />
      <Face x={256} y={254} />
    </>
  ) },
  { id: "boba", label: "珍奶", tile: LILAC, art: (
    <>
      <rect x="262" y="92" width="24" height="104" rx="6" fill={RED} transform="rotate(10 274 144)" />
      <path d="M176 196 h160 l-20 196 a22 22 0 0 1 -22 20 h-76 a22 22 0 0 1 -22 -20 Z" fill="#e9b98a" />
      <rect x="158" y="170" width="196" height="32" rx="16" fill={WHITE} />
      <g stroke="none" fill={INK}><circle cx="222" cy="378" r="11" /><circle cx="256" cy="386" r="11" /><circle cx="290" cy="378" r="11" /><circle cx="238" cy="354" r="11" /><circle cx="276" cy="356" r="11" /></g>
      <Face x={256} y={272} gap={24} />
    </>
  ) },
];

export const DEFAULT_TRIP_ICON = "suitcase";
const byId = new Map(TRIP_ICONS.map((i) => [i.id, i]));
/** The id to use for a trip: what the admin picked if we still have that picture, otherwise the suitcase. */
export const tripIconId = (settings: { icon?: unknown } | null | undefined) =>
  (typeof settings?.icon === "string" && byId.has(settings.icon) ? settings.icon : DEFAULT_TRIP_ICON);

/** One trip picture on its rounded tile. Decorative unless `title` is given (the picker labels each one). */
export function TripIcon({ id, size = 44, title }: { id: string; size?: number; title?: string }) {
  const def = byId.get(id) ?? byId.get(DEFAULT_TRIP_ICON)!;
  return (
    <svg className="ticon" viewBox="0 0 512 512" width={size} height={size} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false">
      <rect width="512" height="512" rx="116" fill={def.tile} />
      <g stroke={INK} strokeWidth="13" strokeLinejoin="round" strokeLinecap="round">{def.art}</g>
    </svg>
  );
}
