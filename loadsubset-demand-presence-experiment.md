# D2 demand-presence experiment

Baseline: dd853850, codex/loadsubset-minimal-stack. Scope: replace only the
compiler/joins.ts demandWeights tap with equality-key mapping, D2 distinct,
and a current-demand-values map. Do not change SubsetDemandController.
Candidate is preserved in loadsubset-demand-presence-experiment.patch; it is
not applied. Production joins.ts is restored byte-for-byte to baseline.

## Measured boundary result

Eleven compiler controls use real compileQuery and D2 inputs. The six timing
cells cross left/right active sources with a single message, queued messages
in one graph run, and separate graph runs. Each starts with one active key,
then retracts and re-adds its contributor. Four further cells retain one demand
until both equal-valued contributors leave: numbers, signed zero, Date values,
and Buffer/Uint8Array bytes. The last control checks nullish exclusion and the
full-join no-lazy-demand path. Output multiplicity is checked in the timing and
equal-contributor cases; these are not full result-shape or adapter tests.

| Delivery of retract/re-add | Baseline demand transitions | D2 candidate |
| --- | --- | --- |
| One message | No change | No change |
| Two queued messages, one graph run | Empty, then original key | No change |
| Separate graph runs | Empty, then original key | Empty, then original key |

Baseline11/0, candidate9/2, restored11/0. Both candidate failures are the queued-
message cells, one per join direction. Evidence:

- /tmp/tanstack-demand-presence-baseline-final.json
- /tmp/tanstack-demand-presence-d2.json
- /tmp/tanstack-demand-presence-restored.json

The first fixture draft reset its trace and inadvertently forgot the previous
demand. That hid empty transitions. The corrected fixture keeps observer state
separate from trace history and ignores only unchanged notifications. The first
draft's7/4 is a fixture failure, not a production finding; preserved at
/tmp/tanstack-demand-presence-baseline.json. CollectionRef fixture typing was
also corrected; final package type-check passes.

## Mechanism and scope

TapOperator inherits LinearUnaryOperator.run, which calls its callback for
each input message. DistinctOperator.run drains all queued messages before
emitting positive-presence changes. The extra map and filter do not restore
the intermediate zero. The existing SubsetDemandController.setDemand aborts
and releases a segment when demand becomes empty; suppressing that transition
therefore changes the downstream ownership input. This release consequence
is source-traced, not a measured physical adapter trace in this experiment.

There is another unmeasured boundary: unchanged-key callbacks can retry failed
segments in SubsetDemandController. A presence-only stream suppresses those
notifications too. Do not treat the fixture's removal of redundant key-set
notifications as proof that those callbacks have no runtime purpose.

The early timing gate failed. Per the approved plan, stop before accepting a
new timing policy. No full candidate suite, 100x campaign, Effects/query parity,
synchronous adapter-write/reentry matrix, opaque reference-key product or
physical release/cancellation campaign was run. This is not a claim that D2
cannot implement the contract, or that turn-batched demand is incorrect. It
shows this existing distinct operator is not a behavior-preserving replacement.

## Cost

Candidate patch:14 added/26 removed production lines, net-12. Diagnostic bundle
uses esbuild0.20.2, packages external, ESM/es2022, minify; same Node24.5.0 and
zlib1.2.12 compression invocation:

| | Minified bytes | Gzip bytes |
| --- | ---: | ---: |
| Baseline /tmp/tanstack-integration-builder.mjs | 368584 | 103816 |
| Candidate /tmp/tanstack-demand-presence-d2.mjs | 368497 | 103791 |
| Difference | -87 | -25 |

The candidate replaces one tap with filter/map/distinct/tap: three additional
operators on an eligible lazy join, none on the unchanged full-join path.
Baseline keeps one weight/value map. Candidate keeps distinct's multiplicity
map plus the boundary's current-value map, with a temporary updated-values map
inside distinct.run. Both are bounded by keys, not event history. These are
source counts, not measured heap bytes or a throughput result; two maps do not
prove twice the memory. The diagnostic side-effect import warning remains.

## Checkpoint

Production unchanged. Keep the small existing counter under the current timing
contract; any turn-batched design requires a separate user decision and the
unrun boundary controls above. New compiler controls remain as characterization
tests, not a claim that this policy can never be changed. Targeted validation
and fresh post-commit loss audit are recorded in the refactor plan.
