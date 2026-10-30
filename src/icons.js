const stroke = (body) =>
  `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  hq: stroke(`
    <path d="M7 40h34M10 40V26l14-8 14 8v14"/>
    <path d="M17 40V29h14v11"/>
    <path d="M24 18V7m0 0-6 4m6-4 6 4"/>
    <circle cx="24" cy="13" r="2" fill="currentColor" stroke="none"/>
    <path d="M15 33h6M27 33h6" opacity=".55"/>
  `),
  power: stroke(`
    <path d="M24 4 40 13.5v21L24 44 8 34.5v-21Z"/>
    <path d="m27 11-10 16h7l-3 11 12-17h-7Z" fill="currentColor" stroke="none"/>
  `),
  barracks: stroke(`
    <path d="M6 40h36M9 40V21L24 11l15 10v19"/>
    <path d="M18 40V28h12v12"/>
    <path d="M14 24h7M27 24h7" opacity=".6"/>
    <path d="M24 11V5m0 0-3 3m3-3 3 3"/>
  `),
  derrick: stroke(`
    <path d="M10 41 24 7l14 34"/>
    <path d="m15 41 9-25 9 25"/>
    <path d="M18 25h12M16 33h16"/>
    <path d="M24 7h11l-2 5h-9"/>
    <circle cx="37" cy="17" r="2.6"/>
    <path d="M37 20v7"/>
  `),
  marine: stroke(`
    <path d="M24 5c-6.5 0-10 4.5-10 11v9h20v-9c0-6.5-3.5-11-10-11Z"/>
    <path d="M14 15h20" opacity=".6"/>
    <path d="M17 25v7m14-7v7"/>
    <path d="M18 32h12l-2 10h-8Z"/>
    <path d="M21 18h6" stroke-width="4"/>
    <path d="M9 22h5M34 22h5" opacity=".7"/>
  `),
  scout: stroke(`
    <circle cx="14" cy="34" r="4.5"/>
    <circle cx="34" cy="34" r="4.5"/>
    <path d="M6 33h4l4-9h16l5 9h7"/>
    <path d="M16 24h16M20 24l3-7h5l3 7"/>
    <path d="M4 20h7M2 14h6" opacity=".55"/>
  `),
  tank: stroke(`
    <path d="M5 33h38l-4 6H9Z"/>
    <path d="M11 24h20v9H11Z"/>
    <path d="M19 24v-5h10v5"/>
    <path d="M29 21h14v3H29Z"/>
    <circle cx="16" cy="38.5" r="2.2" fill="currentColor" stroke="none"/>
    <circle cx="33" cy="38.5" r="2.2" fill="currentColor" stroke="none"/>
    <path d="M14 18h6M28 15h4" opacity=".5"/>
  `),
  stop: stroke(`<rect x="14" y="14" width="20" height="20"/><path d="M14 19h20" opacity=".4"/>`),
  attack: stroke(`
    <circle cx="24" cy="24" r="10"/>
    <path d="M24 8v7M24 33v7M8 24h7M33 24h7"/>
    <circle cx="24" cy="24" r="2" fill="currentColor" stroke="none"/>
  `),
  move: stroke(`
    <path d="M24 7v34M7 24h34"/>
    <path d="m24 7-5 6m5-6 5 6M24 41l-5-6m5 6 5-6M7 24l6-5m-6 5 6 5M41 24l-6-5m6 5-6 5"/>
  `),
  credits: stroke(`
    <path d="M24 6c5.5 7 11 13 11 19a11 11 0 0 1-22 0c0-6 5.5-12 11-19Z"/>
    <path d="M18 26a6 6 0 0 0 6 6" opacity=".55"/>
    <path d="M13 41h22" opacity=".35"/>
  `),
  bolt: stroke(`<path d="M27 5 13 27h9l-2 16 15-23h-9Z" fill="currentColor" stroke="none"/>`),
  army: stroke(`
    <circle cx="24" cy="12" r="5"/>
    <path d="M14 38c0-7 4-12 10-12s10 5 10 12"/>
    <circle cx="10" cy="18" r="3.4" opacity=".55"/>
    <circle cx="38" cy="18" r="3.4" opacity=".55"/>
    <path d="M3 38c0-5.5 3-9 7-9m35 9c0-5.5-3-9-7-9" opacity=".55"/>
  `),
  pause: stroke(`<rect x="14" y="10" width="7" height="28" rx="1"/><rect x="27" y="10" width="7" height="28" rx="1"/>`),
  play: stroke(`<path d="M16 10 38 24 16 38Z" fill="currentColor" stroke="none"/>`),
  restart: stroke(`
    <path d="M40 24a16 16 0 1 1-4.7-11.3"/>
    <path d="M40 7v11H29"/>
  `),
  close: stroke(`<path d="M14 14l20 20M34 14 14 34"/>`),
  flag: stroke(`
    <path d="M13 42V7"/>
    <path d="M13 9h24l-5 8 5 8H13"/>
  `),
  target: stroke(`
    <path d="M24 5v8M24 35v8M5 24h8M35 24h8"/>
    <circle cx="24" cy="24" r="6"/>
    <path d="M24 12v6M24 30v6M12 24h6M30 24h6" opacity=".5"/>
  `),
};

export function icon(name) {
  return ICONS[name] || ICONS.hq;
}
