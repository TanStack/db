---
'@tanstack/svelte-db': patch
---

fix(svelte-db): a disabled `useLiveQuery` (query callback returning `null`/`undefined`) no longer crashes

The reactive-getter unwrapping (`toValue`) called the query callback and, when it returned `null`/`undefined` to signal a disabled query, passed the unwrapped `null` into `createLiveQueryCollection`, throwing in `getQueryIR`. A `null`/`undefined` resolved value is now treated as a disabled query (returns the `disabled` state) as it is in the other adapters.
