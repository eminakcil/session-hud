/** A request's tokens: uncached input, output, cache read and cache write. */
export type CacheCounts = { input: number; output: number; read: number; write: number }

/** The main conversation's requests of one turn, and when the cache was last touched. */
export type LastTurn = CacheCounts & { turnId: string; at: number }

export type Totals = CacheCounts & { steps: number }

/** The last main-loop request's timing, and the session's sums for averages. */
export type Speed = {
  ttftMs: number
  tps: number | null
  outputTokens: number
  streamMs: number
  turnMs: number | null
  /** Session sums: requests timed, their TTFT, output tokens and streaming time. */
  count: number
  ttftSum: number
  outputSum: number
  streamSum: number
}

export type Limit = { kind: string; percentUsed: number; resetsAt: string | null }

export type Category = { name: string; kind: string; tokens: number }

/** What $.session.usage() answered last. */
export type Usage = {
  contextTokens: number | null
  contextWindow: number
  contextPercent: number | null
  compactAt: number | null
  categories: Category[]
  costUsd: number | null
  limits: Limit[]
}

/** The working directory's git state. */
export type Git = {
  branch: string | null
  /** Short commit when HEAD is detached. */
  detachedAt: string | null
  upstream: string | null
  /** Commits not pushed / not pulled, against the upstream as last fetched. */
  ahead: number
  behind: number
  staged: number
  modified: number
  untracked: number
  conflicts: number
  /** A linked worktree's folder name; null in the main checkout. */
  worktree: string | null
  checkedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'session-hud': {
      last: Shaped<LastTurn | null>
      totals: Shaped<Totals>
      /** Every subagent request of the session, summed. */
      agentTotals: Shaped<Totals>
      speed: Shaped<Speed | null>
      usage: Shaped<Usage | null>
      git: Shaped<Git | null>
      now: number
    }
  }
}
