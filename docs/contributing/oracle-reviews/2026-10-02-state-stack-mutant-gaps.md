# State-stack mutation round: test gaps

Reviewed executable revision: `f1a40e58d` (base
`ef1e6a4aa`). No production code changes.

## How the gaps were found

A planned code-weight refactor of `state.ts`, `sync.ts`, and `lifecycle.ts`
has nine prototype commits. Before porting them, 22 plausible porting mistakes
were applied to unchanged `main` as source mutants. Each survivor of the db
suite was then classified with a probe that passes on `main` and fails on the
mutant, or with evidence that the mutant changes no public observation. Two
survivors exposed bugs on `main`, which have separate repairs: a direct
mutation confirmed inside its handler (#1986) and an update sent for an
absent key (#1995). This change closes five survivors that were test gaps.

| Mutant | Wrong behavior that passed the suite | New witness |
| --- | --- | --- |
| B4 | A sync insert did not clear the key's pending local layers. After a confirmed insert, the next remote update reported `$origin: 'local'`. | Optimistic-history grammar: source rows are written as `insert` for a key the source lacks. |
| B2 | A sync delete did not clear the key's pending local layers. A later source reinsert reported `$origin: 'local'`. | Optimistic-history grammar: source deletes. Pinned replay of the random-campaign counterexample. |
| F2 | A sync `write()` after `commit()`, while the batch waited for persistence, joined the queued batch. | Retention oracle: a write to a committed, waiting batch throws `SyncTransactionAlreadyCommittedWriteError`. |
| G4 | Cleanup with a pending subset load emitted a `start` transition. | Cleanup/restart oracle: one `end` transition at cleanup. |
| H3 | Idle cleanup that rescheduled itself could not be canceled by a returning subscriber, so the Collection cleaned up early. | New `collection-idle-cleanup.test.ts`, with a controllable browser idle scheduler. |

## Grammar change

Every optimistic-history source batch wrote `update` messages, which act as
upserts. The production `insert` and `delete` apply paths never ran in those
histories. The driver now tracks which keys the source holds, including
queued batches, in write order:

- A row for an absent key is written as `insert`. Later copies are updates.
- A batch may carry `deletes`. Only keys the source holds apply.
- The model receives the same resolved batch and removes deleted keys from
  its base. A source delete acknowledges no request.

A runtime witness requires 40 fixed-campaign histories to write source inserts
and deletes. The extended grammar passes on `main`.

| Run | Result |
| --- | --- |
| Retention owner, B4 applied | 3 of 97 fail |
| Retention owner, B2 applied | the pinned replay fails; the fixed campaign does not reach it |
| Retention owner, F2 applied | 1 of 97 fail |
| Cleanup/restart owner, G4 applied | 1 of 41 fail |
| Idle-cleanup owner, H3 applied | 1 of 1 fail |

## Survivors that change no observation

These were classified with evidence and need no witness. The port can delete
the code under the last two.

- A2 to A4: the truncate reapply search and filter are dead.
- G1, G3, H2, I3: stale state that every reader ignores, or a cancellation that
  is a no-op on every reached history.
- D1, D3: the recompute delete filter's inner branch ran 0 times in 7,871
  tests and in targeted histories. Recompute keeps optimistic layers for keys
  with pending sync operations, so no such delete forms.

## Limits

- H3 depends on a browser idle scheduler. The suite's Node polyfill always
  reports a timed-out deadline.
- Source deletes run only after a batch's rows. A delete before an insert of
  the same key in one batch is outside the grammar.
- The fallback that derives previous `$synced`/`$origin` from completed
  request keys still has a survivor (see the
  [absent-key insert review](2026-10-02-insert-for-absent-key.md)).

## Verification

`packages/db` Vitest, typecheck off: 201 files, 7,862 tests. `tsc --noEmit`
reports only the `tests/conformance` errors that need a built `dist`.
