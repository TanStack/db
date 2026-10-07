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

## Second review, at `c2fe18d21`

A medium code review raised ten findings. Each claim was probed on that
revision before any change.

| Finding | Kind | Evidence | Outcome |
| --- | --- | --- | --- |
| A deferring subscription raises the source's subscriber count, so a Query Collection refetches | Defect, open | With the reviewer's precondition (the last direct subscriber left first), a live query with `startSync: true` and no subscriber raised the count from 0 to 1 and the Query Collection fetched again. The first review's probe had no prior subscriber | Maintainer decision: they count only subscribers that ask for data, while garbage collection still counts every subscription. A pinned oracle block and a Query Collection test fail without the change; ten tests that read `subscriberCount` to watch an abandoned render or orphan hold its source now read the retention count instead |
| A resume that throws strands the other sources and makes `preload()` throw | Defect | Pinned block: `preload()` threw synchronously instead of returning a rejected promise | Listeners all run before the first error is rethrown; the preload entry points reject. Each half fails the block alone |
| A failed resume clears the subscription's deferring flag | Defect by source inspection | Observable only when the failing source is itself a live query that is later cleaned up; no runtime witness | The source starts before the flag clears |
| A truncate with retained stale rows stalls publication | Refuted at the precondition | Retained stale rows come only from source cleanup, which puts the dependent live query in terminal error first | No change |
| A cleaned-up Suspense collection gets no in-render preload | Pre-existing defect | The rerender showed no rows on this PR and on `main` | The in-render preload covers `cleaned-up`; the new React witness fails without it |
| The first-value helper accepts any not-ready value | Weak assertion | Source inspection | The not-ready value is now exact: `loading` when the hook started the collection, `idle` for a supplied window it adjusts first |
| `hasSubscriberOrPreload()` falls back to `true` | Refuted: reachable | A non-null assertion failed 8 scheduler tests that drive the builder without its Collection | Fallback kept, with a comment naming where it is reached |
| Pooled `preload()` leaves the partition deferring | Refuted at the precondition | The partition unsubscribes when its source's cleanup starts, so no survivor is miscounted | No change |
| The change manager special-cases live-query Collections | Design | Source inspection | No change; a config-level capability would add surface for one caller |
| A test comment is out of order | Maintainability | Source inspection | Fixed |
