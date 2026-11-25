# Proposed upstream SDK Map compatibility patch

This is a separate proposed upstream portability change for PowerSync SDK base
`3601c03398e34639632101fd22c6247e9495b3ae`, repository
`https://github.com/powersync-ja/powersync-js`. The reviewed patch is
[the compatibility diff](2026-11-17-powersync-sdk-node-map-compatibility.patch).
It is independent of the checkpoint-observer API patch and applies cleanly
alongside that patch's existing edits.

The implementation is in the isolated local worktree
`/private/tmp/pr-2377-powersync-checkpoint-api/.worktrees/node-map-compat`, branch
`review/node-map-compat`, based on the exact commit above. The original checkout
remains on `review/complete-checkpoint-events` with its five original checkpoint
edit paths. No commit, push, release, installed dependency patch, global
polyfill, lockfile edit or runtime support declaration was made.

## Proposed law and scope

The user's requested downstream support covers maintained Node versions. The
SDK currently uses `Map.prototype.getOrInsertComputed` at four standalone
internal map sites. Node **24.19.0** has no such method; Node **26.13.1** has it.
Both measured runtimes have the iterator helpers and `Map.groupBy` used nearby.
A checkpoint with one nonempty bucket therefore throws on native Node 24
before it can publish rows.

The upstream checkout itself intentionally excludes `tests/standalone/**` below
Node 26 and uses `.nvmrc` 26.12.1. This is a proposed upstream portability
improvement under the user's requested support policy, not a finding that the
SDK violated its own stated standalone-runtime policy. Its root package's
`engines.node` is `>=20.9.0`; none of these declarations or exclusions changes
in this patch. This work does not establish Node 20 support.

For these SDK maps, getting an existing entry must preserve its value and
identity. Only a missing key invokes the factory; the computed result is stored
and reused. A stored or computed `undefined` remains a present entry. A throwing
factory inserts nothing. The new eight-line `getOrCreate` helper uses `has`,
`get`, and `set` and does not modify built-in prototypes. Its four call sites
replace the unsupported method. SDK keys at these sites are strings or bucket
objects; this is not a full implementation of the native method for arbitrary
Map subclasses, numeric-key callback normalization or overridden intrinsics.

The patch adds four helper tests and one complete-checkpoint regression. That
regression lives outside the upstream directory excluded below Node 26. It
exercises all four map sites: checkpoint bucket reconciliation, row allocation,
per-bucket row state, and per-table publication. It compares the actual emitted
row event with the expected complete result. Existing checkpoint, priority,
removal, request, stream and public standalone-client tests remain unchanged.

## Native execution evidence

| Runtime | Unchanged production | Patched source |
| --- | --- | --- |
| Node 22 | Not executed; runtime acquisition blocked by HTTP 403 | Not executed; support remains an open validation gate |
| Node 24.19.0, arm64 | Existing state suite: 27 failed, 2 passed; `TypeError: buckets.getOrInsertComputed is not a function`. New checkpoint regression: 1 failed with the same semantic error. | Same 29 existing state tests pass; helper tests and complete-checkpoint regression pass. Full selected standalone campaign: **57 passed in five files**, 2.57 seconds. |
| Node 26.13.1, arm64 | Not rerun; no baseline claim | Same full selected campaign: **57 passed in five files**, 2.57 seconds. |

The new checkpoint regression also passed alone with the upstream test
exclusion preserved. Its original-method control restored only the two
production files to base content, ran that same regression to the missing-method
failure, then restored the fixed files in a `finally` block. The earlier
existing-state RED was captured before any production edit.

The full campaign uses one worker and the following temporary test configuration.
The source alias ensures public standalone tests exercise this worktree's
patched shared internals rather than an installed copy:

```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  tsconfig: fileURLToPath(new URL('./packages/standalone/tsconfig.json', import.meta.url)),
  resolve: {
    alias: {
      '@powersync/shared-internals/standalone': fileURLToPath(new URL('./packages/shared-internals/src/standalone.ts', import.meta.url))
    }
  },
  test: {
    include: ['packages/shared-internals/tests/standalone/*.test.ts', 'packages/shared-internals/tests/utils/map.test.ts', 'packages/shared-internals/tests/standalone-compatibility.test.ts', 'packages/standalone/test/*.test.ts'],
    environment: 'node',
    maxWorkers: 1
  }
});
```

From the compatibility worktree, the full commands were:

```sh
/usr/local/bin/node node_modules/vitest/vitest.mjs run --config .review-node-compat.config.ts
/Users/kyle.mathews/.npm/_npx/bac97da9607b7ef2/node_modules/node/bin/node node_modules/vitest/vitest.mjs run --config .review-node-compat.config.ts
```

The measured runners are Node 24.19.0 and Node 26.13.1 respectively, Vitest
5.1.0, TypeScript from the existing downstream dependency installation. No
installation was needed. This does not claim execution with upstream's declared
Vitest 4.1.10 dependency set. The temporary configuration gives Vite an explicit
existing package tsconfig because a direct launch with the available Vite 8
otherwise follows an ungenerated Nuxt project reference and fails before tests.
Those initial config failures are setup errors, not product RED evidence.

The wrapper for the unchanged upstream exclusion is:

```ts
import { mergeConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import upstream from './packages/shared-internals/vitest.config';
export default mergeConfig(upstream, {
  root: fileURLToPath(new URL('./packages/shared-internals', import.meta.url)),
  tsconfig: fileURLToPath(new URL('./packages/shared-internals/tsconfig.json', import.meta.url))
});
```

Its same-test RED and GREEN command was:

```sh
node node_modules/vitest/vitest.mjs run tests/standalone-compatibility.test.ts --config .review-node-compat-default.config.ts --maxWorkers=1
```

Strict targeted TypeScript over the helper, both changed production modules,
and the new tests passed. Formatting used the repository's formatting options
without its unavailable SQL/embed plugins. `git diff --check` passed.
`git apply --check` passed on the original checkout with checkpoint edits;
`git apply --reverse --check` passed on the compatibility worktree.

## Open Node 22 validation

No installed Node 22 binary was found. Runtime acquisition attempts returned
HTTP 403 from both npm's configured proxy and the public registry. At the
parent agent's request, an official binary download was also attempted for the
observed `arm64` architecture. Its initial authoritative checksum request,
`https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt`, returned HTTP 403 before
any archive could be downloaded or verified. No unverifiable binary was run.

Node 22 must run this same campaign without a global polyfill before claiming
all maintained Node versions are validated. Node 26 success supplies no evidence
for Node 22 or 24 compatibility; Node 24 has its own native RED/GREEN evidence.
The downstream adapter receiving campaign and integration of an upstream release
remain separate work owned by the parent task. This artifact does not modify
or certify the installed SDK used downstream.

## Exact artifact and evidence fingerprints

Patch SHA-256: `2b6561c2b2ba6865bd0cb989fc11e358e38cd7edca289134a87a960d8070f93e`.
The following source and log fingerprints identify this proposal and its
executed evidence:

```json
{
  "packages/shared-internals/src/standalone/client_state.ts": "2dfa8476bf5a5ff911b33f60c9a3d474e961bf41e022059812ff7bfaf498311c",
  "packages/shared-internals/src/standalone/oplog.ts": "51ef55ff16cafd0b85425e126401c9bc8cd15b88811514177f9349f9b02a44fa",
  "packages/shared-internals/src/utils/map.ts": "c2d1c921d27aed5a5c678a0de6ad0734c317a3794968f747611eba2baa9d3b1e",
  "packages/shared-internals/tests/standalone-compatibility.test.ts": "3cdf89116bd2cc56bfb67f2e46d81b88b68a14b171d520ef93753518fd865392",
  "packages/shared-internals/tests/utils/map.test.ts": "32686f2e324f38ed4f6d0deda2bd88f6ebea9f6adeefde3ca3785a2130bf4525",
  "/private/tmp/pr2377-sdk-map-compat-node24-red-state.log": "49d69e58186462d23c210d089cbe9b934220aa37765483e5f86f1d589dbd5901",
  "/private/tmp/pr2377-sdk-map-compat-node24-red-regression.log": "097787f7f00d0d1ff7cd65cddf80b7859e8d339ec638752dcb32f7c89a355e90",
  "/private/tmp/pr2377-sdk-map-compat-node24-default-green.log": "51fcda478fe2f72f0b26ecad42a85068158fee54315afd1044fae888ed316387",
  "/private/tmp/pr2377-sdk-map-compat-node24-green.log": "105097a9ce37d659b23678e170baf9d5b4500da1fac8f2c92f494a8c48b0188d",
  "/private/tmp/pr2377-sdk-map-compat-node26-green.log": "d37f2af73412f086c78887cde88a4419e57d1fdf0c63b0b11aa99ade7b65ff69",
  "/private/tmp/pr2377-sdk-map-compat-types.log": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
}
```

## 2026-11-18: additional runtime inventory

A later bounded inventory of an existing Linux VM found only native Node
24.22.1 in its system, runtime-manager and npm-cache paths. No Node 22 runtime
was available there. No SDK sources were transferred and no additional campaign,
installation, download or VM lifecycle action ran.

Node 22 validation remains unexecuted; the earlier proposal evidence is unchanged.
