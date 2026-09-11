# Tests specified before implementation

1. Run an actual browser caller through a local Start server; assert validated input/output and server sentinel; reject wrong input/output TypeScript assignments.
2. Search every production client JS chunk for server sentinel/database/auth markers, inspect required server markers, retain shared helper in client.
3. Negative fixtures retain a server helper reference and side-effect-only import: measure leak/rejection, do not count simple handler erasure as success.
4. Edit handler and imported helper during dev; request again. Rename then remove endpoint declaration and check behavior and stale output. Repeat modified state in clean build.
5. Execute the authored optimistic callback in browser, assert visible insertion independently of request success.

First pass uses authored types, fake DB/auth and metadata; no Track A analysis. No auth, SSR identity, serialization completeness, mutation settlement, live-query integration or complete Todo claims.
