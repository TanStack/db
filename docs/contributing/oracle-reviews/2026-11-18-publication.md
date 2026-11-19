# Combined branch publication

This record supersedes publication-status statements in the earlier review
records. Those statements describe their original review cuts. The combined
branch retains the original author's commits and merges PR #2377 through
`cc4d0d72ce0ec82c205d23ed609f0286144ec604`, in merge commit `f3902e140`.
Commit `e71ef34ec` contains the reviewed adapter repairs and instruments.
The comparison base remains `origin/main` at
`21c52a07e6da3d388054224700cc69a800372f30` after a fresh fetch.

## Upstream test environment and receiving check

The upstream update supplies test-only Map shims. The combined branch uses
`.nvmrc` version `24.22.2`. Actual execution used Node `24.19.0`, with those
shims, and passed **778/778** checks across both selected Direct suites:

```sh
# packages/powersync-direct-collection
pnpm exec vitest run tests/decode-refusal-oracle.property.test.ts \
  tests/on-demand-streams-conformance-oracle.property.test.ts \
  --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1
```

The run log is `.review-2377/post-merge-direct-node24.log`, SHA-256
`a7dba3fd44a8f4674592ebbdf4f4beee8c029d6410f9cecbd9165eb4ea0ef8f8`.
The final Direct production hashes remain unchanged:

```text
6b0a8092fad1fe7032bce093063639120d4f16001068f03d6581fce5182054a0  packages/powersync-direct-collection/src/index.ts
20f8ed310b98099604fd05ae32a269b6554b87b937e31300f8dca3ac3a019da3  packages/powersync-direct-collection/src/subsets.ts
```

Test-only shims do not establish consumer compatibility. The standalone SDK
still needs its maintained-Node compatibility release and checkpoint event
API release. Node 22 validation remains open. The other external SDK
dependencies and receiving limits in the
[cross-adapter review](2026-11-17-cross-adapter-shared.md) remain open.
No new full-workspace test run is claimed.

## Artifact fidelity and final checks

Publication removes one trailing space in the Direct guide and one blank line
at the end of the mutation review. The latter's historical SHA-256 is
`94ada8e4046300698eb32bff790eaba57be1d436ae934b23120dc15473324a47`.
Its new SHA-256 is
`b37a7dc968cbf4c7b7763325cbd875a0b8d6b5033cbde0b13c80ec5c929c5042`.
The historical integration manifest retains its original hash. No verdict,
test, production source, or patch payload changes with this whitespace edit.

The narrow `.gitattributes` rule treats upstream `.patch` artifacts as data
for Git whitespace checks. It preserves their exact context whitespace and
recorded hashes. It does not change oracle lint rules. The final working-tree
`git diff --check origin/main` and root `pnpm lint:changed` pass.

The original PR disables maintainer edits, and the current account cannot
push to its fork. The user authorized publication as a new TanStack/db PR.
The new PR remains a draft while the documented SDK release gates remain open.
