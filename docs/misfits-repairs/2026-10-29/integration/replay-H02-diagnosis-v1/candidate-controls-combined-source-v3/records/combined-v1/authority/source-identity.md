# Inspected source identity and limits

Read-only inspection used exact S at
`9cfa11fc712866f8f276e85762865ebb8bd49cbe`. All eight selected live sources
below were hashed with SHA256 and matched the corresponding copies under
`H/prepared-neighbor-controls-v4/source/`. This is a selective comparison, not
a new full 563-entry or dependency/V8 audit.

| Source relative to S | SHA256, also matching frozen V4 copy |
| --- | --- |
| `scripts/h02-progress/candidate-controls.ts` | `d1b3f65b082cf18112df6531d0372b25b2e64d98052a1b8fd899f0beb64c3cb7` |
| `scripts/h02-progress/candidate-controls.test.ts` | `5d8416aca20ceffcbaf9481769ba14a58889068e76466cb9e42a67406b5d23aa` |
| `scripts/h02-progress/candidate-controls.config.ts` | `edef50ca95f1ad023f4285ff3f99e82e0c76b0519e25a10f3f55463dfb10e046` |
| `packages/query-db-collection/tests/queued-answer-progress-oracle.ts` | `d80dea940e2fa9613a803b7f942bba17e389b68045ecba6984e88f86db26724c` |
| `packages/query-db-collection/tests/queued-answer-progress-driver.ts` | `f69c0f5c4857cc53b0cf0bf4cd847d58913ac5c30093da3115dc657a597980cc` |
| `packages/query-db-collection/tests/queued-answer-progress-neighbors.test.ts` | `0854dc788327a45badfefc5199c0f1adc5a9ae76e54b74b32d21204bc7bb7436` |
| `packages/query-db-collection/tests/queued-answer-progress-oracle.test.ts` | `e37a74feee5ee43f6c52efe3f6c745d9059c0d8f2f4e3eeb69c0dea90fc19337` |
| `packages/db/tests/query/load-subset-retained-publication-oracle.ts` | `37d8b6e6e6243e86ff1cdc85cf4583c37fe91ba3673be7757bfda90d07c7f81c` |

The packet/freeze references supplied by the native author and confirmed in
the frozen independent source acceptance are:

- `prepared-neighbor-controls-v4/packet-sha256-v4.json`:
  `5a3d1e13e8dc71e8ae48c36c3cd4a669e1fb93b5458a017050ac7b2f7ccf1b42`.
- `prepared-neighbor-controls-v4/source-freeze-v4.json`:
  `acd050dcb5ad16e0aea2bee3d039528f2a2e6c40d0766fce880c04974de8f74d`.
- `design-review/queued-answer-progress-future-control-seam-v1.md`:
  `e77bd2218a24d9fea7db43e8ef3b0ef8e392a0fc2ac0032b85aa1fda32b0f70f`.
- `design-review/queued-answer-progress-successors-independent-assessment-v1.md`:
  `af9e5c9c973b07e5a34de2c9bc130d84a5d8f466a506cd63f09ae8e0be65a67d`.
- `metadata-receiving-plan-v1/plan.md`:
  `40ae44ca12b6710f3e65fe8e46dd15a310d8f06a53bfd2be83ec7379afdf525b`.

## Source anchors behind the plan

`candidate-controls.ts:231` lists the 20 states; `:254` creates their reach
helper. Repository text search found no caller of that creator. The helper
references occur only in the support file and its nine local calibrations.
`captureCandidateHostGap` at `:269` captures a real turn but accepts externally
supplied public readers/operation observers; no receiving fixture supplies them.

`queued-answer-progress-oracle.ts` declares the bounded existing history,
independent finite result model, observation projection and shared checks.
`createProgressReceiptCheck` handles reload payload/event publication, not
candidate window/failure cuts. The driver uses `toArray` over marker rows in
the same anti-join, and calls no public `setWindow`/`getWindow` or candidate
helper. The generated runner uses fixed `oracleRuns(8)` and unseeded/replay
`oraclePropertyOptions(8, property)`; root registration of the property is
explicitly pending in its prose and absent in the inspected shared config.

Existing internal graph attachment is available through `LIVE_QUERY_INTERNAL`
(`query/live/internal.ts`, builder utils at `collection-config-builder.ts:357`).
`currentSyncState` is public internal state. Input revision getters are at
`:811–816`. `SubsetDemandController.setDemand` already returns `DemandUpdate`;
`CollectionSubscriber.setDemand:238` currently returns void. Baseline D2
`run():59` fully drains; it has no cooperative stop.

Facade source records forward commit at `bucket-facade-adapter.ts:151`, restore
commit at `:338`, and rollback disposal at `:352`. Existing facade rollback
owner opening prose explicitly covers controlled holds and failed/restoring
flushes, with narrower event/held-row limits. The lifecycle grammar, optimistic
history opening, ordered lifecycle opening, layered publication opening and
Query ownership owner were read for relevant authority and limits. The full
glossary, oracle rubric, live-query architecture and oracle-review skill were
reopened for this review. No oracle was authored or edited.

The exact metadata-owner authority correction and coverage paragraph preserve
the already existing attribution/timeline/callback/downstream coverage. This
plan does not re-audit that owner, reduce its scope, or duplicate its separate
real QueryClient receiving proposal.

No supplied runtime count, RED/GREEN label, or pending independent result
assessment is reclassified by this source review. Hashing/report whitespace
inspection is the only validation performed by this author.
