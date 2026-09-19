# TanStack Trust RFC v0.3 — draft question register

## Load-bearing unsupported additions

None. Every load-bearing architecture, implementation, status, and product
claim maps to the frozen v0.2 source and Essay trace.

## Selected post-draft illustration checks

Kyle explicitly asked for non-Endpoints TanStack examples and asked that they
be checked after drafting. These checks may narrow, replace, or remove an
illustration. They may not add Trust theory, claim another implementation, or
become range evidence.

| ID | Question | Allowed evidence | Draft disposition until checked |
| --- | --- | --- | --- |
| QI01 | Does current TanStack Router material support an example involving a generated route tree and runtime matching for declared route forms? | Official Router route-tree guide and file-based quick start | **Checked.** The route tree matches URLs to component trees, and the quick start imports generated `routeTree.gen` into `createRouter`. The illustration was narrowed to IDs, paths, parent relations, and URL matching. |
| QI02 | Does current TanStack Query material support a persisted-state example with meaningful format/options/age dependencies? | Official Query `persistQueryClient` guide | **Checked.** The guide exposes `timestamp`, `maxAge`, `buster`, hydration/dehydration options, a `PersistedClient` representation, and a `gcTime` interaction. The draft removed the vague library-version dependency. |
| QI03 | Does current TanStack Table material support a sorting or filtering row-model example with declared data/options and a real row-model checkpoint? | Official Table sorting and column-filtering guides | **Checked.** The guides expose client-side sorted/filtered row-model stages and manual modes that use caller-provided rows as already transformed. |
| QI04 | Does current TanStack Form material support a validation-adapter example that maps schema results into field or form errors? | Official Form validation guide | **Checked.** Standard Schema errors propagate to fields, while form validators can return separate `form` and `fields` error structures. |

## Preserved architecture decisions

These are not drafting gaps to solve:

- applicability ownership and boolean versus three-valued result;
- semantic equivalence, scope subsumption, and cross-version identity;
- speculative versus observed challenges;
- alternate repair, durable repair certificates, selective expiry, and
  distributed clocks;
- rule, analyzer, rubric, model, and solver admission;
- a durable agent-facing home for operational failures;
- universal confidence, evidence strength, priority, permission, severity, and
  fallback;
- stable domain manifests and generic lifecycle operations;
- multi-process coordination, transactions, security, remote authority, and
  scale;
- independent range, agent effectiveness, human comprehension, and product
  outcomes; and
- conditions that would justify later extraction.

## Conditional Stage 6 checkpoint

The introduction and whole-document order changed materially from v0.2.
Draft-level Blind Cartography is therefore conditionally relevant before
cleanup. It must be offered after the initial draft and illustration check; it
is not selected by this register.

## Remaining validation

- Conditional draft-frame checkpoint: completed
- Writing-guide cleanup: completed
- Required Meso-Level Density Assay: completed on the pre-loss-repair hash;
  architectural result remains applicable
- Required Reader Assay: completed on the pre-loss-repair hash; architectural
  result remains applicable
- Required Semantic Drift audit: completed on the final post-loss-repair hash
- User-selected v0.2 → v0.3 Loss Audit: completed; twelve recovered signals
  restored through six existing passages
- Kyle's thorough read and explicit approval or revision
