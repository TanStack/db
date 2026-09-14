# Representation grammar: evidence

E1: Representation survey C1–C3 are local-source observations. E2: C4/C5 are version-pinned documentation/inference. E3: P1–P12 are typed user/source/provisional constraints, not new experiments. E4: Existing two-collection insert oracle is a source reconstruction case: direct target changes while sibling remains empty. E5: Prior result-sharing measurements show a correct encoding can cost more; no new performance claim.

RC1: Existing source reconstructs through L1/L2/L5 with only directly captured recipients; Q has order but no dependency/effect analysis. Missing L3 is exactly E4's cross-query gap. R1/R3–R9 describe authorized extensions, not existing behavior.
RC2: F1 reconstructs a two-full-result insert by evaluating the same guessed row against each eligible Q, capturing edits in T, then replacing confirmed results and retiring T. This is a logical walkthrough, not executed evidence.
RC3: A top-k deletion cannot reconstruct its unseen replacement from the changed row alone. R3 refuses exact local derivation; R5 can still return an authoritative full result. Multi-table joins have the same support boundary, with added relation dependencies.

NC1: Subscriber-based exclusion violates R1 even if the read is unused now.
NC2: Empty RETURNING used as a proof of no cross-table effects violates R4/E2.
NC3: Treating a changed-row key as a complete top-k result patch violates R3/R7.
NC4: Retrying a committed write after a read error violates R8.
NC5: Sending handlers or raw SQL from the client as trusted plans violates R7/R10.
NC6: Dropping all overlays when one response arrives violates R6.

Range: untested. All available examples informed extraction. No fresh independent case was supplied; none was fabricated or reused as held-out evidence.

Control limit: reconstruction, ablations and exclusions are analytical judgments, not executable proofs. RC3 explicitly fails the attempted universal changed-row derivation; its dependent optimization is excluded. Production latency, full SQL range and concurrency remain unmeasured.
