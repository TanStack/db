# Persisted raw commit receiver: post-repair GREEN

This supplements `persisted-raw-commit-evidence.md`; its original RED and
authority record remain unchanged. ROOT applied the production repair in
`packages/db/src/collection/subscription.ts`. This agent made no source,
expectation, budget, reach or fixture change during post-repair validation.

The tested production file SHA-256 was
`c321c1489cd2cd124db31dcfe5d0ea4e1f4c6935bd48b3c976380dfa72d5cee6`.
The unchanged receiving file SHA-256 was
`07c3d92a221c67f32de3aeb7290e59ad960d1199ef2728c48d782aec060c4c66`.
The shared model/check SHA-256 was
`7b0e07736adf5f7e8836d5f716ca632f29718b63556131dee7ec3677b84aabf4`.

## Full campaigns

The ordinary fixed and unseeded random campaigns each ran the configured eight
shared examples plus twelve generated histories. Both passed. The private config
and W-local aliases are the same as in the RED report. No assertions were relaxed.

Actual measured reach counts in the fully logged GREEN run:

| State | Fixed: 20 histories | Random: 20 histories |
| --- | ---: | ---: |
| Raw truncate applied | 20 | 20 |
| Real wrapped candidate receipt pending | 20 | 20 |
| Real mutex scan held | 20 | 20 |
| Held public observation | 20 | 20 |
| Receipt and mutex progressed | 20 | 20 |
| Quiet failed public observation | 10 | 9 |
| Successful publication observation | 10 | 11 |

All forty traces have zero failures. Reads and full-state raw subscriber folds
agree with each authored applied prefix at every compared cut. The real
wrapping receipt remains pending while durability is held; the real persisted
scan remains blocked behind that mutex turn. Both progress after release while
the provider result remains held. Rejected histories report the exact provider
error and retain the applied rows in both observations.

Raw output: `persisted-raw-commit-green-full.{stdout,stderr}.log`. Exit 0;
two tests passed; 155 ms tests, 2.13 s total; started 11:04:04 on 2026-10-30.

The command is the RED report's exact normal runtime command, with
`--disableConsoleIntercept` added and those GREEN log destinations. The complete
argument suffix is:

```sh
run collection-public-snapshot-persisted-oracle --config review-evidence/collection-publication/vitest.persisted-public-snapshot.config.mts --disableConsoleIntercept > review-evidence/collection-publication/persisted-raw-commit-green-full.stdout.log 2> review-evidence/collection-publication/persisted-raw-commit-green-full.stderr.log
```

Two earlier post-repair runs also passed (`green1`: 202 ms tests / 2.26 s total;
`green-counts`: 155 ms / 2.28 s), but passing console interception suppressed
their reach output even with `--silent=false`. They are retained as passing
results, not the source of the measured counts. Bypassing interception supplied
the raw traces without changing the oracle.

## Saved exact replays

The saved commands use the same executable, config and file filter, plus
`--disableConsoleIntercept` and these unchanged environment prefixes:

```sh
TANSTACK_DB_ORACLE_PROPERTY=persistence.collection-public-snapshot TANSTACK_DB_ORACLE_SEED=30102026 TANSTACK_DB_ORACLE_PATH=1
TANSTACK_DB_ORACLE_PROPERTY=persistence.collection-public-snapshot TANSTACK_DB_ORACLE_SEED=30102026 TANSTACK_DB_ORACLE_PATH=4
```

| Replay | Result | Measured reach |
| --- | --- | --- |
| Path 1: initial `a=0`, applied truncate, empty candidate, success | Exit 0; one passed, fixed registration skipped; 15 ms tests / 1.72 s total. Raw reads and fold both empty after truncate. | First five states once, success once, failed zero. |
| Path 4: initial empty, candidate `a=1`, rejection | Exit 0; one passed, fixed registration skipped; 16 ms tests / 2.07 s total. Reads and fold both keep `a=1` after rejection; exact error reported. | First five states once, failed once, success zero. |

Raw output pairs are `persisted-raw-commit-green-replay1.{stdout,stderr}.log`
and `persisted-raw-commit-green-replay4.{stdout,stderr}.log`. Each trace has
zero failures and independently records receipt and mutex progress.

## Scope and remaining gates

No new typecheck concern arose and no driver/model source changed after the
previous ordinary package typecheck passed, so it was not repeated. ROOT owns
production compilation and broader integration checks. This agent performed
no production edit or mutant. Runtime work is quiescent for ROOT's coordinated
original-defect mutant; these GREEN results do not supply that evidence.

The receiving boundary remains one retained whole-source raw subscription,
one replay and one candidate transaction through the actual persistence
wrapper over an in-memory adapter with the default coordinator. Native SQLite,
peer coordination, optimistic overlays, scoped recovery and live-query result
coherence remain outside this receiver. All original reaches and budgets are
preserved, with the added raw-truncate reach. Broader class closure is not claimed.
