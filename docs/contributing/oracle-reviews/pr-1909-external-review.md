# PR #1909 external review

Review target: `0ba54cd50bca908348940eb2020ec4f244450dc9`. The supplied
medium-effort review named four findings, one test gap, and one broader
cross-PR observation. This record separates the code fact from the proposed
behavioral consequence.

| ID | Disposition | Evidence and remaining question |
| --- | --- | --- |
| R1 | refuted | `waitForJoinedDemand` does run on custom-collation full-source and unindexed fallback paths. A held child-demand fixture reaches both paths for Collections and Effects, then publishes the correct `none` window. Setting the gate to `false` makes all four cells publish a matched parent that should be absent. The full-source path still needs the publication gate for an anti-join. The indexed-only restriction proposed by the review is unsafe. |
| R2 | confirmed-open | Ordered Effects track published rows for every ordered source, and the classifier reads that map even outside a held repair or joined-filter window. The suggested duplicate insert for an already published key has no valid public history yet. An equal-value source update produced no D2 delta with either classifier. A second joined contributor received a distinct composite output key. A temporary comparison found no event-type divergence through 2,048 valid plain ordered Effect mutations; their public rows matched an independent window model. Provide a valid query and source sequence that sends an insert for a callback-visible key without its matching delete before changing this branch. |
| R3 | confirmed-open | The builder tracks completion of one `DemandUpdate.ready` per plan; the Effect checks the controller's pending acquisition segments. These can differ for a microtask after segment settlement. A controlled shared-source fixture held child demand for both consumers, observed neither publish before settlement, and then observed each publish the correct anti-join row. Collection callbacks arrived before the Effect callback, so reads of both consumers differed briefly between independent callbacks. No incorrect row or stuck gate appeared. A claimed gate error still needs a sequence that separates it from ordinary callback order. |
| R4 | fixed-now | Removed the redundant `hasJoinedFilterWindow()` scan from the builder's flush guard. The remaining `.some()` still requires `waitForJoinedDemand` and pending joined work. |
| R5 | fixed-now | Added four oracle cells crossing Collection/Effect with custom collation/unindexed root loading and held child demand. The custom path checks one unbounded request; the unindexed path checks prefix then full-source fallback. Both check complete anti-join publication. Disabling the gate kills all four cells. |
| R6 | deferred | The broader #1907 pattern is outside this review's code target. This PR now covers the two fallback regimes named here. The [#1907 review record](pr-1907-accepted-delete-ownership.md) remains the destination for its own guard and oracle claims. |

The review identified a real test gap and a redundant guard. Its proposed
restriction of the joined-demand gate would introduce a visible anti-join bug.
The Effect classifier and split demand bookkeeping remain evidence gaps rather
than confirmed product failures.

## Follow-up probes

For R2, a temporary test compared `classifyImmediateDelta` and
`classifyHeldDelta` at every ordinary ordered Effect flush and failed if their
event types differed. It ran 64 deterministic histories of 32 valid source
mutations each. The histories crossed insertion, deletion, replacement, filter
membership, order changes, and top-two displacement over five keys. After
every mutation, the Effect's accumulated public rows matched an independent
filter/sort/window recomputation. No classifier divergence occurred. The
instrumented ordered-work, Effect, Effect-disposal, and pagination owners also
passed 426 tests without a divergent event type. The temporary instrumentation
was removed. These are sampled histories, not a proof for every query shape.

For R3, a temporary fixture gave one on-demand root and child source to a
live-query Collection and an Effect. It held the child's request while both
consumers evaluated a custom-collation `none` filter. Both stayed empty before
release and ended with only the unmatched root. The callback sequence was
Collection, Collection, Effect; each callback's own result was correct. A read
of both consumers during the first Collection callback saw the Effect's earlier
state. Their callback schedules are separate, so that observation alone does
not show that either pending-work definition released at an invalid point.
The temporary fixture was removed; no product change was justified by it.
