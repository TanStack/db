---
'@tanstack/db': minor
---

Export `withPublicationContext`. A sync source that commits sync transactions to several Collections for one source state, such as one server checkpoint, can commit them inside one call: every live query that reads those Collections then runs after the last commit and publishes one batch, instead of running and publishing an intermediate result after each commit. Each Collection still notifies its own change subscribers when it commits, so this is not an atomic publication across the Collections.
