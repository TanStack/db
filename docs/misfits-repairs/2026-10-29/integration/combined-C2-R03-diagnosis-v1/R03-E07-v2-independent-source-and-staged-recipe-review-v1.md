# R03 E7 v2 independent source and staged recipe review

Reviewer: `/root/review_combined_held_cuts`.
Review date: 2026-10-30.

## Decision and scope

Accept this exact E7 v2 source/static packet for ROOT to consider a fresh,
single-label admission of `R01-direct-and-ownership-controls`. There is no
remaining source or recipe blocker from this review. This is not runtime
admission. The reviewer created no admission and ran no receiving command.
Each later command still requires its own ROOT admission and ROOT classification
of the immediately preceding exact receipt.

The E7 v1 packet remains preserved and unaccepted. S01, S02, L03, L04 and L05
below are corrected in the successor source or pure recorder evidence. No new
receiving reach, receiving control outcome, runtime GREEN, production RED,
bug-class closure or PR readiness follows from this acceptance.

The review used source and JSON reading, hashes, in-memory source comparison,
and native JavaScript RegExp over inert names. It did not import production,
test, collector, configuration, launcher, resolver or parser modules. It did
not execute tests, test listing, compiler, formatting, lint, builds, campaigns,
mutants, generators or Git mutations. The compiler, format and lint results
reported below are independently checked frozen author receipts, not commands
run by this reviewer.

## Exact reviewed identities

Packet directory, relative to
`docs/misfits-repairs/2026-10-29/prep-pr/replay-batch/evaluation/initial-preload-repair-v1/`:
`r03-request-health-provenance-e07-v2`.

| Item | SHA-256 |
| --- | --- |
| `packet-freeze.json` (81 members) | `925b742c936cb2ddaf295fb24474500b537bff100461aa95c835714875b59e0a` |
| `input-freeze.json` (1415 inputs) | `13b15880e74ed125f58c38c80c693b0ad99edc41dc54bf57b4144014978dbf4d` |
| Current primary oracle / epoch-v4 source 0 | `4de0d05d316a4a9e69136b10a566e73715c89290c216e1298b90e3b8dc19a677` |
| `runtime-recipes.json` | `f58e469902b62bb033945c8cd36c108faa19bd4b2224860658df0b7d193c0c5f` |
| `run-admitted-finite.py` | `c02514ce6ce295b77c466d0576d8a0fbbdf9d121563fdefa7c7a96552b2bbfb0` |
| `pure-reporter-calibration.json` | `5d51fb015f0eb657fd919a4dc95a5b9e17eab4795ba2befa2d27d6dd5899c85d` |
| `native-selector-diagnosis.json` | `08e0490b48eac9304fcc5f9837b3ce365a14cacaf5759b6c0c35ae8d28da8be1` |
| `selector-cardinalities.json` | `c9d815f1cf9195ae591b24f3ee464c4a15ee9fa6b435b617a2e6e21b98665eb7` |

All 81 packet members match their frozen hashes. All current 1415 input bytes
and recorded HEAD match. Only the primary oracle and coverage document differ
from E6. All 511 production files have unchanged identity
`60d0fa772d95a340042bf3776c67da573cd407ded732dcb4d7f776f5da339a42`.
The retained-publication helper is unchanged. All 24 original oracle-budget
invocation lines are unchanged.

Protected slices remain byte-identical to E6:

| Slice | SHA-256 |
| --- | --- |
| `covers` | `7248569c5a4d72b17faa96009ac6292bd9106e87af1fad70930f4f87bef17d68` |
| `decidingOwnFailures` | `e9b6ad6b05e2d217c2fe97566e0427b8cfd2c5e55a4807ecdccf05a2bad72a43` |
| `settleOwnVerdicts` | `eb8352de00574aa497b9d2ff56356b37e8b6642e9f8893f7da09ed6a9d7edcd9` |
| successful `covered` predicate | `3f27f15ba9c27836efc31fe2f25dd8a2b01c1a4d56407f8bb0bae4d3acaf145b` |

## Law and receiving provenance

This review retains the accepted ownership correction plan
`cf0c3de3ab805efb600521d943a2933e2da9588409b74634ba127dbfcb2b850e`
and its independent acceptance
`7b4a30fb35df93dc746ea03f5b7647b0e5e780888c98b6799616b58094a60e44`.
The authority remains the glossary's query-started request-error contract and
the live-query architecture's distinct own-completion, health, replay and
publication obligations. Production output is evidence, not authority.

`R03-E6-HEALTH01` remains an evaluation/receiving-provenance gap. A directly
authored request on a real query-owned subscription establishes that request's
subscription, replay and publication ownership. It does not establish that the
query planner started it or installed the per-key health observer. Its later
distinct failure therefore cannot alone create graph-plan per-key health debt.
It still owes exact subscription error delivery and retains its replay,
own-receipt and publication obligations.

The revised independent ownership model preserves the first replay verdict's
aggregate health frame, including a contributing direct failure. It separately
preserves genuine later graph-plan per-key failure debt. Issuing a direct
request does not clear existing graph debt. Unknown provenance fails the
receiving premise. `observeDemandProvenance` observes the real controller's
`setDemand` entry and forwards the call unchanged. Direct predicate intent is
registered before production entry. Origin is retained through renewal without
using subscription identity as a substitute for request-start provenance.

The direct-request comparison requires the exact `loadSubset:error` event,
subscription, options and Error and checks the latest subscription error at the
command cut. Whole-query health remains diagnostic at event and command cuts.
The first aggregate outcome comes from independent first-own episodes and
logical owners, rather than the new origin classification. The existing
replay, own-verdict, successful-coverage and publication models remain active
for direct requests.

The prepared native lane uses the actual eager parent and on-demand joined
source. It starts no direct request and forwards no synthetic health callback.
After initial readiness, replay failure A owns the first immutable receipt and
native completion. A later parent insertion causes actual controller/graph
demand for key 2 after that receipt; that load fails with distinct Error B.
Automatic provider retry answers remain held through the health comparison.
The shared comparison checks aggregate A plus graph B health, exact B delivery,
the retained failed-replay publication, authoritative recovery and acquisition
unloads. Independent parent keys determine the expected relation. Ten controls
challenge this shared ownership comparison. This is a source review of the
prepared path; its actual entry and ten declared reaches remain unmeasured.

## E7 v1 blocker dispositions

**E7-S01 — corrected in source.** The original same-source, full-key successful
coverage predicate is restored byte for byte to E6. It no longer adds same
subscription, graph-plan or plan-ID restrictions. This preserves the accepted
successful loaded-key recovery law while the provenance correction changes
only failure-health ownership.

**E7-S02 — corrected in source.** The unordered native query's retained and
recovered relations are copied and sorted by the independent numeric ID before
comparison. The copies preserve multiplicity and the complete compared row
fields. This removes insertion-order dependence without weakening row equality.
Existing ordered-window comparisons are unchanged.

**E7-L03 — corrected in launcher source and pure recorder evidence.** Reporter
summary parsing now uses complete integer/status tokens, rejects duplicate or
unknown tokens, requires the exact passed/skipped map, and verifies the total
against both the recipe and the sum. Substring matches can no longer accept
11 for 1 or 113 for 13. The frozen pure calibration records demonstrate those
two previous false greens and duplicate-status rejection. They provide no
receiving evidence.

**E7-L04 — corrected in launcher source and pure recorder evidence.** A Counter
compares the exact multiset of payload kind, full history name and sorted
required-state list against the recipe. Required-state duplication remains
visible because it uses a tuple, not a set. Each receiving payload still owes
completion, contiguous observations and positive required reaches. The native
payload additionally owes the exact ten-state reach-key set. R01 separately
requires the original failed-cover history and its two states. Duplicate
same-kind history, substituted name, omitted required state and duplicate
required state are recorded prior false greens rejected by the successor.

The recipes' full payload names and requirements agree with the frozen source's
literal/conditional lifecycle and publication grammar. Both grammar initializers
are byte-identical to E6: lifecycle SHA-256
`b17f9725cf68e5b47c9791a28d9c9355d7d8d44f17890ba8016459461aa5b9ec`
and publication SHA-256
`4d3c1c89ab75de4143f068ec0623be701227449b718024f12d6de2de3df7fd15`.
R04's late-entry calibration is bound to the first publication history, with
no separate required-state list. Its expected rejection still comes from the
shared production driver and comparison.

All 21 frozen pure parser records have the declared acceptance disposition.
Seven recorded false greens against the preserved prior parser are rejected by
the successor. These are author-produced synthetic controls whose source and
data were inspected; the reviewer did not execute either parser.

**E7-L05 — corrected in staged admission source.** The launcher reads
`admissions/<label>.json` and requires ROOT acceptance of exactly `[label]`, the
same `commandLabel`, exact input and packet hashes and a hash-bound independent
review. R01 requires a null predecessor classification. Each later admission
binds the immediately preceding exact receipt hash and affirmative ROOT
classification. All earlier receipts must be accepted, and their recorded
admission hashes must still match. The current admission is rehashed after the
process and included by path and hash in its receipt. This permits ROOT to
admit R01 alone; it grants no later command automatically.

The launcher delta against E6 preserves the earlier one-shot reservation,
serial guard, timeout, process-group cleanup, durable stop and artifact-write
handling. A fresh four-command ceiling is proposed; no unused E6 authority is
inherited. The installed primitive `%s` formatter is now checked along with
the native name matcher.

## Native selectors and payload allocation

The independently reconstructed 132 display/native-name pairs agree exactly
with E7 v2's inert inventory, which is unchanged from E7 v1. The inherited 121
registrations and all original registration text remain unchanged; the new
literal natural title and ten primitive-string controls add 11 finite bodies.
Native names use suite spaces, not the reporter's ` > ` separator. Applying
the four actual recipe patterns with native JavaScript RegExp gives:

| Label | Selected | Skipped | Payload allocation |
| --- | ---: | ---: | --- |
| R01 direct and ownership controls | 11 | 121 | one exact failed-cover publication history |
| R02 native late key | 1 | 131 | one native payload, exact ten states |
| R03 remaining finite neighbors | 18 | 114 | seven exact lifecycle plus eleven exact publication histories |
| R04 publication controls | 13 | 119 | one exact late-entry calibration payload |

Each selected display and native name agrees with the recipe. Every selector
excludes the completed E01 history and all fixed/random campaigns. The installed
native matcher hash is
`bf6af6d2f4469911879a67e83b8f9e7b20332cf42795032c53457b10ccc1c617`;
the primitive formatter hash is
`d1ee20c8d65fe2e69c32bf69f13529e763e50e0d4f81b0711e9dede14f636762`.
Both installed byte identities match and are enforced at preflight. This
data-only selection is not a runtime registration or body-entry result.

## Preservation and frozen static evidence

All 47 E7 v1 packet members remain unchanged, under packet SHA-256
`5856e5652bb486b165d1acdc54266e9cc772f3df865dec8c4f5691aa09d3e40c`.
The E6 packet/result bindings remain unchanged, including result freeze
`f88e9b4c0199cf6f1706ad74d5d82b35e7aff1a4bde5ee7bd373f1099b55ea50`.
The completed E01 remains one finite GREEN trace; its result freeze is
`9c38317dbc05add7f612bddbc68107d63681591ba48156e2ee92b95af5f38d85`.
E5's wrong-selector failure and E6's partial result are not reclassified as
receiving success. E6 stopped before the failed-cover publication reach and
did not demonstrate a failed-cover publication mismatch.

Independent hash traversal verifies all 67 predecessor bindings and 321 listed
member occurrences. Independently enumerating every artifact manifest's
`files` map, normalizing string and `{sha256, bytes}` values, verifies 352 member
occurrences across 18 manifests. The 31 occurrences not nested in their own
audit record are all covered by separate outer audit bindings; no enumerated
manifest member is absent from the launcher's combined bindings. The exact
four-entry archive map and resolver are unchanged from E6. Mapped inert
snapshots match original hashes and byte counts, original executable mirror
paths remain absent, unknown paths get no fallback, and hash mismatches fail
closed. No historical source was restored or imported.

Epoch-v4 frozen static receipts report exit 0, an empty override environment,
matching before/after/current input freezes and matching full-log hashes:

| Check | Elapsed seconds | Receipt SHA-256 |
| --- | ---: | --- |
| T01 types | 15.608 | `664b2b8188489ae80e97543db1e9e9635b264795dd23bedb18f40c17e825e528` |
| F01 formatting | 0.741 | `f367d04b447c7e28cc43897c16299e16fe464a50f890cf165329194005234457` |
| L01 changed-file lint | 43.785 | `4294f1425d613f4110034b5611fdb31b7ab6d5a643cae4f4801f5e44dc8ce7da` |

Earlier static epochs and failures are preserved. No `runs` or `admissions`
directory existed at the integrity check supporting this review.

## Remaining limits and next decision

All new receiving reaches and control outcomes remain unmeasured. The prepared
native path addresses naturally started late-key request health; it does not
establish natural covering-union/controller selection. Intermediate nested
include/facade coherence and changed-source deferred admission with includes
remain open. Campaigns and hostile production mutants are unrun here. This
source/static review supplies no production defect finding or broad closure.

ROOT may decide whether to admit R01 alone against the exact identities above.
After its one allowed invocation, ROOT must classify the frozen receipt and any
surprise before deciding on R02. The same rule applies at each later boundary.
The reviewer supplies no admission and no authority to retry or widen selectors,
change source, rerun E01, run campaigns or mutants, commit, push or publish.
