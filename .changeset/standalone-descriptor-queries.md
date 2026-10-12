---
'@tanstack/db': minor
'@tanstack/react-db': patch
'@tanstack/svelte-db': patch
---

Allow a `Query` built with Collection descriptors outside a `DbClient` to bind its sources when a client consumes it. Building or extending a query keeps descriptors unbound until that consumption. A reusable factory descriptor can now serve the same prebuilt query in separate client scopes, including React providers and server preloads. A prepared query is a bound snapshot; reuse the original unbound query across clients. The exported IR now represents an unbound descriptor with `DescriptorRef`; visitors of `IR.From` must handle the `descriptorRef` variant.

React hooks bind standalone descriptor queries through their `DbProvider` client and report a provider hint when no client is available. Svelte hooks bind through their client and release deferred sources after failed query setup.
