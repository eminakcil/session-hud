// Icons from Lucide (https://lucide.dev, ISC license), 24px grid, 2px stroke.
// The desktop draws Svg as an image, so currentColor does not follow the
// theme: each scheme has its own fixed palette, picked from the theme setting.

const PATHS = {
  context: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
  cache:
    '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  timer: '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>',
  cold: '<line x1="2" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="22"/><path d="m20 16-4-4 4-4"/><path d="m4 8 4 4-4 4"/><path d="m16 4-4 4-4-4"/><path d="m8 20 4-4 4 4"/>',
  ttft: '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>',
  speed: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  limit:
    '<path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h5"/><path d="M17.5 17.5 16 16.3V14"/><circle cx="16" cy="16" r="6"/>',
  branch: '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  worktree:
    '<circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9"/><path d="M12 12v3"/>',
} as const

export type IconName = keyof typeof PATHS

export const LABELS: Record<IconName, string> = {
  context: 'Context used',
  cache: 'Cache hit rate, last turn',
  timer: 'Cache time left',
  cold: 'Cache expired',
  ttft: 'Time to first token',
  speed: 'Output speed',
  limit: 'Usage limit',
  branch: 'Git branch',
  worktree: 'Git worktree',
}

// The terminal has no Svg: one-cell stand-ins.
export const GLYPHS: Record<IconName, string> = {
  context: '◫',
  cache: 'ϟ',
  timer: '◷',
  cold: '❄',
  ttft: '⧗',
  speed: '»',
  limit: '▦',
  branch: '⎇',
  worktree: '⑂',
}

export type Scheme = 'dark' | 'light'

const DARK = {
  icon: '#9c9a92',
  success: '#4ec46a',
  warning: '#e0a83a',
  error: '#f26b5e',
  idle: '#6f6e69',
  accent: '#6ea8fe',
  time: '#cfc8b0',
  track: '#ffffff',
  card: '#30302e',
  hover: '#3a3a37',
} as const
export type Hex = keyof typeof DARK

/** Darker tones, so strokes and fills keep their contrast on a light page. */
const LIGHT: Record<Hex, string> = {
  icon: '#6b6a65',
  success: '#1f8a3c',
  warning: '#b07612',
  error: '#d0402f',
  idle: '#a3a29c',
  accent: '#2f6fd6',
  time: '#8a7f5c',
  track: '#000000',
  card: '#f0eee6',
  hover: '#e6e3d9',
}

export const PALETTES: Record<Scheme, Record<Hex, string>> = { dark: DARK, light: LIGHT }

/** The dark palette, kept for callers that name no scheme. */
export const HEX = DARK

/**
 * The scheme a `theme` setting value stands for: `light`, `light-daltonized`,
 * `light-ansi` and the like are light; anything else, `auto` included, dark.
 */
export const schemeOf = (theme: unknown): Scheme =>
  typeof theme === 'string' && theme.startsWith('light') ? 'light' : 'dark'

const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** A `<title>`: the native tooltip an interactive Svg shows on hover. */
const titled = (tip?: string) => (tip ? `<title>${esc(tip)}</title>` : '')

export function svg(name: IconName, color: Hex = 'icon', tip?: string, scheme: Scheme = 'dark'): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="' +
    PALETTES[scheme][color] +
    '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    titled(tip) +
    // A clear square under the strokes, so the whole icon takes the pointer.
    '<rect width="24" height="24" fill="#000" fill-opacity="0" stroke="none"/>' +
    PATHS[name] +
    '</svg>'
  )
}

const clamp = (n: number) => Math.max(0, Math.min(1, n))

/** A thin progress bar. */
export function bar(ratio: number, tone: Hex, w = 400, h = 6, scheme: Scheme = 'dark'): string {
  const HEX = PALETTES[scheme]
  const f = clamp(ratio) * w
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none">` +
    `<rect width="${w}" height="${h}" rx="${h / 2}" fill="${HEX.track}" fill-opacity="0.1"/>` +
    (f > 0 ? `<rect width="${f.toFixed(1)}" height="${h}" rx="${h / 2}" fill="${HEX[tone]}"/>` : '') +
    `</svg>`
  )
}

/**
 * The status line's two-row limit bar: quota used on top, the share of the
 * window gone by underneath.
 */
export function paceBar(
  used: number,
  elapsed: number | null,
  tone: Hex,
  w = 44,
  h = 8,
  tip?: string,
  scheme: Scheme = 'dark',
): string {
  const HEX = PALETTES[scheme]
  const row = h / 2
  const u = clamp(used) * w
  const e = elapsed === null ? 0 : clamp(elapsed) * w
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none">` +
    titled(tip) +
    `<rect width="${w}" height="${h}" rx="1.5" fill="${HEX.track}" fill-opacity="0.1"/>` +
    (u > 0 ? `<rect width="${u.toFixed(1)}" height="${row}" fill="${HEX[tone]}"/>` : '') +
    (e > 0 ? `<rect y="${row}" width="${e.toFixed(1)}" height="${row}" fill="${HEX.time}" fill-opacity="0.75"/>` : '') +
    `</svg>`
  )
}

/** A text bar for the terminal. */
export function textBar(ratio: number, cells = 10): string {
  const n = Math.round(clamp(ratio) * cells)
  return '█'.repeat(n) + '░'.repeat(cells - n)
}
