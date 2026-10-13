# PR #2116: deferred findings and guarantee decisions

This record separates findings discovered during the unit-test retirement
workflow from the transfers retained in PR #2116. The final PR keeps only
the seven direct-index families, five non-finite comparison blocks, two
ordinary Temporal comparison blocks, and six Date/RegExp equality assertions.
It repairs the BasicIndex nullish full-build mismatch. A finding below is not
closed by passing those transfer oracles.

| Finding | Authority and evidence | Next owner and witness |
| --- | --- | --- |
| R29: two valid `Temporal.Duration` values can have the same display text but different fields. A changed field can be suppressed as an equal Collection value. | Changelog #1519 says Duration equality preserves its fields. An earlier PR revision recorded a RED direct `deepEquals` result and a missing change event for a one-second versus 1000-millisecond replacement. The current `origin/main` implementation still normalizes by display text; this narrowed PR has not rerun that RED trace on the current base. | A separate Duration equality owner should model all ten fields independently, then a Collection change-event owner should compare the stored row, callback batch, and subscriber mirror after a valid replacement. |
| R16: an indexed Collection can admit a valid Temporal row whose index comparator has no public order, then throw after partial state changes. | Earlier PR revisions recorded RED admission and publication traces for Duration, PlainMonthDay, and mixed-kind rows. Source inspection suggests the risk remains on `origin/main`, but this narrowed PR has not executed a current-base RED witness. The public order law and internal index storage order must be distinguished. | The direct-index and Collection publication owners should pair a valid-row admission history with exact membership, ordered storage, stored rows, and subscriber observations. Choose the smallest internal ordering or atomic-admission repair that satisfies the accepted contract. |
| Mixed-kind indexed order and custom-index query selection may disagree with public query results. | Earlier branch experiments exposed risks, but the exact policy for unlike value kinds and comparator-equal rows is not settled by the retired unit blocks. The user withdrew the added guarantee that each row within one exact-equality class follows its custom callback position. No current-base RED claim is made here. | First state a supported-domain law and run indexed versus scan query witnesses on `origin/main`. Keep a custom comparator witness only if it follows that law without reintroducing the withdrawn per-row guarantee. |
| R17: an equal-time Date removal left an ordered ghost under added index machinery. | The recorded RED trace depended on code introduced during this PR. It does not establish an `origin/main` defect. The stronger rule for a substituted old row with a different callback position was withdrawn. | If ordinary direct remove/update still has a current-base counterexample, add a source-Map history to the direct-index owner before changing production. |
| Cross-realm native equality was asserted by a surviving request-transport unit test. | PR #1797 captured the then-current `instanceof` result. No public realm-distinctness promise was found. The maintainer questioned that distinction. This PR removes that incidental test expectation and makes no cross-realm equality claim. | A future public contract decision needs a host-boundary witness before either equality policy becomes an oracle law. |

Captured `inArray` list-entry refresh and whole-live-query reconstruction were
explored as new features. The pre-PR evaluator and live graph did not already
deliver the whole-result behavior. The maintainer withdrew that expansion for
this PR because of its production-code and query-planning cost. A separate
proposal must define its dependency and invalidation boundary before adding
an oracle or production graph machinery. In-place edits to a Date or byte
item, unsigned default byte ordering, and guarantees after callers alter
standard objects are also outside the accepted contract.

Earlier experiments and RED/GREEN records remain in published commits on
`codex/oracle-test-retirement-2-blocks`; this narrowed source tree does not
retain their production fixes. Statuses in this record distinguish an executed
earlier-branch failure, current-base source inspection, a proposed policy,
and a current-base observation that still needs to be run.
