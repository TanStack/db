---
'@tanstack/supabase-db-collection': minor
---

Add `@tanstack/supabase-db-collection`, a collection that syncs TanStack DB with Supabase through PostgREST queries, optimistic mutations, and Realtime subscriptions. It replaces `@supabase-labs/tanstack-db@0.1.0` ([supabase/tanstack-db@3503c451](https://github.com/supabase/tanstack-db/commit/3503c451b2f2550ab4069067673881f39342b588)).

Compared with that package, it adds a `syncMode` option (`'on-demand'` by default, or `'eager'` to load the whole table), `parse` and `serialize` column conversions, a `defaultStringCollation` option, and materialization from a `DbClient`. Composite collection keys are now JSON arrays. `queryOnce` is now `experimental_queryOnce`, which runs only `count`, `sum`, and `avg` of plain columns on the server and always resolves to TanStack DB's `queryOnce` result.
