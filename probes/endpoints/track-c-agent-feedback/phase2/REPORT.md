# Phase 2: real findings reach agents through CLI and MCP

**The actual Track A analyzer now drives two successful agent repair paths: a fresh Codex agent through CLI output, and a fresh Claude Code session through a native MCP tool.** A separate native MCP session distinguished stale input from unsupported source. Automatic native LSP receipt was **not observed** in three bounded Claude trials, despite recorded diagnostic publications. These are measured paths and limits, not a selected universal integration architecture.

Phase 1 is preserved in `../REPORT.md` and its traces. Phase 2 adds real analysis; it does not make the analyzer's disposable schema or narrow fixture grammar a deployed application check.

## Executed results

| Boundary / test | Result | Evidence |
|---|---|---|
| Real Drizzle/PG analyzer → versioned delivery | PASS | `traces/real-delivery.json`: original violation; two-line source shift moves range and changes hash; exact repair clears; `.limit(1)` returns `not checked`; stale report refused; missing source remains error |
| Naive array-only consumer | RED, rejected baseline | `traces/naive-consumer-red.tap`: it accepts old findings against new source instead of identifying stale state. This was a deliberately naive integration baseline, not a production implementation |
| Error classification regression | RED → GREEN | Initial consumer changed a hashless missing-source error into stale. Test now requires `error`; fixed before revision comparison |
| Preflight/check-read race regression | RED → GREEN | Injected runner changes source after the preflight hash and before invoking the **real checker**. Returned revision must match requested revision; otherwise no repairable finding is delivered. `traces/revision-error-red.tap` and `.json`, then `traces/real-delivery.tap` |
| Fresh Codex CLI request → repair → exact rerun | PASS, coordinator-observed | `codex/prompt.txt`, `codex/observation.json`, `codex/todo.ts`. Agent requested findings itself, checked source hash, appended tie-breaker, reran exact returned command |
| Fresh Claude native MCP request → repair → recheck | PASS, directly observed | `traces/claude-real-mcp-session.jsonl`, `traces/mcp-real-wire.jsonl`: tool → Read → Edit → tool; violation then supported |
| Claude native MCP stale / unsupported comprehension | PASS, directly observed | `traces/claude-mcp-states-session.jsonl`, `traces/mcp-states-wire.jsonl`: two tool calls only; stale request then current source `not checked`, no edits |
| Native Claude LSP: single edit, synthetic producer | RECEIPT NOT OBSERVED | Server initialized and published a marker absent from prompt/source. Model reported no diagnostics; no marker in visible model/tool transcript |
| Native Claude LSP: two edits and intervening read, synthetic producer | RECEIPT NOT OBSERVED | didOpen, didChange and didSave generated publications. Only Read/Edit calls; model again reported none |
| Native Claude LSP: two edits, actual analyzer | RECEIPT NOT OBSERVED | Real analyzer emitted source-located rule, source hash and schema evidence. Server omitted version/data fields the client did not support. Model still reported none |
| Idle wake-up | NOT TESTED | No scheduler, hook, monitor or controller was attached to compiler updates |
| IDE display / native LSP in other products | NOT TESTED in phase 2 | Phase 1 compatibility matrix and editor-access limits remain |

The delivery suite passes **2/2** tests. Recorded-trial audit passes **3 LSP negative observations and 2 MCP positive observations**. The audit checks recorded evidence; it does not rerun models or assert visibility into all hidden context.

## Actual analyzer and repair evidence

Both repair agents began with source hash:

```text
79155d5bba7da342e54c8810bd05484496f31beb6f5e115063fc8fda764c9268
```

The actual diagnostic was `ENDPOINT_ORDER_NOT_TOTAL`, zero-based line 10, character 7 through 35. It proposed insertion `, asc(todo.id)` at source offset 503, guarded by source hash. The agents changed:

```diff
-      .orderBy(asc(todo.createdAt))
+      .orderBy(asc(todo.createdAt), asc(todo.id))
```

Both resulting source files hash to:

```text
d4d9c62e3f010df5c71afb37c28fa7a6de858188e626931b8f3c19c50fd2099a
```

Rechecks returned `supported`, `SQL_KEY_ORDER_SUPPORTED`, `totalSqlOrder:true`, no diagnostics, exit 0. Evidence identifies `disposable-public-todo`, schema fingerprint `b489926566b7ad448726cd8fdff5c5fe1b03c297d81f7c3821ca9715f021589c`, and PostgreSQL's `todo_pkey` unique index. The actual checker uses trusted fixture bindings and its own disposable PGlite schema. It does not establish deployed schema identity, auth semantics, wire types, UI order, or ID immutability.

The Codex worker explicitly verified the original hash and executed the returned CLI command. Claude received hashes in MCP reports, read and edited the matching file, and rechecked through MCP; its tool transcript contains no separate hash-calculation command because shell access was excluded. Do not upgrade that observation into an independently computed hash check by Claude.

The second MCP session used a separate `.limit(1)` fixture, leaving repaired files intact. A requested old hash returned `stale` / `SOURCE_REVISION_CHANGED` with no diagnostics. The next current-source call returned `not checked` / `SOURCE_NOT_CHECKED` with an unsupported-chain reason. Claude explicitly explained that neither established the rule and that the empty stale result was not a clean check. The current unsupported source hash is `0a2206ae6179fe3f84fb5384c138de93cf70055edc1622232fc6b0a6b2d23502`.

## Native LSP trial design and limits

Claude's official documentation describes post-edit diagnostics when a code-intelligence plugin and its language server are present. Plugins can provide a `.lsp.json` mapping, and the local CLI supports session-only `--plugin-dir`. These claims justified testing this path; they did not predetermine success. [Claude code intelligence](https://code.claude.com/docs/en/discover-plugins), [plugin LSP reference](https://code.claude.com/docs/en/plugins-reference), [CLI reference](https://code.claude.com/docs/en/cli-reference)

Each trial used a fresh noninteractive Claude session, an explicit local plugin, Read/Edit/LSP as the available built-in tools, and a prompt forbidding LSP/diagnostic requests. Observed calls were **only Read and Edit**. The first prompt requested a blank-line edit; the second requested a comment edit, an intervening read, then another blank-line edit. The third reused the second prompt with the actual analyzer and actual Drizzle fixture. Exact prompt files and configuration snapshots are preserved.

The synthetic marker `C2_NATIVE_LSP_4c671efb` existed only in the server diagnostic, not the source or prompt. In the actual trial, `ENDPOINT_ORDER_NOT_TOTAL` and the schema evidence came only from the analyzer publication. Wire logs establish successful native Claude language-server initialization and publication, including didChange/didSave in the longer trials. All three visible transcripts lacked the diagnostic marker/rule, and all three final messages reported no received diagnostics.

That is **bounded negative evidence for this print-mode configuration**, not proof that Claude never delivers LSP diagnostics. Streamed transcripts may omit hidden context internals. The first publication followed the Edit result, suggesting a timing question; the extra read/edit trial did not resolve the cause. No interactive CLI, IDE session, installed marketplace language server, or other host configuration was tested. The third trial also changed producer and optional-field handling, so it does not isolate the effect of either change.

The observed client advertises `publishDiagnostics.versionSupport:false` and `dataSupport:false`. The real adapter therefore retains source hash and check state in the diagnostic message, not solely optional fields. This is a useful adapter constraint, even though model receipt was not observed. LSP's replacement/clearing semantics alone do not establish model-context behavior. [LSP 3.17 publishDiagnostics](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.17/language/publishDiagnostics.md)

## Versions, commands, and provenance

- Node `v22.13.1`; Claude Code `2.1.265`; native sessions reported model `claude-opus-5[1m]` (message model `claude-opus-5`). Model selection used the installed default; it was not overridden.
- Actual analyzer: Drizzle `0.45.1`, PGlite `0.3.14`, Babel parser `7.28.5`, pgsql-ast-parser `12.0.1`; PostgreSQL `17.5` from the engine. The analyzer's package lock and source-file hashes are in `traces/analyzer-source-revisions.json`.
- MCP server protocol subset `2025-06-18`, server `0.2.0`; native Claude initialization/tools/list/tools/call are captured. This proves these host interactions, not full MCP protocol conformance.
- Session-only LSP plugin/server `0.2.0`, LSP `3.17` subset; exact client capabilities are preserved.
- Five bounded Claude calls reported total usage cost `$0.389628`. Each call had a `$1` cap. Normal existing host authentication worked; no credentials were read or loaded by probe code. No host-wide settings, hooks or plugin installations were changed.

From repository root:

```sh
node --test probes/endpoints/track-c-agent-feedback/phase2/delivery.test.mjs
node probes/endpoints/track-c-agent-feedback/phase2/audit-observations.mjs
```

See `COMMANDS.md` for exact native-session command forms and fixture/reset requirements. Model transcripts, server wire logs, test outputs, red failures, source revisions and prompts remain under this phase's directory.

## Remaining decision

CLI and MCP now have measured value with the real bounded analyzer. Automatic LSP needs a host/surface-specific explanation or another controlled environment before relying on it for compiler-to-agent feedback. An issue store or protocol notification still cannot serve as evidence of idle wake-up. No hooks or host input API were chosen as a fallback architecture, and no combined Endpoints framework was built in this track.
