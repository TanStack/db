# Independent source and receipt review: H02 current impact

This supplement reviews `report-v1.md` at SHA256
`769539d146680231213ec8361f9e2a2069a7a7b112d051249369949f2db9b2e4`.
It is a read-only inspection of source, configuration, frozen inputs, raw logs,
and receipts. No diagnostic, test, build, installation, or production command
was executed for this review. Only this separate review report was written.
The earlier independent H02 review remains separate.

## Judgment

The packet supports bounded current impact under its configured source-alias
receiving path in both recorded compositions. Its primitive observations and
successful external containment are independently corroborated by the frozen
files and raw logs. I found no concrete evidence that these runs used the wrong
DB source composition.

There is one provenance limit: the packet does not contain a complete executed
module-resolution/load inventory, transformed-source hash inventory, or a
current-run DB/db-ivm source stack. The aliases, receiving imports, source maps,
workspace links, and configuration provide strong static provenance. They do
not independently attest every module actually loaded. The logs positively
identify executed scratch Vitest, Vite, and tsconfck paths. Thus “exact current
source compositions” should be read as the verified frozen source inputs and
configured receiving path, not as a complete runtime-loaded-input attestation.
This missing witness is not evidence of a concrete stale-dist substitution.

The evidence does not accept the proposed queued-answer progress law, establish
an oracle RED, show a retained-publication/public-value mismatch, prove infinite
execution, attribute the original OOM, or close a bug class. Historical H02
remains unverified/excluded. Final combined C is outside this packet.

## Source and input identity

I independently recomputed all six entries of `input-freeze-v1.json` and all
15 entries of `sha256-v1.json`; none differs. Both receipts embed the frozen
composition used by the recorded command.

- Main's 511 production files match their scratch files and the immutable Git
  blobs at `9cfa11fc712866f8f276e85762865ebb8bd49cbe`. Recomputed identity:
  `ebf2eb723161c3ea7073c1f4de55ceb4ff02bf284bd1e2ea1e6b76db9230c0a4`.
- Accepted replay's 511 production files match its scratch and the author's
  complete frozen 511-file candidate map. Recomputed identity:
  `d7fa2b44615b883fcc3da8971c45da8848e1a6921e4ff2e7f2c2983eec6f3ae0`.
- The complete standalone patch independently hashes to
  `d2da68a7310a91445497792eee3df29737bea7ff6b3c8a3d9261ab01ecb07760`.
  All 13 recorded preimages, including absent new files, match the immutable
  base. Read-only forward apply checking succeeds on main; reverse apply
  checking succeeds on accepted replay.
- Both scratch drivers, both alias configurations, and all six material test
  input hashes per composition match the freeze.

The test imports Query Collection directly from `../src/query.js`. The selected
configuration aliases exact `@tanstack/db` and `@tanstack/db-ivm` imports to each
scratch's source index. The production imports inspected use those exact
package roots. The package tsconfig also points these names to source; its
configured tsconfig-path plugin does not introduce a conflicting dist target.
Workspace DB and db-ivm links resolve within the respective scratch. These
checks support the configured source path without borrowing identity from the
historical dist path or the author's dist path.

## Runtime package comparison

The five resolved package manifests and versions match their frozen hashes:
Vitest 4.1.12, Vite 7.3.7, Query Core 5.90.20, jsdom 27.4.0, and TanStack Vite
config 0.4.3. Resolved links inspected point into each scratch's `.pnpm` tree.
The raw logs' Vite/Vitest error stacks identify those scratch package paths.
Node v24.19.0 is recorded; no executable-file hash is supplied.

I independently recomputed both sides of all ten regular-package-tree
comparisons against the author installation. File counts, tree hashes, and
every raw difference match the post-run receipt. Query Core and jsdom regular
trees are equal. The other differences are precisely ten nested `.bin` shims
per composition and one author-only Vitest `dist/tsconfig.tmp.tsbuildinfo`.
Each shim becomes byte-equal after substituting the two original installation
roots. The scratch shims retain the coordinator installation's `NODE_PATH`
entries; they are not rewritten scratch-local shims.

The recorded entry is direct Node plus the scratch `vitest.mjs`, with
typechecking disabled. This bypasses the Vitest CLI shim. The observed shim
differences support the report's installation-path classification, but a direct
entry alone is not a complete proof that no descendant ever invokes any shim.
The packet does not claim or establish complete transitive-package, host, or
dist equivalence. Own regular payload equality after the stated exclusions is
the supported comparison.

## Primitive trace and containment

I parsed both raw logs independently: their 128 JSON events exactly equal the
corresponding receipt arrays. Removing only elapsed time and heap usage makes
the two complete event arrays equal. Both have 20 acquisitions, 12 unloads,
13 provider calls, two stable subscription identities, and eight cache entries
through the repeated pivot-3 portion. Recorded scopes are predicate-only;
there is no observed order, limit, or offset in these acquisition options.

In each trace preload settles at event 53 with eight acquisitions and eight
fetches. Releasing `[1,2]` at 75 returns from its flush at 76. Releasing join
`[3]` at 78 starts include acquisition at 79. At 80 the join's successful
cached answer is `[]`, while the include's retained successful answer is `[3]`.
The include refetch starts at 82 and arms completion at 83. Repeated acquisition
observations find marker 3 absent; unload observations find it present. The
include cache stays successful/fetching with `[3]`; the join cache stays
successful/idle with `[]`. No later fetch, completion callback, second flush
completion, cleanup, or final comparison is recorded before the cap.

Main arms completion at 23.256 ms and reaches event 128 at 26.945 ms; accepted
replay does so at 24.016 ms and 28.413 ms. The sentinel blocks only inside the
event-128 emission, so it cannot explain the earlier missing callback. This is
a finite observed prefix, not a product latency threshold or infinite-loop
proof. The current packet supplies no stack sample of that prefix; the earlier
historical E12 stack remains separate evidence with its own containment caveat.

Both final receipts report a single successful event-cap process-group kill,
exit `-9`, no monitor errors, and no remaining group rows. Main records 2.597 s
and maximum sampled group RSS 590118912 bytes; accepted replay records 2.229 s
and 595476480 bytes. The independent later inventory records neither PGID
68143 nor 68531 remaining. The inspected runner records prepared/running/final
states, uses an external wall alarm and group RSS sampling, and avoids the
redundant unconditional post-wait kill that invalidated E12's final metrics.
These receipts support successful containment of these two runs. Their sampled
maxima do not establish unsampled absolute peak RSS or a generic supervisor
correctness proof.

The Expo tsconfig resolution errors precede test startup in both raw logs.
Both nevertheless reach the entire matching fixture prefix. Neither run is a
clean passing test or an executed oracle. The report correctly keeps the next
step conditional on the user's still-pending law decision.
