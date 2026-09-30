# Code weight: one type dispatch for hashing and equality

Reviewed executable revision: `6073cb13` (base `8283f2e8`, the fetched
`origin/main` at review time). This record follows in a documentation-only
commit.

- `c0182397` adds the hash identity oracle and the work-cap tests on unchanged
  production code.
- `d1fa5a9a` is the refactor.
- `b7455952` extends the oracle after mutants on the refactor found three
  grammar gaps.
- `6073cb13` applies review fixes. It fixes one performance regression and
  one behavior change, and it closes three more grammar gaps.

Each version of the new tests also passes on the base code. The documentation
commit that follows also adds comments to the oracle file, with no executable
change.

## Change

`hashObject` and `equalHashValues` in `packages/db-ivm/src/hashing/hash.ts`
each had a six-way type dispatch: Date, binary, Temporal, RegExp, and the
Map/Set/array/object shapes. Each branch had its own hasher or its own
comparison. One `objectParts(input)` function now returns a
`[marker, header, body?]` view that both use:

| Type | Header | Body |
| --- | --- | --- |
| Date | timestamp, or `invalid` | none |
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
| | `6073cb13` | 373,197 | 105,282 | 89,193 |
| | Δ | −989 | −259 | −225 |
| standalone `@tanstack/db-ivm` | `8283f2e8` | 34,374 | 10,570 | 9,513 |
| | `6073cb13` | 33,391 | 10,335 | 9,299 |
| | Δ | −983 | −235 | −214 |

All numbers come from an esbuild bundle of the public entry, minified.

## What earlier versions changed, and what this change keeps

The audit prototype (ledger IVM-01) and the first port of it changed the
behaviors below. This change keeps each one as the base code had it:

1. **Work cap.** The prototype wrote every header value directly to the
   hasher. Array lengths and RegExp fields then stopped counting toward
   `MAX_STRUCTURAL_HASH_WORK`, so a 1,000,000-element array was accepted
   instead of rejected. Now header values of a type that has a body go through
   `updateHasher`, as before. Date, binary, and Temporal headers still cost
   nothing.
2. **Pair memo.** The prototype entered the equality pair memo before it
   compared headers. That allocated memo entries for every Date, binary, and
   Temporal pair, and binary equality took 2.3 times as long. The first port
   moved the whole memo after `objectParts`, which copies Map and Set entries.
   Each revisit of a shared or cyclic Map then cost O(entries): 100 revisits
   of one pair made 200 entry copies instead of 2. Now the lookup comes before
   `objectParts`, and the insert comes after the markers and headers match,
   only for types with a body. That is the base order.
3. **Arrays from another realm.** `instanceof Array` is false for an array
   from another realm, so both versions give it the object marker. The base
   equality also compared lengths with `Array.isArray`. The prototype dropped
   that check. This change keeps it.
4. **Header comparison.** The first port compared headers with the `NaN`
   rule, so a RegExp whose `lastIndex` is `NaN` equaled its copy. The base
   code compared RegExp fields with `!==`. Headers now compare with `===`, and
   the header of an invalid Date is `invalid`, so all invalid dates stay equal.

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
   own properties. The fields compare with `===`, so a `NaN` `lastIndex` never
   equals itself.
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

Cyclic values are chains of arrays, Map values, Sets, or plain objects with a
back edge to an ancestor. For each one, the check asserts that
`equalHashValues` accepts a second build of the same spec and rejects a build
where one leaf holds a text that no pool value has. It also asserts that `hash` throws
`Cannot hash cyclic structural values`. These verdicts come from
construction, so the model needs no bisimulation rule.

`hash-work.test.ts` pins seven work-cap boundaries. Each case names the
largest input that fits, and the next size must throw. One more law counts Map
entry copies: equality on 100 revisits of one shared Map pair copies entries
twice, once for each side.

Limits:

- Arrays from another realm are outside the grammar. One pinned case holds
  equality's length check. Hashing gives such an array the object marker, so
  `[1, <hole>]` and `[1]` from another realm hash equal but compare unequal.
  This mismatch is present on the base revision too.
- Map and Set order sensitivity, and ignored Map/Set properties, are pinned
  current behavior. No contract promises them.
- Getters and proxies are outside the grammar.
- A RegExp with a `NaN` `lastIndex` is outside the grammar. One pinned case
  holds strict comparison. Hashing normalizes `NaN`, so that pair hashes equal
  but compares unequal. This mismatch is present on the base revision too.
- Cycles through a RegExp property, a Map key, or a symbol-keyed property are
  outside the grammar. So are pairs that differ only in where a back edge
  points, such as `a = [a]` against `b = [[b]]`. Those need a bisimulation
  model.
- `hash` and `equalHashValues` still list enumerable own keys in two ways
  (`Object.keys` plus symbols, and `Reflect.ownKeys`). The oracle's hidden
  non-enumerable properties catch drift between them: mutant N16 fails.
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
| split | a shared child becomes two copies, one of them changed |

- **Reconstruction:** 17 pinned pairs hold one rule each. Four more pinned
  cases hold the Temporal tag, the cross-realm length check, strict RegExp
  field comparison, and a shared child against two different copies. One case
  builds the same shared/copied spec with 39 seed pairs.
- **Ablation and exclusion:** the mutants below.
- **Range:** the positive execution witness requires the fixed campaign
  (seed `2026930`, 300 pairs) to reach all 20 value kinds and all eight
  mutation classes, to give a `false` verdict for header, hole, retype,
  replace, and split mutations, and to give only `true` for unmutated pairs.

Each run executes a fixed campaign and a random campaign of 300 pairs for
acyclic values, and the same for cyclic values.
`TANSTACK_DB_IVM_HASH_IDENTITY_SEED` and `TANSTACK_DB_IVM_HASH_IDENTITY_PATH`
select a direct replay.

### Source mutants on unchanged production (`8283f2e8` sources)

All rows use the tests at `6073cb13`. The columns count failures:

- **Identity oracle:** `hash-identity-oracle.property.test.ts` (27 cases).
- **Work-cap pins:** the seven boundary cases in `hash-work.test.ts`.
- **Pre-existing:** every other db-ivm test, with `hash-work.test.ts` at its
  `origin/main` version (589 tests).

| Mutant | Identity oracle | Work-cap pins | Pre-existing |
| --- | --- | --- | --- |
| W1: equality ignores RegExp `lastIndex` | assertion failure (4) | 0 | 3 |
| W2: equality ignores array length | assertion failure (4) | 0 | 3 |
| W3: equality ignores the container kind | assertion failure (5) | 0 | 3 |
| W4: binary equality compares only lengths | assertion failure (3) | 0 | 3 |
| W5: Temporal equality compares only tags | assertion failure (2) | 0 | 0 |
| W6: registered handles compare structurally | assertion failure (3) | 0 | 3 |
| W7: equality ignores symbol keys | assertion failure (3) | 0 | 3 |
| W8: a Set hashes with the array marker | assertion failure (3) | 0 | 0 |
| W9: hashing skips symbol keys | assertion failure (3) | 0 | 7 |
| W10: hashing omits the array length | assertion failure (3) | 6 | 2 |
| W11: invalid dates compare with `===` | assertion failure (3) | 0 | 0 |
| W12: equality compares large binary values by content | assertion failure (1) | 0 | 3 |

A first mutant for W11, "Date equality accepts a non-Date", survived every
test. It is equivalent in this domain: the earlier `typeof` guard rejects a
Date compared with a primitive, and no generated object has `getTime`.

### Source mutants on the refactor (`6073cb13`)

| Mutant | Identity oracle | Work-cap pins | Pre-existing |
| --- | --- | --- | --- |
| N1: a Set uses the Map marker | assertion failure (3) | 0 | 0 |
| N2: equality skips header values | assertion failure (7) | 0 | 15 |
| N3: the binary header holds only the length | assertion failure (3) | 0 | 3 |
| N4: header-only types compare equal before their headers | assertion failure (5) | 0 | 6 |
| N5: header values skip the work counter (the prototype) | 0 | assertion failure (6) | 0 |
| N6: hashing drops symbol keys | assertion failure (3) | 0 | 7 |
| N7: a RegExp has no body | assertion failure (2) | 1 | 0 |
| N8: a Map body holds only values | assertion failure (3) | 0 | 7 |
| N9: the Temporal header drops the tag | assertion failure (1) | 0 | 0 |
| N10: registered handles compare structurally | assertion failure (3) | 0 | 3 |
| N11: the cross-realm length check is removed | assertion failure (1) | 0 | 0 |
| N12: the revisit check keys on the left object only | assertion failure (3) | 0 | 0 |
| N13: equality skips values under symbol keys | assertion failure (2) | 0 | 0 |
| N14: headers compare with the `NaN` rule (the first port) | assertion failure (1) | 0 | 0 |
| N15: the revisit lookup follows `objectParts` (the first port) | 0 | 0 | 0 |
| N16: hashing counts non-enumerable string keys | assertion failure (3) | 6 | 0 |

N15 changes only work, not identity. The entry-copy law in
`hash-work.test.ts` rejects it with an assertion failure (1 case).

History of the grammar gaps:

- N1, N8, N9, and N11 survived the first oracle (`c0182397`). `b7455952` adds
  Sets of generated values, a Map key rename, a Map-to-Set retype, and two
  pinned cases.
- N12, N13, N14, and N15 came from review of `b7455952`. `6073cb13` adds the
  split mutation, mutations of values under symbol keys, the strict RegExp
  pin, and the entry-copy law.

Eleven mutants pass every pre-existing db-ivm test: W5, W8, W11, N1, N5, N9,
N11, N12, N13, N14, and N15.

## Performance

`hash` runs for structural keys and unkeyed consolidation. `equalHashValues`
runs only in `topKBatch`, for a key with more than one entry in one batch.

Each timing process loads one implementation and runs every workload five
times after two warm-up passes. Most workloads use 20,000 values. Processes
alternate, and each ratio is the median of 15 processes of each
implementation. The machine had a load average of 4.5 to 10 during the run.

| Workload | A/A | A/B |
| --- | ---: | ---: |
| hash rows (6 fields with a Date and an array) | 1.011 | 1.017 |
| hash join keys (`[number, string]`) | 1.068 | 1.129 |
| hash binary (16 bytes) | 0.973 | 1.104 |
| hash nested (objects, arrays, Map, Set) | 1.024 | 0.897 |
| hash dates (one valid, one invalid) | 1.043 | 0.710 |
| equality rows | 1.020 | 0.964 |
| equality join keys | 1.045 | 1.388 |
| equality binary | 1.021 | 1.300 |
| equality nested | 0.984 | 0.989 |
| equality with 2,000 revisits of one shared Map | 1.003 | 0.739 |

Each ratio is new time over base time. The A/A control compares two copies of
the base code. Its noise reached ±7% in this run and ±10% in earlier runs.

- Hashing is neutral or faster, except binary values, which are about 10%
  slower. The murmur stream writes two bytes for each string character, and
  the base code wrote each byte once.
- Equality on small distinct pairs is 1.3 to 1.4 times slower for join keys
  and binary values. Each side now builds a parts tuple and a header array.
  `equalHashValues` runs only in `topKBatch` for a key with more than one
  entry in one batch, so this cost stays on a rare path.
- Equality over a shared Map is faster than the base, and it copies entries
  once for each distinct pair.

The harness is not checked in.

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
| ORC-009 | The model does not use production's marker/header/body split. It encodes each contract rule directly on spec kinds. `ref` is production's reference leaf. The oracle declares two model-only kinds. `twice` is one child that the driver shares or copies. `back` is a back edge to an ancestor. |
| ORC-010 | fast-check reports the seed, path, and shrunk pair. Assertion messages give the mutation class and both identities. |
| ORC-011 | The Map/Set order rule, the cross-realm mismatch, and the `NaN` `lastIndex` mismatch are shared current behavior. The limits name them instead of hiding them. |
| ORC-012 | This record ties the reviewed revisions, outcome classes, limits, and performance evidence to the coverage map. |

## Verification

On `6073cb13`, the following passed:

- `packages/db-ivm` Vitest: 42 files, 624 tests, no type errors.
- `packages/db-ivm` `tsc --noEmit`: no errors.
- `packages/db` Vitest, typecheck off: 193 files, 6,830 tests.
- `pnpm test:oracles`: 49 `@tanstack/db` files with 2,838 tests, and 16
  `@tanstack/query-db-collection` files with 454 tests and 1 todo.
- `pnpm test:minified-db`: error names, index metadata, query rows, and live
  updates.

The environment was Node `v24.19.0` and Vitest `3.2.4` on Darwin arm64.

## External review follow-up at `33603a2f`

The executable fix at `33603a2f` follows reviewed PR head `f4c390a6` and
base `0122da80`. An external review found that the refactor used independent
31-bit random hash numbers as equality type discriminators. Those numbers can
collide even though the value types differ. With a fresh module and controlled
`Math.random` draws, making only the Map and Set marker numbers equal made
`equalHashValues(new Map(), new Set())` and its reverse return `true` on
`f4c390a6`; both returned `false` on the base. Making the Map and array numbers
equal made Map-to-array return `true` and array-to-Map return `false` on the PR;
both directions returned `false` on the base. Each probe observed 19 draws.

The new pinned oracle first failed on the unmodified PR at the Map/Set
assertion (`expected true to be false`). Each type marker now carries its
original random hash number in a distinct private object. Hashing writes that
number; equality compares the marker objects by identity. This keeps the
shared type dispatch and its random hash values while separating equality
from numeric marker collisions. The same controlled probes then returned
`false` for both pairs in both argument orders. The oracle also checks that
`topKBatch` retains one Map retraction and one Set addition for the same key.
The full db-ivm suite passed 625 tests in 42 files; `tsc --noEmit -p
packages/db-ivm/tsconfig.json`, Prettier, and `git diff --check` passed.

The test checks equality type separation for empty Map/Set and Map/array pairs
under forced collisions, plus the corresponding `topKBatch` output. Distinct
marker objects cover the other supported carrier types by the same invariant;
the test does not prove hash collision freedom or all live-query histories.
The generated Map grammar still uses only the string keys `a`, `b`, and `c`.
Numeric, symbol, object, and reference keys need another grammar axis or a
pinned witness before the oracle claims those legal cases.

Three other external suggestions remain optional. The `if (body)` test in the
header loop is invariant, but runs at most three times for a RegExp and once
for an array. Distinct object comparisons allocate two parts tuples; a
Map/Set mismatch copied one entries iterator on both the PR and base, while a
binary/Date mismatch newly calls `String.fromCharCode` once. A direct type
short-circuit would duplicate the shared dispatch without an established hot
path need. For a fresh 16-byte binary value, a deterministic counter observed
56 `writeByte` calls on the PR and 40 on the base. The earlier review's 10%
binary timing and 1.3–1.4× small-pair equality timing were not rerun for this
fix. Reintroducing specialized binary hashing remains a conditional
performance follow-up, not part of this correctness repair.
