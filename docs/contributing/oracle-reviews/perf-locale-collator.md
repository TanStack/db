# Cached locale collator oracle review

Reviewed source head: the commit that adds this record on
`perf/db-reuse-locale-collator`. It changes `ascComparator` in
`packages/db/src/utils/comparison.ts` and adds the
`comparison.locale-option-history` property to
`packages/db/tests/comparison-oracle.property.test.ts`.

## Contract and evidence

Under locale string collation, `ascComparator` orders two strings as
`Intl.Collator(locale, localeOptions)` does. The authority is
`StringCollationConfig` and `CompareOptions`, and ECMA-402, which defines
`String.prototype.localeCompare(that, locales, options)` as a comparison by a new
`Intl.Collator(locales, options)`.

The change keeps this result and changes its cost. Before, every comparison
called `localeCompare`, and Hermes for Android builds a Java collator for each
call. Now each compare-options object keeps the collator it first builds, in a
`WeakMap` keyed by that object.

The cache adds state across comparisons, which the stateless comparison laws
cannot see. The new property judges histories of comparisons under mixed option
sets. Its model builds a new `Intl.Collator` for every step and imports no
production helper.

## Mutant results

The production source was restored after each run. Command:
`pnpm --filter @tanstack/db exec vitest run --coverage.enabled=false tests/comparison-oracle.property.test.ts -t locale-option-history`.

| Production | Outcome |
| --- | --- |
| Parent (`localeCompare` per call) | 11 of 11 passed. The law is unchanged, so the parent passes it. |
| This change | 11 of 11 passed. |
| One collator kept for every option set | 7 failures. Shrunk to one step: `item2` against `item10` under numeric `en-US` after plain `en-US`. |
| One collator kept per locale, ignoring `localeOptions` | 7 failures, same shrunk step. |

## ORC-012 requirement audit

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Applicable. The law and authority are above and in the property. Limits: ascending comparisons through `ascComparator`; option objects are not changed after use; Collection and query paths keep their owners in the coverage map. |
| ORC-002 | Applicable. The model calls `new Intl.Collator(locale, localeOptions).compare` for each step and imports nothing from production. |
| ORC-003 | Applicable. The property's law, authority and limits state the contract; the grammar, driver and check are separate functions beside it. |
| ORC-004 | Applicable. Histories have 1 to 12 steps over seven option sets (default locale; `en-US` plain, `numeric`, `sensitivity: "base"`, `caseFirst: "upper"`; `sv`; `de`) and eight strings. Every two sets that share a locale order some pair differently. Each step gets the set's shared options object or a fresh copy. |
| ORC-005 | Applicable. The driver calls the exported `ascComparator` with `CompareOptions` built as a Collection builds them, and records the sign of each result. |
| ORC-006 | Applicable. Three calibrations: one collator for every option set, one collator per locale, and a construction whose reach observation is removed. Each is rejected under its named law. The production mutants above confirm the first two. |
| ORC-007 | Applicable. A fixed-seed campaign (`20260911`) and a random campaign share one budget. The property is registered as `comparison.locale-option-history`, so the replay variables select it. |
| ORC-008 | Inapplicable. The model is a stateless function of each step. |
| ORC-009 | Applicable. "Option set" names one `CompareOptions` configuration; "locale string collation" is `stringSort: 'locale'`. |
| ORC-010 | Applicable. A violation names the step, its option set, and the owed and observed signs. The driver has no cleanup. |
| ORC-011 | Not provided. No second formulation judges the cache; the stated limit is the bounded grammar above. |
| ORC-013 | Inapplicable. No threshold or range law. |
| ORC-014 | Applicable, limited. The host engine's `Intl` supplies the premise. The oracle runs on Node's ICU, not on Hermes. On Hermes for Android, a 30,000-string sort gave the same order with a cached collator as with `localeCompare`. |
| ORC-015 | Applicable. Declared states: "an earlier option set orders the pair differently" and "an earlier option set with the same locale orders the pair differently". The constructed history keeps at most 10 generated steps between its two added steps, so it stays inside the 12-step grammar. Every built history records its required states; the check fails when the driver's reach observations miss one, and the third calibration shows that failure. Generated reach in one run: 77 and 64 of 100 histories (fixed seed), 73 and 59 of 100 (random). |
| ORC-016 | Applicable. The file registers the property only through `oracleProperty` and adds no unit tests. |

## Open for maintainers

- **Option objects changed after use.** The old code read a changed
  `localeOptions` or `locale` on the next comparison; the cache keeps the
  collator it built. An index built under the old options keeps its stored
  order, so a change after use already left indexes inconsistent. The law states this as a
  limit and needs a maintainer decision.
- **Runtimes without `Intl.Collator`.** `localeCompare` works without `Intl` in
  some engine builds (for example Node built without Intl support). The default
  comparison now needs `Intl.Collator`. Explicit locales already need `Intl`
  through `Intl.getCanonicalLocales` in index matching.
- **RED.** A performance change under an unchanged law passes on the parent.
  The `inArray` constant-list review (`perf-in-constant-set.md`) records the same
  shape: mutants and a requirement audit, no parent failure.

## Performance evidence

Hermes, Android emulator (x86_64, 4 cores), sorting 30,000 random strings
(about 489,000 comparisons), three runs each: `localeCompare` 11.0–12.3 µs per
comparison, a cached `Intl.Collator` 1.16–1.21 µs, a plain comparison
0.19–0.22 µs. The two collation methods produced the same order.
