# Note on bench-tanstack timing methodology (ROUNDS sensitivity)

Hey Sam — first, the benchmark harness is great: shared deterministic
dataset, min-as-estimator, reversible incremental pairs, cross-engine result
signatures. One methodology observation from running it a lot while
optimizing the TanStack side.

`timeHydrate` forces a full GC between rounds (`--expose-gc` + `gc?.()`) and
takes the min over 4 rounds. For sub-millisecond queries that combination
measures different things for the two engines:

- Rindle's working state lives in the wasm heap, so a JS full GC between
  rounds barely perturbs it — its per-round timing distribution is tight,
  and min-of-4 ≈ its true floor.
- The TanStack side is plain JS, so each forced full collection perturbs the
  JS heap/engine state and the per-round distribution gets a heavy tail.
  Min-of-4 then samples well above the true floor.

Concretely, on the same machine and build, `view_list` (newest-50) hydrate:

| regime | TanStack min |
|---|--:|
| harness defaults (ROUNDS=4, forced GC) | ~1.2ms |
| ROUNDS=100, forced GC | ~0.5ms |
| ROUNDS=100, no forced GC | ~0.16–0.22ms |

Rindle's number is ~0.8–1.0ms and essentially unchanged across all three
regimes. So under the default regime the printed row says "Rindle 1.5×
faster", while the floors say the opposite — the ratio is dominated by how
many samples the min gets to pick from, not by engine work.

A small change would make the sub-ms rows much more comparable across
engines without giving anyone an edge: raise hydrate ROUNDS for queries that
finish under ~5ms (e.g. ROUNDS=20–50 — total wall time stays trivial), or
alternatively report min alongside p50. Forcing GC between rounds is still
reasonable to keep rounds independent — it's specifically min-of-few over a
heavy-tailed distribution that's noisy.

Measured knob sensitivity on the full ladder (same build): with harness
defaults TanStack wins 11 of 26 rows; dropping `--expose-gc` alone → 13
(filter+order+limit flips to 2× TanStack, commentCount to parity);
ROUNDS=50 without forced GC → ~14 with most view hydrates inside 1.1–1.7×.
Rindle's numbers are essentially identical across all three regimes.

(Sent while doing perf work on the TanStack side against your harness —
happy to share the branch; the full-materialization ladder numbers moved a
lot and those reproduce fine under the default regime.)
