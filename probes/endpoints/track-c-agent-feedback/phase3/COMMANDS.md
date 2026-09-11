# Phase 3 commands

Run from repository root. Audit saved traces without making a model call:

```sh
node probes/endpoints/track-c-agent-feedback/phase3/audit.mjs
```

The commands below are the executed native commands, each from its named trial directory. They use normal existing Claude authentication and were run with narrow sandbox escalation. No credential-loading commands or global settings changes were used. Repeating them incurs model usage and overwrites session output; wire logs append. Preserve existing evidence before rerunning.

For a fresh run, restore both synthetic `todo.ts` files to exactly `const order = ['createdAt']` plus one newline. Restore actual `todo.ts` from `../../phase2/fixtures/todo.original.ts` relative to the actual directory. Keep the saved prompt unchanged. The checked-in trial files hold completed edits.

## Control: phase3/control

```sh
TRACK_C_TRIAL=control claude --restricted --tools Read,Edit,LSP --permission-mode acceptEdits --permission-prompts none --setting-sources '' --settings '{"autoMemoryEnabled":false}' --strict-mcp-config --mcp-config '{"mcpServers":{}}' --plugin-dir "$PWD/../plugin" --disable-slash-commands --no-chrome --no-session-persistence --max-budget-usd 1 --output-format stream-json --verbose -p < prompt.txt > ../traces/control-session.jsonl 2> ../traces/control-stderr.txt
```

## Positive: phase3/bash-enabled

```sh
TRACK_C_TRIAL=bash-enabled claude --restricted --tools Read,Edit,LSP,Bash --permission-mode acceptEdits --permission-prompts none --setting-sources '' --settings '{"autoMemoryEnabled":false}' --strict-mcp-config --mcp-config '{"mcpServers":{}}' --plugin-dir "$PWD/../plugin" --disable-slash-commands --no-chrome --no-session-persistence --max-budget-usd 1 --output-format stream-json --verbose -p < prompt.txt > ../traces/bash-enabled-session.jsonl 2> ../traces/bash-enabled-stderr.txt
```

## Actual analyzer: phase3/actual

```sh
claude --restricted --tools Read,Edit,LSP,Bash --permission-mode acceptEdits --permission-prompts none --setting-sources '' --settings '{"autoMemoryEnabled":false}' --strict-mcp-config --mcp-config '{"mcpServers":{}}' --plugin-dir "$PWD/../plugin-actual" --disable-slash-commands --no-chrome --no-session-persistence --max-budget-usd 1 --output-format stream-json --verbose -p < prompt.txt > ../traces/actual-session.jsonl 2> ../traces/actual-stderr.txt
```

The final checker's exact rerun from repository root is:

```sh
/usr/local/bin/node /Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/track-a-analysis/phase2/cli.mjs check --adapter drizzle --file /Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/track-c-agent-feedback/phase3/actual/todo.ts
```

The last command gives an explicit scoped verdict. The native model was forbidden to call it during the automatic-delivery trial. Its passing output is therefore not retroactively counted as model receipt.
