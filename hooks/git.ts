import type { EngineInterface } from 'claude-code'

import type { Git } from '../types'

/** Reads `git status --porcelain=v2 --branch` into the band's figures. */
export function parseStatus(out: string): Omit<Git, 'worktree' | 'checkedAt'> {
  const git: Omit<Git, 'worktree' | 'checkedAt'> = {
    branch: null,
    detachedAt: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    staged: 0,
    modified: 0,
    untracked: 0,
    conflicts: 0,
  }
  let oid: string | null = null
  for (const line of out.split(/\r?\n/)) {
    if (line.startsWith('# branch.oid ')) oid = line.slice(13)
    else if (line.startsWith('# branch.head ')) git.branch = line.slice(14)
    else if (line.startsWith('# branch.upstream ')) git.upstream = line.slice(18)
    else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line)
      if (m) {
        git.ahead = Number(m[1])
        git.behind = Number(m[2])
      }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const xy = line.slice(2, 4)
      if (xy[0] !== '.') git.staged += 1
      if (xy[1] !== '.') git.modified += 1
    } else if (line.startsWith('u ')) git.conflicts += 1
    else if (line.startsWith('? ')) git.untracked += 1
  }
  if (git.branch === '(detached)') {
    git.branch = null
    git.detachedAt = oid && oid !== '(initial)' ? oid.slice(0, 7) : null
  }
  return git
}

const norm = (p: string) => p.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
const base = (p: string) => p.trim().replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() ?? p

/**
 * The working directory's git state, or null outside a repository. A linked
 * worktree is named by its folder.
 */
export async function readGit($: EngineInterface, now: number): Promise<Git | null> {
  const opts = { timeoutMs: 10_000 }
  const [status, dirs] = await Promise.all([
    $.process.run(['git', '--no-optional-locks', 'status', '--porcelain=v2', '--branch'], opts),
    $.process.run(['git', 'rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir', '--show-toplevel'], opts),
  ])
  if (status.exitCode !== 0) return null
  let worktree: string | null = null
  if (dirs.exitCode === 0) {
    const [gitDir, commonDir, top] = dirs.stdout.split(/\r?\n/)
    if (gitDir && commonDir && top && norm(gitDir) !== norm(commonDir)) worktree = base(top)
  }
  return { ...parseStatus(status.stdout), worktree, checkedAt: now }
}
