# Ordered loader request authority: TLA+ control

This directory holds the bounded TLA+ control from the design-grammar run on
`OrderedSourceLoader` (#2191). It checks the internal consequences of the
grammar's rules for request authority and acquisition retirement. It does not
show that production refines the model. The generated request-authority lane in
`packages/db/tests/query/ordered-source-loader-state-oracle.test.ts`
(`ordered-loader.request-authority`) owns that claim. It drives the real loader
and checks the same three laws.

## Frozen preservation list

The user confirmed these properties before extraction. They come from
ARCHITECTURE.md, "Ordered requests, continuation, and recovery", and the
loader source.

| ID  | Property                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1  | Request shapes: first page or prefix, tie, continuation, bounded repair (`refetch: true`, `limit = offset + limit`), and full-source read.        |
| P2  | Settlement proves only the exact request. The boundary is the last source-derived row.                                                           |
| P3  | The loader's own failure blocks ordinary refills until an explicit window move or the bounded backoff retry.                                       |
| P4  | A request issued before an ordering invalidation proves no current coverage. It cannot clear a failure, change a repair, or retire newer reads. |
| P5  | A repair chain is fenced by its invalidation epoch, and its replaced acquisitions retire only after the chain succeeds.                            |
| P6  | Authoritative work with ordering debt holds publication.                                                                                          |
| P7  | A report is ignored for full-source coverage or a window inside its own first page.                                                               |
| P8  | An overlap after the first settlement starts the bounded repair at once.                                                                          |
| P9  | One request runs at a time; a staged continuation waits for the graph turn that processes its rows.                                             |
| P10 | Every acquisition is released exactly once. A successful full-source read retires every settled finite acquisition.                              |
| P11 | Window operations carry a generation.                                                                                                            |
| P12 | The loader's public methods and the existing oracles stay unchanged.                                                                              |

## Grammar to model trace

| Grammar item                                                           | TLA+ element                                       |
| ---------------------------------------------------------------------- | -------------------------------------------------- |
| Debt lattice: none, bounded, full (`needsOrderingRepair`, `canRepair…`) | `debt`, `Invalidate`                               |
| Work slot: idle, repair chain at an epoch, full-source read             | `phase`, `chainEpoch`, `StartRepair`, `StartFull`  |
| Request stamp and classification                                         | `req[i].ep`, `epoch`                               |
| Supersession by later authoritative work (P8)                           | `req[i].sup`, `Supersede`                          |
| Own and superseded failures (P3)                                         | `failure`, `Fail`                                  |
| Explicit window retry, atomic with its full-source start (P3)           | `ExplicitRetry`                                    |
| Ledger and the coverage epoch (P5, P10)                                  | `req[i].st`, `coverEpoch`, `Normalize`             |

Invariants:

- `ChainHeld`: a finished repair still holds its own acquisition (P4, P10).
- `NoLeak`: once loading is quiet, nothing older than the coverage epoch is
  held (P10).
- `NoStrandedStaleFailure`: a superseded request's failure always has
  recovery running (P3, P8).

The `Rules` constant selects the rule set:

| Configuration                     | `Rules`            | Meaning                                                    |
| --------------------------------- | ------------------ | ---------------------------------------------------------- |
| `safe-unified.cfg`                | `unifiedMin`       | Superseded failures raise debt only; one epoch normalization. The shipped rule set. |
| `safe-patched-cases.cfg`          | `unified`          | The same, with the earlier per-case retirement rules kept. |
| `weak-main-before-2191.cfg`       | `current`          | The rules on main before #2191.                            |
| `weak-stale-prefix-retires.cfg`   | `oldRetire`        | A stale prefix retires the repair's prefix.                |
| `weak-stale-held.cfg`             | `oldLeak`          | A stale request that settles after the repair stays held.  |
| `weak-no-recovery.cfg`            | `oldRecover`       | A superseded failure starts no recovery.                   |
| `weak-no-normalize.cfg`           | `unifiedMinNoNorm` | The unified rules without the normalization step.          |

## Results

TLC 2.19 (rev 5a47802) through the Field Lab container, `MaxEpoch = 2`, four
request slots, deadlock check off (full coverage is terminal):

| Configuration                   | Result                                              |
| ------------------------------- | --------------------------------------------------- |
| `safe-unified.cfg`              | No error, 26,048 distinct states, exhaustive        |
| `safe-patched-cases.cfg`        | No error, 25,172 distinct states, exhaustive        |
| `weak-main-before-2191.cfg`     | `NoStrandedStaleFailure` violated in 9 steps        |
| `weak-stale-prefix-retires.cfg` | `ChainHeld` violated                                |
| `weak-stale-held.cfg`           | `NoLeak` violated                                   |
| `weak-no-recovery.cfg`          | `NoStrandedStaleFailure` violated                   |
| `weak-no-normalize.cfg`         | `NoLeak` violated                                   |

The 9-step trace on main: a page is superseded by a bounded repair, the repair
finishes, a newer invalidation's reaction is deferred, and the old page fails.
The loader recorded the failure as its own and blocked refills. The loader
state oracle reproduced this on main before the fix.

Four encoding corrections were made during the run; none weakened a frozen
property:

1. The strand invariant covers only superseded failures, since the failure law
   allows an unsuperseded failure to block.
2. The leak and held invariants measure from the coverage epoch, since an
   overlapped full-source read still clears the debt.
3. An authoritative failure counts as the loader's own failure.
4. An explicit retry starts its full-source read in the same step.

## Limits

The model leaves out the scheduler (staged continuations, deferred refills, and
the graph-revision check), cursor and boundary values, tie and refill sub-steps,
same-epoch prefix supersession, truncate replay, and publication holds. Two of
the four flag-interaction bugs found in #2154 lived in parts it leaves out. A
passing bounded run says nothing about states outside these bounds.

## Run

```sh
~/.claude/skills/field-lab/scripts/tlc . -config safe-unified.cfg LoaderLedger
```

