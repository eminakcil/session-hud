# 🤝 Contributing to session-hud

Thanks for helping! session-hud brings a terminal status line to the Claude Code desktop app. Changes that make its figures more accurate, clearer or calmer to look at are the ones most likely to land.

## 🧭 Before you start

- 🐛 **Bug fix:** open the PR directly. Link the issue if there is one.
- ✨ **New feature or behaviour change:** open an issue first and describe the case. It saves you from building something that will not fit.
- 🌱 **Branch from current `main`.** If `main` moves while your PR is open, merge it in before asking for review.
- 🔒 **Out of scope:** sending model requests, writing files, reading prompt text, or running anything beyond read-only git. Those widen what the mod can reach (see [What it can reach](README.md#-what-it-can-reach)) and may fit better as a separate mod.

## 🧪 Show that it works

Every PR carries evidence that matches the change. A reviewer should be able to see what changed without checking out your branch.

| Your change | Evidence to include |
| --- | --- |
| Anything a user sees: the band, the pane, a tooltip, `/hud` | A screenshot or a short screen recording (under 30 seconds) from a real Claude Code session, before and after. Name the Claude Code version and the surface (Desktop Code tab, terminal). Say which surfaces you did not check. |
| Behaviour: what is counted, when something refreshes | A test in `tests/` that fails before your change and passes after. Say in the PR that you checked it fails without the fix. |
| Timing: anything that waits on the clock, a turn or a git read | A test that drives the clock (`mock.clock`) through the wait, with an event in the middle such as a new turn or a `/clear`. |

Screenshots and recordings must be real captures of the running mod, not mock-ups. If you cannot capture or run something, say so and why. Leave out anything private on screen, such as other conversations, file paths or repository names.

## 🛠️ Run it from your checkout

```sh
claude --plugin-dir .
```

## ✅ Checks to run

```sh
claude plugin validate .
claude plugin test .
npx -p typescript tsc -p .
```

The type-check needs the declarations Claude Code writes into `.claude-plugin/types/` when it loads the mod from your checkout (`claude --plugin-dir .`). Keep them untracked; `.gitignore` already does. Paste the pass count from `claude plugin test .` into the PR.

The test kit can set the mod's options for one test: `test('name', { options: { ttl: '5m' } }, async ($, on) => { ... })`.

CI runs `claude plugin validate .` and `claude plugin test .` on every pull request, on the Claude Code version pinned in `.github/workflows/ci.yml`. It must pass before a merge.

## 📝 In the PR

- Use [Conventional Commits](https://www.conventionalcommits.org/) for commits and the PR title: `feat: show the stash count in the git line`, `fix: ...`, `docs: ...`, `test: ...`, `ci: ...`, `chore: ...`.
- Keep the title and description in step with the final diff. If a coding agent wrote the PR, read its description against the diff before you open it; the same evidence applies.
- Update the README when behaviour, commands, options or "What it can reach" change.
- Leave `version` in `.claude-plugin/plugin.json` alone. It is set at release.
