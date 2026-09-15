# Attachment lifecycle oracle

The model records user intent (absent, present, deleted) and accepted bytes. It
does not mirror the SDK's attachment-state machine. Real SQLite transactions,
TanStack collection delivery, local files, and SDK completion writes run under
the tests. Only remote upload completion and failure are controlled.

Each command checks owner references, SQL/collection convergence, accepted file
bytes, and cleanup of every file destination touched by save. Draining checks
remote cleanup and an idle extra tick. Rejected hooks and duplicate saves must
not change the accepted reference or bytes.

The ordinary suite includes a committed corpus, a fixed fast-check campaign,
and a fresh random campaign. To replay a generated failure, run the matching
test with `POWERSYNC_ATTACHMENT_ORACLE_SEED` and, if supplied by fast-check,
`POWERSYNC_ATTACHMENT_ORACLE_PATH`.

## Upstream completion limitation

The SDK currently writes the captured upload record after remote I/O without
preserving a newer `QUEUED_DELETE`. Successful upload can lose the remote delete;
failed upload can restore an obsolete upload for retry. The ordinary generated
suite excludes only deletion while upload is in flight. This is a known gap in
supported behavior, not proof that every lifecycle is correct.

The same model and fixture retain both desired-contract histories and a full
generated schedule in `attachments-sdk-completion.repro.ts`. Run them explicitly:

```sh
pnpm --filter @tanstack/powersync-db-collection test:upstream-repros
```

These are real failing assertions, not expected failures or skipped assertions.
They are separate from the normal gate because the SDK fix is upstream. Once
completion preserves newer intent, move these histories into the normal corpus
and enable in-flight deletion in its generator. Do not weaken the oracle to
accept a detached owner with leaked remote bytes or a resumed obsolete upload.
