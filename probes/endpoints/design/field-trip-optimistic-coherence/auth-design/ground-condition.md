# Auth checks are operations, not just dependencies

Run 22. Frozen tension: compile enough ordinary Kitchen code to skip unrelated payload reads while preserving permission checks, session behavior and authoritative reconciliation. Baseline: a valid logged-in Kitchen user, cookie cache enabled for five minutes, a mutation followed by retained query refreshes. Current explanation under test: following getSession through its factory might expose a simple read dependency and unblock pruning.

## Boundary comparisons

All measured rows use installed Better Auth 1.7.4 through its public API with a disposable memory adapter. Each pair changes one stated condition. See [raw results](session-path-results.json) and [source dossier](sources.md).

| Pair | Changed condition | Observed result | Classification |
|---|---|---|---|
| cached → revoked-cached | Delete the stored session, keep valid cookie | Both return a user; zero findSession calls | Store revocation alone does not change this cache path |
| revoked-cached → revoked-bypass | Disable cookie cache for this invocation | One findSession, no user | Changes authority path; not a mere performance flag |
| bypass-fresh → renewal | Session expiry makes renewal due | Adds one updateSession | Changes read into read/write operation |
| bypass-fresh → expired | Stored session expiry is in the past | deleteSession and no user | Changes both effects and permission outcome |
| expired → expired-disable-refresh | Set disableRefresh | Still deletes the expired session | Defeats proposed pure-read interpretation of that flag |
| renewal → renewal-write-failed | Adapter renewal returns null | Authentication throws | Maintenance failure affects permission outcome |

Generated response cookies were counted, never logged. They were not sent through Kitchen's HTTP/browser integration. The failed-renewal case records thrown status only; its zero cookie count does not mean the error carries no headers.

## Conditions, controls, and evidence

**Dynamics:** a request carries a signed cookie; the configured policy selects cache or backing-store authority; reads may renew/delete sessions; the handler then checks scope and runs app SQL. Mutations can partially commit before errors, after which retained reads reconcile.

**Constraints:** auth outcome and side effects must not disappear when payload reads are pruned. Unknown effects remain conservative. Caller scope, client descriptor, certificates and table-disjointness are not proof of permission. Schema checks remain compile-time only; external write discovery remains outside Endpoints.

**Boundary conditions:** cache lifetime, backing adapter, installed version, plugins/hooks, current session expiry, request phase, selected user/scope, baseline identity, and whether headers reach the browser.

| Controller | Material condition | Evidence / unresolved fact |
|---|---|---|
| App auth config | Cache policy and optional callbacks | S3/S7/S16: present five-minute cache, absent plugin/hook keys; no universal library claim |
| Library/adapter | Store access, renewal/deletion and dispatch | S4–S9; measured S19; arbitrary transaction hook completion unmeasured |
| Framework compiler/runtime | Skip granularity and per-query checks | S10–S13: checks currently live inside skippable handlers |
| App client/session lifecycle | Same user vs new login scope and retained rows | S14: user-switch cleanup only; session-generation isolation unproved |
| Transport integration | Cookie headers and auth error representation | S1/S2/S8: no explicit successful header forwarding; browser trace still needed |

Supported conclusion: merely calling getSession a read is unsound. A local effect model may bound this pinned configuration, but authentication outcome, payload value and maintenance effects are distinct claims. Neither a factory-name exemption nor disableRefresh establishes purity.

The cookie-cache observation does **not** settle the value conflict. Preserving today's five-minute policy and demanding immediate store-backed revocation are different contracts. Likewise, retaining stale rows on an ordinary outage does not decide what confirmed permission denial should do. These remain explicit choices.

Next discriminating checks for a proposed split: can the compiler prove the permission prefix/body boundary and close every effect? What identity makes a baseline reusable across auth changes? Does the real transport carry renewal/denial correctly? These are inputs to the already-selected design grammar, not permission to implement a policy change.

Limit: static source plus a memory-adapter path probe cannot establish PostgreSQL effects, performance, plugin-wide support, browser logout behavior, or exact timing equivalence. A stolen cookie from another app was rejected as out of scope; it is not needed to explain this local boundary.
