# @tanstack/ai-db

Durable state and coordination primitives for TanStack AI apps built on TanStack DB.

This document is the canonical package README for the proposed `@tanstack/ai-db` API.

## Overview

`@tanstack/ai-db` helps you build AI applications where state is:

- Durable (survives refreshes and process restarts)
- Shared (syncs across tabs/devices/environments)
- Coordinated (agents, tools, and background work communicate through collections)

The package is layered so you can start simple and scale up:

1. Agent abstractions (`createAgent`, `createWorkerAgent`) for fast app development
2. Composable primitives (`makeDurableTools`, `createToolExecutionEffect`, `streamToCollection`, etc.)
3. Runtime lifecycle primitives (`runWithLifecycle`, `drainUntilIdle`) for serverless wake/ack flows
4. Optional Durable Streams helpers (`durableAgent`, `durableStreamsWebhookAdapter`)

Core agents are backend-agnostic. Durable Streams integration is provided through helpers and adapters, not required by the base APIs.

## Quick Start

Start with a persistent agent using the `durableAgent(...)` option factory and `createAgent(...)`.
User-originated messages are written directly to the messages collection/stream.

```ts
import { createAgent, durableAgent } from '@tanstack/ai-db'
import { openaiText } from '@tanstack/ai'

const researcher = createAgent(
  durableAgent({
    name: 'researcher',
    instructions:
      'You are a research assistant. Be concise and cite concrete sources when possible.',
    adapter: openaiText('gpt-4o'),
    streamUrl: 'https://streams.example.com/sessions/session-123',
  }),
)

researcher.collections.messages.insert({
  id: crypto.randomUUID(),
  role: 'user',
  actorId: 'user-42',
  targetAgent: researcher.name,
  content: 'Summarize the latest incident report.',
  processed: false,
  createdAt: new Date().toISOString(),
})
```

The full insert shape is shown above once. In the rest of the examples, defaults are assumed for fields like `id`, `processed`, and `createdAt`.

Render messages with normal TanStack DB query patterns:

```tsx
import { useLiveQuery } from '@tanstack/react-db'
import { eq, or } from '@tanstack/db'
import { messagesCollection } from './collections'

function ResearcherChat({ agent, userId }: { agent: any; userId: string }) {
  const messages = useLiveQuery((q) =>
    q
      .from({ m: messagesCollection })
      .where(({ m }) =>
        or(eq(m.targetAgent, agent.name), eq(m.actorId, agent.name)),
      )
      .orderBy(({ m }) => m.createdAt),
  )

  return (
    <div>
      {messages.map((m) => (
        <p key={m.id}>
          <strong>{m.role}:</strong> {m.content}
        </p>
      ))}
      <button
        onClick={() => {
          messagesCollection.insert({
            role: 'user',
            actorId: userId,
            targetAgent: agent.name,
            content: 'Give me a shorter summary.',
          })
        }}
      >
        Ask Follow Up
      </button>
    </div>
  )
}
```

## Installation

```bash
pnpm add @tanstack/ai-db @tanstack/ai @tanstack/db
```

If using Durable Streams helpers:

```bash
pnpm add @durable-streams/state
```

## Mental Model

Use collections as your coordination layer:

- Messages trigger agent work
- Tool calls are persisted as rows
- Tool executors watch pending rows and write results
- Chunks are append-only records for streaming outputs
- Runtime adapters handle wake/claim/checkpoint/complete in serverless environments

This avoids direct process-to-process coupling and keeps behavior observable via queries.

## API Use Cases

Use this as a quick map before diving into each layer:

| API | Use this when |
|---|---|
| `createAgent(...)` | You need a persistent agent identity with history and a reactive generation loop |
| `durableAgent(...)` | You want the fastest on-ramp to a persistent agent with default durable wiring |
| `createWorkerAgent(...)` | You need a stateless specialist that runs per task and can be used as a tool |
| `makeDurableTool(...)` / `makeDurableTools(...)` | Tool calls must survive restarts and may execute in different environments (server, worker, browser) |
| `createToolExecutionEffect(...)` | A specific environment should claim and execute pending tool rows |
| `makeAsyncTool(...)` | Tool work is long-running and should return immediately with a job handle |
| `createGenerationEffect(...)` | You want generation driven directly from collection rows without full agent abstraction |
| `streamToCollection(...)` | You need durable, replayable chunk streaming instead of transient in-memory streams |
| `durableChat(...)` | You want an imperative chat entry point with durable tools/chunks and less wiring |
| `runWithLifecycle(...)` + `drainUntilIdle(...)` | You need wake/claim/checkpoint/complete control in serverless runtimes |
| `durableStreamsWebhookAdapter(...)` | You are integrating Durable Streams webhook delivery and callback lifecycle |

## Layer 1: Agent APIs

### `createAgent(...)` (Persistent Reactive Agent)

`createAgent` creates a long-lived reactive agent that:

- Watches a pending-work query
- Builds LLM context
- Runs generation
- Writes output back
- Loops until idle

It has two config paths:

- Collection-based (usually via `durableAgent(...)`)
- Query/mutation-based (fully custom schema)

Raw `createAgent({...})` configs require a `generate(...)` function.
`durableAgent(...)` provides that generation function by default (chat + your adapter/tools).

Every created agent instance exposes loop controls:

- `hasPendingWork()`
- `runGenerationCycle()`
- `drainUntilIdle(...)`

### Collection-Based Path (Default On-Ramp)

```ts
import { createAgent, durableAgent } from '@tanstack/ai-db'
import { openaiText } from '@tanstack/ai'

const writer = createAgent(
  durableAgent({
    name: 'writer',
    instructions: 'Write clear, structured responses.',
    adapter: openaiText('gpt-4o'),
    streamUrl: 'https://streams.example.com/sessions/session-123',
    buildMessages: async (pending, ctx) => {
      // Optional override: custom context assembly
      return pending.map((m) => ({ role: m.role, content: m.content }))
    },
  }),
)
```

### Query/Mutation Path (Custom Schema)

Use this when you already have your own collection model and want full control.

```ts
import { createAgent } from '@tanstack/ai-db'
import { chat, openaiText } from '@tanstack/ai'
import { and, eq } from '@tanstack/db'

const planner = createAgent({
  name: 'planner',
  instructions: 'Plan work and delegate to specialists.',
  adapter: openaiText('gpt-4o'),

  pendingWork: (q) =>
    q
      .from({ msg: appMessages })
      .where(({ msg }) => and(eq(msg.target, 'planner'), eq(msg.done, false))),

  buildMessages: async (pending) =>
    pending.map((p) => ({ role: 'user', content: p.body })),

  generate: async ({ messages, tools, adapter, signal }) => {
    const abortController = new AbortController()
    signal.addEventListener('abort', () => abortController.abort())
    return chat({
      adapter,
      systemPrompts: ['Plan work and delegate to specialists.'],
      messages,
      tools,
      abortController,
      stream: false,
    })
  },

  onResponse: async (response, pending) => {
    for (const p of pending) {
      appMessages.update(p.id, (d) => {
        d.done = true
      })
    }
    // `id` / `createdAt` come from schema defaults in this example.
    appMessages.insert({
      target: 'planner',
      actor: 'planner',
      body: response,
      done: true,
    })
  },
})
```

### `createWorkerAgent(...)` (Ephemeral Task Agent)

Worker agents are one-shot, stateless task agents.

- Fresh context on each invocation
- Can be used directly (`worker.run(...)`)
- Can be used as a tool inside another agent

```ts
import { createWorkerAgent, createAgent, durableAgent } from '@tanstack/ai-db'
import { openaiText } from '@tanstack/ai'
import { z } from 'zod'

const summarizer = createWorkerAgent({
  name: 'summarizer',
  description: 'Summarize long text',
  instructions: 'Summarize input into 5 bullet points.',
  adapter: openaiText('gpt-4o'),
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ bullets: z.array(z.string()) }),
  buildMessages: (input) => [
    { role: 'user', content: `Summarize:\n\n${input.text}` },
  ],
})

const researcher = createAgent(
  durableAgent({
    name: 'researcher',
    instructions: 'Research and summarize findings.',
    adapter: openaiText('gpt-4o'),
    tools: [summarizer],
    streamUrl: 'https://streams.example.com/sessions/session-123',
  }),
)

const direct = await summarizer.run({ text: 'Very long text...' })
```

### `tools` vs `agents`

Keep these separate:

- `tools`: external function calls (optionally wrapped with durable tool primitives)
- `agents`: agent-to-agent messaging calls (durable through message collections)

This prevents double-persisting the same operation in both message and tool-call records.

### Multi-Agent Composition (Coordinator + Specialists)

Use `agents` when one persistent agent should delegate work to other persistent agents.

```ts
import { createAgent, durableAgent } from '@tanstack/ai-db'
import { openaiText } from '@tanstack/ai'
import { z } from 'zod'

const streamUrl = 'https://streams.example.com/sessions/session-123'

const researcher = createAgent(
  durableAgent({
    name: 'researcher',
    instructions: 'Find factual information and cite concrete sources.',
    adapter: openaiText('gpt-4o'),
    streamUrl,
  }),
)

const writer = createAgent(
  durableAgent({
    name: 'writer',
    instructions: 'Turn notes into clear, well-structured prose.',
    adapter: openaiText('gpt-4o'),
    streamUrl,
  }),
)

const planner = createAgent(
  durableAgent({
    name: 'planner',
    instructions:
      'Coordinate work. Call researcher for facts, then writer for final output.',
    adapter: openaiText('gpt-4o'),
    streamUrl,
    agents: [
      {
        agent: researcher,
        description: 'Research a topic and return evidence-backed findings.',
        inputSchema: z.object({
          message: z.string(),
          depth: z.enum(['quick', 'deep']).default('deep'),
        }),
        outputSchema: z.object({ response: z.string() }),
      },
      {
        agent: writer,
        description: 'Convert research notes into a polished response.',
        inputSchema: z.object({
          message: z.string(),
          tone: z.enum(['neutral', 'concise']).default('neutral'),
        }),
        outputSchema: z.object({ response: z.string() }),
      },
    ],
  }),
)

planner.collections.messages.insert({
  role: 'user',
  actorId: 'user-42',
  targetAgent: planner.name,
  content: 'Write a short brief on lithium supply risks in 2026.',
})
```

What happens:

- You write one user message to the coordinator agent's message stream.
- The coordinator can call specialist agents through `agents` as needed.
- Cross-agent requests/responses are correlated through `requestId`/`inReplyTo` message fields.
- All coordination remains collection-driven and durable.

## Layer 2: Composable Primitives

Use these when you want explicit control over each coordination step.

### Durable Tool Wrapping

`makeDurableTool` / `makeDurableTools` persist calls and wait for completion via collection sync.
Use these when tool invocation and tool execution are decoupled in time or environment.
This is what enables one runtime to generate tool calls and another runtime to execute them.
Use `makeDurableTool(...)` for one tool, or `makeDurableTools(...)` for a tool list.

```ts
import { makeDurableTools } from '@tanstack/ai-db'

const durableTools = makeDurableTools([searchTool, analyzeTool], toolCalls, {
  transform: (tc, generationId) => ({
    id: tc.id,
    generationId,
    name: tc.name,
    args: tc.args,
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
  isComplete: (row) =>
    row.status === 'completed' || row.status === 'failed' || row.status === 'cancelled',
  getResult: (row) => {
    if (row.status === 'failed') throw new Error(row.error ?? 'Tool failed')
    return row.result
  },
  timeout: 60_000,
})
```

Cross-environment pattern:

- Generation runtime (server or browser) calls `chat(...)` with durable tools.
- Execution runtimes run `createToolExecutionEffect(...)` over the same `toolCalls` collection.
- You can execute some tools on the server (secrets, private APIs) and others in the webpage (DOM/user context).

Example split by environment:

```ts
import { createToolExecutionEffect, makeDurableTools } from '@tanstack/ai-db'
import { and, eq } from '@tanstack/db'

// Shared durable wrappers used by the generation runtime
const durableTools = makeDurableTools([searchServerDocs, readPageSelection], toolCalls, {
  transform: (tc, generationId) => ({
    id: tc.id,
    generationId,
    name: tc.name,
    args: tc.args,
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
  isComplete: (row) =>
    row.status === 'completed' || row.status === 'failed' || row.status === 'cancelled',
  getResult: (row) => row.result,
})

// Server process executes only server-owned tools
createToolExecutionEffect({
  query: (q) =>
    q
      .from({ tc: toolCalls })
      .where(({ tc }) => and(eq(tc.status, 'pending'), eq(tc.name, 'searchServerDocs'))),
  tools: [searchServerDocs] as const,
  implementations: {
    searchServerDocs: async (args) => ({ hits: await serverSearch(args.query) }),
  },
})

// Browser app executes only client-owned tools
createToolExecutionEffect({
  query: (q) =>
    q
      .from({ tc: toolCalls })
      .where(({ tc }) => and(eq(tc.status, 'pending'), eq(tc.name, 'readPageSelection'))),
  tools: [readPageSelection] as const,
  implementations: {
    readPageSelection: async () => ({ text: window.getSelection()?.toString() ?? '' }),
  },
})
```

### Tool Execution Effects

`createToolExecutionEffect` runs tool implementations for pending rows.
Use this when a runtime owns a capability (credentials, network access, browser APIs) and should be the executor for that tool subset.

Important: include `$synced` filtering when available to avoid optimistic duplicate execution.

```ts
import { createToolExecutionEffect } from '@tanstack/ai-db'
import { and, eq } from '@tanstack/db'

createToolExecutionEffect({
  query: (q) =>
    q
      .from({ tc: toolCalls })
      .where(({ tc }) => and(eq(tc.status, 'pending'), eq(tc.$synced, true))),

  tools: [searchTool, analyzeTool] as const,

  implementations: {
    searchDatabase: async (args) => ({ results: await search(args.query) }),
    analyzeDocument: async (args) => ({ summary: await analyze(args.docId) }),
  },

  onExecuting: async (row) => {
    toolCalls.update(row.id, (d) => {
      d.status = 'executing'
      d.updatedAt = new Date().toISOString()
    })
  },

  onComplete: async (row, result) => {
    toolCalls.update(row.id, (d) => {
      d.status = 'completed'
      d.result = result
      d.updatedAt = new Date().toISOString()
    })
  },

  onError: async (row, error) => {
    toolCalls.update(row.id, (d) => {
      d.status = 'failed'
      d.error = error.message
      d.updatedAt = new Date().toISOString()
    })
  },
})
```

### Async Fire-and-Forget Tools

`makeAsyncTool` starts background work and returns immediately.
Use this when the model should enqueue work and continue without waiting for completion in the same turn.

```ts
import { makeAsyncTool } from '@tanstack/ai-db'

const asyncImageTool = makeAsyncTool(imageTool, toolCalls, {
  transform: (tc, generationId) => ({
    id: tc.id,
    generationId,
    name: tc.name,
    args: tc.args,
    status: 'pending',
  }),
  getImmediateResult: (row) => ({ jobId: row.id, status: 'queued' }),
})
```

### Generation Effects

`createGenerationEffect` watches pending generation requests and runs your generation function.
Use this when you want row-driven generation but do not need full persistent-agent behavior.

```ts
import { createGenerationEffect } from '@tanstack/ai-db'

createGenerationEffect({
  query: (q) =>
    q.from({ g: generations }).where(({ g }) => eq(g.status, 'pending')),

  generate: async (row, ctx) => {
    const abortController = new AbortController()
    ctx.signal.addEventListener('abort', () => abortController.abort())

    return runGenerationForRow(row, { abortController })
  },

  onComplete: async (row, result) => {
    generations.update(row.id, (d) => {
      d.status = 'completed'
      d.output = result
    })
  },
})
```

### Chunk Persistence

`streamToCollection` writes streaming chunks as append-only records.
Use this when you need deterministic replay/recovery of streamed output.

```ts
import { chat, openaiText } from '@tanstack/ai'
import { streamToCollection } from '@tanstack/ai-db'

const stream = chat({
  adapter: openaiText('gpt-4o'),
  messages,
  tools: durableTools,
})

await streamToCollection(stream, {
  collection: chunks,
  generationId,
  transform: (chunk, index, genId) => ({
    id: `${genId}:${index}`,
    generationId: genId,
    index,
    type: chunk.type,
    content: chunk.type === 'TEXT_MESSAGE_CONTENT' ? chunk.delta : '',
  }),
})
```

### Convenience Wrapper

`durableChat` combines `chat` + durable tools + optional chunk persistence for common workflows.
Use this when you want durable behavior with an imperative API and minimal wiring.

## Layer 3: Runtime Lifecycle Primitives

These primitives support wake/claim/checkpoint/complete flows in serverless runtimes.

### Core APIs

- `runWithLifecycle(wake, adapter, handler)`
- `drainUntilIdle(...)`
- `RunnerLifecycleAdapter`
- `CheckpointContract`

Use them when work can be resumed/retried and runtime liveness is externally managed.
For `createAgent(...)` instances, these are already wired as `agent.hasPendingWork()`, `agent.runGenerationCycle()`, and `agent.drainUntilIdle(...)`.

## Durable Streams Webhook Integration

Use `durableStreamsWebhookAdapter` as an optional helper built on the generic lifecycle APIs.

### Supported Runtime Modes

The helper must support both webhook execution models:

1. **Request-bound drain**
2. **Immediate-ack wake**

```ts
type WebhookExecutionMode =
  | { type: 'request-bound'; maxRequestMs?: number }
  | { type: 'ack-immediate'; status?: 200 | 202 }
```

### Callback Semantics

For correctness in both modes:

- First callback claims wake (`epoch` + `wake_id`)
- Use latest rotated callback token on every subsequent call
- Send periodic heartbeats during long-running work
- Send checkpoint acks with monotonic offsets/cursors
- Finish with `complete({ done: true|false })`

### Example: Request-Bound Drain

```ts
const wakeAdapter = durableStreamsWebhookAdapter({
  verifySignature: async (req) => verifyWebhookSignature(req, env.WEBHOOK_SECRET),
  mode: { type: 'request-bound', maxRequestMs: 25_000 },
  heartbeatIntervalMs: 10_000,
  postCallback: (wake, body, token) =>
    postToDurableStreamsCallback(wake.callback, body, token),
})

export async function onWebhook(wakePayload: DurableStreamsWakePayload) {
  const checkpointState = new Map(
    wakePayload.streams.map((s) => [s.path, s.offset] as const),
  )

  const drained = await runWithLifecycle(wakePayload, wakeAdapter, async (session) => {
    const drained = await researcher.drainUntilIdle({
      maxDurationMs: 25_000,
      lifecycle: {
        heartbeat: () => session.heartbeat(),
        checkpoint: async (cp) => {
          await session.checkpoint(cp)
          for (const item of cp) checkpointState.set(item.source, item.cursor)
        },
      },
      buildCheckpoint: async () =>
        [...checkpointState.entries()].map(([source, cursor]) => ({ source, cursor })),
    })

    await session.complete({ done: drained.completed })
    return drained
  })

  return Response.json({ done: drained.completed }, { status: 200 })
}
```

### Example: Immediate-Ack Wake

```ts
const wakeAdapter = durableStreamsWebhookAdapter({
  verifySignature: async (req) => verifyWebhookSignature(req, env.WEBHOOK_SECRET),
  mode: { type: 'ack-immediate', status: 202 },
  heartbeatIntervalMs: 10_000,
  postCallback: (wake, body, token) =>
    postToDurableStreamsCallback(wake.callback, body, token),
})

export async function onWebhook(wakePayload: DurableStreamsWakePayload) {
  const checkpointState = new Map(
    wakePayload.streams.map((s) => [s.path, s.offset] as const),
  )

  queueMicrotask(async () => {
    await runWithLifecycle(wakePayload, wakeAdapter, async (session) => {
      const drained = await researcher.drainUntilIdle({
        maxDurationMs: 25_000,
        lifecycle: {
          heartbeat: () => session.heartbeat(),
          checkpoint: async (cp) => {
            await session.checkpoint(cp)
            for (const item of cp) checkpointState.set(item.source, item.cursor)
          },
        },
        buildCheckpoint: async () =>
          [...checkpointState.entries()].map(([source, cursor]) => ({ source, cursor })),
      })

      await session.complete({ done: drained.completed })
    })
  })

  return Response.json({ accepted: true }, { status: 202 })
}
```

### TanStack Start Wiring

In a TanStack Start app, wire webhooks with [server routes](https://tanstack.com/start/latest/docs/framework/react/guide/server-routes) (file-based routes with `server.handlers`).

Suggested structure:

```txt
src/
  lib/
    ai/
      agent.ts
      webhook-runtime.ts
  routes/
    api/
      webhooks/
        durable-streams.ts
```

`agent.ts` (shared runtime pieces):

```ts
import { createAgent, durableAgent } from '@tanstack/ai-db'
import { openaiText } from '@tanstack/ai'

export const researcher = createAgent(
  durableAgent({
    name: 'researcher',
    instructions: 'You are a research assistant.',
    adapter: openaiText('gpt-4o'),
    streamUrl: process.env.DS_STREAM_URL!,
  }),
)
```

`webhook-runtime.ts` (shared wake processor):

```ts
import {
  durableStreamsWebhookAdapter,
  runWithLifecycle,
  type DurableStreamsWakePayload,
} from '@tanstack/ai-db'
import { researcher } from './agent'

const wakeAdapter = durableStreamsWebhookAdapter({
  verifySignature: async (req) =>
    verifyWebhookSignature(req, process.env.DS_WEBHOOK_SECRET!),
  mode: { type: 'request-bound', maxRequestMs: 25_000 },
  heartbeatIntervalMs: 10_000,
  postCallback: (wake, body, token) =>
    postToDurableStreamsCallback(wake.callback, body, token),
})

export async function processWakeRequest(wake: DurableStreamsWakePayload) {
  const checkpointState = new Map(
    wake.streams.map((s) => [s.path, s.offset] as const),
  )

  const drained = await runWithLifecycle(wake, wakeAdapter, async (session) => {
    const drained = await researcher.drainUntilIdle({
      maxDurationMs: 25_000,
      lifecycle: {
        heartbeat: () => session.heartbeat(),
        checkpoint: async (cp) => {
          await session.checkpoint(cp)
          for (const item of cp) checkpointState.set(item.source, item.cursor)
        },
      },
      buildCheckpoint: async () =>
        [...checkpointState.entries()].map(([source, cursor]) => ({ source, cursor })),
    })

    await session.complete({ done: drained.completed })
    return drained
  })

  return { done: drained.completed }
}
```

`routes/api/webhooks/durable-streams.ts` (public webhook endpoint):

```ts
import { createFileRoute } from '@tanstack/react-router'
import { processWakeRequest } from '~/lib/ai/webhook-runtime'
import type { DurableStreamsWakePayload } from '@tanstack/ai-db'

export const Route = createFileRoute('/api/webhooks/durable-streams')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const wake = (await request.json()) as DurableStreamsWakePayload
        const result = await processWakeRequest(wake)
        return Response.json(result, { status: 200 })
      },
    },
  },
})
```

This model runs the agent lifecycle entirely inside the webhook request.  
Set `maxRequestMs` below your platform's HTTP timeout and leave headroom for request parsing and response writing.

## Layer 4: Schema Contracts

The composable layer is schema-agnostic, but semantics require minimal shape contracts.

### Tool Call Contract

```ts
type ToolCallContract = {
  id: string
  name: string
  status: string
  args: unknown
}
```

### Generation Contract

```ts
type GenerationContract = {
  id: string
  status: string
}
```

### Chunk Contract

```ts
type ChunkContract = {
  id: string
  generationId: string
  index: number
}
```

### Agent Message Shape (Collection Path)

```ts
interface AgentMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  actorId: string
  targetAgent: string
  content: string
  createdAt: string
  processed: boolean
  generationId?: string
  requestId?: string
  inReplyTo?: string
}
```

## Reliability Model

### Execution Guarantees

- Effects are at-least-once by default
- Exactly-once behavior is achievable in single-consumer topologies with atomic status transitions
- Tool execution idempotency depends on your status transitions and query filters

### Single-Runner Assumption (v1)

- Tool execution effects assume one consumer per tool query
- Persistent agent generation loop assumes one active runner per `(session, agent)`
- Multi-runner coordination is an advanced pattern (deferred in the RFC)

### Cancellation and Late Results

- `AbortSignal` flows through effect contexts
- In-flight chat calls should be aborted when effects are disposed
- Late tool results after cancellation should be discarded or explicitly marked, based on policy

## Choosing an Entry Point

Use this as a quick decision guide:

| Need | Start with |
|---|---|
| Fastest path to persistent agent chat | `createAgent(durableAgent(...))` |
| Stateless specialist tasks | `createWorkerAgent(...)` |
| Cross-environment tool execution | `makeDurableTools(...)` + `createToolExecutionEffect(...)` |
| Long-running async jobs | `makeAsyncTool(...)` |
| Row-driven generation without agents | `createGenerationEffect(...)` |
| Durable chunk streaming | `streamToCollection(...)` |
| Imperative durable chat flow | `durableChat(...)` |
| Wake/claim/ack/checkpoint for serverless workers | `runWithLifecycle(...)` + `drainUntilIdle(...)` |
| Durable Streams webhook integration | `durableStreamsWebhookAdapter(...)` |

## End-to-End Reference Flow

A typical production flow:

1. Create one or more persistent agents with `createAgent(...)`
2. Wrap external tools with `makeDurableTools(...)`
3. Run tool execution effects in the environments that own those tools
4. Persist streamed output chunks with `streamToCollection(...)`
5. In serverless webhook runtimes, run wake lifecycle through `runWithLifecycle(...)`
6. Use checkpoints and done semantics to avoid duplicate processing and stuck consumers

## Status

This README describes the proposed API and behavior captured in the RFC. Naming and exact signatures may still evolve before final package release.
