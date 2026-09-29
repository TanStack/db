# BUG-10 binary query identity review

## Reviewed state and lossless finding ledger

- Base: `33a194941c8d51f8f98babb999fef2987dd6ff8b`.
- Reviewed executable head: `d03b6879`.
- Source: local code-weight audit, `BUGS_AND_ORACLE_GAPS.md` § BUG-10. The task-local ledger was opened before tests or edits.

| ID       | Original claim and proposed fix                                                                                                                                                                                                                                  | Verdict and PR action                                                                                                                                                                                           | Durable destination                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| BUG-10.1 | `resolveResolverMetadata` stores `resolver.name` in public `getIndexMetadata()`, `index:added`, and persisted `metadata.resolver`. The audit proposes a stable built-in tag and no name for custom classes. Severity: Low–Medium.                                | At reviewed head `d03b6879`, confirmed by an esbuild probe and awaiting a maintainer decision. The later decision and fix are recorded below.                                                                           | GAP-08's minified public-API lane and the Collection index metadata owner after the decision. |
| BUG-10.2 | ArrayBuffer-view query identity uses `value.constructor.name`. A user typed-array subclass changes identity when minified, including exact subset demand keys. The audit proposes `Object.prototype.toString` or a built-in prototype tag. Severity: Low–Medium. | Confirmed by a RED generated oracle and minified bundle. Fixed now with an intrinsic built-in tag for views with built-in conversion. Views with custom conversion use runtime reference identity for ordering. | Query identity output-shape oracle; GAP-08 for a general minified CI lane.                    |

The raw BUG-10 section contains two findings and no other footnotes or capped items. The audit's proposed `Object.prototype.toString` alone is insufficient. A custom tag changes that result, and Buffer needs a distinct identity. The independent prep-PR review found a further collision in the first fix: custom `toString`, `join`, or DataView tag behavior changed compiled ordering but shared a demand key. That review also found three new TypeScript errors and missing campaign wiring. All three review findings were fixed before the executable commit.

The audit reviewer found both real build dependencies and gave useful oracle targets. The report distinguished the resolver metadata decision from the settled query identity law. Its fix sketch missed conversion overrides and Buffer. Technical accuracy and signal are high; fix quality is partial. Hire recommendation: yes, with the expectation that proposed code changes receive adversarial semantic review.

## Evidence and boundary

The query identity law is: equal exact demand keys must not combine ordering predicates that can produce different results. Within views that use built-in conversion, an inherited subclass with the same element type and bytes has the same ordering behavior as its base view. Constructor names do not affect either rule.

The primary owner generates 0–8 bytes and varies an inherited Uint8Array subclass's own tag. It compares direct native relational results with compiled `gt` results for three finite row values. At each synchronous checkpoint it compares structural hashes, query identities, and exact subset demand keys. Fixed cases cover an inherited Int16Array, Buffer distinction, and custom `toString`, `join`, `valueOf`, `Symbol.toPrimitive`, and DataView tag conversion. The latter cases require distinct query or demand identities when compiled results differ. The model uses native relational comparison; it imports no production hash or classifier to compute expected results.

On the base code, the generated property shrank to bytes `[0]`. It observed `InheritedUint8Array` and `Uint8Array` in otherwise equal hashes. The same focused esbuild entry, bundled as ESM for Node 20 with minification off and on, showed a subclass name change from `InheritedUint8Array` to `wn`. That name appeared in the structural hash, query identity, and demand key. Public index metadata changed from `BasicIndex` to `Ft` in the same baseline bundle. After the fix, both builds produce `Uint8Array` identity for the inherited subclass. Both builds also keep custom-conversion demand keys distinct. The resolver metadata name still changes (`BasicIndex` versus a minified name).

A candidate that used `Object.prototype.toString` failed the generated custom-tag case at the structural hash checkpoint. A candidate that used only the intrinsic tag failed a custom `toString` case: compiled `gt` differed, but query and demand identities matched. After that was corrected, a `join` override produced the same RED demand-key collision. These probes reached assertions, rather than failing setup. They reject three plausible wrong repairs.

The executable head passes 75 focused identity tests, the named guarded replay, the package TypeScript check, changed-file ESLint, Prettier, `git diff --check`, and the Vite package build. The `test:oracles` package script now includes this owner. An explicit replay with property `query-identity.typed-array-subclass`, seed 42, and path 0 reaches one named execution. The generated law runs fixed seed 101610 and a seedless campaign with the same grammar and checks.

## ORC-001 through ORC-011

| Requirement                  | Outcome                                                                                                                                                                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ORC-001 authority and limits | Pass. Query identity's semantic contract and compiled ordering supply the law. The owner and coverage map state the bounded view and predicate domain. Resolver metadata is a separate design decision.                                 |
| ORC-002 independent judgment | Pass. Native relational comparison predicts results. The model does not call the production identity classifier.                                                                                                                        |
| ORC-003 responsibilities     | Pass. The owner states its contract, value grammar, native comparison model, compiled predicate and identity driver, and synchronous comparison checkpoint.                                                                             |
| ORC-004 grammar controls     | Pass for the bounded domain. Empty through eight-byte arrays, tag ownership, an inherited second element type, and fixed custom conversion cases separate normal identity from changed semantics. Dynamic conversion state is excluded. |
| ORC-005 path and observation | Pass. The driver calls the real compiler, query identity, structural hash, and exact demand key. It checks return values after each call. The minified probe checks the same identity functions in bundled output.                      |
| ORC-006 calibration          | Pass for named faults. Baseline constructor names, `Object.prototype.toString`, intrinsic-tag-only conversion collision, and `join` collision all failed the intended assertion.                                                        |
| ORC-007 campaigns and replay | Pass. Fixed and seedless campaigns share one property; guarded replay verifies target execution with seed and path. The package oracle campaign includes the owner.                                                                     |
| ORC-008 model minimality     | Pass. The model retains bytes and conversion behavior only. It has no production state machine.                                                                                                                                         |
| ORC-009 vocabulary           | Pass. Query identity and demand key name the production observations. The test's native comparison is a reference model, not a renamed production subsystem.                                                                            |
| ORC-010 failure and cleanup  | Pass. `withHistoryCleanup` preserves a primary assertion and any cleanup error. The Collection is cleaned after each campaign.                                                                                                          |
| ORC-011 second formulation   | Pass. Native comparison and the compiled predicate are distinct paths. The minified bundle separately challenges build-dependent class names.                                                                                           |

This record supplies ORC-012 evidence for executable head `d03b6879`. The remaining in-scope histories are mutable bytes after demand creation and conversion based on external mutable state. The query identity owner needs held-value mutation histories before claiming them. GAP-08 owns broad minified public-API CI coverage. At this reviewed head, resolver metadata awaited a maintainer's stable-tag versus diagnostic-name decision.

## Resolver metadata decision on PR #1927

After `7bcd73d9`, the maintainer chose stable public names for built-in index resolvers. This resolves BUG-10.1 for `BasicIndex` and `BTreeIndex`. The focused Collection index-events test changes both constructor `name` properties to short names, then checks the exact resolver names in `index:added` events and `getIndexMetadata()` snapshots. At `7bcd73d9`, it failed at the event checkpoint: `["a","b","CustomBasicIndex"]` instead of `["BasicIndex","BTreeIndex","CustomBasicIndex"]`. With the fix, 108 Collection event/index tests pass.

A focused Node 20 esbuild bundle exercises the public Collection API with minification off and on. Before the fix, the BasicIndex resolver name was `BasicIndex` then `zt`. After the fix, both `BasicIndex` and `BTreeIndex` names are identical across builds in events and snapshots. A custom `BasicIndex` subclass retains its constructor name, which changed from `CustomBasicIndex` to `Mn` in the minified bundle. Custom names are diagnostic and are not promised to be build-independent. Resolver metadata remains outside the index signature, so this change does not alter index reuse. The SQLite persistence wrapper serializes the same public resolver object; a separate SQLite round trip was not run for this metadata-only change. GAP-08 retains the general minified public-API lane.

The package's Vite `build:minified` output supplies a second production-build witness. Its exported constructors have runtime names `m` and `l`, while public `index:added` events and `getIndexMetadata()` snapshots both report `BasicIndex` and `BTreeIndex`.

An independent review caught a bundle cost in the first candidate: eager imports of both built-in classes made a minified `createCollection`-only bundle grow from 129,070 to 145,512 bytes. The final implementation stores an own static resolver metadata name on each built-in and reads that property through the supplied constructor. The same bundle is 129,161 bytes, a 91-byte increase over the reviewed head, and retains neither built-in index module. The subclass test rejects an inherited stable name for custom resolvers.

## CodeRabbit review at `86d36a7e`

Review 5344982200 had one finding: overridable `buffer`, `byteOffset`, and `byteLength` properties could make a typed-array subclass with internal bytes `[9]` hash like a base view with bytes `[1]`. The two operands gave different native and compiled `gt` results. The expanded oracle failed at the structural hash checkpoint on the reviewed head in both fixed-seed and random runs. It also exercises spoofed offsets, lengths, DataView bytes, and Buffer bytes so a partial getter repair remains RED.

The repair captures the built-in byte getters for typed arrays and DataView before user code can override them. The same oracle passes 14 tests after the fix. This rejects the reported collision for static view bytes; held-value byte mutation and conversion based on external mutable state remain outside this owner's current history grammar and stay recorded in the coverage map.

## External review of PR #1927 and follow-up

The external review at `pr-1918-1934-review-summary.md` raised four points about
this PR. The task-local append-only ledger records the summary prose, each
finding, and its adjacent independent-review and CodeRabbit items separately.

The reported `eq`/`in` gap was real. On the published head `60bbc0fd`, an own
`Symbol.iterator` made different indexed bytes produce the same query identity
and exact demand key. The generated property failed in both fixed-seed and
seedless campaigns at the identity checkpoint. A changed iterator on identical
bytes remained an equal control. A spoofed public `byteLength` then exposed a
second collision, and separate views with `byteLength = NaN` exposed a third:
compiled equality distinguishes the same reference from a different reference.
Each witness failed against its preceding implementation and passes after the
follow-up. The repair reads bytes through captured intrinsic getters and records
the public equality length, using reference identity for nonreflexive lengths.

The Buffer finding was also real as a hashability failure. The installed
`buffer@5.7.1` recognizes a Buffer from `buffer@6.0.3`, but the published head
rejected the latter because its `toString` function is not this realm's Buffer
method. A controlled Buffer-copy witness was RED at structural hashing. The
repair accepts a recognized Buffer's own base-prototype conversion. A hostile
base-prototype conversion then demonstrated that merging distinct methods by
bytes alone was unsafe; the repaired identity includes the foreign conversion
function's runtime identity. Copies with identical conversion behavior can
therefore have different keys. This is conservative and does not promise a
cross-implementation cache hit.

An independent review found another ordering collision. Foreign realm typed
array and DataView prototypes can change conversion while the published head
still trusts their methods as built-ins. A controlled witness showed different
compiled `gt` results but the same structural hash and demand key. The follow-up
trusts only captured local built-ins for non-Buffer views. It gives foreign
ordering views reference identity and rejects them for direct structural
hashing. The fixed witness passes. This conservative behavior also applies to
foreign views whose conversion has not changed.

The explicit-key hook warning is narrower than the external review stated.
`getLiveQueryHash(undefined, ['stable'])` succeeds regardless of a custom view
in the query, while a custom-conversion view *inside* the explicit key throws
`UnhashableQueryIRError`. React and Svelte hooks rethrow an unhashable explicit
key. The existing hook suites assert the same throw for function-valued keys;
this Buffer/view compatibility decision remains open. A React hook probe could
not run in this worktree because its testing-library link is absent. The
coverage map names the boundary rather than presenting it as fixed.

The external review's code-weight concern remains valid. Against this PR's
merge base, the follow-up has 104 added and 9 deleted production lines across
five files, net +95. The extra equality and realm checks close witnessed
identity collisions, but this exceeds the repository's net-neutral starting
budget. A simplification review found no safe deletion without losing the
verified distinctions. A later design pass should seek a smaller identity
abstraction; code weight is not recorded as a correctness failure.

CodeRabbit review 5344982200 targeted `86d36a7e` and reported spoofable view
byte accessors. Its RED oracle witness is recorded above. The published head
`60bbc0fd` had already replaced those reads with captured getters, and this
follow-up retains them. CodeRabbit's suggestion to run its agent review is an
optional process step, not a product law.

The widened owner covers bounded static-byte `gt`, `eq`, and `in` values,
compiled predicate results, structural hashes, query identities, and exact
demand keys at synchronous checkpoints. It kills the original iterator,
length, Buffer-copy, and foreign-prototype candidates. Mutable byte histories,
external conversion state, and explicit-key hook behavior remain outside that
claim. The coverage map assigns those remaining witnesses and decision.

The executable follow-up commit is
`123af67bcde8bb8bbb557332e7b9151cec961718`. Its tree passed 84 focused
identity and live-query-option tests, the `@tanstack/db` TypeScript check,
changed-file ESLint, Prettier, and `git diff --check`. This record-only addition
does not change that executable tree. The earlier ORC-012 receipt for
`d03b6879` applies only to that older head; the witnesses and checkpoints above
are the follow-up evidence for the current executable commit.

## Second review: foreign view compatibility and Buffer length

The starting pushed head for this pass was `cb451e99`, after the normal merge
with `origin/main`. A pristine foreign Uint8Array or DataView with the same bytes
as a local view gives the same compiled `gt` result. That head rejects direct
`getStableValueHash(foreignView)` with `UnhashableQueryIRError`. A same-path
Node `--import tsx` probe used two distinct pristine foreign Uint8Array([1, 2])
objects. Repeated use of one object gave the same query identity and exact
demand key, while the two distinct objects gave different identities and keys.
This proves cache-reuse loss separately from the direct-hash rejection. A view
inside an explicit query key reaches the direct-hash rejection. The product
choice between strict rejection and object-identity acceptance is pending; this
record does not treat equal-byte foreign cache reuse as a settled contract.

A candidate repair compared foreign conversion output with local built-in output
at hash time. A fixed oracle case for pristine foreign views passed under that
candidate. Three hostile cases then failed at the direct-hash checkpoint:

- A foreign prototype `toString`, `join`, or `valueOf` method mimicked the
  built-in result on its first call. Hashing ran the method and accepted it.
- An own DataView `Symbol.toStringTag` getter returned `DataView` for the first
  three calls, then changed. Hashing ran and accepted the getter.
- An own static DataView tag of `A` changed compiled `gt` while the candidate
  merged its structural hash and exact demand key with a local DataView.

The candidate was removed. These hostile controls now pass against the
conservative reference fallback. A native function's source text cannot alone
prove its semantics: replacing a foreign typed-array `toString` with native
`RegExp.prototype.toString` preserves the usual native source text, name, and
arity but changes conversion. Cross-realm value equivalence therefore needs a
separate comparator contract or a more explicit trust boundary.

The independent review also found a Buffer ordering collision on the pushed
head. Node Buffer([65, 66]) normally converts to `AB`. An own or inherited
`length = 1` makes `Buffer.prototype.toString` return `A` while intrinsic
`byteLength` remains 2. The original structural hash and exact `gt` demand key
merged those values, even though the compiled predicate returned false for the
normal Buffer and true for the shortened one on the same row. The oracle was RED
at direct hashing before the repair. The repair rejects a recognized Buffer
whose `length` is shadowed before its intrinsic typed-array prototype, so
ordering identity falls back to the object's reference. Both own and inherited
variants pass the same oracle after the repair.

The widened oracle keeps its independent native relational result, real compiler
driver, structural hash and demand-key checkpoints, and fixed/random campaigns.
The added fixed controls reject the unsound foreign-output candidate and the
Buffer length collision. The model adds no state. It does not prove arbitrary
later prototype mutation or getter side effects outside these fixtures. After
rebuilding the local `@tanstack/db` package, focused receiving-path tests ran
the real React and Svelte `useLiveQuery` hooks. Both rethrew the hash error when
an explicit key contained a pristine foreign Uint8Array or a local view with
custom `toString`. The Svelte test also reached the direct `getLiveQueryHash`
assertion before each hook invocation. The coverage map names the foreign
explicit-key decision and the static-history limit.

### ORC-001 through ORC-011 for this follow-up

| Requirement | Evidence or limit |
| --- | --- |
| ORC-001 authority and limits | Equal identity must imply equal compiled ordering behavior. The Buffer trace violates that law. The foreign direct-key policy is unsettled and is not asserted as a law. |
| ORC-002 independent judgment | Native relational comparison predicts `gt` results without importing the identity classifier. |
| ORC-003 responsibilities | The oracle's opening contract, finite byte and conversion fixtures, native comparison model, real compiler and identity driver, and post-call assertions remain adjacent. |
| ORC-004 grammar controls | The existing generated local-view grammar still spans 0–8 bytes and tag ownership in fixed and random campaigns. The new foreign and Buffer cases are bounded fixed controls and make no generated-history claim. |
| ORC-005 path and observation | Fixed controls call real `compileExpression`, `getStableValueHash`, and `getLoadSubsetDemandKey` at synchronous checkpoints. React and Svelte tests reach their public hooks. |
| ORC-006 calibration | The Buffer guard's predecessor failed at direct hashing. The foreign-output candidate passed a pristine witness but failed the stateful-method, stateful-tag, and static-tag controls at direct hashing. |
| ORC-007 campaign and replay | The unchanged named generated property runs fixed seed 101610 and a seedless campaign through the package oracle owner. Existing guarded seed/path replay remains wired. |
| ORC-008 model minimality | No state was added to the native-comparison reference. |
| ORC-009 vocabulary | Query identity and exact demand key retain production names. The foreign conversion fixtures are inputs, not a model-only subsystem state. |
| ORC-010 failure and cleanup | The generated property keeps `withHistoryCleanup`; fixed cross-realm VM values need no asynchronous cleanup. The intentional candidate failures reached assertions. |
| ORC-011 second formulation | Native relational comparison and compiled `gt` form separate semantic paths. The React and Svelte receiving paths independently check explicit-key error propagation. |
