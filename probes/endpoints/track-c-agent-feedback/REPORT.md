# Track C: diagnostic delivery and repair

The bounded result is an explicit CLI-to-agent-to-repair loop. The coordinator received a synthetic source-located diagnostic through its shell tool. A fresh agent, given that diagnostic explicitly, checked its hash, made the small repair, and reran the supplied command successfully. This does **not** establish automatic LSP delivery, native MCP host receipt, database analysis, or an integrated Endpoints Todo.

Research date: 2026-09-10. Workspace: `/Users/kylemathews/.codex/worktrees/e079/tanstack-db`; base revision `68366ecaeef6c12a13402b558bd4a68d7519442f`. The old checkout in the brief was not edited. All implementations below are disposable Track C fixtures, independent of Track A/B.

## Compatibility matrix

**Documented** means an opened official source supports that precise claim. **Unknown** means this bounded research did not establish it; it is not a claim of absence. **Observed** means a local execution trace or coordinator receipt exists. A CLI check is a request/response fallback, not native LSP support. Current docs are not version-pinned release contracts.

| Product / surface | Editor or client receives/displays LSP diagnostics | Agent can explicitly read diagnostics | Automatic active model-context delivery | Diagnostic update starts idle work |
|---|---|---|---|---|
| Codex CLI, local `0.144.4` | Native LSP not established by inspected local package README or official IDE docs | CLI checker is available; standalone Codex CLI model run not tested; native diagnostic tool unknown | Native LSP unknown; configured hooks are a separate documented path | LSP unknown; background hooks explicitly wait for a later user turn [hooks](https://learn.chatgpt.com/docs/hooks) |
| Codex VS Code extension | Editor context is documented; that does not establish diagnostic sharing | CLI/MCP request paths are distinct; native LSP request not established | Unknown; open-file/selection context does not prove it | Unknown [IDE docs](https://learn.chatgpt.com/docs/codex/ide) |
| Codex desktop task (this environment) | Isolated editor probe did not yield a trace | Coordinator actually received CLI JSON through a shell tool | No automatic LSP/MCP injection tested | No diagnostic-triggered wake-up tested |
| Claude Code local CLI, installed `2.1.265` | Native plugin language server reports diagnostics to Claude; human can inspect the diagnostic indicator | Code navigation tool documented; an explicit diagnostic-pull operation is not specified on this page; CLI check remains available | **Documented after Claude's own file edits**, with code-intelligence plugin and language server installed | Unknown; post-edit feedback does not imply arbitrary background pushes or idle wake-up [plugins](https://code.claude.com/docs/en/discover-plugins) |
| Claude Code in VS Code | IDE/CLI diagnostic sharing documented; extension or `/ide` connection needed | Sharing documented, precise pull API not established here | Do not infer timing from sharing; local plugin contract above is narrower | Unknown [VS Code integration](https://code.claude.com/docs/en/vs-code) |
| Claude Code cloud / desktop | Cloud sessions explicitly do not start plugin language servers; local desktop not tested | Cloud plugin LSP tool unavailable; desktop diagnostic pull unknown | Cloud plugin LSP unavailable; desktop not established | Unknown [plugin surface limit](https://code.claude.com/docs/en/discover-plugins) |
| Cursor IDE, installed `3.2.21` | Local implementation reads editor markers, including source/range; no running diagnostic trace | `READ_LINTS`/`ReadLintsResult` and marker-reading code present in installed bundle; enabled tool/model receipt **not tested** | Current fetched docs do not establish arbitrary custom-LSP injection; old “Iterate on Lints” search snippet redirected and was not admitted as evidence | Unknown; ordinary attached terminal context is explicit input [prompting](https://cursor.com/docs/agent/prompting) |
| Cursor CLI (`32c684dc5c8a0e364043db77d4e5b9a5dc1e2d3b`) / Agents Window | CLI native LSP diagnostic contract not established; do not transfer IDE behavior | Explicit tool/terminal context is a distinct path; custom diagnostic retrieval not tested | Unknown | Unknown [surface context](https://cursor.com/docs/agent/prompting) |
| GitHub Copilot in VS Code, editor `1.133.0` | Problems panel is the editor source used by the documented tool | **Documented `#read/problems`** adds workspace problems as context; users can also attach a problem | Explicit retrieval does not establish unconditional push of every new custom diagnostic | Unknown [official feature reference](https://raw.githubusercontent.com/microsoft/vscode-docs/main/docs/copilot/reference/copilot-vscode-features.md) |
| GitHub Copilot CLI / desktop app | Official CLI README includes diagnostics among LSP features; detailed docs list navigation operations | CLI LSP present, but precise diagnostic operation/delivery unclear; desktop not inferred | Automatic LSP navigation selection is documented, not a push-diagnostic guarantee | Unknown [CLI README](https://github.com/github/copilot-cli), [operation list](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/lsp-servers) |

Cursor implementation evidence is pinned by file path and SHA-256 in `traces/cursor-local-source.json`. The inspected helper filters **errors**, so it cannot justify claiming all warning diagnostics are included. This is local implementation evidence, not a public API or successful agent-receipt test.

For Claude, installing a plugin alone is insufficient: the language-server binary must also be available. No plugin or host-wide settings were installed in this investigation. No authenticated Claude/Cursor/Copilot model session was launched, so installed executable versions do not turn documented claims into observed results.

## What ran

| Probe | Result | Evidence and boundary |
|---|---|---|
| CLI initial → changed → clear | PASS | Markers `TRACK_C_INITIAL_17` → `TRACK_C_CHANGED_28` → empty findings; exits `1,1,0`; full source hash and document version in `traces/protocol.json` |
| CLI stale source / execution error | PASS | Stale expected hash returns status `stale`, exit `3`; missing file returns execution error, exit `2` |
| Exact rerun from outside probe cwd | Initially FAIL, then PASS | Coordinator found relative input combined with probe cwd produced doubled path, exit `2` instead of domain failure `1`. Red trace: `traces/red-rerun.json`. Inputs now resolve absolute; rerun uses exact Node executable. Regression executes the returned command and cwd |
| MCP stdio initialize/list/call | PASS, **bounded protocol transcript only** | Minimal handwritten MCP `2025-06-18` subset. Separate process, JSON-RPC requests/responses, structuredContent and text consistency. Not SDK/full conformance; no native product host registered |
| MCP changed/clear/stale/error | PASS | Domain failure is successful tool execution (`isError:false`, report `status:fail`); missing file is `isError:true`. Source/rule/rerun retained |
| LSP initialize + versioned publish/change/clear | PASS, fixture client only | Minimal LSP `3.17`, Content-Length framing, full-document sync, versions 1/2/3. `traces/protocol.json` contains published replacements and final empty set |
| Late v1 after clear v3 | PASS, fixture consumer only | Consumer rejects old version. This is our consumer's behavior, not measured behavior of any product |
| VS Code extension host / editor receipt | NOT TESTED; access blocked | Sandbox launch exited 0 with codesign warning; narrow host launch created isolated profile but no extension trace. CUA inspection failed at service startup. `traces/editor-attempt.json`. No editor display or DiagnosticCollection result can be claimed |
| Native product MCP model receipt | NOT TESTED | Local stdio response was read by a test process; no product configured with this MCP server |
| Root Codex CLI tool receipt | PASS, coordinator-observed | Root reported seeing marker, rule, source hash/range/fix; also caught the rerun bug. Explicit request through current shell tool, not LSP push |
| Fresh-agent comprehension, repair, rerun | PASS, coordinator-observed | Explicit diagnostic supplied by coordinator; original and repaired hashes below. No inference about automatic delivery |
| Idle wake-up / arbitrary compiler background change | NOT TESTED | No watchdog, hook, scheduler, or host API wired to diagnostic updates |

Four Node tests pass. There are no package dependencies or installs. Commands from the repository root:

```sh
node --test probes/endpoints/track-c-agent-feedback/probe.test.mjs
node probes/endpoints/track-c-agent-feedback/cli.mjs probes/endpoints/track-c-agent-feedback/root-receipt.fixture.ts 1
```

The second command deliberately exits `1` for the failing fixture. The suite overwrites only its `traces/todo.fixture.ts` and protocol trace; it does not reset the fresh-agent repair. Exact versions and runtime paths are recorded in `traces/environment.json`.

The isolated editor launch attempted:

```sh
code --new-window --user-data-dir "$PWD/probes/endpoints/track-c-agent-feedback/editor-user-data" --extensions-dir "$PWD/probes/endpoints/track-c-agent-feedback/empty-extensions" --extensionDevelopmentPath "$PWD/probes/endpoints/track-c-agent-feedback/editor" --skip-welcome --skip-release-notes
```

This is a prepared, syntax-checked custom LSP bridge, not a verified editor integration. Its profile directories are ignored. It does not install an extension into the user's normal profile.

## Delivery versus repair

Finding production is **synthetic**: `fixture.mjs` recognizes deliberately chosen strings. It does not inspect Drizzle, PostgreSQL, schema keys, or endpoint applicability. The diagnostic states its assumed non-null primary key rather than claiming database evidence. The fresh agent saw ordinary scoped project instructions and `repair/diagnostic.before.json`, without the producer/test implementation.

The coordinator reports that the fresh agent verified source hash `9d87f46eb9ee5c5d970f0612c77b6028c9f657125f09251badaf71a63c7deb81`, changed only `['createdAt']` to `['createdAt', 'id']`, and executed the exact rerun command. It returned exit `0`, `status:pass`, `findings:[]`; repaired hash `a933dc7bfc25d31406b094b580555edab773fe7a9a88e38f91be9229701a672b`. This is one trivial prompted repair, not a repair success-rate study or stale-edit refusal exercise.

The rerun bug explains why protocol-only tests were falsely green: they always supplied absolute paths, so they never exercised the caller-cwd/returned-cwd boundary. Executing a returned command is a stronger assertion than checking that a command field exists. The added test catches that class of path error.

The next integration must preserve Track A's actual source hash/span, applicability state, database/schema evidence, and stale-edit refusal through whichever transport is selected. A delivery adapter must replace/clear findings by producer and source revision, and keep `unsupported` separate from `pass`. This fixture's empty set proves clearing only; it does not prove all rules passed.

## Alternatives, not chosen architecture

LSP specifies replacement, explicit empty-set clearing, and an optional version field. Those are client protocol rules, not model-context or idle-work rules. [LSP 3.17 clause](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.17/language/publishDiagnostics.md)

MCP tools return requested output; resources and subscriptions describe host-managed data updates. A notification is not proof the host supplied new model input. Full native host testing remains necessary. [MCP tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools), [resources](https://modelcontextprotocol.io/specification/2025-06-18/server/resources)

A **hook** runs a configured script after a host event such as an edit and can attach check output to the next model request. Codex documents `additionalContext`, trust review, and asynchronous delivery timing; background completion does not start an idle turn. None was installed. [Codex hooks](https://learn.chatgpt.com/docs/hooks)

A **host input API** lets a controller deliberately supply a result. Codex App Server documents `turn/start.toolOutput`, which starts a turn or queues output into an active one, while `thread/inject_items` adds history without starting a turn. This could bridge compiler output to work, but would require an explicit controller, revision policy, and measured product test. It was not selected or invoked. [App Server](https://learn.chatgpt.com/docs/app-server)

Rejected assumptions: visible squiggles imply agent receipt; an MCP notification wakes a model; all surfaces of one brand share an LSP bridge; a synthetic pass proves an integrated Todo. The remaining decision is which product/surface to test with the real analyzer before choosing an automatic delivery mechanism.
