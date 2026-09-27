# PR #1909 external review

Review target: `0ba54cd50bca908348940eb2020ec4f244450dc9`. The supplied
medium-effort review named four findings, one test gap, and one broader
cross-PR observation. This record separates the code fact from the proposed
behavioral consequence.

| ID | Disposition | Evidence and remaining question |
| --- | --- | --- |
| R1 | refuted | `waitForJoinedDemand` does run on custom-collation full-source and unindexed fallback paths. A held child-demand fixture reaches both paths for Collections and Effects, then publishes the correct `none` window. Setting the gate to `false` makes all four cells publish a matched parent that should be absent. The full-source path still needs the publication gate for an anti-join. The indexed-only restriction proposed by the review is unsafe. |
| R2 | confirmed-open | Ordered Effects track published rows for every ordered source, and the classifier reads that map even outside a held repair or joined-filter window. The suggested duplicate insert for an already published key has no valid public history yet. An equal-value source update produced no D2 delta with either classifier. A second joined contributor received a distinct composite output key. Provide a valid query and source sequence that sends an insert for a callback-visible key without its matching delete before changing this branch. |
| R3 | confirmed-open | The builder tracks completion of one `DemandUpdate.ready` per plan; the Effect checks the controller's pending acquisition segments. These can differ for a microtask after segment settlement. The current indexed and new full-source/fallback fixtures reach pending child demand and settle to equal rows, but do not compare the two consumers at every callback cut on one shared source. A controlled simultaneous-consumer fixture is the next test if a divergent publication is reported. |
| R4 | fixed-now | Removed the redundant `hasJoinedFilterWindow()` scan from the builder's flush guard. The remaining `.some()` still requires `waitForJoinedDemand` and pending joined work. |
| R5 | fixed-now | Added four oracle cells crossing Collection/Effect with custom collation/unindexed root loading and held child demand. The custom path checks one unbounded request; the unindexed path checks prefix then full-source fallback. Both check complete anti-join publication. Disabling the gate kills all four cells. |
| R6 | deferred | The broader #1907 pattern is outside this review's code target. This PR now covers the two fallback regimes named here. The [#1907 review record](pr-1907-accepted-delete-ownership.md) remains the destination for its own guard and oracle claims. |

The review identified a real test gap and a redundant guard. Its proposed
restriction of the joined-demand gate would introduce a visible anti-join bug.
The Effect classifier and split demand bookkeeping remain evidence gaps rather
than confirmed product failures.
