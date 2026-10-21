# Error surface (2026-10-16)

This folder supersedes the health-channel surface in `../HEALTH-CANDIDATE.md` and the
`phase` / `final` error tree. The maintainer chose it after a Field Lab study of how other
libraries separate loading errors from errors after data is shown.

- `RULES.md`: the frozen rules (grammar v4) and invariants. This is the contract the
  implementation follows.
- `ErrorSurface4.tla`, `cfg/`, `tlc-results.tsv`: the TLA+ model of those rules, its safe
  configuration, and twelve weakened controls, each of which fails at its target.
  Run from the field-lab skill root: `scripts/tlc <this dir> -deadlock -config cfg/safe.cfg ErrorSurface4`.
- `readout.md`: what the model checks and what it does not.
- `user-docs-draft.md`: the developer-facing guide written against the rules before
  implementation.

Decisions, in short:

1. `status` answers "can the data be shown": `idle | loading | ready | error | crashed |
   cleaned-up`, one flag per value (`isLoadingError`, `isCrashed`, ...). After a query has
   shown data, only a crash changes its status. `isError` is deprecated.
2. `errors` answers "is the data still kept current". Each node carries `failureReason`
   (the adapter still tries) or `error` (it stopped), like TanStack Query. `isSyncError` is
   `status === 'ready'` and any problem in the tree. Every Collection has `errors` and
   `errors:change`; the `health` names are gone.
3. Adapter calls: `markReady()`, `reportError(e)`, `fail(e)`, `reportHealthy()`. A call that
   does not fit the state machine throws; `reportHealthy()` with nothing wrong is a no-op.
4. `reload()` starts a new sync run like a sync-side truncate: nothing visible changes until
   it commits or fails. It returns the in-flight promise when called again, throws on
   `crashed`, and works during `loading` and after `error`. A live query's `reload()`
   reloads its failed sources.
5. `cleanup()` throws while the Collection has subscribers; `subscribers` lists them and
   `cleanup({ dependents: true })` cleans them up first. A crash is not recovered in
   place; recovery is a cascade cleanup and a fresh start.
6. Persisted Collections join the same model: a synced disk restore opens the gate, a
   failed remote waits for the restore, remote problems after that are reported, and a
   failed restore is a crash. `persistedStatus`, `isPersistedReady`, and `persistedError`
   are removed.
