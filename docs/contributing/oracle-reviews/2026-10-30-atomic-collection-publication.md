# Atomic Collection publication: model and protocol investigation

Historical investigation: the maintainer subsequently clarified that raw
Collection subscribers observe raw source commits. The stronger source-retention
interpretation below is superseded by the
[raw Collection publication decision](2026-10-30-raw-collection-publication-decision.md).
Its experiments remain evidence for the earlier proposal, not the clarified law.

Base: `c351fc04d7f70dc59bf92ecbed310f899b9511cd` (`origin/main` when this isolated worktree was created). Production remains unchanged during model development.

## Accepted design direction

Maintainer decision in this conversation, October 30, 2026: publish atomic, coherent updates; keep subscribers updated. The agreed interpretation is one Collection-owned public snapshot. A truncate replay accumulates a private replacement. Direct reads and public subscriber changes retain the last coherent snapshot until a successful coherent replacement can publish. A replay failure reports its error without publishing an incomplete replacement. At publication cuts, a full-state subscriber applying each change batch agrees with direct reads.

This revises the existing rule that direct reads expose partially installed source rows while a subscription retains an earlier public result. It does not authorize changing applied-receipt semantics or abandoning accepted sync transactions. Health changes remain observable during held data publication.

## Rival predictions

Starting at public `a=1`, truncate opens a replay and its load remains pending. Current direct reads become empty; the new model retains `a=1`. Delivering private `a=2` still leaves public `a=1`. Quiet failure preserves `a=1`. A successful authoritative replacement advances direct reads and subscriber state together, with one old-to-new diff. These expectations follow from the maintainer decision, not current output.

The existing lifecycle publication owner remains primary. Its new `subscription-lifecycle.atomic-public-snapshot` property adds the public-state projection; the older property continues to test its existing subscriber and installed-source account. The receiving Query witness must use the shared new judgment and actually invoke the shipped Query adapter with this worktree's core source.

## Existing protocol constraints

`LoadSubsetFn` in `packages/db/src/types.ts` requires success to await every establishing commit receipt. `SyncAppliedReceipt` and `commit()` promise public visibility; an accepted transaction always applies in commit order. A legal adapter can write `a=2`, await its receipt, and only then fulfill or reject its load.

A gate that waits for load success creates a circular wait: public application waits for replay success; replay success waits for the load; that load waits for public application. Resolving the existing receipt on private staging changes its visibility promise. Discarding an accepted write after failure changes the accepted-transaction promise. These are protocol conflicts, not reasons to weaken the new public-state comparison.

## Candidate protocol to evaluate

Use a distinct private replacement context tied to an acquisition attempt and replay generation. Private incorporation has its own staging acknowledgement. Provider completion certifies the exact requested scope after its staging acknowledgements, without waiting for public visibility. Core promotes only a coherent replacement. Ordinary `commit()` and public applied receipts retain their meaning; staging is not public sync acceptance.

The API spelling and adapter migration are proposals. A staged candidate must also drive internal query demand discovery without leaking through public reads or being ingested twice. Independent consumers of the same Collection need a shared publication decision. Different source Collections still require a query-level coherent publication boundary.

## Receiving and authority gaps

The controlled Collection and real Query paths must show assertion RED before production changes. Persistence needs a separate receiving witness: its application mutex can otherwise wait on a held public receipt while another replay write needs that mutex. Candidate-driven include discovery, independent peers, optimistic writes, full public read/index agreement, cleanup-time direct/subscriber equality, and exact retirement/enrollment rules remain explicit investigation boundaries. No class-closure or repaired-production claim follows from a plan or selected passing checks.

Execution results, measured reaches, source bindings, preserved failures and remaining gaps will be appended after the actual runs. No production patch is admitted while the receipt/progress protocol is unresolved.

## Executed baseline and bounded protocol evidence

The original lifecycle publication failure reported in #2310 reproduces on this clean base: `subscription-lifecycle.publication-history`, seed `-1439698414`, path `1:22`. After cleanup/restart and settling demand b, command index 5 observes a delete for b=1 where the old model expects no batch. Runtime: 1 failed, 137 unselected; Vitest reports no type errors. This is preserved as an open baseline mismatch, not attributed to the new law. Raw logs: `review-evidence/collection-publication/baseline-cleanup-restart.{stdout,stderr}.log`. Ordinary config discovery also printed nonfatal missing Expo tsconfig warnings; the intended assertion ran.

The runnable design-only model `review-evidence/collection-publication/publication-protocol-oracle.mjs` explores current early publication, withholding existing commits, and separate private staging under provider success/failure. Its result is in `protocol-model-results.json`: early publication violates the new safety law; withholding existing commits has no enabled progress action after staging; separate unaccepted staging permits both outcomes. Wrong-observation controls reject early publication, receipt fulfillment without visible writes, and discarding accepted transactions. This is bounded model evidence, not production or receiving evidence, a termination proof, or a chosen API.
