# IndexedDB approved donor follow-up

Implementation revision: `08c58153f`. Starting revision: `32240d53af003f223f333c3bca1105ada02e4fbd`.
The maintainer approved all recommendations after the donor port: core typed-key
identity, abnormal closure, mutable capture, dedicated workers, native naming
and WebKit Blob evidence, and optional blocked diagnostics. Atomic storage
read-modify-write remains a separate API proposal; native durability stays unchanged.

## Laws and receiving evidence

| Law and authority | Independent owner and legal histories | Required observations and enforcement |
| --- | --- | --- |
| Collection key identity distinguishes numeric and string keys; existing public key contract, HC005. | Core optimistic transaction payload owner: four same-text numeric/string pairs, both author orders, four operation histories and success/rejection (64 cells). Existing same-key collapse remains. | Exact handler list preserves order, type, multiplicity and values; public keyed rows and size after settlement. Original source fails 32 original-order cells. Native host owner receives a same-transaction typed pair through persistence, peer update, import, clear and restore. |
| Supported mutable updates capture values at callback return; imports capture validated rows before awaiting storage. Approved ownership contract. | Core detachment model uses independent native construction/structuredClone and graph checks. Adapter value companion crosses six mutable shapes with update/import and real handler/storage holds. | Caller changes cannot alter immediate optimistic update, settled public, peer, export or raw durable values. Removing import capture fails all six import assertions. Original proxy fails 11 corrected detachment assertions; no timeout is counted as a kill. |
| Binary snapshots preserve native bytes, range, and buffer/view aliases. Existing typed-array compatibility remains. | Core detachment owner crosses local/foreign/shared buffers and both property orders, plus strict one-argument and prototypal subclasses. Native iframe companion receives foreign buffer/Uint8Array/DataView in each engine. | Detached identity, exact entire bytes, offset/length, native type and graph alias. Intermediate fixes fail strict-constructor and buffer-first alias cells; final source passes. Shared-memory concurrency, detached/resizable buffers, and arbitrary class private state are outside this law. |
| Actual native close retires the connection with error status and retained snapshot. Approved extension of managed closure. | Retirement owner: idle/ready/loading and five admitted persistence operations. Independent expected native abort/complete and caller outcomes. | Native transaction result, error status, retained public rows, late-admission rejection and fresh restore. Removing close listener fails six status assertions (idle/loading already reject failed native reads). Native Chromium storage clearing receives seven actual close histories, six with admitted work. |
| Blocked diagnostics observe a pending operation; only native terminal outcome settles it. Approved optional API. | Wrapper native open/delete matrix plus managed factory forwarding. Independent blocked listener proves reach. | Exact old/new versions, callback count and pending state, reentrant blocker release, final result. Omitting factory forwarding fails the callback observation. No timeout, cancellation or fallback is inferred. |
| Names route to the declared store, with unaffected neighbors. Existing isolation contract. | Native host owner substitutes six names with prefix neighbor and anchor stores. Authored per-store arrays receive typed insert, peer update, replacement, clear and restore. | Every public, durable, export and restored store snapshot. Controlled exact-name metadata mutant calibration is inherited from the donor port. Native metadata-version isolation remains owned by the controlled compatibility suite. |
| Dedicated workers share the page persistence contract. Approved host scope. | Real worker/page IndexedDB and BroadcastChannel history: insert, peer update, import, close, late write and worker recreation. | Public and durable rows, retained error snapshot, rejected late write and restored rows. Existing transport calibration remains authoritative; service/shared workers and suspended-host delivery are unclaimed. |
| A provider failure cannot count as value preservation. Existing truthful-settlement law. | Ordinary WebKit raw Blob failure has exact rejection and healthy-suffix checks. Disposable persistent WebKit requires raw acceptance and executes the same full histories. | Persistent WebKit cannot take the failure branch. Both Blob-containing preservation cells execute successfully there. This closes the local receiving gap without broadening the rejection classifier. |

These laws are encoded and enforced within the finite histories above. They do
not establish every combination of lifecycle, value shape and host. Existing
coverage-map obligations for unordered cross-Collection writes, suspension/lost
notifications, post-durable notification failure, quota/eviction and physical
crash remain separate; no new implementation is silently deferred.

## Follow-up reviewer reconciliation

Two read-only agents reviewed the proposed implementation and simplifications.
The reviewer found actual compatibility regressions in the first binary-copy
repair and identified missing native receiving evidence. Those findings were
useful and technically accurate. The simplifier identified concrete cleanup
hazards and duplicate teardown. I would use both again for this bounded work.
Their initial findings were code-reading claims; executable evidence below
supplies the behavioral verification. A final read-only review also passed 17
constructor/alias probes and found no additional concrete regression.

| ID | Original claim | Technical verdict, evidence and destination | Final action |
| --- | --- | --- | --- |
| R1 | Length-sensitive typed-array subclasses receive a buffer and throw. | Confirmed. Strict one-argument and legacy-constructor cells fail intermediate source. Core detachment owner preserves existing construction semantics; native constructors preserve range. | fixed-now |
| R2 | Foreign standard typed arrays fail because backing buffers are flattened. | Confirmed. Foreign buffer-first/view-first graph checks and native iframe witnesses cover the missing realm axis. | fixed-now |
| R3 | Shared-buffer typed arrays regress. | Confirmed. Scalar edits, assigned views, both alias orders, detached bytes and prototype checks pass; concurrent shared-memory writes are explicitly excluded. | fixed-now |
| R4 | Capture lacks native receiving evidence. | Confirmed test gap. Real handler/storage holds and caller mutation reach the native value oracle in all profiles. | fixed-now |
| R5 | Forced-close abort lacks native in-flight evidence. | Confirmed test gap. Chromium native storage clearing closes/aborts loading and five admitted writes; actual close counters and native outcomes are asserted. | fixed-now |
| R6 | Managed onBlocked forwarding has no witness. | Confirmed test gap. Independent blocked reach plus diagnostic observation rejects omitted forwarding. | fixed-now |
| S1 | Preserve numeric-length subclass construction without more machinery. | Same product defect as R1; exact one-argument compatibility retained. Native binary branches earn their weight through alias/range laws. | duplicate of R1 |
| S2 | A terminated worker callable can hang cleanup. | Confirmed fixture gap. Cleanup becomes idempotent after termination; other commands reject immediately. Native recreation history uses the path. | fixed-now |
| S3 | Partial host/worker construction leaks resources. | Confirmed fixture gap. Failed host setup cleans Collections and closes the descriptor; failed worker setup terminates the worker. Aggregated errors retain the primary failure. | fixed-now |
| S4 | Forced-close fixture releases its gate twice unnecessarily. | Confirmed cleanup simplification. Redundant release removed, disposer preserved. | fixed-now |
| S5 | CDP detach can be bypassed on assertion failure. | Confirmed fixture gap. Register detach with existing failure-preserving cleanup immediately. | fixed-now |

Adjacent findings from R1-R3 were not discarded: exact argument count, prototypal
subclasses, buffer-first traversal, shared backing identity and spoofed ordinary
data tags all have executable controls. A later native capture admission failure
also releases its gate through `finally`.

Loss accounting: **11 raw items = 10 fixed-now + 1 duplicate**. No confirmed-open,
refuted, stale, deferred or unresolved design-decision items remain in this
follow-up review. This is bounded closure, not a universal correctness claim.

## Calibration receipts

All temporary production substitutions were restored in `finally`. The runner
used Vitest with coverage disabled and at most two workers.

- Original `32240d53` proxy against the corrected `withChangeTracking` driver:
  11 assertion failures, 3 passing controls, 77 unrelated skipped cells.
- Import `modified: item` instead of `structuredClone(item)`: six captured-value
  assertion failures. The actual delayed native put is reached.
- Remove native close registration: six error-status assertion failures;
  idle/loading distinguish errors already exposed by failed reads.
- Remove managed onBlocked forwarding: one diagnostic-list assertion failure
  after an independently observed native blocked event; blocker cleanup still
  permits terminal settlement.
- Original global mutation key: 32 typed-key payload assertion failures. The
  final grammar also crosses both author orders; unchanged same-key laws remain.

An earlier binary RED draft observed raw `getChanges` before detachment. It was
not valid evidence for callback-return capture and is excluded. The replacement
calibration above uses `withChangeTracking`, the actual detachment boundary.
The temporary logs are named `/tmp/pr1179-calibrate-{original-copy,import-capture,native-close,blocked-forwarding}.txt`;
the named edits and selectors make these finite checks directly reproducible.

## Guide conformance and code weight

ORC-001–003: approved contracts, independent authored rows/value descriptions,
and adjacent literate prose separate model, grammar, driver and comparison.
ORC-004/007: additions are finite enumerations; existing fixed/random campaigns
and seed/path replay are unchanged. ORC-005/006: native gates/events establish
reach, and the assertion kills above establish sensitivity. ORC-008/009: no new
lifecycle state machine; canonical native transaction, Collection status and
settlement terms remain. ORC-010: teardown retains primary errors, including
worker replacement and CDP cleanup. ORC-011/013: native structuredClone, authored
byte/graph checks, provider probes, both traversal orders, strict subclasses and
pending-versus-terminal neighbors challenge plausible wrong designs. ORC-012:
this versioned record identifies source and calibrations. ORC-014: native value,
worker and name receiving runs in all three engines; forced close is explicitly
Chromium-only, and the raw WebKit failure has a separate successful provider.

Production adds binary snapshot support and preserves prior custom construction;
it adds no reconnect, retry queue, fallback or database epoch. Adapter capture,
closure and diagnostics use existing control flow. Tests and explanatory code
carry most of the growth. Exact final weights and complete merged-revision
validation are recorded in the receipt below.


## Final merged-revision receipt

The normal merge `3944198461443af22b52c7e7e063b672624ebd00` includes
`origin/main` at `48065980e`. The follow-up `36cdc3b89` only removes a now-unsafe
private-member map entry, renames two test generator variables and formats prose.
No published history was rewritten.

- Complete core suite: **8,717 cases, 250 files**, runtime and configured type
  checks green. The earlier run exposed 36 test root-directory errors and one
  unrelated helper return-type mismatch. A test-specific root and the actual
  operation return-type union repair those checks without changing assertions.
- Complete adapter suite: **2,467 cases, 15 files**, no type errors. Standalone
  source/test/browser-driver typechecking also passes.
- Complete native suite: **247 passed, 14 skipped, 261 total**. The skipped cases
  are exactly the seven Chromium-only forced-close controls in each other engine.
  Persistent WebKit passes the same rich-value corpus, including both Blob shapes.
- Fresh db-ivm, db and adapter ESM/CommonJS/declaration builds pass. After the
  private-member map cleanup, rebuilt core passes **290 distribution cases**,
  the minified public API check (100 error names, metadata, queries and updates),
  **16 package-consumer cases** and **three packed native-browser cases**.
- Changed-file lint, formatting, whitespace and the 382-name private-member map
  check pass. The map drops `detach` because the new tests use Playwright's public
  method with that name. Dependency builds finish before final lint/consumer runs.

Commands use direct local Node entry points for Vitest, Vite, TypeScript and
Playwright. Vitest runs use coverage disabled and at most two workers. The
configured registry denies locked Rollup 4.64.0 with HTTP 403; local builds use
cached 4.59.0 while the lockfile keeps 4.64.0. These are local results, not a claim
that `pnpm test:pr` or remote CI passed.

Before merging unrelated main changes, this follow-up's production delta is
**75 added / 13 removed lines (net +62)**. Tests and receiving drivers add
**1,215 / remove 22** lines; documentation adds **392 / removes 132** lines;
configuration adds **18 / removes 5**. The final formatting, map cleanup, receipt
and changesets are additional supporting changes. Binary native compatibility
accounts for 50 net production lines; the typed-key repair is net-neutral, and
adapter capture/closure/diagnostics add 12. No second lifecycle or recovery
machinery was introduced.
