# Frozen input and preservation preview

Run26, exploratory. User-selected on 2026-09-14. Source system: the current Endpoints helper analysis, compile-time schema binding, emitted dependency diagnostics/registry metadata, and runtime dependency matching, exercised with its existing fixture machinery. This is one connected source system. Kitchen auth is a motivating application observation; the uninstrumented reset draft is not evidence for a grammar or a second donor system.

Target: extract a language of source-backed guarantees and diagnostic suggestions which can drive optimizations without the compiler inventing application behavior.

| ID | Preservation property | Authority |
|---|---|---|
| P1 | Application code owns auth, effects and ordering. No compiler insertion, lifting, splitting or memoization of auth. | Explicit user |
| P2 | Lint suggests reviewable source edits; suggestions and suppressions do not establish guarantees. | Explicit user plus inferred consequence |
| P3 | Analyze ordinary functions/call graphs; do not require an auth DSL or bless function names. | Explicit user/history |
| P4 | Distinguish complete facts, incomplete observations and unknowns. Unknown never means no effects. | Source contracts; user guarantee boundary |
| P5 | Claims carry source/schema/config scope and fail when their required evidence is missing. | Source fingerprints/build contract; inferred expansion |
| P6 | A claim supports only its named optimization; no invented universal auth-refresh policy. | User correction; inferred contract discipline |
| P7 | Retained collections, optimistic recipients and missing baselines retain existing authority requirements. | Explicit user/history |
| P8 | Schema inspection remains at build time; no added PostgreSQL infrastructure; server code stays off the client. | Explicit user/history |
| P9 | Ordinary execution remains the fallback for missing optimization proof; it is not a proof of convergence for writing queries. External freshness is out of scope. | Source execution; user/history; bounded prior witness |
| P10 | Generated oracle coverage checks general laws; pinned examples are controls/replays, not substitutes. | Current AGENTS/user |

P2/P5/P6 include explicitly provisional analyst consequences. This run does not claim exact equivalence across all user code or a complete preservation list. No new public API, application refactor, library proof provider, deployment policy, or implementation is selected.
