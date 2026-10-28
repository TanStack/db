# Collection key type and SortedMap restore review

Reviewed product head: `c385f6eed162fca2f9a997f02ecababfff077294` on
`sortedmap-merge-restore`, based on `origin/main` at
`b8d8ee07c95f51d84c880f6bb7371a84d2858394`. Sources: PR #2266, an internal
code review (10 findings), a code-simplifier pass (7 proposals), and two
CodeRabbit reviews (one finding and one nitpick). A scratch ledger was kept
during evaluation; this record keeps the verdict-critical oracle evidence in
the repository.

## Contract and scope

Two owners change, and one owner is new.

**Grouped result keys (new owner).** A Collection key is a string or a
number: the `TKey` constraint of every Collection type, and the
`InvalidKeyError` that optimistic mutations throw for any other key. A grouped
live query that groups by one field used the raw group value as the key, so a
`null`, `undefined`, boolean, or bigint group value produced a key outside
that type. Grouping by a nullable field is a valid query. Maintainer decision
(2026-10-27): the grouped key matches the declared key type; the type does not
widen. Such a group value now keys its group in the namespace that
`normalizeValue` reserves, which no string group value occupies. The law fixes
the key's type, uniqueness, and stability, not its format. `sync.write` now
throws `UndefinedKeyError` or `InvalidKeyError` for a key outside the type,
through the check that mutations already used.

**SortedMap (repaired owner).** Maintainer decision: SortedMap promises what
Collection state uses, not full `Map` behavior, and is no longer exported.
Promised: Map ownership for Collection keys, including `NaN` as one key after
every other number; key or comparator order with key tie-breaking; a row
changed in place before restore sorts by its current value; after a placed row
changes in place, each key stays in the views once with its current value, and
a later write or delete affects only its own key; a deferred delete during
iteration yields the starting order once; a restore of k deferred keys among n
others makes at most k * (ceil(log2 k) + ceil(log2 (n + 1)) + 2) comparator
calls, and none with nothing deferred. Not promised: immediate writes or
`clear()` during iteration, the order after a placed row changes in place
without a write, `-0` keys, keys outside the key type, a throwing comparator,
and the work of key order without a comparator.

**Load-subset replay refinement (fixed regression added).** A named replay of
issue #2224's trace (a failed include demand during a marker replay) joins the
existing campaign. PR #2229 had fixed that defect, so the replay is green; it
needs no model change.

The keyed `MultiSet.consolidate` rewrite and the Collection commit-loop cleanup
keep their observable behavior. The existing MultiSet consolidation oracle and
the Collection oracles own them; this PR does not change those owners.

## RED, GREEN, and mutant evidence

Grouped result key oracle
(`packages/db/tests/query/group-result-key-oracle.property.test.ts`):

- RED on the parent commit: all 5 tests fail at the first checkpoint with
  keys `undefined`, `null`, `false`, and `10n`.
- GREEN: 5 of 5.
- Mutants, all assertion failures: an encoding by `String(value)` fails
  because `null` and `"null"` (and `true` and `"true"`) share a key; an
  encoding of nullish values only fails because boolean keys remain. An
  encoding of only the internal D2 key, with the public key unchanged, passes
  every test: the Collection keys rows by the public group key, so the change
  is equivalent within this domain. That part of the repair was removed.
- Reach in each campaign of 80 histories (fixed seed / random): a nullish
  group published 38 / 32; a group beside a string that prints like it 21 /
  18; a key kept across a change 49 / 53.

Sync write key witness (`packages/db/tests/collection.test.ts`): RED 4 of 4
(`undefined`, `null`, boolean, bigint keys were staged); GREEN 4 of 4. The
witness also found that `InvalidKeyError` threw a `TypeError` for a bigint
key, because its development message used plain `JSON.stringify`; the message
now shows the bigint.

SortedMap oracle (`packages/db/tests/SortedMap-oracle.test.ts`):

- Before this PR's oracle repair, a mutant that sorted every key at each
  restore passed all 30 tests. The work law closes that gap.
- A `NaN` key RED: with comparator order, rewriting a placed `NaN` key
  duplicated it and deleting it removed the last key, because the slot check
  used `===`. This was a regression inside this PR; `main` spliced at the
  binary-search index. GREEN after slots compare by SameValueZero.
- GREEN: 7 of 7, and 21 of 21 supplemental examples in `SortedMap.test.ts`.
- Mutants, all assertion failures at the named checkpoint:

| Mutant | Rejection |
| --- | --- |
| Sort every key at each restore | 108 comparator calls against a bound of 7 (with delete-only restores made free) |
| Sort kept keys with the dirty keys appended | 34 calls against a bound of 7 (same control) |
| Sort again with nothing deferred | calls at a clean ordered read |
| No scan fallback for a changed row | a neighbour is deleted |
| Match slots by `===` | a placed `NaN` key removes the last key |
| Keep dirty keys' old slots | order and membership mismatch |
| Apply deferred deletes immediately | a prune skips an entry |
| Place a deferred row by its value at the write | order mismatch |
| Replace the key array instead of writing in place | the supplemental live-iterator example fails |

- Reach in each campaign of 100 histories (lowest across two local runs):
  burst restores 54; an entry yielded after a prune deleted one 30; a placed
  `NaN` key written without deferral 7; a restore whose bound is below n 19; a
  changed placed row later written 11; a deferred row changed before restore
  11. The last three apply to comparator orders only.

## Oracle guide audit

| Requirement | Grouped result key oracle | SortedMap oracle |
| --- | --- | --- |
| ORC-001 | Law, authority (`TKey`, `InvalidKeyError`, maintainer decision), and limits are in the opening prose. | Law, authority (existing contract plus the maintainer's scope decision), and the not-promised list are in the opening prose. |
| ORC-002 | `expectedGroups` partitions plain rows by type and value with `NaN` equal to `NaN`. It does not import the compiler, value identity, or key encoding. | A native Map of numbers and a fresh full sort derive every observation. The work bound is a formula in n and k, not production's algorithm. |
| ORC-003 | Literate file: contract, model, grammar, driver, and refinement check each have prose beside the code. | Same structure; the three Collection-use laws sit in the opening prose and beside the driver branches that check them. |
| ORC-004 | Reconstruction: the probe that found the bug (nullish groups beside strings) and the bigint and `undefined` counterexamples are pinned or regenerate in the first runs. Ablation: without nullish values the nullish reach state and RED vanish; without lookalike strings the `String(value)` mutant survives; without booleans and bigints the nullish-only mutant survives; without changes the key-stability state is unreachable. Range: 1 to 6 rows over 16 group values, up to 4 changes; marginal cases include an empty source after deletes and a `NaN` group. Exclusion: a move or delete with no rows writes nothing; Dates, `-0`, and objects are outside the domain. | Reconstruction: four fixed histories (main's original, a mutated neighbour, a deferred delete before a burst, a placed `NaN` rewrite) replay through the shared driver. Ablation: without `mutate` two reach states and two mutant kills vanish; without the work counter the full-sort mutants survive (shown on the earlier oracle); without `prune` the iteration law has no generated history; without `NaN` keys the `===` mutant survives. Range: keys -3..3 and `NaN`, values -3..3, up to 40 actions, bursts of 17 to 41 keys. Exclusion: `mutate` targets only present keys; deletes during iteration are always deferred; keys outside the key type are not generated, because `sync.write` rejects them. |
| ORC-005 | Public `createLiveQueryCollection` over a mock sync source; `entries()` and `size` after preload and after each committed change. | SortedMap's own methods are the entry point (it is internal); every view, `size`, `has`, and `get` after each action or chosen checkpoint, comparator calls at each ordered read. Collection sync paths are pinned in `SortedMap.test.ts`. |
| ORC-006 | Mutants above, classified as assertion failures; one equivalent within the domain. | Mutants above, all assertion failures; a calibration test feeds wrong orders, a lost tie, a stale value, duplicates, and a missing key to the comparison. |
| ORC-007 | Fixed seed 92604118 and an unseeded campaign share the property, driver, comparison, and budget; `group-result-key.groups` is registered for seed and path replay. | The existing `sorted-map.*` fixed and unseeded campaigns and replay interface carry the new actions. |
| ORC-008 | Stateless partition; no model state. | `deferred`, `changedPlaced`, and `orderPromised` are kept: a changed deferred row and a changed placed row look alike until the next ordered read, where one must sort exactly and the other only keeps membership. The write-only `placed` set was removed. |
| ORC-009 | Group value, key, and publication use glossary terms; "lookalike" is a model-only label for a string that prints like a non-string value. | "Deferred", "placed", and "changed in place" are local SortedMap terms with no glossary counterpart; sync transaction and publication keep glossary meanings. |
| ORC-010 | `withOracleCleanup` cleans both Collections and preserves the primary failure. | No resources; fast-check reports the shrunk history. |
| ORC-011 | No shared semantic fault between the type-and-value partition and production's value identity was named inside the domain. Dates, whose identity is their timestamp, are excluded rather than modelled. | No shared fault between a full sort and incremental restore was named. |
| ORC-012 | This record. | This record. |
| ORC-013 | The lookalike strings distinguish a type-preserving encoding from `String(value)`; the boolean and bigint values distinguish a complete encoding from a nullish-only one. | The `restore-bound-below-order-size` premise is reached in 19 or more histories per campaign, and the full and presorted re-sorts exceed the bound there. |
| ORC-014 | The mock sync source is a controlled provider; the claim covers only the compiler's keying. Real adapters are not claimed. | No controlled premise is carried to a real provider. |
| ORC-015 | Three declared states, counts above. | Six declared states (three for comparator orders only), counts above. |
| ORC-016 | Pinned histories run the shared driver and comparison without their own expectations. | Example tests moved to `SortedMap.test.ts`; the oracle file keeps the property, its fixed histories as inputs, and checker calibration. |

## Review items

| Item | Disposition at the reviewed head |
| --- | --- |
| CR1 NaN unplace | Fixed: slots compare by SameValueZero; generated `NaN` keys and the `===` mutant above. An interim scope note had wrongly called `NaN` keys unpromised. |
| CR2 O(k n) deferred deletes | Fixed: dirty keys leave by membership in one pass; the work law and supplemental splice bounds reject per-key work. |
| CR3 throwing comparator | Not promised (maintainer scope decision); a comparator that throws is a programming error. |
| CR4 rows mutated without a write | Accepted design (maintainer decision A): their order is not promised; membership is, and is generated. |
| CR5 test gap for NaN and work | Fixed by the `NaN` dimension and the comparator-call work law. |
| CR6 reach on pending runtime keys | Superseded: runtime nullish keys no longer reach SortedMap. |
| CR7 boolean and bigint keys | Fixed at the producer: grouped keys and `sync.write` keep keys in the key type. |
| CR8 per-operation allocation | Fixed: immediate writes keep the binary-insert path. |
| CR9 absent delete skips restore | Fixed: delete restores order first. |
| CR10 removed 512 threshold | Fixed: the threshold remains. |
| S1 vacuous work bounds | Fixed: the comparator-call law bounds the merge pass that the splice counter cannot see. |
| S2 drop the `indexOf` value parameter | Refuted: immediate inserts and the restore pass values not yet in the searched array. |
| S3 model mirror of pending keys | Stale after the redesign. |
| S4 stale comment | Fixed. |
| S5 per-commit allocation | Duplicate of CR8 and CR10. |
| S6 history narrative in the coverage map | Fixed. |
| S7 `clear()` and live iterators | Superseded by the scope decision; main's live-iterator example remains. |
| CodeRabbit: `unplace` miss check for an `undefined` key | Valid when raised; its premise is removed, because an `undefined` key no longer reaches SortedMap. |
| CodeRabbit: extend an oracle for invalid sync keys | Partly valid: SortedMap is not the owner and the no-effect assertion already existed; the coverage map now states why this is a fail-fast invariant witness. |

Siblings found during evaluation: a `-0` key reported as `-0` (now not
promised), an immediate write that lost its slot when the comparator threw
(not promised), and live iterators that skipped or repeated entries across
immediate writes (superseded by the scope decision). The removed `forEach` and
public export were approved by the maintainer.

Loss audit: 17 raw review items = 10 fixed, 1 accepted design, 1 not promised
by decision, 2 superseded, 1 refuted, 1 stale, and 1 duplicate; plus 2
CodeRabbit items (1 premise removed, 1 partly valid and documented) and 3
siblings (2 not promised, 1 superseded). No source claim is omitted.

## Limits

The grouped key owner does not cover Dates, `-0`, objects, or multi-field
groups, which the aggregate select oracle owns, nor real sync adapters.
SortedMap does not promise the items listed under scope. Shipped-byte effects
were measured with a local esbuild approximation of `pnpm size:compare`,
because a registry 403 prevented the install that `size:compare` needs; they
are not part of this oracle verdict.

## Update: merge with `origin/main` at `7e46f81ad`

The branch merged `origin/main` at `7e46f81ad` in `26896c42a`. That change
(#2237) requires each registered property to name its owner, so
`group-result-key.groups` now has an owner entry and a replay test name in
`oracle-replay-manifest.ts`. No law, model, grammar, or comparison changed.
The replay manifest tests (40) and both oracles pass after the merge.

A third CodeRabbit finding, on `ea4cf8792`, was valid: the guide note did not
say that a string with the reserved `\u0000tanstack-db:` prefix gets an
escaped key, or that a live query's `getKey` replaces grouped keys. The note
now says both.

Shipped bytes: `pnpm size:compare` against the merge-base `b8d8ee07c` now
runs, with a local-only override for one dependency that the registry proxy
blocks. The gzip difference is -56 bytes for `app`, -38 to -61 bytes for the
other scenarios, and -2 bytes for the `@tanstack/db` package bundle. These
numbers replace the esbuild approximation in the limits above.
