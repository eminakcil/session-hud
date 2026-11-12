## 📝 What and why

<!-- One or two sentences: what changes for the user, and the case that needs it. -->

Closes #

## 🧪 Evidence

<!-- Match the change (see CONTRIBUTING.md, "Show that it works"). Delete the lines that do not apply. -->

- Visible change: screenshot or recording, before and after (real capture; Claude Code version and surface):
- Test that fails before the change and passes after:
- For anything that waits (clock, turn, git read): test that drives the wait with an event in the middle:

## ✅ Checks

<!-- Tick only what you ran. List anything you could not run, with the reason. -->

- [ ] `claude plugin validate .` passes
- [ ] `claude plugin test .` passes: N tests
- [ ] `npx -p typescript tsc -p .` is clean
- [ ] README updated if behaviour, commands, options or "What it can reach" changed
- [ ] Version in `plugin.json` left alone

Not run, and why:
