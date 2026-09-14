# Frozen auth candidate — per-query guards and selective payloads v1

This is one exploratory candidate for a prototype, not implemented or adopted. Evaluate it under its stated standard. Sources in sources.md/json and session-path-results.json. Do not infer unsupported guarantees from field names.

## Claim and scope

For handlers with a compiler-proven permission/session prefix G and a payload body D, run each retained query's G even when D need not refetch. This should preserve current per-invocation permission decisions under the configured auth policy while allowing unrelated payload tables to be skipped. Every affected retained collection must settle to the authoritative payload result (with the existing concurrency repair path); no new external-write discovery is promised.

Scope: ordinary Kitchen-style functions where G is a leading permission/session operation, its output is unused or captured by D, and D is a deterministic database read/output mapping with no later authorization or writes. Version/config/schema-pinned effect summaries may bridge library calls. Unproven splitting, callbacks, output captures, effects, or descriptors fall back to executing the full handler. Arbitrary hooks, hidden closure mutation, or interleaved row authorization must not be labeled proven.

## Proposed execution contract

1. Structurally validate retained descriptors and parsed params against server registrations. This is not permission. Authenticate/authorize the mutation through its ordinary function; execute it once. Track its conservative may-write set even if it throws after a partial commit. Do not retry mutations due to refresh errors.
2. After mutation completion/failure, invoke one G for every retained query, including queries whose payload appears disjoint and candidates for revision reuse. Invoke the existing configured auth policy; do not implicitly disable cookie cache. G returns allow(captured values), deny, or failure, and may renew/delete sessions or produce response headers. Do not memoize across queries or requests in this candidate.
3. Gather may-write sets from mutation and all query guards before selecting payloads. Compile-time library summaries must include configured hooks, schema side effects and error paths or be unknown. No runtime schema checks or database tracking infrastructure. Unknown means full refresh, not no writes. This phase may reorder old G1;D1 || G2;D2 interleavings; it declares guards-before-payloads rather than exact timing equivalence. It does not promise a shared SQL snapshot or revocation detection stronger than each actual guard invocation.
4. A successful guard gates each D or reuse result. Compare server-held baseline binding (definition/version, parsed input, scope, relevant captured guard values) with the current invocation. Unknown/different binding forces D. A client baseline/certificate is never proof of permission. Missing baselines and optimistic recipients force D.
5. Otherwise skip D only when its proven payload dependencies are disjoint from the union of covered writes. Revisions may skip D only after the same guard/binding gates. Preserve output captured values; not just row membership. Unknown body purity or auth value dependence uses full handler fallback.
6. Execute selected D operations with the existing retry policy only if the split proves they are read-only. Do not rerun an effectful G because a D read failed. On unknown whole-handler fallback retain the existing behavior and report its effect/retry limitation; do not claim effect-once semantics for that fallback.
7. Deny/failure never produces unaffected/unchanged authority success. Committed write outcome remains distinguishable from refresh failure; retain existing atomic authority publication and optimistic retirement/repair behavior. Returned authority is bound to the matching live client/request context; stale scope responses must not populate a different scope.

## Success standard and unresolved requirements

Within the proven subset: no required permission call is skipped; no successful payload reuse occurs after deny/error; no covered writes/captured auth values capable of changing D escape its refresh decision; no server code or credentials enter the client build; and no mutation is replayed due to refresh failure. Payload savings must be demonstrated on the actual converted app before claimed. Plain unknown fallback remains legal.

This contract is not a claim of identical callback timing, headers delivered to the browser, one shared DB snapshot, immediate revocation despite cached auth, or exactly-once side effects for opaque existing handlers. Header forwarding, typed denial versus outage, and local stale-data erasure/session-generation teardown remain required transport/client design work. The current generic Unauthorized/Error and read-error path does not establish those behaviors. The candidate cannot be called a finished auth implementation until those gaps are specified and tested.

A failure critique should identify the exact broken claim, give an admissible concrete scene, state evidence and a repair condition, and distinguish a design flaw from a rejected input or an explicitly unresolved contract. Do not require external-write discovery or immediate revocation as an unstated standard.
