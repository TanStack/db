# Direct persisted cursor receiving evidence

## Law and bounded receiving claim

The primary oracle is
`packages/db-sqlite-persistence-core/tests/persisted-demand-coverage-model-oracle.ts`.
The authority is the glossary's **persisted demand coverage**, the SQLite
persistence guide's on-demand offline contract, and Direct's documented cache
replacement policy. Applied settlement of one exact demand can establish durable
coverage. A changed cursor is a different demand. A confirmed source replacement
ends older coverage; rows that remain in SQLite do not recreate it.

The new Direct receiving target exercises actual
`CollectionSubscription.requestLimitedSnapshot({ minValues, orderBy, limit,
offset: 0 })`. The explicit zero retains a finite provider limit; `minValues`
produces an actual `cursor.whereFrom`. The primary model evaluates that request
data itself. The receiving driver imports no persistence classifier or coverage
key and supplies no expected rows.

The grammar varies rank translation, one- or two-row limits, matching versus
changed cursor boundaries, and offline-only, confirmed refresh or eviction
histories. Each provider table contains only its saved cursor page. This makes
the separate full group-A Collection row projection expressible by the primary
`FilterSpec`. It does **not** establish cursor selectivity, rows before the
boundary or beyond the limit, ties, or live-query cursor materialization.
Those receiving paths remain gaps under the primary persisted-demand owner.

Node uses the installed standalone SDK, controlled HTTP and disk-backed
`node:sqlite` on Node 26. Chromium uses the same driver, model, grammar and
comparison with the installed SDK and actual worker/OPFS SQLite. Every sync run
uses a fresh SDK and closes/reopens storage. No live service, multi-tab or cache
claim-expiry result is transferred from these hosts.

## Observations and instrumentation review

Source checkpoints author row facts. A first confirmed nonempty stream lease
can author the permitted cache snapshot. Actual adapter reset calls are recorded
separately: an unauthorized reset cannot make its own request obsolete in the
model and erase the saved-demand obligation. Durable rows use the main
receiver's public generation-claim/read projection and the primary model's
`persistedCoverageRows` judgment.

The original cursor callback promise describes one physical acquisition, not a
promise to follow every replay of its logical demand. Actual Chromium exposed
this distinction: the source recorded a current, non-aborted settled cursor and
the subscription was ready, while that original promise had rejected. The first
observer incorrectly waited for the original promise. Its five-second timeout
is an instrument failure and supplies no semantic RED evidence.

The corrected observer uses current subscription status and scoped public subset
errors. A current error overrides `ready`; an aborted physical outcome decides
nothing. Original physical outcomes and signals remain diagnostics. This driver
has exactly one logical cursor owner and no tie request. The newest physical
acquisition is therefore its current readiness obligation; every prior
acquisition remains in the source log and diagnostic record. The glossary's
demand/acquisition/abort definitions and the architecture's **Replay participants
and failure** section authorize this abstraction. The independent law reviewer
approved it before production changes.

The public cut captures status, errors, rows, source events and request data
synchronously before awaiting its durable read. Provider consumption and issued
receipts establish the source cut, followed by a declared 25 ms continuation
drain. No helper polls expected rows, readiness or failure. A missing current
applied load is a missing measured receiving premise, rather than a timeout
waiting for the desired answer.

## Frozen pre-edit gate

Production remains unchanged at:

- `src/index.ts`: `a30e71beb96fade6c5714a300ea76628386dd0b9b1ea04ad60ccf3ee9ae074fa`
- `src/subsets.ts`: `00fb4cb1976ec8b384d01e1fbb483768204bc40b69a3dcc19ed21b4356b3e380`

The final instrument manifest is
`.review-2377/direct-cursor-pre-edit-snapshot-v3.sha256`, SHA-256
`04e1bebec015ebaf4faea6385d7772ee582e8dd47d8f0b6a9673b72adc8b22e8`.
It binds seven new cursor files, the shared main receiving driver and the primary
model. The cursor driver is
`54135f879f2c8d2dd87aef5dcade603b7d0b617d9724d90ba8be60164fa70dae`;
the shared driver is
`10446a9e1d4b6179c49d1b18910de1875cc3b7e64166b2c5cf4ddbc90b980cd3`.

The v2 runs completed on both actual hosts with **84 failures, 31 passes in
115 selections**. The failures are 55 product selections at the independently
checked unconfirmed reset, plus 29 bound calibration baselines already failing
that same product law. These baseline failures are not mutant kills and supply
no calibration credit. All 29 controls must pass on repaired production.
V2 is historical evidence: v3 removes the final success-polling setup helper and
corrects the third session to a neutral receipt/task drain.

Final v3 commands, from their respective packages with Node 26 on `PATH`:

```sh
pnpm exec vitest run tests/cursor-persisted-demand-oracle.property.test.ts --coverage.enabled=false --typecheck.enabled=false
pnpm exec vitest run --config vitest.adapter-oracles.config.ts e2e/powersync-direct-cursor-persisted-demand-oracle.browser.test.ts
```

The corresponding logs are `.review-2377/direct-cursor-node-v3-original.log`
and `.review-2377/direct-cursor-browser-v3-original.log`. Final results and review
verdicts follow below. No closure claim is recorded here yet.

Both v3 original hosts completed **84 failures, 31 passes in 115 selections**:
55 semantic failures at `before confirmed checkpoint`, and 29 bound calibration
baselines already failing that product law. No setup failure or timeout occurred.
All five declared states were measured. The full-log aggregate execution counts
include shrinking, determinism and calibration runs; they are not counts of
distinct normal-campaign histories:

| State | Node | Chromium OPFS |
| --- | ---: | ---: |
| saved cursor applied | 250 | 244 |
| same cursor reopened offline | 101 | 99 |
| changed cursor reopened offline | 149 | 145 |
| confirmed cursor checkpoint after reopen | 124 | 122 |
| saved cursor rejected after eviction | 62 | 58 |

Both independent reviewers approved the exact v3 pre-edit gate and verified all
nine hashes plus the unchanged production fingerprints. The enforcement reviewer
independently executed the three actual Chromium fixed histories: three intended
semantic failures and three determinism passes, with no premise failure.
The law reviewer inspected both complete original records and approved the
logical/physical observation mapping, neutral cuts and bounded receiving claim.

Guarded direct replays execute exactly once and reject the same original law:

- Node: seed `-74185943`, path `0:0:0:0`, unit `random seed: generated`.
- Chromium: seed `1676583567`, path `0:0`, unit `random seed: generated`.

Logs are `.review-2377/direct-cursor-node-v3-guarded-original.log` and
`.review-2377/direct-cursor-browser-v3-guarded-original.log`. The initial Node
`tsx` CLI attempt failed to open its IPC pipe inside the sandbox; the successful
Node replay uses `node --import tsx` and supplies the actual one-execution
witness. The IPC setup failure supplies no behavioral evidence.

## First production attempt exposed a receiving barrier gap

After both pre-edit approvals, the parent authorized the Direct source repair.
The first source candidate has index SHA-256
`1ec1defd6f1584be75b647f243c820f31db0b1e03eaa7fabaf3185b27c4076c1`
and subsets SHA-256
`b153929c2cd2bec9a3ca9645fd363b41bbf10a9acf357ce6b277b6bb0c591505`.
The nine v3 instrument fingerprints remained unchanged.

Its cursor runs were **84 failures/31 passes on Node** and **11 failures/104
passes on actual OPFS**, recorded in `.review-2377/direct-cursor-node-v3-green.log`
and `.review-2377/direct-cursor-browser-v3-green.log`. These historical filenames
do not mean the runs were GREEN. They mainly lost the first saved-load premise:
the permitted confirmed snapshot aborted and replayed the cursor acquisition,
but the provider pump could finish its captured receipts before the replay's
successor HTTP request arrived. First-run cleanup then ended requests that had
not established durable coverage. The runs do not prove a production defect or
a successful repair of this class.

The next instrument amendment tracks forwarded real SDK lease waits and
releases, actual HTTP requests and issued receipt revisions. The fixture will
pump those concrete provider obligations without waiting for expected adapter
load success, rows or readiness. The shared source recorder will preserve
aborted physical failures as diagnostics rather than active readiness failures,
as required by the accepted abort law. Both reviewers require renewed exact
original-source RED on both hosts after this amendment, before the production
candidate is reapplied. That renewed gate remains pending.

## Declared reach and controls

Five independently varied constructed builders per state enforce these states
in both fixed-seed and fresh 24-history campaigns:

- `saved cursor applied`
- `same cursor reopened offline`
- `changed cursor reopened offline`
- `confirmed cursor checkpoint after reopen`
- `saved cursor rejected after eviction`

Generated builder outputs keep distinct object identities and bind their named
state to the shared production driver observations. Missing-state controls
remove each state from that same trace. Four further controls reject a changed
cursor borrowing coverage, missing durable row values, an obsolete physical
error substituted for current readiness, and `ready` hiding a current failure.
The fixed histories use the same model, driver and comparison as generation.

## Rubric outcomes at the pre-edit gate

| Requirement | Evidence or remaining obligation |
| --- | --- |
| ORC-001 | Primary law and authority above; page-shaped, single-owner and host limits explicit. |
| ORC-002 | Shared primary model judges request data and authored source facts; no second Direct model. |
| ORC-003 | Grammar, production driver and shared registrar explain the law and distinct public cuts beside code. |
| ORC-004 | Rank translation, width, boundary identity and replacement axes have distinct contributions; eviction requires a changed boundary; no pre-request checkpoint or seeded metadata is legal. |
| ORC-005 | Actual limited `whereFrom` request, current non-aborted saved settlement, real HTTP and reopened storage are checked; original promise is retained separately from logical readiness. |
| ORC-006 | Four wrong-observation controls and 25 missing-state controls retained; product-RED clean baselines remain uncredited until repair. |
| ORC-007 | Seed 2377 and fresh campaigns use the same 24-history budget; guarded seed/path replay remains required before closeout. |
| ORC-008 | Primary state model unchanged; newest-acquisition projection follows one serial logical owner. |
| ORC-009 | Logical subscription readiness, physical callback settlement and durable rows remain distinct observations. |
| ORC-010 | Completed results survive host cleanup with separate diagnostics; primary mismatches are compared before cleanup errors. |
| ORC-011 | No new shared-semantic-fault hypothesis requires a second formulation; page selectivity is an explicit receiving gap. |
| ORC-012 | This append-only record binds exact reviewed instrument and source fingerprints; no whole-adapter or repaired-class closure claim. |
| ORC-013 | Matching versus adjacent changed boundary, then confirmed replacement versus old-demand reuse, distinguish exact demand coverage and invalidation. |
| ORC-014 | Same oracle runs through actual Node SQLite and Chromium worker/OPFS with fresh installed SDKs. |
| ORC-015 | Five states, five distinct constructed builders each, generated-output obligations and bound missing-state controls; final per-host reach remains to append. |
| ORC-016 | Fixed histories and controls reuse the shared primary judgment; no standalone expected-value tests in the oracle files. |

## Renewed v4 instrument gate

The v4 snapshot supersedes the pending amendment above. It retains the primary
model and page-shaped receiving scope. The shared v10 provider barrier forwards
the exact SDK wait promise and observes it through a side handler; it acquires
no additional lease. Actual SDK waits, releases, abort signals, HTTP requests
and issued receipts establish four stable native task boundaries. Both success
and rejection checkpoints use this neutral barrier. Source rows are authored
once, outside transport reanswers. No expected readiness or row polling is used.

The cursor observer now takes every non-aborted acquisition from
`host.currentRequests()`. It does not infer current ownership from list position.
The serial one-owner grammar checks that each cut has exactly one such request.
All physical outcomes, including the saved run's acquisitions and callback
promises, remain separate diagnostics. This supersedes the historical
newest-acquisition projection described in the v3 record.

The hash-list manifest
`.review-2377/direct-cursor-pre-edit-snapshot-v4.sha256` has SHA-256
`f6b57dfa9fb895337f00a777d6db9904b050bd67bdc884db53304f8e3fed050c`.
The versioned JSON snapshot
`2026-11-17-powersync-direct-persisted-cursor-v4-snapshot.json` has SHA-256
`7b393cdd874f4581273d6116532c63bb3e1a417bf37c9c2d0d52f8b0b3f86691`.
It binds the cursor driver `a154ead5…`, suite `bd230758…`, shared main driver
`5a7c0b8d…`, unchanged primary model, and both real receiving hosts. Original
production `a30e71…` / `00fb4c…` was verified before the renewed commands.

The Node original-source run completed 84 failures and 31 passes in 115
selections: exactly 55 unauthorized-reset comparison failures and 29 bound
calibration baselines already failing that product law. No setup failure or
timeout occurred. Aggregate executions reached saved cursor 249 times, same
cursor reopen 103, changed cursor reopen 146, confirmed checkpoint 122 and
post-eviction rejection 59. These aggregate counts include shrinking, determinism
and calibration executions. They do not replace the five constructed builders
per state in each normal campaign. Scoped cursor ESLint and package TypeScript
checks passed. Actual OPFS original-source results and both final gate verdicts
remain to append before the source candidate can be reapplied.

The v4 actual Chromium OPFS original-source run also completed 84 failures and
31 passes in 115 selections: 55 identical unauthorized-reset comparison failures
and 29 already-RED clean calibration baselines. No setup, provider-barrier or
timeout failure occurred. Aggregate executions reached saved cursor 249 times,
same cursor reopen 96, changed cursor reopen 153, confirmed checkpoint 125 and
post-eviction rejection 62. Logs are
`.review-2377/direct-cursor-node-v4-original.log` and
`.review-2377/direct-cursor-browser-v4-original.log`.

Guarded v4 direct replays reproduced the same semantic reset failure exactly
once on each host, with unit `random seed: generated`: Node campaign seed
`837748761`, path `0:0:0`; Chromium campaign seed `1388977323`, path `0:0:0`.
The logs are `.review-2377/direct-cursor-node-v4-guarded-original.log` and
`.review-2377/direct-cursor-browser-v4-guarded-original.log`. Each replay emitted
one async execution witness with `numRuns: 1` and the intended comparison
failure. These replays do not receive calibration credit.

The independent law reviewer reapproved the exact v4 source gate after checking
all nine instrument hashes, both unchanged source hashes, both complete host
logs and all five measured states. The Node original log SHA-256 is
`b082bd350eb55fc5e0623dae392362b14faa8a23b5d9d9ac8b83c2c6c74ef41c`;
the Chromium original log SHA-256 is
`d473f90287053b98716c98fbaa8ca0d1f53dcbb91967b4be2a8c1ae799633945`.
The reviewer credits the 55 semantic reset failures per host and gives no
calibration credit to the 29 already-RED clean baselines. Repaired GREEN, all
29 calibration controls and distinguishing source mutants remain required.

The independent enforcement reviewer also approved exact v4. It independently
executed the matching, changed and post-eviction fixed histories on Node and
actual Chromium OPFS, observing three intended semantic reset failures per
host. The logs are
`.review-2377/enforcement-direct-v10-v4-original-node.log` and
`.review-2377/enforcement-direct-v10-v4-original-browser.log`. It reverified all
nine instrument and two original-source hashes and reported no cursor finding.
Both required cursor gate approvals therefore preceded the renewed candidate
run. A separate main-receiver empty-mapper gate question remains with that
receiver's author; this cursor grammar does not use an empty mapper.

The renewed Node candidate uses an isolated Vite source load hook,
`.review-2377/direct-saved-source.config.ts`, over the saved first-repair files
`direct-demand-first-repair-index.ts` (`1ec1defd…`) and
`direct-demand-first-repair-subsets.ts` (`b153929c…`). The hook prints the exact
source SHA-256 loaded. Canonical source remains unchanged for another
original-source witness. The oracle's nine frozen files are unchanged.

## Final shared-helper dependency amendment

The main receiver's v11 shared-driver SHA-256 is
`8317dbeb0a4d3ee91a93b74ac4da629c7cc184fe49b4973bc983af7a0e4b10bc`.
Comparison with the retained v10 file (`5a7c0b8d…`) shows only an empty-mapper
callback counter/accessor and the main receiver's empty-mapper observation
replacing an outcome poll with `receiveCommits()`. Cursor calls `source()` with
the default nonempty mapper. Its SDK barrier, acquisition recording, source
facts, model and comparison have identical semantics. Both independent reviewers
verified this narrow diff and approved carrying the exact v4 original-source
evidence across this dependency amendment.

The v5 dependency snapshot records this carry explicitly. Its hash-list
manifest SHA-256 is
`8866f227debcc0159b40a994fab76a01f76439758b3120fba2fd40cffce3fa85`;
its versioned JSON SHA-256 is
`04e734d498a3f4ced475e10fba4c8d83eb9a543aaf73f87ced39967035f618f6`.
The seven cursor files and primary model retain their exact v4 fingerprints.

The renewed saved-candidate Node run passed all 115 selections, including all
29 calibration controls. Its positive source-load witness is
`.review-2377/direct-cursor-node-v4-first-repair-witness.log` and the companion
`direct-cursor-node-v4-first-repair-loads.jsonl`, which records loaded source
SHA-256 values `1ec1defd…` and `b153929c…` at the actual production module IDs.
An earlier same-config candidate run also passed, but its console-based source
load witness was absent, so the explicit witness run supplies that evidence.

An initial never-replace mutant run also reported 115 passing selections but
never loaded the mutated source: Vitest's persistent transformed-module cache
reused the prior source across the environment-selected override. It receives
no mutant credit and is classified as an unactivated mutant. The scratch source
loader now disables `test.fsModuleCache` and requires a per-run append-only
source-load SHA-256 witness. The verified rerun records actual mutated index
`37350f6d0e5fb76bdca7d6ceb749b39391c6f377de337f5a913670bc0cc2c191`
and unchanged candidate subsets `b153929c…`. Its result remains to append.

The verified never-replace mutant was killed at the intended primary comparison:
after cursor checkpoint replacement, the model required `ready` with only
`fresh`; production exposed `ready` with `fresh` and `saved-0`. The full run
reported 47 failures and 68 passes in 115 selections, including 23 explicit
semantic failures at that checkpoint. Reach failures and already-RED bound
calibration baselines in the same mutant campaign receive no kill credit. No
setup, SDK-barrier or timeout failure occurred. The verified log is
`.review-2377/direct-cursor-node-v4-never-replace-verified-mutant.log`, with actual
source-load witnesses in
`.review-2377/direct-cursor-node-v4-never-replace-verified-loads.jsonl`. This
distinguishes the intended confirmed replacement from a plausible repair that
merely suppresses every on-demand replacement.

The independent law reviewer counted 24 primary semantic row failures in that
verified mutant run: 23 retain one saved row and one retains two saved rows.
This corrects the earlier count of 23 `Caused by`-prefixed comparisons, which
omitted one direct fixed-history failure. Seven missing eviction-rejection
reach failures and 16 invalid clean calibration baselines are separate from
those 24 semantic kills. Both reviewers accepted this adjacent-mutant evidence,
the actual source-load witness and the v11 dependency carry. Neither requests
another instrument change. Final bounded production approval awaits actual
Chromium OPFS GREEN on the canonical final source and the separate mapper-abort
repair gate.

## Cleanup exception amendment

A completed receiving result could be erased when a cleanup rejected with
`Object.create(null)`: `String(reason)` threw before later resources released.
The ordinary `cursor-persisted-demand-cleanup.test.ts` controls reproduced two
TypeErrors through the outer retainer and session cleanup; a third control
confirmed that pre-completion primary and secondary raw reasons remained intact.
Those results are in `.review-2377/direct-cursor-cleanup-poison-red.log`.

Both cursor cleanup paths now share `recordCursorDemandCleanup`, which uses the
shared total `describeOracleCleanupError`. Formatting failure becomes a separate
diagnostic; every cleanup still runs, existing diagnostics remain, and a
completed result keeps its identity. Before completion, the raw body reason
remains the AggregateError cause and its raw cleanup reasons remain separate
items. All three ordinary controls pass in
`.review-2377/direct-cursor-cleanup-poison-green.log`; package TypeScript, scoped
ESLint, Prettier and diff checks pass. No primary law, history, source fact,
request, readiness or normal checkpoint changed.

The v6 snapshot binds the exception amendment and shared helper dependencies.
Its eleven-line hash-list manifest SHA-256 is
`e51e6ce9fb811314f7a0c518ac51313bd1aeeeabaf8d01599bab936113312dbc`;
its versioned JSON SHA-256 is
`38c4f355588b3c5ebf25722e9a3bb6bb150202ca3179a97740186e187d2e6e23`.
Cursor driver SHA-256 is `6e6efd4a…`, ordinary cleanup controls `8fb21064…`,
main driver `befe280d…`, and shared total formatter `15317e38…`. The primary
model and all cursor grammar/comparison/host files retain their v4 fingerprints.
Focused independent amendment approval and carry of prior normal-path evidence
remain to append.

The independent law reviewer approved the exact v6 exception-only amendment for
carry of prior normal-path evidence. It verified all eleven snapshot hashes and
inspected both cleanup call paths and the actual RED/GREEN logs. It found no
history, model, cut or source behavior change. Correctness of the shared total
formatter remains with its shared oracle-cleanup owner and focused review.
`pnpm lint:changed` is running after this amendment; its result remains to append.

The independent enforcement reviewer also approved the cleanup amendment. Its
independent three-control run passed in
`.review-2377/enforcement-direct-cursor-cleanup-final-green.log`. It inspected
both cleanup paths and accepted carry of the v4/v5 normal original-source,
candidate and mutant evidence across this exception-only repair. The shared main
receiving helper was still undergoing its own cleanup regression repair when
v6 froze; a final dependency-only fingerprint amendment remains required.

The post-amendment `pnpm lint:changed` process subsequently completed with exit
status 0; its log is `.review-2377/direct-cursor-cleanup-lint-changed.log`.

The shared main driver then froze at final SHA-256
`d1760a27e82aba02552ac25da9d7cfbc6927c5f76475ce746392916934308478`.
The enforcement reviewer approved that exception-only repair and independently
ran the combined main/cursor ordinary cleanup controls: seven passed in
`.review-2377/enforcement-direct-main-cleanup-final-green.log`. The shared
formatter `15317e38…` separately received independent approval and eleven
focused shared controls passed.

The v7 dependency snapshot supersedes v6's temporary main helper fingerprint.
Its hash-list manifest SHA-256 is
`775188b6edede02e81520d7f9831f9e79ed4b7789c4473363aedb94d4ff784b9`;
its versioned JSON SHA-256 is
`1dba167f09cfddb3045fa4c4040ccbc704126e6c9621105fb254d2797dbf22e8`.
Cursor driver, controls, model, grammar and comparison remain unchanged from
v6. Both cursor reviewers' normal-evidence carry approvals therefore retain
their stated scope. Final source and actual OPFS GREEN remain pending.

## Final canonical source evidence

After the independently gated mapper-cancellation repair, canonical source froze
at index SHA-256
`1ec1defd6f1584be75b647f243c820f31db0b1e03eaa7fabaf3185b27c4076c1`
and subsets SHA-256
`20f8ed310b98099604fd05ae32a269b6554b87b937e31300f8dca3ac3a019da3`.
The complete v7 cursor instrument ran on that source with Vitest's transformed
module cache disabled. Node passed 118 selections: all 115 oracle selections
plus three cleanup controls. Actual Chromium OPFS passed all 115 oracle
selections. Both hosts passed all 29 bound calibration controls; none relies on
an already-RED baseline. No setup, barrier or timeout failure occurred.

Logs are `.review-2377/direct-cursor-node-v7-final-green.log` (SHA-256
`84cdb04374b30a491f8a591a84a5f26af7f0959624621625b5fe742e3bfd55e7`)
and `.review-2377/direct-cursor-browser-v7-final-green.log` (SHA-256
`59ea14d3721e6197f2d2bbd66d7c2c2c7be1ac3c2f6d23264c79b797e6f96108`).
The versioned `2026-11-17-powersync-direct-persisted-cursor-final-reach.json`
records reach from normal campaign units only, excluding fixed histories,
shrinking, determinism and calibration executions:

| Declared state | Node fixed | Node fresh | OPFS fixed | OPFS fresh |
| --- | ---: | ---: | ---: | ---: |
| saved cursor applied | 49 | 49 | 49 | 49 |
| same cursor reopened offline | 13 | 14 | 13 | 12 |
| changed cursor reopened offline | 36 | 35 | 36 | 37 |
| confirmed cursor checkpoint after reopen | 28 | 30 | 28 | 31 |
| saved cursor rejected after eviction | 17 | 17 | 17 | 16 |

Each campaign has 25 distinct constructed histories and 24 unrestricted
generated histories, using the same driver, primary judgment and run budget.
Five independently varied builders enforce each state's minimum in each host.

A final-source mutant again replaces only
`active && replacePending && streams?.length` with `false`. It loads mutated
index `37350f6d…` and final subsets `20f8ed31…` at their actual module IDs. All
five selected fixed-seed confirmed-checkpoint constructions fail the primary
row comparison at `after cursor checkpoint replacement`: expected `fresh`,
observed `fresh` and `saved-0`. The exact source-load witness is
`.review-2377/direct-cursor-final-never-replace-loads.jsonl`; comparison evidence
is `.review-2377/direct-cursor-final-never-replace-mutant.log`. These five
semantic kills contain no setup, reach, calibration-baseline or timeout failure.

The final source/instrument snapshot before the last diagnostic adoption is
`2026-11-17-powersync-direct-persisted-cursor-final-snapshot.json`, JSON SHA-256
`aa4c0a80bf10386df15ad76e19c44d888daee5a2b3292fbb286a11b5ab72c56d`.

Final review identified two further diagnostic-only string conversions in the
cursor recorder: the public load-error value and the original physical
callback's rejection reason. Both now call the already reviewed total formatter.
The values remain separate diagnostics; error presence, abort ownership, status
normalization, source facts, model, grammar, comparison and observation cuts are
unchanged. The v8 snapshot records this amendment with cursor driver `723df8be…`.
Its hash-list manifest SHA-256 is
`c7e52528827bc8af4d06780802eda29d2129c40563e8b359ab96cffc30c74884`;
its JSON SHA-256 is
`674c3d7fc98cf397283d06300070f2bedc7b3bd37776c16e88193252b1befd8d`.
Focused independent carry approval remains to append.

### Bounded evidence block

- **Law:** exact applied demand coverage survives storage reopen; changed cursor
  demand cannot borrow it; the first confirmed nonempty SDK checkpoint can
  replace the cache and end prior coverage. Authority is the primary coverage
  oracle, glossary, SQLite guide and Direct cache policy cited above.
- **Reach:** both actual hosts reach all five states in both normal campaigns,
  with five constructed builders per state and counts in the table above.
- **RED:** unchanged `a30e71…` / `00fb4c…` source fails 55 intended unconfirmed-reset
  comparisons per host through exact v4. Already-RED calibration baselines are
  separately classified. Both guarded replays execute exactly once.
- **GREEN:** canonical `1ec1def…` / `20f8ed31…` source passes every oracle selection
  and all 29 controls on Node SQLite and actual Chromium worker/OPFS.
- **Mutant:** original reset and never-perform-confirmed-replacement designs fail
  intended primary comparisons, including five final-source semantic row kills.
- **Limits:** finite page-shaped cursor requests with one serial owner, unique
  ranks and closed/reopened single-process storage. No cursor selectivity, rows
  before the boundary or beyond the limit, ties, live-query cursor
  materialization, multi-tab, claim expiry or deployed-service claim. Those
  receiving gaps remain with the primary persisted-demand oracle owner; this
  record makes no whole-adapter completeness claim.

The independent enforcement reviewer approved the final bounded cursor source
evidence at canonical `1ec1defd…` / `20f8ed31…`. It verified current v8's eleven
instrument and two source hashes, inspected both complete GREEN host records,
all 29 controls per host, normal campaign reach and five final-source semantic
mutant kills. It reviewed the source guard and first-replacement logic, and
accepted carry across cursor `723df8be…`'s two diagnostic-only formatter calls.
It retains its independently executed original Node/OPFS fixed-history RED and
ordinary cleanup GREEN evidence. Approval applies only to this record's bounded
cursor law/domain. Any later shared normal-barrier change requires a new
dependency assessment; neighboring main receiver and mapper fixture questions
remain with their owners.

After the last diagnostic adoption, the cursor's three ordinary cleanup controls
still pass; package TypeScript, scoped ESLint and diff checks pass. Logs include
`.review-2377/direct-cursor-v8-controls-green.log` and
`.review-2377/direct-cursor-v8-typecheck.log`. Final `pnpm lint:changed` is running
in `.review-2377/direct-cursor-v8-lint-changed.log`.

That final `pnpm lint:changed` process subsequently completed with exit status 0.

The independent law reviewer also issued final bounded approval for the same
canonical source and v8 instrument. It independently reverified all eleven
instrument and two source fingerprints, complete GREEN log digests, all 29
controls, normal campaign reach and exact final-source mutant activation. It
confirmed that all five selected mutant failures are semantic ready-row
mismatches after the checkpoint. Both independent reviewers therefore approve
closure of the declared persisted-cursor cache-replacement boundary with the
frozen `d1760a27…` shared helper and this record's stated limits.

A separate main-receiver OPFS investigation subsequently proposed measuring a
shared storage-operation ledger before considering a normal checkpoint-barrier
change. This completed cursor evidence does not transfer automatically across
such a change. The current approvals remain bound to v8 and `d1760a27…`. Any
material shared SDK/receipt/storage/HTTP barrier amendment requires an explicit
semantic assessment and renewed material original-source and repaired receiving
gates before an amended closure claim. Canonical source remains `1ec1defd…` /
`20f8ed31…`; the neighboring investigation does not itself change this cursor
source verdict.

## Renewed neutral input cut: v9

The shared checkpoint helper changed materially from `d1760a27…` to main driver
`bc39df92df0926e71730029527340cf5048b797c87923a8e5ec5d91f2f5b72de`,
which uses `direct-input-receiving.ts`
`32c503f4380e957b85911316cb4067aed3bbbe04b615195ac870c52a8bf6c890`.
The applied input cut now observes actual SDK wait/release/abort state, issued
source receipts and actual storage promises, including recursively resolved
Collection/mode adapters. The HTTP pump answers actual successor requests and
uses the delivered checkpoint's captured target revision. The normal path
forwards actual values, arguments, method receivers and promises without delay.
No expected rows, load outcome or readiness is polled. Four stable native task
boundaries allow finite continuations. The shared helper's seven controls and
exact integration received independent review.

This materially affects every cursor history's first save and each refresh or
eviction-rejection checkpoint. `receiveCommits()` itself retains its prior
receipt/task behavior; wrapping source persistence records its real work. All
29 bound cursor controls replay affected histories. Renewing the complete
bounded cursor property on both actual hosts is therefore justified; no
unrelated package or neighboring-family campaign is included. The primary model,
cursor grammar, recorder, comparison and promised public capture before durable
reads are unchanged. Prior d176 evidence is historical, rather than transferred
automatically to this cut.

The v9 snapshot binds thirteen instrument dependencies, the exact original and
canonical source fingerprints, and the original-source override runner hashes.
Its hash-list manifest SHA-256 is
`cb4dabdb4a9ecbd1da6e1a58b72c8dc4472448b3e3e09e068ea4b35ea12f4bcb`;
its versioned JSON SHA-256 is
`4f6bf217d711fa5bddb05097393c439de20acd48ae040fad8ddaaf1a3926f862`.
The law reviewer verified all thirteen hashes and approved this renewed gate
scope pending execution.

Original Node and actual Chromium OPFS runs use the exact saved `a30e71…` /
`00fb4c…` source at the actual production module IDs. Both source-load JSONL
ledgers confirm activation and transformed-module caching is disabled. The
canonical `1ec1defd…` / `20f8ed31…` source remains unchanged. Renewed Node
completed 84 failures and 31 passes: 55 intended unconfirmed-reset comparison
failures and 29 already-product-RED bound calibration baselines. The latter
receive no calibration credit. No setup, input-barrier or timeout failure
occurred. Original OPFS, canonical GREEN and renewed distinguishing mutant
results remain to append.

### Renewed v9 results and additive v10 dependency carry

Both exact-original receiving runs completed 84 failures and 31 passes in 115
selections: 55 semantic unconfirmed-reset failures and 29 already-product-RED
calibration baselines per host. No setup, input-barrier, worker or timeout
failure occurred. The saved-source load ledgers prove actual `a30e71…` /
`00fb4c…` activation on both hosts. Canonical `1ec1defd…` / `20f8ed31…` then
passed all 115 cursor selections on Node SQLite and all 115 on actual Chromium
OPFS. All 29 bound controls passed on each repaired host.

| Execution | Result | Log SHA-256 |
| --- | --- | --- |
| original Node | 55 semantic RED; 29 invalid calibration baselines; 31 pass | `7cb60fe23d0ea2b8fc0fdcfab5fc7b12e675eebdb10ca8b0be3f6ed255ecd0ab` |
| original OPFS | 55 semantic RED; 29 invalid calibration baselines; 31 pass | `89650271961f44128c5f39acc24eb9d43b390d86b8fa3935065d3ed14f586f7e` |
| canonical Node | 115 pass | `903e0bc716b716e1ac0774290c533479b70b781bbfee53bff34325555938aeb5` |
| canonical OPFS | 115 pass | `09df99ca2fce0139dbc95d7775889b9bdb7a1fab5b018dd8587c062a8d4e9e0d` |

The logs are `.review-2377/direct-cursor-{node,browser}-v9-original.log` and
`.review-2377/direct-cursor-{node,browser}-v9-final-green.log`. Original source
load witnesses use the corresponding `-v9-original-loads.jsonl` names.

The versioned `2026-11-17-powersync-direct-persisted-cursor-v9-reach.json`
contains only normal campaign counts, excluding fixed histories and auxiliary
executions:

| Declared state | Node fixed | Node fresh | OPFS fixed | OPFS fresh |
| --- | ---: | ---: | ---: | ---: |
| saved cursor applied | 49 | 49 | 49 | 49 |
| same cursor reopened offline | 13 | 13 | 13 | 17 |
| changed cursor reopened offline | 36 | 36 | 36 | 32 |
| confirmed cursor checkpoint after reopen | 28 | 29 | 28 | 24 |
| saved cursor rejected after eviction | 17 | 16 | 17 | 15 |

The final-source never-replace mutant again loaded actual index `37350f6d…`
with final subsets `20f8ed31…`. All five selected confirmed-checkpoint
constructions failed the intended ready-row comparison, with no setup, reach or
timeout failure. The log is
`.review-2377/direct-cursor-node-v9-never-replace-mutant.log`, SHA-256
`4ceb72e8c094c319659af40f1b86db3cc6caf5d8b45cb03512a075f56d3acfc1`;
actual module activation is recorded in
`.review-2377/direct-cursor-node-v9-never-replace-loads.jsonl`.

Renewed guarded original-source replays each execute exactly one history and
reject the same semantic reset: Node campaign seed `-1357740131`, path
`0:0:0:0`; Chromium campaign seed `420840054`, path `0:0:0`; both use unit
`random seed: generated`. Logs are
`.review-2377/direct-cursor-node-v9-guarded-original.log` (SHA-256
`cf11df1432fed6e3d3b213107e83528d25f0a7593aa3ed786f96e64454a6095b`)
and `.review-2377/direct-cursor-browser-v9-guarded-original.log` (SHA-256
`9ccf73e5c69defc5259b4bb66a60ef8561943e5b2c5f5e64ff17158f8fa92e34`).
Each has a separate actual source-load witness.

An additive helper amendment introduces only a returned `continue()` API that
forwards the existing private drain. It changes no existing `lease`, `receipt`,
`persistence`, `receive` or `drain` path. Main and cursor never call the new API.
The law reviewer verified the exact diff from saved helper
`.review-2377/direct-input-receiving-v13.ts` (`32c503f4…`) and independently ran
eight helper controls. It approved carrying these new-cut executions to helper
`7c66fc31d840f38248b4605277d2b694586657776fe23f8e83ac5dc1292701f7`.
Executions remain attributed to `32c503f4…`, with explicit unused-API carry;
none inherits the older `d1760a27…` normal-cut approval.

The v10 snapshot records this narrow carry. Its thirteen-file hash-list manifest
SHA-256 is
`34176fb581b0cfb3025752ea00fe507a11a5823fcf565b68733707f57e6b57e5`;
its versioned JSON SHA-256 is
`2f27209cef800847e704dd6563a75cf29b43c8c71251a0273b57490341e2bc82`.
All thirteen current fingerprints match. Renewed final reviewer verdicts and
final lint status remain to append. The prior law, model, grammar, controls,
public capture and bounded receiving limits remain unchanged.

The final `pnpm lint:changed` run completed with exit status 0 in
`.review-2377/direct-cursor-v10-lint-changed.log`.

The independent source reviewer approved renewed v10 within the documented
cursor boundary. It verified all thirteen instrument, two canonical source and
three override-loader hashes; both complete 115-GREEN log digests and all 29
controls per host; normal five-state reach with every count at least 13; both
original-host semantic RED classifications and actual source-load witnesses;
and the final-source five semantic never-replace kills. It independently
compared `32c503f4…` with `7c66fc31…` and accepted only the unused additive API
carry. It gives no whole-adapter, deployed-provider or runtime-compatibility
approval.

### Final renewed review and frozen diagnostic-loader carry: v12

The independent law/adversarial and enforcement reviewers approved the renewed
bounded cursor evidence. They verified both original-host classifications,
115 GREEN selections and 29 controls per repaired host, normal five-state reach,
the guarded single-history replays and the five source-activated semantic
never-replace kills. Both independently accepted the unused additive helper API
carry from `32c503f4…` to `7c66fc31…`. These approvals cover the recorded finite
cursor/row/value-demand domain and first confirmed replacement with one serial
owner, unique ranks, single-process Node SQLite and actual Chromium OPFS. They
give no whole-adapter, deployed-provider or runtime-compatibility approval.

The final scratch loader freeze is recorded in
`2026-11-17-powersync-direct-persisted-cursor-v12-snapshot.json`, whose JSON
SHA-256 is
`4d5ce61683985b38d36900bd2ae1b231d7cf6b99b8163629e030bb0e96e96c22`.
Its thirteen-file hash-list manifest digest remains
`34176fb581b0cfb3025752ea00fe507a11a5823fcf565b68733707f57e6b57e5`.
All thirteen normal instrument hashes and both canonical source hashes match
v10 and v11. Historical snapshots are preserved.

The final browser saved-source plugin is
`.review-2377/direct-mapper-browser-source-plugin.ts`, SHA-256
`7731c5e184c23b2ddb75b10493f2184c5af2f2942b6908e5088b5082d00a2a14`;
its imported `.review-2377/direct-mapper-trace-plugin.ts` is
`0e28e880c95203502cca39b939925c5a0e88cd333131acdb29d2c5193648f681`.
Only the optional `DIRECT_MAPPER_TRACE=1` diagnostic branch changed. The
imported module has no top-level side effects, and its transform targets only
the Direct and shared `on-demand-streams-driver.ts` files, absent from cursor
receiving paths. The transform returns before calling the trace helper when
the flag is disabled; cursor commands did not set it. The source-serving path
is unchanged. The mapper owner confirmed these two shared files frozen and
moved further diagnostics to separate mapper-only files.

The independent adversarial reviewer verified the final v12 JSON digest and
every instrument, source and loader hash with zero mismatches. It approved
this final source-only diagnostic carry. Renewed actual-host executions remain
attributed to helper `32c503f4…` and canonical `1ec1defd…` / `20f8ed31…`, with
the separately approved unused `7c66fc31…` API carry. This amendment makes no
fresh execution claim and requires no repeated full campaign. The separate
saved-demand and mapper investigations do not inherit cursor approval.

The independent enforcement reviewer likewise verified the v12 JSON digest,
all thirteen instrument hashes, two canonical source hashes and four loader
hashes against current files. It approved only this source-only diagnostic
carry and retained its prior bounded renewed-gate verdict without a new full
run or new native-host evidence claim. Final `git diff --check` passed.
