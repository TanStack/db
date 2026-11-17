# Query sync-write protocol comparison

The final changed-callback audit's M1334 comparison gap is closed by observing
the actual Query adapter sync-write input. Production source was unchanged
through this experiment. This record supplements the original
[gap audit](2026-11-10-query-changed-callback-gap-audit.md); it does not rewrite
that audit's historical survivor result or close its other candidates.

The working tree's base HEAD was `0e86c1fdae85520aff142f141f71ccf46a8ee8bd`.
The adjacent [JSON evidence](2026-11-10-query-sync-write-protocol.json) records
the exact source and receiving-file hashes, runner, commands, reach counts,
and complete output for the six final executions below.

## Law and boundary

`SyncConfig.sync` receives `write(message: ChangeMessageOrDeleteKeyMessage)`.
`ChangeMessage.type` is required and `OperationType` is `insert | update |
delete`; the delete-key form also requires `type: 'delete'`. Authority:
[SyncConfig](../../reference/interfaces/SyncConfig.md),
[ChangeMessage](../../reference/interfaces/ChangeMessage.md),
[ChangeMessageOrDeleteKeyMessage](../../reference/type-aliases/ChangeMessageOrDeleteKeyMessage.md),
and [OperationType](../../reference/type-aliases/OperationType.md).

The comparison checks each raw `message.type` observed at the Query adapter's
actual `write` invocation, before forwarding the same message to persistence.
Only the three API operation values pass. It does not infer an operation from
the row result, normalize a missing value, or require an own property. A
receiver that happens to produce correct rows from an undeclared operation
does not make that producer input valid.

The existing primary ownership judgment and its merge model are unchanged.
The added judgment is a small protocol predicate; it copies no production
diff or ownership machinery. It requires no number or order of writes.
Existing public/durable row comparisons remain in the same ordered trace.

## Generated reach

The new declared state `fetched-row-write` means that a row-bearing write for
the direct key crossed this boundary after the physical fetch returned. It
does not require a particular operation: a legal delete/insert strategy may
reach it too. The protocol comparison independently judges the operation.

The existing retained construction guarantees a distinct saved key, an accepted
direct write before fetch, a returned direct key, and differing direct/source
values. Its fresh objects now owe this additional observed state. The per-object
ledger also enforces generated constructions, and missing-state calibrations
reject omission of each declared state. The 96 fixed inputs, 12 constructions,
40-history run budget, other builders, and receiving hosts are retained.
Fixed inputs receive no generated reach credit.

Each column below is a full normal campaign. Fixed campaign seed is `563`.

| Declared state | Controlled fixed/fresh | Node SQLite fixed/fresh | Chromium OPFS fixed/fresh |
| --- | ---: | ---: | ---: |
| raw | 26 / 24 | 26 / 29 | 26 / 22 |
| derived | 26 / 28 | 26 / 23 | 26 / 30 |
| retained | 25 / 26 | 25 / 28 | 25 / 22 |
| no-retention | 27 / 26 | 27 / 24 | 27 / 30 |
| before-fetch | 32 / 28 | 32 / 32 | 32 / 30 |
| after-fetch-start | 20 / 24 | 20 / 20 | 20 / 22 |
| source-includes-direct | 31 / 28 | 31 / 28 | 31 / 28 |
| source-omits-direct | 21 / 24 | 21 / 24 | 21 / 24 |
| no-retention-direct-after-fetch | 13 / 14 | 13 / 10 | 13 / 16 |
| retained-direct-before-returned-key | 7 / 5 | 7 / 6 | 7 / 5 |
| fetched-row-write | 31 / 27 | 31 / 22 | 31 / 20 |
| overlapping-saved-direct-key | 23 / 22 | 23 / 16 | 23 / 15 |
| distinct-saved-direct-key | 29 / 30 | 29 / 36 | 29 / 37 |
| returned-value-equals-saved-after-direct-change | 2 / 2 | 2 / 4 | 2 / 3 |

## RED, GREEN, and mutant

The audited operator is `src/query.ts#applySuccessfulResult:field-drop:write
( { type : update , value : newItem } )`, M1334 at byte offset `97728`, line
`2756`, on source SHA256
`1a794774e60d3c1dbacd515d0350b048557714adf80d6e3b9d42e7250841754b`.
The immutable Vite transform removes exactly ``type: `update`, `` at that
verified span. The comma/space removal preserves valid syntax; the semantic
edit is the audit's exact field deletion. Transformed SHA256 is
`8a1ffc1dbc0f37839b81a9faab2b21e0f253bc8accbc649b92117de5934216e0`.
The browser transform logs that the actual page imported the changed source.
No live production file was edited.

| Execution | Result |
| --- | --- |
| Clean controlled + native Node SQLite, complete direct suite | 244 passed; both fixed/fresh campaigns and all calibrations |
| Clean actual Chromium + worker SQLite/OPFS, complete direct suite | 122 passed; fixed/fresh campaigns and all calibrations |
| Exact M1334 replay, controlled + native Node SQLite | 2 assertion failures at `sync-write` / `declared sync-write operation` |
| Same clean replay, controlled + native Node SQLite | 2 passed |
| Exact M1334 replay, actual Chromium/OPFS | 1 assertion failure at the same checkpoint and law |
| Same clean replay, actual Chromium/OPFS | 1 passed |

All replays use campaign seed `563`, shrink path `15:0:0:0:0:0`:

```json
{"shape":"raw","retained":true,"write":"before-fetch","operation":"insert","includesDirect":true,"keepsSaved":false,"directValue":0,"sourceValue":1,"savedValue":0,"overlapsSaved":false}
```

The intended assertion reports `observed undefined`. These are comparison
failures, not setup errors, timeouts, or incidental crashes. The calibration
`omits the declared sync-write operation` also corrupts a real captured
observation and proves the shared comparison rejects it. Scoped strict
TypeScript and ESLint both passed. The final
`pnpm --config.verifyDepsBeforeRun=false lint:changed` also passed.

An earlier property-only selector lacked the required seed/path and failed
configuration. An initial browser attempt failed to bind its local server
inside the sandbox. Neither is product evidence. The final browser runs used
the ordinary authorized local-server permission and completed.

## Rubric outcomes and limits

| Requirement | Evidence |
| --- | --- |
| ORC-001 | Required public sync input discriminant; authority and partial scope above. |
| ORC-002 | API membership predicate independent of Query's diff/classifiers; existing merge model unchanged. |
| ORC-003 | Law, boundary recorder, comparison and reach prose live beside their executable definitions. |
| ORC-004 | Existing raw/derived, retention, order, inclusion, overlap and numeric grammar retained. The replay reconstructs M1334. Removing the changed-value/retained construction loses guaranteed result-time row-write reach; equal/unequal values and both orders remain neighbors. Overlapping insert histories remain rejected as illegal. |
| ORC-005 | Raw operation captured before unchanged forwarding; each host reaches the actual result-time write. No missing-input hypothesis is needed: the producer supplies the operation at this boundary. |
| ORC-006 | Exact field-drop rejected on three hosts, plus wrong-observation calibration; outcome classifications above. |
| ORC-007 | Same property, grammar, run budget, recorder and comparison run fixed/fresh on each host; exact seed/path replay tested RED and GREEN. |
| ORC-008 | No stateful reference-model change; not applicable. |
| ORC-009 | `sync-write` is one public change-message invocation. `fetched-row-write` combines fetch return with a later row-bearing change message; the mapping is explicit beside the recorder. |
| ORC-010 | Ordered-prefix comparison retains the earlier protocol violation; existing cleanup and browser diagnostic handling retained and calibrated. |
| ORC-011 | No shared semantic-fault hypothesis requiring a second formulation was identified; not applicable. |
| ORC-012 | This versioned record and exact fingerprints bound the claim. Other audit survivors remain open. |
| ORC-013 | Missing versus declared operation in the same history distinguishes the API requirement; the whole insert/update/delete union remains allowed. |
| ORC-014 | Controlled storage, native SQLite, and real Chromium/OPFS share the same histories and judgment. Each runs the physical-fetch/write premise. |
| ORC-015 | All fourteen declared states reached in all six campaigns; constructed and generated missing-state controls passed. |
| ORC-016 | Fixed histories and calibrations use the shared driver/model/check. No ordinary example assertions were added to the oracle. |

This closes the missing-operation comparison gap within the existing first-eager
direct-write grammar and three receiving paths. It does not validate every sync
message field, transaction pairing, write count/order, arbitrary mutations,
failed I/O, peers, or concurrent writers. These added observations do not retire
any existing row law or grant an allowance for another surviving mutant.

The independent final review accepted the authority, raw boundary observation,
unchanged row model, generic reach, and three-host evidence. Its one earlier
concern was resolved by removing the operation-specific reach condition, so a
legal delete/insert strategy does not fail the declared-state obligation.
