# Permission checks and payload reads need separate rules

A query's auth call can decide who may see data **and** change the database. The payload read has a different job: producing the rows. Skipping that read cannot also skip permission, session renewal, or effects that change another collection.

The grammar admits three forms, without ranking them:

- **Model the whole auth call.** Teach compilation the effects of a pinned library/configuration. Keep ordinary handlers intact. This can improve analysis, but a narrower table list alone does not make it safe to skip a handler containing permission checks.
- **Run each query's guard, then select payload reads.** Check permission even for unchanged collections, include all guard writes when selecting refreshes, and bind reused rows to the current inputs and relevant auth values. This adds a compiler-proven split and changes execution order.
- **Create auth context for the request.** Share the session lookup while retaining endpoint-specific authorization. This changes when and how often auth runs; principal lifetime before and after mutations must be an explicit contract.

All three need conservative treatment of unknown helpers and hooks. Recognizing the name `getSession` is insufficient. The compiler must account for its configured behavior and captured values, while keeping auth implementation and credentials out of the client.

Kitchen currently allows a valid five-minute cached session to authorize without checking its stored session. The probe confirmed that behavior, including after store revocation. Bypassing the cache would strengthen freshness and change policy. Separately, confirmed permission denial and a transient outage may need different treatment of retained client rows; the current generic error path does not define that distinction.

This is an exploratory grammar, not a complete auth design. It does not prove exact timing equivalence, header delivery, session-generation isolation, or a shared database snapshot. The per-query split is frozen for the selected audits as a testable candidate, not an adopted choice. Its guard-before-payload phase changes old interleavings; the request-context form also changes call count. Arbitrary row authorization interleaved with SQL cannot be extracted as a pure payload by this grammar.

No independent range case was supplied; the eight installed-library controls informed extraction and are not held-out validation. No PostgreSQL performance gain or Kitchen compilation success is claimed. The saved [model](grammar-model.md), [evidence](grammar-evidence.md), and [process](grammar-process.md) retain the preservation rules, reconstruction limits, ablations, exclusions, and unresolved choices.
