-- Schema for the experimental_queryOnce server-aggregate oracle
-- (e2e/query-once-aggregate-oracle.e2e.test.ts).
--
-- experimental_queryOnce computes an aggregate-only query with PostgREST's
-- aggregate functions, which are off by default. Supabase enables them per
-- project through the authenticator role's in-database PostgREST config.
alter role authenticator set pgrst.db_aggregates_enabled = 'true';
notify pgrst, 'reload config';

-- Every column is nullable, so a generated history can aggregate an empty or
-- all-null column. Two columns store numbers as text, which the collection
-- reads with `parse` (the way the shared suites store "largeViewCount"):
-- "big_count" holds a bigint, which Postgres orders as text while the
-- collection orders it as a bigint, and "amount" holds a decimal, which the
-- collection can sum while Postgres cannot sum text.
create table public.query_once_rows (
  id bigint primary key,
  score integer,
  label text,
  recorded_at timestamptz,
  big_count text,
  amount text
);

alter table public.query_once_rows enable row level security;
create policy "e2e allow all" on public.query_once_rows
  for all to public using (true) with check (true);

-- Replaces every row with one generated history's rows in a single round
-- trip. Execute is restricted to service_role, like reset_e2e().
create or replace function public.reset_query_once_rows(rows jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  truncate table public.query_once_rows;
  insert into public.query_once_rows
    select * from jsonb_populate_recordset(null::public.query_once_rows, rows);
$$;

revoke execute on function public.reset_query_once_rows(jsonb)
  from public, anon, authenticated;
grant execute on function public.reset_query_once_rows(jsonb) to service_role;
