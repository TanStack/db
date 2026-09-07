# Route property type loss audit

**Bounded null: no dropped type, runtime, or export constraint found.**

One fresh Field Lab `loss-audit` pass compared the frozen `902c03a4` baseline with `ccf4a9cc`. The sole source was `packages/db/src/query/compiler/route-metadata.ts`, read through `git show` at both commits. Applicable instructions and the full live-query architecture were read first. Prior reports, TODOs, sibling findings, and other implementation sources were excluded.

All pointers below name this source file at the stated commit.

| Original support | Candidate trace | Loss reading |
| --- | --- | --- |
| `902c03a4:146–155`: outer `WeakMap<object, Map<PropertyKey, …>>` carries a required `descriptor: PropertyDescriptor` and optional `value` with required `original: unknown` and `replacement: unknown`. | `ccf4a9cc:20–23` preserves that exact shape; `151–154` keeps both map key types and uses the alias as the inner value type. | No field, optionality, mutability, or key constraint dropped. |
| `902c03a4:161–167`: the per-container map repeats that same shape. | `ccf4a9cc:160` uses `Map<PropertyKey, PublicContainerProperty>`. | No distinct per-container constraint existed to be compressed away. |
| `902c03a4:176–184`: the local property has that same annotation, starts as `{ descriptor }`, then gains its optional value pair after the descriptor guard. | `ccf4a9cc:169–174` substitutes the alias and preserves the initializer, guard, and assignment. | Required descriptor and delayed value assignment remain expressible without a cast or widened type. |
| `902c03a4:169–194, 198–234`: descriptor discovery, omitted-key handling, parent tracking, dirty propagation, cycle memoization, and descriptor-based copy. | `ccf4a9cc:162–184, 188–224` retains those runtime expressions and their order. | No runtime step or descriptor/copy constraint dropped by this extraction. |
| `902c03a4:135–140`: the exported transformer accepts and returns `unknown`; its property shapes are local implementation annotations. | `ccf4a9cc:140–145` keeps that signature; `20–23` declares the alias without `export`, and all three uses are inside the function. Other source exports retain their declarations and signatures. | No export added or removed; the new name does not enter an exported signature. |

The reduction rule is exact structural deduplication: three identical inline shapes become one private alias. It removes repeated spelling and introduces a shared name, but no source-supported constraint vanished. There is no recovered item or dropping rule to report beyond that textual compression.

**Evidence limits.** This is a static source trace, not an execution result or a general correctness finding. Byte-identical TypeScript `transpileModule` output for ES2022/ESNext with comments, plus passing package types, lint, and format checks, were supplied claims; this audit did not rerun or independently verify them. Tests and other files were outside the source bundle. The extraction-focused scope can hide pre-existing defects and effects outside this file; seeing the supplied type-only description can also bias the scan toward equivalence. No tests, builds, source edits, commits, or external actions were performed.
