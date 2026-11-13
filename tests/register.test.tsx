import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { PALETTES } from '../hooks/icons'

const BAND = {
  plugin: 'session-hud',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 160,
    view: {},
    scroll: { offset: 0, bodyRows: 10 },
  },
} as const

const PANE = {
  plugin: 'session-hud',
  component: 'Pane',
  requestId: 'session-hud',
  props: {
    title: 'Session',
    isFocused: false,
    bodyColumns: 50,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

const NOW = Date.parse('2026-11-12T21:24:00')
const HOUR = 3_600_000

const GIT_STATUS = [
  '# branch.oid 1234567890abcdef',
  '# branch.head feat',
  '# branch.upstream origin/feat',
  '# branch.ab +2 -1',
  '1 M. N... 100644 100644 100644 a b src/a.ts',
  '1 .M N... 100644 100644 100644 a b src/b.ts',
  '1 MM N... 100644 100644 100644 a b src/c.ts',
  '? notes.txt',
].join('\n')

type Counts = { input: number; read: number; write: number; output?: number }

// Stands for the engine beneath the mod.
function engine(on: On) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'S1' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', (_, e) => {
    const out = (exitCode: number, stdout: string) => ({
      value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (e.argv.includes('status')) return out(0, GIT_STATUS)
    if (e.argv.includes('rev-parse')) return out(0, 'C:/repo/.git/worktrees/feat\nC:/repo/.git\nC:/wt/feat\n')
    return out(1, '')
  })
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 43_000, window: 1_000_000, percent: 4 },
      rateLimits: [
        // 3h24m of 5h gone, 22% used: 46 points under pace.
        { kind: 'five_hour', percentUsed: 22, resetsAt: new Date(NOW + 96 * 60_000).toISOString() },
        // 28.6h of 168h left, 41% used: 42 points under pace.
        { kind: 'seven_day', percentUsed: 41, resetsAt: new Date(NOW + 28.6 * HOUR).toISOString() },
      ],
      cost: { usd: 1.5 },
    },
  }))
  const pending: Counts[] = []
  on('turn.step', async function* (_, e) {
    const u = pending.shift() ?? { input: 0, read: 0, write: 0 }
    // First token 2.5s after sending, then 1s of streaming.
    await clock.advance(2500)
    yield { kind: 'text', index: 0, text: 'hi' } as const
    await clock.advance(1000)
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn',
      usage: {
        model: 'm',
        input_tokens: u.input,
        output_tokens: u.output ?? 108,
        cache_read_input_tokens: u.read,
        cache_creation_input_tokens: u.write,
      },
    }
  })
  return { clock, pending }
}

async function step($: Engine, pending: Counts[], usage: Counts, agentId?: string) {
  pending.push(usage)
  const s = $.turn.step({
    turnId: 't1',
    index: 0,
    model: 'm',
    messageCount: 1,
    ...(agentId ? { agentId } : {}),
  })
  for await (const _ of s) {
    // drain
  }
  return s.result
}

async function text($: Engine, mount: typeof BAND | typeof PANE, surface: 'desktop' | 'terminal' = 'desktop') {
  const ui = await $.ui.mount({ ...mount, surface })
  const texts = await ui.findAll({ type: 'Text' })
  await ui.unmount()
  return texts.map(t => t.text).join('|')
}

test('the band shows context and limits with pace before any answer', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const band = await text($, BAND)
  expect(band).toContain('4%')
  expect(band).toContain('43.0k')
  expect(band).toContain('22%')
  expect(band).toContain('↓46%')
  expect(band).toContain('41%')
  expect(band).toContain('↓42%')
  expect(band).not.toContain('tok/s')
})

test('a main-loop request brings cache hit, time left and speed', async ($, on) => {
  const { clock, pending } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await step($, pending, { input: 100, read: 9_000, write: 900 })

  let band = await text($, BAND)
  expect(band).toContain('90%')
  expect(band).toContain('60m')
  expect(band).toContain('2.5s')
  expect(band).toContain('108 tok/s')

  await clock.advance(10 * 60_000)
  band = await text($, BAND)
  // Whole minutes, rounded up, until the last one; the tick runs on its own second.
  expect(band).toMatch(/\b5[01]m\b/)

  await clock.advance(51 * 60_000)
  expect(await text($, BAND)).toContain('cold')
})

test('subagent requests leave the figures alone', async ($, on) => {
  const { pending } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await step($, pending, { input: 1, read: 1, write: 1 }, 'a1')
  const band = await text($, BAND)
  expect(band).not.toContain('tok/s')
  expect(band).not.toContain('cold')
})

test('the pane holds every section, on desktop and terminal', async ($, on) => {
  const { pending } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await step($, pending, { input: 100, read: 9_000, write: 900 })
  for (const surface of ['desktop', 'terminal'] as const) {
    const pane = await text($, PANE, surface)
    expect(pane).toContain('Context')
    expect(pane).toContain('Hit rate, last turn')
    expect(pane).toContain('Time to first token')
    expect(pane).toContain('5-hour limit')
    expect(pane).toContain('Weekly limit')
    expect(pane).toContain('Resets 23:00')
  }
})

test('the git line shows branch, worktree, commits to push and pull, changes', async ($, on) => {
  const { clock } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1000)
  const band = await text($, BAND)
  expect(band).toContain('feat')
  expect(band).toContain('origin/feat')
  expect(band).toContain('↑2')
  expect(band).toContain('↓1')
  expect(band).toContain('2 staged')
  expect(band).toContain('2 modified')
  expect(band).toContain('1 untracked')
  const pane = await text($, PANE)
  expect(pane).toContain('Not pushed')
  expect(pane).toContain('2 commits')
  expect(pane).toContain('Worktree')
})

test('the pane counts input, output, cache read and write per turn, session and subagents', async ($, on) => {
  const { pending } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await step($, pending, { input: 100, read: 9_000, write: 900 })
  await step($, pending, { input: 100, read: 9_000, write: 900, output: 216 })
  await step($, pending, { input: 5, read: 0, write: 2_000, output: 50 }, 'a1')
  const pane = await text($, PANE)
  for (const label of ['Tokens', 'Last turn', 'Session', 'Subagents', 'Input', 'Output', 'Cache read', 'Cache write', 'Total']) {
    expect(pane).toContain(label)
  }
  // Session: 200 input, 324 output, 18k read, 1.8k written
  expect(pane).toContain('|200|')
  expect(pane).toContain('|324|')
  expect(pane).toContain('|18.0k|')
  expect(pane).toContain('|1.8k|')
  // Subagents: 2k written, 50 output
  expect(pane).toContain('|2.0k|')
  expect(pane).toContain('|50|')
})

test('the pane shows the session id and copies it', async ($, on) => {
  engine(on)
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'S1' })).toBeDefined()
  await ui.press({ key: 'copy-id' })
  await ui.unmount()
  expect(copied).toEqual(['S1'])
  expect(toasts).toEqual(['Session id copied.'])
})

test('a light theme draws the band and the pane in the light palette', async ($, on) => {
  const { clock } = engine(on)
  on('config.list', () => ({ value: [{ key: 'theme', value: 'light' }] }) as never)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1000)
  for (const mount of [BAND, PANE]) {
    const ui = await $.ui.mount({ ...mount, surface: 'desktop' })
    const svgs = await ui.findAll({ type: 'Svg' })
    await ui.unmount()
    const sources = svgs.map(x => String(x.props.source))
    expect(sources.length).toBeGreaterThan(0)
    // The dark track is white, the light one black: no Svg may keep the dark one.
    expect(sources.filter(x => x.includes(PALETTES.dark.track))).toEqual([])
    expect(sources.filter(x => x.includes(PALETTES.dark.icon))).toEqual([])
  }
})

test('hover details carry context breakdown, cache and speed averages', async ($, on) => {
  const { pending } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await step($, pending, { input: 100, read: 9_000, write: 900 })
  await step($, pending, { input: 100, read: 9_000, write: 900, output: 216 })
  // The details live in the interactive icons' <title>, the native tooltip.
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const svgs = await ui.findAll({ type: 'Svg' })
  await ui.unmount()
  const tips = svgs.filter(x => x.props.isInteractive === true).map(x => String(x.props.source))
  const all = tips.join('\n')
  expect(all).toContain('<title>Context ')
  expect(all).toContain('<title>Prompt cache ')
  expect(all).toContain('session avg (2) ')
  // (108 + 216) tokens over 2s of streaming
  expect(all).toContain('162 tok/s')
  expect(all).toContain('under pace')
  // Nothing in the band reveals or grows on hover any more.
  const boxes = await (async () => {
    const m = await $.ui.mount({ ...BAND, surface: 'desktop' })
    const found = await m.findAll({ type: 'Box' })
    await m.unmount()
    return found
  })()
  expect(boxes.some(b => b.props.display === 'none' || b.props.hover !== undefined)).toBe(false)
})
