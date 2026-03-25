---
'@tanstack/db': patch
'@tanstack/react-db': patch
---

Add cursor-aware effect replay via `startAfter` option on `createEffect` and `useLiveQueryEffect`. Sync writes can now carry an opaque sortable cursor that propagates through `ChangeMessage` and `DeltaEvent`, enabling effects to suppress callbacks during historical replay while still hydrating internal query state. `startAfter` accepts either a scalar cursor (single-source) or a `Record<string, CollectionCursor>` for per-source gating in join queries. `DeltaEvent` now includes `triggeringSource` and `cursors` fields for gated effects.
