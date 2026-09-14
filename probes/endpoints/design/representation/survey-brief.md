# Frozen representation survey brief

Question: Which existing TanStack DB and Endpoints/Drizzle representations and bounded relational update mechanisms can describe query dependencies, client-guessed row effects, and authoritative updates without treating unsupported analysis as proof?

Use: representation-level exploratory Design Grammar, followed by a first implementation/model/oracle draft authorized by Kyle.

Depth: broad but bounded. Date/cutoff: 2026-09-11. English sources.

Coverage: (1) local query IR/expression and collection/transaction boundaries, (2) current Endpoints extraction and server/client wire boundary, (3) primary SQL/relational sources for update effects, unknown analysis, and delta limitations.

Budget: local relevant definitions and call sites; at most four external primary sources and two targeted contrary/limitation passes. Stop at budget if not saturated.

Starting material: current runtime/compiler, query IR, full live-query ARCHITECTURE.md, prior field log and oracle/measurement receipts. No core materialization redesign. No broad cache-vendor survey, arbitrary-SQL equivalence solver, distributed database protocol, or production-performance claim.

User constraints: every affected non-GCed collection updates, with no subscriber pruning. Optimism is a guess represented by existing transaction overlays. Unsupported analysis excludes dependent optimizations; authoritative fallback evaluates full results and returns them with the mutation. Public bare query collections and synchronous actions remain.

Outputs: source-traced representation-survey.md plus external-source-notes.md, preserving claim types, inspected sections, limitations, controls, and access gaps. No architecture selection inside the survey.
