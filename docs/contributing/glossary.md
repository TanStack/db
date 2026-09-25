# Project glossary

Use one term for one concept across production code, models, tests, and design
documents. Do not rotate synonyms for style. Shared words let a reader move
between the contract, the model, and the implementation without translating.

This glossary owns terms that cross subsystem boundaries. A subsystem may add
narrower terms in its architecture document. It must not redefine a term here.
When an independent model needs a different abstraction, state the mapping next
to the model.

Aligned vocabulary does not mean copied logic. A reference model should not use
production queues, caches, or semantic helpers merely to share their names.

## Runtime terms

| Term | Meaning | Do not use as a synonym |
| --- | --- | --- |
| Collection | The public keyed data container. Capitalize it when referring to the TanStack DB type. | Relation, table, or query result. |
| source Collection | A Collection read by a query or adapter. | Source relation when the value is a public Collection. |
| live-query Collection | A Collection whose rows are produced by a live query. | Query, observer, or result set. |
| relation | An internal weighted multiset maintained by D2. | Collection. |
| row | One keyed public Collection value or one relation value. Qualify source row, relation row, or public row when more than one kind appears. | Event or transaction. |
| change message | One insert, update, or delete delivered through the Collection sync boundary. | Transaction or publication. |
| sync transaction | The changes between one `begin()` and `commit()` pair. | Optimistic transaction or publication. |
| optimistic transaction | A local mutation transaction whose intent may later complete or roll back. | Sync transaction. |
| Collection status | One public Collection lifecycle value: `idle`, `loading`, `ready`, `error`, or `cleaned-up`. | Subscription status. |
| subscription status | One subscription value: `ready` or `loadingSubset`. | Collection status. |
| subscription | A consumer of Collection changes with its own subset demands and lifecycle. | Collection, query, or transport. |
| sync adapter | The code supplied through Collection sync configuration that starts a sync run and translates between TanStack DB and a provider. | Provider or source Collection. |
| provider | The external database, service, or SDK from which a sync adapter acquires data. | Sync adapter or source Collection. |
| sync run | One invocation of a Collection's sync function, plus the callbacks and resources installed by that invocation, until cleanup invalidates them. A run may own zero or more provider requests and may outlive any one request. Component-owned `syncRunGeneration` counters fence this lifetime in Collection state, sync ownership, and live-query graph work. | Provider session, replay, generation, or request. |
| provider session | A provider-defined remote stream, connection, or SDK lifetime. Always qualify it with the provider. | Sync run. |
| cleanup | The transition that ends the current sync run and releases its resources. Callback invalidation and local teardown begin synchronously. The public cleanup promise and final `cleaned-up` status settle after adapter cleanup settles. The Collection object remains available for cleanup or restart. | Collection destruction, restart, or replay. |
| restart | Starting a new sync run after the prior sync run has ended. | Same-run recovery or replay. |
| truncate replay | An authoritative source replacement after a truncate, inside the current sync run. The Collection subscription remains active; any dependent live-query graph remains active behind its publication barrier. | Restart, reload, retry, or repair. |
| source snapshot | The source rows established by one snapshot operation within its declared predicate and window. It proves full-source state only when the provider says that scope is authoritative and exhausted. | Public snapshot or proof of full-source coverage. |
| public snapshot | The last coherent set of rows exposed to reads, events, and downstream queries. | Private replacement or source snapshot. |
| private replacement | Source or graph state withheld while an authoritative replay or repair is incomplete. | Public snapshot. |
| publication | The boundary that makes one coherent result observable to reads, events, and downstream queries. | Provider return, request settlement, or sync commit by itself. |
| atomic publication | One publication boundary at which state, events, and consumers observe the same result without an intermediate public state. | Any individual `commit()` call or source snapshot. |
| readiness | Evidence that a named consumer may proceed. Always qualify Collection readiness, subscription readiness, or initial-query readiness; they settle at different boundaries. | Provider completion or publication in general. |

`source` names a role in a data flow; it does not own a lifecycle. Do not coin a
`source session`. Use `sync run` for the local Collection sync invocation
and a provider-qualified `provider session` for a remote lifecycle.

## Demand and pagination terms

These terms form a graph, not a one-to-one pipeline. Keep the ownership, work,
evidence, and visibility boundaries visible:

```text
logical subset owner --retains--> demand
demand --starts or replaces--> 0..n acquisition attempts
accepted attempt --establishes--> physical acquisition + acquisition lease
physical acquisition --may drive--> 0..n sync transactions
commit(sync transaction) --returns--> applied receipt
acquisitions + receipts + graph work --may gate--> publication
publication --advances or replaces--> public snapshot
```

One demand may need several acquisitions. One acquisition may write through
several sync transactions. One publication may wait for several acquisitions,
receipts, or graph participants. Do not infer success or visibility from an
earlier node alone.

| Term | Meaning | Do not use as a synonym |
| --- | --- | --- |
| demand | The logical need for source data. Demand may outlive or replace physical work. | Request, transport, or row ownership. |
| logical subset owner | One subscription claim that keeps a subset demand active. | Physical acquisition. |
| request data | The immutable `LoadSubsetOptions` and attached signal passed to an adapter. | Demand or established coverage. |
| acquisition attempt | One invocation that asks a sync adapter to start physical work. A synchronous throw ends the attempt before acceptance. If cleanup invalidates the captured sync run after the adapter returns but before activation, core cancels the tentative acquisition without retaining its lease; cleanup owns the adapter resources. | Physical acquisition or transport. |
| physical acquisition | Request-scoped work accepted by a sync adapter for a demand. | Acquisition attempt, logical demand, or transport. |
| lease | An ownership token that requires a matching release. TanStack DB leases do not expire on a timer. Always qualify which resource the lease owns. | Demand, request, or data coverage. |
| acquisition lease | The release obligation created when an adapter accepts a physical acquisition. | The acquisition attempt itself. |
| window lease | One window-controller caller's contribution to the requested window. | Acquisition lease. |
| observer lease | One Query DB owner's claim that retains a query observer or its rows. | Subscription or acquisition lease. |
| demand retirement | Removing one logical owner's claim on demand. | Acquisition release or row deletion. |
| acquisition release | Fulfilling one acquisition lease by aborting its signal and giving the owning adapter one unload opportunity. | Demand retirement, guaranteed transport cancellation, or row deletion. |
| adapter unload | The adapter callback invoked during acquisition release. | Demand retirement or proof that transport stopped. |
| abort | A cancellation signal sent to work that may still be in flight. | Release, rollback, or guaranteed transport cancellation. |
| transport | Provider work such as an HTTP request or stream. A transport may be shared, may outlive abort, and need not map one-to-one to a physical acquisition. | Acquisition attempt or demand. |
| settlement | A promise becoming fulfilled or rejected. Qualify what settled. | Success, application, or publication. |
| applied receipt | The `SyncAppliedReceipt` returned by `commit()`. It settles when that sync transaction's writes and events become visible, or rejects if they are abandoned. | Provider completion or source exhaustion. |
| applied settlement | The law that a successful subset load waits for every applied receipt that establishes its result. | Publication of a larger graph result. |
| window | The requested ordered view described by offset and limit. | Loaded prefix or established source extent. |
| prefix | Source rows from the start of one declared order through a finite boundary. | Page, window, or proof of exhaustion. |
| cursor | Values and expressions that continue an ordered request from a boundary. | Offset or general request identity. |
| boundary | The last value that an ordered acquisition has safely established for continuation. | Any last local row. |
| tie group | Rows equal under the order terms used by a continuation boundary. | Page. |
| source exhaustion | Authoritative evidence that no more matching source rows exist. | A short response unless the provider says it is authoritative. |
| generation | A monotonic token used to reject obsolete asynchronous work. Qualify the clock it fences, such as sync-run, replay, ordered-load, window-operation, cursor-sequence, post-write-refetch, or demand generation. | Session, replay, or request. |
| repair | Work that tries to restore an authoritative source result after finite coverage becomes invalid or an acquisition fails. Repair may use a replay, but the terms are not synonyms. | Retry, replay, or restart. |
| recovery | Regaining a named capability after failure. Always qualify what recovered and whether it stayed in the same sync run. | Restart or repair in general. |

## Live-query materialization terms

The live-query architecture defines the full laws and local vocabulary. These
cross-file terms keep their exact meanings:

| Term | Meaning |
| --- | --- |
| data plane | The D2 graph that joins, reduces, orders, and materializes relations. |
| demand plane | The asynchronous adapter that starts acquisition attempts and releases acquisition leases. |
| bucket key | The canonical identity of one correlated child partition. |
| active bucket | A bucket referenced by at least one current route. |
| route relation | Weighted links from bucket keys to materialization cells. |
| materialization cell | One include field on one parent-row occurrence. |
| Collection facade | The stable public Collection shared by parents routed to one active bucket. |
| weighted delta | A positive or negative change to a relation row. |

See
[`packages/db/src/query/live/ARCHITECTURE.md`](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/ARCHITECTURE.md)
for bucket relations, bucket values, arrangements, reductions, and the normative
materialization laws.

## Oracle and model terms

| Term | Meaning |
| --- | --- |
| contract or law | The promised behavior and its declared boundary. |
| oracle | The rule or mechanism that judges production behavior. |
| reference model | A simpler, independent computation or state machine used as an oracle. |
| history | Starting conditions plus a sequence of actions or events, including relevant dependencies and timing. |
| history grammar | The values, actions, constraints, and schedules that can form legal histories. |
| production driver | Test code that invokes the real entry point and controls relevant external events. |
| observation | One recorded public fact. |
| trace | An ordered sequence of observations. |
| checkpoint or observation cut | The exact point where the contract requires comparison. |
| oracle replay | Re-running a recorded oracle failure from its seed, shrink path, actions, or other replay inputs. Do not use it for runtime truncate replay, retry, or a new random campaign. |
| projection or abstraction | The parts of concrete state retained for one judgment. |
| refinement check | An executable comparison at a named checkpoint that accepts only production observations allowed by the model. A sampled check is not a proof for every behavior. |
| partial oracle | An oracle that judges only named parts of the contract. |
| reach witness | Evidence that the production driver reached the claimed boundary. |
| versioned review record | Review evidence stored at a stable location with the exact reviewed head and append-only entries, so later edits cannot silently change the recorded verdict. |
| mutant | A deliberate wrong answer or implementation used to test oracle sensitivity. |
| fault injection | A deliberate runtime failure, delay, cancellation, or malformed response used to test a system boundary. |
| shrinking | Reducing a failing generated history while preserving the failure. |
| bounded exhaustiveness | Executing every case inside stated finite bounds. |
| held-out challenge | A challenge not used to shape the tested design. After it guides a change, retain it but stop calling it held out. |

## Grammar rules

Use nouns for state and verbs for transitions:

- A demand **becomes active** or **retires**.
- Core **starts an acquisition attempt**. If the adapter accepts it, the attempt
  **establishes a physical acquisition** and its **acquisition lease**. A
  synchronous throw **fails the attempt** before either is established. Cleanup
  may instead invalidate a returned attempt before activation; core then
  **cancels the tentative acquisition** without retaining its lease.
- A logical owner **retires**. Core **releases an acquisition lease**. The
  adapter **unloads** its acquisition.
- An abort signal **requests cancellation**; transport **stops** only when the
  provider does so.
- A promise **settles**; it **fulfills** or **rejects**.
- A sync transaction **applies** when its writes and events become visible.
- A replay or repair **publishes** one coherent public snapshot.
- Cleanup **ends** a sync run. Restart **starts** a new sync run.
- Truncate replay **replaces** source state inside the current sync run and
  any current dependent graph.

Use `settled` for a promise that fulfilled or rejected. Use `complete` for named
coverage, content, history, or a non-promise operation only when no stronger
boundary term applies. Use `success` only for fulfillment. Qualify overloaded words such as `state`,
`request`, `snapshot`, `session`, `owner`, `release`, `recovery`, and
`generation` at first use.

## Model alignment rule

For every model state, action, and observation, apply one of these rules:

1. If it represents a production concept, use the canonical production term.
2. If it combines production concepts, name the abstraction and list what it
   combines.
3. If it splits one production concept, qualify each part and state the split.
4. If it exists only in the model, say so. Do not give it a production name.

The same check applies in reverse. New production terminology should update
this glossary and every model that represents that concept in the same change.
