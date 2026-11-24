/**
 * 載入動畫：logo 裡的小行李箱一跳一跳往前走（腳下的虛線往後跑、影子跟著縮放、會眨眼），
 * 紙飛機在上面飄，後面的虛線航跡一點一點往前送；下面三顆 logo 顏色的小圓點輪流跳。
 * 圖形和 LogoMark 是同一份座標、同一組顏色（跟著深淺色走）。系統設定「減少動態效果」時不動。
 */
export function TripLoader({ label, size = 190 }: { label: string; size?: number }) {
  return (
    <div className="triploader" role="status" aria-live="polite">
      <svg className="logo ld" viewBox="46 10 420 488" width={size} height={size * 1.162} aria-hidden="true" focusable="false">
        {/* 飛機和航跡比 logo 裡高一點，才不會被跳起來的行李箱提把擋住 */}
        <g transform="translate(20 -70)">
        {/* 航跡：尾端對準飛機的中線（機頭 392,106 到機尾凹口 347,153 那條線，往後延伸），所以看起來是從機尾正後方拉出來的 */}
        <path className="l-trail ld-trail" d="M150 150 Q275 225 330 170" />
        <g className="ld-plane">
          <g className="l-line l-plane">
            <path d="M312 138 L392 106 L364 182 L347 153 Z" />
            <path d="M347 153 L392 106" />
          </g>
        </g>
        </g>
        <path className="ld-ground" d="M76 462 H436" />
        <ellipse className="ld-shadow" cx="256" cy="462" rx="104" ry="11" />
        <g className="ld-hop">
          <g className="l-line" transform="rotate(-5 256 320)">
            <circle className="l-ink" cx="188" cy="424" r="13" />
            <circle className="l-ink" cx="324" cy="424" r="13" />
            <path className="l-none" d="M210 218 v-26 a22 22 0 0 1 22 -22 h48 a22 22 0 0 1 22 22 v26" />
            <rect className="l-case" x="138" y="218" width="236" height="196" rx="42" />
            <circle className="l-dot" cx="186" cy="368" r="17" />
            <path className="l-star" d="M330 346 l7 15 16 2 -12 11 3 16 -14 -8 -14 8 3 -16 -12 -11 16 -2 z" />
            <ellipse className="l-cheek" cx="204" cy="318" rx="15" ry="10" />
            <ellipse className="l-cheek" cx="308" cy="318" rx="15" ry="10" />
            <circle className="l-eye ld-eye" cx="228" cy="296" r="10" />
            <circle className="l-eye ld-eye" cx="284" cy="296" r="10" />
            <path className="l-none l-smile" d="M240 320 q16 15 32 0" />
          </g>
        </g>
      </svg>
      <p className="ld-label">{label.replace(/[….]+$/, "")}<span className="ld-dots" aria-hidden="true"><span /><span /><span /></span></p>
    </div>
  );
}
