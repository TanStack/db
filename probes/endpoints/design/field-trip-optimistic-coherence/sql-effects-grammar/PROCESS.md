# Process — frozen analysis version 1

## Source and target

The extraction source is [SOURCE.md](SOURCE.md), copied from the proposed checker
plan before extraction. Its hash and target are in [source-manifest.json](source-manifest.json).
The prior implementation is a motivating artifact, not the behavior this grammar
claims to preserve. Evidence comes from [the selected survey](../../../SQL-EFFECTS-SURVEY.md).

The target is an explainable SQL query/mutation independence judgment plus the
existing collection authority gate. This is narrower than SQL equivalence in
general and narrower than whole-program behavior equivalence.

## Preservation checkpoint

[PRESERVATION.md](PRESERVATION.md) normalizes the user's explicit list. The card's
exception for an already supplied list applies: only the material ambiguity was
asked. Kyle resolved it with “yeah we should analyze PG functions.” That removes
the copied proposal's suggestion that declarations alone could certify user
routines. No exact-equivalence property was frozen on silence.

## Observation and inference ledger

| ID | Item | Basis |
| --- | --- | --- |
| O1 | Source asks for a named checker, read/write summaries, derivations, and no generic table eligibility. | SOURCE first two sections |
| O2 | Source separates server refetch selection, client evaluation, patches, and cache reuse. | SOURCE claims table |
| O3 | User requires PG function analysis and defers general JS/library analysis. | Field Log comments 60–61 and prior context |
| O4 | All retained collections and existing authority obligations remain relevant. | P5/P8; SOURCE |
| O5 | Survey documents operation-specific effects and independent testing limitations. | Survey C9–C24 |
| A1 | Four candidate units and four relations reconstruct the proposal. | Analyst extraction; E1–E12 |
| A2 | Monotone event/call closure can supply conservative effects. | Analyst rule R4/R5, grounded in survey C2/C3/C11–C15 |
| A3 | Two adjacent forms represent table-level versus additional predicate precision. | Analyst generation F1/F2; C6 |
| A4 | Native summaries, SQL/body binding, and deployment agreement need concrete implementations. | Explicit boundary B2/B3; not resolved by extraction |

## Candidate admission and compression

Admitted M1–M4 because each reconstructs a distinct relation or preserves a
named whole property. Binding and provenance were considered separate units,
then kept as fields. Diagnostics were considered a separate module, then kept as
a projection of M3. Subscriptions were rejected as a decision primitive because
P5 includes retained collections independent of subscriber count. Volatility was
rejected as a standalone eligibility primitive because E3/E4 need actual effects.

All surviving units, relations, rules and invariants were ablated in
[EVIDENCE.md](EVIDENCE.md). No architectural independence is claimed merely from
this decomposition. L3 and L4 preserve the overlaps that a tree would erase.

## Reconstruction, exclusion, range and generation

The controls and their limits are recorded once in EVIDENCE.md. E1–E12 are
analytical reconstructions, not a newly executed test suite. N1–N5 are constructed
near negatives. There is no independent range case. F1 and F2 use distinct
generation paths; a formatting-only explanation variant was omitted. Forms were
not ranked and are not product options.

## Conflicts and missing facts

- U1: Declarations-only trust versus PG body analysis was resolved by Kyle before
  extraction. User body-analysis requirement has priority over the copied plan.
- U2: Supported routine languages, binder, native summaries, and deployment/schema
  matching remain unresolved implementation facts (B2/B3).
- U3: Table precision versus predicate precision is a supported extension relation,
  not an unresolved rule priority. F1's unknowns cannot be erased merely to obtain
  F2's apparent precision.
- U4: Evidence for visible SQL versus complete handler behavior remains a stated
  scope boundary, not an assertion of pure helpers (B1/D2).

## Projection support map

The primary brief is written only after Model, Evidence, Process, and Preservation
are frozen. Its claims must use this map; it cannot introduce new design rules.

| Brief claim | Model support | Evidence / limits |
| --- | --- | --- |
| Ask an operation-specific question; avoid whole-table bans | M1–M3, R1–R6, I1 | E1–E7, D3/D4 |
| PG routine bodies contribute effects; labels alone do not certify them | R5, P4 | E3/E4/E7, N1/N5, B3 |
| Server independence and browser authority are separate | M3/M4, L3, R7 | E8/E9, N2, D3 |
| Precision tests catch defects final-row tests miss | I6 | E11/E12, D4 |
| Table-level and predicate-level forms have different costs/precision | F1/F2 | D1/D5, no ranking/measurement |
| Source can be reconstructed but implementation/range remains unproved | B1–B5 | E1–E12, D1–D5, untested range |

Layer reconstruction: the brief must preserve the PG body-analysis decision,
SQL-only boundary, unchanged application/auth behavior, build-only/no-install
constraints, retained-collection authority, external-freshness exclusion, fallback,
two-sided tests, and unproved implementation/range. Detailed IDs and individual
operation examples live in the linked support layers, not repeated in the brief.
