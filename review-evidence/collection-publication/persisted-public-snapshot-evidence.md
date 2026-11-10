# Persisted receiving witness: public snapshot RED

Base: `c351fc04d7f70dc59bf92ecbed310f899b9511cd` in
`/Users/kyle.mathews/.codex/worktrees/collection-publication/tanstack-db`.
No production source changed for these runs. No installs, budget reductions,
commits, pushes or PR mutations occurred.

## Law and receiving path

Authority: maintainer decision, 2026-10-30, recorded in `oracle-plan.md` and
`packages/db/tests/collection-public-snapshot-oracle.ts`. An authoritative
replay retains the last coherent Collection public snapshot during work and
after failure. At successful publication, direct reads and subscriber folds
advance together. Applied receipts retain their public-visibility meaning.

The new receiving file is
`packages/db-sqlite-persistence-core/tests/collection-public-snapshot-persisted-oracle.test.ts`.
It imports the shared history arbitrary, examples and comparison. Its own code
only drives the actual `persistedCollectionOptions` wrapper over the existing
`createRecordingAdapter` in-memory host and records observations.

The upstream loader really awaits the receipt from its wrapped `commit()`.
A metadata-tagged durable adapter operation holds the wrapper's real apply
mutex, including for an empty candidate. A capability `scanPersistedRows()`
operation queues behind that mutex. Neither receipt nor mutex is emulated by
the fixture. Source paths are `persisted.ts:3418` (source apply mutex),
`:4481–4501` (application then durable work), `:3854` (scan mutex),
`:6305–6315` (visible-after-durable receipt), and `:7533–7665` (load forwarding).
The tag is only a hold selector; it does not define public expectations.

## Observed RED and independent progress

The first shared example starts with no rows and replaces them with `a=1`.
The observation recorder reads complete values, entries, exposed base and all
legal keys through `get`; it also folds the real subscriber messages.

| Cut | Direct rows | Subscriber fold | Real receipt / real scan | Result |
| --- | --- | --- | --- | --- |
| Initial | empty | empty | bootstrap applied | Model agrees |
| Durable candidate held, before receipt fulfillment | `a=1` | empty | receipt pending, queued scan not entered | Privacy assertion RED |
| Durable released, provider result still held | `a=1` | empty | receipt fulfilled, queued scan entered and settled | Privacy assertion RED; receipt/mutex progressed |
| Successful replay verdict | `a=1` | `a=1` | provider returned after receipt | Model agrees |
| Rejected replay verdict, separate history | `a=1` | empty | receipt fulfilled; exact provider error reported | Failed-snapshot assertion RED |

The old implementation itself supplies the rejected wrong observation.
No timeout, setup failure or stalled receipt is credited as a law RED.
The rejected lane reaches actual aggregate replay rejection with the original
error identity and its `loadSubset:error` report before a quiet event-loop cut.

Runtime command, from the worktree (the installed Vitest module is the linked
4.1.12 donor module; use Node `/Users/kyle.mathews/.n/bin/node` directly):

```sh
node <installed-vitest>/vitest.mjs run collection-public-snapshot-persisted-oracle \
  --config review-evidence/collection-publication/vitest.persisted-public-snapshot.config.mts
```

The private config merges the ordinary package config, explicitly aliases DB,
DB-IVM and persistence to this worktree, replaces concatenated test include
arrays, and uses a private cache. Runtime typechecking is disabled there;
the ordinary package `tsc` runs separately.

Preserved raw output pairs under `review-evidence/collection-publication/`:

- `persisted-public-snapshot-runtime2.{stdout,stderr}.log`: exit 1; two registered
  campaigns fail their first shared example; 25 ms test duration, 1.84 s total.
  Fixed seed `30102026`, random seed `1845753113`; both path `0`.
- `persisted-public-snapshot-replay0.{stdout,stderr}.log`: exit 1, one history,
  one fixed registration skipped; seed `30102026`, path `0`; 18 ms tests.
- `persisted-public-snapshot-replay4.{stdout,stderr}.log`: exit 1, one rejected
  history; seed `30102026`, path `4`; 18 ms tests. This retains the failed cut.

Direct replay adds these environment variables to the same command:

```sh
TANSTACK_DB_ORACLE_PROPERTY=persistence.collection-public-snapshot \
TANSTACK_DB_ORACLE_SEED=30102026 TANSTACK_DB_ORACLE_PATH=0
```

Path `4` selects the shared rejected example. Both requested paths reproduced
the same public-read/subscriber discrepancy directly. The driver preserves
the first assertion as the AggregateError cause, retains other assertion or
progress/cleanup failures, and logs immutable numeric row observations before
cleanup. Normal campaigns configure the same 12 generated histories plus all
eight shared examples; their first-example RED stops them before random rows.
No full fixed/random campaign success is claimed.

## Reach

| Declared state | Fixed campaign | Random campaign | Replay 0 | Replay 4 |
| --- | ---: | ---: | ---: | ---: |
| Real wrapped receipt pending | 1 | 1 | 1 | 1 |
| Real mutex scan held | 1 | 1 | 1 | 1 |
| Held public comparison | 1 | 1 | 1 | 1 |
| Receipt and mutex progressed | 1 | 1 | 1 | 1 |
| Quiet failed public comparison | 0 | 0 | 0 | 1 |
| Successful publication comparison | 1 | 1 | 1 | 0 |

These are measured histories, not the configured budget. The normal red run
does not establish generated rejection reach. The explicit rejected replay
does establish its receiving path and observation cut.

## Checks and execution corrections

- Ordinary package typecheck:
  `node <installed-typescript>/bin/tsc --noEmit --project packages/db-sqlite-persistence-core/tsconfig.json`.
  `persisted-public-snapshot-typecheck2.{stdout,stderr}.log`: exit 0, both empty.
  Its first run found one driver-only `Promise<true | void>` observer type;
  normalizing the Promise result to void fixed it. No production change.
- Required oracle feedback:
  `node scripts/agent-lint-feedback.mjs --format=text --event=stop packages/db-sqlite-persistence-core/tests/collection-public-snapshot-persisted-oracle.test.ts`.
  `persisted-public-snapshot-oracle-lint2.{stdout,stderr}.log`: exit 0, both empty.
  The first lint rejected conditional test registration. The final file uses
  the accepted direct replay guards and an unchanged shared campaign callback.
  This final registration-only rewrite was linted but not rerun at ROOT's
  direction to stop additional runtime work. Typecheck and replay evidence
  precede this registration-only rewrite.
- Earlier `first-red` and `runtime1` logs are retained configuration attempts,
  interrupted with exit 130. The ordinary config's typecheck selection and
  concatenated include arrays selected broader work. They are not law RED.
  `runtime2` is the first bounded runtime assertion result.
- The merged ordinary Vite config prints unrelated missing Expo tsconfig-base
  warnings. They did not prevent this receiving fixture or its comparison.

## Evidence block and limits

- **Law:** shared Collection snapshot law and maintainer authority above.
- **Reach:** measured table above; real wrapper, receipt, scan and error path.
- **RED:** unchanged production assertion failure at held and failed cuts.
- **GREEN:** ordinary package typecheck and oracle lint only. No repaired
  production GREEN exists or is claimed.
- **Mutant:** no production mutant authored. The original wrong implementation
  is rejected by the same shared comparison. A future fix still owes a hostile
  mutant and all required campaigns before closure.
- **Limits:** one retained full-source demand and one candidate transaction;
  in-memory persistence host and default coordinator only. Native SQLite,
  peer coordination, cache claims/recovery, optimistic settlement, multiple
  independent scoped peers and cross-Collection publication remain outside
  this receiving witness. No new adapter API or receipt-law revision is chosen.

## Oracle rubric status

| Requirement | Evidence / limit |
| --- | --- |
| ORC-001 | Named maintainer authority and bounded path above. |
| ORC-002 | Shared independent initial/replacement model; driver imports no production truth for expectations. |
| ORC-003 | File prose states law, shared parts, production path and exact cuts before mechanics. |
| ORC-004 | Shared grammar/examples retained; receiving schedule bounded to one full-source demand. Broader grammar execution stops at RED. |
| ORC-005 | Actual persisted wrapper, public reads and subscriber fold; raw trace shows each named receiving cut. |
| ORC-006 | Original early-publication behavior rejected at the intended assertion; no mutant claim. |
| ORC-007 | Equal configured fixed/random budgets; direct seed/path replays verified. Both full campaigns remain RED. |
| ORC-008 | No shared state-model change; not applicable to this driver-only addition. |
| ORC-009 | Shared held/failed/complete phases retain their documented model-to-production mapping. |
| ORC-010 | Immediate capture, first cause and secondary diagnostics preserved; real holds and resources released. |
| ORC-011 | No newly named shared semantic fault requiring a second formulation. Direct/subscriber paths are observations of one law, not two independent models. |
| ORC-012 | This bounded record; no bug-class closure claim. |
| ORC-013 | Same write prefix with successful versus rejected provider outcomes; pending versus fulfilled receipt cuts remain distinct. |
| ORC-014 | Real persistence wrapper receives the controlled durable delay. Native SQLite/provider claims remain unresolved outside this witness. |
| ORC-015 | Six declared states with measured counts above; no inferred campaign reach. |
| ORC-016 | Both registrations run the shared grammar/driver/check; no private fixed expected rows. |
