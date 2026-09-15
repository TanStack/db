# Evidence guarantees: ground-condition probe

Date: 2026-09-15. Instrument: `ground-condition`. Status: complete, bounded.
Input: [fracture scan](01-fracture-scan.md), [survey](02-research-survey.md),
user's two-API demo, and prototype `9189b4f34`.

## Frozen claim and ordinary case

An agent can supply a missing fact about an opaque call, enabling the compiler
and existing runtime to make a more precise correctness-preserving choice.

Ordinary baseline: one mutation updates recipes, then awaits a versioned API
which may update shopping items. Both finish before the response. Queries cover
recipes, shopping items, and unrelated tags. They have confirmed baselines and
no overlapping mutations or outside writers during this comparison. The client
has full retained collections; subsets remain deferred. A correct footprint
plus the existing registry intersection selects affected authoritative reads.

Application goals remain: ordinary code, correct browser data, cheap selective
refresh, no hidden mutation queue, no compiler-authored auth, and minimal user
configuration. A missing guarantee is not permission to add infrastructure.

## Dynamics, constraints, and boundaries

| Kind | Present condition | Controller / evidence |
| --- | --- | --- |
| Dynamics | Handler effects, then selected authoritative reads, then client settlement | Endpoints refresh/registry code, S3 |
| Constraint | Write upper bound must include every relevant possible relation | Compiler plus any admitted evidence; unimplemented general admission |
| Constraint | The runtime must not retire unrelated outstanding optimism using an older response | Framework/runtime oracle; evidence does not replace it |
| Constraint | If a call's effects can remain in flight after failure, a read immediately after failure may precede those effects | API contract and protocol, not a code-name heuristic |
| Boundary | API branch and normalized input | Server-side validated input and actual branch mapping |
| Boundary | API commit before response versus job acknowledgment | API owner; implementation/deployment contract |
| Boundary | Library, configured hooks, remote deployment, DB authority | Source/config/deployment identity; not a local import hash alone |
| Boundary | Which fact consumer needs which effect domains | Linter/evidence rule definition |

## Matched comparisons

Each comparison below is a **constructed case**, informed by source contracts.
It is not a newly run production experiment. Each holds the baseline fixed
except for the named condition.

### G1 — Branch-specific writes versus a conservative upper bound

Change: `apply` is false instead of true; synchronous API and same input schema.

```ts
await updateRecipe(input)
await shoppingApi.apply({ recipeId: input.id, apply: input.apply })
```

| Available evidence | apply=false reads | apply=true reads | Interpretation |
| --- | --- | --- | --- |
| API effects unknown | recipes, shopping, tags | recipes, shopping, tags | Conservative unknown-effect fallback |
| API may write shopping | recipes, shopping | recipes, shopping | Correct upper bound; no need to reject useful broad evidence |
| Valid conditional bound | recipes | recipes, shopping | More precise; same authoritative refresh mechanism |

This table states desired evidence-aware behavior, not present implementation:
the SQL-only compiler currently skips some calls. That known linter/admission
gap must be resolved before the demo can claim the table's behavior.

Controller: agent inspection supplies the branch contract; compiler binds it
to server-validated arguments and actual call site. Missing evidence: exact
implementation/config dependencies and failure-path effects. The condition
changes read count, not the synchronization mechanism. Wasp's entity sets (C3)
give a source precedent for accepting coarse bounds.

### G2 — Same write set, different completion meaning

Change only: API responds after queueing work instead of after commit.

Baseline sequence: `write → API response → refresh → settlement`.
Boundary sequence: `API response → refresh → settlement → background write`.

The write-set claim is still true, but the causal path differs. Refetching every
collection at the same early point does not fix it. Evidence can identify the
boundary; it cannot make that early read authoritative for a later write.

Controller: API implementation. A preexisting “wait for job completion” API or
event may supply the missing boundary. Otherwise the product needs an explicit
asynchronous operation contract. This is distinct from unrelated external writes.
Sources: Convex actions' separate operations (C5), PowerSync checkpoints (C11),
Meteor result versus settlement (C12). Their protocols are not imported here.

Failure counterpart: the API commits and throws before responding. A complete
may-write footprint still requires refresh after failure, which Endpoints already
does. But a timeout while the remote request keeps running has the same unresolved
completion problem as the queued job. “Throws” cannot universally mean “no effect”
or “all effects have stopped.”

### G3 — Same fact, a different consumer

Change only: use a correct `PG writes = empty` certificate for automatic replay
instead of refresh selection. The API can still send a message or incur a charge.

Skipping a PG refresh may be valid; retrying the whole call can duplicate those
other effects. What must change is the required claim, not the truth of existing
evidence. Controller: framework rule definitions. The evidence record needs to
retain which effect domain and execution prefix were inspected. Source: Ur/Web
FFI distinctions (C2), Convex action retry boundary (C5).

Supported range: an effect fact is reusable by consumers whose requirements it
actually entails. A rule-specific no-effect prefix may be established by code
inspection; total purity is unnecessary for the refresh-only use.

### G4 — Same call signature, different transaction handle

Change only: `library.recordChange(tx, input)` uses its module-global connection
instead of the supplied `tx`. The outer transaction and call syntax stay fixed.

A failure after the call rolls back the outer write but need not roll back the
library write. Controller: library implementation/config. Source: Open RIA's
overridable persistence boundary (C15), Ur/Web runtime transaction participation
(C1/C2). Inspecting handle flow establishes a real missing fact; merely observing
`db.transaction(...)` in the handler does not. If the compiler can follow that
flow, it should do so without asking the agent for duplicative evidence.

Supported range: existing transaction semantics can be certified for the
inspected participant. Cross-service atomicity still requires participation or
other authored runtime behavior. The compiler must not insert it implicitly.

### G5 — Same type, different representation law

Change only: a library serializes an exact integer key through `Number(key)`
instead of an exact decimal string. Input/output TypeScript types can stay
plausible while distinct large keys collapse.

Controller: codec author. Inspection plus domain-specific round-trip/injectivity
checks can expose this boundary. For a finite declared domain an exhaustive test
can settle the property; a generated sample cannot prove it over all integers.
Source: Eliom's separate type universes and converters (C14). The imported law is
typed transfer; semantic identity preservation for this custom codec is an
additional transfer hypothesis, not a theorem claimed by the source paper.

Supported range: a codec can support one consumer while failing another. Numeric
equality does not imply lexical order preservation; a derived key's injectivity
does not by itself establish a sorted query result or patch safety.

### G6 — Same operation, different starting state or data completeness

Change only: the server's initial state differs from the optimistic client's
state. A room reservation succeeds in the local prediction but loses to a server
reservation. The two implementations can both follow their intended rule.

Controller: application intent defines acceptable prediction; framework protocol
settles authority. Sources: Replicache/Zero (C8) permit divergent outcomes. E6's
same-state check finds authored mistakes; it cannot demand equality across
different states. A separate test should verify convergence and error reporting.

The deferred subset variation also matters: absence from a partial client set
does not prove absence from PG. Keep full-set initial conditions explicit in the
first built-in check. This does not request subset implementation now.

## Remaining questions, without selecting a design

1. What exact typed claims can the evidence system consume initially, and what
   are the allowed transformations/compositions between them?
2. Which dependencies does an inspection certify, including callback/config and
   remote deployment premises, and how are missing premises represented?
3. How does tooling preserve the difference between a bounded test result and a
   source-based manual certificate while making both useful to an agent?
4. Can an API outcome prove all relevant effects have finished on success,
   failure, and timeout? When not, what authored completion mechanism exists?
5. Which diagnostics are ordinary compiler work and which identify an opaque
   boundary that warrants an agent task?

## Limits and preserved goals

The six cases are deliberately small. Their variation may make evidence
composition look easier than it will be with many hooks and conditional calls.
No universal boundary is inferred from one example; no certificate, demo, or
new framework test was implemented by this instrument.

The user's premise survives for bounded opaque code: inspecting its actual
implementation can add useful facts. Conservative upper bounds remain valuable.
The missing facts are about particular calls and consumers, not a demand to
prove every aspect of the application before it can run.
