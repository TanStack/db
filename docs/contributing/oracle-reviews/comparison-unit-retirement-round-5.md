# Comparison unit retirement: non-finite default order

A source-isolated Field Lab loss audit compared `comparison.test.ts` with
`comparison-oracle.property.test.ts` at frozen head
`f6857fee9de59dc82cbe596ca7df4a18152004ed`. The receiver initially
excluded NaN and invalid Dates and did not observe `defaultComparator` sorting.
The audit froze the five blocks below before retirement. The remaining three
unit tests cover symbol order and `compareValues` behavior at another entry
point.

| Retired assertion | Receiving check |
| --- | --- |
| `ascComparator(NaN, 5)` is positive and the reverse is negative. | Tagged finite and non-finite number pairs check both signs. |
| `ascComparator(NaN, NaN)` returns exact zero. | Duplicate non-finite pairs check `toBe(0)`, including the sign of zero. |
| Sorting `[3, NaN, 1, 5, NaN]` puts the finite values in order and both NaNs last. | A fixed tagged history predicts every stable sorted row ID. |
| Sorting `[5, NaN, null, 1]` puts null first and NaN last. | Fixed and generated histories combine optional null with non-finite values. |
| An invalid Date sorts after a valid 2023-01-01 Date in both directions. | A fixed history preserves that day; generated valid epoch days and invalid Dates check both signs and sorted IDs. |

Changelog #1582 promises PostgreSQL-style NaN and invalid-Date ordering.
`DEFAULT_COMPARE_OPTIONS` and `defaultComparator` supply the default ascending,
nulls-first path. The independent model receives tags for null, finite, and
non-finite values; it compares tag rank and supplied finite values. It never
uses production's unorderable classifier to predict a result. The driver calls
`ascComparator` and sorts with `defaultComparator`. It checks direct signs and
exact zeros at return, then compares every ordered row ID after sorting.

The generated grammar uses 1–5 distinct finite numbers or valid Dates in
epoch-day range -20,000..20,000, one or two NaNs or invalid Dates, and optional
null. Number and Date histories remain separate. Mixed number/Date order,
Temporal values, symbols, other options, `compareValues`, and public query or
index paths are outside this transfer.

## Review and replay

The direct wrong-result control ties a non-finite value to a finite value and
fails the sign check. A separate wrong-sort control ties NaN during sorting
and fails the ordered-ID check. Fixed-seed and seedless campaigns share the
same 100-case property. Direct property 23 replay at seed `20260911`, path
`0`, passed.

The latest hostile reviewer read the retired unit blocks, ledger, model,
production comparator, and coverage map. It found no lost assertion at the
declared direct and sort checkpoints. The focused comparison suite passed
100 tests with no type errors. Earlier PR revisions explored cross-realm and
long-byte behavior; those experiments are outside this transfer and are not
claimed by this record.

## Oracle guide boundary

The opening law and ledger state authority and limits (ORC-001). Tagged
finite values and source ranks give an independent computation (ORC-002);
the oracle places law, model, grammar, driver, observation, and checkpoint
beside their code (ORC-003). Fixed operands reconstruct the five old blocks,
and generated finite, duplicate non-finite, and null cases exercise nearby
histories (ORC-004). Direct comparator returns and sorted row IDs are the
declared observations (ORC-005). The two wrong-result controls
fail at those comparisons (ORC-006 and ORC-013). The replay above checks the
shared fixed-seed and seedless harness (ORC-007 and ORC-010). Model tags are
input labels, with no state transition or host provider (ORC-008, ORC-009,
and ORC-014). This ledger records the loss audit, hostile challenge, and
bounded result (ORC-011 and ORC-012); it makes no claim about other value
domains.

## Exact code-commit review

At `24a61a8d5b6cef06d488c490e39f351b4d55fb68`, a fresh hostile reviewer
compared all five retired blocks with the committed tagged model, direct
comparator checks, and sorted row IDs. It found no lost assertion. The
committed production and oracle blobs match the reviewed working tree; the
commit hook did not change them. A focused comparison and evaluator run
passed 236 tests with no type errors. This verdict does not extend to
`compareValues` or public query and index paths.
