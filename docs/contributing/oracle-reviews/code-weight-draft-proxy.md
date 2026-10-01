# Code weight: simplify the draft proxy and share its equality walker

Reviewed executable revision: `1a07cd3ce` (base `18abceee4`, the fetched
`origin/main` at review time). This record follows in a documentation-only
commit.

- `a6445a7c2` adds the draft revert oracle and the clone and `deepEquals`
  laws on unchanged production code.
- `639ed5a1e` extends the revert oracle after a refactor mutant survived. The
  extension also passes on unchanged code.
- `6b68b8dc3` is the refactor.
- `cccaf1b9e` returns functions stored in a draft as stored, with a new
  native-differential law. This is a behavior change and a lost-write fix.
- `1a07cd3ce` applies review fixes: a stronger revert grammar and witness, a
  duplicate comment, and a redundant `key in` check in `getChanges` (about 14
  minified bytes).

## Change

`packages/db/src/proxy.ts` builds the drafts that `collection.update` and
`withChangeTracking` pass to callbacks.

- The write-only `proxyCache`, the symbol-key branches over `assigned_`, and
  the one-use `createObjectProxy` wrapper are deleted. Every writer of
  `assigned_` stores a string key (`String(prop)`, `String(index)`, or `''`),
  so the symbol branches could not run.
- The custom array iterator is deleted. Arrays bind the native
  `Array.prototype[Symbol.iterator]` to the draft, so each element read takes
  the `get` trap and its parent edge. `draft[Symbol.iterator]()` now returns a
  native Array Iterator.
- The `set` trap's revert path sets `modified` and calls `checkParentStatus` on
  its own tracker. That function already clears tracking and continues up the
  chain when every value is reverted.
- `draftValuesEqual` becomes a `draft` mode of `deepEqualsInternal` in
  `packages/db/src/utils.ts`. Draft mode keeps Map and Set order, RegExp
  `lastIndex`, and array holes. The general mode does not change.

- A function stored as data (a field, an array element, a nested object
  member) is now returned as stored. See Stored functions.

The audit prototype also rewrote `deepClone` as one `Reflect.ownKeys` loop. That
loop made every draft 8% to 17% slower, so this change keeps the original
two-loop form. See Performance.

| Consumer bundle (esbuild, `es2020`) | min | gzip | brotli |
| --- | ---: | ---: | ---: |
| full public API | −1,739 (−0.50%) | −453 (−0.43%) | −145 (−0.16%) |
| collection with a filtered live query | −1,739 (−0.65%) | −461 (−0.58%) | −356 (−0.52%) |
| local-only collection with an insert, an update, and a delete | −1,736 (−1.42%) | −441 (−1.26%) | −256 (−0.83%) |
| local-only collection with one insert | −1,736 (−1.42%) | −439 (−1.25%) | −295 (−0.95%) |

Each row bundles the built `dist`, with private members renamed, for base and
refactor under the same `package.json`.

## Why the oracle work came first

Sixteen source mutants on unchanged code model plausible mistakes in this
refactor. Before this work, eight of them passed the whole db suite (7,596
tests). Seven are real gaps:

- A partial revert treated as a full revert, which drops the remaining change
  (P2).
- A nested write under a symbol key treated as no change (E5).
- `deepClone` copying non-enumerable string keys, or dropping enumerable or
  non-enumerable symbol keys (C1, C2, C3).
- `deepEquals` comparing RegExp `lastIndex`, or treating array holes as
  differences (D2, D4).

The eighth, a wrong parent edge for array iterator elements (P4), is
equivalent under every public observation. See Mutant calibration.

A ninth (`deepEquals` comparing Maps in order) failed one unrelated test only.

### The draft revert oracle

`packages/db/tests/proxy-revert-oracle.property.test.ts` generates write
histories on a draft of a three-field row. An operation sets a field to a new
value, reverts it to its original, deletes it, writes a nested property (a
string or symbol key), writes an array index, or writes a row property through
`for...of`. Values are primitives (including `-0` and `NaN`), Dates, RegExps,
Maps (with primitive or Set values), Sets, arrays with holes, objects with a
symbol key, and arrays of rows.

The model applies the same operations to plain-data specs and compares values
with its own encoding of draft equality. It never reads a draft. After each
history, the check asserts:

- `getChanges()` holds exactly the fields whose final value differs from the
  original, each with that value, and deleted fields as `undefined`.
- The draft reads back the model's final value.
- The original row is unchanged.

The generator also emits a revert of a field that is currently changed, so
most reverts run the `set` trap's revert branch. A second property builds
partial reverts directly: it changes two or three fields in any order, then
reverts all of them but one.

Each property runs a fixed campaign (seed `2026101`) and a random campaign:
400 general histories and 200 partial-revert histories.
`TANSTACK_DB_PROXY_REVERT_SEED` and `TANSTACK_DB_PROXY_REVERT_PATH` select a
replay. A positive witness requires the fixed general campaign to reach every
operation, a change made only under a nested symbol key, and effective
reverts: at least 10 histories where a change survives a revert, and at least
30 histories that end fully reverted. A revert counts only when the field
differs from its original before the revert. Eleven pinned histories hold one
rule each.

Review of the first version found that its witness also counted reverts of
unchanged fields, which write an equal value and do nothing. With those
excluded, the first grammar reached 10 partial and 11 full reverts in 400
histories. The changed-field revert and the partial-revert property raise
that coverage. Mutant N2 now fails 6 of the oracle's 16 cases, including both
partial-revert campaigns.

Limits:

- Map, Set, and array mutator methods (`set`, `add`, `push`) mark a value
  changed without a revert check. The native-operation tests in
  `proxy.test.ts` own them.
- Top-level symbol writes are outside the grammar. `getChanges()` does not
  report them, and the coverage map lists symbol writes as unsupported.

### Clone key classes and `deepEquals` order rules

- `proxy-detachment-contract.test.ts` pins that a draft copies a row's own
  enumerable string keys and every own symbol key, enumerable or not, and
  does not copy non-enumerable string keys. This is current behavior, not a
  promise.
- `utils.property.test.ts` adds four generated laws: `deepEquals` ignores Map
  and Set insertion order, RegExp `lastIndex`, and array holes. These are the
  rules draft equality keeps, so a shared walker must not leak one mode into
  the other.

## Stored functions

The `get` trap bound every function it returned to the private copy, so it
could call built-in methods such as `Map.prototype.get`, which reject a Proxy
receiver. That binding also applied to functions stored as data:

| Read on a draft of `{ handler: f, fns: [f], obj: { g: f } }` | `main` | refactor before the fix | now |
| --- | --- | --- | --- |
| `draft.handler === f` | false | false | true |
| `draft.fns[0] === f` | false | false | true |
| `[...draft.fns][0] === f`, `for...of` | true | false | true |
| `draft.obj.g === f` | false | false | true |

On `main`, array iteration was the only read path that kept identity, because
the custom array iterator did not take the `get` trap. The native iterator
does, so the refactor first lost identity there too.

The binding had a worse effect: a stored method saw the private copy as `this`.
A method such as `bump() { this.count++ }` then changed the copy without
tracking, and `getChanges()` reported no change. Inside `collection.update`,
that write was lost.

`cccaf1b9e` returns an own data function as stored. A call then sees the draft
as `this`, so its writes take the `set` trap. Inherited Array, Map, and Set
methods keep their draft handling.

`proxy.test.ts` adds a native-differential law. Each probe runs on a native row
and on a draft of an equal row, and the results must be equal. The probes are
field access, array index, `for...of`, spread, `includes` and `indexOf`, an
array callback, a nested field, `Object.values`, a Map value, a Set member, a
call, a function assigned during the callback, and `this` inside a stored
method. One more case checks that a write through `this` appears in
`getChanges()`. The law fails 8 of 14 cases on `main` and 10 of 14 on the
refactor before the fix.

| Mutant on `cccaf1b9e` | Owners |
| --- | --- |
| F1: every function is bound again | assertion failure (10/455) |
| F2: inherited methods are returned unbound too | assertion failure (103/455) |
| F3: the own-property check reads the original row | assertion failure (1/455) |

## Mutant calibration

"Owners" are the revert oracle and the four existing owners
(`proxy.test.ts`, `proxy-detachment-contract.test.ts`,
`proxy-iteration-contract.test.ts`, `utils.property.test.ts`). "Before" is the
owners without this change's tests. The full-suite column shows whether any
other db test caught the mutant.

### On unchanged production (`18abceee4`)

| Mutant | Before | Full suite before | Owners now |
| --- | --- | --- | --- |
| P1: a nested revert does not reach the parent | 20/417 | — | assertion failure (21) |
| P2: a partial revert is treated as full | 0/417 | 0/7,596 | assertion failure (3) |
| P3: the array iterator yields raw elements | 1/417 | — | assertion failure (4) |
| P4: the array iterator records a wrong parent edge | 0/417 | 0/7,596 | survives (equivalent) |
| C1: `deepClone` copies non-enumerable strings | 0/417 | 0/7,596 | assertion failure (2) |
| C2: `deepClone` drops symbol keys | 0/417 | 0/7,596 | assertion failure (4) |
| C3: `deepClone` drops non-enumerable symbols | 0/417 | 0/7,596 | assertion failure (2) |
| E1: draft Set comparison ignores order | 2/417 | — | assertion failure (3) |
| E2: draft Map comparison ignores order | 2/417 | — | assertion failure (3) |
| E3: draft RegExp ignores `lastIndex` | 2/417 | — | assertion failure (3) |
| E4: a draft array hole equals `undefined` | 1/417 (crash) | — | assertion failure (3) |
| E5: draft comparison ignores symbol keys | 0/417 | 0/7,596 | assertion failure (2) |
| D1: `deepEquals` compares Maps in order | 0/417 | 1/7,596 | assertion failure (2) |
| D2: `deepEquals` compares RegExp `lastIndex` | 0/417 | 0/7,596 | assertion failure (2) |
| D3: `deepEquals` compares Sets in order | 3/417 | — | assertion failure (5) |
| D4: `deepEquals` treats array holes as differences | 0/417 | 0/7,596 | assertion failure (2) |

P4 is equivalent under every public observation. An array element's parent
edge feeds only the array's own revert check, and `getChanges()` works at the
row level, where it compares each field with draft equality. A wrong edge can
make the array mark itself reverted early, but the row then compares the field
by value and still reports the change. The refactor's native iterator records
the right edge through the `get` trap.

### On the refactor (`6b68b8dc3`)

| Mutant | Owners |
| --- | --- |
| N1: a nested revert does not reach the parent | assertion failure (25/441) |
| N2: a partial revert in the `set` trap clears all tracking | assertion failure (26/441) |
| N3: the array iterator binds the raw copy | assertion failure (4/441) |
| N4: `deepClone` drops non-enumerable symbols | assertion failure (2/441) |
| N4b: `deepClone` drops every symbol | assertion failure (4/441) |
| N5: `deepClone` copies non-enumerable strings | assertion failure (2/441) |
| N6: draft Map comparison ignores order | assertion failure (3/441) |
| N7: draft Set comparison ignores order | assertion failure (3/441) |
| N8: draft RegExp ignores `lastIndex` | assertion failure (3/441) |
| N9: draft arrays use the element walk | assertion failure (2/441) |
| N10: general mode compares `lastIndex` | assertion failure (2/441) |
| N11: general mode compares Maps in order | assertion failure (2/441) |
| N12: general arrays use the key walk | assertion failure (4/441) |
| N13: draft mode is not passed into object values | assertion failure (1/441) |
| N14: draft mode is not passed into Map values | assertion failure (1/441) |

N14 first survived, because generated Map values were only primitives.
`639ed5a1e` lets Map values be nested Sets and adds a pinned case for a
reordered Set inside a Map value.

## Performance

Each timing process loads one implementation and runs each workload five
times after two warm-up passes. Processes alternate, and each ratio is the
median of 11 processes of each. An A/A control of two copies of the base
stayed within ±1%.

| Workload | A/A | Prototype loop | Kept loop |
| --- | ---: | ---: | ---: |
| draft: two writes, then `getChanges` (20,000 rows) | 1.010 | 1.012 | 0.827 |
| draft: a write, then a revert (20,000 rows) | 1.006 | 1.163 | 0.900 |
| draft: Map, Set, and array writes (10,000 rows) | 1.005 | 0.910 | 0.772 |
| `deepEquals`: equal rows (20,000) | 0.993 | 0.953 | 0.965 |
| `deepEquals`: equal rows with Map, Set, RegExp (10,000) | 1.010 | 1.019 | 1.023 |
| `deepEquals`: unequal rows (20,000) | 0.999 | 1.024 | 1.009 |
| draft: 20 Array method calls (10,000 rows) | 1.021 | — | 0.961 |

Each ratio is new time over base time. "Prototype loop" is the audit prototype.
"Kept loop" is the final code. The array-method row was measured with the
stored-function fix, which adds an own-property check before each inherited
method is handled. A second run with the fix gave 0.830, 0.876, and 0.766 for
the three draft rows above.
Bisection showed that its `deepClone` loop caused the regression: the
equality fold alone was faster (0.92, 1.00, 0.81 on the draft rows), and the
other proxy changes with the original loop were faster too (0.92, 0.93, 1.03).
`deepClone` runs twice for each draft, and the `Reflect.ownKeys` loop calls
`propertyIsEnumerable` for each key. Keeping the two-loop form costs about 18
minified bytes. The harness is not checked in.

## ORC-001 through ORC-012

| Requirement | Result |
| --- | --- |
| ORC-001 | The revert oracle's opening comment states the `getChanges()` contract, the six draft-equality rules, the three laws, the authority, and the limits. |
| ORC-002 | The model is an encoding of plain-data specs. It does not import `draftValuesEqual`, `deepEquals`, or `deepClone`, and it never reads a draft. |
| ORC-003 | The contract, model (`canon`, `step`, `expectedChanges`), grammar (`specArb`, `opArb`, `historyArb`), driver (`drive`, `realize`), and check (`expectHistory`) are separate in one file. |
| ORC-004 | Pinned histories reconstruct each rule. The mutants above are the ablations. The positive witness is the range check. The grammar excludes mutator methods and top-level symbol writes, as declared. |
| ORC-005 | The driver uses `createChangeProxy`. The positive witness shows that the fixed campaign reaches every operation and both revert outcomes. |
| ORC-006 | Every mutant has an outcome class. P4 is recorded as equivalent with its reason. |
| ORC-007 | Fixed and random campaigns share the property, grammar, check, and budget (400 runs). The replay variables select a direct replay. |
| ORC-008 | The model is a stateless recomputation over specs, so this requirement does not apply. |
| ORC-009 | Terms match `proxy.ts` and `utils.ts`: draft, revert, changes, draft equality. Spec kinds such as `rows` are model-only and named in the oracle. |
| ORC-010 | fast-check reports the seed, path, and shrunk history. Assertion messages give the field and the full history. |
| ORC-011 | No shared semantic fault calls for a second formulation. |
| ORC-012 | This record ties the reviewed revisions, outcome classes, limits, and performance evidence to the coverage map. |

## Verification

On `1a07cd3ce`, with the built `dist`:

- `packages/db` Vitest, typecheck off: 198 files, 7,636 tests.
- `packages/db` `tsc --noEmit`: only the pre-existing errors in
  `tests/conformance` that `main` also has.
- `pnpm check:mangle`: 368 names.
- `pnpm test:minified-db`: error names, index metadata, query rows, and live
  updates.
- `pnpm --filter @tanstack/db test:dist`: 5 files, 290 tests.

The environment was Node `v24.19.0` and Vitest `3.2.4` on Darwin arm64.
