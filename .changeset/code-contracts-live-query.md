---
'@tanstack/db': patch
---

Add code contracts for live query D2 multiplicity invariant.

Introduces a contract-based approach to ensure correctness in the live query system, inspired by Cheng Huang's article on AI-assisted development. Contracts verify runtime invariants during development/testing and can be disabled in production.

Key additions:
- `contracts.ts` with `precondition()`, `postcondition()`, and `invariant()` utilities
- D2 multiplicity contracts in `CollectionSubscriber.sendChangesToPipeline()` ensuring no duplicate keys are sent to the incremental view maintenance pipeline
- 16 contract verification tests covering multiplicity, tracking, and consistency
- 9 property-based tests using fast-check to explore edge cases with random operation sequences

Contracts are automatically disabled when `NODE_ENV=production` for zero runtime overhead in production builds.
