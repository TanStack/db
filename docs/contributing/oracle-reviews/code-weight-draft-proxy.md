# Code weight: simplify the draft proxy and share its equality walker

Reviewed executable revision: `556cbd8ff` (base `18abceee4`, the fetched
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
- `fcc353d5d` through `a49ae90e3` fix the bugs that a second review found. Each
  fix extends an oracle first. See Fixes from the second review.
- `31b2a6bd4` removes draft code that only bought speed. See Code weight over
  speed.
- `b825e6483` fixes a CodeRabbit finding in the `defineProperty` fix: a
  non-configurable property with an object value threw. See Fixes from the
  second review.
- `0ce101acf` fixes two more lost-write classes from CodeRabbit review:
  accessor definitions and typed-array mutator methods.
- `cbd2aff06` and `556cbd8ff` act on a loss audit of these oracles against
  `docs/contributing/oracle-tests.md`. They fix one bug, make the array and
  typed-array laws generated, and close the audit's grammar, checkpoint, and
  replay gaps.
- `7e5dfee25` fixes three bugs that code review found in the earlier fixes:
  class write-backs, writes after `Object.freeze`, and `subarray` reads.

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
loop made every draft 8% to 17% slower, so the refactor first kept the
original two-loop form. `31b2a6bd4` adopts the shorter loop. See Code weight
over speed.

| Consumer bundle (esbuild, `es2020`) | min | gzip | brotli |
| --- | ---: | ---: | ---: |
| full public API | −1,445 (−0.41%) | −343 (−0.33%) | −108 (−0.12%) |
| collection with a filtered live query | −1,445 (−0.54%) | −363 (−0.46%) | −279 (−0.41%) |
| local-only collection with an insert, an update, and a delete | −1,441 (−1.18%) | −350 (−1.00%) | −223 (−0.72%) |
| local-only collection with one insert | −1,441 (−1.18%) | −350 (−1.00%) | −227 (−0.73%) |

Each row bundles the built `dist`, with private members renamed, for base and
`31b2a6bd4` under the same `package.json`. The refactor alone (`1a07cd3ce`)
saved 1,739 minified and 453 gzip bytes on the full public API. The fixes from
the second review added 917 minified and 303 gzip bytes. `31b2a6bd4` then
removed 623 minified and 193 gzip bytes of speed-only code.

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

## Fixes from the second review

A second review found one regression in the refactor and several bugs that
`main` also has. Each fix extends an owner first, so the new law fails before
the fix. Bytes are for the full public API, minified and gzip, against the
commit before.

| Commit | Bug | Owner law | Fails on `main` | Bytes |
| --- | --- | --- | --- | ---: |
| `fcc353d5d` | A nested add-then-delete, a fully reverted nested object beside a changed sibling, and a key added as `undefined` left wrong changes. | Revert oracle: nested delete op and nested round-trip property. | 6 of 24 cases | +138 / +49 |
| `36030ef8f` | The refactor cloned a typed array with `new Ctor(source)`, so a subclass that does not forward its argument cloned empty. A typed array of `NaN` never equaled itself. | Revert oracle: `Float64Array`, `Uint8Array`, and a subclass, with index writes. `utils.property`: typed elements compare like numbers. | NaN cases only | +133 / +53 |
| `967a28c1d` | The native iterator bound to the draft made `for...of` over 200 numbers 4 times slower than `main`. | Iteration contract: arrays visit and publish what a native array does, with an edit while the iterator is open. | none (performance) | +293 / +93 |
| `5b4049cdf` | General mode allocated a draft entry list for every Map. | Existing Map mutants N6, N11, N14. | none (performance) | −5 / +5 |
| `b57d60022` | `at`, `slice`, `concat`, `flat`, `toReversed`, `toSpliced`, and `with` returned raw elements, so a write through them was lost. A search for a draft element failed, and `constructor` was a bound copy. | `proxy.test.ts`: every non-mutating method of `Array.prototype`, against a native array. | 15 of 39 cases | +38 / +16 |
| `38d8ba78f` | `Object.defineProperty(draft, key, { value })` threw unless the descriptor set `writable`. | `proxy.test.ts`: six definitions against a native row. | 3 of 6 cases | +8 / +8 |
| `815432ebd` | Two URLs, or two instances whose state is in private fields, were equal, so a draft dropped a write that replaced one. | Revert oracle: URL values and a private-field class, with a write-twice property. `utils.property`: class and identity law. | both campaigns | +312 / +79 |
| `b825e6483` | `38d8ba78f` defined a clone, so a non-configurable object value broke the Proxy invariants and threw. `get` would also have wrapped it. | `defineProperty` law: a new key with only an object value, with identity where the invariants require it. | throws on `main` too | +9 / +5 (module only) |
| `0ce101acf` | Defining a getter over a field reported no change. `fill`, `set`, `sort`, `reverse`, `copyWithin`, and writes through `subarray` on a typed-array draft changed the private copy without a change. | `proxy.test.ts`: every method of `TypedArray.prototype` against a native typed array, and two getter definitions. | 6 of 31 methods, 2 of 2 getters | +70 / +25 (module only) |
| `7e5dfee25` | The class rule made writing back the row's own class instance a change, because draft snapshots hold class instances as plain objects. After `Object.freeze(draft)`, a nested write was lost. A `subarray` read counted as a change. | Revert oracle: a keyed class instance in original rows. `proxy.test.ts`: rows after freeze, seal, or a fixed key against native rows, and the typed-array law with and without a write. | 7 oracle cases and 3 pinned cases on `ca0a2170c` | about +160 / — (proxy and utils modules) |
| `cbd2aff06` | `sort`, `reverse`, `fill`, and `copyWithin` on a draft returned the private copy, not the draft. `main` has the same bug. | N: generated rows record whether a method returned the array itself. | the four self-returning mutators, on arrays and typed arrays | small (one comparison) |
| `556cbd8ff` | No product bug. R's grammar could not write back the row's own object, the frozen-key boundary had no nearby witness, and the two-step callback property had no fixed campaign or replay. | R: same-object reverts. T: sealed and read-only configurable keys. `proxy.test.ts`: campaigns and replay. | F4 survived before the read-only configurable case | 0 |
| `a49ae90e3` | None. A detached stored method must throw, as on a native row. | `proxy.test.ts` stored-function law. | passes | 0 |

Design decisions for these fixes:

- **Typed-array class.** Draft equality treats a typed array of another class
  as a change. `deepEquals` still ignores the class, as `utils.test.ts` has
  pinned since #434.
- **Array read methods.** Every non-mutating method reads through the draft.
  `b57d60022` first ran searches, `join`, `keys`, and `toString` on the copy
  for speed. `31b2a6bd4` removed that list. Running the element methods on the
  copy and then replacing elements with drafts was faster but cost 167 more
  gzip bytes.
- **Classes and keyless objects.** In both modes, instances of two different
  classes differ. A plain or null-prototype object from any realm compares by
  keys with any class, because draft snapshots and plain JSON hold class
  instances as plain objects. (`815432ebd` first made a plain object differ
  from a class instance; `7e5dfee25` reverted that after review found that
  writing back the row's own instance became a change.)
  A class instance without enumerable keys equals only itself. URLs compare
  by `href`, because a draft copies a URL by its `href`; by identity, an
  untouched URL would differ from its own snapshot.

The law that takes its methods from `Array.prototype` closes a whole class: a
new built-in method fails the law until it has arguments. Its last case also
caught the bound `constructor`.

Limits that remain:

- A draft reads a class instance of the original row as a plain object, so a
  private-field getter reads `undefined`. The detachment contract owns that
  boundary. The revert oracle writes class instances but never starts with
  one.
- A built-in method called through `this` on a nested Map or Set draft, such
  as `Map.prototype.get.call(this.m, key)`, throws, because the receiver is a
  Proxy. This is a Proxy limit.
- Reading an object under a frozen or fixed key of a draft counts that key as
  changed, because the Proxy invariants require the raw copy. The row may
  publish an equal value.
- Writing back a keyless class instance of the original row counts as a
  change, because the snapshot holds it as an empty plain object.
- `DataView` setters on a draft are not tracked. No owner generates a
  `DataView`.
- A mutator method that changes nothing, such as `sort` on a sorted array or
  `add` of a present Set member, counts as a change, so the row publishes an
  equal value. Arrays, Maps, and Sets did this on `main`. Typed arrays do too
  since `0ce101acf`. This is a deliberate limit: a revert check after mutators
  would cost bytes to avoid a publish of an equal value.

| Mutant | Owners |
| --- | --- |
| T1: typed clone by constructor argument | assertion failure (7/470) |
| T2: typed elements compare with `!==` | assertion failure (9/470) |
| T3: draft ignores typed-array class | assertion failure (1/470) |
| I1: iterator yields raw elements | assertion failure (9/488) |
| I2: `entries()` yields no index | assertion failure (7/488) |
| I3: iterator records a wrong parent edge | assertion failure (19/488) |
| I4: iterator caches the length | assertion failure (12/488) |
| I5: `values()` reads the raw copy | assertion failure (2/488) |
| I6: `entries()` reads the raw copy | assertion failure (2/488) |
| A1: element methods read the copy | assertion failure (42/527) |
| A2: searches do not unwrap a draft | assertion failure (5/527) |
| A3: `slice` runs on the copy | assertion failure (2/527) |
| A4: `constructor` is bound | assertion failure (1/527) |
| A5: searches read through the draft | survives (equivalent) |
| K1: no class check | assertion failure (4/538) |
| K2: keyless instances compare by keys | assertion failure (5/538) |
| K3: URLs compare by identity | assertion failure (10/538) |
| K4: a null prototype is another class | assertion failure (2/538) |
| K5: any two URLs are equal | assertion failure (4/538) |
| K6: empty arrays compare by identity | assertion failure (8/538) |
| K7: a URL equals a non-URL with the same `href` | assertion failure (2/538) |

I4 first survived every owner, because no test edited an array while an
iterator was open. The iteration contract's array law closes that gap. K7
first survived too, and `utils.property` now compares a URL with an object
that inherits the same `href`. A5 gives the same results and is only slower:
searches through the draft compare memoized drafts.

## Code weight over speed

Drafts run inside `collection.update` callbacks. These calls are rare and
almost never touch large values, so draft speed does not matter, and bytes
do. `31b2a6bd4` removes code that only bought speed:

| Removed | Speed it bought | Law that still owns the behavior |
| --- | --- | --- |
| The light array iterator from `967a28c1d` | `for...of` over 200 numbers: 0.98 of `main` instead of 4.0 | Iteration contract, array law |
| The list of array methods that ran on the copy | `join()` on 50 numbers: 1.03 instead of 2.8 | `Array.prototype` law in `proxy.test.ts` |
| The primitive fast path in the `get` trap | `slice` on small arrays | Every proxy owner |
| The two-loop `deepClone` key walk | 8% to 17% for each draft | Detachment contract key-class law |
| The typed-array element loop (`TypedArray#set` copies instead) | none | Revert oracle typed values |
| The deferred class check in `deepEquals` | unequal rows exit before the class check | Class law in `utils.property` |

Mutants of each new form fail the owners:

| Mutant on `31b2a6bd4` | Owners |
| --- | --- |
| C1: clone copies non-enumerable strings | assertion failure (2/539) |
| C2: clone drops every symbol | assertion failure (10/539) |
| C3: clone drops non-enumerable symbols | assertion failure (2/539) |
| T1: typed clone stays empty | assertion failure (13/539) |
| N3: the iterator reads the raw copy | assertion failure (16/539) |
| A1: read methods run on the copy | assertion failure (56/539) |
| A2: searches run on the copy | assertion failure (4/539) |
| K1: no class check | assertion failure (4/539) |
| K2: keyless instances compare by keys | assertion failure (5/539) |
| K3: URLs compare by identity | assertion failure (10/539) |
| K4: a null prototype is another class | assertion failure (2/539) |
| K5: any two URLs are equal | assertion failure (5/539) |
| K6: empty arrays compare by identity | assertion failure (8/539) |
| D1 (on `b825e6483`): `get` wraps a read-only non-configurable value | crash, the reported TypeError (1/540) |
| D2 (on `b825e6483`): `defineProperty` stores a clone | crash, the reported TypeError (1/540) |
| G1 (on `0ce101acf`): accessor definitions untracked | assertion failure (2/574) |
| G2 (on `0ce101acf`): every definition tracked, sealing too | assertion failure (1/574, the existing `Object.seal` test) |
| Y1 (on `0ce101acf`): typed-array mutators untracked | assertion failure (6/574) |
| Y2 (on `0ce101acf`): `subarray` untracked | assertion failure (1/574) |
| Y3 (on `0ce101acf`): typed-array `set` untracked | assertion failure (1/574) |
| R1 (on `7e5dfee25`): a plain object differs from a class | assertion failure (10/611) |
| R2 (on `7e5dfee25`): no class check | assertion failure (2/611) |
| R3 (on `7e5dfee25`): the keyless rule needs `a` on the class side | assertion failure (4/611) |
| F1 (on `7e5dfee25`): a frozen-key object read is not a change | assertion failure (2/611) |
| F2 (on `7e5dfee25`): a frozen-key primitive read is a change | assertion failure (1/611) |
| S1 (on `7e5dfee25`): `subarray` returns a plain view | assertion failure (2/611) |
| S2 (on `7e5dfee25`): `subarray` marks a change on call | assertion failure (1/611) |
| M1 (on `cbd2aff06`): mutators return the raw copy | assertion failure (12/587) |
| M2 (on `cbd2aff06`): mutators always return the draft | assertion failure (10/587) |
| A1, A2, N3, Y1, Y3, S1, S2 (rerun on `cbd2aff06` against N) | assertion failure (55, 21, 23, 7, 3, 3, 3 of 587) |
| F3 (on `556cbd8ff`): the frozen-key boundary checks configurability alone | assertion failure (1/589) |
| F4 (on `556cbd8ff`): the frozen-key boundary checks writability alone | assertion failure (1/589); survived before the read-only configurable case |

The I and A3 to A5 mutants in the previous section apply to code that
`31b2a6bd4` removed.

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

### Timings for the fixes

These timings describe `a49ae90e3`. `31b2a6bd4` removed the iterator and
the copy-method list for code weight, so the iteration and `join` rows no
longer hold. These runs used 11 processes of each variant. The machine was loaded, and an
A/A control stayed within ±5%.

| Workload | Ratio | Compared with |
| --- | ---: | --- |
| `for...of` and spread over 200 numbers | 0.98 (4.02 before `967a28c1d`) | `main` |
| `for...of` over 200 objects | 0.99 | `main` |
| `slice(0, 1)` on a 2-element draft array | 1.45 | the commit before `b57d60022` |
| `slice()` on a 50-number draft array | 5.6 | the commit before `b57d60022` |
| `join()` on a 50-number draft array | 1.03 | the commit before `b57d60022` |
| `deepEquals`: equal rows | 1.06 to 1.08 | the commit before `815432ebd` |
| `deepEquals`: unequal rows | 1.00 | the commit before `815432ebd` |

The iterator first used a generator, which made object elements 1.4 times
slower. It also named the `get` trap as a function expression, which made
every draft write about 7% slower. The kept iterator is a module function. It
calls the trap through the handler object and skips primitives. The class
check in `deepEquals` runs after the keys match, so an unequal row exits
before it.

## ORC-001 through ORC-014

The owners are:

- **R**, the revert oracle `proxy-revert-oracle.property.test.ts`: four
  generated properties over one grammar (general histories, partial reverts,
  nested round trips, and URL and keyless writes).
- **N**, the native-methods oracle `proxy-native-methods.property.test.ts`:
  generated array and typed-array calls compared with native values.
- **T**, the native-differential tables in `proxy.test.ts`: stored functions,
  `defineProperty`, and frozen and sealed drafts. These are bounded
  enumerations, not important generated properties.
- **U**, the laws this change adds to `utils.property.test.ts`.

| Requirement | Result |
| --- | --- |
| ORC-001 | R states the `getChanges()` contract, nine draft-equality rules, the three laws, their authority (rules 1 to 6 from `src/proxy.ts` and earlier tests, rules 7 to 9 from this record), and the limits. N and each T table open with the contract they check, against a native value. |
| ORC-002 | R's model is an encoding of plain-data specs. It does not import `draftValuesEqual`, `deepEquals`, or `deepClone`, and it never reads a draft. N and T take the expected result from the same call on a native value. U builds each pair with a known expected relation. |
| ORC-003 | R keeps contract, model (`canon`, `step`, `expectedChanges`), grammar (the arbitraries), driver (`drive`, `realize`), and check (`expectHistory`) apart in one file. N's opening comment names the same five parts. |
| ORC-004 | See ORC-004 controls below. |
| ORC-005 | R and N drive the draft that `createChangeProxy` or `withChangeTracking` returns. The checkpoint is the end of the callback, before publication: R compares `getChanges()` and the draft, and N the call result and the published row. Positive witnesses: R's fixed general campaign reaches every operation, both revert outcomes, 20 or more same-object reverts, and a class-instance write-back. R's URL and keyless witness requires 10 or more of each write. N's witnesses reach every method, empty rows, holes, nested objects, `NaN`, and `-0`. The partial-revert and nested round-trip properties reach their histories by construction. |
| ORC-006 | Every mutant in this record has an outcome class. P4 and A5 are equivalent within the tested domain, with reasons. |
| ORC-007 | R, N, and the two-step callback property each run a fixed campaign (seeds `2026101`, `2026102`, `2026103`) and a random one with the same property, grammar, check, and budget. Replay: `TANSTACK_DB_PROXY_REVERT_*`, `TANSTACK_DB_PROXY_NATIVE_*`, and `TANSTACK_DB_PROXY_CALLBACK_*` accept a seed and path and run only the replay. Under mutant M1, a captured random failure (`[[], "sort", 0]`) replayed directly to the same counterexample. U uses the replay interface `utils.property.test.ts` already has. |
| ORC-008 | R's model is a stateless recomputation over specs, and N and T use native values, so this requirement does not apply. |
| ORC-009 | Terms match `proxy.ts` and `utils.ts`: draft, revert, changes, draft equality. Model-only spec kinds such as `rows` and `point` are named in R. |
| ORC-010 | fast-check reports seed, path, and shrunk input. R's messages give the field and the history. N's give the row, method, and argument. |
| ORC-011 | N and T are native-differential, a second formulation independent of R's model. No shared semantic fault was found that would call for another one. |
| ORC-012 | This record ties the revisions, outcome classes, limits, and performance evidence to the coverage map. See Bug-class closure below. |
| ORC-013 | See Reusable boundary laws below. |
| ORC-014 | No controlled provider or host supplies a premise. Drafts run in-process on the JavaScript engine, so this requirement does not apply. |

### ORC-004 controls

**R (all four properties share one grammar).**

- **Reconstruction:** the pinned histories rebuild each rule and each reported
  bug in R's own grammar and check. These include a nested add-then-delete,
  a stale parent edge, a key added as `undefined`, a typed-array subclass,
  typed `NaN`, a URL write, a keyless write, and a class-instance write-back.
  The general grammar reaches each of their shapes. `556cbd8ff` added the
  same-object revert so that a write-back of the row's own object is
  generated, not only pinned.
- **Ablation:** each mutant in Mutant calibration and Fixes from the second
  review removes one rule, edge, or clause. Every one fails an owner, except
  P4, which is equivalent.
- **Range:** three fields. Values are primitives `0`, `-0`, `1`, `NaN`,
  `"a"`, `"b"`, `null`, and `undefined`; Dates (including invalid);
  RegExps with `lastIndex` 0 or 1; Maps of up to two entries, with values
  that may be Sets; Sets of up to two members; arrays of up to three slots
  with holes; objects with up to two string keys and a symbol key; arrays of
  rows; typed arrays of up to three elements (three classes); URLs; a keyed
  class instance; and, as written values only, a keyless class instance. The
  marginal cases are empty containers, `-0` and `NaN`, holes, and an absent
  key against a key holding `undefined`. Typed-array subclasses, URLs,
  keyless instances, and the class write-back each exposed a missing rule when
  first added.
- **Exclusion:** `applicable` rejects a nested write on a value that is not an
  object, an index write beyond the length or into a `Uint8Array`, and a
  revert of a field that is absent both originally and now. Model and driver
  skip the same operations. Mutator methods and top-level symbol writes are
  outside the grammar.

**N (arrays and typed arrays).**

- **Reconstruction:** the rows of the earlier pinned tables run for every
  method as fixed cases.
- **Ablation:** mutants A1, A2, N3, M1, M2, Y1, Y3, S1, and S2 each fail an
  owner.
- **Range:** array rows of up to four slots from `0` to `3`, `undefined`,
  holes, objects, and nested arrays of up to two objects. Typed rows of up to
  four values from `0`, `-0`, `1`, `2`, `NaN`, and `3.5`. An index-shaped
  argument from 0 to 4, so negative and out-of-range indexes occur. Every
  method of the built-in prototypes. The marginal cases are empty rows, holes,
  and duplicate elements.
- **Exclusion:** every generated call is legal JavaScript, and a native throw
  is an observation that the draft must reproduce. A callback that writes is
  outside the grammar.

**U.** The laws use small fixed value sets with the pinned pairs inside the
same property. Mutants K1 to K7 and R1 to R4 are the ablations. Every pair in
the domain is legal, so no exclusion applies.

The two-step callback property was already on `main`. This change only adds
its campaigns and replay, and it makes no new grammar claim for it.

### Reusable boundary laws (ORC-013)

| Law | Premise witness | Nearby witness | Wrong boundary it rejects |
| --- | --- | --- | --- |
| A key that is both read-only and non-configurable returns the raw value and counts as changed | freeze, then a nested write | a sealed key, and a read-only configurable key, read without a change | F3 (configurability alone), F4 (writability alone) |
| Two different classes differ, and a plain object compares with any class by keys | `Point` against `Other` | `Point` against a plain object, and a draft write-back | R1 (a plain object differs from a class), R2 (no class check) |
| A keyless class instance equals only itself; a URL compares by `href` | `Secret` against `Secret` | `Secret` against `{}`, and a URL against an object that inherits the same `href` | K2, R3, K7 |
| Typed-array class counts only in draft mode | the draft `Float64Array` to `Uint8Array` write | `deepEquals` of `Uint8Array` and `Int8Array` | T3, and the #434 test against a class check in general mode |
| Every non-mutating array method reads through the draft | generated rows for every method | searches with draft elements and duplicates | A1 (all methods on the copy), A2 (searches on the copy) |

### Bug-class closure (ORC-012)

Each class below is bounded by contract, histories, production path, and
observation. Open cells name their owner.

| Class | Boundary | Open in-scope cells |
| --- | --- | --- |
| Stored functions read back bound | Any draft read path (field, index, iterator, spread, Map value, Set member, `Object.values`) on the `get` trap; observed by identity and `getChanges()` | A built-in method called through `this` on a nested Map or Set draft rejects the Proxy (T, a Proxy limit) |
| Array and typed-array methods lose writes or identity | Every built-in method on generated rows (N); observed by result, identity, returned self, and the published row | A callback that writes (N, outside the grammar); a no-op mutator publishes an equal value (N and R, declared limit) |
| `defineProperty` throws or loses changes | Value, accessor, read-only, and fixed definitions (T); observed by result, descriptor, read, and changes | None known |
| Nested reverts leave stale changes | R's nested, delete, and round-trip histories; observed by `getChanges()` | Mutator methods have no revert check (R, declared) |
| Equality hides writes of URLs, keyless objects, and classes | R's URL, keyed, and keyless class values and U's pairs; observed by `getChanges()` and `deepEquals` | Writing back a keyless instance of the original row is a change; a draft reads a class instance of the original row as a plain object (detachment owner) |
| Frozen drafts lose nested writes | Freeze, seal, and fixed keys (T); observed by the published row | An object read under a frozen key publishes an equal value (T, declared) |

None of these classes has a known reachable counterexample to its claimed law.
The open cells are listed in the coverage map's Drafts row.

### Guide prompts that do not apply

The guide's reusable boundary-law checklist targets adapter and lifecycle
oracles. Drafts have no provider, classifier, transport, `await` boundary, or
acquired resource, so real-provider conformance, minimal ambiguity, name
invariance, await-boundary transitions, local/transport refinement, and
partial-construction cleanup do not apply. Representation symmetry appears as
the class rule above. Value-and-work refinement does not apply, because no
work bound is promised.

## Verification

On `556cbd8ff`, which includes `origin/main` at `3463cf8ad`, with the built
`dist`:

- `packages/db` Vitest, typecheck off: 199 files, 7,801 tests.
- `packages/db` `tsc --noEmit`: no errors.
- `pnpm check:mangle`: 368 names.
- `pnpm test:minified-db`: error names, index metadata, query rows, and live
  updates.
- `pnpm --filter @tanstack/db test:dist`: 5 files, 290 tests.

The environment was Node `v24.19.0` and Vitest `3.2.4` on Darwin arm64.
