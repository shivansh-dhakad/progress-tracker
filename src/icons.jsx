/* Small inline icon set (no icon font, so it works offline and in the installed app). */
const P = {
  calendar: <><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M8 3v4M16 3v4M4 10h16" /></>,
  flame: <path d="M12 2.5c1 3.6 5.5 5.6 5.5 10.6a5.5 5.5 0 0 1-11 0c0-2.2 1.1-3.5 2.2-4.5.1 2 1 3 2 3.1-.4-3.2-.9-6 1.3-9.2z" />,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  bars: <path d="M5 19v-8M12 19V5M19 19v-5" />,
  check: <path d="m6.5 12.5 3.8 3.8 7.2-8.3" />,
  hourglass: <path d="M7 4h10M7 20h10M8 4v3.5c0 1.5 2 3 4 4.5-2 1.5-4 3-4 4.5V20M16 4v3.5c0 1.5-2 3-4 4.5 2 1.5 4 3 4 4.5V20" />,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />,
  x: <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />,
  play: <path d="M8.5 5.5v13l10-6.5z" />,
  pause: <path d="M8.5 5.5v13M15.5 5.5v13" />,
  bolt: <path d="M13 2.5 5.5 13H12l-1 8.5L18.5 11H12z" />,
  timer: <><circle cx="12" cy="13.5" r="7.5" /><path d="M12 9.5v4l2.5 1.5M9.5 2.5h5" /></>,
  mail: <><rect x="3.5" y="5.5" width="17" height="13" rx="3" /><path d="m4 8 8 5.5L20 8" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="3" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /><path d="m4 4 16 16" /></>,
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  flag: <path d="M6 21V4m0 0h11l-2 4 2 4H6" />,
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  down: <path d="m6 9 6 6 6-6" />,
  book: <path d="M5 4.5h10a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h10" />,
  repeat: <path d="M17 3.5 20 6.5l-3 3M4 11V9.5a3 3 0 0 1 3-3h13M7 20.5l-3-3 3-3M20 13v1.5a3 3 0 0 1-3 3H4" />,
  target: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r=".8" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" /></>,
  user: <><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" /></>,
}
const SOLID = new Set(['flame', 'play', 'bolt'])
export default function Icon({ name, fill = false, size, className = '', ...rest }) {
  const solid = fill && SOLID.has(name)
  return (
    <svg className={`ic ${className}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false"
      style={size ? { width: size, height: size } : undefined}
      fill={solid ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...rest}>
      {P[name]}
    </svg>
  )
}