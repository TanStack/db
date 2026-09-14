# Fracture scan: the meaning of a rejected handler

Frozen specimen: [scope](./scope.md), [source hashes](./source-freeze.json). The grammar and implementation have different scopes; this scan does not silently substitute the broad user goal for the implementation's declared slice.

## Reconstructed position

G1: Query semantics and row effects have separate support requirements. Client guesses belong to existing transaction overlays; actual effects can differ. Unknown actual effects conservatively select retained reads. Authority is installed before the matching overlay is retired (grammar L3–L5, R3–R8).

I1: In the implemented slice, full-row Todo queries with supported predicates are loaded and stable during a sequential operation. Authored guesses are nonempty and coherent. The handler is opaque. Retained query identities are validated before mutation; successful handlers are followed by full reads and authoritative publication. Failed reads after a successful handler are separately classified as committed-write/read-error. No mutation queue exists.

Protected insight: complete query results can be returned in the mutation response without proving a minimal row patch or complete write footprint. Existing DB transactions can coordinate supported guessed row effects without a new public source wrapper.

Success standard: the broad inquiry requires all retained affected results to agree with their PG reference at the appropriate optimistic/authoritative phase. The draft's evidence claims cover its declared generated sequences and distinguish unavailable authoritative reads from successful data. An error is allowed; it is not evidence of server rollback.

## FS1 — Rejected handler does not imply an uncommitted write

**Route:** internal extension plus an admissible concrete construction. **Disposition:** reproduced server-boundary gap and missing outcome condition; not a refutation of coherence after successful handlers.

Premise-to-consequence trace:

1. The implementation deliberately does not analyze opaque server write effects. Its compiler accepts asynchronous mutation bodies rather than enforcing a single atomic transaction.
2. An opaque handler can execute one valid Todo INSERT, await its commit, and then throw. This changes neither schema, query shape, concurrency, loaded state nor the nonempty guessed insert.
3. `refresh.server.ts:17` awaits `mutate()` outside the read-error try/catch. A throw skips every retained read.
4. `runtime.ts:266` awaits that RPC; rejection escapes mutation persistence. DB then fails the optimistic transaction. The special committed-write/read-error path at runtime lines 277–279 is never reached.
5. The server row can therefore exist while the client loses its guess and receives no authoritative result. The generic rejected action does not establish that PG rolled back. This exposes an unrepresented **handler failure after committed effects** branch.

**Minimal scene:** one loaded `allTodos` collection starts empty; the client guesses row `a`; the server inserts `a` and then throws. The real server helper rejects, PG retains `a`, and the retained read function is never called.

**Evidence:** [executable probe](./fracture-probe.mjs) and [receipt](./fracture-probe.json) use the actual server helper and disposable PGlite. They confirm committed PG state and zero authoritative reads. Client rollback is a source-level consequence, not a browser observation from this probe. Controls confirm a pre-write rejection leaves PG empty and a successful write invokes the retained read.

**Admissibility:** one table, one sequential operation, valid full row, supported all-row read, stable loaded query set, nonempty coherent guess. No cross-module dispatch, lifecycle race, join, collation variation or concurrent response is introduced. No atomic-handler restriction appears in the declared draft limits. The broader user contract is affected; a narrower guarantee conditioned on successful handler completion survives.

**Exposed condition:** rejection is safe to model as “no server effects” only with an enforced all-or-nothing execution boundary or observed proof that nothing committed. Merely awaiting an async handler does not establish that condition.

**Test gap:** `tests/refresh.test.mjs:52–72` checks a callback that throws before any database write and requires zero reads. The E2E fixture's rejection gate is also before SQL. Neither generates commit-then-throw or partial-commit histories. The smallest missing dimension is a failure phase after the first committed SQL statement, with the reference preserving that statement independently of the final handler outcome. The error oracle must inspect outcome/freshness classification rather than assume a rejection means rollback.

**Weakening evidence:** an enforced transaction enclosing every handler effect and rolling back on any throw would make this construction inadmissible. A documented weaker contract permitting generic “server outcome unknown” errors without immediate reconciliation would narrow the fracture to missing error-state representation/test coverage. The existing successful-handler guarantee is not defeated.

## Grammar-only result

No logical contradiction was established in the grammar's conditional support rules. It explicitly retains unsupported exits, incomplete local support, concurrency/publication uncertainty and a distinction between guessed and actual effects. FS1 identifies a missing execution/outcome condition when those rules are lowered into this implementation. It does not prove that the whole representation or either ownership form is unsound.

## Required rejection controls

**Outside rebuttal (rejected):** “Every update must be offline-first and use a globally normalized cache.” Neither is a selected success rule. Failure to meet it is an outside preference, not an internal fracture.

**Vivid near-counterexample (rejected as an in-scope draft fracture):** a top-k collection deletes its visible first row but cannot reveal an unseen replacement. The draft expressly excludes top-k and the grammar already conditions local derivation on sufficient support. This is an acknowledged boundary, not new internal disproof.

**Additional rejected overreach:** out-of-order concurrent mutation responses can install stale snapshots. Concurrency is admitted by the public API but its correctness is expressly unproved in the first draft. It remains a disclosed unsolved contract, not evidence that the reported sequential campaign failed.

## Preserved narrower claim and stop

Supported row guesses can be propagated through existing DB transactions; after a successful opaque handler, inline full reads can restore each supported retained result. The probe does not challenge that measured behavior. It challenges treating all handler rejections as a single pre-write outcome and reveals the missing condition needed to extend the guarantee. No implementation repair or architecture choice was made.
