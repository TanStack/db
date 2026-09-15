# Loss-audit controls

Target: `../02-research-survey.md`, frozen before agent dispatch.
SHA-256: `b31c3059af06b4afd40134577a60a50083c10f96b6088c4288eea35518e9e4b2`.

Three fresh agents received the same target, question, and loss-audit card.
They received no conversation history and were instructed to inspect each
assigned primary source separately before collating. They could not inspect
sibling reports. The parent wrote the fracture and ground-condition readings;
these agents audit the survey's source reduction only.

| Scanner | Assigned documents | Record |
| --- | --- | --- |
| language | S4, S5, S20, S21, S19 tRPC, S22, S27 | [language.md](language.md) |
| queries | S6 Actions and Queries, S7, S8, S9, S10, S11, S13, S14, S15, S28 | [queries.md](queries.md) |
| protocol | S12, S16, S17, S18, S23, S24, S25, S26, S19 Firestore companion | [protocol.md](protocol.md) |

This assigns all 27 freshly inspected primary documents, including companion
documents grouped under a source ID in the survey. The old inventory and local
RFC/code are context, not independently reaudited source claims in this pass.

Fresh context reduces carryover from the parent's framing. Shared model lineage,
search tooling, and a common reduction remain correlated. Grouping several
sources per scanner is weaker isolation than a separate agent per document.
Every source needs either a supported omission or an explicit null reading.

The combined report retains findings and source pointers. It does not decide
that a recovered item should be added to the implementation or evidence schema.
