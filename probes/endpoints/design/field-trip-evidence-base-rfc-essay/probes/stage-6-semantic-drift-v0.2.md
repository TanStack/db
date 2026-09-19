# TanStack Trust RFC v0.2 — Semantic Drift Assay

## Inputs and context boundary

- Frozen pre-edit control:
  `drafts/tanstack-trust-rfc-v0.2-pre-edit.md`
- Control SHA-256:
  `5a60ae420ea43d4ac1539ddd6c42bf4417cb1ce3d50f236830d75ad19f4988f9`
- Final edited draft: `drafts/tanstack-trust-rfc-v0.2.md`
- Final SHA-256:
  `61fd916f61b53e8440de673a39fbbce4b745c7d5215e330ace2bc01ff22efb60`
- Source/design trace: `drafts/tanstack-trust-rfc-v0.2-source-trace.md`

Each fresh auditor saw only the two versions, the source/design trace, and the
declared invariants. Neither saw the Field Log, reader results, Meso-Level
Density result, intended verdict, or the other auditor's output.

## Declared invariants

1. Trust remains evidence machinery incubated and shipped inside Endpoints for
   the foreseeable future, not a current standalone product or package roadmap.
2. Domain packages own meaning, adequacy, applicability semantics, rules, check
   authority, formal encodings, and omissions.
3. Trust owns reusable evidence mechanics without proving domain truth or
   checker soundness.
4. Consumer policy owns permission, severity, fallback, rollout, and
   enforcement.
5. Evidence, execution/reach, and policy remain independent.
6. Endpoints is constructive and bounded evidence, not independent range
   evidence.
7. Extraction and a second implementation are not current milestones.
8. Statuses do not silently upgrade.
9. Cleanup adds no theory, evidence, examples, causal links, reader-outcome
   claims, or product policy.

## First comparison and caught drift

The first edited candidate had SHA-256
`c4abd5aba9496538ba7feab2b7fff1f17b87fe9cb8134ffb4fefc1300d880d28`.
Its fresh auditor accepted the paragraph reflows, the opening sentence split,
and the AIUC source link. It flagged one meaning change:

| Unit | Before | First edit | Classification | Result |
| --- | --- | --- | --- | --- |
| Oracle Guide obligations | `distinguish`, `preserve`, and `retain` were required actions inside the Guide's discipline | “The same discipline distinguishes…, preserves…, and retains…” | Confidence, causality, and attribution | The indicative verbs could imply the workflow itself accomplishes outcomes that remain unmeasured. Unauthorized drift. |

All eight architecture/status invariants remained recoverable, but the cleanup
invariant failed at this sentence.

## Restoration

The sentence was restored to explicit normativity:

> It also requires authors to distinguish harness failure from application
> findings, preserve the original violation while reducing a trace, and retain
> promises the bounded check did not establish.

The word `adjacent` was also restored before the linked AIUC donor name so the
source-transfer distance remains explicit at the point of use.

## Final fresh comparison

**Verdict: no unauthorized semantic drift detected.** Both final hashes matched,
and the edited draft preserved every substantive invariant.

### Mechanical diff

Five hunks changed 13 physical lines added and 12 removed, net one line. After
excluding wrapping, only three lexical units changed:

1. `quickly, but somebody` → `quickly. Somebody`
2. `AIUC argument` → `[AIUC argument](https://www.latent.space/p/aiuc)`
3. `..., observe the production checkpoint, distinguish ...` → `..., and
   observe the production checkpoint. It also requires authors to distinguish
   ...`

All remaining differences are line wrapping.

### Meaning-bearing ledger

| ID | Classification | Before → after | Source/design control | Disposition |
| --- | --- | --- | --- | --- |
| M1 | Structure | One adversative sentence linked fast implementation to remaining authority work → two juxtaposed sentences; `still` retains the continuing obligation | Product premise remains unmeasured | Accepted; no proposition, confidence, scope, actor, or causal claim changed |
| M2 | Attribution and evidence role | AIUC named in plain text → same named argument linked to its source | Trace already registers the supplied AIUC source and transfer breakpoint | Accepted; attribution improved without adding support or treating AIUC as validation |
| M3 | Attribution and structure | Seven Oracle-linked workflow clauses in one list → four in the first sentence and three explicitly required author duties in a second sentence | Workflow region remains documented normative guidance with effectiveness unmeasured | Accepted; no duty was added, removed, or promoted to an achieved outcome |

No change to claim, confidence, scope, example function, causality,
evidence status, product policy, or reader promise remained.

### Independent invariant reconstruction

| Invariant | Result | Final RFC location |
| --- | --- | --- |
| Endpoints incubation; no standalone roadmap | Pass | Abstract; §§1, 6, 8–9 |
| Domain authority | Pass | §2 authority map; §3 |
| Trust mechanics without domain truth/soundness | Pass | §§2–4 |
| Consumer permission and enforcement | Pass | §§2 and 7 |
| Separate evidence/reach/policy axes | Pass | §2 |
| Endpoints bounded and constructive, not range evidence | Pass | §8 |
| Extraction/second implementation not current milestones | Pass | §9 decision register and build sequence |
| Statuses do not silently upgrade | Pass | Status legend and point-of-use labels |
| Cleanup adds no new substance | Pass by comparison | Complete final diff |

### Final disposition

- **Accepted:** all mechanical reflows and M1–M3.
- **Flagged:** none.
- **Unresolved textual deltas:** none.
- **Boundary notes:** the fresh file-only auditor did not externally resolve the
  AIUC URL or reopen upstream sources. The source trace supports the workflow
  region jointly rather than allocating every sentence to one source.

## Limits

The final audit establishes textual preservation and consistency with the
authorized source trace. It does not establish prototype correctness, source
accuracy, author intent, URL identity, human comprehension, or product outcomes.
