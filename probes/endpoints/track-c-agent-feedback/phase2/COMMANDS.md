# Phase 2 runnable commands

Run from the repository root unless a `cd` is shown. These probes use the installed Node and Claude versions recorded in REPORT.md. Native-session commands authenticate through Claude's normal host flow; they were each run with narrowly scoped host escalation. They do not install the session plugin or MCP configuration. Do not run credential-loading commands to make them work.

## Local checks (no model calls)

```sh
node --test probes/endpoints/track-c-agent-feedback/phase2/delivery.test.mjs
node probes/endpoints/track-c-agent-feedback/phase2/audit-observations.mjs
```

The first command rewrites only `fixtures/todo.test.ts`, `fixtures/stale-report.json`, and the local delivery trace. The audit reads saved native-session evidence.

Rejected naive-consumer baseline (expected failure):

```sh
TRACK_C_NAIVE_CONSUMER=1 node --test probes/endpoints/track-c-agent-feedback/phase2/delivery.test.mjs
```

The original error/race failures are saved under `traces/revision-error-red.*`; do not reintroduce bugs to recreate those records.

## Native MCP repair trial

Before a new repair trial, copy `fixtures/todo.original.ts` to `agent/todo.ts` and choose new trace output names if preserving the recorded run. The MCP server appends to `traces/mcp-real-wire.jsonl`.

```sh
cd probes/endpoints/track-c-agent-feedback/phase2/agent
claude --restricted --tools Read,Edit --permission-mode acceptEdits --permission-prompts none --allowedTools mcp__endpoint__check_endpoint --setting-sources '' --settings '{"autoMemoryEnabled":false}' --strict-mcp-config --mcp-config "$PWD/mcp.json" --disable-slash-commands --no-chrome --no-session-persistence --max-budget-usd 1 --output-format stream-json --verbose -p < prompt.txt > ../traces/claude-real-mcp-session.jsonl 2> ../traces/claude-real-mcp-stderr.txt
```

`agent/mcp.json` pins the absolute Node/server path. A checkout on another machine must regenerate that path. The tool can inspect only the configured fixture, not an arbitrary caller path.

## Native MCP stale and unsupported trial

`states/todo.ts` is a separate unsupported limit fixture. Its MCP config selects this fixture through the server's fixed `states` mode. No repair-file reset is needed.

```sh
cd probes/endpoints/track-c-agent-feedback/phase2/states
claude --restricted --tools '' --permission-mode dontAsk --permission-prompts none --allowedTools mcp__endpoint__check_endpoint --setting-sources '' --settings '{"autoMemoryEnabled":false}' --strict-mcp-config --mcp-config "$PWD/mcp.json" --disable-slash-commands --no-chrome --no-session-persistence --max-budget-usd 1 --output-format stream-json --verbose -p < prompt.txt > ../traces/claude-mcp-states-session.jsonl 2> ../traces/claude-mcp-states-stderr.txt
```

## Native LSP trial

The command form below was used for all three runs. Trial 1 read `prompt.txt` with the original one-line synthetic fixture. Trial 2 read `prompt-delayed.txt` after trial 1; both used `.lsp.json` pointing to `server.mjs`. Trial 3 restored the actual `fixtures/todo.original.ts` into `claude/todo.ts`, read `prompt-delayed.txt`, and changed `.lsp.json` to `actual-server.mjs`. Current `.lsp.json` retains the actual server; historic configs are `traces/synthetic-lsp-config.json` and `traces/actual-lsp-config.json`.

```sh
cd probes/endpoints/track-c-agent-feedback/phase2/claude
claude --restricted --tools Read,Edit,LSP --permission-mode acceptEdits --permission-prompts none --setting-sources '' --settings '{"autoMemoryEnabled":false}' --strict-mcp-config --mcp-config '{"mcpServers":{}}' --plugin-dir "$PWD/plugin" --disable-slash-commands --no-chrome --no-session-persistence --max-budget-usd 1 --output-format stream-json --verbose -p < prompt-delayed.txt > ../traces/claude-actual-lsp-session.jsonl 2> ../traces/claude-actual-lsp-stderr.txt
```

The server appends `traces/claude-lsp-wire.jsonl`; each recorded run renamed it to `claude-first-edit-lsp-wire.jsonl`, `claude-delayed-lsp-wire.jsonl`, or `claude-actual-lsp-wire.jsonl`. Use new filenames/reset the server trace to keep trials separate. Model reruns may differ; saved negatives are observations, not guaranteed outcomes.

## Fresh Codex CLI repair

The coordinator spawned a fresh agent with `fork_turns:none` and the exact text in `codex/prompt.txt`. It requested the analyzer command itself and changed only `codex/todo.ts`. The coordinator's result is preserved in `codex/observation.json`; it is not a native Claude/MCP transcript.
