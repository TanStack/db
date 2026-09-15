# Loss audit of the guarantee catalog

Date: 2026-09-15. Instrument: `loss-audit`. Status: complete, bounded.

Three fresh agents independently reopened assigned primary documents and
compared each with the frozen [survey](02-research-survey.md). All 27 documents
were assigned, including its two companion pages. No agent read sibling notes.
The parent read every returned source-level record before collating this index.

Frozen SHA-256:
`b31c3059af06b4afd40134577a60a50083c10f96b6088c4288eea35518e9e4b2`.
The survey remains unchanged. Source assignments and isolation limits are in
[audit controls](audits/README.md).

## Reading

The source-by-source records contain **65 candidate omissions**: 20 language
and boundary items, 22 query/policy items, and 23 protocol items. These are not
65 new framework requirements, production defects, or agent-only capabilities.
They include narrower conditions, application obligations, explicit limits, and
parts of mechanisms that the catalog compressed. Some relate to the same broader
question; their separate provenance is retained.

The following comparisons illustrate the returned readings without choosing
which items should be restored or implemented:

- **Custom validation versus an unchecked assertion:** L19a/L5a distinguish
  inspecting an existing validator/decoder's accepted-value guarantees from
  asserting a type. This was only partly represented by the codec/schema rows.
- **Repeatable effects versus no effects:** Q20/P18c/P23d retain idempotence or
  existing deduplication as separate possible grounds for retry. The catalog's
  concrete retry task concentrated on effect-free prefixes.
- **Read-only query obligations:** Q02 retains a fact an agent could establish
  about an opaque helper called from a query, independent of mutation footprints.
- **Data identity versus current array position:** Q21/P17a expose different
  identity requirements for targeting a record and identifying a completed write.
- **Runtime placement versus source confidentiality:** P18a separates code
  executing only on the server from code actually excluded from client delivery.
- **Failure and invalidation need a consumer response:** P16a/P25a retain what
  happens after an upload fails or backend identity changes, beyond merely
  detecting those conditions.

These examples refer to findings below, whose primary sources and precise
locations are in the linked audit notes. Their transfer to Endpoints remains
an inference, not an established implementation contract.

## Complete finding index

Every returned identifier is retained. A source's underlying rule or limit may
appear in more than one item; no cross-source agreement is counted as independent
proof. No scanner returned a null result, but that does not imply exhaustive
recovery or that every omitted detail should be restored.

| Source | Returned identifiers | Full source-level record |
| --- | --- | --- |
| Ur/Web POPL paper | L4a, L4b, L4c | [language](audits/language.md) |
| Ur/Web manual | L5a, L5b, L5c, L5d | [language](audits/language.md) |
| Links paper | L20a, L20b | [language](audits/language.md) |
| Eliom paper | L21a, L21b | [language](audits/language.md) |
| tRPC validators | L19a, L19b, L19c | [language](audits/language.md) |
| Open RIA DomainService | L22a, L22b, L22c | [language](audits/language.md) |
| Unison Cloud | L27a, L27b, L27c | [language](audits/language.md) |
| Wasp Actions | Q01 | [queries](audits/queries.md) |
| Wasp Queries | Q02, Q03 | [queries](audits/queries.md) |
| Convex Queries | Q04, Q05 | [queries](audits/queries.md) |
| Convex Mutations | Q06, Q07 | [queries](audits/queries.md) |
| Convex Actions | Q08, Q09 | [queries](audits/queries.md) |
| Thinking in Relay | Q10, Q11 | [queries](audits/queries.md) |
| Relay mutations | Q12, Q13 | [queries](audits/queries.md) |
| Hasura multiple mutations | Q14 | [queries](audits/queries.md) |
| Hasura permissions | Q15, Q16 | [queries](audits/queries.md) |
| Instant permissions | Q17, Q18, Q19 | [queries](audits/queries.md) |
| Falcor Model | Q20, Q21, Q22 | [queries](audits/queries.md) |
| Replicache | P12a, P12b, P12c | [protocol](audits/protocol.md) |
| PowerSync | P16a | [protocol](audits/protocol.md) |
| Electric | P17a, P17b, P17c | [protocol](audits/protocol.md) |
| Meteor | P18a, P18b, P18c | [protocol](audits/protocol.md) |
| RxDB | P23a, P23b, P23c, P23d | [protocol](audits/protocol.md) |
| Zero | P24a, P24b, P24c | [protocol](audits/protocol.md) |
| LiveStore | P25a, P25b | [protocol](audits/protocol.md) |
| LiveView | P26a, P26b | [protocol](audits/protocol.md) |
| Firestore transactions | P19a, P19b | [protocol](audits/protocol.md) |

## Controls and limits

- Source records identify already-retained material, preventing the broad
  presence of “transactions” or “optimism” from being reported as a new omission.
- Loss mechanisms such as compression/category mismatch are inferred from the
  frozen text. The agents did not observe the author's decision process. No
  finding demonstrates majority voting or deliberate rejection.
- Agent placement was fresh relative to the parent, with one group per agent.
  Within each group sources were read sequentially, so this is weaker isolation
  than one independent context per document. Models and retrieval tools remain
  correlated.
- All assigned source URLs reopened successfully. Mutable docs and moving source
  branches can drift; an omitted detail could have changed since an earlier read.
- **Main artifact risk:** a loss audit encourages finding additional details.
  Recovering a supported condition does not demonstrate its priority, relevance
  to this release, or feasibility as an agent certification.
- **Unmeasured:** production semantics, certificate correctness, sound evidence
  admission, and the feasibility of each proposed transfer. No new executable
  checks or runtime experiments ran in this audit.

The selected instrument sequence ends here. The catalog, matched cases, and
unrestored findings are available for a later design or evaluation request.
