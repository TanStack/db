# Raw Collection transactions and complete live-query results

Base: `c351fc04d7f70dc59bf92ecbed310f899b9511cd`.

## Maintainer decision

The maintainer clarified the publication boundary on October 30, 2026:

> I think raw collection subscribers seeing raw commits is expected. Live queries are a higher level abstraction (and you can subscribe to them if you want something coherent at that level)

Raw Collection reads and raw subscribers observe applied source transactions.
A truncate or a partial replacement transaction can become visible while replay
loads remain pending. Folding a full-state raw subscription's delivered changes
must agree with direct Collection reads at the transaction's public observation
cut. A load rejection does not retract an accepted source transaction.

Live queries retain their existing complete-result publication contract. Their
reads, events, and downstream queries must agree on the complete graph result
at that boundary. Source transaction visibility does not establish that a
live-query replacement is complete.

This decision supersedes the stronger source-retention interpretation in
[the earlier investigation](2026-10-30-atomic-collection-publication.md). That
investigation and its RED results remain historical evidence of a different
proposed law. They are not RED evidence for this clarified law. The frozen
`review-evidence/collection-publication/design-grammar-v1/` analysis is unchanged.

## Distinguishing predictions before revising the oracle

Start with source row `a=1` and a full-state raw subscriber that has received it.
Commit a truncate while replay loads remain pending.

| Observation cut | Earlier draft | Clarified raw Collection law |
| --- | --- | --- |
| Applied truncate | Reads and fold retain `a=1` | Reads and fold are empty |
| Applied partial replacement `a=2`, sibling load pending | Reads and fold retain `a=1` | Reads and fold contain `a=2` |
| The load then rejects without another source transaction | Reads and fold retain `a=1` | Reads and fold still contain `a=2` |
| A later accepted transaction deletes `a` | Failed replay retains `a=1` | Reads and fold are empty |

The existing live-query barrier can keep its previous complete result through
these source transactions. These predictions neither delay ordinary applied
receipts until load success nor resolve them on private acceptance. No new
adapter API or altered receipt semantics is authorized or needed by the stated
raw law. Whether the implementation can enforce both layers remains an
executable receiving obligation.

## Oracle-first execution gates

Revise the existing Collection lifecycle publication owner and its shared
receiving judgment. Derive rows from authored applied transaction prefixes,
independently of production replay machinery. Preserve generator dimensions,
fixed/random budgets, direct replay, read facets, indexes, error identity, and
receipt progress. Update checker calibration to reject retained raw subscriber
rows after an applied truncate or replacement.

Obtain new unchanged-production assertion REDs for the controlled core, actual
Query adapter, and persisted wrapper. Preserve their old stronger-law REDs
separately. Verify neighboring live-query publication barriers before changing
production. A timeout or setup failure does not supply the visibility RED.

After those gates, repair production and obtain GREEN plus a hostile mutant
failure at the promised observation. Until then, no production repair or
bug-class closure is claimed. Dynamic enrollment, cleanup/restart, filtered
selection, callback reentry, optimistic writes, and graph-result retention need
explicit coverage or an owner and limit; the raw-law clarification does not
silently discharge those obligations.
