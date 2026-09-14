# Auth source dossier — 2026-09-12

Local installed Better Auth 1.7.4 and current Kitchen conversion. Hashes and examined spans are in [sources.json](sources.json). No application credential values, request tokens or cookies are recorded. Source IDs are analytical references, distinct from field-log source IDs.

- S1/S2: Both query and mutation authentication call the same public getSession API and compare the returned user ID to the caller's scope. They supply no cache/refresh flags and do not request response headers.
- S3/S7/S16: Kitchen enables cookie cache for 300 seconds; no plugins, databaseHooks, top-level hooks, secondaryStorage or advanced config keys are present. Installed default update age is one day and lifetime seven days. Stateful cookie refresh cache is false. Internal plugin list is empty in this version.
- S4/S5: A valid cache can avoid the database. The database path reads session and user; renewal updates session; expiry can delete it. Disabling refresh does not bypass the earlier expiry deletion. An update returning null rejects authentication.
- S6/S8/S9: Public auth calls include hook dispatch. Hook-enabled variants can have arbitrary effects and alter results. After-transaction hook scheduling exists; completion relative to arbitrary caller transactions has NOT been verified. Do not claim a general effect closure.
- S8 with S1/S2: Headers are exposed by returnHeaders/asResponse; these app calls request neither. The current wrapper does not explicitly forward successful renewal/expiry headers. Browser cookie delivery is unmeasured; do not count library-generated cookies as browser-observed effects.
- S10/S11: Query permission checks run inside read handlers. Descriptor admission parses and validates identity but does not authenticate. Both unaffected and revision-reuse paths can avoid running those checks.
- S12/S13: Refresh failure is generic and may follow a committed mutation. Runtime fail records read errors and settles transactions, without auth-specific baseline erasure. This is not evidence that logout isolation or stale-data clearing is solved.
- S14: Changing the initialized user cleans up the prior collections. Same-user session replacement/revocation and pending response behavior are not established by this helper.
- S18/S19: Eight real public API invocations on a disposable memory adapter confirm cache, bypass, renewal, expiry, disabled-refresh expiry and failed-renewal paths. This is a control-flow probe, not a PostgreSQL/browser/performance test.

Executable reproduction: `node session-path-probe.mjs` from this directory. Its absolute imports pin the local installed package; it generates all secrets and identities in memory. Reproduction elsewhere requires changing those imports. No live Kitchen or third-party APIs are invoked.
