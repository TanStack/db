---
'@tanstack/supabase-db-collection': minor
---

Add `@tanstack/supabase-db-collection`, a collection for syncing TanStack DB with Supabase through PostgREST queries, optimistic mutations, and Realtime subscriptions. Migrated from `@supabase-labs/tanstack-db@0.1.0` ([supabase/tanstack-db@3503c451](https://github.com/supabase/tanstack-db/commit/3503c451b2f2550ab4069067673881f39342b588)). Adds a `syncMode` option (`'on-demand'` by default, or `'eager'` to load the whole table).
