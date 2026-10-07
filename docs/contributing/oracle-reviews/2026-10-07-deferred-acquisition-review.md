# Deferred acquisition review, 2026-10-07

Scope: PR #2060 (`issue-2023-network-on-subscriber`) at `19588268c`, reviewed by
an external high-effort code review. The repair commit that adds this record
sits on top of that revision. Owner:
`packages/db/tests/live-query-deferred-acquisition-oracle.test.ts`.

## Law

Normative law 15 in `packages/db/src/query/live/ARCHITECTURE.md`. Authority:
the maintainer's decision that a live query starts no network work until it
has a subscriber or a preload, with preload counting and eager sources
included. This review sharpened the formulation: the subscriber must ask for
data, a subscriber that survives cleanup still counts, and a read that waits
for readiness counts as a preload.

## Findings and evidence

| Finding | Kind | Evidence | Outcome |
| --- | --- | --- | --- |
| A source status change restarts deferred demand | Defect | New `peer` command: a peer that starts an idle on-demand source made the live query acquire, 4 cases RED at the acquisition-count assertion | Guard in `restartDetachedDemands`; removing it alone fails the same 4 |
| A truncate reloads deferred demand | Defect | New `truncate` command: 8 cases RED at the acquisition-count assertion | Guard in `handleTruncate`; removing it alone fails the same 8 |
| Cleanup resets the flag while an acquiring subscriber survives | Defect and formulation | Pinned block: 4 on-demand cases RED, no acquisition after restart, status stuck at `loading` | Cleanup keeps the flag when a surviving subscription does not defer. "Always reset" fails the block; "any surviving subscriber" fails the deferring-survivor control |
| A deferring subscription raises the source's subscriber count | Concept question | A Query Collection probe: the count went 0 to 1, but no refetch happened | No change; harm not reproduced. Whether `subscriberCount` should count deferring subscriptions stays open |
| A resume that throws leaves later sources deferred | Mechanism confirmed | Probe: the subscribe throws the first source's error, the live query enters `error`, and the second source stays idle | No change. The live query has already failed, the deferral is per subscription so another reader starts the source itself, and the remaining trigger is a throwing listener, a contract breach |
| `toArrayWhenReady()` / `stateWhenReady()` never resume | Defect | Pinned block: 2 cases RED, no acquisition after the read | The early-return branch marks a preload |
| The first commit is loading under the async resume | Accepted design | Maintainer decision: loading first unless the collection is preloaded | No change |
| The changeset is `patch` | Accepted design | Maintainer decision | No change |
| A stale comment promises a ready first commit | Maintainability | Source inspection, React and Svelte | Comments rewritten |
| The deferral expression is duplicated | Maintainability | Source inspection | One helper |

`preloaded-collection-first-paint` previously rejected the "preload does not
count" mutant only by timing out. It now bounds the preload, and the mutant
fails the assertion `the preload settles` in React, Vue, and Svelte.

The mutants above were designed after reading the tests, so they are a
self-review of this author's coverage, not an independent mutant gap hunt.
