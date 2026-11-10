# H02 v4: exact source-root setup repair

Status: **source-only successor prepared; awaiting exact independent review**.
No new receiving history, Query driver, production graph, or binding verifier
has run. Root conditionally admits one canonical current-main receiving history
only after the reviewer accepts this exact source, recipe, and launcher.

The detached worktree remains
`/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-h02-progress-main-v1`
at `9cfa11fc712866f8f276e85762865ebb8bd49cbe`.

## Measured diagnosis before repair

The accepted v3 launcher first stopped at a sandbox denial of /bin/ps before
Node started. That separate immutable packet is
`canonical-current-main-v3-attempt1-setup-denied-v1`, manifest
`b4a99a5e0855c6672e29f9553a1c96e972be3faa43a088fcf729f12a20567b9b`.
Root authorized one same-byte launch with process-access escalation. It selected
the canonical test, which failed at supervisor line29 before receiving directory
creation or spawn: fileURLToPath received a non-file constructed URL. Three
other outer tests were skipped. Its frozen packet is canonical-current-main-v3,
manifest `373ed93896aed6fe816720497a1bad015664fab1f01440a37b8495ac77c86eee`.
Both attempts executed zero receiving histories and zero binding verifiers.

Root independently checked outer PGID59927 through approved ps and found no
remaining members. This is a root observation, not an author process-list run.
No receiving PGID existed.

The new pure same-runner jsdom diagnostic fixture records:

- actual import.meta.url is file:;
- jsdom self.location is http://localhost:3000/;
- global URL differs from node:url.URL, but an indirect global constructor
  using the actual module base still returns a file URL;
- the actual evaluated literal expression is rewritten to
  new URL('/@fs/...', self.location), which returns HTTP;
- the Node URL alternatives and Node filesystem path derivation return the
  same exact worktree.

Installed Vitest NormalizeURLPlugin source independently shows the syntactic
replacement. The pure diagnostic's exact original/evaluated fixture code,
primitive observations, installed plugin identity, and source snapshots are
frozen at root-setup-diagnosis-v1, manifest
`e0b8c70572a232a1cc6c83aeebe94ca1cad02a0e5ee8fbbaa5d6218a2e0aeabf`.
The original failed supervisor body was not captured, so this evidence does
not invent a retrospective loaded-code receipt for that failed attempt.

## Minimal repair and guard evidence

Only the supervisor changes relative to the accepted v3 instrument. Its pure
resolveProgressRoot helper derives a filesystem root from
dirname(fileURLToPath(import.meta.url)) through node:path.resolve. It creates
no browser asset URL expression. Before any receiving directory or spawn, it
requires the module to occupy the exact supervisor-relative path and requires
the derived root to equal freeze.worktree exactly. Non-file URLs reject at
fileURLToPath. There is no cwd or freeze-root fallback for a stale module.

Three ordinary pure setup fixture/config/test files are added. Importing the
supervisor for its pure helper imports only Node facilities and model types;
it invokes no receiving function. The two pure tests pass:

1. The same client/jsdom runner distinguishes literal asset normalization from
   actual module URL and global URL behavior.
2. The actual supervisor helper returns the exact frozen root and rejects
   non-file, outside, dist, substituted-name, and wrong-frozen-root inputs.
   Actual evaluated supervisor code is retained and contains no self.location.

The source-root calibration uses the unchanged v3 freeze only as the expected
worktree string. It does not claim that v3 hashes approve modified v4 code.
The v4 source envelope freezes the modified helper and its actual observed
original/evaluated code identities.

The previously accepted verifier12/12 and shared-checker10/10 pure results are
carried with exact identities, not rerun. Their source bytes are unchanged.
The final TypeScript check, full-rule scoped ESLint, and exact lint:changed
script invoked directly with Node pass. No lint rule or budget changed.

## Exact preserved scope

All511 original production inputs,11 shared imports/config files, selected
Node bytes, and seven named material package payload maps remain unchanged.
Production identity remains
`39dc1e0516c3ae10ecad9be17befcad1616209572ddd054cddc6823c49459451`.
The17 instrument files are frozen separately. The shared retained-publication
helper remains exactly
`37d8b6e6e6243e86ff1cdc85cf4583c37fe91ba3673be7757bfda90d07c7f81c`.

No production, relational model, history grammar, semantic checker, queued
premise receipt, cached ownership rule, registry, manifest, coverage map,
resource budget, dependency installation, commit, push, or PR changed.
The actual registry/V8 provenance mechanism remains unexecuted on a receiving
worker. Pure setup success supplies no product RED, GREEN, reach, or closure.

## Conditional next runtime

Root conditionally admits exactly one canonical fixed history after exact
reviewer acceptance of v4 source/recipe/launcher. Use the previously approved
process-access escalation, slot2/worker1 serial, receiving heap384MiB,
sampled group RSS1GiB, receiving wall20s, outer test60s, then sequential offline
binding verification and freeze/STOP. Those are operational containment limits.
No retry, campaign, neighboring history, production edit, or substantive runner
change is admitted. Preserve outer and receiving PID/PGID, last process rows,
raw logs, binding result, and selected/skipped reporting. Root performs the
independent final group check.

Setup, provenance, unreached premise, resource termination, bounded
noncompletion after the measured queued premise, semantic assertion, and
complete GREEN remain separate. All receiving reaches and bug-class closure
remain unmeasured. The accepted H02 law and v3 limits remain unchanged.
