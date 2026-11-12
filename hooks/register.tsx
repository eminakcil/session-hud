import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register, RenderChildren, Timer } from 'claude-code'

import type { CacheCounts, Git, LastTurn, Limit, Speed, Totals, Usage } from '../types'
import {
  LIMIT_NAMES,
  LIMIT_TITLES,
  clock,
  ttlText,
  fillTone,
  hitRate,
  hitTone,
  pace,
  paceText,
  paceTone,
  pct,
  resetText,
  seconds,
  tokens,
  ttlMs,
  ttlTone,
  untilText,
} from './calc'
import type { Tone } from './calc'
import { readGit } from './git'
import { GLYPHS, HEX, LABELS, bar, paceBar, svg, textBar } from './icons'
import type { Hex, IconName } from './icons'

const ZERO: Totals = { input: 0, output: 0, read: 0, write: 0, steps: 0 }
const last = atom({ plugin: 'session-hud', key: 'last' } as const, null as LastTurn | null, { shape: 'last-2' })
const totals = atom({ plugin: 'session-hud', key: 'totals' } as const, ZERO, { shape: 'totals-2' })
const agentTotals = atom({ plugin: 'session-hud', key: 'agentTotals' } as const, ZERO, { shape: 'agents-1' })
const speed = atom({ plugin: 'session-hud', key: 'speed' } as const, null as Speed | null, { shape: 'speed-2' })
const usage = atom({ plugin: 'session-hud', key: 'usage' } as const, null as Usage | null, { shape: 'usage-1' })
const git = atom({ plugin: 'session-hud', key: 'git' } as const, null as Git | null, { shape: 'git-1' })
const now = atom({ plugin: 'session-hud', key: 'now' } as const, 0)

const PANE = 'session-hud'
/** A response that streamed for less than this gives no speed. */
const MIN_STREAM_MS = 100
/** While the cache is cold, the clock moves the pace figures this often. */
const IDLE_TICK_MS = 30_000
/** Git is read again at most this often by the clock; tool calls and turns read it sooner. */
const GIT_TICK_MS = 30_000

let ttl = ttlMs(undefined)
let timer: Timer | undefined
let wroteAt = 0
let gitBusy = false
let gitAgain = false
let gitCheckedAt = 0
let shownCache = ''

/**
 * One clock for the session. Every redraw of the band resets the pointer's
 * hover on it, so `now` is written only when what the band shows would
 * change: the cache countdown's minute (its seconds in the last minute), or
 * every 30s for the limits' pace.
 */
function tick($: EngineInterface) {
  if (timer) return
  timer = $.clock.every(1000, async () => {
    const t = await $.clock.now()
    const l = await read($, last)
    const label = l === null || l.at === 0 ? '' : ttlText(ttl - Math.max(0, t - l.at))
    if (label !== shownCache || t - wroteAt >= IDLE_TICK_MS) {
      shownCache = label
      wroteAt = t
      await update($, now, () => t)
    }
    if (t - gitCheckedAt >= GIT_TICK_MS) refreshGit($).catch(() => {})
  })
}

/** Writes the git figures only when they changed, so an idle repository draws nothing new. */
function sameGit(a: Git | null, b: Git | null): boolean {
  if (a === null || b === null) return a === b
  return JSON.stringify({ ...a, checkedAt: 0 }) === JSON.stringify({ ...b, checkedAt: 0 })
}

/** Reads git once at a time; a call while one runs asks for one more after it. */
async function refreshGit($: EngineInterface) {
  if (gitBusy) {
    gitAgain = true
    return
  }
  gitBusy = true
  try {
    do {
      gitAgain = false
      const t = await $.clock.now()
      gitCheckedAt = t
      let value: Git | null = null
      try {
        value = await readGit($, t)
      } catch {
        value = null
      }
      if (!sameGit(await read($, git), value)) await update($, git, () => value)
    } while (gitAgain)
  } finally {
    gitBusy = false
  }
}

async function refreshUsage($: EngineInterface, withBreakdown = false) {
  const u = await $.session.usage(withBreakdown ? { breakdown: 'summary' } : undefined)
  const b = u.context.breakdown
  await update($, usage, prev => ({
    contextTokens: u.context.tokens ?? null,
    contextWindow: u.context.window,
    contextPercent: u.context.percent ?? null,
    compactAt: b ? (b.isAutoCompactEnabled ? (b.autoCompactThreshold ?? null) : null) : (prev?.compactAt ?? null),
    categories: b
      ? b.categories.map(c => ({ name: c.name, kind: c.kind, tokens: c.tokens }))
      : (prev?.categories ?? []),
    costUsd: u.cost?.usd ?? null,
    limits: u.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt ?? null })),
  }))
}

async function togglePane($: EngineInterface): Promise<boolean> {
  const panes = await $.ui.panes()
  if (panes.some(p => p.id === PANE)) {
    await $.ui.close({ id: PANE })
    return false
  }
  await $.ui.open({ id: PANE, title: 'Session' })
  return true
}

const toHex = (tone: Tone | undefined): Hex => tone ?? 'accent'

/** One run of styled text in a line. */
type Seg = { text: string; color?: Tone; dim?: boolean; strong?: boolean }
const s = (text: string, style: Omit<Seg, 'text'> = {}): Seg => ({ text, ...style })
const dim = (text: string): Seg => ({ text, dim: true })
const SEP = dim('  ·  ')

function joinSegs(groups: Seg[][]): Seg[] {
  const out: Seg[] = []
  for (const g of groups) {
    if (g.length === 0) continue
    if (out.length > 0) out.push(SEP)
    out.push(...g)
  }
  return out
}

/** A detail line as tooltip text: one line per group. */
function tipText(segs: Seg[]): string {
  return segs
    .map(x => (x === SEP ? '\n' : x.text))
    .join('')
    .trim()
}

/** The git line: branch, upstream with commits to push and pull, worktree, changes. */
function gitSegs(g: Git): { head: Seg[]; rest: Seg[] } {
  const head: Seg[] = [s(g.branch ?? (g.detachedAt ? `detached ${g.detachedAt}` : 'detached'), { strong: true })]
  const sync: Seg[] = []
  if (g.upstream === null) {
    if (g.branch !== null) sync.push(dim('no upstream'))
  } else if (g.ahead === 0 && g.behind === 0) {
    sync.push(dim(`${g.upstream} `), s('✓', { color: 'success' }))
  } else {
    sync.push(dim(`${g.upstream} `))
    if (g.ahead > 0) sync.push(s(`↑${g.ahead}`, { color: 'warning' }))
    if (g.ahead > 0 && g.behind > 0) sync.push(s(' '))
    if (g.behind > 0) sync.push(s(`↓${g.behind}`, { color: 'error' }))
  }
  const changes: Seg[] = []
  const add = (n: number, label: string, color?: Tone) => {
    if (n === 0) return
    if (changes.length > 0) changes.push(dim(' '))
    changes.push(s(String(n), color ? { color } : {}), dim(` ${label}`))
  }
  add(g.conflicts, 'conflicted', 'error')
  add(g.staged, 'staged', 'success')
  add(g.modified, 'modified', 'warning')
  add(g.untracked, 'untracked')
  if (changes.length === 0) changes.push(dim('clean'))
  return { head, rest: joinSegs([sync, changes]) }
}

export const register: Register = (on, options) => {
  ttl = ttlMs(options.ttl)
  timer = undefined
  wroteAt = 0
  gitBusy = false
  gitAgain = false
  gitCheckedAt = 0
  shownCache = ''

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'hud', description: 'Open or close the session pane' })
    const t = await $.clock.now()
    wroteAt = t
    await update($, now, () => t)
    await refreshUsage($, true)
    refreshGit($).catch(() => {})
    tick($)
    return result
  })

  on('command.run', { command: 'hud' }, async $ => {
    const isOpen = await togglePane($)
    return { text: isOpen ? 'Session pane opened.' : 'Session pane closed.' }
  })

  on('session.measure', async ($, e, next) => {
    const echoed = await next(e)
    await refreshUsage($, e.changed.includes('context'))
    return echoed
  })

  // A command or an edit may move git: read it again once the call is done.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (e.tool === 'Bash' || e.tool === 'PowerShell' || e.tool === 'Edit' || e.tool === 'Write') {
      refreshGit($).catch(() => {})
    }
    return result
  })

  // Each model request: cache counts and timing for the main loop's.
  on('turn.step', async function* ($, e, next) {
    const isMain = e.agentId === undefined
    const sent = await $.clock.now()
    let first: number | undefined
    const stream = next(e)
    let ended = false
    try {
      for (;;) {
        const piece = await stream.next()
        if (piece.done) {
          ended = true
          const response = piece.value
          const u: ModelUsage | null = response.usage
          if (isMain && u) await record($, e.turnId, u, sent, first)
          else if (u) {
            const c = countsOf(u)
            await update($, agentTotals, prev => ({ ...addCounts(prev, c), steps: prev.steps + 1 }))
          }
          return response
        }
        if (first === undefined) first = await $.clock.now()
        yield piece.value
      }
    } finally {
      // Left early (the answer was interrupted): close the stream beneath.
      if (!ended) await stream.return?.(undefined as never)
    }
  })

  on('turn.complete', async ($, e, next) => {
    const answered = await next(e)
    if (e.agentId === undefined) {
      await update($, speed, sp => (sp ? { ...sp, turnMs: e.durationMs ?? null } : sp))
      refreshGit($).catch(() => {})
    }
    return answered
  })

  // Above the prompt: the git line, then the status line's figures. Hovering
  // a figure lays its details over the git line.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const u = await read($, usage)
    const l = await read($, last)
    const sum = await read($, totals)
    const sp = await read($, speed)
    const g = await read($, git)
    const t = await read($, now)

    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : undefined

    // With a tooltip the icon is drawn interactive, so its `<title>` shows on
    // hover as the system's own popup: nothing in the band moves or grows.
    const icon = (name: IconName, tip?: string) =>
      Svg ? (
        <Svg source={svg(name, 'icon', tip)} alt={LABELS[name]} width={14} height={14} isInteractive={tip ? true : undefined} />
      ) : (
        <Text dimColor>{GLYPHS[name]}</Text>
      )

    const line = (segs: Seg[]) => (
      <Text size="footnote" tabular>
        {segs.map(x => (
          <Text color={x.color} dimColor={x.dim} weight={x.strong ? 'medium' : undefined}>
            {x.text}
          </Text>
        ))}
      </Text>
    )

    type Item = { id: string; body: (tip: string) => RenderChildren; detail: Seg[] }
    const items: Item[] = []

    const percent = u?.contextPercent ?? null
    if (u && percent !== null) {
      const top = u.categories
        .filter(c => c.kind === 'used' && c.tokens > 0)
        .sort((a, b) => b.tokens - a.tokens)
        .slice(0, 5)
        .map(c => [dim(`${c.name} `), s(tokens(c.tokens))])
      const toCompact = u.compactAt !== null && u.contextTokens !== null ? Math.max(0, u.compactAt - u.contextTokens) : null
      items.push({
        id: 'ctx',
        body: (tip: string) => (
          <Box flexDirection="row" alignItems="center" gap="xs">
            {icon('context', tip)}
            {line([
              s(`${Math.round(percent)}%`, { color: fillTone(percent / 100) }),
              ...(u.contextTokens !== null ? [dim(` · ${tokens(u.contextTokens)}`)] : []),
            ])}
          </Box>
        ),
        detail: joinSegs([
          [s('Context ', { strong: true }), s(`${tokens(u.contextTokens ?? 0)} / ${tokens(u.contextWindow)}`)],
          ...top,
          toCompact !== null ? [dim('auto-compact in '), s(tokens(toCompact))] : [],
        ]),
      })
    }

    if (l) {
      const hit = hitRate(l)
      const avg = hitRate(sum)
      const remaining = l.at === 0 ? 0 : ttl - Math.max(0, t - l.at)
      const warm = remaining > 0
      const coldAt = l.at === 0 ? '' : resetText(new Date(l.at + ttl).toISOString(), t)
      items.push({
        id: 'cache',
        body: (tip: string) => (
          <Box flexDirection="row" alignItems="center" gap="xs">
            {icon(warm ? 'cache' : 'cold', tip)}
            {line([
              s(pct(hit), { color: hitTone(hit), strong: true }),
              dim(' · '),
              warm ? s(ttlText(remaining), { color: ttlTone(remaining, ttl) }) : s('cold', { color: 'error' }),
            ])}
          </Box>
        ),
        detail: joinSegs([
          [s('Prompt cache ', { strong: true }), s(`${pct(hit)} hit last turn`)],
          [dim('session avg '), s(pct(avg))],
          [s(tokens(l.read)), dim(' read '), s(tokens(l.write)), dim(' written '), s(tokens(l.input)), dim(' new')],
          warm ? [dim(`${ttl >= 3_600_000 ? '1h' : '5m'} TTL, cold at `), s(coldAt)] : [s('expired', { color: 'error' })],
        ]),
      })
    }

    if (sp) {
      const avgTtft = sp.count > 0 ? sp.ttftSum / sp.count : null
      const avgTps = sp.streamSum > 0 ? (sp.outputSum * 1000) / sp.streamSum : null
      const timing = joinSegs([
        [s('Last request ', { strong: true }), s(seconds(sp.ttftMs)), dim(' to first token, '), s(tokens(sp.outputTokens)), dim(' tokens in '), s(seconds(sp.streamMs))],
        sp.turnMs !== null ? [dim('turn '), s(seconds(sp.turnMs))] : [],
        [
          dim(`session avg (${sp.count}) `),
          s(avgTtft !== null ? seconds(avgTtft) : '–'),
          dim(' · '),
          s(avgTps !== null ? `${Math.round(avgTps)} tok/s` : '–'),
        ],
      ])
      items.push({
        id: 'ttft',
        body: (tip: string) => (
          <Box flexDirection="row" alignItems="center" gap="xs">
            {icon('ttft', tip)}
            {line([s(seconds(sp.ttftMs))])}
          </Box>
        ),
        detail: timing,
      })
      const tps = sp.tps
      if (tps !== null) {
        items.push({
          id: 'tps',
          body: (tip: string) => (
            <Box flexDirection="row" alignItems="center" gap="xs">
              {icon('speed', tip)}
              {line([s(`${Math.round(tps)}`), dim(' tok/s')])}
            </Box>
          ),
          detail: timing,
        })
      }
    }

    for (const lim of u?.limits ?? []) {
      const p = pace(lim, t)
      const tone = fillTone(lim.percentUsed / 100)
      const reset = resetText(lim.resetsAt, t)
      const until = untilText(lim.resetsAt, t)
      items.push({
        id: `lim-${lim.kind}`,
        body: (tip: string) => (
          <Box flexDirection="row" alignItems="center" gap="xs">
            {line([dim(LIMIT_NAMES[lim.kind] ?? lim.kind)])}
            {Svg ? (
              <Svg
                source={paceBar(lim.percentUsed / 100, p?.elapsed ?? null, toHex(tone), 44, 8, tip)}
                isInteractive
                alt={`${LIMIT_TITLES[lim.kind] ?? lim.kind}: ${Math.round(lim.percentUsed)}% used`}
                width={44}
                height={8}
              />
            ) : null}
            {line([
              s(`${Math.round(lim.percentUsed)}%`, { color: tone }),
              ...(reset ? [dim(` · ${reset}`)] : []),
              ...(p ? [s(` ${paceText(p)}`, { color: paceTone(p) })] : []),
            ])}
          </Box>
        ),
        detail: joinSegs([
          [s(`${LIMIT_TITLES[lim.kind] ?? lim.kind} `, { strong: true }), s(`${Math.round(lim.percentUsed)}% used`)],
          reset ? [dim('resets '), s(reset), ...(until ? [dim(` (in ${until})`)] : [])] : [],
          p
            ? [
                s(`${Math.round(p.elapsed * 100)}%`),
                dim(' of the window gone, '),
                s(`${Math.abs(p.margin)} pts`, { color: paceTone(p) }),
                dim(p.margin >= 0 ? ' under pace' : ' over pace'),
              ]
            : [],
        ]),
      })
    }

    if (items.length === 0 && g === null) return next(e)

    // The git line, only inside a repository.
    const gitRow = g ? (
      (() => {
        const { head, rest } = gitSegs(g)
        return (
          <Box flexDirection="row" alignItems="center" gap="sm">
            <Box flexDirection="row" alignItems="center" gap="xs">
              {icon('branch')}
              {line(head)}
            </Box>
            {g.worktree ? (
              <Box flexDirection="row" alignItems="center" gap="xs">
                {icon('worktree')}
                {line([s(g.worktree)])}
              </Box>
            ) : null}
            {line(rest)}
          </Box>
        )
      })()
    ) : null

    return (
      <Box flexDirection="column">
        {gitRow ? (
          <Box flexDirection="row" alignItems="center" paddingX="xs">
            {gitRow}
          </Box>
        ) : null}
        <Box flexDirection="row" alignItems="center" gap="sm">
          <Box flexDirection="row" alignItems="center" gap="sm" flexWrap="wrap" flexGrow={1}>
            {items.map(it => (
              <Box key={`item-${it.id}`} flexDirection="row" alignItems="center" paddingX="xs">
                {it.body(tipText(it.detail))}
              </Box>
            ))}
          </Box>
          <Button key="pane" label="☰" plain dimColor onPress={() => togglePane($)} />
        </Box>
      </Box>
    )
  })

  // The side pane: the same figures, in full.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : undefined

    const u = await read($, usage)
    const l = await read($, last)
    const sum = await read($, totals)
    const sp = await read($, speed)
    const g = await read($, git)
    const t = await read($, now)

    const section = (title: string) => (
      <Text dimColor weight="medium">
        {title}
      </Text>
    )

    const pair = (key: string, label: string, value: RenderChildren, color?: Tone) => (
      <Box key={key} flexDirection="row" justifyContent="space-between" gap="md">
        <Text dimColor>{label}</Text>
        <Text tabular color={color}>
          {value}
        </Text>
      </Box>
    )

    const meter = (key: string, label: string, right: RenderChildren, ratio: number, tone: Hex, under?: string) => (
      <Box key={key} flexDirection="column" gap="xs">
        <Box flexDirection="row" justifyContent="space-between" gap="md">
          <Text>{label}</Text>
          <Text dimColor tabular>
            {right}
          </Text>
        </Box>
        {Svg ? (
          <Svg source={bar(ratio, tone)} alt={`${label}: ${Math.round(ratio * 100)}%`} height={6} />
        ) : (
          <Text dimColor={tone === 'idle'}>{textBar(ratio, 20)}</Text>
        )}
        {under ? (
          <Text size="footnote" dimColor>
            {under}
          </Text>
        ) : null}
      </Box>
    )

    // Session id, with a button that puts it on the clipboard
    let sessionId: string | null = null
    try {
      sessionId = await $.session.id()
    } catch {
      sessionId = null
    }
    const idRow = sessionId ? (
      <Box key="session" flexDirection="column" gap="xs">
        {section('Session')}
        <Box flexDirection="row" alignItems="center" justifyContent="space-between" gap="sm">
          <Text size="footnote" tabular>
            {sessionId}
          </Text>
          <Button
            key="copy-id"
            label="Copy"
            plain
            dimColor
            onPress={async press => {
              const copied = await $.ui.copy({ text: sessionId, surface: press.surface })
              $.ui.toast(copied.isCopied ? 'Session id copied.' : `Could not copy the session id (${copied.reason}).`)
            }}
          />
        </Box>
      </Box>
    ) : null

    // Git
    const repo: RenderChildren[] = [section('Git')]
    if (g) {
      repo.push(pair('branch', 'Branch', g.branch ?? (g.detachedAt ? `detached at ${g.detachedAt}` : 'detached')))
      if (g.worktree) repo.push(pair('wt', 'Worktree', g.worktree))
      repo.push(pair('up', 'Upstream', g.upstream ?? 'none'))
      if (g.upstream) {
        repo.push(pair('ahead', 'Not pushed', `${g.ahead} commit${g.ahead === 1 ? '' : 's'}`, g.ahead > 0 ? 'warning' : undefined))
        repo.push(pair('behind', 'Not pulled', `${g.behind} commit${g.behind === 1 ? '' : 's'}`, g.behind > 0 ? 'error' : undefined))
      }
      repo.push(
        pair(
          'changes',
          'Changes',
          g.staged + g.modified + g.untracked + g.conflicts === 0
            ? 'clean'
            : [
                g.conflicts ? `${g.conflicts} conflicted` : '',
                g.staged ? `${g.staged} staged` : '',
                g.modified ? `${g.modified} modified` : '',
                g.untracked ? `${g.untracked} untracked` : '',
              ]
                .filter(Boolean)
                .join(' · '),
        ),
      )
      repo.push(
        <Text size="footnote" dimColor>
          Not pulled counts against the last fetch.
        </Text>,
      )
    } else {
      repo.push(<Text dimColor>Not a git repository.</Text>)
    }

    // Context
    const ctx: RenderChildren[] = [section('Context')]
    if (u && u.contextTokens !== null) {
      const ratio = u.contextTokens / u.contextWindow
      const toCompact = u.compactAt !== null ? Math.max(0, u.compactAt - u.contextTokens) : null
      ctx.push(
        meter(
          'ctx',
          `${Math.round(u.contextPercent ?? ratio * 100)}% used`,
          `${tokens(u.contextTokens)} / ${tokens(u.contextWindow)}`,
          ratio,
          toHex(fillTone(ratio)),
          toCompact !== null ? `${tokens(toCompact)} until auto-compact` : undefined,
        ),
      )
      const used = u.categories.filter(c => c.kind === 'used' && c.tokens > 0).sort((a, b) => b.tokens - a.tokens)
      for (const c of used) ctx.push(pair(`cat-${c.name}`, c.name, tokens(c.tokens)))
    } else {
      ctx.push(<Text dimColor>No reading yet: it comes with the first answer.</Text>)
    }

    // Cache
    const cache: RenderChildren[] = [section('Prompt cache')]
    if (l) {
      const hit = hitRate(l)
      const avg = hitRate(sum)
      const remaining = l.at === 0 ? 0 : Math.max(0, ttl - Math.max(0, t - l.at))
      const warm = remaining > 0
      cache.push(meter('hit', 'Hit rate, last turn', pct(hit), hit ?? 0, warm ? hitTone(hit) : 'idle'))
      cache.push(
        meter('ttl', 'Time left', warm ? ttlText(remaining) : 'expired', remaining / ttl, warm ? ttlTone(remaining, ttl) : 'idle', `${ttl >= 3_600_000 ? '1h' : '5m'} TTL`),
      )
      cache.push(pair('avg', 'Session average', pct(avg)))
    } else {
      cache.push(<Text dimColor>No request yet.</Text>)
    }

    // Tokens: one row per kind, a column each for the last turn, the session's
    // main conversation and its subagents.
    const subs = await read($, agentTotals)
    const cols: { title: string; c: CacheCounts | null }[] = [
      { title: 'Last turn', c: l },
      { title: 'Session', c: sum.steps > 0 ? sum : null },
      ...(subs.steps > 0 ? [{ title: 'Subagents', c: subs }] : []),
    ]
    const cell = (text: string, key: string, isHead = false) => (
      <Box key={key} width={11} flexDirection="row" justifyContent="flex-end">
        <Text tabular dimColor={isHead} size={isHead ? 'footnote' : undefined}>
          {text}
        </Text>
      </Box>
    )
    const tokenRow = (key: string, label: string, pick: (c: CacheCounts) => number) => (
      <Box key={key} flexDirection="row" alignItems="center">
        <Box flexGrow={1}>
          <Text dimColor>{label}</Text>
        </Box>
        {cols.map(col => cell(col.c ? tokens(pick(col.c)) : '–', `${key}-${col.title}`))}
      </Box>
    )
    const tok: RenderChildren[] = [section('Tokens')]
    if (l || sum.steps > 0 || subs.steps > 0) {
      tok.push(
        <Box key="head" flexDirection="row" alignItems="center">
          <Box flexGrow={1} />
          {cols.map(col => cell(col.title, `head-${col.title}`, true))}
        </Box>,
        tokenRow('in', 'Input', c => c.input),
        tokenRow('out', 'Output', c => c.output),
        tokenRow('cr', 'Cache read', c => c.read),
        tokenRow('cw', 'Cache write', c => c.write),
        tokenRow('all', 'Total', c => c.input + c.output + c.read + c.write),
        <Text key="note" size="footnote" dimColor>
          Input is the uncached part; cache read and write are input served from and written to the cache.
        </Text>,
      )
    } else {
      tok.push(<Text dimColor>No request yet.</Text>)
    }

    // Speed
    const fast: RenderChildren[] = [section('Response speed')]
    if (sp) {
      fast.push(pair('ttft', 'Time to first token', seconds(sp.ttftMs)))
      fast.push(pair('tps', 'Output speed', sp.tps !== null ? `${Math.round(sp.tps)} tok/s` : '–'))
      fast.push(pair('out', 'Output tokens', tokens(sp.outputTokens)))
      if (sp.turnMs !== null) fast.push(pair('turn', 'Turn length', seconds(sp.turnMs)))
      if (sp.count > 0) fast.push(pair('attft', `Average TTFT (${sp.count})`, seconds(sp.ttftSum / sp.count)))
      if (sp.streamSum > 0) fast.push(pair('atps', 'Average speed', `${Math.round((sp.outputSum * 1000) / sp.streamSum)} tok/s`))
    } else {
      fast.push(<Text dimColor>No response yet.</Text>)
    }

    // Limits
    const limits: RenderChildren[] = [section('Usage limits')]
    for (const lim of u?.limits ?? []) limits.push(limitMeter(lim))
    if ((u?.limits ?? []).length === 0) limits.push(<Text dimColor>No reading yet.</Text>)
    if (u && u.costUsd !== null) limits.push(pair('cost', 'Session cost', `$${u.costUsd.toFixed(2)}`))

    function limitMeter(lim: Limit) {
      const p = pace(lim, t)
      const ratio = lim.percentUsed / 100
      const tone = toHex(fillTone(ratio))
      const reset = resetText(lim.resetsAt, t)
      const until = untilText(lim.resetsAt, t)
      return (
        <Box key={`lim-${lim.kind}`} flexDirection="column" gap="xs">
          <Box flexDirection="row" justifyContent="space-between" gap="md">
            <Text>{LIMIT_TITLES[lim.kind] ?? lim.kind}</Text>
            <Text tabular>
              {Math.round(lim.percentUsed)}%{p ? <Text color={paceTone(p)}> {paceText(p)}</Text> : null}
            </Text>
          </Box>
          {Svg ? (
            <Svg source={paceBar(ratio, p?.elapsed ?? null, tone, 400, 12)} alt={`${Math.round(lim.percentUsed)}% used`} height={12} />
          ) : (
            <Text>{textBar(ratio, 20)}</Text>
          )}
          <Text size="footnote" dimColor>
            {reset ? `Resets ${reset}${until ? ` (in ${until})` : ''}` : ''}
            {p ? ` · ${Math.round(p.elapsed * 100)}% of the window gone` : ''}
          </Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap="lg" padding="sm">
        {idRow}
        <Box flexDirection="column" gap="sm">{repo}</Box>
        <Box flexDirection="column" gap="sm">{ctx}</Box>
        <Box flexDirection="column" gap="sm">{tok}</Box>
        <Box flexDirection="column" gap="sm">{cache}</Box>
        <Box flexDirection="column" gap="sm">{fast}</Box>
        <Box flexDirection="column" gap="sm">{limits}</Box>
        <Box flexDirection="row" gap="xs">
          <Button
            key="refresh"
            label="Refresh"
            onPress={async () => {
              await refreshUsage($, true)
              await refreshGit($)
            }}
          />
          <Button key="close" label="Close" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
      </Box>
    )
  })
}

function countsOf(u: ModelUsage): CacheCounts {
  return {
    input: u.input_tokens,
    output: u.output_tokens,
    read: u.cache_read_input_tokens,
    write: u.cache_creation_input_tokens,
  }
}

function addCounts<T extends CacheCounts>(a: T, b: CacheCounts): T {
  return { ...a, input: a.input + b.input, output: a.output + b.output, read: a.read + b.read, write: a.write + b.write }
}

/** One main-loop request done: its cache counts and its timing. */
async function record($: EngineInterface, turnId: string, u: ModelUsage, sent: number, first: number | undefined) {
  const t = await $.clock.now()
  const counts = countsOf(u)
  const touched = counts.read + counts.write > 0

  await update($, last, prev => {
    const at = touched ? t : (prev?.at ?? 0)
    if (prev && prev.turnId === turnId) return { ...addCounts(prev, counts), turnId, at }
    return { turnId, at, ...counts }
  })
  await update($, totals, prev => ({ ...addCounts(prev, counts), steps: prev.steps + 1 }))

  if (first !== undefined) {
    const streamed = t - first
    const output = u.output_tokens
    const ttft = first - sent
    const counted = output > 0 && streamed >= MIN_STREAM_MS
    await update($, speed, prev => {
      const next: Speed = {
        ttftMs: ttft,
        tps: counted ? (output * 1000) / streamed : (prev?.tps ?? null),
        outputTokens: output,
        streamMs: streamed,
        turnMs: prev?.turnMs ?? null,
        count: (prev?.count ?? 0) + 1,
        ttftSum: (prev?.ttftSum ?? 0) + ttft,
        outputSum: (prev?.outputSum ?? 0) + (counted ? output : 0),
        streamSum: (prev?.streamSum ?? 0) + (counted ? streamed : 0),
      }
      return next
    })
  }

  wroteAt = t
  await update($, now, () => t)
  await refreshUsage($)
}
