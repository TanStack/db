# Phase 3: native LSP findings reach the agent

The earlier negative came from our tool whitelist. In the tested Claude Code **2.1.265** executable, automatic LSP diagnostic attachments are gated on Bash or PowerShell being available. Adding Bash to the available tools made the same synthetic diagnostic reach the model; the model never called Bash or LSP. The actual endpoint analyzer then delivered revision-specific findings automatically, and Claude repaired the source.

This is an installed-version result for the tested noninteractive CLI path, not a guarantee about every Claude product, version, or editor.

## Matched control and real confirmation

| Trial | Available tools | Actual calls | LSP publication | Model receipt | Repair / final status |
|---|---|---|---|---|---|
| Synthetic control | Read, Edit, LSP | Read → Edit → Read → Edit | 3 publications | Marker absent; model reported no diagnostics | Not requested |
| Synthetic positive | Read, Edit, LSP, Bash | Same sequence | 3 publications | Exact server-only marker reproduced | Not requested |
| Actual analyzer | Read, Edit, LSP, Bash | Read → Edit → Read → Edit → Read → Edit → Read | 5 publications, including empty clear | Two actual revision-specific findings reproduced | Added `asc(todo.id)`; checker supported; model verification remained unknown |

The synthetic trials used byte-identical prompts, identical initial source, the same plugin and model (`claude-opus-5[1m]` in initialization; message model `claude-opus-5`). Separate directories and trace destinations kept each run isolated. The only deliberate behavioral change was Bash availability. The prompt forbade commands, LSP calls, and explicit diagnostic requests. Every observed tool call was Read or Edit.

The marker `C3_LSP_GATE_6d8e72a1` existed only in the server diagnostic, not the prompt or fixture. Its exact reproduction, matching the publication and without a diagnostic request, establishes model receipt in this trial. The model reported receiving it after the Read between edits. The public stream does not expose every hidden context attachment, so the transcript supports receipt and the observed sequence, not a complete account of internal scheduling.

Claude documents automatic diagnostics after edits and session-scoped plugin loading. Its CLI reference says `--restricted` removes code-running tools unless explicitly added through `--tools`. The Bash/PowerShell attachment gate was established from this installed executable and the matched trial, not from a documented cross-version promise. [Code intelligence](https://code.claude.com/docs/en/discover-plugins), [CLI flags](https://code.claude.com/docs/en/cli-reference).

## Installed implementation evidence

[Binary identity](traces/installed-binary.json) records executable SHA-256 `164b09eb800dedb9bb06304129fbf07743ab9db972ae07333ef4f18cde0cb8d5`, size 199422144 bytes. [Targeted excerpts](traces/source-gate-evidence.json) preserve byte offsets, Bash/PowerShell aliases, the tool-name matcher, and the collector guard:

```js
async function Dbs(e){if(!e.options.tools.some((n)=>zt(n,ze)||zt(n,Wt)))return[];
```

Here `ze` is Bash and `Wt` is PowerShell. The same evidence file records the import connection and the empty-diagnostic handler. No host configuration, credential file, trusted hook, or credential-loading command was inspected or changed.

## Actual analyzer receipt and repair

The actual plugin calls Track A's phase2 checker through the phase2 delivery module. This is parsed Drizzle source checked against a disposable PostgreSQL schema, not the synthetic marker producer. Each wire trace retains the full checker result, source revision, rule status, schema evidence, assumptions and rerun arguments.

The model received `ENDPOINT_ORDER_NOT_TOTAL` at displayed line 12:8 after the comment shifted the source. The diagnostic explained that `created_at` can tie and that a non-null unique `id` completes the order. It included schema fingerprint `b489926566b7ad448726cd8fdff5c5fe1b03c297d81f7c3821ca9715f021589c` and the `todo_pkey` unique index. The model changed `.orderBy(asc(todo.createdAt))` to `.orderBy(asc(todo.createdAt), asc(todo.id))`.

| Revision | SHA-256 |
|---|---|
| Original actual source | `79155d5bba7da342e54c8810bd05484496f31beb6f5e115063fc8fda764c9268` |
| First received finding | `2a4b8bb5a4a2660ef0c77bddb3600c5f2859e8a4d17db1c8c382dbb07a55ae84` |
| Second received finding | `f552fa4027eab71ac89de39ef09870527368dfc4b0cb3e7a156509f445ec0217` |
| Repaired, supported source | `6c1385ad25c3cc97109fb92139935365bc5c48fb322be662b3758bb3730e9dab` |

The server's final checker result was `supported`, `SQL_KEY_ORDER_SUPPORTED`, `totalSqlOrder: true`, exit 0, with no diagnostics. The final file hash matches that result. The bridge published an empty diagnostic set. **That does not establish model receipt of a passing status.** Claude explicitly kept verification unknown: its last received analyzer verdict concerned the old source. This was correct.

The installed handler skips empty diagnostics when building new diagnostic attachments. LSP defines an empty publication as clearing the prior diagnostics; it does not define an affirmative scoped check result for an agent. An explicit CLI/MCP result remains useful for obtaining that status, as measured in phase2. [LSP replacement and clear semantics](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.17/language/publishDiagnostics.md).

## Reproduce and inspect

[COMMANDS.md](COMMANDS.md) preserves the three native commands and reset instructions. [audit.mjs](audit.mjs) checks the saved observations without a model call. It verifies equal control prompt/source/model, the tool-list difference, tool-call restrictions, marker receipt, actual repair, and the final checker revision. [audit.json](traces/audit.json) includes all trial summaries and the final full checker result.

Raw evidence: [control session](traces/control-session.jsonl), [control wire](traces/control-wire.jsonl), [positive session](traces/bash-enabled-session.jsonl), [positive wire](traces/bash-enabled-wire.jsonl), [actual session](traces/actual-session.jsonl), [actual wire](traces/actual-wire.jsonl). Exact prompts are in each trial directory. Stderr files are preserved and empty. Total reported model cost was $0.3740935, with a $1 budget cap per run.

Versions: Claude Code 2.1.265; Node v22.13.1; plugin 0.3.0; actual checker uses Drizzle 0.45.1, Babel parser 7.28.5, pgsql-ast-parser 12.0.1, PGlite 0.3.14 and PostgreSQL 17.5. The PostgreSQL schema and trusted fixture bindings are local probe assumptions. No deployed endpoint, auth, UI, or identifier immutability claim follows.

## Limits and remaining distinctions

- **Pass:** native active-turn automatic findings reach the model; actual source repair; analyzer passes and wire clears.
- **Negative control:** the original Read/Edit/LSP-only whitelist suppresses observed model receipt despite publication.
- **Not established:** model receipt of an affirmative passing verdict after clear; idle wakeup; a next-user-prompt-only trigger; editor display; other versions or products.
- Merely publishing while idle is not evidence that work wakes. These trials ran during an existing model turn.
- Plugin diagnostics can be disabled, and extension registration can select another server. Those are documented configuration boundaries, not variables changed in these trials. [Plugin reference](https://code.claude.com/docs/en/plugins-reference).

The phase2 negative remains valid for its exact setup. Phase3 identifies and controls the setup constraint; it does not retroactively label those runs successful.
