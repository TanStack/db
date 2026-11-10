# Candidate-integrity correction v2

`EV-FOLLOWER-CANDIDATE-001` is a candidate construction defect, separate from the native receiving checkpoint finding `EV-FOLLOWER-SIB-002`.

The v1 replay manifest retained one raw diff3 base marker at line 751. The merge resolver inspected opening, separator, and closing markers, but omitted the diff3 base marker. V1 patch application and hashes therefore passed while the manifest remained invalid. The production size measurement did not compile the manifest and remains a production-only result.

V2 removes exactly that line. All 17 v1 candidate source bytes and every existing v1 artifact are preserved. Non-executable mirrors now use `.source-snapshot.txt`; `source-snapshot-path-mapping-v2.json` resolves their original paths. V1 manifests, receipts, patches and size records are unchanged.

TypeScript 5.9.3 rejects the preserved v1 manifest at line 751 (negative control), parses all 14 corrected TypeScript candidate files, and finds no conflict marker of any of the four kinds across 17 files. AST extraction requires correct tuple/Map arity, duplicate-free properties, and exact semantic union of main plus frozen accepted author properties, owners and selectors. The accepted config and manifest were reconstructed from the frozen HEAD and preserved repair patch, then checked against accepted hashes; the active author tree was not consulted. Runtime loading uses the actual transpiled config, manifest and unchanged dependencies: registry size 555, all existing main entries unchanged, and all 11 follower plus two main additions present exactly once with source owner, selector and command. The three follower OPFS entries preserve `playwright.opfs.config.ts`.

The full v2 patch applies to exact main, and the one-file delta applies to exact v1. Both yield byte-identical 17-file candidate trees. Production is unchanged at `025ae33d53ffbd77e9be2973a34aaaa9c1f6188d867abc467f4af93f37602d8f`; no size rerun was performed. Two validator setup errors (unsupported literal-array join and omitted unchanged dependency materialization) are preserved separately; neither is a candidate product failure.

This is parser/transpiler/runtime registry validation, not a full workspace typecheck or oracle-history execution. `EV-FOLLOWER-SIB-002` remains open. No author worktree, integration worktree, private size clone, commit, push or PR was changed by this correction.
