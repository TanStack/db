# Separate draft input view spike

Status: **contract gate still open; not in production**. This follows the
[row-read snapshot experiment](facade-snapshot-spike.md). The
[candidate patch](facade-draft-view-spike.patch) applies to production at
`329b8f74`. Production was restored after the trial; all new tests remain in
`includes-functional-projection-oracle.test.ts`. No push.

## Candidate

Keep the real Collection and its indexes untouched while evaluating the
projection. A separate proxy reads shallow row Maps composed from the current
public rows and the adapter's pending deltas. It does not instantiate another
Collection or graph. The same D2 continuation/reducer from the earlier trial
runs the callback before downstream operators and retains prior outputs for
retractions. At successful publication the proxy forwards reads to the real
Collection. Old proxies do not switch back to draft mode on a later turn.

The first implementation proxied the entire Collection. D2 then traversed
its cyclic internals; the run was **118/35** (32 hash-budget failures and three
wrong-error assertions). A small shell with the Collection prototype, id and
config avoids that traversal. It does not establish that every Collection API
works on the draft view.

Plain-record/array outputs are converted to real public handles at the existing
publication walk. That happens after downstream graph work, not immediately
after the callback. The walk deliberately does not descend into class
instances or invoke getters. It therefore cannot replace the handle held in
an arbitrary closure. The proxy still forwards live reads after publication.

## Evidence

| Candidate/report | Passing | Failing | What it includes |
| --- | ---: | ---: | --- |
| `v1` | 118 | 35 | Original 153 tests, full-Collection proxy |
| `v2` | 153 | 3 | Small shell plus three new identity probes |
| `v3` | 155 | 2 | Public-handle conversion plus expression control |
| `final` | 155 | 2 | Formatted final candidate and four identity cells |
| `adjacent` | 370 | 0 | Eleven adjacent includes/facade/functional suites |
| `baseline` | 130 | 27 | Expanded oracle after removing candidate production |

Reports are `/tmp/tanstack-facade-draft-view-<name>.json`; all six have zero
skipped tests. The intermediate focused `identity` report was run before the
small-shell repair and is not the final identity result. Local reports are
temporary evidence, not committed bundles.

All 153 previously present tests pass on the final candidate, including the
three failure-isolation probes from the first spike. The four new tests use
two parents sharing one child route, change only one parent's label, then
insert another child. They cross expression selection with functional
selection returning a plain holder, class holder, or getter closing over the
exact captured handle. The assertions independently check:

- initial child rows and shared handle identity;
- visible parent-label update;
- both parents still using the original shared handle;
- retained and current handles all seeing the later child insert.

Expression and plain-holder cells pass. The class and captured-handle getter
cells fail only the updated parent's `toBe(held)` assertion. Their initial
sharing, unchanged-parent identity, and later live row reads pass. These are
two cells exposing one reference-identity boundary, not two data-loss bugs.

The restored baseline passes the expression control. Its three added
functional cells stop on a null child's `toArray` before the later identity
checks. The other 153 tests retain their prior **129/24** result. Therefore the
baseline does not reproduce these two later identity mismatches; the candidate
allows the tests to reach that phase.

## Size and limits

Candidate executable source: **274 added / 47 removed = +227 net lines**,
including the new 82-line continuation module. This is 48 more lines than the
previous +179 candidate, not a saving. Old deferred machinery remains. No
bundle, memory, or performance benchmark; no production increase retained.

The candidate package type check exits 2, with no diagnostics for its four
source files or the expanded projection test. Source lint reported two
condition errors in the builder and two shadow warnings; the shadow names
were corrected before archiving. No full source-lint pass is claimed. Final
test ESLint and Prettier pass. Raw types: `/tmp/tanstack-facade-draft-view-types.txt`.

The candidate is not ready merely because rows are correct in these traces.
Full draft Collection APIs, virtual row properties, indexes created from draft
inputs, new subscriptions, nested async staging, failure-captured views,
retirement, retained-closure memory, and graph cleanup still need validation.
Pending Map reads rebuild shallow snapshots and may sort them repeatedly.
The 940-cell lifecycle rerun and 100x campaign remain queued behind the gate.

## Decision needed

The existing architecture requires one stable public facade per active bucket.
It does not authorize silently weakening identity for class/closure results.
The current trial preserves that law for ordinary record output, but returns
distinct live views when handles are hidden from the publication walk.

Choose the intended contract before growing the implementation: must those
hidden handles retain `===` identity too, or may they be live views? Either
answer still requires testing the other draft APIs and lifecycle boundaries;
accepting a view is not approval to ship the candidate or suppress other tests.
No claim is made that a more complete implementation is impossible.
