# Snapshot selection review for PR #2086

The external review inspected `2e0afc8a9`; subsequent callback-key work
reached `6ec97f8a0` before this repair. This record distinguishes that earlier
calibration from the new controlled-provider experiments. The listed RED
results were reproduced against `6ec97f8a0` or the named hostile edit; the
GREEN results use the repaired working tree. The law concerns Collection
subscription selection and provider requests within the stated histories.

## Law and observation cuts

`requestLimitedSnapshot` promises not to resend a key already sent to its
subscriber. `Collection.subscribeChanges` promises per-key causal order; the
change-event history owner in the coverage map requires a strict consumer's
valid insert, update, and delete stream. A **published** delete releases a
public key; a source delete held in a private replay has not done so. A later
ordered local snapshot must skip every key selected earlier, including a
private replay selection, and every still-public callback key. The Collection
API, the change-event owner, and the method contract in
`packages/db/src/collection/subscription.ts` authorize this selection rule.

A selected or public key does not certify that all earlier provider rows were
fetched. The ordered-loading contract in
`packages/db/src/query/live/ARCHITECTURE.md` explicitly rejects a local row
as a remote offset or continuation boundary. Without `minValues`, an ordered
request with no explicit offset must cover a provider prefix wide enough to
admit its requested number of unseen rows. With `minValues` and no explicit
offset, an adapter may ignore cursor expressions; no finite bound derived
from local keys can reach an arbitrary cursor value, so provider acquisition
is unbounded. A locally selected key cannot supply `cursor.lastKey`. An
explicit offset supplied by the ordered source loader remains a separate,
caller-established boundary.

The lifecycle publication owner models source rows in a plain Map. A separate
Set models subscriber-visible keys. It runs two source-action histories: a new
insert, and a delete followed by reinsert and a new insert. Each history runs
with filtering, full-state pass-through, and `includeInitialState: false` pass-through. Each
mode runs with and without a cursor. The driver uses a real Collection, its
ordered index, sync transactions, and a subscription. It checks callback
key/type batches after each source commit and after the ordered request. It also checks
the retained key count after deletion. That count is a deterministic capacity
observation, separate from the public-row law.

The replay owner controls an accepted load promise. It compares public batches
while the truncate replacement is private and after the promise fulfills. It
also checks that private selections widen a later prefix request and that a
sparse retained row does not turn into a provider key cursor. A second replay
test checks a filtered snapshot selected during callback reentry. The
publication owner uses a controlled adapter over `[one, two, three]` to return
actual offset pages after sparse callbacks and ordered callback reentry. An
offset-only provider over three and seven ranks checks a high cursor value:
the request has offset zero and no finite limit, and its target row becomes
public.
The pagination recomputation oracle's key transport now uses its offset path
when `cursor.lastKey` is absent. The public `LoadSubsetOptions` type makes that
field optional, and the TrailBase adapter has the same fallback. All 24
pending-mutation transport cases pass with this fixture rule.

## RED and GREEN calibration

| Subject | Reached comparison and result |
| --- | --- |
| Prior follow-up: restore the old `trackSentKeys` early return | Eight pass-through callback cases failed: both source histories duplicated `insert:two`, and delete/reinsert retained one deleted key. Four filtering cases passed. This earlier run established callback tracking, not provider coverage. |
| Prior follow-up: publish ordered snapshots during a private replay | The held-publication comparison saw early inserts for `one`, `two`, and `three` instead of only the initial `one` batch. |
| Prior follow-up: select held replay by `loadOptions.length === 2` | An extra empty subset load made the fixture hold the wrong request and caused early replacement publication. Matching the ordered request by its options passed that perturbation. |
| `6ec97f8a0` as the original implementation against the new provider witnesses | Sparse callbacks lost `two` in both initial-state modes, with and without a key cursor; ordered callback reentry lost `three` in skip-filtering mode without a cursor. After a successful sparse replay, a cursor honoring `lastKey` could not acquire `one` at the first request. Six of nine new cases failed at public-row comparisons. |
| `6ec97f8a0` against the high-cursor offset-only witness | All four three- and seven-row cases reached the adapter request assertion and failed with `limit: 1` instead of an unbounded request. The fixture cleanup completed; these failures are request-bound assertions, not setup failures or public-row comparisons. |
| Remove the regular snapshot reservation from the repaired tree | The private mixed-replay witness reached its provider-prefix comparison with limit `2`, below the independent minimum `3`. Its selected filtered row had not been reserved before publication. |
| Remove the ordered snapshot reservation from the repaired tree | The repeated ordered-replay witness reached the provider-prefix comparison with limit `1`, below minimum `4`; the mixed-replay witness saw `2` below minimum `3`. |
| Repaired tree | The provider, replay, selection, and subscription suites pass: 629 tests in four files. The package Vitest configuration passed 242 files and 11,789 tests with coverage and Vitest typecheck disabled; a separate source/test TypeScript check passed. The new provider and replay cases pass at their public-row checkpoints. |

The high-cursor baseline and the two reservation mutants were run against the
latest witnesses in an isolated archive with the repaired test file. They
failed by value assertion, with cleanup complete; their failures did not rely
on a timeout or fixture error. The older last-enumerated-row cursor mutant is no longer relevant to the
accepted law: no locally derived `lastKey` is now sent. The old reset witness
in filtering mode remains narrower because callback tracking alone lets it
pass when the regular reservation is removed. The mixed replay witness owns
that private-selection requirement.

## Oracle guide audit

| Requirement | Outcome |
| --- | --- |
| ORC-001 | The Collection callback and ordered-snapshot contracts authorize the public-key law; the live-query architecture denies a continuation boundary from local rows. The retained-key check is an internal work bound, not an API memory limit. |
| ORC-002 | A source Map, visible Set, and plain ordered remote array choose expected rows independently of subscription tracking. Replay expectations derive from initial and replacement row sets; a separate callback map records actual public rows. |
| ORC-003 | Each owner states its law and limits. The new comments place the model rule, legal histories, real driver, public cuts, and comparisons beside their code. |
| ORC-004 | The callback matrix crosses three subscription modes, two source histories, and both local cursor paths. Sparse callbacks, ordered callback reentry, and sparse replay add three-row provider histories; a high-cursor offset fixture uses three and seven ranks. They exclude arbitrary ties, predicates, and remote schedules. |
| ORC-005 | The driver calls real snapshot methods and source sync transactions. Raw callback batches retain duplicate inserts and their order. Controlled adapters apply actual offset and key-cursor pages; replay checks before and after settlement. |
| ORC-006 | The original implementation reached the public-row comparison in six of nine provider/replay cases and failed the request-bound comparison in all four high-cursor cases. Both current reservation mutants failed their request-bound comparisons. Earlier callback and publication mutants are listed separately. |
| ORC-007 | No important generated property changed. Both existing owners still run their fixed and random campaigns in the package test suite. |
| ORC-008 | The model keeps source, selected, and visible keys distinct. A source row absent from the subscriber can be selected next; a public key may still leave earlier provider rows unseen. Published deletion and reinsertion distinguish a prior selection from current visibility. |
| ORC-009 | Model source rows map to installed Collection rows; model visible keys map to the subscriber's public snapshot. The remote array models provider order, not a production index. Retained-key count is an internal observation, not model ownership state. |
| ORC-010 | Replay fixtures resolve held promises in `finally`. Current mutant failures reached value assertions and cleanup succeeded. These fixed witnesses do not separately report a future simultaneous cleanup failure. |
| ORC-011 | The sparse-provider counterexample challenges the old offset and key-cursor rule. The callback fold separately detects duplicate inserts that a final-key check would miss. |
| ORC-012 | This record names the original review head, the later baseline, finite histories, and the exact fresh mutant outcomes. |
| ORC-013 | Full-state and skip-filtering cases reach the pass-through premise; filtering is the neighboring control. Delete/reinsert and new-insert histories distinguish release from permanent reservation. The high-cursor request assertion rejects a plausible finite overfetch even when the three- and seven-row public results would pass. |
| ORC-014 | Controlled adapters supply replay timing and offset or key-cursor pages. Their three- and seven-row results demonstrate the Collection boundary but do not prove every real provider's pagination behavior. |

Open scope: rank ties, other predicates, arbitrary and changing provider result
sets, provider-specific cursors, and compiled live-query windows remain with
the owners named in the coverage map. These controlled providers and
bounded histories do not prove every possible source schedule.
