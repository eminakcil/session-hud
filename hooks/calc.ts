import type { CacheCounts, Limit } from '../types'

export type Tone = 'success' | 'warning' | 'error'

/** cache_read / (input + cache_creation + cache_read); input_tokens excludes the cache. */
export function hitRate(c: CacheCounts): number | null {
  const all = c.input + c.read + c.write
  return all === 0 ? null : c.read / all
}

export function pct(rate: number | null): string {
  return rate === null ? '–' : `${Math.round(rate * 100)}%`
}

export function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}k`
  return String(n)
}

/** 59:57 */
export function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

/**
 * The cache countdown as the band draws it: whole minutes left (`59m`), then
 * `0:42` in the last minute; empty once expired. It changes once a minute
 * until the last one, so the band redraws that seldom.
 */
export function ttlText(ms: number): string {
  if (ms <= 0) return ''
  if (ms > 60_000) return `${Math.ceil(ms / 60_000)}m`
  return clock(ms)
}

/** 2.5s, 850ms */
export function seconds(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
}

export function ttlMs(option: unknown): number {
  return option === '5m' ? 5 * 60_000 : 60 * 60_000
}

/** Time left: green above a quarter of the TTL, yellow down to a twelfth, then red. */
export function ttlTone(remaining: number, ttl: number): Tone {
  if (remaining > ttl / 4) return 'success'
  if (remaining > ttl / 12) return 'warning'
  return 'error'
}

export function hitTone(rate: number | null): Tone {
  if (rate === null || rate < 0.5) return 'error'
  return rate < 0.8 ? 'warning' : 'success'
}

export function fillTone(ratio: number): Tone | undefined {
  if (ratio >= 0.85) return 'error'
  if (ratio >= 0.6) return 'warning'
  return undefined
}

const WINDOW_MS: Record<string, number> = {
  five_hour: 5 * 3_600_000,
  seven_day: 7 * 86_400_000,
  seven_day_opus: 7 * 86_400_000,
  seven_day_sonnet: 7 * 86_400_000,
}

export const LIMIT_NAMES: Record<string, string> = {
  five_hour: '5h',
  seven_day: '7d',
  seven_day_opus: '7d Opus',
  seven_day_sonnet: '7d Sonnet',
}

export const LIMIT_TITLES: Record<string, string> = {
  five_hour: '5-hour limit',
  seven_day: 'Weekly limit',
  seven_day_opus: 'Weekly limit · Opus',
  seven_day_sonnet: 'Weekly limit · Sonnet',
}

export type Pace = {
  /** Share of the window gone by, 0..1. */
  elapsed: number
  /** Time gone by minus quota used, in points: positive is under pace. */
  margin: number
}

/** How far use runs behind (or ahead of) the clock in a known window. */
export function pace(limit: Limit, now: number): Pace | null {
  const span = WINDOW_MS[limit.kind]
  if (span === undefined || limit.resetsAt === null) return null
  const reset = Date.parse(limit.resetsAt)
  if (Number.isNaN(reset)) return null
  const elapsed = Math.max(0, Math.min(1, 1 - (reset - now) / span))
  return { elapsed, margin: Math.round(elapsed * 100 - limit.percentUsed) }
}

export function paceText(p: Pace): string {
  return p.margin >= 0 ? `↓${p.margin}%` : `↑${-p.margin}%`
}

export function paceTone(p: Pace): Tone {
  if (p.margin >= 0) return 'success'
  return p.margin > -15 ? 'warning' : 'error'
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** 23:00 for a reset within a day, Sat 02:00 beyond it. */
export function resetText(resetsAt: string | null, now: number): string {
  if (resetsAt === null) return ''
  const t = Date.parse(resetsAt)
  if (Number.isNaN(t)) return ''
  const d = new Date(t)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return t - now > 86_400_000 ? `${DAYS[d.getDay()]} ${hm}` : hm
}

/** 1h24m, 2d4h: how long until a reset. */
export function untilText(resetsAt: string | null, now: number): string {
  if (resetsAt === null) return ''
  const left = Date.parse(resetsAt) - now
  if (Number.isNaN(left) || left <= 0) return ''
  const m = Math.floor(left / 60_000)
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  if (d > 0) return `${d}d${h}h`
  if (h > 0) return `${h}h${m % 60}m`
  return `${m % 60}m`
}
