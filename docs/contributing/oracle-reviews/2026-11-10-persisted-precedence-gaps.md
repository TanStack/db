# Persisted fetch/write precedence: gap amendment

Production source: `5feb26616a8357853454c2f9ff2ce0b0adb9c908`.
This amendment adds oracle coverage without changing production. The previous
mutation [audit](2026-11-10-startup-gap-cli.md) remains historical evidence.

## Law and independent judgment

An older fetch cannot undo the keys of an accepted newer direct write. A later
physical fetch may replace those keys. A complete eager result removes saved
rows that it omits, while preserving the newer write. The authority is
`docs/collections/query-collection.md`, **Direct Writes and Query Sync**;
its **Individual Write Operations** section permits full-row inserts/upserts
before initial loading finishes. Updates/deletes need an accepted target row.

The existing ownership oracle's keyed overlay computation now lives in
`direct-write-precedence-oracle.ts`. Both the ownership oracle and the new
persisted receiver use that computation. It overlays authored writes/deletions
on a complete fetched row set. It imports no Query generation classifier,
ownership machinery, persistence helper, or cache patch algorithm.

The receiver additionally checks the documented cache boundary: raw responses
can represent the direct write, while a derived select without an inverse keeps
its fetched response envelope. Collection rows still obey write precedence.
All value comparisons project keyed `id`/`value` rows; virtual row properties,
ownership metadata, and event counts are outside this added judgment.

## Histories, reach, and observation cuts

`persisted-precedence-oracle.ts` defines 104 fixed histories. Fixed-seed 2394 and
fresh campaigns each generate 80 histories per Node host, using the same
grammar, production driver, comparison, and budget. The dimensions are:

- Raw rows or an envelope whose select clones its nested nodes.
- Insert/update/delete/upsert after restore, before the old result returns.
- Those four operations while the result's retained-baseline scan waits,
  either before the real read or after that read captured its rows.
- New-key insert/upsert authored while the initial persisted restore is held,
  then the older result returns before restore is released.
- A direct write before the first physical fetch, after a disabled Query restores. The later complete fetch may retire that write.
- A cached success offered after restore, with no physical fetch, while its retained-baseline read is held.
- An optional later physical refetch and values from -10 through 10.

The baseline has three source-owned saved keys retained until revalidation;
the fetched result changes two and omits the third. A direct insert/upsert
adds a fourth key. Removing the held-restore dimension loses the historical
derived-baseline mutant below. Removing derived select loses the no-inverse
branch. Removing the after-read hold loses captured-stale-baseline coverage.
Removing later fetch loses evidence that newer source authority can replace
the direct write. Update/delete before restore are excluded because no target
row has been accepted; they are a different write-validation history, already
owned by the direct-write-window oracle.

The driver seeds real storage through a persisted Collection, then uses a real
QueryClient, Query Collection, and persistence wrapper. Gates delay real
collaborator completion; they supply no expected rows. The Node adapters hold
the real full-row restore, including its hydration-scoped adapter. Chromium
uses the existing OPFS snapshot-read seam, because its internal restore path
cannot be held by wrapping only the public adapter method.

After-restore histories compare immediately after the accepted direct write,
while the old source result remains held. All histories compare public rows,
durable rows and cache projection at the first complete result's applied
receipts, before refetch can repair them. Optional refetch compares public rows
inside fulfillment and durable rows afterward. A held-restore history makes no
early assertion that saved rows were already public.

Reach is enforced separately per host and campaign. Chromium receives all
104 histories, using the same judgment, in the shared eager-gap page. Its exact
counts are:

| State | Histories |
| --- | ---: |
| raw / derived | 52 / 52 |
| fetched-result / cached-result | 72 / 32 |
| before-result / before-fetch / before-restore / during-baseline | 16 / 16 / 8 / 64 |
| before-read / after-read | 32 / 32 |
| insert / update / delete / upsert | 28 / 24 / 24 / 28 |
| later-fetch | 52 |

The browser page also receives 48 on-demand Query scope histories, two cached-peer claim histories, 24 TrailBase and 24 histories for each unwrapped
RxDB/PowerSync reload receiver: 226 total. It enforces each receiver's reach,
checks page errors, and checks that fixture database artifacts were removed.

## Experiments

The new Node suite passes eight tests: for each controlled and real Node SQLite
host, 104 fixed histories, two 80-history campaigns, and a checker calibration
that removes the newer inserted row from a real observation. Current production
also passes the 226-history Chromium receiving run. No production edit preceded
these runs, and no production edit was needed afterward.

The exact historical derived-baseline mutant, now `query.ts:M1748`, replaces
`needsPersistedBaseline(hashedQueryKey)` with false only in the deferred
no-inverse-select branch. An immutable module transform runs it in a separate
Vitest process; the shared source file is never overwritten. It passes the
earlier 48-history fixture, whose writes all waited for restored rows. After
the held-restore dimension is added, both Node hosts reject it at **first** and
**firstDurable**: `obsolete` survives even though the fetched result omitted it.
The newer inserted key remains, distinguishing the omission defect from write
loss. This demonstrates why counting a later refetch alone would be inadequate.

The `M1793` cutoff mutant changes `??` to `&&` in the general-result branch.
The cached-success dimension rejects it at first-result public and durable
cuts: a newer update is replaced by the cached old value. Node SQLite shrinks
to raw cached success, before-read hold, update, no later fetch, value 0,
campaign seed -946755224 and path `5:1:1`. Both Node hosts reject the mutant in
a guarded replay and pass current production at the same coordinates.

Other exact controls preserve legal implementation freedom:

- `M563` includes a same-run ownerless direct row in the hydrated owner set.
  It passes all 104 histories and both generated campaigns on both hosts,
  including writes before the first physical fetch. Existing direct-row
  lifetime/absence machinery still supplies the public and durable answer.
  This is bounded eager equivalence, not on-demand evidence.
- `M1794` removes the stored fetch-start lookup but retains the captured direct
  write position. It passes the same comparisons, including cached results and
  writes during both baseline holds. At general-result enqueue, a direct write
  already newer than the fetch enters the earlier deferred branch instead.
  Otherwise, both cutoffs identify the same later same-Collection key writes.
  Cached results already use the captured-position fallback. This argument
  explains the observed equivalence within these legal result paths.
- `M1473` forces reconciliation after eager ownership exists. It passes 250
  registrations: the new precedence receiver and the shared startup suite,
  including the startup owner's physical full-row-read budget. Its later
  hydration request reuses the accepted baseline. Extra optional capability
  calls alone do not violate a promised no-call law.

These isolated runs disable Vitest's filesystem module cache, use a distinct
cache directory/plugin identity for each operator, and log the applied mutant's
SHA256. Initial standalone runs that reused a config identity are superseded;
they do not supply the above classifications. The ordinary gap CLI already
uses equivalent cache protections. The derived-baseline and cutoff controls
both fail in the isolated rerun; the three bounded-equivalence controls pass.

The generated Node SQLite failure shrinks to derived select, before-restore,
insert, no later fetch, value 0. Its final-grammar campaign seed is 1337087813 and shrink path
`8:1:1:1`. The earlier 56-history grammar replay used seed 290176300 and
path `3:1:1:1:1`; that coordinate remains historical. The guarded replay records one failed execution on each host under
the mutant and one successful execution on each host with current production.
The fixed histories reconstruct the same ordering with value 9.

Commands from the worktree root:

```sh
pnpm --config.verifyDepsBeforeRun=false --filter @tanstack/query-db-collection exec vitest run --maxWorkers=2 --coverage.enabled=false --typecheck.enabled=false tests/persisted-precedence-oracle.test.ts
pnpm --config.verifyDepsBeforeRun=false --filter @tanstack/query-db-collection exec vitest run --maxWorkers=2 --coverage.enabled=false --typecheck.enabled=false tests/ownership-lifecycle.oracle.test.ts tests/persisted-direct-write-window.oracle.test.ts tests/persisted-startup-conformance-oracle.test.ts tests/persisted-precedence-oracle.test.ts
```

The second command passes 565 tests with the final 104-history grammar.
From `packages/query-db-collection`, the clean checked replay is:

```sh
TANSTACK_DB_ORACLE_SEED=1337087813 TANSTACK_DB_ORACLE_PATH=8:1:1:1 TANSTACK_DB_ORACLE_PROPERTY=query.persisted-write-precedence node --import tsx ../db/tests/oracle-replay.ts tests/persisted-precedence-oracle.test.ts --maxWorkers=2 --coverage.enabled=false --typecheck.enabled=false
```

From `packages/browser-db-sqlite-persistence`:

```sh
pnpm --config.verifyDepsBeforeRun=false exec playwright test --config playwright.opfs.config.ts eager-gap-conformance-oracle.opfs.spec.ts
```

Scratch logs, the immutable mutant config, replay witnesses and the exact
assertion differences remain in `.review-2367/gap-fill/`.

## Independent challenge and scope

A separate agent reviewed the law, model, driver and comparisons. It identified
the initially fresh-read-only scan gate; the after-read dimension addresses that
concern. Mutation execution then identified the fixture's unconditional
restored-row wait; the held-restore dimension addresses that gap. Neither
correction changes a product expectation to match production.

This receiver covers one eager sync run, one direct write, three saved string
keys and numeric values, optional later fetch, and no peer owners or failed I/O.
It does not establish on-demand window behavior, overlapping optimistic
transactions, every intermediate publication, arbitrary metadata, or a network
transport. The existing shared startup owner separately exercises non-retained
baselines, peers, ownerless rows, optimistic holds and network-first fallback.
This retained receiver supplies no evidence for non-retained hydration
classification merely by recording scan counts.

The [current mutation audit](2026-11-10-startup-gap-current-head.md) separately
classifies redundant hydration and fetch-cutoff operators. It preserves
implementation freedom when a changed internal call cannot change the promised
public/durable result or the established physical-read budget. The separate
[measurement report](2026-11-10-persisted-startup-measurements.md) quantifies
startup costs; this correctness result does not establish performance parity.
