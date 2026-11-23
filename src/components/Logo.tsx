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
