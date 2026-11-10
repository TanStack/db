-- Schema for the shared @tanstack/db-collection-e2e suites. Columns mirror the
-- `User`, `Post` and `Comment` types in packages/db-collection-e2e/src/types.ts
-- (and the tables the Electric e2e creates). This schema is intended for the
-- local Supabase stack the e2e suite boots - it is NOT a production schema.
--
-- "largeViewCount" holds a value above Number.MAX_SAFE_INTEGER, which the suites
-- use to test bigint handling. PostgREST renders a `bigint` column as a JSON
-- number, which JavaScript's JSON.parse rounds to the nearest double (it cannot
-- tell 9007199254740993 from 9007199254740992), so a bigint column cannot
-- round-trip such values through PostgREST or Realtime. The column is `text`
-- instead, which keeps every digit; the fixture values all have the same
-- number of digits, so PostgREST's text comparisons order them like numbers.
-- The collections convert it to a bigint with `parse` and back with `serialize`.
--
-- Timestamps are timestamptz, not timestamp: PostgREST and Realtime render
-- timestamptz values with a UTC offset, so `new Date(value)` and the ISO
-- strings the adapter sends in filters both address the same instant. A bare
-- `timestamp` would be rendered without an offset and parsed as local time.

create table public.e2e_users (
  id uuid primary key,
  name text not null,
  email text,
  age integer not null,
  "isActive" boolean not null default true,
  "createdAt" timestamptz not null default now(),
  metadata jsonb,
  "deletedAt" timestamptz
);

create table public.e2e_posts (
  id uuid primary key,
  "userId" uuid not null,
  title text not null,
  content text,
  "viewCount" integer not null default 0,
  "largeViewCount" text not null,
  "publishedAt" timestamptz,
  "deletedAt" timestamptz
);

create table public.e2e_comments (
  id uuid primary key,
  "postId" uuid not null,
  "userId" uuid not null,
  text text not null,
  "createdAt" timestamptz not null default now(),
  "deletedAt" timestamptz
);

-- Realtime: publish the tables so postgres_changes events fire for subscribers.
alter publication supabase_realtime add table public.e2e_users;
alter publication supabase_realtime add table public.e2e_posts;
alter publication supabase_realtime add table public.e2e_comments;

-- Test-only posture: RLS must be ON because Realtime's Postgres Changes uses
-- SELECT policies to decide what to broadcast; the allow-all policies let the
-- anon key both CRUD via PostgREST and receive every change. Do NOT copy this
-- posture into a real application.
alter table public.e2e_users enable row level security;
alter table public.e2e_posts enable row level security;
alter table public.e2e_comments enable row level security;

create policy "e2e allow all" on public.e2e_users
  for all to public using (true) with check (true);
create policy "e2e allow all" on public.e2e_posts
  for all to public using (true) with check (true);
create policy "e2e allow all" on public.e2e_comments
  for all to public using (true) with check (true);

-- Empties the shared tables. TRUNCATE has no PostgREST endpoint, so it is
-- wrapped in a function. security definer runs it as the owner; execute is
-- restricted to service_role.
create or replace function public.reset_e2e_shared()
returns void
language sql
security definer
set search_path = ''
as $$
  truncate table public.e2e_comments, public.e2e_posts, public.e2e_users;
$$;

revoke execute on function public.reset_e2e_shared() from public, anon, authenticated;
grant execute on function public.reset_e2e_shared() to service_role;
