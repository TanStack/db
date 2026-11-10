# Targeted intake: #2349

Captured November 3, 2026 with the complete body and all conversation comments (zero). This extends the cumulative inventory from 163 to 164 captures: 140 issues and 24 PRs across the same 26 clusters. The November 2 census of 144 open items is unchanged.

| Issue | Primary assignment | Session | Work kind |
| --- | --- | --- | --- |
| [#2349](https://github.com/TanStack/db/issues/2349) | Draft values / nested sibling edits and prototype preservation (standalone) | B31 | reported runtime correctness bug with draft-oracle coverage gap |

The reporter records untouched class and null-prototype sibling values becoming plain objects in the optimistic row after editing a nested numeric field, then regaining their original runtime shape after sync confirmation. A plain-object control keeps its prototype throughout.

The controlled Collection probe holds `onUpdate` pending, edits `draft.payload.count`, observes the untouched `payload.leaf`, supplies a matching sync update and awaits `transaction.when('settled')`. The class and null-prototype probes reportedly lose their prototypes during the optimistic interval and recover after confirmation. All three controls publish twice; the report explicitly does not establish an additional-notification regression. The body attributes the loss to `deepClone()` rebuilding values with `{}` on the draft-copy path; this cause was not independently inspected in this intake.

Nested draft copying and untouched runtime-value preservation require a separate judgment from mutation input types, sync confirmation timing and observer row comparison. No existing open-item cluster names this boundary; retain standalone B31. #1714/#1800 are historical fix-boundary context, and #2346 is discovery context, not evidence of cause.

The report says `proxy.ts` has no diff against `origin/main` at `1443dc92e5417394acbdc98b782caa9802848ce6` while evaluating #2346. Its stricter Collection comparison makes restored shape observable, but the report keeps the cloning repair separate. It states #1714 was closed after #1800's class-instance fix; this nested sibling witness asks for that repair boundary to be validated rather than declaring the old issue reopened or duplicated.

Establish the accepted runtime-shape preservation and draft-isolation laws through the existing draft oracle and its documented limits. Generate nested sibling edits across class, null-prototype and plain values, with pending/confirmed observations and native-value controls. All three reported probes publish twice, so the report does not establish an additional-notification regression. No new product capability is requested. The body says the draft coverage map already lists original class instances being read as plain objects as an open limitation; the follow-up must verify the current owner, law, limits and baseline before edits.

[Source](https://github.com/TanStack/db/issues/2349): “Editing a nested field can strip the prototype from an untouched sibling value in the same nested object. The optimistic row then has a different runtime type until sync confirms the row.”

## Evidence and limits

[Assignments](supplement-2349/assignments.json), [capture receipt](supplement-2349/intake.json), [raw capture](supplement-2349/capture.json), [extraction ledger](supplement-2349/batch-001-ledger.md), [attributes](supplement-2349/batch-001-attributes.jsonl) and [quotes](supplement-2349/batch-001-snippets.md) retain the captured evidence. Metadata has zero reactions/comments and a recent creation date; this is no frequency or popularity claim. No linked source/history/coverage record or reproduction was independently checked. No production/tests or GitHub state were changed by this intake.
