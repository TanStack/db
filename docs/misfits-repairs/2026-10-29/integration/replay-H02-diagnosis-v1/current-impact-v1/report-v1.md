# H02 current source impact: two bounded diagnostics

## Result

Both exact current source compositions reproduce a bounded prefix of the H02
acquisition/ownership feedback. Initial preload settles, then the second join
reply for pivot3 starts repeated include acquisition/unload. A provider answer
queued as a microtask remains unexecuted when the external supervisor stops at
128 primitive events. Neither run completes the two-release diagnostic or
reaches a final semantic/public-value comparison.

This establishes **current diagnostic impact under the frozen source-alias
receiving path**. It is not an executed progress oracle, an accepted new law, a
retained-publication mismatch, an infinite-execution proof, or bug-class closure.
The queued-answer progress law is still pending the user's decision. Historical
H02 remains unverified/excluded. No production repair, expectation change, new
oracle, author-tree mutation, commit or publishing occurred.

## Exact compositions

| Composition | Immutable base / input | 511-file production identity |
|---|---|---|
| Current main | `9cfa11fc712866f8f276e85762865ebb8bd49cbe` | `ebf2eb723161c3ea7073c1f4de55ceb4ff02bf284bd1e2ea1e6b76db9230c0a4` |
| Accepted standalone replay | Same base plus complete patch `d2da68a7310a91445497792eee3df29737bea7ff6b3c8a3d9261ab01ecb07760` | `d7fa2b44615b883fcc3da8971c45da8848e1a6921e4ff2e7f2c2983eec6f3ae0` |

Each uses a new Git archive and separate dependency clone:

- Main: `/private/tmp/h02-current-main-qpauslv5`.
- Accepted replay: `/private/tmp/h02-accepted-replay-bg5dj7ue`.

The patch SHA matches the completed standalone envelope. A clean apply check
passed on each baseline; the accepted composition applies the entire patch.
`composition-freeze-v1.json` records all13 changed/new file preimages (including
absence for new files), exact roots, runtime links, source aliases and material
input hashes. The accepted composition matches **all511** production file hashes
in the author's frozen candidate, not just its four edited production files.
The identity algorithm is SHA256 of `json.dumps(fileHashMap, sort_keys=True)`.
Both source maps and the driver remain unchanged after execution.

The completed author tree
`/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-replay-latest-main-v3`
was only read for its frozen envelope and runtime-package verification. It was
not run, built, patched or otherwise mutated. The final combined C is not covered
by these diagnostics; no frozen C source was supplied for this task.

## Receiving path and instrument

Both use explicit `@tanstack/db` and `@tanstack/db-ivm` **source aliases**.
No package build ran and no existing dist output stands in for current source.
These runs do not establish equivalence to the author's dist receiving path or
to the original historical built bytes.

The shared driver is
`h02-current-impact-v1.test.ts`, SHA256
`18deeffebe73ebe94f94d5fdcfd8f2c8fc700d97286e990e14075326b7c6d066`.
It composes only existing frozen diagnostic fragments: E09's actual Collection
acquisition/unload and primitive cache observations, and E11's queued-microtask
completion hook plus elapsed-time projection. Two unused retained-check/reach
imports are removed; neither had been invoked by this minimal driver. There
is no reference model, new product comparison or expected public-value change.
The custom key, provider, finite five-row graph and two-release schedule remain
those of the archived receiving experiment. No default-key substitution occurs.

The completion hook retains its original fetch13/pivot3 condition. Both current
runs actually reach it, so its historical selector does not silently miss this
current path. It queues completion of every held request and turns off further
holding. Its callback does not depend on the driver's next timer flush.

## Dependency identity and honest limits

Each archive clones the same isolated dependency tree used by the historical
source diagnostic, with no shared writable installation metadata. Core links
resolve inside each new scratch tree. Requested Node heap is384MiB per process;
Node is v24.19.0, Vitest4.1.12, Vite7.3.7, Query Core5.90.20, jsdom27.4.0 and
TanStack Vite config0.4.3. Their package manifests match the pre-run freeze.

A post-run comparison against the accepted author's installed packages verifies
that all five packages' own regular runtime payloads match. Full regular-file
trees are not byte-identical: installation-path `node_modules/.bin` shims differ,
and the author's Vitest tree has generated `dist/tsconfig.tmp.tsbuildinfo`.
Every such raw difference is preserved and classified in
`post-run-input-verification-v1.json`; there are no other differences in those
package comparisons. The direct Node Vitest entry bypasses those command shims;
typechecking is disabled. This is not a blanket assertion of all transitive
package or complete-host equivalence.

The fully read live-query architecture bytes equal the historical archive's
version. The only glossary delta is the source-progress-token entry; it was
read before these diagnostics. No new subsystem names or contract terms were
introduced.

## Distinguishing observations

The two traces have matching phase counts through the cap:
20 actual acquisitions,12 actual unloads,13 provider calls, two stable custom
key subscription identities and eight cache entries. Their actual cached
versions coexist:

- Join owner0 / pivot3 scope: last successful data `[]`, idle.
- Include owner1 / pivot3 scope: retained successful data `[3]`, fetching.

`markers.has(3)` is false before each repeated include acquisition and true
before its unload. Each unload removes the include's sole supporting owner;
the anti-join/window route reappears. No further driver answer occurs during
this prefix. This is the same concrete law interaction diagnosed historically,
now observed against both relevant current source compositions.

| Checkpoint | Current main | Accepted replay |
|---|---:|---:|
| Initial preload settled | event53,8 acquisitions/8fetches | event53,8 acquisitions/8fetches |
| Earlier join `[1,2]` released and flush returned | events75–76 | events75–76 |
| Join `[3]` released | event78 | event78 |
| Include completion microtask queued | event83,23.256ms | event83,24.016ms |
| Last event before containment | event128,26.945ms | event128,28.413ms |
| Queued completion callback executed | No observed callback | No observed callback |
| Second release's timer flush returned | No | No |
| Final public-value comparison | Not reached/not present in diagnostic | Not reached/not present in diagnostic |

The timestamps measure the diagnostic's local finite prefix; they do not define
a product latency budget or prove an infinite execution. No public final-result
observation is invented. Existing primitive source/cache membership is preserved
in full run receipts and projected in `observations-summary-v1.json`.

## Containment and final state

Exactly two diagnostic test commands executed, sequentially in slot3:

| Composition | Child exit | Stop reason | Supervisor seconds | Maximum group RSS |
|---|---:|---|---:|---:|
| Current main | -9 | Event cap128 | 2.597 | 590118912 bytes |
| Accepted replay | -9 | Event cap128 | 2.229 | 595476480 bytes |

The runner writes its prepared receipt before spawn, records PID/PGID and every
latest resource sample, then writes the final receipt in `finally`. It enforces
20seconds with an external alarm, 1GiB process-group RSS,384MiB Node heap, and
128 primitive events. The event sentinel blocks only after event128, so cannot
explain earlier missing completion. There is no unconditional redundant
post-wait kill. Both final receipts have no monitor errors and no remaining
group members. An independent subsequent `ps` inventory confirms both PGIDs
68143 and68531 are empty (`independent-process-check-v1.json`). Slot3 is released.

The Vite configuration reports missing Expo tsconfig bases elsewhere in each
archive before test startup; both diagnostics nevertheless import and execute
the intended fixture. No install or local override was needed.

## Next gate

These diagnostics remove the assumption that S004's current source necessarily
resolved the feedback. They supply an exact current pre-edit candidate trace
for the pending law discussion. If the limited queued-answer progress law is
accepted, follow `../progress-gate-v1/plan-v1.md`: establish a composed generated
receiving owner, measure its reaches, obtain a legitimate pre-edit progress RED,
then repair without weakening cached ownership, retained publication or the
literal-true synchronous cut. If the law is deferred, preserve these diagnostic
receipts as an unresolved design/authority question. Neither outcome changes
historical H02's excluded verdict without the appropriate judgment.
