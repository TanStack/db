---
'@tanstack/db': minor
---

Allow a `Query` built with Collection descriptors outside a `DbClient` to bind its sources when a client consumes it. A reusable factory descriptor can now serve the same prebuilt query in separate client scopes, including React providers and server preloads. The exported IR now represents an unbound descriptor with `DescriptorRef`; visitors of `IR.From` must handle the `descriptorRef` variant.
