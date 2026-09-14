# One full-stack oracle for Endpoints

Status: [initial implementation and findings](./integrated-todo/tests/oracles/README.md).
The [authority coordinator](./design/authority-coordinator/README.md) adds concurrent
full-stack sequences. The next [SQL/schema and on-demand coverage plan](./SQL-COVERAGE-PLAN.md)
separates that fixed-schema evidence from the PostgreSQL surface still to generate.
This replaces the previous proposal for four separate new oracle suites. The
sections below include future dimensions beyond the initial supported grammar.

## Objective

Exercise the whole path: authored endpoints → compilation → client collection →
optimistic mutation → server SQL → acknowledgement/update delivery → reconciled
collections and their consumers.

Correctness is defined by observable rows, order, transaction outcomes, and
optimistic behavior. It is independent of whether the implementation uses full
refetches, mutation-returned rows, partial updates, or selective invalidation.
This provides the foundation for testing those optimizations without making the
current full-refetch implementation the permanent specification.

## One scenario, two independent execution paths

A typed, shrinkable scenario describes:

- Schema and initial data, beginning with the supported Todo shape.
- Declared query endpoints: scope, selection, predicates, and ordering.
- Mutation endpoints: input validation, SQL effects, and optimistic intent.
- Client instances and active collections/consumers.
- A history of invocations and controlled server/read/response completions,
  including rejection and recovery.

The SUT renderer produces actual authored endpoint modules. Compile and run them
through the real Start transport, endpoint runtime, Query Collection, and DB
transactions, with the application server using its own PGlite database.

A separate reference renderer produces SQL directly from the scenario. It runs
in an isolated reference PGlite database. Never derive expected SQL, ordering,
optimistic intent, or affected-query selection from compiler output, production
metadata, collection contents, or the runtime's invalidation decisions.

Both paths share the declarative test specification, not its SQL/compiler logic.
Renderers should remain separate and small enough to review for shared mistakes.
A few hand-checked fixtures and deliberately broken implementations test that
independence. This tests generated framework behavior, not arbitrary correctness
of every handwritten business rule.

## Reference state and the governing law

For every active collection C, at every observable checkpoint:

```text
actual(C) = evaluate(query(C), referencePGWorld)
```

Every collection in the same client/scope is evaluated over the same coherent
reference world. There are no independent per-collection freshness baselines and
no allowance for one collection to remain stale until eventual convergence.
Client/scope isolation remains part of the query/world definition.

The reference world includes active optimistic effects. It is not literally the
application server database before an optimistic write has reached that server.
Keep independent confirmed server truth and optimistic intent history, then
materialize the resulting reference world in PGlite. Acceptance, rejection and
reconciliation advance that world according to explicit transaction semantics.
A server commit and a failed read remain distinct events; rollback of local
optimism does not undo a committed server write.

PGlite evaluates queries. A small explicit reference model determines optimistic
snapshot ownership and retirement, using the laws established by
[optimistic-history-oracle.ts](../../packages/db/tests/optimistic-history-oracle.ts).
Respect whole-row snapshots; don't substitute field patches over changing server
rows. Never derive expected state from actual delivered collection contents,
production invalidation decisions, or the set of queries the SUT chose to refresh.

This law applies during optimism too. An insertion that affects two active
queries must appear correctly in both at the same observable checkpoint, even
if the authored callback directly inserts into only one collection. The current
prototype may not yet provide that propagation; an oracle failure would expose
missing framework behavior rather than justify weakening the law.

For simple source-row optimism, a reference table holds the optimistic world.
Projected/derived writes need an explicit interpretation before extending the
generator; don't assume arbitrary queries are writable SQL views.

## Checkpoints and observable laws

Check at invocation, each controlled completion/publication boundary, rejection,
logical acknowledgement, and final quiescence. A checkpoint is an observable
framework publication boundary, not an arbitrary instruction inside an atomic
update. Keep intermediate checks as well as final rows: a transient disappearance can be a bug even if a later read heals it.

- The action returns its actual transaction synchronously; optimistic effects
  appear immediately, and independent actions remain callable.
- Every active collection and consumer agrees with the reference rows and order
  over that shared reference world at the boundary. Compare ordered sequences without sorting actual
  output to conceal ordering bugs.
- Settlement follows the required reconciliation contract. Do not require a
  particular refetch request once another strategy can provide equivalent
  acknowledgement and data.
- Rejected optimism is removed according to ownership rules; unrelated pending
  actions and newer input remain intact. Errors are observable and handled.
- Rebinding preserves endpoint identity within a client, uses current callbacks,
  and does not share collection state across distinct clients.
- Changing a local query changes its reference result without requiring server
  work merely for that local filter.
- Cleanup and failures leave no abandoned requests or detached rejections.

The runner knows all active queries from the generated scenario. It must not ask
the SUT which queries were affected and then check only that subset. At every observable checkpoint, recompute every active query independently
over the shared reference world. This is how missing invalidation becomes observable.

Do not assume last-click-wins or implicit serialization for same-row concurrent
server requests. Explicit gates make the selected schedule reproducible. Assert
only the established contract; document ambiguity instead of adding a mutation
queue or accepting every observed outcome as legal.

## Initial implementation sequence

1. Build the smallest real E2E harness using the current Todo query and mutations.
   Use disposable application/reference databases and a real browser client.
   Gate I/O in test infrastructure; don't install scheduling in production code.
2. Create one reference state/interpreter and use it for both fixed witnesses and
   generated histories. Cover successful add/edit/delete, rejection, write success
   followed by read failure/recovery, and optimistic creation-time ordering.
3. Generate values, tied timestamps, IDs, operation choices, scopes, client
   instances, and legal histories. Then generate multiple endpoint declarations
   and supported query shapes rather than only varying data in one component.
4. Expand to several active queries and membership-changing mutations as those
   endpoint shapes become supported. Apply the same exact-equality law during
   optimism and reconciliation. Record missing cross-collection propagation as
   uncovered framework behavior; do not permit stale results to make tests pass.
5. Run fixed and generated defect-injection campaigns. Only then increase run
   counts and begin evaluating update-delivery optimizations.

Compile once per generated endpoint program and run several fresh-data histories
against it where useful. Failures must replay standalone from the program plus
history. Reset all module/client/query state between runs; do not share durable
manual-demo data. Keep browser/process teardown reliable during shrinking.

## Future optimizations use the same correctness oracle

Add a delivery-strategy dimension to the SUT, not a new expected-results model:

- Full refetch (current implementation).
- Mutation response supplies complete changed rows.
- Mutation response supplies partial fields, deletions, or query-specific deltas.
- Framework determines which active collections need refresh or patching.

Each strategy must independently match reference PGlite; agreement between two
strategies alone is insufficient. Generate cases where a row enters or leaves a
predicate, changes its order position, affects several queries, or disappears.
Later add joins, aggregates and windows when the authored API supports them.

Keep work metrics separate from correctness: RPCs, queries evaluated, bytes/rows
transferred, publications, and refetches. Add bounds only for a strategy's stated
optimization contract. A correct full refetch is not a failure because another
strategy needs fewer requests; a fast patch is not correct merely because its
request count is small.

## Shrinking, coverage, replay, and sensitivity

Follow [AGENTS.md](../../AGENTS.md): expand the relevant law, generator dimension,
transition or assertion when a bug appears; preserve the shrunk failure as a
program for the same interpreter. Explain false-green classifications explicitly.

Use small domains and stable logical IDs, with explicit witnesses for critical
boundaries. Track executed transitions, ties, membership changes, failure phases,
active-query combinations and skipped/no-op commands. Generation legality comes
from the model, never the observed SUT state.

Reuse [oracle-config.ts](../../packages/db/tests/oracle-config.ts) for property
registration, run multipliers and seed/path replay. Report the minimized endpoint
module, initial SQL/data, complete event schedule, first bad checkpoint, and
expected/actual results. Measure E2E cost before choosing campaign counts.

Required defect witnesses include omitted client order, wrong order priority,
early settlement, missing callback rollback, cross-client cache sharing, stale
rebound callbacks, missing affected-collection refresh, and partial updates that
leave stale membership or values. The latter cases become mandatory with those
features. Include server-boundary leaks in real build/browser checks.

Use isolated mutants, never edit files behind the running manual demo. A campaign
must reject its relevant seeded fault for the expected reason. This is evidence
of sensitivity to that fault, not proof that the generator is complete.

## What remains separate

Keep existing core history/retention oracles and useful focused/browser tests.
Use the process-reopen test for local durability. Broad browser compatibility,
authentication, deployment, schema migrations, and arbitrary handwritten SQL
correctness are not proved by this oracle.

The previous source/schema and compiler investigations remain useful references,
but their historical receipts do not validate the current bound compiler. Read
packages/db/src/query/live/ARCHITECTURE.md in full before any investigation that
reaches correlated materialization or related includes tests, as AGENTS.md requires.
