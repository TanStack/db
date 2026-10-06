# Temporal persistence: design grammar and stress readings

The implemented **[v2 design grammar](v2.md)** is the current result. Its linked
model, evidence and process layers record native Instant/PlainDate support,
translations into the existing oracles, final validation and remaining limits.
The v1 discussion below is a frozen historical record, including choices that
the user subsequently settled. It does not describe the current test status.

## Historical v1 reading

Current direction after the user's clarification is recorded in the
[user recheck](user-recheck.md): native types must roundtrip, existing persisted
data may be replaced, and Temporal queries should extend the existing
SQL-plus-residual pipeline. The original readings below remain the frozen record.

The worktree is current with `origin/main` fetched on 2026-10-05 at
`e21c280f3`, including #2002's persistence/refetch ordering repair. The unchanged
reproduction still reports **13 passing tests and 8 failing Temporal cases**.
The [replay receipt](../issue-2034-temporal-persistence.md) records the setup.

The grammar treats this as a value-preservation repair across existing
boundaries. A codec can preserve an Instant in a row while a wrapper loses that
same Instant in an index expression. A query can revive the right values yet
discard the wrong rows in SQL before JavaScript sees them.

A case is described by:

```text
value × carrier × operation × execution boundary × environment × legal history
```

For example: PlainDate × row metadata × reopen × SQLite adapter × registered
polyfill × update. These are constrained test dimensions, not new production
classes or a mandate to enumerate every combination.

The [frozen grammar](model.md) permits variations subject to four groups of
constraints:

- Preserve supported kind/value in rows, nested data, metadata and replay.
  Keep strings, existing supported types and ordinary records intact. Genuine
  brands and constructor availability are separate requirements.
- Separate storage representation, equality and ordering. Prove SQL selection
  safe before applying it; preserve final filtering/order/windows and alignment
  with runtime literals and index expressions. Untyped fields and Boolean
  composition remain unresolved.
- Preserve adapter rollback and validation of superseded actions, wrapper
  publication-before-durability, receipts/FIFO, binding caps and driver ownership.
  Extend existing oracle owners without adding a transaction lifecycle.
- Qualify support by constructor, host and public route. Establish old-byte and
  reader policies; already-lost `{}` values cannot be reconstructed by guessing.

The unranked adjacent forms are tagged support with residual query execution,
the same support augmented by proved SQL/index representations, and explicit
rejection as a safety-only form that does **not** deliver Temporal support.
Their costs and missing evidence remain open.

The [owner map](evidence.md#primary-oracle-ownership-to-retain) attaches value
reopen, action folding/rollback, snapshots, SQL/index planning, binding limits,
wrapper receipts and Query ownership to their current executable owners.
Direct SQLite results do not certify Expo, OPFS, Electron or coordinator routes.

The requested stress readings returned:

- **[Hostile assay](hostile.md):** the independent auditor found an upstream
  index serializer that erases Temporal literals and an oracle clone operation
  that erases them too. Other conditions concern query rejection/Boolean
  polarity, schema fences that can reset durable data, and unsupported wire
  requests entering retries. Each finding has a checkpoint and repair condition;
  the latter scenes are source-grounded constructions, not observed patch failures.
- **[Fracture scan](fracture.md):** recognizing a new unescaped marker could
  reinterpret an existing plain record. This defeats a naive tag extension;
  no unconditional fracture of the conditional candidate was established.
  Executed probes also show canonical Instant text is not a safe lexical order
  key, and PlainDate order-equivalence need not imply DB equality.
- **[Tension scan](tensions.md):** three provisional, unranked options remain:
  exact query semantics versus selective SQL execution; native reconstruction
  versus runtime/public-route portability; and format extension versus existing
  data/reader compatibility. User-fit selection remains open. Rollback versus
  prior publication is a boundary distinction, not an invented competing demand.

This is an exploratory grammar with provisional preservation properties.
Source reconstruction and component-removal controls are recorded in
[process.md](process.md); they are not an implementation proof. No independent
held-out range case was supplied, and no formal model check was applicable to
this static design grammar. It excludes spoofed brands and unsupported Temporal
kinds. Decomposition can hide scheduling/host interactions; hostile and fracture
readings can overemphasize vivid corner cases; tensions can manufacture symmetry.
SQL/error admissibility, read cost, constructors, migration and route support
remain unsettled. No production fix or bug-class closure is claimed.
