# On-demand cache-generation oracle review

Reviewed code head: `7f1df5c82f7544148fe316ccbc115030ead8b0a7` on
`codex/evaluate-2056`. This record is a docs-only follow-up to that code
commit. The [design record](issue-2056-cache-eviction-design.md) explains the
chosen lifecycle and its counterexamples; the
[coverage map](../oracle-coverage.md#electric-recovery-demand-and-scoped-persisted-restore)
names each executable owner and its remaining receiving cuts.

## Judgment and observed boundaries

When persisted evidence cannot authorize an on-demand Electric cache, the run
must retire its claimed cache generation and reload only active subset demands.
Another run with a valid claim keeps its own public rows and storage. An expired
claim cannot read, write, or republish retired rows. The replacement Electric
provider session excludes late callbacks and acknowledgements from its retired
session. A subset load that has begun uncancelable local hydration settles only
after the rows it accepted become visible, even when its caller aborts; it then
reports `AbortError`. An explicit source offset or handle does not certify an
incompatible persisted key set. These laws come from the approved design, the
Collection subset signal and applied-receipt contracts in `packages/db/src/types.ts`,
and the Electric guide. They are bounded by the observations below, not a claim
that every crash, native host, or provider schedule has been explored.

The primary model and production drivers live in
`packages/db-sqlite-persistence-core/tests/persisted-oracle.test.ts`,
`packages/db-sqlite-persistence-core/tests/sqlite-resume-snapshot-oracle.test.ts`,
`packages/browser-db-sqlite-persistence/tests/per-collection-coordinator-oracle.test.ts`,
`packages/electric-db-collection/tests/electric-descriptor-isolation-oracle.test.ts`,
`packages/electric-db-collection/tests/electric-oracle.property.test.ts`, and
`packages/electric-db-collection/tests/electric-sdk-delivery-oracle.property.test.ts`.
Their opening prose assigns narrower authority and names model, history,
production path, and checkpoint. The SQLite owner uses real `node:sqlite` and
an independently computed generation/claim ledger. The Electric installed-SDK
owner supplies controlled HTTP to the real client, while the Browser owner
exercises its coordinator and host factory.

Three independent oracle reviewers challenged the integrated code after the
initial implementation. One reproduced early `AbortError` settlement while a
held cache read later published a row. Both fixed and random persisted Electric
interleaving campaigns were RED at the pre-release settlement comparison and
GREEN after the wrapper waited for the admitted hydration. Its temporary
composed follow-up passed five adjacent cuts, including prompt abort before
hydration, cleanup during rotation, old receipt fencing, and post-hydration
Electric request abort. Another reviewer used real SQLite and the installed
Electric SDK to show that explicit offset and handle each exposed a stale row
before source response; the no-cursor control did not. The expanded permanent
oracle was RED for both explicit cases at that public-row checkpoint and GREEN
after the trust predicate changed. The third reviewer executed five SQLite
claim/rotation cases and three Browser receiving cases without a new defect.
Earlier hostile controls rejected global truncate, stale provider callbacks,
unclaimed writes, retained old acknowledgements, and a false-green insert
fixture at their named checkpoints. These outcomes are assertion failures;
no timeout or setup failure is counted as a successful mutant kill.
The interleaving shrink reported seed `18530601`, path `0:0:0:0:0`. Direct
replay with `TANSTACK_DB_ORACLE_PROPERTY=electric.persistence-interleaving`
failed after one test at that same held-hydration comparison under an
in-memory early-abort mutant; direct replay on the reviewed code passed. The
mutant was applied by a temporary Vitest transform outside the PR worktree.

Validation on the reviewed code head: Electric 1,074 passed, 1 skipped;
persistence core 1,247 passed, 2 TODO; Browser 405 passed; Node 231 passed;
Expo 76 passed; React Native 251 passed. The changed packages built, Vitest
reported no type errors, changed-file ESLint had no errors, Prettier passed,
and `git diff --check` passed. A core lifecycle test timed out during a
concurrent multi-package run; it passed alone and in the later serial full
core run. Native multi-tab/OPFS receiving and live Electric service behavior
were not run.

## ORC-012 requirement audit

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Applicable. The approved cache-generation and subset contracts above are the authority. Each owner states its narrower path and limits. Full native-host and live-service behavior remain outside the result. |
| ORC-002 | Applicable. Expected rows come from ordered source changes or independent map/claim ledgers, rather than the production cache classifier or Electric tag index. The explicit-cursor and held-abort laws use public pre-response and settlement observations. |
| ORC-003 | Applicable. The owner files place contract prose beside their model, legal histories, production driver, observations, and comparison cuts. The interleaving owner now explains why abort does not undo already admitted cached rows. |
| ORC-004 | Applicable to generated campaigns. The persisted interleaving grammar reconstructs both schedule kinds and rejects missing, foreign, and out-of-range values. Other owners record their own axes and controls. Native host scheduling and arbitrary service frames are excluded. |
| ORC-005 | Applicable. Drivers call real Collection, persistence, coordinator, and Electric entry points. Checks compare public rows, durable rows, claims, request counts, load settlement, and acknowledgements at held or final cuts. Real SQLite plus installed SDK receives the cold-restart premise. |
| ORC-006 | Applicable. Wrong designs were executed: global truncate, stale callback admission, unclaimed writes, early abort settlement, explicit-cursor cache trust, and merge-on-insert fixture behavior. Each named outcome was an assertion failure at the intended comparison. |
| ORC-007 | Applicable to important generated properties. Their fixed and unseeded campaigns use the same property and budget, with seed/path replay interfaces. Direct replay of the persisted interleaving RED seed `18530601` and path `0:0:0:0:0` failed under the early-abort mutant at the intended checkpoint and passed on the reviewed code. Fixed real-SQLite/SDK examples do not trigger ORC-007. |
| ORC-008 | Applicable where a claim ledger or retained-demand state was added to a reference model. Distinct current, retired-but-claimed, and expired states are retained because claim, read, and rotation next actions distinguish them. The source-row model stores only rows and authored order; cache generations are not inferred from public rows. |
| ORC-009 | Applicable. Model claim and generation map to the glossary's persisted cache claim and persisted cache generation. The model's controlled HTTP response is provider input, not a Collection publication. Electric provider session remains separate from Collection sync run. |
| ORC-010 | Applicable. New held-cut drivers release gates and clean up in `finally`, and the Electric lifecycle helper retains primary failures with cleanup diagnostics. Not every older fixed witness has been audited for cleanup-failure fidelity; no universal ORC-010 claim is made for the whole pre-existing suite. |
| ORC-011 | Applicable. A controlled ShapeStream mock could share the wrong assumption that a full-mode subset request works. The installed SDK/controlled-HTTP owner supplies a second formulation and rejects that assumption. Real SQLite cold restart distinguishes a mock-only cache. Native receiving remains separate. |
| ORC-013 | Applicable. Valid and expired claims distinguish generation retention from wrong global eviction; absent and explicit source cursors distinguish cache trust from cursor selection; abort before and after hydration entry distinguishes prompt cancellation from premature settlement. These are bounded histories, not all possible thresholds. |
| ORC-014 | Applicable. Controlled Electric delivery and coordinator messages supply material premises. Installed-SDK and real-SQLite witnesses receive the cold-restart premise. Native multi-tab/OPFS receiving, live service framing, and timed-out old-leader release retry lack matching receiving witnesses and remain assigned in the coverage map. |

## Open cells

A later test-only follow-up, `e5095c0d6`, strengthened the Electric canceled
subset reacquisition witness after CodeRabbit observed that `second !== true`
also accepts a cached rejected promise. The oracle now awaits the identical
later demand and requires a second SDK snapshot invocation in both late
resolve and late reject histories. A rejected-promise wrong result passes the
old predicate and fails the new one; the focused tests and typecheck pass.
This extends the caller-settlement and provider-invocation comparisons without
changing the production law or the reviewed implementation commit above.

The coverage map keeps the specific in-scope cells open: claim expiry after
public source publication but before SQLite accepts the write is fail-stop;
legacy pre-upgrade on-demand tables remain isolated but uncollected while old
tabs can still write; prompt cleanup during a permanently held adapter rotation,
native multi-tab/OPFS receiving, old-leader release timeout retry, full retired
metadata collection, and direct claimless access after catalog collection are
not established. Browser receiving also lacks one combined history with two
runs sharing a generation, expiry of only one claim before its timer, and exact
warm-peer row and lease retention. This review does not declare the entire
cache-eviction bug class closed.
