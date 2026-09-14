Quick term scan:

This pass records different uses of **correct**, **active**, **synced**, and **supported/analyzable** in the discussion and prototype. It does not choose a replacement definition or a fallback policy. Completed 2026-09-11; sources are the user's statements, the previous boundary probes, and the local code cited below.

## Loadings and substitution checks

| Speaker or source | When it says the term, it means… | Concrete substitution and changed evidence or choice |
| --- | --- | --- |
| Kyle's original “every active collection should always be exactly the same as the pg state” | **Correct** as equality of all demanded query results to a reference database state | At the oracle's held optimistic checkpoint, the reference is a separately prepared tentative PG state, not the still-blocked application's committed state. Replacing “PG state” with “current committed server state” would reject the intended optimistic insert. |
| The generated oracle's optimistic checkpoint | **Correct** as agreement with its reference effect for this generated operation | With a deterministic Todo insert, predicted and accepted effects can match. Substituting “predict every server outcome” adds unseen read-dependent branches that the current generated case does not establish. |
| Prior multi-table probe's tentative-state discussion | **Correct optimism** as internally consistent application of a specified local prediction | Related collections can agree on a tentative allocation even if the server later rejects it. This criterion requires a prediction and rollback contract; it does not certify eventual acceptance. This is an analyst distinction, not a policy Kyle has chosen. |
| Successful authoritative checks | **Synced** as agreement with an authoritative observation after reconciliation | A write acknowledgement alone is insufficient evidence. With concurrent writes, replacing this with “equals the latest server state at every instant” adds a different, stronger temporal requirement. The observation/version contract remains open. |
| Runtime settlement and Kyle's exhausted-read correction | **Done** can refer to accepted write, finished client transaction, or reported sync failure | `runtime.run` awaits the RPC and target refetches before persistence completion. Kyle permits a client error when reads exhaust. Substituting “write failed” for “read failed after commit” would incorrectly imply that the server write did not happen. Retained rows and retry recovery remain open. |
| Kyle's affected-set discussion | **Active** as collections whose coherence presently matters | “Instantiated,” “has a subscriber,” and “needed by pending work or preload” select different sets. A collection retained after its last subscriber leaves tests that difference; activity policy cannot be inferred solely from cache existence. |
| Public DB subscriber API | **Active subscribers** as counted subscriptions | `subscriberCount` is an observable input. Substituting it for the whole endpoint demand policy would make an additional choice about preloads, pins, and indirect consumers. The endpoint runtime currently keeps created instances, without making that policy explicit. |
| Kyle's latest “isn't analyzable … exclude that from anything clever” | **Supported analysis** as a bounded basis for enabling dependent optimizations | A failure to establish a predicate may rule out local membership evaluation while a separately established relation dependency can still support conservative recipient selection. Conversely, known recipients do not prove a small patch is sufficient. The user's exclusion rule does not name one universal capability bit. |
| Query extractor | **Checked** as recognized syntax under stated fixture assumptions | `extract` can return `not checked` with a reason. Its `checked` result explicitly assumes trusted auth and does not check wire types. Substituting “safe for every optimization” would expand what the evidence certifies. |
| Bound endpoint compiler | **Supported endpoint** as acceptance by the narrow prototype compiler | The binder turns failed query extraction into a compile error. Substituting “execute normally but disable optimization” describes a possible future fallback, not the current behavior. |

## Distinctions that survive substitution

The user's bounded-support requirement remains after replacing the words: an optimization may rely only on information actually established for its case. Unknown impact is different from established no impact. A conservative superset differs from exact recipients, and sufficient update data differs from minimal or faster update data.

“Not analyzable” can also name different failures. Unsupported static syntax does not establish that server execution cannot supply useful effects. Missing local rows do not establish that query semantics are unknown. Both can disable a particular local update without proving the entire endpoint must be rejected. Which other operations remain allowed is still a design question.

Nor does “fallback” erase the optimistic contract: a later full refetch can repair authoritative results, but does not retroactively make an unsupported optimistic view exact. Refreshing a conservatively complete recipient set also does not itself establish atomic publication or a common snapshot. Those are separate obligations.

**Control:** The material choices remain after the substitutions: define tentative-state behavior under missing information, select which forms execute with conservative delivery, and define observation and demand boundaries. This is not a disagreement solved by clearer names alone.

**Distortion:** The table may make these criteria look independent and settled. They interact during pending writes, activation, and failures; no runtime behavior or user preference was inferred merely from a word choice. No tests ran in this pass.

Sources: [oracle driver](../integrated-todo/tests/oracles/driver.mjs), [failure receipt](../integrated-todo/evidence/e2e-current/coherence/replay.json), [runtime](../integrated-todo/src/runtime.ts), [extractor and its assumptions](../track-a-analysis/probe.mjs), [bound compiler](../integrated-todo/bound-transform.mjs), [multi-table probe](./ground-conditions-multitable.md), [subscriber count](../../../packages/db/src/collection/index.ts:425), and exact user comments in the Field Log.
