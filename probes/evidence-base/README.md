# Evidence base prototype

A local evidence engine for structured software claims. The engine keeps
versioned observations, evaluates domain-owned argument rules, preserves open
counterexamples and exposes the same operation layer through a CLI, an LSP
server and an MCP server.

The first production-shaped package is the Endpoints
`endpoints/safe-skip-refetch@1` claim. Its check calls the extracted
`canSkipRefetch` function used by the Endpoints prototype. The bounded package
and its Oracle Guide card are in [DESIGN.md](DESIGN.md).

This remains a prototype. A supported claim means that a registered procedure
accepted current evidence within its declared boundary. It does not prove the
procedure or SQL analyzer universally sound, and it does not enact refresh
policy.

## Run and verify

Use Node 22.13 or later. Runtime code and tests have no package dependencies;
strict typechecking additionally requires TypeScript.

From this directory:

```sh
npm test
npm run test:faults
npm run test:handoff
npm run typecheck
```

From the repository root, the equivalent direct commands are:

```sh
node --experimental-strip-types --test probes/evidence-base/kernel.test.mjs probes/evidence-base/rebuild.test.mjs
node probes/evidence-base/fault-controls.mjs
node probes/evidence-base/verify-handoff.mjs
tsc --project probes/evidence-base/tsconfig.json
```

The complete suite currently has 21 tests: 14 kernel/oracle tests and seven
rebuild tests. Eight mutations of temporary production-code copies must fail at
the intended oracle assertion.

## Shared operations

`service.mjs` is the single operation layer used by every transport:

- `init`: create a verified store.
- `status`: summarize observations, dependencies and open challenges.
- `assess`: evaluate one exact structured claim.
- `runEndpoints`: execute and record the real Endpoints decision check.
- `context`: register current dependency fingerprints.
- `history`: return observations and challenge history.
- `resolve`: link an open challenge to a causally later, applicable replay.

Requests within one service process are serialized. Writes use a temporary file
and atomic rename. Separate processes are not coordinated by a file lock.

## CLI

```sh
node --experimental-strip-types probes/evidence-base/cli.mjs --store /tmp/endpoints-evidence.json init
node --experimental-strip-types probes/evidence-base/cli.mjs --store /tmp/endpoints-evidence.json status
node --experimental-strip-types probes/evidence-base/cli.mjs --store /tmp/endpoints-evidence.json run-endpoints @case.json
node --experimental-strip-types probes/evidence-base/cli.mjs --store /tmp/endpoints-evidence.json assess @claim.json
```

JSON arguments may be inline, loaded with `@FILE`, or read from stdin with `-`.
Run `cli.mjs --help` for the full command list. Parse, file, validation and
service errors are reported on stderr with a nonzero exit status.

## LSP

```sh
node --experimental-strip-types probes/evidence-base/lsp-server.mjs --store /tmp/endpoints-evidence.json
```

The server uses standard `Content-Length` framed JSON-RPC on stdin/stdout. An
opened JSON document must contain `{ "claim": { ... } }`; the server publishes
an error for contradicted claims, a warning for unresolved claims and no
diagnostic for supported claims. It also exposes `evidence.request` through
`workspace/executeCommand`. Incoming messages are processed serially.

## MCP

```sh
node --experimental-strip-types probes/evidence-base/mcp-server.mjs --store /tmp/endpoints-evidence.json
```

The MCP server uses newline-delimited JSON-RPC on stdin/stdout and advertises
tools for status, assessment, Endpoints checks, history, dependency context and
challenge resolution. Point an MCP client at the command above to make the
engine available to agents. All tool calls dispatch through the same service as
the CLI and LSP server.

## Evidence semantics

- Check outcomes are `pass`, `fail` or `unresolved`. Unknown analysis is not a
  counterexample.
- A check that throws or does not reach its named production checkpoint records
  no observation.
- Dependencies include code, data, configuration, environment, method and
  external inputs. Each changed fingerprint advances a monotonic revision, so
  returning to old bytes cannot reactivate old evidence.
- A failure opens a challenge. Only an exact same-law, same-case replay started
  after that failure may resolve it, and the replay must remain applicable.
- Arguments retain conjunctive premise structure and alternative routes. Cycles
  cannot support themselves.
- Claim identity is exact canonical JSON identity; logical equivalence and scope
  subsumption are package responsibilities.
- Import verifies the store envelope checksum and all internal references before
  rebuilding state.

The checksum detects accidental or out-of-band modification; it is not a
signature and does not protect against a process or user that controls both the
store and checksum.

## Real Endpoints package

The package reports safe-to-skip support only when the query and mutation share
an artifact, authority has a confirmed baseline, no optimistic or repair work is
pending, effect bounds are complete, and the query reads do not intersect the
mutation writes. Overlap and missing authority produce a failing observation;
incomplete effects or different artifacts remain unresolved.

The independent oracle enumerates all small read/write subsets over three table
names and computes intersection without using the production decision helper.
This tests the verdict kernel. It does not establish SQL analyzer completeness,
PostgreSQL value correctness, external-write handling or production policy.

## Package map

- `protocol.ts`: check, dependency and three-valued outcome contracts.
- `kernel.ts`: evidence state, argument evaluation, applicability and replay.
- `storage.mjs`: checksummed atomic JSON persistence.
- `endpoints-real.mjs`: the real Endpoints claim, contract, runner and rule.
- `service.mjs`: shared serialized operations.
- `cli.mjs`, `lsp-server.mjs`, `mcp-server.mjs`: transport adapters.
- `oracle-tools.mjs`: same-violation history reduction.
- `kernel.test.mjs`, `rebuild.test.mjs`, `fault-controls.mjs`: bounded oracles,
  integration checks and mutation controls.
- `workflows/`: the packaged `design-check`, `maintain-evidence` and
  `repair-rule` authoring workflows.

## Remaining boundary

The next useful steps are to broaden SQL-analyzer evidence, give query and
mutation dependencies endpoint-specific identities, connect support to an
explicit consumer fallback policy, add safe multi-process storage coordination,
and package editor/agent configuration around the LSP and MCP servers. General
proof search, policy levels, signatures, remote execution, automatic dependency
discovery, cross-version case mapping and hostile-process isolation are not in
this prototype.

The [handoff](HANDOFF.md) records the implementation state, verification and
source trail. The original grammar, audit witnesses and full Field Log remain
under `probes/endpoints/design/evidence-guarantees/` and
`probes/endpoints/design/field-trip-optimistic-coherence/`.
