# Ordered strategy investigation after the positive-progress decision, v1

Result: the clarified law validates a useful minimum-row inference, but I did not find a constructive generic algorithm meeting all existing correctness and work gates. The repair remains **open / NOT READY**. E105 establishes an exact obstruction for a broad **post-batch certification protocol family**, with positive controls. It is not a universal no-algorithm result. No production, oracle, support, budget, expectation or built artifact changed.

## Authority and current boundary

Root conveyed the new human YES and recorded it as `ordered/progress-contract/C01`: a successful positive-limit ordered acquisition must return at least one matching row when its requested forward scope contains matches. Responses may remain capped below the requested limit. Core still completes the final leading-value tie separately. This supplies positive progress, not response cardinality, return provenance, page end or exhaustion. The old authority-conditional empty response in E104 is now excluded under that premise; it must not be reused as a legal counterexample.

The user still requires `T <= N + 2P`, with all sixteen original transfer cells unchanged. No extent API, key-expression API, higher transfer ceiling, fixture change or limitation of legacy sources is approved. The frozen loader is `df6087419048633718a05056deb3760d09b4185eba41c05d148689609051a87d`. E75's 1,002 passing checks and sixteen work failures remain its product-runtime evidence; this investigation does not replace them.

I read the required AGENTS, project glossary and full live architecture before live-code inspection; the primary pagination, ordered-work, loader-state and real Query owner contracts; their relevant coverage limits; the three prior strategy reports; E104's abstract model/results; and the transfer/work-authority and decision packets. The existing architecture's candidate interval explanation does not supersede the retained transfer gate.

| Source law / fact | Authority and implication |
| --- | --- |
| Positive progress, caps allowed, final tie completed by core | Human C01, conveyed by root. A nonempty exact forward scope cannot answer successfully with zero matching rows. |
| Successful loads wait for establishing writes | `types.ts` LoadSubsetFn and architecture law 7. Queued writes are not exposed authoritative base until applied. |
| Prefix through an actual returned leading boundary | LoadSubsetOptions / ordered continuation contract. Earlier groups are covered; a partial final tie still needs core's separate tie acquisition under C01. |
| No returned row set, count, or end reaches core | `true | Promise<void>` subset result. Receipt/timing is not provenance. |
| Source base differs from visible state | Glossary exposed authoritative base; `readOrderedSnapshot()` reads visible rows and excludes optimistic keys. It cannot be reused unchanged for the minimum proof. |
| Public rows and latent prefix coverage both matter | Pagination and Query receiving owners. A missing interior tied key can violate coverage before it changes the visible window. |
| Limits are independent observations | Pagination owns N+2P, finite ordered limits and cursor use; ordered-work/loader-state own request, local read and scheduling bounds. Efficient row transfer alone is insufficient. |

The minimum lemma now has a narrower useful form. In the exact requested range, if an actual response row remains in the exposed authoritative base at the observation cut, that base's leading minimum is no later than the returned row. Unrelated later live rows cannot make that minimum unsafe. Core can use the covered strict prefix and separately complete the minimum's tie. It must read applied base, include rows hidden by optimistic overlays, preserve duplicate-suppressed response rows, and fence source deletion/rank changes and obsolete generations. Positive progress does not supply any of those other premises automatically. Empty real scopes and short replies still prove no source exhaustion.

## E105: a bounded batch-certification obstruction

The standalone `strategy-progress-v1.abstract.py` ran once under root's slot-2 grant, then released that slot. It invokes no product or Query receiver. It verifies all **28** frozen source/support/build input hashes before and after. Results are in `strategy-progress-v1.abstract-results.json`; E105 in the append-only experiment ledger binds the command, script/results hashes and verified input map.

For batch width K, the clean source has K known rows A0 through A(K−1), each at a distinct leading value. A successful ordinary batch returns them. For every interior group j>0, a compatible rival source adds one opaque key Bj at the same complete provider-field/order tuple as Aj. Bj sorts immediately before or after Aj within that tie. That rival response is capped to A0; independent live writes install all other known A rows in the same acquisition turn. All positive-progress replies are nonempty when their post-offset forward scope has matches. The resulting applied rows, successful result and duplicate-suppressed observations are identical to the clean batch, but the rival prefix lacks Bj. No forbidden empty response is used. The arbitrary getKey identity is unavailable to provider predicates, as in E104's declared symbol-key abstraction.

The protocol receives only applied installed keys and success, never response count. Its available queries are any subset of known leading groups (more permissive than interval-only filtering), either leading direction, every bounded ordinal offset, unit finite probes with cap-one replies, and unlimited complete filtered-subset acquisitions. A finite probe distinguishes a rival only when it actually installs Bj. Returning a known Aj and returning no row leave the same observation. A complete subset installs every selected Bj. The observed clean reply count is used only by the external transfer counter.

The model exhausts K=2 through 7: **six families, 42 compatible hidden worlds and 2,766 query shapes**. A weighted set-cover computation searches all resulting clean-branch knowledge states, including repeated/adaptive probing until every rival is distinguished. The exact minimum additional clean transfer is **K−1** in every family; one complete acquisition of the interior groups attains it. The executed model also checks the following proof invariant for every query:

1. Consider only rivals where Bj comes immediately before Aj. There are K−1 such rivals.
2. A finite ordinal probe that returns Bj in that rival returns a known row at the same ordinal in the clean source. Thus it transfers one clean duplicate. One cap-one probe can distinguish at most one such rival.
3. A complete subset query that distinguishes k of these rivals transfers at least k known rows in the clean source.
4. Therefore every query's clean transfer is at least the number of these rivals it distinguishes. Covering all K−1 rivals costs at least K−1 additional clean rows, regardless of query ordering along the all-duplicate observation branch.

Wider positive finite limits do not improve this particular hidden-world mechanism: an adversarial rival may still cap to one, while an uncapped clean reply costs at least the unit probe's one known row. This is a dominance argument for this protocol family, not an executed enumeration of arbitrary limit semantics or all source strategies.

### Successful controls and failure fidelity

A complete filtered-interval control distinguishes every rival in all six families (42/42 total). Enumerating all interior ordinal positions also distinguishes every rival (42/42), so the model does not falsely claim that offsets never reveal hidden keys. On width K that enumeration transfers K known clean rows across K+1 probes. Both controls positively install the hidden key and satisfy the shared prefix judgment.

Six literal end-offset controls retain the useful negative distinction: scope `eq(group)`, offset 1, limit 1 is empty in the clean one-row tie; when hidden B precedes known A, it returns A. Both successful observations leave the same installed keys. Positive progress permits both answers because the clean post-offset scope is empty and the rival scope is not. Thus a no-new-row end probe remains unusable as an emptiness/count signal.

These are abstract reaches: 42 positive-progress initial ambiguity worlds, six batch-certification families, six complete-subset controls, six all-interior-offset controls and six duplicate-response end controls. They are not production reach, product RED/GREEN, SQL work, local scans or a real Query receiving witness. The external cost counter and hidden backend keys never become protocol input.

## What this rules out, and what remains open

This rules out achieving O(1) duplicate transfer per opaque batch by merely adding a small batch of count/end/interior probes or combining known groups into one complete certificate within this request family. It gives a stronger obstruction than one failed endpoint probe. It does not repeat the disproved tuple/key exclusion or cumulative-prefix suggestions as candidates.

It also explains why the current architecture remains costly: first transfer an uncertain wide page, then prove all its possibly live interiors. The original static page transfers N rows (plus cursor overlaps); certification can then need a second transfer of its visited interiors. This is conditional architectural accounting, not a new universal `2N` bound for the product. The E105 optimum is not extrapolated into an assertion about every existing gate or arbitrary scale.

The investigation does **not** enumerate every possible initial acquisition architecture, correlated predicate, alternate order expression, provider consistency schedule or row-retention policy. It does not rule out a strategy that obtains useful certified batch information as part of its first transfer. It also does not close source-base indexed-read cost, mutation fencing, request count, optimistic headroom or actual receiving paths. One-row discovery plus a separate tie remains approximately 2N and too many acquisitions; it is not proposed as the repair.

No further broad product question is needed now. C01 answers the question that was pending. The exact remaining information boundary is whether a proposed first-transfer protocol can establish a **particular batched leading extent or enough authoritative ordinal information to justify it** from currently observable facts, despite caps, equal-field opaque keys and independent live rows. Mere progress guarantees one match and cannot identify that extent. An explicit extent/returned-set fact would cross a separately unapproved API boundary; this report neither requests nor assumes it.

## Next decisive architecture and oracle-first plan

The next useful research target must change the first-transfer architecture, rather than attach more opaque probes after a wide page. A concrete candidate family is **acquisition-first complete finite partitions**: select a genuinely bounded, complete source predicate before transferring its rows, so those first transfers themselves establish coverage and a separate interior certificate is unnecessary. The unresolved design problem is choosing such partitions for arbitrary expressible orders, caps and opaque keys without full-source overfetch, per-group requests or numeric-spacing guesses. No such selector is validated here. It should be challenged abstractly before another production hunk; failure of that family would still not prove every architecture impossible.

Before production editing, use a fresh test-only thaw/copy and preserve the current frozen evidence:

1. Record C01's exact accepted text in the contract/coverage record, retaining capped replies, core-owned final ties and N+2P. Update the current architecture/type prose consistently when implementation work begins; no extent API is implied.
2. Extend the existing `ordered-work.finite-provider-boundaries` grammar and real Query receiver, reusing their independent full backend window and latent-prefix comparisons. Add opaque equal-tuple key representation; initial cap-one reply with same-turn independent interior/outlier writes; duplicate-suppressed reply hidden by optimistic delete/rank move; and a deletion/order change between settlement and proposed base observation. Cross existing direction, nullish, tie, encoding and held-delivery axes. Declare/measurably reach those actual production cuts.
3. Run the extended correctness instruments on unchanged v2 first. Correct v2 should retain its correctness result and sixteen work failures. Calibrate with separate wrong designs: visible-state minimum instead of exposed base; stale minimum after source/order invalidation; final-tie omission; page-end maximum inferred from local rows. Each must fail the intended row/prefix/generation cut, not setup or reach. These are proposed controls, not executed kills.
4. Require a candidate first-transfer protocol to pass a bounded abstract model with independent backend keys and an external transfer/request recorder before production edits. It must supply an extent argument, a final-tie argument and an amortized cost argument. Do not import hidden response cardinality into its observations.
5. Only then change production against that instrument. Preserve all sixteen original N+2P cells and all existing generated budgets, finite/request-count/local-scan/atomic-publication gates. Measure every provider-returned duplicate and every acquisition. Run the actual Query receiver, applied-base/overlay witness and existing source-order generation overlaps. Keep original or hostile-mutant RED and repaired GREEN separate.

No production attempt is justified by E105 alone. Root owns whether that next architecture merits a further bounded experiment, canonical claims and eventual integration. The current repair stays explicitly open.
