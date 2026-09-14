# Model — version 1

Target and preserved properties: [contract](PRESERVATION.md). Source: the
[checker proposal](SOURCE.md), corrected by the user's PG-function decision.
Evidence pointers `C*` refer to [survey claims](../../../SQL-EFFECTS-SURVEY.md).
This model is frozen before the primary reading; it specifies proposed behavior.

## Surviving candidate units

| ID | Candidate | Role and source |
| --- | --- | --- |
| M1 | Bound operation | SQL node plus its binding, execution event, and source identity. Differentiates a table read, delete, upsert branch, function call, default evaluation, etc. SOURCE initial calculus; C11–C15. |
| M2 | Effect summary | Known reads/writes, unresolved effects in each dimension, and non-table/result-context dependencies. Each fact carries a derivation and source span. SOURCE inputs/outputs and separate claims; C2–C4, C10. |
| M3 | Claim judgment | A named optimization's premises and the resulting proof or specific unresolved/overlapping obligation. SOURCE named claim and claims table; C1, C6, C23. |
| M4 | Collection authority state | Retained identity/scope, baseline and pending optimistic/repair obligations, supplied by the existing runtime. SOURCE authoritative read requirement; P5/P8. |

Binding and provenance are fields of these units, not separate new services.
Unknown is part of a summary, not a global table flag. A diagnostic renders a
judgment; it is not another proof-producing unit.

## Relations and active overlaps

| ID | Relation | Consequential overlap |
| --- | --- | --- |
| L1 | M1 produces M2 through rule application. | Nested SQL/routine calls share relation dependencies; deduplicate facts without losing paths. |
| L2 | M2 supplies premises to M3. | A query can read a relation that a mutation reads but does not write. Shared reads do not constitute write interference. |
| L3 | M3 and M4 jointly decide whether the runtime may omit this refresh. | A proven independent server query may still need correction after a wrong optimistic edit. Neither unit owns that case alone. |
| L4 | M1 can invoke other M1s directly or through schema-defined behavior. | Delete → FK child delete → child trigger → log write. This is a graph, not a tree of owning tables. |

These are logical boundaries, not a claim that a new module has been implemented.
The integration contract is explainable judgments feeding existing refresh and
authority handling. It must preserve the unoptimized handler execution path.

## Dynamics

| ID | Rule | Status and basis |
| --- | --- | --- |
| R1 | Resolve relation/routine/operator/type identities in the supported compilation environment before attaching facts. A complete finite set of possible bindings may be joined; an incomplete set is unresolved. | Source binding requirement; C14. Candidate finite-set extension is inferred. |
| R2 | Compose effects by union. Selection/projection, joins, aggregates, ordering, limits, and subqueries keep child effects. Values need not be evaluated to union their effects. | SOURCE initial calculus; C3/C4. |
| R3 | A write contributes its target and the effects of executed expressions. Reads in a predicate or insert-select do not become writes. Upsert, MERGE and DML CTEs contribute all possible executed write actions. | SOURCE initial calculus; C11–C13/C17. |
| R4 | Follow implicit effects at the applicable event: FK actions, triggers/rules, policy/view expressions, selected defaults and generated expressions. Closure adds newly reachable operations until stable. Known irrelevant features add no effects. | SOURCE initial calculus and user's correction; C9–C15. Event-sensitive closure is inferred. |
| R5 | Analyze PG routine bodies and their calls. Recursive call groups use a monotone fixed point over summaries. Recognized native operations use specific semantic summaries; user volatility labels do not replace body evidence. Unparsed/procedural/dynamic constructs remain explicit unknowns. | P4; C2/C3/C10/C14. Fixed-point algorithm is a candidate, not a parser implementation. |
| R6 | Prove independence from nonintersection of conservative query reads and mutation writes under the named result/context premises. Overlap means “may affect,” not “will change.” Missing relevant premises mean unknown. | SOURCE named claim; C4. |
| R7 | Apply the runtime authority gate to every retained collection. An independent SQL judgment cannot erase an optimistic, missing-baseline, or stale-response repair obligation. | SOURCE; P5; C19. |
| R8 | If the applicable claim is unproved, preserve the ordinary refresh path and explain why. Refining evidence may enable a proof; merely suppressing a diagnostic cannot. | SOURCE; P6/P10; C23. |

`Unknown` retains its dimension and scope. It is not converted to an empty set.
It also need not destroy unrelated facts: an unresolved mutation value is not an
unresolved write destination. A query proved constant with no state dependencies
can be independent of unknown table writes, subject to M4 and result/context
premises. This is the empty-set instance of R6, not a special allowlist.

## Constraints

| ID | Constraint | Preserved properties |
| --- | --- | --- |
| I1 | Every emitted proof includes its claim, premises, analyzed artifact identity, rule derivation, and relevant evidence scope. | P1/P4/P6 |
| I2 | Refinements never erase possible effects without a justified rule. Catalog object edges alone are not a complete routine summary. | P1/P4/P6 |
| I3 | No code motion, auth insertion, hidden database installation, runtime schema inspection, or extra switches for incomplete analysis. | P2/P3/P10 |
| I4 | Exact patches and client evaluation require separate judgments; independence cannot authorize them. | P7 |
| I5 | The compiler neither claims external freshness nor discharges existing browser authority obligations. | P5/P8 |
| I6 | Value, authority, and precision tests have independent expected assertions. Full refetch is allowed for unknown cases, but cannot satisfy a law requiring a known skip. | P9 |

## Boundary conditions and unresolved implementation facts

- B1: SQL-only evidence does not establish every effect of arbitrary Node.js code.
  This is an explicit scope, not a hidden premise that helpers are pure.
- B2: Build evidence applies to its schema, binding environment, and code. The
  concrete deployment matching mechanism remains unresolved; no runtime catalog
  polling is proposed.
- B3: The supported routine-language syntax, binder, and native effect summaries
  are not chosen by this grammar. Complete PostgreSQL coverage is not claimed.
- B4: Output comparison must retain SQL multiplicity and promised order; unknown
  limit membership is not repaired by sorting an oracle result.
- B5: Database state transitions and server responses still obey the existing
  transaction/partial-commit and stale-authority protocol. This grammar does not
  replace it or prove eventual recovery when reads keep failing.

## Adjacent forms

| ID | Route and changed variable | Fixed interface / overlap | Source basis, new structure, cost and loss |
| --- | --- | --- | --- |
| F1 | Rule combination: table-level effects with PG call and schema-action closure. | M3 proof/fallback and M4 authority gate. | SOURCE initial calculus, P4. Adds operation-sensitive graph traversal; loses row/column precision. Closure cost tracks the build graph; unknown nodes remain fallback. No performance measurement. |
| F2 | Augment F1 with column/predicate-sensitive effects for a stated SQL fragment. | Same M3 judgment and M4 authority contract; coarse table proof remains usable. | C6 supplies a precedent, SOURCE separates claims. Adds old/new membership and predicate obligations, potentially reducing same-table invalidations. Costs binding/type/NULL/collation semantics and more proof/testing work. It still does not authorize patches. |

These forms are unranked and can be successive refinements, not user options.
Function-body analysis is included in F1, not postponed to F2. A third form that
merely adds a verbose explanation field was rejected: it exercises no distinct
transformation path. Range outside the extraction source remains untested.
