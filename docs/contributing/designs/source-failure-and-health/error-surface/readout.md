# Design grammar readout: TanStack DB error surface, run 4 (2026-10-16)

Exploratory run against frozen grammar v4 (`frozen-grammar.md`), which encodes the user's
decisions: TanStack Query-style `failureReason` / `error` per node; adapter verbs
`reportError` / `fail` / `reportHealthy`; `reload()` keeps everything visible until its new
run commits or fails (status 'error' stays 'error'); reload during a reload returns the same
promise; reload on 'crashed' throws; reload during 'loading' is allowed; failed requests are
re-issued; `cleanup()` refuses subscribers; persisted restore opens the gate, waits for the
restore before a loading error, and reports remote problems after.

## What this tells us
Under v4 the app can always choose one fix from what it sees (wait, retry the action,
reload, recreate) across 10,516 states of one query over a persisted and an on-demand
source. Twelve deliberate weakenings each fail at their target: one error field instead of
two, a hidden reload, silent remote failure behind disk rows, `reportHealthy` clearing a
stopped node, no stale-run fence, empty restore opening the gate, reload on a crashed
Collection, reload blanking rows, reload showing 'loading' over 'error', cleanup with
subscribers, a failed reload becoming a loading error, and a query 'error' that never clears.

## What it changes
- The TanStack Query split replaces `retrying`/`final`: `failureReason` = wait,
  `error` = reload. One error field cannot carry that (control OneErrorField).
- A query's 'error' clears without its own reload once its sources are ready again through
  reloads; `query.reload()` is a convenience that reloads its failed sources.
- A crash is not recovered in place; recovery is cascade cleanup and a fresh start.

## What it does not tell us
- **F1 (decided: b):** a query in 'error' leaves it for 'loading' once no source has a
  failure (for example D's reload committed while P is still on its first load), then
  becomes 'ready'. A source still reloading keeps its 'error' gate, so a reload never shows
  'loading' in place of 'error'. Retries before a first ready belong inside the adapter
  (query-db's retry or the queryFn), so this window should be rare.
- Scope: one query, two sources; no Effects, includes, nested queries, tabs; no liveness.
- The remedy table is analyst-written; no reader evidence for v4 names.
- Run 3's B3 result was weaker than reported: an encoding bug disabled reload whenever a
  request had failed. Fixed here; re-issue now exercised.

## Concrete case
Backend down at startup: query 'error', D's node `error`. The app calls `query.reload()`
every 30 s; the node shows `reloading` and status stays 'error' with no flicker. When the
backend returns, the commit lands and the query becomes 'ready'.

## Evidence
safe (with F1 b): pass, 10,560 distinct states; f1 check passes (TLC 2.19). Controls: summary.tsv. F1: cfg/f1.cfg,
out/f1.out. Encoding receipts: two (Settle/Reload double assignment of req; stuck query
error after a direct source reload), both noted above.
