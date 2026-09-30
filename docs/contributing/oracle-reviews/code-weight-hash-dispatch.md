# Code weight: one type dispatch for hashing and equality

Reviewed executable revision: `b7455952` (base `8283f2e8`, the fetched
`origin/main` at review time). This record follows in a documentation-only
commit.

- `c0182397` adds the hash identity oracle and the work-cap tests on unchanged
  production code.
- `d1fa5a9a` is the refactor.
- `b7455952` extends the oracle after mutants on the refactor found three
  grammar gaps. The extended oracle also passes on the base code.

## Change

`hashObject` and `equalHashValues` in `packages/db-ivm/src/hashing/hash.ts`
each had a six-way type dispatch: Date, binary, Temporal, RegExp, and the
Map/Set/array/object shapes. Each branch had its own hasher or its own
comparison. One `objectParts(input)` function now returns a
`[marker, header, body?]` view that both use:

| Type | Header | Body |
| --- | --- | --- |
| Date | timestamp | none |
| binary (at most 128 bytes) | the bytes as one string | none |
| Temporal | type tag, string form | none |
| RegExp | source, flags, `lastIndex` | the RegExp |
| Map | none | its entries |
| Set | none | its values |
| array | length | the array |
| object | none | the object |

Also removed:

- the four per-type hashers (`hashDate`, `hashUint8Array`, `hashTemporal`,
  `hashPlainObject`) and `structuralShape`.
- the duplicate root and nested paths in `getCachedHash`.
- the unreachable `typeof` `default:` warning in `updateHasher`. The switch
  already covers all eight `typeof` results.

`referenceValues` moved into `isReferenceHashedObject`, which both functions
already call.

The change is intended to preserve behavior. Hash values change because the
binary header is now a string. Hash values were never stable: the markers are
random for each process, and nothing persists them.

| Entry | Revision | min | gzip | brotli |
| --- | --- | ---: | ---: | ---: |
| full `@tanstack/db` (db-ivm inlined) | `8283f2e8` | 374,186 | 105,541 | 89,418 |
| | `b7455952` | 373,154 | 105,266 | 89,184 |
| | Δ | −1,032 | −275 | −234 |
| standalone `@tanstack/db-ivm` | `8283f2e8` | 34,374 | 10,570 | 9,513 |
| | `b7455952` | 33,348 | 10,326 | 9,314 |
| | Δ | −1,026 | −244 | −199 |

All numbers come from an esbuild bundle of the public entry, minified.

## What the audit prototype changed, and what this change keeps

The first prototype of this refactor (audit ledger IVM-01) changed three
behaviors. This change keeps each one as it was:

1. **Work cap.** The prototype wrote every header value directly to the
   hasher. Array lengths and RegExp fields then stopped counting toward
   `MAX_STRUCTURAL_HASH_WORK`, so a 1,000,000-element array was accepted
   instead of rejected. Now header values of a type that has a body go through
   `updateHasher`, as before. Date, binary, and Temporal headers still cost
   nothing.
2. **Pair memo.** The prototype entered the equality pair memo before it
   compared headers. That allocated memo entries for every Date, binary, and
   Temporal pair, and binary equality took 2.3 times as long. The memo is now
   entered only after markers and headers match, and only for types with a
   body, as before.
3. **Arrays from another realm.** `instanceof Array` is false for an array
   from another realm, so both versions give it the object marker. The base
   equality also compared lengths with `Array.isArray`. The prototype dropped
   that check. This change keeps it.

## Why a new owner

Before this change, `equalHashValues` had no direct test. `topKBatch` uses it
to cancel a retraction against its replacement, and only
`tests/operators/topk-batch-contract.test.ts` reached it. The hash-values
owner (`hash.property.test.ts`) checks pairwise hash laws on flat values. It
has no model of equality, and it does not generate Temporal values, RegExp
fields, holes, symbol keys, registered handles, `File`, or Map/Set order.

The new owner,
`packages/db-ivm/tests/hash-identity-oracle.property.test.ts`, checks both
functions against one identity model.

## Contract, path, and limits

Authority: the method comments in `src/hashing/hash.ts`, and the behavior at
`8283f2e8`.

1. Primitives compare by value. `-0` equals `0`, `NaN` equals `NaN`, and a
   bigint differs from the equal number. Symbols compare by identity.
2. Functions, registered handles, `File` values, and binary values over 128
   bytes compare by identity.
3. Dates compare by timestamp. All invalid dates are equal.
4. Binary values of at most 128 bytes compare by bytes. `Buffer` and
   `Uint8Array` do not differ.
5. Temporal values compare by type tag and string form.
6. Regular expressions compare by source, flags, `lastIndex`, and enumerable
   own properties.
7. Arrays compare by length and enumerable own properties. A hole differs from
   `undefined`.
8. Maps and Sets compare by entries or values in insertion order. Other
   properties on a Map or Set do not count.
9. Other objects compare by enumerable own string and symbol properties, in
   any order. The prototype and non-enumerable properties do not count.

The model is a canonical encoding of a value **spec**, which is plain data.
It never reads a production object. The driver builds both sides of a pair as
fresh objects from their specs. A seed varies property order, prototypes
(`{}`, `Object.create(null)`, a class instance), hidden non-enumerable
properties, `Buffer` or `Uint8Array`, extra Map/Set properties, `-0` for `0`,
and sharing or copying of a repeated subtree. None of these changes the
identity.

For each acyclic pair, the check asserts:

- `equalHashValues` in both argument orders equals the model verdict.
- Equal identities have equal hashes.
- Distinct identities have distinct hashes. This is a sampled control, because
  a 32-bit hash can collide.

For each cyclic value, the check asserts that `equalHashValues` accepts a
second build of the same spec and rejects a build where one leaf holds a text
that no pool value has. It also asserts that `hash` throws
`Cannot hash cyclic structural values`. These verdicts come from
construction, so the model needs no bisimulation rule.

`hash-work.test.ts` pins seven work-cap boundaries. Each case names the
largest input that fits, and the next size must throw.

Limits:

- Arrays from another realm are outside the grammar. One pinned case holds
  equality's length check. Hashing gives such an array the object marker, so
  `[1, <hole>]` and `[1]` from another realm hash equal but compare unequal.
  This mismatch is present on the base revision too.
- Map and Set order sensitivity, and ignored Map/Set properties, are pinned
  current behavior. No contract promises them.
- Getters and proxies are outside the grammar.
- Real Temporal types print distinct formats. Only a polyfill-shaped value can
  share text across types, so one pinned case holds the type tag.

## Grammar controls and calibration

Specs cover every kind in the contract, nested to a small depth. A pair is
either the same spec (30%) or the spec with one near-miss mutation:

| Mutation | Examples |
| --- | --- |
| header | a Date timestamp, one binary byte, an appended byte, a Temporal value, RegExp flags or `lastIndex` |
| hole | an appended hole, a hole for a value, `undefined` for a hole |
| order | reversed Map entries, Set values, or object keys (object order keeps the identity) |
| property | a renamed object or Map key, a changed symbol key, an added RegExp or array property |
| retype | A Date becomes its timestamp. Binary becomes an array of its bytes. A Map becomes a Set or an array of entry pairs. A Set becomes an array. An array becomes an object. |
| replace | a different primitive or reference id |

- **Reconstruction:** 17 pinned pairs hold one rule each. Two more pinned
  cases hold the Temporal tag and the cross-realm length check. One case
  builds the same shared/copied spec with 39 seed pairs.
- **Ablation and exclusion:** the mutants below.
- **Range:** the positive execution witness requires the fixed campaign
  (seed `2026930`, 300 pairs) to reach all 20 value kinds and all seven
  mutation classes, to give a `false` verdict for header, hole, retype, and
  replace mutations, and to give only `true` for unmutated pairs.

Each run executes a fixed campaign and a random campaign of 300 pairs for
acyclic values, and the same for cyclic values.
`TANSTACK_DB_IVM_HASH_IDENTITY_SEED` and `TANSTACK_DB_IVM_HASH_IDENTITY_PATH`
select a direct replay.

### Source mutants on unchanged production (`8283f2e8` sources)

"New tests" means the identity oracle and `hash-work.test.ts` (39 cases).
"Rest of suite" means every other db-ivm test file, including the older
`hash-work.test.ts` cases (596 tests).

| Mutant | New tests | Rest of suite |
| --- | --- | --- |
| W1: equality ignores RegExp `lastIndex` | assertion failure (3/39) | 3/596 |
| W2: equality ignores array length | assertion failure (4/39) | 3/596 |
| W3: equality ignores the container kind | assertion failure (5/39) | 3/596 |
| W4: binary equality compares only lengths | assertion failure (3/39) | 3/596 |
| W5: Temporal equality compares only tags | assertion failure (2/39) | 0/596 |
| W6: registered handles compare structurally | assertion failure (3/39) | 3/596 |
| W7: equality ignores symbol keys | assertion failure (3/39) | 3/596 |
| W8: a Set hashes with the array marker | assertion failure (3/39) | 0/596 |
| W9: hashing skips symbol keys | assertion failure (3/39) | 7/596 |
| W10: hashing omits the array length | assertion failure (9/39) | 8/596 |
| W11: invalid dates compare with `===` | assertion failure (3/39) | 0/596 |
| W12: equality compares large binary values by content | assertion failure (2/39) | 3/596 |

A first mutant for W11, "Date equality accepts a non-Date", survived every
test. It is equivalent in this domain: the earlier `typeof` guard rejects a
Date compared with a primitive, and no generated object has `getTime`.

### Source mutants on the refactor (`d1fa5a9a` production, `b7455952` tests)

| Mutant | New tests | Rest of suite |
| --- | --- | --- |
| N1: a Set uses the Map marker | assertion failure (3/39) | 0/596 |
| N2: equality skips header values | assertion failure (5/35) | 15/596 |
| N3: the binary header holds only the length | assertion failure (3/35) | 3/596 |
| N4: header-only types compare equal before their headers | assertion failure (4/35) | 6/596 |
| N5: header values skip the work counter (the prototype) | assertion failure (6/35) | 6/596, all in the new work-cap cases |
| N6: hashing drops symbol keys | assertion failure (3/35) | 7/596 |
| N7: a RegExp has no body | assertion failure (3/35) | 1/596 |
| N8: a Map body holds only values | assertion failure (3/39) | 7/596 |
| N9: the Temporal header drops the tag | assertion failure (1/39) | 0/596 |
| N10: registered handles compare structurally | assertion failure (3/35) | 3/596 |
| N11: the cross-realm length check is removed | assertion failure (1/39) | 0/596 |

N1, N8, N9, and N11 survived the first oracle (`c0182397`, 35 new-test
cases). `b7455952` adds Sets of generated values, a Map key rename, a
Map-to-Set retype, and the two pinned cases, and each of the four then fails.
The other seven rows come from the 35-case oracle.

Six mutants survive every older db-ivm test: W5, W8, W11, N1, N9, and N11. N5,
which is the prototype's work-cap change, fails only the new work-cap cases.

## Performance

`hash` runs for structural keys and unkeyed consolidation. `equalHashValues`
runs only in `topKBatch`, for a key with more than one entry in one batch.

Each timing process loads one implementation and runs every workload on
20,000 values, five times after two warm-up passes. Processes alternate, and
each ratio is the median of nine processes of each implementation.

| Workload | A/A | A/B run 1 | A/B run 2 |
| --- | ---: | ---: | ---: |
| hash rows (6 fields with a Date and an array) | 1.096 | 0.932 | 1.037 |
| hash join keys (`[number, string]`) | 0.993 | 0.992 | 0.978 |
| hash binary (16 bytes) | 0.910 | 1.050 | 1.081 |
| hash nested (objects, arrays, Map, Set) | 0.997 | 0.815 | 0.980 |
| equality rows | 1.018 | 0.939 | 0.964 |
| equality join keys | 1.029 | 0.796 | 1.091 |
| equality binary | 0.952 | 1.308 | 1.346 |
| equality nested | 0.988 | 1.069 | 0.917 |

Each ratio is new time over base time. The A/A control compares two copies of
the base code, and it shows noise up to ±10% on this machine. Only binary
equality is outside that band. It costs about 15 ns more for each comparison,
because each side now builds a header string. Binary hashing is 5% to 8%
slower in both runs, which is inside the band. The murmur stream writes two
bytes for each string character, and the base code wrote each byte once. The
harness is not checked in.

## ORC-001 through ORC-012

| Requirement | Result |
| --- | --- |
| ORC-001 | The oracle's opening comment states the nine identity rules, the three laws, the authority, and the limits above. |
| ORC-002 | The model is a canonical encoding of plain-data specs. It does not import production helpers or read production objects. Cyclic verdicts come from construction. |
| ORC-003 | The contract, model (`identity`, `canon`), grammar (`specArb`, `nearMiss`, `pairArb`, `cyclicArb`), driver (`realize`), and checks (`expectPair`, `expectCyclicPair`) are separate and visible in one file. |
| ORC-004 | Reconstruction, ablation, range, and exclusion appear above. |
| ORC-005 | The driver calls the production functions. The positive witness shows that the fixed campaign reaches every kind, every mutation class, and both verdicts. |
| ORC-006 | The source mutants above have their outcome classes. One equivalent mutant is recorded with its reason. |
| ORC-007 | Fixed and random campaigns share each property, grammar, check, and budget (300 runs). The replay variables select a direct replay. The properties do not use `fc.commands`. |
| ORC-008 | The model is a stateless encoding, so this requirement does not apply. |
| ORC-009 | Model terms (marker, header, body, reference leaf) match the production names. |
| ORC-010 | fast-check reports the seed, path, and shrunk pair. Assertion messages give the mutation class and both identities. |
| ORC-011 | The Map/Set order rule and the cross-realm mismatch are shared current behavior. The limits name them instead of hiding them. |
| ORC-012 | This record ties the reviewed revisions, outcome classes, limits, and performance evidence to the coverage map. |

## Verification

On `b7455952`, the following passed:

- `packages/db-ivm` Vitest: 42 files, 621 tests, no type errors.
- `packages/db-ivm` `tsc --noEmit`: no errors.
- `packages/db` Vitest, typecheck off: 193 files, 6,830 tests.
- `pnpm test:oracles`: 49 `@tanstack/db` files with 2,838 tests, and 16
  `@tanstack/query-db-collection` files with 454 tests and 1 todo.
- `pnpm test:minified-db`: error names, index metadata, query rows, and live
  updates.

The environment was Node `v24.19.0` and Vitest `3.2.4` on Darwin arm64.
