# User clarifications and tension recheck

This addendum follows the frozen v1 grammar and its stress readings. It records
the user's corrections without rewriting the candidate the auditor examined.

The user permits overwriting existing persisted data, requires native
reconstruction (the input data type is the returned data type), and identifies
the existing SQL-plus-residual pipeline as the intended integration point.

## Rechecked readings

- **A — Dissolved as the presented product choice.** The adapter already
  compiles SQL, decodes candidate rows, applies the DB predicate evaluator,
  sorts locally, and finally paginates (`sqlite-core-adapter.ts:2434–2549`).
  Correctness and useful SQL filtering are simultaneous requirements in this
  design. No measured cost or demonstrated incompatibility established a need
  for the user to choose one. Temporal support should extend this pipeline.
  Sound candidate selection, Boolean polarity, rejection behavior and actual
  index use remain implementation/proof obligations. In particular, the current
  compiler marks a complete expression unsupported when any child is unsupported
  (`:835`); this reading does not claim arbitrary safe conjunct extraction is
  already implemented. Local cleanup can remove excess candidates, but cannot
  restore a matching row discarded by SQL. Current pagination happens after
  cleanup; the earlier conversational example of SQLite reading only the next
  ten rows did not describe this adapter's present execution path.
- **B — Dissolved as an unresolved product priority.** Native reconstruction is
  required. Strings or empty objects do not satisfy the requested behavior.
  Constructor provisioning and receiving wire/host support remain concrete
  requirements wherever support is claimed, rather than competing goals to
  present to the user again.
- **C — Weakened by explicit migration policy.** Preserving existing persisted
  bytes is not a requirement for this repair; overwriting/rebuilding them is
  acceptable. No data reset has been performed. New accepted writes must still
  preserve their input type, including ordinary records, and the chosen format
  boundary must be explicit. Permission to replace old data does not make a
  newly written marker-shaped record interchangeable with a native Temporal
  value. Downgrade behavior and exact reset mechanics remain unspecified.

The existing Node expression-index oracle observes captured SQL before residual
filtering, final adapter output, and named-index plans independently. Its
overbroad-predicate control (`expression-index-oracle.test.ts:1914`) demonstrates
why passing final-row assertions alone cannot establish efficient SQL execution.
Temporal additions should retain those existing laws and distinguish any
intentional conservative selection from regressions in exact cases.

This recheck used the original reproduction goal, the full recorded readings,
the user's two clarification messages, and the source mechanisms above. The
source confirms the user's architectural correction; it does not establish that
Temporal support is already implemented or that all queries will be selective.
No new tension menu is manufactured. The current direction is native roundtrip
through the existing SQL/residual architecture, with old-data replacement
allowed. Production code and the frozen stress-test specimen remain unchanged.
