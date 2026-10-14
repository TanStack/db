# Structural identity oracle review — 2026-10-14

Reviewed executable head: `e1cd28afb6b9bd76641b42a06110eb184b5fac1a`.
Base: `87bc07354fa47df48e9b05c599f24dad74dea0f3` (`origin/main` at review).
The binary diff for the oracle, replay registry and manifest, and coverage map
has SHA-256 `9e94b37b8a03caa07f457d80d82a7aff399f70e3b47a6c59fe10190b43071c84`.
This record is added after the reviewed executable head; it changes no test or
production behavior.

## Law, failure, and observation

`structuralIdentity` must give equal D2 values the same result, including two
undefined results, and must not give unequal values the same defined string.
The contract is stated beside `structuralIdentity` in `hash.ts`; `groupBy`
depends on it when it merges contributions. The oracle checks the direct
`structuralIdentity` and `equalHashValues` return values after each call. It
does not claim to prove `groupBy` integration, which the incrementalization
law owns.

On untouched main, the independent-pair property failed at seed `1158727847`,
path `255`: an explicit array around `deep(5, value)` and `deep(6, value)`
built equal arrays, but the model gave their specs different normal forms. This
was an oracle model error. The repair expands `deep` shorthand into repeated
one-element array normal forms. A named equal pair preserves the original
witness, and an adjacent-depth pair checks that the model still distinguishes
one missing array level. The equal-pair grammar now generates both same-spec
and explicit-array/`deep` spellings. A structural grammar filter excludes
RegExps with a NaN `lastIndex` from that equal-pair lane; the independent-pair
lane still generates them.

The collision sweep added two distinct symbols with the same description and
Map, Set, and plain-object pairs with equal entry bodies. Their different D2
values must retain different defined identities. The alphabet includes `0` so
an object can reconstruct the index key of a Map or Set body.

## Grammar controls and executed calibration

The generated specs cover primitive leaves, short strings, arrays with holes,
objects with unique keys and optional enumerable symbol keys, Dates, RegExps,
Maps, Sets, small byte arrays, and `deep` nesting. Arrays have 0–3 items;
objects have 0–3 unique string keys; strings and keys have 0–4 characters;
binary values have 0–3 bytes from 0–2; generated `deep` nodes have depth 3–6.
The equal-spelling bridge uses depth 3–5 plus one explicit array. The
equal-pair lane varies prototypes, key order, and hidden symbols through a
64-Boolean choice stream. Duplicate object keys and cyclic specs are excluded
from the grammar. A separate fixed case checks that a cyclic object gets no
identity. The NaN-RegExp exclusion applies only to equal pairs.

Two fixed equal-pair witnesses assert that the builder produces an array
subclass with a hidden symbol and class/null-prototype objects with the
requested key order and hidden symbol. Each compares the variant against a
plain value through the model and production entry points.

The named equal/adjacent `deep` pairs reconstruct the reported and neighboring
cases. Same-description symbols and equal-body Map/Set, Map/object, and
Set/object pairs reconstruct the four collision boundaries. With the old
`deep` model and the equal-spelling bridge removed, both 2,000-case campaigns
passed; restoring the bridge made the fixed campaign fail after three cases at
`model vs equalHashValues`. Replacing symbol identity with its description or
collapsing any of the three object-kind tags fails a named pair at the shared
identity assertion. Date-as-number, binary-as-string, and bigint-as-number tag
mutants fail the generated comparison. The earlier length/header controls
exercise string length, key length, array length, and Date/RegExp headers.
Four isolated mutants made identity sensitive to key order, object prototype,
hidden symbols, or array subclass. Each failed its named representation witness
at `equal values`. Holes versus undefined, enumerable symbols, inner Map/Set
content, and byte content are generated and modeled; this review did not
execute a fresh mutant for each of those axes.

The old `deep:${depth}` model mutant fails the ordinary fixed equal-pair
campaign at seed `20261014`. The shrunk counterexample is an explicit array
around `deep(3, 0)` versus `deep(4, 0)`. Both the unshrunk and shrunk failures
reach `model vs equalHashValues`. Guarded replay of the shrunk path records one
run with `failed: true` for that mutant; the reviewed head records one run with
`failed: false`. The direct replay path is
`2:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0`.
The independent-pair replay at seed `1158727847`, path `8092`, also records
one successful run. Each generated property uses the same 2,000-run generator,
driver, and comparison for its fixed and seedless campaigns. The manifest
selects just the requested property for seed/path replay.

The reviewed oracle file passes 17/17 tests, including guarded replay of the
shrunk path. Typecheck, lint, formatting, and diff checks pass. Hostile-mutant
results above are assertion failures at the named comparison, not setup errors
or timeouts.

## ORC disposition at the reviewed head

| Requirement | Disposition and evidence |
| --- | --- |
| ORC-001 | Met. The opening law and `hash.ts` contract identify authority; the coverage map bounds the owner. |
| ORC-002 | Met. `normal(Spec)` computes expected identity independently of hashing. The equal-pair exclusion uses a separate structural NaN-RegExp predicate, not `normal`. |
| ORC-003 | Met. Opening prose states law and limits; the spec grammar, `build` path, `normal` model, and `expectAgreement` return-time comparison remain distinct beside their code. |
| ORC-004 | Met for the bounded grammar above. Named and generated witnesses reconstruct the repair and collision axes; fixed representation witnesses confirm subclass, prototype, key-order, and hidden-symbol choices reach production. Mutants reject those four sensitivities, and removal of the equal-spelling bridge lets the old model pass both campaigns. Bounds and excluded states are explicit. Other axes were not freshly mutated. |
| ORC-005 | Met. The real hash entry points run, and equality/identity are compared at synchronous return. No concrete missing-input hypothesis applies to these fully constructed values. |
| ORC-006 | Met. The old-model and collision mutants fail at `model vs equalHashValues` or `a shared identity`. The reduced old-model failure preserves the same law and checkpoint. |
| ORC-007 | Met. Both properties run fixed and seedless 2,000-case campaigns; manifest-backed guarded seed/path replay selects one property and emits one-run witnesses. |
| ORC-008 | Not applicable. `normal` is a stateless recomputation; this change adds no model state or transition. |
| ORC-009 | Met. The model maps `deep` to repeated arrays and symbol leaf indices to stable symbol instances; the shared D2 terms follow the glossary. |
| ORC-010 | Met for this harness. The reporter preserves the original comparison failure, seed, path, and reduced failure; tests acquire no resource needing cleanup. |
| ORC-011 | Not applicable. The review identified no remaining concrete shared semantic fault for which a second formulation would distinguish this bounded law. `equalHashValues` is a sanity observation, not the model source. |
| ORC-012 | Met by this exact-head record, including the applicable and non-applicable requirements and the bounded repair claim. |
| ORC-013 | Met. The equal array/`deep` pair and adjacent-depth pair distinguish the nesting rule from a lost-array-level rule at the model/equality comparison. |
| ORC-014 | Not applicable. Values are constructed in-process; no controlled provider or host premise is handed to a real integration claim. |

The repair closes the known false-red trace and tested nearby structural
identity collisions for finite acyclic specs at the direct helper boundary.
Temporal values, opaque reference values and functions, large binary values,
getters or proxies, arbitrary cyclic pairs, and mutation between observations
remain outside this owner. The coverage map assigns the separate `groupBy` path
to the incrementalization law.
