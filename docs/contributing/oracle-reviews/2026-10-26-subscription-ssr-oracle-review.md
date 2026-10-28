# Subscription and SSR oracle review

Reviewed production: `44d55dbc437178698b23f2b211ecde8344143d97`.
Compared main: `5649a07d468117891193c2e4cde9c7706308b1cd`.

Five independent reviewers challenged the subscription, SSR, React/Router,
Svelte, and consumer-bundle owners. They first collected counterexamples without
changing production. The combined repair plan grouped their missing history
dimensions before the primary owners changed. Each production repair followed
the relevant unchanged-production comparison, including real receiving paths.
Later counterexamples received additional comparison gates before their repairs.

## Which laws changed?

| Law | Authority and relation to main |
| --- | --- |
| Ordinary subscription admission and deferred acquisition resumption throw during cleanup. | The maintainer chose rejection, including automatic GC. Main admits an ordinary subscription during held GC cleanup. Sync-run invalidation alone does not require this policy. Nonacquiring deferred subscriptions remain legal. |
| Ordinary SSR rejects incidental rows or readiness without reproducible preparation. | The maintainer chose a programming-error rejection. Main's server getter returns its ordinary snapshot without this check. Runtime provider errors retain their normal surface. |
| Prepared server queries may render ready, including empty results. | Prepared SSR and matching initial browser markup already require this composition. Normalized source rows alone do not prove query readiness. Render-time query captures supply that missing fact. |
| Each reader retains its own server view during hydration. | The earlier SSR guide already promises matching initial markup. The PR makes mixed ordinary/Suspense readers and later boundaries explicit. These failures are enforcement gaps in that promise. |
| Svelte distinguishes hydration from a fresh mount. | The maintainer retained the later-hydration guarantee and chose explicit hydration information. `DbProvider hydrating` supplies it; omitted nested values inherit it, and providers clear it after mount. |
| A hydration read waits for the first required DB record. | The maintainer explicitly chose waiting. A real Router serializer/transform/Chromium witness also reproduced delayed first delivery without reordering bytes. This is not merely an arbitrary stream permutation. |
| Infinite-query matching includes its initial window. | The DbClient query hash includes limit and offset with a nonempty `queryKey`. This specifies previously ambiguous matching. Framework query identity remains the glossary's recompilation concept. |
| Apps without DbClient exclude its SSR implementation. | The maintainer chose the current DbClient import boundary and preserved its API. Descriptor-only browser apps importing DbClient still retain that implementation. The bundle owner checks emitted bytes, not visited inputs. |

Retained server snapshots and consumed active query ownership have different
purposes. A later hydration read can use retained rows while a new ordinary
browser mount uses live rows. Neither obligation requires preserving active
source Collection ID claims after their owner ends.

## Falsified laws and enforcement

| Items | Promised observation and missed history | Original result and repair |
| --- | --- | --- |
| Lifecycle-L1 | A failed subscription transfers no unreturned ownership. Pooled bootstrap callbacks could throw after ownership acquisition. | HEAD and main retain one source subscription after disposal and GC. The pooled owner now crosses ordinary/pooled input, callback return/throw, peer ownership and release. One release closure handles both normal release and failed bootstrap. |
| Lifecycle-L2 | Every admitted observer receives terminal cleanup status despite a sibling callback failure. | A healthy pooled observer stayed ready. Existing histories put healthy listeners before the throw and checked channel counts. The owner now varies failure position and checks each peer at held cleanup start and settlement. Shared callback dispatch attempts all peers before reporting the original failure. |
| React-R01/R03 | First hydration rows and status match server output; committed browser errors then become visible. | Server error became loading, or browser error replaced a ready server view. Shared histories cross server/browser outcomes and pre-hydration startup. React ordinary/infinite and native Svelte drivers compare both cuts. Error captures carry status without claiming arbitrary error-detail serialization. |
| Core-SC06 | An ordinary loading reader and a Suspense sibling retain their separate rendered views. | A Suspense-first pending record was queued before the ordinary view was captured. The actual Router payload omitted that view. Held readiness, reader order, empty/nonempty rows and split/together hydration now reach the omission. New initial facts advance the existing record's timestamp and stream through update events without replacing its promise or source claims. |
| Core-SC07 | A later stream failure cannot replace an ordinary reader's earlier loading markup. | The query error branch discarded an available initial snapshot. The mixed owner now generates held-source failure. Ordinary hydration retains its initial view; Suspense still receives the failure. |
| Runtime-Immediate | After subscription, a provider error publishes synchronously. | An initial repair deferred this publication. The existing unit rejected it; the primary observer owner now crosses pre-attachment/post-subscription errors, both modes and portable statuses. Shared handoff preserves the synchronous post-subscription cut. |
| Svelte-S01/Nested | Late native hydration uses retained server rows; fresh mounts and later children use live rows. | A second root read browser rows. Always selecting the server getter instead fails fresh mounts. Shared receiving histories now include initialization kind, prior readers, nested providers and children mounted later. Explicit scoped hydration information resolves the missing input. |
| React-R02 | Missing first records suspend without publishing browser rows. | The actual host rendered browser rows before the first record arrived. The shared receiving comparison uses real Router serialization, transformed HTML, manifest scripts and Chromium, with a semantic network release after a hook attempt. Missing-record and known-promise lifetimes remain separate. Explicit Suspense preloads retain their existing demand semantics. |
| React-R04 | A local preload before delivery cannot prevent receipt of the first server view. | A newer local timestamp rejected the older server timestamp even though no server record had arrived. The real-host delivery grammar now includes local preload before delivery. Version admission distinguishes active transported records from local records without changing the consumed/manual-input question. |

The runtime-error grammar uses empty eager sources. It does not establish a
partial-row retention policy after failure. The mixed failure grammar likewise
uses empty results. Success histories cover zero through three rows. These
bounds do not authorize dropping initial status or known server rows.

## Source-item accounting

Source IDs remain separate even when they share a repair. The scratch ledger
also preserves preliminary IDs: preliminary B03 maps to Bundle-B06; preliminary
L02 maps to Lifecycle-GC; preliminary C01 maps to Core-SC06.

| ID | Original claim or hypothesis | Judgment and destination |
| --- | --- | --- |
| Bundle-B01 | The oracle claims minified package input, but CI uses ordinary package builds. | Correct wording: built ESM enters a minified consumer build. Final minification was always exercised. |
| Bundle-B02 | Standalone execution can accept stale React/IVM artifacts. | Confirmed. Freshness now covers every aliased package, including TSX and configuration. CI already rebuilt them. |
| Bundle-B03 | The checker only detects input presence. | Refuted: it sums emitted output bytes. Preserve this stronger observation. |
| Bundle-B04 | Calibration fails during setup. | Refuted: it reaches the intended unwanted-inclusion assertion. |
| Bundle-B05 | Descriptor-only DbClient browser use violates isolation. | Accepted design under the chosen API boundary. Stronger isolation requires another API decision. |
| Bundle-B06 | Historical generated RED followed production edits. | Confirmed historical deviation, already disclosed. Later evidence cannot reverse its chronology. |
| Lifecycle-L1 | Failed pooled bootstrap retains ownership. | Repaired through the shared callback-history owner and pooled receiving path. Also occurs on main. |
| Lifecycle-L2 | A throwing pooled listener prevents healthy terminal delivery. | Repaired through failure-position histories and per-observer observations. Also occurs on main. |
| Lifecycle-GC | GC rejects subscriptions while public status stays ready. | Accepted consequence of the explicit cleanup-rejection policy. No automatic-wait contract was found. |
| Lifecycle-H04 | A recoverable source failure permanently terminates the partition. | No legal executable counterexample established in this round. Preserve the earlier evidence gap; do not label a different passing path a refutation. |
| Lifecycle-H08 | A notification throw permanently strands detached demand. | Not reproduced; replacement readiness reacquires. The broader earlier claim remains an evidence gap. |
| Lifecycle-Process | Historical production-first chronology. | Duplicate observation of Bundle-B06. |
| Lifecycle-Deferred | Deferring subscriptions remain legal during cleanup. | Accepted distinction between nonacquiring ownership and acquisition resumption. |
| Lifecycle-Dependent | Effects and pooled views represent cleanup differently. | Accepted API-specific surfaces: disposed Effects and terminal pooled views. |
| Lifecycle-Handoff | Recorded provider error differs from a thrown start handoff. | Accepted runtime-error distinction. The SSR programming-error decision does not erase it. |
| Core-SC01 | Retained snapshots necessarily conflict with consumed ownership. | Refuted as a necessary conflict by the distinct retained/active responsibilities. No runtime disproof is claimed. Preserve paired late-hydration/live-mount controls. |
| Core-SC02 | Infinite query identity conflates recompilation and result matching. | Correct prose to name the DbClient query hash. |
| Core-SC03 | The source-preparation driver materializes rather than awaits preload. | Confirmed fixture distinction. Explicit normalized source registration makes warmed rows portable; the guide's awaited-preload advice is sufficient, not an assertion that every fixture uses it. Clarify driver prose. |
| Core-SC04 | Older manual input after active consumption can replace newer retained rows. | Unexecuted hypothesis with unresolved multi-epoch semantics. No production change or broader version-order promise follows from it. |
| Core-SC05 | Browser runtime errors may replace a server seed. | Duplicate of React-R03's later executable evidence. |
| Core-SC06 | Pending Suspense registration loses a later ordinary loading capture. | Repaired; original primary comparison and event-only wrong repair reject it. Main replay did not reach collection, so no main RED is claimed. |
| React-R01 | A server error view hydrates as loading. | Repaired with runtime-outcome grammar and real React/Svelte receivers. |
| React-R02 | A first query record arriving after hydration allows local substitution. | Confirmed in the actual Router/Chromium host after earlier later-discovery controls passed. Maintainer also chose waiting. |
| React-R03 | A pre-hydration browser error overrides a ready seed. | Repaired while retaining normal committed error behavior. |
| Svelte-S01 | Later hydration reads live rows after another root commits. | Repaired with explicit host information and paired native hydrate/mount histories. |

Additional findings discovered during repair remain separate: Core-SC07,
Runtime-Immediate, Svelte-Nested and React-R04 above. The explicit-preload control initially
required exact provider error identity. That assertion exceeded the contract;
the retained control requires rejection, including an undefined cause, without
inventing portable error identity. Query-prepared probes that threw before the
hydration comparison receive no assertion-RED credit.

An initial receiving assertion also prohibited every early source start in a
Suspense tree. That restriction exceeded the first-view law: a Suspense read
is explicit preload demand. The host comparison instead forbids a successful
browser view before the required server record. Terminal checks prohibit new
work after the terminal cause. Ordinary render deferral retains its own owner.

The final cleanup audit found another sibling, React-R05. `DbClient.cleanup()`
permits later rematerialization, but missing-record failures survived into a new
stream for the same hash. The lifetime grammar now crosses cleanup and a new
stream. Both campaigns rejected the old terminal cause before production changed
(fixed seed `2229`, path `3:0:1`). An initial unconditional reset then failed the
same-open-stream control (path `2:0:0`). The repair clears old waits only when a
new stream starts. Existing promises keep their settled result, and enabling an
already open stream preserves its pending wait. This enforces the existing
rematerialization contract rather than making a failed stream recover in place.

## Verification record

The comparisons below ran on starting head `44d55dbc` plus the repairs recorded
here. The production blob table binds the evidence to exact source. Temporary
setup failures and overstrong assertions receive no product-RED credit.

### Reproducible comparisons

All Vitest runtime commands use `--coverage.enabled=false
--typecheck.enabled=false`. Run them from the named package with its installed
`node_modules/.bin/vitest`. Set `pnpm_config_verify_deps_before_run=false` when
using pnpm with the existing installation. Type validation runs separately.

| Law / primary owner | Original comparison and direct replay | Repaired comparison and distinguishing wrong implementation |
| --- | --- | --- |
| Pooled bootstrap ownership / `db/tests/query/pooled-live-query-gc-oracle.test.ts` | Final owner: 4 failures, 43 controls pass. Bootstrap fixed `2229/2:1:1:1`; cleanup peer fixed `2229/2:1:2`. Both reproduce the public ownership or held-status mismatch. Main also fails both. | 47/47. Bootstrap-only repair fails two peer-status campaigns. All-peer-only repair fails two bootstrap-ownership campaigns. Original random replays `-207208952/2:1:1` and `-469560171/0:2:2` fail, then pass repaired production through the guarded replay runner. |
| Mixed reader views / `react-db/tests/descriptor-query-binding-oracle.test.tsx`, selector `stream render snapshot cut` | SC06: 6 failures/10 controls, fixed `2229/3:0:0:1:1`. SC07 expanded owner: 4 failures/16 controls, fixed `2229/29:0:0`. Failure is the first ordinary hydration status, including empty results. | Final 20/20, including fixed/random 40 histories. Event emission without a new accepted revision fails the empty/loading comparison. Restoring error-first stream selection fails two together-hydration cells while split controls pass. Direct SC07 replay passes. |
| Runtime status / `react-db/tests/ssr-runtime-error-handoff-oracle.test.tsx` | 20 intended first-view failures/16 controls. Fixed `2229/6` reaches browser error replacing the ready server view. Query-preparation failures before hydration are excluded from this RED count. | 36/36. Each ordinary/infinite path executes fixed/random 64 histories and named outcome controls. Merely transporting errors fails 12 committed-error cuts. Original local-error precedence fails both primary observer campaigns. Direct runtime replay passes. |
| Error publication / `db/tests/live-query-observer-history-oracle.property.test.ts`, selector `hydration error timing` | An always-deferred handoff fails synchronous post-subscription publication in both campaigns, fixed `2229/2:0`. | Expanded owner plus observer examples: 89/89. Pre-attachment seed status and synchronous owned error publication are both asserted. Direct timing replay passes. |
| Svelte receiving / `svelte-db/tests/ssr-snapshot-handoff-oracle.svelte.test.ts` | Original getter: 4 first-view failures/16 controls. Nested inherited provider also fails before inheritance repair. Final original-getter replay: `2229/8`. | 24/24, fixed/random 120 histories. Always-server getter fails a fresh mount. Persistent hydration marker fails a later child. Original getter fails the exact late-hydration comparison. Direct replay passes. |
| Svelte runtime / `svelte-db/tests/ssr-runtime-error-oracle.svelte.test.ts` | 10 first-view failures/8 controls; fixed `2229/6`. Committed browser outcome already passes in RED. | 18/18, fixed/random 64 histories. Same shared runtime judgment as React, received through native Svelte hydrate. Direct replay passes. |
| Delayed first record / `start-ssr-e2e/e2e/router-stream-view.spec.ts` | Actual differing-row shell history substitutes browser rows. Normal delivery, later boundary, and known pending close controls pass before repair. Local-preload-before-delivery separately fails the shared first-view comparison. Empty/equal cases failing only the withdrawn acquisition ban receive no defect credit. | Corrected 13/13. Isolated no-wait variant fails server-ready/server-row versus browser-ready/browser-row. Closing every known pending result fails the explicit overlapping-preload checkpoint. Both use the same host/comparison. |
| Record lifetime / `db/tests/ssr-stream-record-wait-oracle.test.ts` | Original public-host RED precedes implementation. The later core driver adds lifetime dimensions. Old local timestamp admission fails both campaigns after arrival. With the final grammar, fixed `2229/9:1` and random `-903817574/1:1:1` reconstruct local preload then server arrival; exact replay fails and then passes. New-lifetime RED is recorded above. | Fixed/random 100 histories, including missing/pending/local records, arrival/close/error/cleanup, peers, late attempts, undefined causes, and a new stream after cleanup. Same-open reset control rejects an overbroad repair. Pending-result disposal during cleanup remains outside this grammar. |

For direct replay, set `TANSTACK_DB_ORACLE_PROPERTY`,
`TANSTACK_DB_ORACLE_SEED`, and `TANSTACK_DB_ORACLE_PATH`, then select only the
random-campaign test. Property IDs are registered in
`packages/db/tests/oracle-replay-manifest.ts`. Core supports the guarded
`node --import tsx tests/oracle-replay.ts` runner. The table's `seed/path`
notation keeps both values, rather than claiming a seed alone records timing.

The actual host command is `PLAYWRIGHT_BASE_URL=http://127.0.0.1:4197
playwright test e2e/router-stream-view.spec.ts --workers=1` from the Start
example. Its HTTP sink holds all bytes from the first record until a browser
hook attempt, preserving byte order. The known-pending control receives a record,
closes the DB stream, starts explicit public query and Collection preloads, and
checks that the known query promise stays pending until provider release.
This is a real Router/Chromium mini host, not a deployed Start/Electric system.

### Guide conformance

| Requirement | Outcome for the changed owners |
| --- | --- |
| ORC-001 | Laws and authority appear above and beside executable judgments. Bounds distinguish core callbacks, finite eager sources, initial windows, and real framework receiving paths. |
| ORC-002 | Ownership uses returned-handle counts and independent terminality. SSR compares authored outcomes or separately recorded server/browser views. No production status, admission, version, or partition classifier computes the expected result. |
| ORC-003 | Law, model, grammar, driver, and checkpoint prose remain beside executable code. Shared modules name their drivers and distinguish lifecycle status from first hook view. |
| ORC-004 | Grammars reconstruct the recorded failures. Removing callback throw loses ownership/peer failures; removing held readiness loses SC06; removing failure loses SC07; removing runtime outcomes loses error handoff; removing later hydrate/fresh mount/nesting loses the Svelte distinctions; removing local records or stream restart loses R04/R05. Rows are 0–3, healthy peers 0–3, prior Svelte readers 0–2, and GC grace 1–3. Illegal unreleasable Suspense-only holds and pending-record cleanup are excluded explicitly. |
| ORC-005 | Core uses actual observers and Collections. React uses renderToString/pipeable streaming and hydrateRoot. Svelte uses separately compiled SSR/browser fixtures and native hydrate/mount. Router uses the installed serializer, HTML transform, manifest Scripts, and Chromium. First-view, held-cleanup, synchronous-publication, settlement, and final-release cuts are separate assertions. |
| ORC-006 | The table names intended comparison failures. Isolated copies supply wrong implementations without shared-source swaps. Setup failures, unreached main probes, selectors running no tests, and discarded work/error-identity assertions are explicitly denied RED credit. |
| ORC-007 | Important properties run the same grammar/comparison/budget with fixed seed 2229 and without a seed. Seed/path direct replays were checked. No changed property uses commands requiring a separate command replayPath. |
| ORC-008 | Callback and server/browser comparisons are stateless judgments. Lifetime inputs distinguish missing/pending/local records and old/new stream obligations. No second production lifecycle model was introduced. |
| ORC-009 | Returned logical handles, physical source subscription ownership, provider timing premises, framework hydration intent, and Collection status remain distinct. Framework query identity is not the DbClient query hash. |
| ORC-010 | Drivers release resources after failure and retain primary comparisons separately from cleanup diagnostics. Reduced failures retain the same public mismatch. Undefined causes use an explicit wrapper, preserving the distinction from an open stream. |
| ORC-011 | The named risk of classifier-derived SSR expectations is addressed by separately recorded server/browser observations. Another copied status classifier would add no independent evidence. Ordinary and pooled production paths are receiving controls, not two independent reference models. |
| ORC-012 | This record supplies exact source bindings, dispositions, commands, comparisons, and finite limits. It does not claim universal closure or erase the historical production-first deviation. |
| ORC-013 | Throw/no-throw and early/late peers distinguish callback boundaries. Ready-empty catches status-only errors. Late hydrate/fresh mount/later child distinguish scoped hydration. Missing/known-pending and close/error distinguish stream obligations. Same-open/new-stream controls distinguish reset boundaries. |
| ORC-014 | The Router mini host supplies actual byte-order receiving evidence. Native React and Svelte supply their own hydration cuts. Controlled provider errors and callback failures stop at those declared boundaries; no deployed Electric or arbitrary provider claim follows. |
| ORC-015 | Each important property enforces declared reach with minimum one outside direct replay. Counts below report normal campaigns, excluding RED shrinking. Each actual host case also asserts its receiving premise before comparison. |

### Final loss audit and reviewer assessment

The 25 original items remain separate: **11 fixed-now, 2 confirmed-open evidence
gaps, 1 stale historical process finding, 3 refuted, 5 accepted-design, 1
design-decision, and 2 duplicates**. The sum is 25. Five additional siblings
(SC07, immediate error publication, nested Svelte hydration, local timestamp
admission, and client reuse) received their own repair gates. None is a deferral.

H04 needs a legal eager-source subscription throw plus authority requiring
same-partition recovery after it. Ordinary markError/markReady does not reach
that catch and recovers; on-demand probes are ineligible for pooling. H08 needs
a live demand still detached after the supported replacement-readiness cut.
Current real-throw histories reacquire through that listener. These historical
claims remain evidence gaps, not proved defects or refutations. The coverage
map names their owners and the missing witnesses. Core-SC04 remains an
unexecuted multi-epoch manual-input policy question. R04 intentionally does not
decide it by comparing every retained timestamp.

Reviewer assessment: retain all five reviewers for similar work. Lifecycle and
SSR-core supplied small executable failures and useful narrow-repair controls.
React/Router and Svelte found receiving paths omitted by green controlled
tests. Bundle review distinguished wording, standalone freshness, CI behavior,
and emitted bytes. The main corrections were an initially unproved deployed-host
claim, an overstrong source-work restriction, and error-object identity beyond
the portable contract. Those corrections remain visible. Useful findings and
precise evidence outweigh those revised hypotheses.

Accounting is complete for this round. Final CI status and whole-PR readiness
remain separate judgments. The historical process violation and unresolved
evidence questions prevent treating this audit as a universal readiness proof.

### Declared reach


Runtime counts below come from the final full React run. Each hook/campaign executes64 histories and asserts all named minima. Error views are also separately enumerated across16 authored combinations per hook. Reach events are recorded after actual server/hydration/commit observations, not just generated inputs.

```text
react-ssr-runtime ordinary fixed {
  'server-error-browser-cold': 18,
  'server-ready-browser-failed-before-hydration': 8,
  'server-error-browser-ready-before-hydration': 6,
  'matching-ready': 18,
  'matching-error': 14,
  'undefined-cause': 35,
  'defined-cause': 29,
  'browser-commit': 64,
  'explicit-preload-after-error-view': 31
}

react-ssr-runtime ordinary random {
  'server-error-browser-cold': 12,
  'server-ready-browser-failed-before-hydration': 10,
  'server-error-browser-ready-before-hydration': 5,
  'matching-ready': 22,
  'matching-error': 11,
  'undefined-cause': 31,
  'defined-cause': 33,
  'browser-commit': 64,
  'explicit-preload-after-error-view': 22
}

react-ssr-runtime infinite fixed {
  'server-error-browser-cold': 18,
  'server-ready-browser-failed-before-hydration': 8,
  'server-error-browser-ready-before-hydration': 6,
  'matching-ready': 18,
  'matching-error': 14,
  'undefined-cause': 35,
  'defined-cause': 29,
  'browser-commit': 64,
  'explicit-preload-after-error-view': 31
}

react-ssr-runtime infinite random {
  'server-error-browser-cold': 21,
  'server-ready-browser-failed-before-hydration': 6,
  'server-error-browser-ready-before-hydration': 9,
  'matching-ready': 13,
  'matching-error': 17,
  'undefined-cause': 29,
  'defined-cause': 35,
  'browser-commit': 64,
  'explicit-preload-after-error-view': 39
}
```

Immediate observer counts from final post-reset core run;64 histories per campaign. Both modes, all portable seed statuses and before/after ownership cuts reached.

```text
observer-hydration-error fixed {
  granular: 33,
  wholesale: 31,
  'before-attach': 31,
  'after-subscribe': 33,
  ready: 21,
  loading: 24,
  error: 19,
  'defined-cause': 29,
  'undefined-cause': 35
}

observer-hydration-error random {
  granular: 29,
  wholesale: 35,
  'before-attach': 29,
  'after-subscribe': 35,
  ready: 23,
  loading: 20,
  error: 21,
  'defined-cause': 34,
  'undefined-cause': 30
}
```

Wait counts from final post-reset core run;100 histories per campaign. A known pending result with cleanup is excluded because existing result-promise disposal is a different law. Missing/local cleanup and subsequent client restart are included.

```text
ssr-stream-record fixed {
  missing: 37,
  pending: 25,
  local: 38,
  arrival: 28,
  close: 28,
  error: 25,
  cleanup: 19,
  'late-attempt': 44,
  'peer-first': 45,
  'undefined-cause': 50,
  'restart-after-cleanup': 59
}

ssr-stream-record random {
  missing: 39,
  pending: 24,
  local: 37,
  arrival: 23,
  close: 26,
  error: 30,
  cleanup: 21,
  'late-attempt': 42,
  'peer-first': 62,
  'undefined-cause': 52,
  'restart-after-cleanup': 48
}
```


Svelte receiving fixed/random counts, 120 histories each: first-hydrate 29/19,
late-hydrate 39/51, fresh-mount 52/50, fresh-child 26/25, inherited-provider
16/22, explicit-provider 25/21, fresh-nested-mount 34/36, earlier-authoritative
91/101, multiple-earlier-readers 30/38, same-rows 72/81, different-rows 48/39,
loading-server-view 63/49, ready-server-view 57/71, authoritative-view 120/120.
Svelte runtime fixed/random counts, 64 histories each: server-error/browser-cold
18/14, server-ready/browser-failed-before-hydration 8/8,
server-error/browser-ready-before-hydration 6/6, matching-ready 18/16,
matching-error 14/18, undefined-cause 35/31, defined-cause 29/33, browser-commit
64/64.

Mixed-stream final fixed/random reach, 40 histories each: held ordinary-first
13/13, held Suspense-first 5/4, held handoff 18/17, synchronous readiness 22/23,
synchronous handoff 14/11, held-source-error 11/9. Every declared minimum is one.

Pooled callback campaigns execute 80 histories per row. `path`, first-return,
and release each reach 80. Cleanup-start and settlement also reach 80 for each
cleanup row. Remaining declared counts follow.

| Law/path/campaign | return | throw | peers | no peers | throw before | throw after | undefined |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Bootstrap ordinary fixed | 43 | 37 | 54 | 26 | 16 | 9 | 43 |
| Bootstrap ordinary random | 29 | 51 | 63 | 17 | 18 | 21 | 41 |
| Bootstrap pooled fixed | 43 | 37 | 54 | 26 | 16 | 9 | 43 |
| Bootstrap pooled random | 45 | 35 | 51 | 29 | 12 | 9 | 42 |
| Cleanup ordinary fixed | 43 | 37 | 54 | 26 | 16 | 9 | 43 |
| Cleanup ordinary random | 42 | 38 | 59 | 21 | 18 | 13 | 40 |
| Cleanup pooled fixed | 43 | 37 | 54 | 26 | 16 | 9 | 43 |
| Cleanup pooled random | 40 | 40 | 57 | 23 | 13 | 15 | 33 |

### Shipped weight and rejected alternatives

`pnpm size:compare --packages db,react-db,react-router-with-db --files` compares
identical minified consumer builds with main `5649a07d4`. Final deltas:

| Bundle | Gzip | Brotli |
| --- | ---: | ---: |
| Typical app | −338 B | −266 B |
| DB, all exports | +1,562 B | +1,314 B |
| React DB, all exports | +21 B | +18 B |
| Router DB, all exports | +26 B | +31 B |

The typical app excludes observer SSR transport at the DbClient import boundary.
All-export DB growth pays for capture, per-reader views, status transport, and
missing-record lifetime behavior. Per-file minified changes versus main include
observer −2,153 B, observer-client +4,534 B, client +2,195 B, subscription
admission +320 B, and pooled query +111 B. Per-file bytes are uncompressed and
cannot be added to compressed bundle deltas.

The repair reuses the same idempotent release for normal and failed bootstrap,
the existing all-callback dispatcher, and one hydration handoff for ready/error
publication. The Svelte repair merges client and hydration context, removing a
second context key/read. Against the reviewed head with fixed core externals,
identical Svelte compilation/minified consumer builds cost +17/+17 B for the
hook, +82/+75 B for provider plus hook, and +95/+93 B for all exports. Merging
contexts saves 17/18 B for provider plus hook versus the first repair. These
adapter-only deltas are not added to the whole-PR app figure.

Rejected cheaper designs have executable evidence: no rollback leaks ownership;
short-circuit dispatch skips peers; event-only updates omit the initial view;
error-only transport misses browser handoff; permanently retaining a seed hides
committed errors; always-server Svelte breaks fresh mounts; persistent markers
break later children; getter-only terminal throws permit false browser success
on React recovery; closing known pending results violates their separate promise;
and unconditional stream reset strands same-open demand. No retry lifecycle,
placeholder server record, or cross-clock timestamp ordering was added.

Tests and contract documentation are separate proof cost. They do not enter
production bundle measurements. Line-count bookkeeping below distinguishes
production, tests, documentation, and build/configuration support.

### Integrated validation and source binding

The broader combined run passed 1,099 core tests in 11 affected suites. After
the last client reuse repair, 151 core tests in five affected suites passed
again. Full React passed 749/749 in 22 files on that final implementation.
Svelte passed 229 runtime tests and seven type assertions, with zero errors
from svelte-check. Router passed nine runtime tests and one type assertion with
its existing typechecker enabled. DB and React test TypeScript checks, Router
TypeScript and declaration builds, Svelte package build, and changed-file lint
passed. These scoped runs are not a full `pnpm test` result.

Router's first combined invocation had 157 unhandled TS6059 diagnostics despite
passing assertions. Later native and explicit TypeScript runs pass without
configuration changes or disabled typechecking. Current configs match main.
A deliberately package-only rootDir reproduces that error shape, but the
original transient option's origin remains unproved. Svelte's first combined
invocation exposed 12 new callback-inference diagnostics. Explicit test callback
types fix them. Neither failed invocation counts as a clean GREEN.

Final minified output checks pass: six consumer programs, 108 public error
names plus metadata/query/update controls, 251 erased production error literals
(including 20 shared), generated error documentation, and the 414-name mangle
census. Forcing DbClient into a plain consumer fails the intended inclusion
assertion. Stale React and IVM source controls previously passed incorrectly;
all-alias freshness now rejects them. These build laws use actual emitted bytes
and artifact checks rather than a runtime state model.

Commands from the repository root:

```sh
pnpm --filter @tanstack/react-db test --coverage.enabled=false --typecheck.enabled=false --maxWorkers=2
pnpm --filter @tanstack/svelte-db test --coverage.enabled=false --maxWorkers=2
pnpm --filter @tanstack/svelte-db test:types
pnpm --filter @tanstack/react-router-with-db test --coverage.enabled=false
pnpm exec tsc -p packages/db/tsconfig.test.json --noEmit
pnpm exec tsc -p packages/react-db/tsconfig.json --noEmit
pnpm exec tsc -p packages/react-router-with-db/tsconfig.json --noEmit --incremental false
pnpm test:ssr-bundle
pnpm test:minified-db
pnpm test:production-errors
pnpm check:mangle
pnpm lint:changed
```

The existing installation was reused. A pnpm dependency-check attempt aborted
without a TTY before removing modules. No install override or lockfile workaround
was committed. Ordinary builds produce ESM/CJS input, while consumer comparisons
perform final minification. Source changes require fresh aliased distributions.

Source SHA-256 values below bind runtime evidence to this record's containing
commit without needing a self-referential commit hash. Historical reviewed head
and baseline remain at the top. Test/driver hashes are included because later
formatting changes their bytes even when the comparison stays the same.

| File | SHA-256 |
| --- | --- |
| `packages/db/src/client.ts` | `79156819785ca62b8eb362af15842306e64d879cd2741c5fb3db2a39901f1c05` |
| `packages/db/src/live-query-observer-client.ts` | `9cdddb316671d391aa6c99bef5f32e088f4347c1d7bd4acea2900154d0c75d0a` |
| `packages/db/src/live-query-observer.ts` | `0a29dbc376ced35924c1793be506c087c57ac0b3d61798fc60337f1f9d87d016` |
| `packages/db/src/query/pooled-live-query.ts` | `1115cd6f589fae712893607de24d29dc84f1cdfb862774eabead60b7382a1da7` |
| `packages/react-router-with-db/src/index.tsx` | `9721cc2d847cb42f70741756606766e102ac39e9074c81e574d2f6ce4f88ac44` |
| `packages/svelte-db/src/DbProvider.svelte` | `26f60dd8b2b4f0488b4a91cc4d7e59e43eaf070077210914e3a98ac49c2d75a6` |
| `packages/svelte-db/src/db-context.ts` | `9d7d42efd128b33e4f6000fa486a391e0fa152939793b0ca381f8e1a663d3dae` |
| `packages/svelte-db/src/useLiveQuery.svelte.ts` | `629d788541f04be3dfa0864dc2938ce1aaeaa481a79637b6285c09484c83c333` |
| `packages/db/tests/ssr-stream-view-oracle.ts` | `196bf72daf8f6195994de54d174352c0e1dbb8fda25849d4e37d4305f00773b5` |
| `packages/db/tests/ssr-stream-record-wait-oracle.test.ts` | `284d7b1d47e2c57b40efb3323d9583c9a81ab67ca52ea52accf4db0de315abc5` |
| `packages/db/tests/live-query-observer-history-oracle.property.test.ts` | `82beb7deb80d093b0a5a7ef2e7f81b49a2d5d6a7e4dc159799764562ce2640a3` |
| `packages/db/tests/query/pooled-live-query-gc-oracle.test.ts` | `08f84e9489a0e09753784991c92e0ee53fbdfc5e5e480bdb755640677b2b5266` |
| `packages/db/tests/ssr-snapshot-admission-oracle.ts` | `cffbb2398f8e6a628815406a5d3e4f5a0505e9e77b33dba49a29c5f09c6a70a7` |
| `packages/react-db/tests/descriptor-query-binding-oracle.test.tsx` | `a399991de46a3c61b5c642740ab1ddf421fd3083c17a713250973a84ecaca9bd` |
| `packages/react-db/tests/ssr-runtime-error-handoff-oracle.test.tsx` | `4a895440735ae1b3345187cb9dc7af65157f4b7ec761067d42c3b2532ce725c8` |
| `packages/svelte-db/tests/ssr-snapshot-handoff-oracle.svelte.test.ts` | `05cfef8f6ac8be3d2ad1690a269259a2084b990c5495e178a44e696ef550c05f` |
| `packages/svelte-db/tests/ssr-runtime-error-oracle.svelte.test.ts` | `41640b69f05edcee6f784bd5a1f44840f5f44fb4cfe7cc55704daed8ee838f66` |
| `examples/react/start-ssr-e2e/e2e/router-stream-view.spec.ts` | `bf0a3690d09eb926c34d22278407006af5a0ee2d2e16bce317d4436af5bfd9d3` |

CodeRabbit review IDs `5618234197` and `5620262151` were already evaluated in
[the migration record](2026-10-22-dbclient-migration-feedback.md#subsequent-coderabbit-evaluation).
The source-reference and two wording findings are fixed. The proposed automatic
cleanup retry was superseded by the maintainer's explicit rejection policy.
The mutable summary remains paused at `da37bc9b`; its stale minimal-risk label
does not review these repairs. No new CodeRabbit review appeared during this
round's pre-push poll.

Repair-round line bookkeeping, excluding this review record:

| Kind | Added | Removed |
| --- | ---: | ---: |
| Runtime production | 196 | 69 |
| Tests and receiving drivers | 3111 | 85 |
| Contract documentation and changeset | 178 | 46 |
| Build and configuration support | 18 | 11 |

### Native integration closeout

The complete Start example suite passed **15/15 Chromium tests** in 12.8 seconds:
the existing two Vite Start application cases and all 13 new Router receiving
histories. It ran with the example's existing Playwright configuration and
Vite on port 4175, using the final rebuilt DB distribution. Command from the
example: `playwright test --workers=1`.

The first integration attempt passed the 13 receiving histories but failed the
two application routes before hydration because Babel could not resolve
`baseline-browser-mapping`. Its local dependency link named absent version
2.11.32. A reversible ignored node_modules resolution to the already cached
2.11.27 allowed the complete suite to run. The original dangling link remains
preserved. No source, package manifest, lockfile, dependency override, generated
route tree, or Vite/Playwright configuration changed for this local repair.
The initial dependency failure receives no application-assertion credit.

This real Vite Start check supplements the byte-preserving mini-host witness.
It does not establish deployed Electric timing or every provider/renderer
version. Final library sources are unchanged from the binding table above.

### Post-commit source-binding correction

The pre-commit ESLint task sorted two imported names in
`packages/svelte-db/tests/ssr-snapshot-handoff-oracle.svelte.test.ts`. No test
logic or runtime source changed. Its committed SHA-256 is
`e71adfcf7052b2040a3cc8cb90f693fd815c34deda80bc31761db938a18d2d06`,
replacing `05cfef8f6ac8be3d2ad1690a269259a2084b990c5495e178a44e696ef550c05f`
in the binding table. The final Svelte invocation passed all 236 runtime/type
assertions with zero source/type errors. All other bindings match the committed
files. The repair commit is `0cf7294da3c14fbda6c8186da3c11eebb89ce064`.

### CI replay-registration correction

At `255312c4068714a7778c17bd6de4e325b8bddce0`, CI run `40397107769`,
job `121834000852`, failed the replay manifest's literal-owner check.
The React runtime receiver constructed both registered property IDs from the
hook name. An explicit mapping now supplies the same IDs to the same campaigns.
The manifest check, model, history grammar, run budgets, reach requirements and
public comparisons are unchanged. No production source changed.

The focused manifest test reproduced the failure before the edit and passed
afterward. The complete `oracle-replay.test.ts` passed **38/38**. The React
runtime receiver passed **36/36**, with no type errors; each fixed/random
campaign executed 64 histories and satisfied its declared reach. Guarded
replays of `react.ssr-runtime-ordinary` and `react.ssr-runtime-infinite`, each
with seed `2229` and path `6`, reported exactly one completed property run.
ESLint and `git diff --check` passed. This corrects registration representation;
it adds no behavioral coverage or broader closure claim.

The receiver's updated SHA-256 is
`b616de7426e75970a6a8fd409d539b7daf2bc805602fbbc90ff37af2bb71fa3f`.
All production bindings above remain unchanged. CodeRabbit review IDs and
inline comments were unchanged on this CI poll; its summary remains paused at
`da37bc9b`. GitHub reports a conflict with main, separately from CI status.

### Main integration after CI registration repair

The maintainer authorized merging main after the conflict blocked CI.
The merge combines branch `07d43c750025b07e8c77e4c475a70841a233d093`
with main `45c33292b2c4f09a63f856a829c1e15ca2b470aa`.
Its only conflict was the replay property registry. The resolution retains all
branch IDs and all four persisted-options IDs from main, without changing any
model, grammar, budget or comparison. The local dependency override and
lockfile patch are byte-for-byte unchanged and remain uncommitted.

The combined tree passed **38/38 replay tests**. Core and browser each passed
all four persisted-options campaign tests, including their generated consumer
type comparisons and declared reach. The initial commands also invoked global
TypeScript 7.0.2 for the separate harness typecheck and exited nonzero with
source diagnostics; those exits are not GREEN evidence. With the workspace
compiler, TypeScript 5.9.3, both harness typechecks passed with no errors, as did
all nine existing core persistence type assertions. ESLint for the resolved
registry and both staged and working-tree whitespace checks passed.
No subscription or SSR production source changed during this merge.

### Integration with opt-in operators

The next requested merge combines `bb83e42a4a00d0ea772c4a211fd19d83bb7c5a7e`
with main `6c1ca8f8f9efe437d3cea61b5b9d0a086e2a5e34` (#2232).
Eight conflicts retained both sets of tests, coverage statements and error sites.
The SSR helper now imports the pooled-source lookup from main's new lightweight
module. The mangle-cache writer preserved safe assignments and assigned unique
names to the combined private members; its 418 entries pass validation.

The existing production-error census caught an integration defect before its
repair: main allocated class codes 247/248, which this branch used for two SSR
sites. `never reuses a class code` failed on both sites. Their codes are now
252/253, with matching fixtures and regenerated documentation. The unchanged
independent uniqueness check passes for the complete combined census. No model
rule or assertion was relaxed.

Combined-tree verification passed: **168 core checks**, **780 React checks**,
**241 Svelte checks**, **10 Router runtime/type checks**, **38 replay checks**,
and **15 Start/Chromium checks**. Framework typechecks report no errors. All
affected packages built; six SSR bundle comparisons, minified public API and
production-message erasure checks passed. The PR diff passes
`git diff --check origin/main`; a first-parent check also flags trailing spaces
already present in main's generated reference pages. The local dependency
patch is unchanged and stays outside the merge commit. Earlier evidence limits
remain; these runs verify integration with this main commit.

Updated production and receiving-source bindings before the merge commit:

| File | SHA-256 |
| --- | --- |
| `packages/db/src/client.ts` | `b8209ae4a18372271a7a6d94e270043adf8aa8499e6c66f3a8ff171d5337c0f8` |
| `packages/db/src/live-query-observer-client.ts` | `de6a592194f8c6a468b76f2bcae335cde6a466c52a5d7e4b282ffab604f95232` |
| `packages/db/src/live-query-observer.ts` | `0a29dbc376ced35924c1793be506c087c57ac0b3d61798fc60337f1f9d87d016` |
| `packages/db/src/query/pooled-live-query.ts` | `20a2998f60289026fbacb291079ebdc86cea5437c63eb04229b8e8eed9c710b8` |
| `packages/db/tests/query/pooled-live-query-gc-oracle.test.ts` | `38ff3a3805ac0d662a5f4a8fa12e64a28132607723bb7fd04cf14005b1c7b35b` |

The React descriptor receiver remains at its earlier `a399991d…` binding.

`pnpm size:compare --base origin/main --exact-base --files` passed against
`6c1ca8f8f`. The typical app decreased **412 B gzip / 375 B Brotli**; all eight
app scenarios decreased. The complete DB package increased **1,457 B gzip /
1,276 B Brotli**, and React increased **22 B / 17 B**. Other measured packages
were unchanged, for a package total increase of **1,479 B / 1,293 B**. These
package totals retain every export. The six bundle comparisons above separately
verify that ordinary, Suspense and infinite hooks exclude SSR implementation
without DbClient; the controls retain it. This integration measurement uses the
earlier SSR extraction and refactoring, without claiming a new size reduction
from the mechanical merge repairs. Full measurements are in the task scratch
file `second-main-size.log`.

### Documentation CI integration

At `7fff3a7e0`, CI's new documentation typecheck failed on the manual-index
example. Its isolated fragment left `todoCollection` undeclared, so the checker
supplied a Collection where `DbClient.collection()` requires a descriptor.
The focused check reproduced that error. The example now accepts an explicitly
typed descriptor and imports its API names. One obsolete known-failure baseline
entry for a persistence example was removed; no failure was added to the
baseline. No runtime source or oracle assertion changed.

The complete `pnpm test:doc-snippets` check passed: 760 examples across 255
files, zero new failures, 279 existing known failures (61 do not parse).
`git diff --check` passed.

The previous manual CI run also exposed an ordered-work mismatch. Its exact
replay fails on both `7fff3a7e0` and main `6c1ca8f8f`: property
`ordered-work.eager-indexed-window`, seed `1902868771`, path
`19:2:2:4:4:4:5:9:18:15`, two full-source requests where the comparison expects
zero after the final signalling refetch. Each replay executes one history and
reports no type errors. This is the existing unindexed-continuation contract
question recorded in the coverage map, with another distinguishing joined-filter
history. Main's matching failure establishes that this PR did not introduce
this counterexample; it does not establish whether production or the work
comparison is correct. The owner and needed contract witness remain recorded
there, and the comparison remains unchanged.
