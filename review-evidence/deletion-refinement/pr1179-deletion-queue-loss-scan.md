# Deletion queue source loss audit

This is a read-only, single-source comparison. It identifies source material absent or weakened in the frozen candidate; it does not decide whether to restore that material or claim bug-class closure. No tests or mutants were run. The sibling `retirement_oracle.tla` was not read. Changes made after the frozen candidate are outside this report.

Pointers below use these aliases:

- **S**: `/Users/kyle.mathews/.codex/worktrees/pr-1179-review/tanstack-db/review-evidence/deletion-tla/deletion_queue_oracle.tla`, SHA-256 `845655541b015b81229ab607aabc2edf266617a4433fdf007289ca323c4ec343`.
- **C**: `/tmp/pr1179-loss-audit-frozen/deletion-queue-oracle.test.ts`, SHA-256 `093778c92c5070131f3a1cb2b08e9c3fbaf0e7f80399f9f81b585adb18d16018`.
- **H**, **D**, **W**: `packages/indexeddb-db-collection/tests/harness.ts`, `tests/idb-driver.ts`, and `src/wrapper.ts` under the same worktree as S. These were read only to establish driver mechanics.

The loss-audit instrument was read at `/Users/kyle.mathews/.codex/skills/field-lab/reference/instruments/loss-audit.md`. The repository oracle guide and glossary were also read. The findings concern static reach and observation, not runtime results.

## Recovered distinctions

### L1 — A queued second invocation became a later sequential invocation

**Source support:** S:7–12 describes delete → consecutive opens/recreation → delete in the native queue, and expressly permits both delete invocations while the original descriptor still exists. `Init` already marks both requests queued (S:35–36). `AnnounceDelete` chooses `s.database` at the request's queue turn (S:42–49). The deliberately overstrong challenged claim is `target[2] ∈ {0,1}` (S:130–131).

**Frozen candidate:** C:54 invokes the first delete. C:77 awaits its native success. C:80–83 then awaits connection, seeding, Collection restore, and the unmanaged B connection. Only C:87 invokes the second delete. B therefore exists before the second invocation in every cell.

**Where lost:** Schedule compression and category mismatch between *invocation time* and *wrapper callback delivery*. Delaying A's success callback in C:42–50 preserves a pending A caller after native success. It does not queue B's delete while A exists. The final empty restore at C:107–108 proves the later invocation deletes B; it cannot distinguish invocation-time binding from queue-turn target selection when both times already refer to B.

**Bound:** S has no separate invocation transition; its queued requests and prose abstract that history. Therefore this is an absent receiving witness for the challenged invocation-time claim, not a demonstrated violation of the executable candidate's delayed-receipt law. In particular, S's atomic `Recreate` must not be read as a proof that every intermediate browser open callback and Collection restore can complete before an already-queued delete runs.

### L2 — Native deletion while blocked is not independently observed

**Source support:** S:60–71 separately records native success and whether native deletion happened while either the unmanaged blocker or admitted A transaction remained. `NativeDeletionWaits` rejects that fact (S:123); `CallerWaitsForNative` is a different law (S:124).

**Frozen candidate:** Native success resolves a deferred promise at C:49, but there is no native-success Boolean or event history. The blocked checkpoints inspect only caller fulfillment: C:65, 68, 73, and 91. Both success callbacks are deliberately withheld by C:50 until their receipt gates resolve. Consequently a false caller flag does not establish an absent native completion. C:77 and 96 observe native success only after the blockers are released.

In the blocker-first branch, C:72–75 closes the unmanaged blocker, performs a synchronous caller check and a Promise-type check, then releases the transaction. `gate.finished` is always a Promise (D:15–20, 30–35); C:74 cannot establish that the transaction remains unfinished. There is also no intervening host-progress checkpoint while the transaction alone holds deletion.

**Where lost:** Two modeled outputs were reduced to one observable, with the omitted output masked by the callback gate. The transaction-only interval was also compressed. Raw durable reads at C:69 and 94 preserve valuable row evidence while unmanaged connections remain; they are not an explicit observation of whether the delete's native success event occurred.

**Bound:** `ignoreBlocker` is a hostile violation of the native/provider contract, not a legal native operation that production must recover from. This omission does not show that the wrapper can force a conforming IndexedDB implementation to delete through a live blocker. It limits the candidate's claimed independent native/caller checkpoint evidence.

### L3 — Release-before-announcement histories were dropped

**Source support:** `FinishOldTransaction` needs only an active transaction (S:51–53). `ReleaseBlocker(1)` has no announcement precondition, and `ReleaseBlocker(2)` needs only recreation (S:55–58). Thus the source permits either/both A obligations to finish before A's announcement, and B's unmanaged connection to close before B's announcement.

**Frozen candidate:** Every cell first awaits `blocked[0]` (C:62), then releases A's obligations (C:66–76). Every cell also awaits `blocked[1]` before closing B's blocker (C:88, 95).

**Where lost:** History range reduction to histories containing two blocked events. The two release orders remain represented after A's announcement, but not the source's pre-announcement release cuts or a deletion with no remaining unmanaged blocker at announcement. This is an omitted part of S's legal grammar, not evidence that its present two-blocked-event cases are wrong.

### L4 — One native/caller receipt order and intermediate observations were compressed

**Source support:** After each `FinishDelete`, `DeliverReceipt(i)` remains independently enabled until that caller completes (S:84–90, 98–104). After the second native deletion, the source allows either caller receipt first. Status and row invariants are evaluated in every modeled state (S:125–128).

**Frozen candidate:** The `after-second` cell always delivers B's receipt and awaits B before delivering A's receipt (C:96–99). There is no A-after-B-native-but-before-B-caller cell. Other cells deliver A while B is still native-blocked or earlier; those are different boundaries. The candidate also samples A's status at C:63 and C:104, rather than after each native completion/old receipt/recreation boundary. Rows and status are not all compared at every checkpoint, despite C:11–12's wording.

**Where lost:** Receipt-order reduction and observation thinning. No event recorder preserves a transient row/status violation between sampled checkpoints. This report does not claim such a transient occurs. The source's specific `oldReceipt` fault is still distinguishable in the preserved `second-blocked` cell; the omitted order is not required to reach that fault.

### L5 — Source fault controls have no executable calibration in the frozen file

S contains `ignoreBlocker` (S:66), `oldReceipt` (S:87–90), and `prematureReceipt` (S:92–96). C contains no corresponding wrong-answer injection or asserted calibration run. Its `second-blocked` row check has the right premise for `oldReceipt`, and its pending caller checks target premature caller success. That is static sensitivity reasoning, not a demonstrated rejection receipt. No claim is made about external calibration evidence not included in the frozen candidate.

**Where lost:** Fault controls became baseline assertions without their distinguishing negative executions. The native `ignoreBlocker` control additionally crosses a provider boundary; it must not be presented as a legal blocker-release history or inferred from an ordinary wrapper mutation.

## Complete source mapping

| Source element | Concrete candidate coverage and limit |
| --- | --- |
| `Init` (S:28–38) | A rows, managed descriptor, unmanaged connection and admitted transaction exist at C:26–31. Both modeled delete requests being queued is not reconstructed: L1. B's initially stored blocker Boolean is a ghost future fact, not a requirement to open B before creation. |
| `AnnounceDelete` (S:42–49) | Both production deletes and native blocked events occur at C:54/62 and C:87/88. Public error and retained rows are checked at C:63–64 and 92–94. Invocation and announcement are not the same event: L1. |
| `FinishOldTransaction` (S:51–53) | Real `holdStore` transaction, released in both A obligation orders at C:66–76; D:14–35 proves the held transaction mechanics. Pre-announcement release and a meaningful transaction-only pending checkpoint are absent: L2/L3. |
| `ReleaseBlocker(n)` (S:55–58) | Both unmanaged connections really exist (C:29, 83) and are explicitly closed (C:70/72, 95). Their post-announcement order relative to A's transaction is crossed. The unmanaged blockers themselves were **not** lost. Earlier release cuts are L3. |
| `FinishDelete` (S:60–71) | C:77/96 await real request success, independently of callback delivery; C:107–108 observes final native deletion. Native success absence during blocking is L2. |
| `Recreate` (S:73–79) | C:80–83 expands creation, seed, restore and unmanaged open sequentially. This matches the source's settled abstraction, while not proving interleaved open callbacks or prequeued-delete restore timing. |
| `DeliverReceipt(i)` (S:84–90) | Success-property interception and C:79/84/89/98–99 supply the stated four A delivery cuts and B delivery. H:94–102 drains controlled transport. The additional post-B-native receipt order is L4. |
| `PrematureReceipt(i)` (S:92–96) | Pending caller assertions exist. No fault activation/calibration is in C: L5. |
| `Next` / `Spec` (S:98–106) | Eight deterministic histories (C:20–24), not all source interleavings. S has no fairness constraint, so it does not establish eventual completion or a timeout bound. |
| `TypeOK` (S:108–121) | Ghost position, target and finite abstract types are not public observations. Not copying these checks into TypeScript is not itself lost product coverage. |
| `NativeDeletionWaits` (S:123) | Independent negative native-success observation absent: L2. |
| `CallerWaitsForNative` (S:124) | Pending callers at blocked cuts and while callbacks are withheld after native success; eventual caller fulfillment at C:101. Exact fault calibration absent: L5. |
| `RecreatedRowsSurviveOldReceipt` (S:125) | B exact rows checked after recreation and during second blocked deletion (C:86, 93–94). The crucial retired-B/late-A premise is present. C:103 additionally retains B after its native database is gone, beyond this invariant's `database = 2` premise. |
| `ClosedConnectionsStayErrored` (S:126–128) | Error checks at both announcement cuts and the final cut, with intermediate sampling limits in L4. |
| `DeletionIsBoundToOriginalDescriptor` challenge (S:130–131) | Final deletion reaches B, but the invocation-time-versus-queue-turn distinction is absent: L1. This is expressly a false/overstrong claim in S, not a product obligation to enforce. |

Two further source limits prevent false recovered items. S:8–10 explicitly excludes intermediate open callbacks. S:17 says managed close forbids new work, but S contains no new-transaction admission transition; the Boolean `managed` field alone does not prove that admission law, and C has no post-close admission probe. Those are abstraction limits rather than evidence that a modeled admission transition was dropped. Ghost lifetime identities remain declared as such in both S:13–14 and C:4–5; there is no supported request here for stored identities, broadcast tokens, or conditional native deletion.
