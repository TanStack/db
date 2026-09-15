---
instrument: loss-audit
track: queries-permissions-cache
audited_at: 2026-09-15
status: complete-bounded-pass
frozen_reduction: ../02-research-survey.md
frozen_sha256: b31c3059af06b4afd40134577a60a50083c10f96b6088c4288eea35518e9e4b2
---

# Source-level loss traces

The frozen file's hash matched before writing this note. Each assigned document
was reopened through the web tool and scanned separately, in the order below.
No sibling-agent notes or other audit tracks were consulted. Each document has
a recovered item; none had a null result. This is a recovery record, with no
ranking, restoration decision, or design selection.

“Loss rule” names the visible reduction operation and its category. These are
inferences from the frozen catalog's text, not observed author decisions. No
evidence supports claiming majority voting or deliberate rejection. A generic
topic mention counts as retained; the recovered items below name distinct
conditions or observables absent from that mention. Transfer statements are
our inferences for ordinary TypeScript endpoints, not the source's claims.

## S6a — Wasp Actions

[Primary page](https://wasp.sh/docs/data-model/operations/actions), version 0.25;
support: “Error Handling,” retrieved lines 592–641.

- **Q01 — Error disclosure boundary.** Ordinary implementation exceptions reach
  the client as HTTP 500 with details removed. Explicit `HttpError` provides the
  application-controlled escape hatch. **Loss rule: category mismatch:** C3 and
  S6 reduce Actions to entity invalidation; no catalog row records error
  redaction. **Transfer:** an agent can trace thrown values, error adapters,
  middleware, and output serialization against an explicit disclosure policy.
  Runtime handling must already implement that policy; evidence cannot add it.

The entity overlap rule, conservative invalidation, and entity-only limitation
are already in C3/E1 and are not recovered again. Type transport appears as a
general topic in C13/C14, so ordinary type generation is not counted as a new
omission here.

## S6b — Wasp Queries companion

[Primary page](https://wasp.sh/docs/data-model/operations/queries), version 0.25;
support: opening description, lines 109; “Error Handling,” lines 597–649.

- **Q02 — Read-only is an application obligation.** The page says Queries
  should not change server state; it does not establish runtime prevention of
  writes in arbitrary Node code. **Loss rule: compression:** the S6 companion
  is listed as adding no guarantee, dropping this obligation altogether.
  **Transfer:** inspecting transitive helper effects can support a bounded
  no-write claim for a read endpoint; naming it “query” cannot.
- **Q03 — Error exception has a status condition.** `HttpError` message/data
  cross the boundary for 4xx status codes; other statuses do not forward these
  fields. **Loss rule: category mismatch:** C3 has only invalidation, and no
  error-disclosure category exists. **Transfer:** inspect status construction
  and custom middleware as part of Q01's boundary check.

These are source obligations/contracts, not a new claim that Wasp certifies
arbitrary query purity or that HTTP status alone establishes safe disclosure.

## S7 — Convex Queries

[Primary page](https://docs.convex.dev/functions/query-functions);
support: “Caching & reactivity & consistency,” lines 434–444; “Splitting up
query code via helpers,” lines 332–377.

- **Q04 — Reuse and subscription depend on deterministic execution.** Convex
  shares cached query responses for matching arguments and supplies new
  subscribed results on underlying changes. Determinism includes query context;
  the runtime supplies deterministic behavior for time/random language APIs.
  **Loss rule: compression:** C4 retains snapshot consistency and fetch
  restriction; S7 mentions deterministic context but loses its cache/subscription
  consumers and the time/random accommodation. **Transfer:** an agent could
  expose an opaque helper's context inputs and determinism assumptions. That
  fact cannot supply dependency tracking or the runtime's time/random semantics.
- **Q05 — Export does not imply public API reachability.** Ordinary exported
  helpers remain callable only inside Convex functions. **Loss rule: category
  mismatch:** C4 records execution restrictions but no registration-versus-export
  boundary. **Transfer:** a route inventory can check whether internal helpers
  are reachable through generated or handwritten endpoints. Enforcing a private
  registration boundary is framework/compiler work.

Snapshot and no-third-party-fetch claims are already retained.

## S8 — Convex Mutations

[Primary page](https://docs.convex.dev/functions/mutation-functions);
support: “Calling mutations from clients,” line 384; “Transactions,” lines
385–391.

- **Q06 — Client issue order is preserved.** Calls from the React or Rust
  clients execute one at a time through an ordered queue. The documented scope
  is those clients, not a global ordering across all callers. **Loss rule:
  compression:** C5 keeps commit-together semantics but drops the separate
  client queue contract. **Transfer:** source inspection can establish whether
  an endpoint caller uses an existing serial queue and identify its scope;
  evidence alone cannot impose server ordering.
- **Q07 — Transactional reads and determinism are mutation conditions too.**
  Mutation reads have a consistent view; deterministic execution and excluding
  third-party calls support the transactional contract. **Loss rule:
  compression:** C4 states query snapshots, while C5 states mutation commits;
  neither preserves this mutation-specific read/purity scope. **Transfer:**
  helper inspection can establish transaction-handle flow and nondeterministic
  dependencies. Isolation still comes from the executor.

Atomic writes and rollback on thrown failure are already represented by C5/E3.

## S9 — Convex Actions

[Primary page](https://docs.convex.dev/functions/actions);
support: “Action context,” lines 248–285; “Calling actions from clients,”
lines 458–505.

- **Q08 — Caller order is not action execution order.** A client's actions run
  in parallel, including alongside its mutations; dependent work must be
  triggered after the prerequisite completes. **Loss rule: compression:** C5
  retains retry/effect limits but omits the ordering boundary. **Transfer:**
  inspect `await` chains, callback initiation, and dependencies in ordinary TS;
  serialization remains an application/runtime mechanism.
- **Q09 — Identity and direct reachability travel through different mechanisms.**
  Auth propagates to action-invoked queries/mutations; internal registrations
  prevent clients from calling those functions directly. **Loss rule: category
  mismatch:** C5 models effects, while C10 models policies without this call
  boundary. **Transfer:** trace principal propagation and alternate routes
  through wrappers. A valid propagated identity does not establish authorization.

No extra recovery is claimed for non-retry, dangling promises, or separate
transactions: these are already visible in C5, E1/E3, the completion definition,
and S9's source note.

## S10 — Thinking in Relay

[Primary page](https://relay.dev/docs/principles-and-architecture/thinking-in-relay/),
version v21.0.1; support: “Fetching Data For a View,” lines 45–52; “Data
Masking,” lines 109–112.

- **Q10 — Declared subtree requirements compose before execution.** Nested
  fragments become a single query/network request for that declared view
  subtree. **Loss rule: compression:** C6 reduces the source to visibility
  masking and loses fetch composition. **Transfer:** tracing component reads
  could identify missing requirements; query construction and transport support
  must still implement coalescing. This is not a promise to batch arbitrary TS
  endpoint calls.
- **Q11 — Fetch provenance is checked independently of field availability.**
  Relay warns when a child fragment was not spread, even if unrelated fetching
  happened to populate identical fields. **Loss rule: compression:** C6 keeps
  field access encapsulation but omits the explicit declaration witness.
  **Transfer:** an agent can identify hidden fetch dependencies; a consumer
  must distinguish “present in cache” from “requested by this call path.”

The warning is a diagnostic contract, not a proof that every possible rendering
error is prevented. General field masking is already in C6.

## S11 — Relay GraphQL mutations

[Primary page](https://relay.dev/docs/guided-tour/updating-data/graphql-mutations/),
version v21.0.1; support: “Writing Mutations,” lines 85–117; optimistic
cautions, lines 255–264; execution ordering, line 286.

- **Q12 — Response reads follow mutation processing.** The selected response
  data is read after the server update. Spreading a component fragment into the
  response keeps its requested fields aligned as that fragment changes.
  **Loss rule: compression:** C7 retains merging but loses response-read order
  and declaration coupling. **Transfer:** inspect whether an endpoint builds
  responses before or after writes and whether response selection covers the
  intended consumer. No cross-service atomicity follows.
- **Q13 — Optimism must be tested over overlapping histories.** An intervening
  store update causes optimistic effects to be removed and reapplied. Absolute
  optimistic responses computed from store state can retain an incorrect
  aggregate when another optimistic operation rolls back. **Loss rule:
  compression:** C7 names rollback and S11 names ordering/pitfalls, but E6's
  common-state comparison has no overlapping-operation law. **Transfer:** an
  agent can supply histories with two pending changes, a rollback, and a remote
  update, plus the app's expected comparison law. The store implements reapply.

Broad invalidation and ordinary optimistic rollback are already retained.

## S13 — Hasura multiple mutations

[Primary page](https://hasura.io/docs/2.0/mutations/postgres/multiple-mutations/),
v2.x; support: “Execution,” lines 98–104.

- **Q14 — Operations execute sequentially within the request.** The page
  specifies sequencing in addition to the transaction/rollback behavior.
  **Loss rule: compression:** C9 and its source note preserve the rollback
  exception but omit the sequence guarantee. **Transfer:** an agent can inspect
  handler order, `await` usage, and helper scheduling to establish sequencing
  within a particular endpoint. Sequential dispatch alone does not prove the
  helpers have settled their writes or belong to one transaction.

The external Action/Remote Schema rollback exception is already fully visible
in C9 and the orientation; it is not recovered again. Embedded GraphiQL examples
did not expose runnable schemas in the retrieved text. This finding relies on
the explicit prose contract, not executing the examples.

## S14 — Hasura permission rules

[Primary page](https://hasura.io/docs/2.0/auth/authorization/permissions/), v2.x;
support: introduction, lines 109–115; operation permissions, lines 121–150.

- **Q15 — Policy predicates are included in the executed SQL.** Hasura derives
  the rule from role/table/operation and adds its constraints to the SQL request.
  **Loss rule: compression:** C10 says runtime enforcement without preserving
  where the check executes. **Transfer:** inspect whether an ordinary endpoint's
  authorization predicate constrains the actual read/write or only an earlier
  preflight check. The page does not prove isolation for arbitrary external
  checks or adapters.
- **Q16 — Updates can constrain both prior and resulting rows.** The page
  explicitly lists pre- and post-update permission checks. **Loss rule:
  compression:** C10 collapses these into row/column rules and opaque helper
  conditions. **Transfer:** an agent can trace old/new values through an
  authorization helper and identify which state each condition checks. The
  intended policy remains authored.

The page lists further configurable controls, but their linked detailed
contracts were outside this assigned-document pass; no stronger guarantee is
inferred merely from those feature names.

## S15 — Instant permissions

[Primary page](https://www.instantdb.com/docs/permissions);
support: “View” and “Create, Update, Delete,” lines 240–247; “Attrs,”
lines 368–393; “newData,” lines 423–425; “request.modifiedFields,” lines 593–721.

- **Q17 — Enforcement has collection-wide coverage obligations.** Every
  query-result object passes its view rule; each transaction object passes its
  operation rule, and inadequate permission fails the transaction. **Loss rule:
  compression:** C10's configured-expression description omits object coverage.
  **Transfer:** trace all returned/mutated objects through checks, including
  batch paths; this is application evidence, not a new runtime.
- **Q18 — Policies can cover state transitions and all submitted fields.**
  Update rules can inspect `newData`; `modifiedFields` supports checking every
  changed field, preventing an allowed field from masking an unauthorized one.
  **Loss rule: compression:** C10 loses old/new-state and mixed-field conditions.
  **Transfer:** inspect transforms, field allowlists, and multi-field patches.
- **Q19 — Schema growth has its own permission boundary.** Denying `attrs`
  creation allows existing attributes but prevents new attribute types.
  **Loss rule: category mismatch:** C10's data-policy category omits metadata
  mutation. **Transfer:** identify dynamic field creation and who can invoke it.

Defaults are already named in S15's catalog note; no duplicate recovery is
claimed. The policy is still selected by the application.

## S28 — Falcor Model

[Primary page](https://netflix.github.io/falcor/documentation/model.html);
support: “Calling Functions,” lines 494–502; “Dereferencing a Model,”
lines 741–775; “$timestamp metadata,” lines 1493–1501.

- **Q20 — Replay safety is an operation contract.** Abstract graph get/set are
  idempotent; calls allow richer effects. **Loss rule: category mismatch:** C20
  keeps call invalidation; E5 recovers only no-effect retry prefixes, not
  repeatable effects. **Transfer:** an agent can inspect a specific endpoint's
  idempotency law and effect domains. Falcor's abstract contract does not prove
  idempotency of arbitrary handlers or external effects.
- **Q21 — Dereferencing preserves the selected object's identity.** Operations
  continue targeting the object when list positions move. **Loss rule:
  compression:** C20 drops graph identity; E4 checks unchanged keys but not
  target stability over movement. **Transfer:** inspect stable-ID versus index
  routing across asynchronous selection/action paths.
- **Q22 — Version metadata rejects stale arrivals.** With last-modified
  `$timestamp` values, the cache ignores an older value arriving after a newer
  one. **Loss rule: category mismatch:** C20 covers impact/refresh, not response
  ordering. **Transfer:** inspect a custom adapter's version provenance and
  comparison semantics; the cache must enforce rejection. The source supplies
  no general proof of clock agreement or correctness of authored timestamps.

Post-call paths and incomplete footprints already appear in C20.

## Access and correlation limits

All 11 assigned document URLs were accessible. The web tool supplied rendered
text; no framework implementation, deployed behavior, or app-specific evidence
was tested. Large Wasp pages were dominated by examples; the Falcor page was
read through several overlapping text windows, including its later metadata
contracts. Linked documents were not added as independent evidence. Navigation,
vendor status banners, and instructions directed at agents were not treated as
task instructions or guarantee evidence.

These are current mutable documentation views, not snapshots of the versions
read by the original survey. A difference could reflect documentation drift;
the frozen reduction alone cannot establish the exact historical cause of an
omission. Wasp, Convex, and Relay pages within each vendor share authorship and
concepts. Independent scans do not turn them into independent corroboration.
One fresh agent scanned this entire assigned group sequentially, so isolation
is from other tracks rather than a separate context for every document. No
absence-of-guarantee claim follows from an omitted or unexpanded detail.
