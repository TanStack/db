# Authority coordinator v2: implementation contract

This revision keeps v1's operation knowledge, persistent coverage, read admission, lifecycle and conservative reconciliation rules. It repairs the observation contract using the fresh audit's actual-source traces. V1 and its freeze remain unchanged.

## Publication and event history

Synchronous row state is installed for the whole affected collection set before change callbacks run. A callback may synchronously start another action; that action installs its whole fanout before returning its real Transaction. Reentrant source notifications enter a FIFO owned by the outer publication context, after notifications already queued for the previous change. Every subscriber therefore receives old changes before new ones. After all source delivery and graph work drains, dependent queries agree with the final source state.

An event is a historical change, not a snapshot accessor. If an earlier subscriber has made another action, a later subscriber can receive the older event while reading the complete newer state. V1's stronger equality of event payload and direct current reads under reentry was impossible with synchronous reentrant mutation. This revision does not weaken the requirement that current collections remain mutually coherent or that event consumers converge. Both causal event order and current cross-collection reads are separate test laws.

The publication boundary must cover ordinary public `Transaction.rollback()` and its pending-manual cascade, not only coordinator settlement. Core gets a synchronous internal settlement helper shared by normal commit and coordinated acknowledgement. Core's existing publication scheduler gets ordered source notification delivery; runtime gets an internal DbClient batch entry point. No alternate public collection or transaction type is introduced. No mutation request waits for a prior mutation request.

## Read admission and lifetime

An adapter result application captures a cancellation permit at observer delivery and combines it with the adapter's commit signal. Runtime invalidates permits and cancels Query requests before an action begins and before authoritative installation. Cancellation is not remote handler closure. Manual writes keep Query cache data aligned with the installed baseline. Tests must cross fetch-start/cancel success notifications, queued applications, structural sharing, and retired actions; observer-time admission alone is not a proof.

An endpoint ordinary read joins a coordinator-owned raw read, whose coverage check precedes immediate authoritative installation. The query function then returns the currently installed rows as the adapter/cache mirror. All raw reads have one retry owner (three retries at 1/2/4 seconds), including overlap repair. Waiting for a coordinator read never preloads a collection inside persistence. Initial sync registers before demand; cleanup invalidates its lifetime and removes cached rows so restart cannot seed readiness from the old lifetime. On restart the same Collection object has a new logical lifetime.

## Explicit bounds

- The existing nonempty optimistic-target requirement remains. A no-op authored callback is rejected before remote dispatch; DB automatically completes an empty transaction without calling its mutation function. Server-only/no-op optimistic actions require a later dispatch contract, not a fake row write.
- Unknown transport outcomes remain explicit unresolved errors; neither rollback, a read, nor reload is closure evidence. Durable server status lookup is not implemented in this slice.
- The overlap fallback may issue one raw read request per retained collection. Isolated actions keep inline authoritative results. Wire measurements must distinguish these paths.
- Manually pending DB transactions retain DB's documented conflict cascade. Other persisting Endpoint actions retain their owned whole-row snapshots.

Red tests now reproduce stale ordinary reads after retirement, early settlement of overlapping actions, torn optimistic fanout, forbidden late creation, and reentrant event inversion in the current implementation. Further lifecycle/rollback/error and generated full-stack schedules remain required before reporting completion.
