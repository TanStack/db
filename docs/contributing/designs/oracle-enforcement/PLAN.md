# Oracle enforcement: plan and handoff

Status: plan. A later session implements it. This document carries the context
that session needs.

## Why

Agents keep taking the shortcut path when they change behavior in an area that
an oracle owns. They change production first, then make the oracle pass with a
relaxed comparison, an exclusion, a model rule that matches the new output, or
one pinned example. `AGENTS.md` and the oracle guide already forbid this. The
prose did not stop it, because nothing made the shortcut visible or slow.

PR #2233 adds the scoring section in `AGENTS.md` ("How oracle work is scored"),
ORC-015 declared reach, and `createOracleReach` in
`packages/db/tests/oracle-reach.ts`. This plan adds the mechanical checks.

The evidence comes from PR #2168 (source-health channel). A production-first
rewrite of reload handling there needed four more review rounds and about ten
follow-up commits. Each round found a defect in the previous fix. These
shortcuts appeared in that work:

- Production changed before the oracle could see the defect.
- A truncate step could never land while a reload was in flight, because the
  driver's delayed `markReady()` always ran within the same step. The oracle
  was green in a state that it never reached.
- A direct-subscriber observation existed only on eager sources. The
  subscription lifecycle oracle subscribed without initial state, so its
  replay flush published nothing.
- Model rules changed to match production traces. Two of them (an automatic
  query restart, and "a key requested again drops a replay failure") were later
  found wrong and removed.
- Comparison exclusions (`replayOpen`, a narrowed identity check) widened
  without a fresh maintainer decision.
- Most edits went through shell commands (Python and `sed`), so an edit hook
  that matches only the harness's own edit tool would not fire.

## Order of work

1. Install the agent feedback hooks with a small starter rule set, so that the
   session that does the cleanup gets feedback as it works.
2. Add the custom ESLint oracle rules. Run them over the repository and record
   every existing violation.
3. Clean up the violations owner by owner, each with the oracle-first order
   from `AGENTS.md`. Expect to find real gaps: a conditional `expect` often
   hides an unreached state.
4. Add the CI jobs (RED replay, owner coupling, model tripwire).
5. Adopt `createOracleReach` in `packages/db/tests/source-health-oracle.test.ts`
   (PR #2168, or a follow-up after it merges).

## Static checks: custom ESLint rules

Apply these rules to files whose names contain `oracle`. Keep them syntactic
and fast, so the edit hook can run them on one file.

| Rule | Reports | Notes |
| --- | --- | --- |
| `oracle/declared-reach` | A generated property (`fcTest.prop`, `fc.assert`) in a file that has no `createOracleReach` call and no `assertReached()` call. | Few false positives. Several oracles count reach in their own way today, for example `collection-subscription-lifecycle-history-oracle.property.test.ts`. Convert them or allow a documented equivalent. |
| `oracle/no-conditional-expect` | An `expect` under an `if`, a ternary, `&&`, `\|\|`, or after an early `return` or `continue` inside a comparison. | This is the main exclusion pattern. Allow it only with `// oracle-exclusion: <anchor>`. A script checks that `<anchor>` exists in `docs/contributing/oracle-coverage.md`. Some conditional checks are legitimate (a check that applies only in a modeled state). The comment covers those, and the auditor judges the reason. |
| `oracle/model-independence` | A model function that imports from, or calls into, production `src/`. | Needs a convention first: models in `*-model.ts` files, or a marked region. Drivers may import production. Models may not, except public types. |
| `oracle/no-disabled` | `.only`, `.skip`, or `.todo` on a generated property, and a literal run count below the base, such as `numRuns: 1`. | Trivial. |
| `oracle/registered-property` | A property name that `oracle-config.ts` does not register. | The registry already checks this at run time. Lint reports it earlier. |

## Diff checks in CI

- **RED replay.** The PR's evidence block names the oracle tests. CI runs those
  tests from the PR head against the merge-base production `src/`. They must
  fail there and pass on the head. This checks the oracle-first order
  mechanically: an oracle that cannot see the defect cannot produce RED.
- **Owner coupling.** A production change in an area that the coverage map
  assigns to an owner, without a change to that owner and without an evidence
  block, fails. This needs a machine-readable table of owners to production
  paths, which the coverage map does not have yet.
- **Model tripwire.** A PR that changes both production and a model region gets
  a flag for the auditor. It does not fail the build. It makes the pair hard to
  miss.

## Run-time checks

- Declared reach (`createOracleReach`, ORC-015).
- Mutation testing (for example Stryker) on the production files that each
  oracle owns, as a nightly job. A low kill rate for an owner shows an oracle
  that accepts wrong implementations. It is too slow for each PR.

## Immediate agent feedback across harnesses

Contributors use several agent tools. Most now have a post-edit hook that can
return lint output to the model. Each has its own configuration path, tool
names, and feedback protocol. Research from 2026-10-23:

| Harness | Post-edit hook | Configuration | Feedback to the model | End-of-turn hook that can force a retry |
| --- | --- | --- | --- | --- |
| Claude Code | `PostToolUse`, matcher `Edit\|Write` | `.claude/settings.json` | exit `2` with stderr | `Stop` |
| Codex CLI | `PostToolUse`, matcher `apply_patch` | `.codex/hooks.json`. The project must be trusted, and the hook approved in `/hooks` | exit `2` with stderr | not found |
| Cursor | `afterFileEdit` (stdin has `file_path`) | `.cursor/hooks.json` | not confirmed. The documentation shows a logging-style hook | not confirmed |
| Gemini CLI | `AfterTool`, matcher `write_file\|replace` | `.gemini/settings.json` | JSON `hookSpecificOutput.additionalContext` | `AfterAgent` with `decision: "deny"` |
| GitHub Copilot coding agent | `postToolUse` | `.github/hooks/*.json`, read only from the default branch | JSON `additionalContext`. A nonzero exit does not block | `agentStop` with `decision: "block"` |
| Windsurf / Devin Desktop | `post_write_code` (stdin has `tool_info.file_path`) | `.windsurf/hooks.json` or `.devin/hooks.json` | exit `2` with stderr | not found |
| Cline | executable `PostToolUse` | `.clinerules/hooks/PostToolUse`, with "Enable Hooks" turned on | JSON `contextModification` | not found |
| OpenCode | plugin `tool.execute.after` | `.opencode/plugins/*.ts` | append to the tool's `output.output`. `"lsp": true` also reports LSP diagnostics on edits | not found |
| Aider | built-in `--auto-lint` with `--lint-cmd` | `.aider.conf.yml` | built in: a nonzero exit makes Aider offer a fix | not applicable |

Sources: code.claude.com/docs/en/hooks, developers.openai.com/codex/hooks,
cursor.com/docs/hooks, geminicli.com/docs/hooks/reference,
docs.github.com/en/copilot/reference/hooks-reference,
docs.windsurf.com/windsurf/cascade/hooks, the Cline repository's
`.clinerules/hooks/README.md`, opencode.ai/docs/plugins, and
aider.chat/docs/usage/lint-test.html. Check each one again before you build:
these APIs change often.

### Design

1. **One shared script with thin adapters.** `scripts/agent-lint-feedback.mjs`
   reads the hook's JSON from stdin, finds the edited paths (each harness uses
   a different field, and Codex sends the patch text of `apply_patch`), runs
   ESLint on those files only, and writes the response in the format the
   harness expects (`--format=claude|codex|gemini|copilot|cline|windsurf`).
   Each harness gets a small committed configuration that calls the script.
2. **An end-of-turn hook for shell edits.** A post-edit hook matches only the
   harness's own edit tool. Where a harness has an end-of-turn hook, run lint on
   `git diff --name-only` there. That catches shell edits too, and it can force
   another turn. For the other harnesses, the pre-commit hook is the fallback.
3. **Speed.** A hook that takes seconds on each edit gets turned off. Use
   `eslint --cache` on single files, or a daemon such as `eslint_d`. Keep the
   oracle rules syntactic, and keep type-aware rules out of the edit hook.
4. **Fallbacks.** Some harnesses need setup by each contributor (Codex trust,
   the Cline toggle, the Copilot default branch). Keep these layers:
   - an `AGENTS.md` instruction to run `pnpm lint:changed` after edits.
   - editor diagnostics, which IDE-based agents read.
   - the pre-commit hook.
   - CI.

### Pre-commit

`lint-staged` already runs `eslint --fix` on staged files. The oracle rules run
there once they are in the ESLint configuration. On a commit of more than about
100 files, ESLint ran out of memory in PR #2168. Lint in chunks, or raise the
Node heap in the hook.
