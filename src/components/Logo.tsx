/**
 * The app's mark: the same little suitcase and paper plane as the home-screen icon (public/icon.svg),
 * drawn with the page's own colours so it follows light and dark mode. Decorative: the name is always next to it as text.
 */
export function LogoMark({ size = 44 }: { size?: number }) {
  return (
    <svg className="logo" viewBox="0 0 512 512" width={size} height={size} aria-hidden="true" focusable="false">
      <rect className="l-tile" width="512" height="512" rx="116" />
      <path className="l-trail" d="M112 196 Q150 96 300 138" />
      <g className="l-line l-plane">
        <path d="M312 138 L392 106 L364 182 L347 153 Z" />
        <path d="M347 153 L392 106" />
      </g>
      <g className="l-line" transform="rotate(-5 256 320)">
        <circle className="l-ink" cx="188" cy="424" r="13" />
        <circle className="l-ink" cx="324" cy="424" r="13" />
        <path className="l-none" d="M210 218 v-26 a22 22 0 0 1 22 -22 h48 a22 22 0 0 1 22 22 v26" />
        <rect className="l-case" x="138" y="218" width="236" height="196" rx="42" />
        <circle className="l-dot" cx="186" cy="368" r="17" />
        <path className="l-star" d="M330 346 l7 15 16 2 -12 11 3 16 -14 -8 -14 8 3 -16 -12 -11 16 -2 z" />
        <ellipse className="l-cheek" cx="204" cy="318" rx="15" ry="10" />
        <ellipse className="l-cheek" cx="308" cy="318" rx="15" ry="10" />
        <circle className="l-eye" cx="228" cy="296" r="10" />
        <circle className="l-eye" cx="284" cy="296" r="10" />
        <path className="l-none l-smile" d="M240 320 q16 15 32 0" />
      </g>
    </svg>
  );
}

/** The paper plane on its own, for the start of the route line. */
export function PaperPlane({ size = 18 }: { size?: number }) {
  return (
    <svg className="logo plane" viewBox="300 94 104 100" width={size} height={size} aria-hidden="true" focusable="false">
      <g className="l-line l-plane">
        <path d="M312 138 L392 106 L364 182 L347 153 Z" />
        <path d="M347 153 L392 106" />
      </g>
    </svg>
  );
}

/**
 * The suitcase on its own, small: the face of the chat helper (Trip醬). The outline takes the text colour of whatever it sits on
 * (the dark chat button, the light panel header); stickers are left out because they turn to specks at this size.
 */
export function SuitcaseIcon({ size = 26 }: { size?: number }) {
  return (
    <svg className="logo suitcase" viewBox="112 150 288 296" width={size} height={size} aria-hidden="true" focusable="false">
      <g className="s-line" transform="rotate(-5 256 320)">
        <circle className="s-wheel" cx="188" cy="424" r="13" />
        <circle className="s-wheel" cx="324" cy="424" r="13" />
        <path className="l-none" d="M210 218 v-26 a22 22 0 0 1 22 -22 h48 a22 22 0 0 1 22 22 v26" />
        <rect className="l-case" x="138" y="218" width="236" height="196" rx="42" />
        <ellipse className="l-cheek" cx="200" cy="330" rx="18" ry="12" />
        <ellipse className="l-cheek" cx="312" cy="330" rx="18" ry="12" />
        <circle className="s-face" cx="224" cy="300" r="14" />
        <circle className="s-face" cx="288" cy="300" r="14" />
        <path className="s-smile" d="M236 330 q20 19 40 0" />
      </g>
    </svg>
  );
}

/**
 * "Next Trip" written the way the icon is drawn: one round navy line, with the dot of the i as the suitcase's red.
 * Hand-built letters (no font to download), so it looks the same everywhere.
 */
export function Wordmark({ height = 30 }: { height?: number }) {
  return (
    <svg className="wordmark" viewBox="0 4 232 64" height={height} width={(height * 232) / 64} role="img" aria-label="Next Trip">
      <g fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 52 V16 L32 52 V16" />
        <path d="M45 41 H65 A10.5 12 0 1 0 61 50" />
        <path d="M76 29 L94 52 M94 29 L76 52" />
        <path d="M108 16 V44 Q108 52 116 52 M100 29 H117" />
        <path d="M134 16 H164 M149 16 V52" />
        <path d="M174 29 V52 M174 40 Q176 29 188 29" />
        <path d="M199 31 V52" />
        <path d="M212 29 V64 M212 40.5 a10.5 11.5 0 1 1 21 0 a10.5 11.5 0 1 1 -21 0" />
      </g>
      <circle className="wm-dot" cx="199" cy="17" r="6" />
    </svg>
  );
}

const MENU_ICONS = {
  // 切換行程：小行李箱
  switch: <><path d="M9 8V6.2A1.7 1.7 0 0 1 10.7 4.5h2.6A1.7 1.7 0 0 1 15 6.2V8" /><rect x="3.5" y="8" width="17" height="11.5" rx="3.2" fill="#e9573f" /><path d="M9.5 13.2h.01M14.5 13.2h.01" strokeWidth="2.6" /></>,
  // 帳號・好友：兩個人
  friends: <><circle cx="16.6" cy="9.4" r="2.6" fill="#7cc4e8" /><path d="M14.6 19.5h6.2a4.3 4.3 0 0 0-5-4.6" fill="#7cc4e8" /><circle cx="9" cy="8.4" r="3.2" fill="#ffd257" /><path d="M3.2 19.5a5.8 5.8 0 0 1 11.6 0Z" fill="#ffd257" /></>,
  // 這趟誰會去：兩個大人中間一個小孩
  people: <><circle cx="6.6" cy="7.6" r="2.6" fill="#ffd257" /><path d="M2.4 18.5v-2.2a4.2 4.2 0 0 1 6.6-3.4" fill="#ffd257" /><circle cx="17.4" cy="7.6" r="2.6" fill="#7cc4e8" /><path d="M21.6 18.5v-2.2a4.2 4.2 0 0 0-6.6-3.4" fill="#7cc4e8" /><circle cx="12" cy="12.6" r="2.2" fill="#e9573f" /><path d="M8.2 20a3.8 3.8 0 0 1 7.6 0Z" fill="#e9573f" /></>,
  // 管理這個行程：齒輪
  admin: <><path d="M12 3.2l1.7 2.3 2.8-.6.6 2.8 2.5 1.4-1.2 2.6 1.2 2.6-2.5 1.4-.6 2.8-2.8-.6L12 20.8l-1.7-2.3-2.8.6-.6-2.8-2.5-1.4 1.2-2.6-1.2-2.6 2.5-1.4.6-2.8 2.8.6Z" fill="#7cc4e8" /><circle cx="12" cy="12" r="2.7" fill="#fff" /></>,
  // 我的信用卡
  cards: <><rect x="3" y="5.5" width="18" height="13" rx="3" fill="#ffd257" /><path d="M3 10.2h18M6.8 14.6h3.4" /></>,
  // 使用教學：打開的書
  guide: <><path d="M12 7.2C9.8 5.6 6.8 5.3 3.8 6v12c3-.7 6-.4 8.2 1.2 2.2-1.6 5.2-1.9 8.2-1.2V6c-3-.7-6-.4-8.2 1.2Z" fill="#fff" /><path d="M12 7.2v12" /></>,
  // 改我的名字：鉛筆
  rename: <><path d="M4.8 19.2l1-4.2L16.2 4.6a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L9 18.2Z" fill="#ffd257" /><path d="M14.4 6.4l3.2 3.2" /></>,
  // 退出這個行程：門和往外的箭頭
  leave: <><path d="M10.5 4H6.3A1.8 1.8 0 0 0 4.5 5.8v12.4A1.8 1.8 0 0 0 6.3 20h4.2" /><path d="M10 12h10M16.4 8.2 20.2 12l-3.8 3.8" /></>,
  // 登出：電源鍵
  signout: <><path d="M12 3.8v7.4" /><path d="M7.2 7.2a7 7 0 1 0 9.6 0" /></>,
};
/** Small menu pictures drawn like the icon: round navy line, flat fills in the suitcase's colours. */
export function MenuIcon({ name, size = 22 }: { name: keyof typeof MENU_ICONS; size?: number }) {
  return (
    <svg className="micon" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {MENU_ICONS[name]}
    </svg>
  );
}

/** The person outline on the account button (top right of every page). */
export function PersonIcon({ size = 16 }: { size?: number }) {
  return (
    <svg className="micon" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}
