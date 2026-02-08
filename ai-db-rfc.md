---
title: "@tanstack/ai-db: Durable State for AI Agents"
version: "2.0"
status: draft
owner: samwillis
contributors:
  - samwillis
created: 2026-02-01
last_updated: 2026-02-08
prd: ./ai-db-prd.md
prd_version: "2.0"
---

# @tanstack/ai-db: Durable State for AI Agents

## Summary

AI applications need durable, collaborative state—but current solutions like `useChat` manage ephemeral client state that's lost on refresh. This RFC proposes `@tanstack/ai-db`, a package that connects TanStack AI to TanStack DB collections via reactive effects, enabling AI state that persists, syncs across devices, and supports multi-agent collaboration. The package is progressively layered: schema-agnostic composable primitives (Phase 1, including protocol-agnostic runner lifecycle primitives), agent abstractions with option factories (Phase 2), and production hardening (Phase 3). Distributed coordination is explicitly deferred to future work (Phase 4).

**Quick-start with `durableAgent` factory (Phase 2):**

```typescript
import { createAgent, durableAgent, makeDurableTools } from '@tanstack/ai-db'
import { toolDefinition, openaiText } from '@tanstack/ai'

const searchTool = toolDefinition({
  name: 'search',
  inputSchema: z.object({ query: z.string() }),
  outputSchema: z.object({ results: z.array(z.string()) }),
})

// Create a persistent agent with durable state — minimal config
const researcher = createAgent(durableAgent({
  name: 'researcher',
  instructions: 'You are a research assistant. Search for information and provide detailed answers.',
  adapter: openaiText('gpt-4o'),
  tools: [searchTool],
  streamUrl: 'https://streams.example.com/sessions/session-123',
}))

// Agent is live — write a user message to the messages stream/collection
// (full insert shape shown once; later examples use defaults)
researcher.collections.messages.insert({
  id: crypto.randomUUID(),
  role: 'user',
  actorId: 'user-123',
  targetAgent: researcher.name,
  content: 'What are the latest advances in quantum computing?',
  processed: false,
  createdAt: new Date().toISOString(),
})
```

**Composable primitives for full control (Phase 1):**

```typescript
import { makeDurableTools, createToolExecutionEffect, streamToCollection } from '@tanstack/ai-db'
import { createCollection, createEffect, eq, and, queryOnce } from '@tanstack/db'
import { chat, openaiText } from '@tanstack/ai'

// User-defined collections with custom schemas
const messages = createCollection({ schema: MessageSchema, sync: { /* ... */ } })
const toolCalls = createCollection({ schema: ToolCallSchema, sync: { /* ... */ } })
const chunks = createCollection({ schema: ChunkSchema, sync: { /* ... */ } })

// Make tools durable — persist calls, wait for results via collection
const durableTools = makeDurableTools([searchTool], toolCalls, {
  transform: (tc, genId) => ({ ...tc, status: 'pending', generationId: genId }),
  isComplete: (row) => row.status === 'completed' || row.status === 'failed',
  getResult: (row) => row.status === 'failed' ? Promise.reject(row.error) : row.result,
})

// Execute pending tool calls (can run on server, worker, or client)
createToolExecutionEffect({
  query: (q) => q
    .from({ tc: toolCalls })
    .where(({ tc }) => and(eq(tc.status, 'pending'), eq(tc.$synced, true))),
  tools: [searchTool] as const,
  implementations: {
    search: async (args) => ({ results: await db.search(args.query) }),
  },
})

// Trigger generation when a new user message arrives
createEffect({
  query: (q) => q
    .from({ m: messages })
    .where(({ m }) => and(eq(m.$synced, true), eq(m.processed, false))),
  on: 'enter',
  handler: async (event, ctx) => {
    const row = event.value
    const history = await queryOnce((q) =>
      q.from({ m: messages }).orderBy(({ m }) => m.createdAt).limit(100)
    )
    await chat({
      adapter: openaiText('gpt-4o'),
      messages: history.map(m => ({ role: m.role, content: m.content })),
      tools: durableTools,
    })
  },
})
```

## Background

### Dependencies

This RFC builds on the Reactive Effects API proposed in `./reactive-effects-rfc.md`. It assumes:

- `createEffect()` for watching live query deltas (enter/exit/update events)
- `$synced` virtual property for filtering confirmed vs optimistic state
- Delta-only processing without full query materialization

### TanStack AI

TanStack AI provides:

- **Adapters**: `openaiText('gpt-4o')`, `anthropicText('claude-sonnet-4-5')`, etc. for provider integration (model baked into adapter)
- **`chat()`**: Streaming generation with tool calling and agent loops
- **`toolDefinition()`**: Isomorphic tool definitions with server/client implementations
- **Stream processing**: `StreamProcessor` for handling streaming responses

`@tanstack/ai-db` complements TanStack AI—it uses `chat()` for generation, not replaces it.

### Durable Streams State Protocol

The [State Protocol](https://github.com/durable-streams/durable-streams/blob/main/packages/state/STATE-PROTOCOL.md) defines:

- Change events: `insert`, `update`, `delete` with type/key/value
- Append-only semantics ideal for streaming AI responses
- `@durable-streams/state` provides `StreamDB` for TanStack DB integration

## Problem

Developers building AI applications face:

1. **Ephemeral state**: `useChat` state is lost on refresh/disconnect
2. **No multi-device sync**: Conversations don't follow users across devices
3. **Multi-agent coordination is DIY**: No standard patterns for shared state
4. **Tool execution is environment-locked**: Tools run in one context; no way to persist calls for another environment to pick up
5. **Streaming isn't durable**: Partial work lost on crash
6. **No recovery from interruption**: Crashed servers leave orphaned state
7. **Approval workflows are ephemeral**: Human-in-the-loop doesn't persist across devices

**Link to PRD hypothesis:** This RFC enables testing whether effect-based AI state management provides the durability and collaboration capabilities developers need.

## Goals & Non-Goals

### Goals

- **G1**: Provide schema-agnostic primitives for connecting AI generation to collections
- **G2**: Provide schema-agnostic primitives for tool execution via effects
- **G3**: Support chunk-based streaming persistence (append-only) with ordering guarantees
- **G4**: Provide persistent agent and worker agent abstractions with default schemas for rapid setup
- **G5**: Enable multi-user/agent attribution via actorId
- **G6**: Enable tool calls to be persisted and executed in a different environment (server, client, edge)
- **G7**: Support cancellation with proper cleanup and late-result handling
- **G8**: Enable idempotent execution to prevent duplicates (single-consumer model)
- **G9**: Support human-in-the-loop approvals with durable state
- **G10**: Enable recovery from interrupted operations
- **G11**: Support persistent agent sleep/wake lifecycle for resource-efficient deployment
- **G12**: Provide protocol-agnostic runner lifecycle primitives (wake claim, heartbeat, checkpoints, completion) for serverless runtimes

### Non-Goals

- **NG1**: Replace TanStack AI's `chat()` function—we complement it
- **NG2**: Provide UI components—use existing TanStack DB framework hooks
- **NG3**: Define the "one true schema"—composable layer uses shape contracts
- **NG4**: Build a full workflow engine—provide primitives, not framework
- **NG5**: Framework-specific hooks initially—evaluate if `useLiveQuery` suffices
- **NG6**: Implement authorization—defer to sync backend ACLs
- **NG7**: Tie core `createAgent` APIs to any specific transport protocol (webhooks, queues, alarms)

## Proposal

### Package Structure

```
@tanstack/ai-db
├── Phase 1: Composable primitives (schema-agnostic)
├── Phase 2: Agent abstractions + default schemas
├── Phase 3: Production hardening (approvals, recovery)
├── Phase 4: Advanced patterns (future)
├── Optional protocol adapters (built from Phase 1 primitives)
└── Re-exports from @tanstack/ai for convenience
```

Single package with potential future framework packages (`@tanstack/ai-db-react`) if needed.

### Phase 1: Composable Primitives

_Schema-agnostic building blocks for connecting AI generation and tool execution to user-defined collections. These primitives are independently useful without agent abstractions._

#### Architecture: Collection as Communication Layer

The composable primitives are **decoupled by design**—they communicate through collections, not direct references. This enables:

- Generation in one environment (e.g., server)
- Tool execution in another (e.g., client, worker, different server)
- Communication via synced collections
- Single-consumer model per environment — each `createToolExecutionEffect` watches its own query and assumes it is the sole consumer of matching rows

Core primitives in this phase are intentionally **transport-neutral**. Durable Streams, webhook callbacks, queue leases, and platform alarms are implemented as adapters on top — not as requirements of the base APIs.

```
┌─────────────────────────────┐       ┌───────────────────────────────┐
│   Generation Environment    │       │   Execution Environment       │
│   (running chat loop)       │       │   (same or different process) │
├─────────────────────────────┤       ├───────────────────────────────┤
│                             │       │                               │
│  // Make tools "durable"    │       │  // Watch for pending calls   │
│  const tools = makeDurable  │       │  createToolExecutionEffect({  │
│    Tools([searchTool],      │       │    query: pendingQuery,       │
│    toolCallsCollection)     │──┐    │    tools: [searchTool],       │
│                             │  │    │    implementations: {...},    │
│  // Use with standard chat()│  │    │    onComplete: ...            │
│  chat({ tools, ... })       │  │    │  })                           │
│                             │  │    └───────────────────────────────┘
│  When LLM calls a tool:     │  │                  ↓
│  1. Insert pending row ─────│──┼────→ Sync propagates to executor
│  2. Wait for result         │  │                  ↓
│        ↑                    │  │    Effect sees row, executes tool
│        │                    │  │                  ↓
│  4. Continue generation     │  │    Update row with result ──────→
│  3. Result arrives via sync │←─┼──── Sync propagates back
└─────────────────────────────┘  │
                                 │
           toolCallsCollection ←─┘  (both sides reference same collection)
```

#### Shape Contracts

While the composable layer is schema-agnostic, **execution guarantees require minimal shape contracts**. Users choose their own field names but must satisfy these semantic roles:

**Tool Call Contract:**
```typescript
interface ToolCallContract {
  id: string           // Unique tool call identifier
  status: string       // pending → executing → completed|failed|cancelled
  name: string         // Tool name for dispatch
  args: unknown        // Tool arguments
}
```

**Generation Request Contract:**
```typescript
interface GenerationContract {
  id: string           // Unique generation identifier  
  status: string       // pending → generating → completed|failed|cancelled
}
```

**Chunk Ordering:**
```typescript
interface ChunkContract {
  id: string           // Unique chunk identifier
  generationId: string // Parent generation for grouping
  index: number        // Sequence number for ordering (0, 1, 2...)
  isFinal?: boolean    // Optional: marks last chunk in stream
}
```

Users map their schema fields to these roles via `transform`, `isComplete`, and `getResult` functions.

#### `$synced` Filtering Requirement

**All execution effects MUST filter by `$synced: true`** to prevent duplicate execution from optimistic updates:

```typescript
// ✅ Correct: Only execute confirmed rows
query: (q) => q.from({ tc: toolCalls }).where(({ tc }) => and(
  eq(tc.status, 'pending'),
  eq(tc.$synced, true)  // REQUIRED for idempotency
))

// ❌ Wrong: May execute twice (once optimistically, once confirmed)
query: (q) => q.from({ tc: toolCalls }).where(({ tc }) => 
  eq(tc.status, 'pending')
)
```

Without `$synced` filtering, a tool call inserted locally will:
1. Fire the effect immediately (optimistic row)
2. Sync to server and back
3. Fire the effect again (confirmed row)

#### Durable Tool Wrappers

`makeDurableTool()` wraps a TanStack AI tool to persist calls and wait for results:

```typescript
import { makeDurableTool, makeDurableTools, ToolCallContract } from '@tanstack/ai-db'
import { toolDefinition, chat, openaiText, InferToolOutput } from '@tanstack/ai'

// 1. Define tool (typed schema - used for LLM and type inference)
const searchTool = toolDefinition({
  name: 'searchDatabase',
  description: 'Search the database for relevant documents',
  inputSchema: z.object({ query: z.string() }),
  outputSchema: z.object({ results: z.array(z.string()) }),
})

// Inferred types from tool definition:
// - Input: { query: string }
// - Output: { results: string[] }

// 2. User's collection for tool calls (extends ToolCallContract)
interface MyToolCallRow extends ToolCallContract {
  id: string
  name: string
  args: unknown
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'cancelled'
  result?: { results: string[] }  // Typed to match tool output
  error?: string
  generationId?: string
}

const toolCalls = createCollection<MyToolCallRow>({
  schema: z.object({
    id: z.string(),
    name: z.string(),
    args: z.unknown(),
    status: z.enum(['pending', 'executing', 'completed', 'failed', 'cancelled']),
    result: z.object({ results: z.array(z.string()) }).optional(),
    error: z.string().optional(),
    generationId: z.string().optional(),
  }),
  // ... sync config
})

// 3. Wrap tool to make it "durable" - fully typed!
const durableSearchTool = makeDurableTool(searchTool, toolCalls, {
  timeout: 60_000,
  // toolCall.args is typed as { query: string }
  transform: (toolCall, generationId) => ({
    id: toolCall.id,
    name: toolCall.name,
    args: toolCall.args,
    status: 'pending' as const,
    generationId,
  }),
  isComplete: (row) => row.status === 'completed' || row.status === 'failed',
  // Return type must match InferToolOutput<typeof searchTool>
  getResult: (row): { results: string[] } => {
    if (row.status === 'failed') throw new Error(row.error)
    return row.result!  // Typed as { results: string[] }
  },
})

// 4. Use with standard TanStack AI chat() - types flow through!
const adapter = openaiText('gpt-4o')

for await (const chunk of chat({
  adapter,
  messages,
  tools: [durableSearchTool],  // Tool result will be typed
})) {
  yield chunk
}
```

**How it works internally:**

```typescript
function makeDurableTool<
  T extends ToolDefinition,
  TRow extends ToolCallContract,
>(
  tool: T,
  collection: Collection<TRow>,
  options: MakeDurableToolOptions<T, TRow>
): DurableTool<T> {
  return {
    ...tool,  // Keep name, description, schemas
    execute: async (args: InferToolInput<T>): Promise<InferToolOutput<T>> => {
      const toolCallId = crypto.randomUUID()
      
      // Insert pending row using user's transform (args typed from tool)
      const row = options.transform({ id: toolCallId, name: tool.name, args })
      await collection.insert(row)
      
      // Wait for result by subscribing to changes
      const result = await waitForToolResult<TRow, InferToolOutput<T>>(
        collection,
        toolCallId,
        options.isComplete,
        options.getResult,  // Returns InferToolOutput<T>
        { timeout: options.timeout }
      )
      
      return result  // Typed result flows back to TanStack AI
    }
  }
}
```

**Convenience wrapper for multiple tools:**

```typescript
// Wrap multiple tools with shared config
const durableTools = makeDurableTools([searchTool, analysisTool], toolCalls, {
  timeout: 60_000,
  transform: (tc, genId) => ({ ...tc, status: 'pending', generationId: genId }),
  isComplete: (row) => row.status === 'completed' || row.status === 'failed',
  getResult: (row) => row.status === 'failed' ? Promise.reject(row.error) : row.result,
})

for await (const chunk of chat({ adapter, tools: durableTools, messages })) {
  yield chunk
}
```

#### Async (Fire-and-Forget) Tools

For tools that start long-running background work without blocking the agent loop:

```typescript
import { makeAsyncTool } from '@tanstack/ai-db'

// Define an async tool that returns immediately
const imageGenTool = toolDefinition({
  name: 'generateImage',
  description: 'Generate an image (returns job ID, completes asynchronously)',
  inputSchema: z.object({ prompt: z.string() }),
  outputSchema: z.object({ jobId: z.string(), status: 'queued' }),
})

// Wrap as async tool
const asyncImageTool = makeAsyncTool(imageGenTool, toolCalls, {
  // Transform for insertion (same as makeDurableTool)
  transform: (tc, genId) => ({
    ...tc,
    status: 'pending',
    generationId: genId,
    isAsync: true,  // Flag for async handling
  }),
  
  // Return immediately with job reference
  getImmediateResult: (row) => ({
    jobId: row.id,
    status: 'queued',
  }),
})

// Agent loop continues immediately after tool call
for await (const chunk of chat({
  adapter,
  messages,
  tools: [asyncImageTool],  // Doesn't block
})) {
  yield chunk
}
```

**How async tools differ from durable tools:**

| Aspect | `makeDurableTool` | `makeAsyncTool` |
|--------|-------------------|-----------------|
| Blocks agent loop | Yes (waits for result) | No (returns immediately) |
| Returns | Actual tool result | Job ID / status |
| Use case | Tools that complete quickly | Long-running background work |

**Status Reporting:**

Async tool status can be reported to the conversation in several ways:

```typescript
// Option 1: Tool execution effect updates status, agent checks later
createToolExecutionEffect({
  query: asyncToolCallsQuery,
  tools: [generateImageTool] as const,
  implementations: {
    generateImage: async (args) => {
      return await longRunningImageGen(args.prompt)
    },
  },
  onComplete: async (row, result) => {
    toolCalls.update(row.id, (draft) => {
      draft.status = 'completed'
      draft.result = result
      draft.completedAt = new Date().toISOString()
    })
    
    // Option 2: Insert a status message into the conversation
    await messages.insert({
      role: 'system',
      content: `Image generation completed: ${result.url}`,
      actorId: 'system',
    })
  },
})

// Option 3: Agent periodically checks via a "check_status" tool
const checkStatusTool = toolDefinition({
  name: 'checkAsyncJobStatus',
  description: 'Check status of a background job',
  inputSchema: z.object({ jobId: z.string() }),
}).server(async ({ jobId }) => {
  const job = await toolCalls.get(jobId)
  return { status: job.status, result: job.result }
})
```

**Key design decisions:**

- Async tools use the same collection as durable tools (unified persistence)
- `isAsync` flag distinguishes blocking vs non-blocking in user's schema
- Status reporting is user-defined (message injection, status tool, etc.)
- Builds on `makeDurableTool` pattern—just skips the `waitForToolResult` step

#### Tool Execution Effect

`createToolExecutionEffect()` watches for pending tool calls and executes them. **This is completely decoupled from `makeDurableTool`**—they coordinate through the collection:

```typescript
import { createToolExecutionEffect } from '@tanstack/ai-db'

// This runs in the execution environment (server, worker, client, etc.)
// It doesn't need to know about makeDurableTool - just watches the collection

// Shared tool definitions (imported from shared module)
const tools = [searchTool, analysisTool] as const

createToolExecutionEffect({
  // User's query for their schema — row type inferred
  query: (q) => q
    .from({ tc: toolCalls })
    .where(({ tc }) => and(
      eq(tc.status, 'pending'),
      eq(tc.$synced, true)  // Only confirmed rows (avoid duplicates)
    )),
  
  // Tool definitions + implementations (Approach 2 — see Type-Safe Tool APIs)
  tools,
  implementations: {
    searchDatabase: async (args, ctx) => {
      // args: { query: string } — inferred from searchTool.inputSchema
      return { results: await db.search(args.query) }
      // return type checked against searchTool.outputSchema
    },
    analyzeDocument: async (args, ctx) => {
      // args: { document: string } — inferred from analysisTool.inputSchema
      return { summary: await analyze(args.document) }
    },
  },
  
  // Lifecycle callbacks — row typed from query
  onExecuting: async (row) => {
    toolCalls.update(row.id, (draft) => { draft.status = 'executing' })
  },
  onComplete: async (row, result) => {
    // result is union of tool outputs: { results: string[] } | { summary: string }
    toolCalls.update(row.id, (draft) => {
      draft.status = 'completed'
      draft.result = result
    })
  },
  onError: async (row, error) => {
    toolCalls.update(row.id, (draft) => {
      draft.status = 'failed'
      draft.error = error.message
    })
  },
})
```

**How it works internally (built on reactive effects):**

```typescript
function createToolExecutionEffect<
  TTools extends readonly Tool[],
  TRow extends ToolCallContract,
>(options: {
  query: EffectQueryInput<any>
  tools: TTools
  implementations: ToolImplementations<TTools>
  onExecuting?: (row: TRow) => Promise<void>
  onComplete?: (row: TRow, result: InferToolOutput<TTools[number]>) => Promise<void>
  onError?: (row: TRow, error: Error) => Promise<void>
}) {
  // Build name→implementation lookup from typed implementations
  const implMap = new Map<string, (args: unknown, ctx: { signal: AbortSignal }) => Promise<unknown>>()
  for (const tool of options.tools) {
    implMap.set(tool.name, options.implementations[tool.name])
  }
  
  return createEffect({
    query: options.query,
    on: 'enter',
    handler: async (event, ctx) => {
      const row = event.value
      const toolImpl = implMap.get(row.name)
      if (!toolImpl) {
        await options.onError?.(row, new Error(`Unknown tool: ${row.name}`))
        return
      }
      
      try {
        await options.onExecuting?.(row)
        // args and result are typed via implementations record
        const result = await toolImpl(row.args, { signal: ctx.signal })
        await options.onComplete?.(row, result)
      } catch (error) {
        await options.onError?.(row, error as Error)
      }
    },
  })
}
```

#### Composing makeDurableTool with createToolExecutionEffect

These primitives compose through the **shared collection**, not direct wiring:

```typescript
// ============================================
// Environment A: Generation Server
// ============================================
import { makeDurableTools } from '@tanstack/ai-db'
import { chat, openaiText } from '@tanstack/ai'

// Same collection reference (synced)
const toolCalls = createCollection({ /* ... */ })

const durableTools = makeDurableTools(
  [searchTool, analysisTool],
  toolCalls,
  { /* transform, isComplete, getResult */ }
)

// Generation loop
async function handleGeneration(prompt: string) {
  for await (const chunk of chat({
    adapter: openaiText('gpt-4o'),
    messages: [{ role: 'user', content: prompt }],
    tools: durableTools,
  })) {
    // Stream to client or persist chunks
  }
}

// ============================================
// Environment B: Tool Execution Worker
// (Could be same process, different server, client, etc.)
// ============================================
import { createToolExecutionEffect } from '@tanstack/ai-db'

// Same collection reference (synced)
const toolCalls = createCollection({ /* ... */ })

createToolExecutionEffect({
  query: (q) => q.from({ tc: toolCalls }).where(/* pending + $synced */),
  tools: [searchTool, analysisTool] as const,
  implementations: {
    searchDatabase: async (args) => db.search(args.query),
    analyzeDocument: async (args) => analyze(args.doc),
  },
  onComplete: async (row, result) => {
    toolCalls.update(row.id, (draft) => {
      draft.status = 'completed'
      draft.result = result
    })
  },
})

// ============================================
// What happens when LLM calls searchDatabase:
// ============================================
// 1. makeDurableTool.execute() inserts { status: 'pending', name: 'searchDatabase', args: {...} }
// 2. makeDurableTool.execute() awaits waitForToolResult(collection, id)
// 3. Sync propagates the pending row to Environment B
// 4. createToolExecutionEffect sees row enter query (effect handler fires)
// 5. Effect executes db.search(args.query)
// 6. Effect calls onComplete → toolCalls.update(id, (draft) => { draft.status = 'completed'; ... })
// 7. Sync propagates the completed row back to Environment A
// 8. waitForToolResult() resolves with the result
// 9. chat() continues with the tool result
```

#### Generation Effect Helper

`createGenerationEffect()` creates an effect that triggers LLM generation when rows enter a user-defined query. It composes with `makeDurableTools` for tool support:

```typescript
import { createGenerationEffect, makeDurableTools } from '@tanstack/ai-db'
import { chat, openaiText, toolDefinition } from '@tanstack/ai'
import { eq, and } from '@tanstack/db'

// User's own collections with their own schemas
const generationRequests = createCollection({
  schema: z.object({
    id: z.string(),
    prompt: z.string(),
    state: z.enum(['pending', 'generating', 'done', 'failed']),
    response: z.string().optional(),
  }),
  // ... sync config
})

const toolCalls = createCollection({
  schema: z.object({
    id: z.string(),
    generationId: z.string(),
    name: z.string(),
    args: z.unknown(),
    status: z.enum(['pending', 'executing', 'completed', 'failed', 'cancelled']),
    result: z.unknown().optional(),
    error: z.string().optional(),
  }),
  // ... sync config
})

// Tool definitions
const searchTool = toolDefinition({
  name: 'searchDatabase',
  description: 'Search the database',
  inputSchema: z.object({ query: z.string() }),
})

// Make tools durable (persist calls, wait for results)
const durableTools = makeDurableTools([searchTool], toolCalls, {
  transform: (tc, genId) => ({ ...tc, status: 'pending', generationId: genId }),
  isComplete: (row) => row.status === 'completed' || row.status === 'failed',
  getResult: (row) => row.status === 'failed' ? Promise.reject(row.error) : row.result,
})

const adapter = openaiText('gpt-4o')

createGenerationEffect({
  // User provides query returning rows that need generation
  query: (q) => q
    .from({ req: generationRequests })
    .where(({ req }) => and(
      eq(req.state, 'pending'),
      eq(req.$synced, true)  // Only confirmed rows
    )),
  
  // Called for each row that enters the query result
  generate: async (row, ctx) => {
    // Update state to 'generating'
    generationRequests.update(row.id, (draft) => { draft.state = 'generating' })
    
    // Call TanStack AI's chat() with durable tools
    // Tool calls will persist to toolCalls collection automatically
    const abortController = new AbortController()
    ctx.signal.addEventListener('abort', () => abortController.abort())

    const response = await chat({
      adapter,
      messages: [{ role: 'user', content: row.prompt }],
      tools: durableTools,
      abortController,
      stream: false,
    })
    
    return response
  },
  
  // Called when generation completes successfully
  onComplete: async (row, result) => {
    // result is a string when chat() is called with stream: false
    generationRequests.update(row.id, (draft) => {
      draft.state = 'done'
      draft.response = result
    })
  },
  
  // Called on error
  onError: async (row, error) => {
    generationRequests.update(row.id, (draft) => { draft.state = 'failed' })
  },
})

// Separately: Tool execution effect (can be same or different environment)
createToolExecutionEffect({
  query: (q) => q
    .from({ tc: toolCalls })
    .where(({ tc }) => and(
      eq(tc.status, 'pending'),
      eq(tc.$synced, true)  // Only confirmed rows (avoid duplicates)
    )),
  tools: [searchTool] as const,
  implementations: {
    searchDatabase: async (args) => db.search(args.query),
  },
  onComplete: async (row, result) => {
    toolCalls.update(row.id, (draft) => {
      draft.status = 'completed'
      draft.result = result
    })
  },
})
```

**Key design decisions:**

- User provides query—their schema, their field names
- Effect uses reactive effects system under the hood
- `ctx` includes `signal: AbortSignal` for cancellation
- Effect auto-disposes when parent scope cleans up
- Durable tools compose naturally with `chat()`—no custom loop needed

#### Streaming to Collections

For chunk-based streaming, `streamToCollection()` persists chunks as they arrive:

```typescript
import { streamToCollection } from '@tanstack/ai-db'

// User's chunk collection
const chunks = createCollection({
  schema: z.object({
    id: z.string(),
    generationId: z.string(),
    index: z.number(),
    content: z.string(),
    type: z.enum(['text', 'tool-call-start', 'tool-call-args', 'tool-call-end', 'thinking']),
  }),
  // ...
})

// Inside generation function
generate: async (row, ctx) => {
  generationRequests.update(row.id, (draft) => { draft.state = 'generating' })
  
  const abortController = new AbortController()
  ctx.signal.addEventListener('abort', () => abortController.abort())

  const stream = chat({
    adapter,
    messages: [{ role: 'user', content: row.prompt }],
    tools: durableTools,  // Durable tools work with streaming too
    abortController,
  })
  
  // Stream chunks to collection, tool calls handled by durableTools
  // TanStack AI streams AG-UI events: TEXT_MESSAGE_CONTENT, TOOL_CALL_START, etc.
  // The transform function normalizes these to user's schema types
  const finalResult = await streamToCollection(stream, {
    collection: chunks,
    generationId: row.id,
    transform: (chunk, index, genId) => ({
      id: `${genId}-${index}`,
      generationId: genId,
      index,
      content: chunk.type === 'TEXT_MESSAGE_CONTENT' ? chunk.delta : '',
      type: mapChunkType(chunk.type),  // Maps AG-UI events → schema types
    }),
  })
  
  return finalResult
}
```

**Key design decisions:**

- User provides transform function—their chunk schema
- Returns final aggregated result after stream completes
- Chunks are append-only (natural for Durable Streams)
- Subscribers see chunks in real-time via `useLiveQuery`
- Durable tools work seamlessly with streaming—tool calls pause the stream, wait for results, then continue

**Chunk Ordering Guarantees:**

- Each chunk has unique `id` and sequential `index` (0, 1, 2...)
- Reassembly: `ORDER BY index` produces correct text
- Concurrent generations have distinct `generationId` (no interleaving)
- Final chunk identifiable via `isFinal` flag or generation status change

**Chunk Type Mapping:**

TanStack AI streams AG-UI protocol events. The `transform` function normalizes to user schema:

| AG-UI Event Type | Suggested Schema Type | Description |
|------------------|----------------------|-------------|
| `TEXT_MESSAGE_CONTENT` | `'text'` | Text content fragment (`chunk.delta`) |
| `TOOL_CALL_START` | `'tool-call-start'` | Tool invocation begins (`chunk.toolName`) |
| `TOOL_CALL_ARGS` | `'tool-call-args'` | Streaming tool arguments (`chunk.delta`) |
| `TOOL_CALL_END` | `'tool-call-end'` | Tool call complete with result |
| `STEP_FINISHED` | `'thinking'` | Reasoning/chain-of-thought (`chunk.delta`) |

```typescript
// Helper for type mapping
function mapChunkType(aiType: string): 'text' | 'tool-call-start' | 'tool-call-args' | 'tool-call-end' | 'thinking' {
  switch (aiType) {
    case 'TEXT_MESSAGE_CONTENT': return 'text'
    case 'TOOL_CALL_START': return 'tool-call-start'
    case 'TOOL_CALL_ARGS': return 'tool-call-args'
    case 'TOOL_CALL_END': return 'tool-call-end'
    case 'STEP_FINISHED': return 'thinking'
    default: return 'text'
  }
}
```

**Chunk Materialization:**

For UI rendering, chunks are typically materialized via hierarchical query. This will leverage the [Joins with hierarchical projection](https://github.com/TanStack/db/issues/288) feature:

```typescript
// Future: hierarchical projection for generations with chunks
const generations = query
  .from({ gen: generationsCollection })
  .select(({ gen }) => ({
    ...gen,
    chunks: query
      .from({ chunk: chunksCollection })
      .where(({ chunk }) => eq(chunk.generationId, gen.id))
      .orderBy(({ chunk }) => chunk.index)
  }))
```

Until available, use separate queries or join in application code.

#### Cancellation & Cleanup

Generation and tool execution support cancellation via the effect system's `ctx.signal`:

```typescript
const effect = createGenerationEffect({
  query: pendingGenerationsQuery,
  generate: async (row, ctx) => {
    // Bridge effect signal → AbortController for chat()
    const abortController = new AbortController()
    ctx.signal.addEventListener('abort', () => abortController.abort())

    const result = await chat({
      adapter,
      messages,
      abortController,  // Propagates cancellation
      stream: false,
    })
    return result
  },
  onCancelled: async (row) => {
    // Called when generation is aborted
    generations.update(row.id, (draft) => { draft.status = 'cancelled' })
  },
})

// Cancel all in-progress work by disposing the effect
effect.dispose()
// This aborts ctx.signal → abortController.abort() → chat() stream terminates
```

**Late-Arriving Results Policy:**

When a tool completes after its parent generation was cancelled:

```typescript
createToolExecutionEffect({
  // ...
  onComplete: async (row, result) => {
    // Check if parent generation is still active
    const generation = await generations.get(row.generationId)
    if (generation?.status === 'cancelled') {
      // Discard result, mark tool as cancelled
      toolCalls.update(row.id, (draft) => { draft.status = 'cancelled' })
      return
    }
    toolCalls.update(row.id, (draft) => {
      draft.status = 'completed'
      draft.result = result
    })
  },
})
```

#### Idempotency & Duplicate Prevention

The v1 model assumes a **single consumer** per tool execution effect. The effect query itself provides idempotency: once a row transitions from `'pending'` to `'executing'`, it exits the query result set and the effect does not re-fire for it. Applications needing multi-consumer coordination (e.g., horizontal scaling) should implement claiming logic at the application or sync-backend layer.

```typescript
createToolExecutionEffect({
  query: (q) => q
    .from({ tc: toolCalls })
    .where(({ tc }) => and(
      eq(tc.status, 'pending'),
      eq(tc.$synced, true)  // Only confirmed rows
    )),
  
  onExecuting: async (row) => {
    // Single runner: no contention — mark as executing
    toolCalls.update(row.id, (draft) => { draft.status = 'executing' })
  },
  // ...
})
```

**Backend Capability Matrix:**

| Capability | Durable Streams | Electric SQL | TanStack Query | Local-only |
|------------|-----------------|--------------|----------------|------------|
| `$synced` virtual prop | ✅ | ✅ | ❌ | ❌ |
| Optimistic locking | ✅ | ✅ | ⚠️ Server-side | N/A |
| Multi-device sync | ✅ | ✅ | ✅ (via server) | ❌ |

For backends without `$synced`, use server-side effects or explicit confirmation fields.

#### Runner Lifecycle Primitives (Protocol-Agnostic)

Persistent agents are backend-agnostic, but serverless runtimes often need explicit lifecycle handshakes around each wake-up:

- claim a wake atomically (fencing)
- keep the wake alive while work is running (heartbeat)
- checkpoint source progress (cursor/offset)
- mark completion (done) so the runtime can return to idle

These requirements are not unique to Durable Streams webhooks. The same shape appears in queue workers, cron-triggered drains, alarm-based Durable Objects, and job runners. Phase 1 adds protocol-agnostic primitives for this lifecycle so integrations stay composable.

```typescript
type CheckpointContract = {
  source: string   // Logical source (stream path, queue topic+partition, etc.)
  cursor: string   // Opaque progress token for that source
}

interface RunnerLifecycleAdapter<TWake = unknown> {
  // Acquire the wake/lease. Should reject on stale or already-claimed wake.
  claimWake(wake: TWake, ctx: { signal: AbortSignal }): Promise<{ fenceToken?: string }>
  // Optional keepalive while work is in progress.
  heartbeat?(state: { wake: TWake; fenceToken?: string }): Promise<void>
  // Optional progress checkpoint(s), expected to be monotonic per source.
  checkpoint?(
    checkpoints: CheckpointContract[],
    state: { wake: TWake; fenceToken?: string }
  ): Promise<void>
  // Mark completion for this wake. done=false means "more work exists".
  complete?(state: { wake: TWake; fenceToken?: string }, result: { done: boolean }): Promise<void>
  // Optional terminal failure callback.
  fail?(state: { wake: TWake; fenceToken?: string }, error: Error): Promise<void>
}
```

`runWithLifecycle()` wraps a unit of work with this handshake:

```typescript
await runWithLifecycle(wakePayload, lifecycleAdapter, async (session) => {
  const drained = await drainUntilIdle({
    hasPendingWork: async () => hasPendingRows(),
    runCycle: async () => runAgentCycle(),
    maxDurationMs: 25_000,     // fit serverless request budget
    maxIterations: 50,         // safety against runaway loops
    lifecycle: {
      heartbeat: () => session.heartbeat(),
      checkpoint: (rows) => session.checkpoint(rows),
    },
    buildCheckpoint: async () => getCurrentCheckpoints(),
  })

  await session.complete({ done: drained.completed })
})
```

`drainUntilIdle()` is intentionally transport-agnostic. It runs generation cycles until there is no pending work or limits are reached, returning `completed: true|false` so the caller/runtime can decide whether to re-wake immediately.

**Durable Streams Webhooks mapping (example adapter):**

- `claimWake` ↔ callback claim with `epoch` + `wake_id`
- `heartbeat` ↔ empty callback `{}` to reset liveness timer
- `checkpoint` ↔ callback `acks: [{ path, offset }]`
- `complete({ done })` ↔ callback `{ done: true }` when drain finishes

`durableStreamsWebhookAdapter()` packages this mapping as an optional helper. This keeps Durable Streams-specific semantics out of core agent APIs while still making them first-class through composition.

**Callback sequencing requirements (Durable Streams helper):**

- First callback must claim wake (`epoch` + `wake_id`)
- Subsequent callbacks rotate token from latest response
- Long-running work sends periodic heartbeat callbacks even when no new acks are emitted
- `checkpoint()` batches monotonic acks per source path
- `complete({ done: true })` marks consumer idle; `complete({ done: false })` allows immediate re-wake

#### Durable Streams Webhook Runtime Modes

Durable Streams webhook consumers must support **two execution modes**:

1. **Request-bound drain**: claim wake + run generation/drain during the webhook request lifetime, then respond when the cycle is done (or request budget is exhausted).
2. **Immediate-ack wake**: respond immediately to webhook delivery, then continue processing out-of-band using callback claim + heartbeat + checkpoint + done.

Both modes use the same lifecycle primitives; only request/response timing differs.

```typescript
type WebhookExecutionMode =
  | { type: 'request-bound'; maxRequestMs?: number }
  | { type: 'ack-immediate'; status?: 200 | 202 }
```

**Mode behavior:**

- **Request-bound drain**
- Webhook handler may keep request open while running `drainUntilIdle()`
- Must still use callback claim/checkpoint/complete when work spans multiple cycles or approaches timeout
- Recommended for Durable Objects / long-lived isolates that can safely run for the request duration

- **Immediate-ack wake**
- Webhook handler returns immediately (`200` or `202`)
- Background runner calls `runWithLifecycle()` to claim wake, send heartbeats, checkpoint offsets, and `complete({ done })`
- Required for short-lived edge workers where request lifetime is too short for full drain

In both modes, callback mechanics (`claimWake`, `heartbeat`, `checkpoint`, `complete`) are identical and required for correctness under retries and liveness timeouts.

#### Convenience Wrapper: durableChat()

For common use cases, `durableChat()` combines `chat()`, `makeDurableTools()`, and `streamToCollection()`:

```typescript
import { durableChat } from '@tanstack/ai-db'

// All-in-one: durable tools + chunk streaming
const result = await durableChat({
  // Standard chat options (passed to TanStack AI)
  adapter: openaiText('gpt-4o'),
  messages: [{ role: 'user', content: 'Search for recent orders' }],
  
  // Tool definitions
  tools: [searchTool, analysisTool],
  
  // Durable tool configuration
  toolCalls: {
    collection: toolCallsCollection,
    transform: (tc, genId) => ({ ...tc, status: 'pending', generationId: genId }),
    isComplete: (row) => row.status === 'completed' || row.status === 'failed',
    getResult: (row) => row.status === 'failed' ? Promise.reject(row.error) : row.result,
    timeout: 60_000,
  },
  
  // Optional: chunk streaming
  chunks: {
    collection: chunksCollection,
    generationId: 'gen-123',
    transform: (chunk, index, genId) => ({
      id: `${genId}-${index}`,
      generationId: genId,
      index,
      content: chunk.type === 'TEXT_MESSAGE_CONTENT' ? chunk.delta : '',
    }),
  },
  
  abortController,
})

console.log(result)  // Final response text (string)
```

**Implementation:**

```typescript
async function durableChat(options) {
  const {
    adapter, messages, tools = [],
    toolCalls, chunks, abortController, ...chatOptions
  } = options
  
  // Wrap tools to make them durable
  const durableTools = tools.length > 0 && toolCalls
    ? makeDurableTools(tools, toolCalls.collection, {
        transform: toolCalls.transform,
        isComplete: toolCalls.isComplete,
        getResult: toolCalls.getResult,
        timeout: toolCalls.timeout,
      })
    : tools
  
  // Get chat stream (model is baked into the adapter)
  const stream = chat({
    adapter,
    messages,
    tools: durableTools,
    abortController,
    ...chatOptions,
  })
  
  // If chunk streaming requested, persist chunks
  if (chunks) {
    return streamToCollection(stream, chunks)
  }
  
  // Otherwise, consume the stream and assemble final text
  let content = ''
  for await (const chunk of stream) {
    if (chunk.type === 'TEXT_MESSAGE_CONTENT') {
      content += chunk.delta
    }
  }
  
  return { content }
}
```

**When to use each level:**

| Pattern | Use Case |
|---------|----------|
| `chat()` + manual tool handling | Full control, custom tool execution |
| `chat()` + `makeDurableTools()` | Durable tools, custom streaming |
| `durableChat()` | Batteries-included durable generation |
| `createGenerationEffect()` + primitives | Effect-triggered generation (multi-agent) |
| `createAgent()` | Persistent reactive agent with ongoing identity and history (Phase 2) |
| `createWorkerAgent()` | Ephemeral task-scoped agent used as a tool (Phase 2) |

### Phase 2: Agent Abstractions

_Persistent agents and worker agents built on Phase 1 primitives, using TanStack's composition pattern for configuration._

#### The Composition Pattern

Following TanStack DB's established pattern where `createCollection(electricCollectionOptions({...}))` composes a constructor with an option factory, agents use the same idiom:

```typescript
// TanStack DB collection pattern
createCollection(electricCollectionOptions({...}))
createCollection(queryCollectionOptions({...}))

// Agent pattern — same idiom
createAgent(durableAgent({...}))     // Factory: batteries-included
createAgent({ pendingWork, generate, ... })    // Raw AgentConfig: full control
```

`createAgent` accepts an `AgentConfig` — the standard interface. Option factories like `durableAgent()` produce `AgentConfig` from simpler, specialized inputs. Users can also construct `AgentConfig` manually for full control.

#### Agent Overview

Phase 2 provides two distinct agent abstractions for multi-agent coordination: **persistent agents** (`createAgent`) and **worker agents** (`createWorkerAgent`). These are fundamentally different entities with different lifecycles, state models, and usage patterns.

| Aspect | `createAgent` (persistent) | `createWorkerAgent` (ephemeral) |
|--------|---------------------------|--------------------------------|
| Lifecycle | Long-lived, accumulates history | Fresh instance per invocation |
| Identity | Singleton entity with ongoing state | No identity between calls |
| Trigger | Reactive (watches collections for pending work) | Called directly via `.run()` or used as a tool |
| Context | Full conversation history | Only what's passed as input |
| Memory | Remembers past interactions | Stateless between calls |
| Usage | Insert message rows into collections/streams | `worker.run(input)` or placed in another agent's tool list |
| After call | Still alive, waiting for next work | Context discarded |
| Crash recovery | Resumes where it left off (pending work still in collection) | Re-run from start (idempotent) |
| Analogy | A colleague you message | A contractor you hire for one job |

**v1 Execution Model — Single Active Runner:**

In v1, each `(session, agent)` pair has at most **one active runner**. If an agent is instantiated on multiple devices/servers, only one should be actively processing the generation loop. Base `createAgent()` stays transport-agnostic; deployments that need explicit wake fencing (webhooks/queues) should use Phase 1 runner lifecycle primitives (`runWithLifecycle` + `RunnerLifecycleAdapter`) to enforce this at runtime boundaries.

Applications requiring multiple concurrent runners per agent (e.g., horizontal scaling) should implement coordination at the application or sync-backend layer. Distributed coordination is deferred to future work (Phase 4).

#### `AgentConfig` — The Standard Interface

`createAgent` accepts `AgentConfig`, which has **two overloads** discriminated by the presence of `collections`. The agent's data interface is focused purely on **messages** — tool call durability, chunk streaming, and generation tracking are composable Phase 1 concerns (see "Composing Concerns" below).

**Path 1: Collection-Based** — Agent reads/writes a messages collection directly. The collection must conform to `AgentMessage` schema. This is what option factories like `durableAgent()` produce.

```typescript
type AgentGenerate<TRow extends object> = (input: {
  pending: TRow[]
  messages: ModelMessage[]
  adapter: AnyTextAdapter
  tools: Tool[]
  instructions: string
  signal: AbortSignal
  context: AgentContext
}) => Promise<string>

interface CollectionAgentConfig {
  name: string
  instructions: string
  adapter: AnyTextAdapter          // Model baked in: openaiText('gpt-4o')
  tools?: Tool[]                   // External tools (optionally durable via makeDurableTools)
  agents?: AgentReference[]        // Agent collaborators (coordination via messages)
  description?: string

  collections: {
    messages: Collection<AgentMessage>
  }

  // Required in raw createAgent() configs.
  // durableAgent() provides a default implementation.
  generate: AgentGenerate<AgentMessage>

  // Optional overrides (agent provides built-in defaults for these)
  pendingWork?: EffectQueryInput<any>  // Override which rows drive the loop
  buildMessages?: (pending: AgentMessage[], ctx: AgentContext) => Promise<ModelMessage[]>
  onResponse?: (response: string, pending: AgentMessage[], ctx: AgentContext) => Promise<void>
  onError?: (error: Error, pending: AgentMessage[], ctx: AgentContext) => Promise<void>
}
```

**Path 2: Query/Mutation-Based** — Agent reads via user-provided query functions and writes via mutation callbacks. User handles all schema mapping. This is how you share a single collection across multiple agents with different views.

```typescript
interface QueryAgentConfig<TRow extends object = Record<string, unknown>> {
  name: string
  instructions: string
  adapter: AnyTextAdapter          // Model baked in: openaiText('gpt-4o')
  tools?: Tool[]
  agents?: AgentReference[]
  description?: string

  // NO collections property — this discriminates from Path 1

  // Read paths (required) — standard query builder functions
  pendingWork: EffectQueryInput<any>  // Drives the reactive effect loop
  buildMessages: (pending: TRow[], ctx: AgentContext) => Promise<ModelMessage[]>  // Builds LLM context

  // Generation path (required)
  generate: AgentGenerate<TRow>

  // Write paths (required) — user-controlled mutations
  onResponse: (response: string, pending: TRow[], ctx: AgentContext) => Promise<void>

  // Optional
  watchForResponse?: (requestId: string, opts: { timeout: number; callerName: string }) => Promise<{ content: string }>
  onError?: (error: Error, pending: TRow[], ctx: AgentContext) => Promise<void>
}
```

In raw `createAgent({...})` usage, `generate` is always required so generation behavior is explicit. Option factories like `durableAgent(...)` fill it in with a default `chat()` implementation.

**When to use each path:**

| Path | Use Case |
|------|----------|
| Collection-based | Your collection conforms to `AgentMessage`. Simplest. This is what factories produce. |
| Query/Mutation | Custom schema, shared collections, complex projections. |

**Queries + mutations ARE the schema projection.** No custom field mapping abstraction is needed. The standard query builder's `.select()`, `.where()`, `.orderBy()` serve as the read projection. Mutation callbacks in `onResponse` call the user's own `collection.insert()` / `.update()` with the user's own field names.

#### `AgentMessage` Schema

The canonical message shape for the collection-based path:

```typescript
interface AgentMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  targetAgent: string        // Which agent this message is addressed to
  actorId: string            // Who sent this (user ID or agent name)
  processed: boolean         // Whether the target agent has processed this
  createdAt: string          // ISO timestamp
  generationId?: string      // Links to generation that produced this
  requestId?: string         // Correlation ID for agent-to-agent calls
  inReplyTo?: string         // requestId this message is responding to
}
```

**Agent-to-agent correlation:** When agent A asks agent B a question, the message carries a `requestId`. Agent B's response carries `inReplyTo` set to that `requestId`. This enables the caller to match responses to requests and is the foundation for timeout, retry, and lifecycle tracking.

In the query/mutation path, users never see this type — they project their own schema via queries and write back via mutations.

#### Two Kinds of Callable Things: `tools` vs `agents`

Agent-to-agent communication goes through **messages** (collections). External tool calls go through the **tool execution** layer. These are fundamentally different coordination paths and must not be conflated in a single `tools` array.

```typescript
const planner = createAgent(durableAgent({
  name: 'planner',
  instructions: '...',
  adapter: openaiText('gpt-4o'),
  streamUrl: '...',

  // External tools — stateless functions, optionally made durable
  tools: makeDurableTools([searchTool, calcTool], toolCallsCol, {...}),

  // Agent references — coordination via messages, inherently durable
  agents: [
    { agent: researcher, description: 'Research topics thoroughly' },
    { agent: writer, description: 'Write clear, concise content' },
  ],
}))
```

Both `tools` and `agents` are presented to the LLM as tool definitions, but handled through different internal paths:

- **`tools`**: Tool calls go through the tool execution path (and optionally through the `makeDurableTools` persistence layer). These are external actions — database queries, API calls, file reads.
- **`agents`**: Agent calls are translated into messages. The calling agent's LLM produces a tool call; internally, the agent inserts a message into the target agent's inbox and watches for a response message. The messaging layer IS the durability — no `makeDurableTools` wrapping needed.

This separation prevents double-wrapping (where an agent tool call would be persisted in both a `toolCalls` collection AND a `messages` collection). It also provides a natural extension point — `AgentReference` can grow agent-specific configuration without polluting the tools interface:

```typescript
interface AgentReference {
  agent: Agent
  description: string
  inputSchema?: SchemaInput   // Default: z.object({ message: z.string() })
  outputSchema?: SchemaInput  // Default: z.object({ response: z.string() })
  timeout?: number            // Max wait for response (default: 120_000ms)
  // Required when the target agent does not expose collections.messages
  // (for example query/mutation path with custom schema).
  insertMessage?: (message: {
    content: string
    actorId: string
    requestId?: string
    inReplyTo?: string
  }) => Promise<void>
  // Future extension points:
  // async?: boolean           // fire-and-forget vs wait-for-response
  // retryPolicy?: ...
  // contextSharing?: ...
}
```

#### Composing Concerns

The agent's core job is its generation loop: detect pending work → build context → generate → write response. Everything else is a composable Phase 1 concern:

**Tool call durability** — `makeDurableTools()` wraps external tools before passing to the agent. The agent doesn't know or care if tools are durable:

```typescript
const durableTools = makeDurableTools([searchTool], toolCallsCol, {
  transform: (tc, genId) => ({ ...tc, status: 'pending', generationId: genId }),
  isComplete: (row) => row.status === 'completed',
  getResult: (row) => row.result,
})

const agent = createAgent(durableAgent({
  tools: durableTools,   // Already durable — agent doesn't know
  // ...
}))
```

**Chunk streaming** — The `durableAgent()` factory composes `streamToCollection()` internally. In the raw path, users set this up themselves or omit it.

**Generation tracking** — The `durableAgent()` factory records generation metadata in an internal collection. In the raw path, users can track this in `onResponse` or omit it.

**Runner lifecycle integration** — `durableAgent()` can compose `runWithLifecycle()` + `drainUntilIdle()` with an optional runtime adapter. This enables protocol-specific wake/ack behavior (for example Durable Streams webhooks in either request-bound or immediate-ack mode) without coupling `createAgent()` to transport semantics.

##### `createAgent()` — Persistent Reactive Agent

A persistent agent is a **live reactive entity** backed by collections. It has an identity, accumulates history across interactions, and runs its own generation loop driven by reactive effects. When there is pending work in its inbox, it generates. When its inbox is empty, it goes idle. When new work arrives—even while mid-generation—it picks it up in the next loop iteration.

The returned `Agent` instance exposes loop controls for runtime integration: `hasPendingWork()`, `runGenerationCycle()`, and `drainUntilIdle(...)`.

**The Generation Loop as a State Machine:**

```
                    ┌─────────────────────────┐
                    │                         │
                    ▼                         │
              ┌──────────┐                    │
              │   IDLE   │                    │
              └────┬─────┘                    │
                   │ message arrives          │
                   │ (effect fires)           │
                   ▼                          │
              ┌──────────┐                    │
              │ BUILDING │ ← buildMessages()  │
              │ CONTEXT  │                    │
              └────┬─────┘                    │
                   │                          │
                   ▼                          │
              ┌──────────┐                    │
              │GENERATING│ ← chat() w/ tools  │
              │          │   (tool calls      │
              │          │    handled         │
              │          │    internally)     │
              └────┬─────┘                    │
                   │ writes response          │
                   ▼                          │
              ┌──────────┐     new work?      │
              │  CHECK   │────── yes ─────────┘
              │  INBOX   │
              └────┬─────┘
                   │ no
                   ▼
              ┌──────────┐
              │   IDLE   │ ← waits for next trigger
              └──────────┘
```

**Example — Quick-start with `durableAgent` factory:**

```typescript
import { createAgent, durableAgent } from '@tanstack/ai-db'
import { openaiText } from '@tanstack/ai'

// Batteries-included: factory creates messages collection with Durable Streams sync,
// provides default pendingWork, buildMessages, generate, onResponse, and
// composes chunk streaming + generation tracking internally.
const researcher = createAgent(durableAgent({
  name: 'researcher',
  instructions: 'You are a thorough research assistant. Search for information and provide detailed, well-sourced answers.',
  adapter: openaiText('gpt-4o'),
  tools: [searchTool, readFileTool],
  streamUrl: 'https://streams.example.com/sessions/session-123',
}))

// The agent is now LIVE — watching for work.
researcher.collections.messages.insert({
  role: 'user',
  actorId: 'user-123',
  targetAgent: researcher.name,
  content: 'What are the latest advances in quantum computing?',
})

// Send another while it's thinking — this just queues
researcher.collections.messages.insert({
  role: 'user',
  actorId: 'user-123',
  targetAgent: researcher.name,
  content: 'Also check the ArXiv papers from this week',
})
// This message lands in the collection.
// When current generation finishes → effect re-evaluates →
// sees this unprocessed message → loops again immediately.

// Clean up when done
researcher.dispose()
```

**Example — Collection-based with explicit config (AgentMessage schema):**

```typescript
import { createAgent, makeDurableTools } from '@tanstack/ai-db'
import { chat, openaiText } from '@tanstack/ai'
import { createCollection, eq, and, or, queryOnce } from '@tanstack/db'

// Messages collection conforming to AgentMessage schema
const messages = createCollection({ schema: AgentMessageSchema, sync: { /* ... */ } })

// Optionally make tools durable (Phase 1 concern, composed separately)
const durableTools = makeDurableTools([searchTool, readFileTool], toolCallsCol, {
  transform: (tc, genId) => ({ ...tc, status: 'pending', generationId: genId }),
  isComplete: (row) => row.status === 'completed',
  getResult: (row) => row.result,
})

const researcher = createAgent({
  name: 'researcher',
  instructions: 'You are a thorough research assistant.',
  adapter: openaiText('gpt-4o'),
  tools: durableTools,

  // Collection-based path: just messages
  collections: { messages },

  // Optional overrides (agent has built-in defaults for AgentMessage schema).
  // `generate` is still required in raw createAgent() usage.
  buildMessages: async (pending, ctx) => {
    const history = await queryOnce((q) =>
      q.from({ m: ctx.collections.messages })
        .where(({ m }) => or(
          eq(m.targetAgent, ctx.agentName),
          eq(m.actorId, ctx.agentName),
        ))
        .orderBy(({ m }) => m.createdAt)
        .limit(100)
    )
    return history.map(m => ({ role: m.role, content: m.content }))
  },

  // Required in raw createAgent() configs
  generate: async ({ messages, tools, adapter, instructions, signal }) => {
    const abortController = new AbortController()
    signal.addEventListener('abort', () => abortController.abort())
    return chat({
      adapter,
      systemPrompts: [instructions],
      messages,
      tools,
      abortController,
      stream: false,
    })
  },
})

messages.insert({
  role: 'user',
  actorId: 'user-123',
  targetAgent: researcher.name,
  content: 'What are the latest advances in quantum computing?',
})
researcher.dispose()
```

**Example — Query/mutation-based with custom schema:**

```typescript
// User has their own messages collection with a different schema
const messages = createCollection(electricCollectionOptions({
  shapeOptions: { url: '...', params: { table: 'messages' } },
  getKey: (m) => m.id,
  schema: MyMessageSchema,  // { id, body, sender, recipient, type, handled, ts }
}))

const researcher = createAgent({
  name: 'researcher',
  instructions: 'You are a thorough research assistant.',
  adapter: openaiText('gpt-4o'),
  tools: [searchTool],

  // Read: query functions project user schema to what the agent needs
  pendingWork: (q) => q
    .from({ m: messages })
    .where(({ m }) => and(
      eq(m.recipient, 'researcher'),
      eq(m.handled, false),
      eq(m.$synced, true),
    )),

  buildMessages: async (pending, ctx) => {
    const history = await queryOnce((q) =>
      q.from({ m: messages })
        .where(({ m }) => or(eq(m.recipient, 'researcher'), eq(m.sender, 'researcher')))
        .orderBy(({ m }) => m.ts)
        .limit(100)
    )
    return history.map(m => ({ role: m.type, content: m.body }))
  },

  generate: async ({ messages, tools, adapter, instructions, signal }) => {
    const abortController = new AbortController()
    signal.addEventListener('abort', () => abortController.abort())
    return chat({
      adapter,
      systemPrompts: [instructions],
      messages,
      tools,
      abortController,
      stream: false,
    })
  },

  // Write: mutation callbacks use user's own collection API
  onResponse: async (response, pending, ctx) => {
    for (const msg of pending) {
      messages.update(msg.id, (draft) => { draft.handled = true })
    }
    await messages.insert({
      id: crypto.randomUUID(),
      type: 'assistant',
      body: response,
      sender: 'researcher',
      recipient: 'researcher',
      handled: true,
      ts: new Date().toISOString(),
    })
  },
})
```

**How `createAgent` works internally:**

```typescript
function createAgent(options: AgentConfig): Agent {
  const {
    name,
    instructions,
    adapter,
    tools = [],
    agents = [],
    description,
    generate,
  } = options

  // Resolve data interface: collection-based or query/mutation-based
  const hasCollections = 'collections' in options && options.collections
  const pendingWork = hasCollections
    ? options.pendingWork ?? defaultPendingWork(name, options.collections.messages)
    : options.pendingWork
  const buildMessages = hasCollections
    ? options.buildMessages ?? defaultBuildMessages(name, options.collections.messages)
    : options.buildMessages
  const onResponse = hasCollections
    ? options.onResponse ?? defaultOnResponse(name, options.collections.messages)
    : options.onResponse
  const onError = options.onError

  // Convert agent references into tool definitions.
  // These tools coordinate through messages, not the tool execution layer.
  const agentTools = agents.map(ref => agentRefToTool(ref, options))

  // Combine external tools + agent tools for the LLM
  const allTools = [...tools, ...agentTools]

  const runGenerationCycleInternal = async (
    pendingRows: unknown[],
    signal: AbortSignal,
  ) => {
    if (pendingRows.length === 0) {
      return
    }

    const agentCtx: AgentContext = {
      agentName: name,
      collections: hasCollections ? options.collections : undefined,
      signal,
    }

    try {
      const llmMessages = await buildMessages(pendingRows, agentCtx)
      const response = await generate({
        pending: pendingRows,
        messages: llmMessages,
        adapter,
        tools: allTools,
        instructions,
        signal,
        context: agentCtx,
      })

      await onResponse(response, pendingRows, agentCtx)
    } catch (error) {
      if (onError) {
        await onError(error as Error, pendingRows, agentCtx)
      } else {
        console.error(`Agent ${name} generation failed:`, error)
      }
    }
  }

  const hasPendingWork = async () => {
    const rows = await queryOnce((q) => pendingWork(q).limit(1))
    return rows.length > 0
  }

  const runGenerationCycle = async () => {
    const pendingRows = await queryOnce((q) => pendingWork(q).limit(50))
    await runGenerationCycleInternal(pendingRows, new AbortController().signal)
  }

  // Create the reactive effect that drives the generation loop.
  // The effect fires when rows enter the pendingWork query result set.
  // batchHandler receives all new pending rows at once per graph run.
  const effect = createEffect({
    query: pendingWork,
    on: 'enter',
    batchHandler: async (events, ctx) => {
      await runGenerationCycleInternal(
        events.map((e) => e.value),
        ctx.signal,
      )
    },
  })

  const drainAgent = (options?: {
    maxIterations?: number
    maxDurationMs?: number
    lifecycle?: {
      heartbeat?: () => Promise<void>
      checkpoint?: (checkpoints: CheckpointContract[]) => Promise<void>
    }
    buildCheckpoint?: () => Promise<CheckpointContract[]>
  }) =>
    drainUntilIdle({
      hasPendingWork,
      runCycle: runGenerationCycle,
      ...options,
    })

  return {
    name,
    collections: hasCollections ? options.collections : undefined,
    hasPendingWork,
    runGenerationCycle,
    drainUntilIdle: drainAgent,
    watchForResponse: (requestId, opts) => {
      if (hasCollections) {
        // Collection-based: use default implementation that queries messages collection
        return defaultWatchForResponse({ name, collections: options.collections } as Agent, requestId, opts)
      } else if (options.watchForResponse) {
        // Query/mutation path: delegate to user-provided callback
        return options.watchForResponse(requestId, opts)
      } else {
        throw new Error(
          `Agent "${name}" has no watchForResponse() callback. ` +
          `In query/mutation mode, provide a watchForResponse callback to support agent-to-agent calls.`
        )
      }
    },
    dispose: () => effect.dispose(),
  }
}

// Agent reference → LLM tool definition (coordination via messages)
function agentRefToTool(ref: AgentReference, callerOptions: AgentConfig): Tool {
  const inputSchema = ref.inputSchema ?? z.object({ message: z.string() })
  const outputSchema = ref.outputSchema ?? z.object({ response: z.string() })
  const timeout = ref.timeout ?? 120_000  // Default 2 minute timeout

  return {
    name: ref.agent.name,
    description: ref.description,
    inputSchema,
    outputSchema,
    execute: async (args) => {
      // 1. Write message to target agent's inbox with a requestId for correlation
      const requestId = crypto.randomUUID()
      const content = args.message ?? JSON.stringify(args)

      if (ref.agent.collections?.messages) {
        await ref.agent.collections.messages.insert({
          targetAgent: ref.agent.name,
          role: 'user',
          content,
          actorId: callerOptions.name,
          requestId,
        })
      } else if (ref.insertMessage) {
        await ref.insertMessage({
          content,
          actorId: callerOptions.name,
          requestId,
        })
      } else {
        throw new Error(
          `Agent reference '${ref.agent.name}' cannot accept message writes. ` +
          `Provide AgentReference.insertMessage for custom-schema/query-mutation targets.`
        )
      }

      // 2. Watch for a response message with inReplyTo === requestId
      // Uses the agent's watchForResponse method, which:
      // - Collection-based agents: creates a live query on collections.messages
      // - Query/mutation agents: delegates to user-provided watchForResponse callback
      const response = await ref.agent.watchForResponse(requestId, {
        timeout,
        callerName: callerOptions.name,
      })
      return { response: response.content }
    },
  }
}

// Default watchForResponse implementation for collection-based agents.
// For query/mutation agents, the user provides their own watchForResponse callback.
function defaultWatchForResponse(
  targetAgent: Agent,
  requestId: string,
  opts: { timeout: number; callerName: string },
): Promise<{ content: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      effect.dispose()
      reject(new Error(
        `Agent '${targetAgent.name}' did not respond within ${opts.timeout}ms (requestId: ${requestId})`
      ))
    }, opts.timeout)

    const effect = createEffect({
      query: (q) => q
        .from({ m: targetAgent.collections!.messages })
        .where(({ m }) => and(
          eq(m.actorId, targetAgent.name),
          eq(m.targetAgent, opts.callerName),
          eq(m.inReplyTo, requestId),
        )),
      on: 'enter',
      handler: (event) => {
        clearTimeout(timer)
        effect.dispose()
        resolve({ content: event.value.content })
      },
    })
  })
}
```

**Note on agent-to-agent coordination:** When a persistent agent uses another agent (via the `agents` config), coordination happens through **messages**, not through a `toolCalls` collection. The calling agent's LLM produces a tool call; internally, `agentRefToTool` writes a message row to the target agent's inbox with a unique `requestId`. The target agent processes it through its own generation loop and writes a response with `inReplyTo` set to the `requestId`. The caller uses `agent.watchForResponse()` to observe the response.

- **Collection-based agents:** `watchForResponse` uses a live query effect on `collections.messages` (provided by `defaultWatchForResponse`).
- **Query/mutation-based agents:** Users must provide a `watchForResponse` callback in config and an `AgentReference.insertMessage` callback when wiring collaborators, so agent-to-agent calls can write inbox rows and observe replies with custom schemas.

This means agent-to-agent durability comes for free from the messaging layer — no `makeDurableTools` wrapping is needed, and there is no double-wrapping of persistence.

**Timeout and failure behavior:** If the target agent does not respond within the configured `timeout` (default: 120s), `watchForResponse` rejects with an error. The calling agent's LLM receives this as a tool failure and can retry or report the error. Retries are not automatic — the LLM decides whether to call the tool again based on the error.

**Multi-agent session — shared collection, query/mutation path:**

```typescript
// One shared messages collection with user-defined schema
const messages = createCollection(electricCollectionOptions({
  shapeOptions: { url: '...', params: { table: 'messages' } },
  getKey: (m) => m.id,
}))

const generateWithChat = async ({ messages, tools, adapter, instructions, signal }) => {
  const abortController = new AbortController()
  signal.addEventListener('abort', () => abortController.abort())
  return chat({
    adapter,
    systemPrompts: [instructions],
    messages,
    tools,
    abortController,
    stream: false,
  })
}

// Each agent gets a different query view over the same collection
const researcher = createAgent({
  name: 'researcher',
  instructions: 'You research topics thoroughly...',
  adapter: openaiText('gpt-4o'),
  tools: [searchTool],

  pendingWork: (q) => q
    .from({ m: messages })
    .where(({ m }) => and(
      eq(m.targetAgent, 'researcher'),
      eq(m.processed, false),
      eq(m.$synced, true),
    )),
  buildMessages: async (pending, ctx) => {
    const history = await queryOnce((q) =>
      q.from({ m: messages })
        .where(({ m }) => or(
          eq(m.targetAgent, 'researcher'),
          eq(m.actorId, 'researcher'),
        ))
        .orderBy(({ m }) => m.createdAt)
        .limit(100)
    )
    return history.map(m => ({ role: m.role, content: m.content }))
  },
  generate: generateWithChat,
  onResponse: async (response, pending, ctx) => {
    for (const msg of pending) messages.update(msg.id, (draft) => { draft.processed = true })
    await messages.insert({
      id: crypto.randomUUID(), targetAgent: 'researcher', role: 'assistant',
      content: response, actorId: 'researcher',
      processed: true, createdAt: new Date().toISOString(),
    })
  },
})

const writer = createAgent({
  name: 'writer',
  instructions: 'You write clear, concise content...',
  adapter: openaiText('gpt-4o'),

  pendingWork: (q) => q
    .from({ m: messages })
    .where(({ m }) => and(
      eq(m.targetAgent, 'writer'),
      eq(m.processed, false),
      eq(m.$synced, true),
    )),
  buildMessages: async (pending, ctx) => {
    const relevant = await queryOnce((q) =>
      q.from({ m: messages })
        .where(({ m }) => or(
          eq(m.targetAgent, 'writer'),
          eq(m.actorId, 'researcher'),
        ))
        .orderBy(({ m }) => m.createdAt)
        .limit(50)
    )
    return relevant.map(m => ({ role: m.role, content: m.content }))
  },
  generate: generateWithChat,
  onResponse: async (response, pending, ctx) => { /* ... */ },
})

// Planner uses agents property — coordination via messages, no double-wrapping
const planner = createAgent({
  name: 'planner',
  instructions: 'You coordinate research and writing tasks...',
  adapter: openaiText('gpt-4o'),

  // External tools — optionally durable
  tools: makeDurableTools([searchTool], toolCallsCol, { /* ... */ }),

  // Agent collaborators — coordination via messages (inherently durable)
  agents: [
    { agent: researcher, description: 'Ask researcher to investigate (it remembers past work)' },
    { agent: writer, description: 'Ask writer to draft content' },
  ],

  pendingWork: (q) => q
    .from({ m: messages })
    .where(({ m }) => and(
      eq(m.targetAgent, 'planner'),
      eq(m.processed, false),
      eq(m.$synced, true),
    )),
  buildMessages: async (pending, ctx) => { /* ... */ },
  generate: generateWithChat,
  onResponse: async (response, pending, ctx) => { /* ... */ },
})
```

**Key design decisions:**

- The agent is live from creation — no `.start()` needed. The effect begins watching immediately, matching how `createEffect()` works in the reactive effects system.
- `pendingWork` is a user-defined query — users control their schema and what constitutes "work" for each agent.
- `buildMessages` gives the agent full control over its context window — it can see the entire conversation, filter by relevance, apply summarization, or anything else.
- `generate` is explicit in raw `createAgent({...})` configs, so the generation strategy is always intentional. `durableAgent(...)` supplies a default chat-based implementation.
- `tools` and `agents` are separate config properties — tools go through the tool execution path (optionally durable via `makeDurableTools`), agents coordinate through messages (inherently durable). No double-wrapping risk.
- Runtime integrations can use `agent.hasPendingWork()`, `agent.runGenerationCycle()`, or `agent.drainUntilIdle(...)` directly instead of wiring external helper functions.
- The generation loop is entirely event-driven via reactive effects — no polling, no `while(true)` loop.

**Effect Batching and Loop Semantics:**

The agent's internal `batchHandler` receives all rows currently in the `pendingWork` query result set — not one row at a time. If a user sends 3 messages rapidly before the agent starts generating, the agent sees all 3 in a single `pending` array and builds one generation context. If a message arrives _during_ generation, the effect system detects the new row after the current handler completes and fires again with the new pending work. This means:

- Multiple pending items are batched into one generation cycle (efficient)
- Items arriving mid-generation are handled in the next cycle (no dropped messages)
- The effect system's delta tracking ensures no duplicate processing

**Error Handling:**

When generation fails (LLM error, network timeout, `buildMessages` throws):

1. The `try/catch` in the internal implementation logs the error
2. Pending work rows remain unprocessed (they're still in the `pendingWork` query)
3. On the next relevant change, the effect re-fires and retries
4. For persistent failures, Phase 3 recovery can detect stuck agents (generations in `generating` state past a timeout) and mark them as failed
5. Users can provide an optional `onError` callback for custom error handling:

```typescript
createAgent({
  // ...
  generate: async ({ messages, tools, adapter, instructions, signal }) => {
    const abortController = new AbortController()
    signal.addEventListener('abort', () => abortController.abort())
    return chat({
      adapter,
      systemPrompts: [instructions],
      messages,
      tools,
      abortController,
      stream: false,
    })
  },
  onError: async (error, pending, ctx) => {
    // Custom: mark pending work as failed, notify user, etc.
    console.error(`Agent ${ctx.agentName} failed:`, error)
  },
})
```

**Idle Detection and Sleep/Wake:**

The agent is idle when its `pendingWork` query returns zero rows. The reactive effect system naturally handles this — the effect simply doesn't fire when there are no matching rows. For sleep/wake:

- The agent _itself_ doesn't need to know about sleep/wake — it's an infrastructure concern
- The platform disposes the agent when idle (e.g., Durable Object alarm after N seconds of no activity)
- On wake, the agent is re-created from scratch — all state is in collections
- The `pendingWork` query will immediately surface any work that arrived while sleeping

```typescript
// Example: Durable Object with idle timeout
export class AgentDO extends DurableObject {
  private agent?: Agent
  private idleAlarm?: ReturnType<typeof setTimeout>

  async wake() {
    this.agent = createAgent(durableAgent({
      name: 'researcher',
      instructions: '...',
      adapter: openaiText('gpt-4o'),
      tools: [searchTool],
      streamUrl: '...',
    }))
    this.resetIdleTimer()
  }

  private resetIdleTimer() {
    clearTimeout(this.idleAlarm)
    this.idleAlarm = setTimeout(() => this.sleep(), 60_000) // Sleep after 60s idle
  }

  async sleep() {
    this.agent?.dispose()
    this.agent = undefined
  }
}
```

For webhook-driven serverless consumers, pair the agent with a lifecycle adapter. The agent remains the same; only wake/ack mechanics change:

```typescript
const wakeAdapter = durableStreamsWebhookAdapter({
  verifySignature: async (req) => verifyWebhookSignature(req, env.WEBHOOK_SECRET),
  mode: { type: 'ack-immediate', status: 202 },
  heartbeatIntervalMs: 10_000,
  postCallback: (wake, body, token) =>
    postToDurableStreamsCallback(wake.callback, body, token),
})

const agent = createAgent(durableAgent({
  name: 'researcher',
  instructions: '...',
  adapter: openaiText('gpt-4o'),
  streamUrl: env.STREAM_URL,
  runtime: {
    wakeAdapter,
    drain: { maxDurationMs: 25_000, maxIterations: 50 },
  },
}))

// Mode 1: request-bound drain (do work during webhook request lifetime)
async function handleWebhookRequestBound(webhookWakePayload: DurableStreamsWakePayload) {
  const checkpointState = new Map(
    webhookWakePayload.streams.map((s) => [s.path, s.offset] as const),
  )

  const result = await runWithLifecycle(webhookWakePayload, wakeAdapter, async (session) => {
    const drained = await agent.drainUntilIdle({
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

  return new Response(
    JSON.stringify({ done: result.completed }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

// Mode 2: immediate-ack wake (respond now, process out-of-band)
async function handleWebhookAckImmediate(webhookWakePayload: DurableStreamsWakePayload) {
  const checkpointState = new Map(
    webhookWakePayload.streams.map((s) => [s.path, s.offset] as const),
  )

  queueMicrotask(async () => {
    await runWithLifecycle(webhookWakePayload, wakeAdapter, async (session) => {
      const drained = await agent.drainUntilIdle({
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

  return new Response(
    JSON.stringify({ accepted: true }),
    { status: 202, headers: { 'content-type': 'application/json' } },
  )
}
```

**Execution Context:**

Persistent agents are environment-agnostic and can run in any JavaScript context:

- **Browser main thread**: For client-side agents that interact with the UI
- **Web Workers**: For background processing without blocking the UI thread
- **Server (Node.js, Deno, Bun)**: For backend agents with access to server resources
- **Edge Workers (Cloudflare Workers, Vercel Edge)**: For low-latency, globally distributed agents
- **Durable Objects**: For agents that need strong consistency and single-instance guarantees

Because all communication happens via synced collections, different agents in the same session can run in entirely different environments.

**Sleep/Wake Lifecycle:**

Persistent agents support a sleep/wake lifecycle for resource-efficient deployment. When an agent has no pending work, it can be suspended — releasing compute resources. When new work arrives in its collections, the agent can be woken and resume processing.

```typescript
// Example: Agent running in a Cloudflare Durable Object
export class ResearcherAgent extends DurableObject {
  private agent?: Agent

  async wake() {
    // Rehydrate agent from collections (all state is in the sync layer)
    this.agent = createAgent(durableAgent({
      name: 'researcher',
      instructions: '...',
      adapter: openaiText('gpt-4o'),
      tools: [searchTool],
      streamUrl: this.env.STREAM_URL,
    }))
  }

  async sleep() {
    // Dispose agent — all state is already persisted in collections
    this.agent?.dispose()
    this.agent = undefined
  }

  // Webhook triggers wake
  async fetch(request: Request) {
    await this.wake()
    // Agent's reactive effect will pick up any pending work
    // After processing, agent can be put back to sleep
  }
}
```

Key aspects of sleep/wake:
- The wake mechanism is environment-specific — platforms use webhooks, DO alarms, queue triggers, or any event source
- Phase 1 lifecycle primitives provide a common handshake surface (claim/heartbeat/checkpoint/complete) across those wake mechanisms
- On wake, the agent rehydrates from collections (since all state is persisted in the sync layer)
- The sleep/wake cycle is transparent to callers — sending a message to a sleeping agent's inbox triggers a wake
- This enables cost-efficient deployment where agents only consume compute when there is work to do

##### `createWorkerAgent()` — Ephemeral Stateless Agent

A worker agent is a stateless, one-shot agent that runs a fresh task each invocation. It can be used in two ways:

1. **As a tool** — placed in another agent's tool list, called when the LLM decides to use it
2. **Directly** — invoked from application code via `.run()` (API endpoint, script, effect handler, cron job, etc.)

Each invocation creates a fresh generation context — no memory of previous calls. The worker agent runs its own internal `chat()` loop with its own tools, produces structured output, and returns it.

**Example — as a tool in another agent:**

```typescript
import { createWorkerAgent } from '@tanstack/ai-db'

const factChecker = createWorkerAgent({
  name: 'fact-checker',
  description: 'Verifies factual claims by searching for supporting and contradicting evidence',
  instructions: 'You verify claims. Search for both supporting and contradicting evidence. Be rigorous.',
  adapter: openaiText('gpt-4o-mini'),  // Can use a cheaper/faster model
  tools: [searchTool],

  // Input/output schemas
  inputSchema: z.object({
    claim: z.string().describe('The factual claim to verify'),
  }),
  outputSchema: z.object({
    verified: z.boolean(),
    confidence: z.number().min(0).max(1),
    evidence: z.array(z.string()),
    reasoning: z.string(),
  }),

  // Build messages from input — fresh each time, NO history
  buildMessages: (input) => [
    { role: 'user' as const, content: `Verify this claim: "${input.claim}"` },
  ],
})

// Use as a tool in a persistent agent's tool list
const researcher = createAgent({
  name: 'researcher',
  tools: [
    searchTool,
    factChecker,  // Sits alongside regular tools
  ],
  generate: async ({ messages, tools, adapter, instructions, signal }) => {
    const abortController = new AbortController()
    signal.addEventListener('abort', () => abortController.abort())
    return chat({
      adapter,
      systemPrompts: [instructions],
      messages,
      tools,
      abortController,
      stream: false,
    })
  },
  // ...
})
```

**Example — invoked directly from application code:**

```typescript
// Call directly from an API endpoint — no parent agent needed
app.post('/api/fact-check', async (req, res) => {
  const result = await factChecker.run({
    claim: req.body.claim,
  })
  // result: { verified: boolean, confidence: number, evidence: string[], reasoning: string }
  res.json(result)
})

// Call from a script
const result = await factChecker.run({ claim: 'The Earth is 4.5 billion years old' })
console.log(result.verified, result.reasoning)

// Call from an effect handler
createEffect({
  query: (q) => q.from({ r: reviewRequests }).where(/* ... */),
  on: 'enter',
  handler: async (event, ctx) => {
    const row = event.value
    const review = await codeReviewer.run({ code: row.code, language: row.language })
    reviewRequests.update(row.id, (draft) => {
      draft.status = 'done'
      draft.review = review
    })
  },
})
```

**With durable persistence (opt-in):**

```typescript
const factChecker = createWorkerAgent({
  name: 'fact-checker',
  description: 'Verifies factual claims',
  instructions: '...',
  adapter: openaiText('gpt-4o-mini'),
  tools: [searchTool],
  inputSchema: z.object({ claim: z.string() }),
  outputSchema: z.object({ verified: z.boolean(), evidence: z.array(z.string()) }),
  buildMessages: (input) => [
    { role: 'user', content: `Verify: "${input.claim}"` },
  ],

  // Optional: make worker agent's internal work durable
  // for observability and crash recovery
  durable: {
    toolCalls: toolCallsCollection,
    chunks: chunksCollection,
    // Internal tool calls get a parentGenerationId linking
    // them to the caller's generation for correlation
  },
})
```

**How `createWorkerAgent` works internally:**

```typescript
function createWorkerAgent<TInput, TOutput>(
  options: CreateWorkerAgentOptions<TInput, TOutput>
): WorkerAgent<TInput, TOutput> {
  const {
    name, description, instructions, adapter,
    tools, inputSchema, outputSchema, buildMessages, durable,
  } = options

  async function execute(args: TInput, ctx?: { signal?: AbortSignal; generationId?: string }) {
    // Build fresh messages from input — no history
    const llmMessages = buildMessages(args)

    // If durable, wrap tools and stream to collections
    const durableTools = durable && tools.length > 0
      ? makeDurableTools(tools, durable.toolCalls, {
          transform: (tc, genId) => ({
            ...tc,
            status: 'pending',
            generationId: genId,
            parentGenerationId: ctx?.generationId,
          }),
          isComplete: (row) => row.status === 'completed' || row.status === 'failed',
          getResult: (row) => row.status === 'failed' ? Promise.reject(row.error) : row.result,
        })
      : tools

    // Bridge optional signal → AbortController for chat()
    const abortController = new AbortController()
    if (ctx?.signal) {
      ctx.signal.addEventListener('abort', () => abortController.abort())
    }

    // Run chat() with structured output
    const result = await chat({
      adapter,
      systemPrompts: [instructions],
      messages: llmMessages,
      tools: durableTools,
      outputSchema,
      abortController,
    })

    return result  // Typed as TOutput
  }

  // Return object that satisfies both Tool interface and direct invocation
  return {
    // Tool interface (for use in another agent's tool list)
    name,
    description,
    inputSchema,
    outputSchema,
    execute,

    // Direct invocation (for use from application code)
    run: (input: TInput, options?: { signal?: AbortSignal }) =>
      execute(input, { signal: options?.signal }),
  }
}
```

**Composing persistent agents and worker agents:**

```typescript
// Worker agents: ephemeral specialists (no memory)
const factChecker = createWorkerAgent({
  name: 'fact-checker',
  description: 'Verifies factual claims',
  // ... fresh context each call
})

const summarizer = createWorkerAgent({
  name: 'summarizer',
  description: 'Summarizes long texts concisely',
  // ... fresh context each call
})

// Persistent agent: long-lived researcher that uses worker agents as tools
const researcher = createAgent(durableAgent({
  name: 'researcher',
  instructions: 'You research topics and verify facts...',
  adapter: openaiText('gpt-4o'),
  streamUrl: '...',
  tools: [
    searchTool,         // Regular tool
    factChecker,        // Worker agent (ephemeral, no memory)
    summarizer,         // Worker agent (ephemeral, no memory)
  ],
}))

// Persistent agent: planner that coordinates with persistent researcher
const planner = createAgent(durableAgent({
  name: 'planner',
  instructions: 'You coordinate research tasks...',
  adapter: openaiText('gpt-4o'),
  streamUrl: '...',
  tools: [
    summarizer,         // Worker agent as tool — fresh each time
  ],
  // Persistent agent via agents property — coordination via messages
  // The researcher REMEMBERS previous interactions
  agents: [
    { agent: researcher, description: 'Ask researcher to investigate (it remembers past work)' },
  ],
}))
```

#### Integration with TanStack AI Tool Definitions

The `toolDefinition()` pattern from TanStack AI integrates cleanly:

```typescript
import { toolDefinition } from '@tanstack/ai'
import { makeDurableTools, createToolExecutionEffect } from '@tanstack/ai-db'

// 1. Define tool with schema (used by LLM to understand the tool)
const searchTool = toolDefinition({
  name: 'searchDatabase',
  description: 'Search the database for documents',
  inputSchema: z.object({ query: z.string() }),
  outputSchema: z.object({ results: z.array(z.string()) }),
})

const fileTool = toolDefinition({
  name: 'readFile',
  description: 'Read a file from disk',
  inputSchema: z.object({ path: z.string() }),
  outputSchema: z.object({ content: z.string() }),
})

// 2. Wrap for durable execution (in generation environment)
const durableTools = makeDurableTools([searchTool, fileTool], toolCalls, {
  transform: (tc, genId) => ({ ...tc, status: 'pending', generationId: genId }),
  isComplete: (row) => row.status === 'completed' || row.status === 'failed',
  getResult: (row) => row.status === 'failed' ? Promise.reject(row.error) : row.result,
})

// Use in chat()
for await (const chunk of chat({
  adapter: openaiText('gpt-4o'),
  messages,
  tools: durableTools,
})) {
  // ...
}

// 3. Implement execution (in execution environment)
// Approach 2: tools array + implementations map (canonical pattern)
createToolExecutionEffect({
  query: (q) => q
    .from({ tc: toolCalls })
    .where(({ tc }) => and(
      eq(tc.status, 'pending'),
      eq(tc.$synced, true)  // Only confirmed rows
    )),
  tools: [searchTool, fileTool] as const,
  implementations: {
    searchDatabase: async (args) => {
      return { results: await db.search(args.query) }
    },
    readFile: async (args) => {
      return { content: await fs.readFile(args.path, 'utf-8') }
    },
  },
  onComplete: async (row, result) => {
    toolCalls.update(row.id, (draft) => {
      draft.status = 'completed'
      draft.result = result
    })
  },
})
```

**Key design decisions:**

- `toolDefinition()` provides schema for LLM + type-safe `.server()` implementation
- `makeDurableTools()` adds persistence + waiting without changing the tool's interface
- `createToolExecutionEffect()` executes using the typed implementation
- Tools are defined once, used in multiple contexts

#### Expected Schemas

The agent expects certain canonical field shapes on its collections. These are used by option factories like `durableAgent()` and by the built-in defaults in the collection-based path. In the query/mutation path, users never interact with these types directly — they project their own schema via queries and mutations.

```typescript
// AgentMessage — the canonical message shape (used by durableAgent and collection-based path)
interface AgentMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  actorId: string           // Who sent this (user ID or agent name)
  targetAgent: string       // Which agent this message is addressed to
  content: string
  createdAt: string         // ISO timestamp
  processed: boolean        // Whether the target agent has processed this
  generationId?: string     // Links to generation that produced this
  requestId?: string        // Correlation ID for agent-to-agent calls
  inReplyTo?: string        // requestId this message is responding to
}

// The following are composable Phase 1 schemas — NOT part of AgentConfig,
// but used when composing durable tools, chunks, or generation tracking.

// Tool Calls (satisfies ToolCallContract, used with makeDurableTools)
interface ToolCallRecord {
  id: string
  generationId: string
  name: string
  args: unknown
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'cancelled'
  result?: unknown
  error?: string
  createdAt: string
  updatedAt: string           // Updated on each status transition (used by recovery)
}

// Chunks (satisfies ChunkContract, used with streamToCollection)
interface ChunkRecord {
  id: string
  generationId: string
  index: number
  type: 'text' | 'tool-call-start' | 'tool-call-args' | 'tool-call-end' | 'thinking'
  content: string
}

// Generations (used by durableAgent internally for observability)
interface GenerationRecord {
  id: string
  agentName: string
  status: 'pending' | 'generating' | 'completed' | 'failed' | 'cancelled'
  model: string
  createdAt: string
  updatedAt: string           // Updated on each status transition (used by recovery)
  completedAt?: string
  error?: string
}

// Summaries (for history management)
interface SummaryRecord {
  id: string
  agentName: string
  createdAt: string
  coveringUpTo: string      // Timestamp of last summarized message
  content: string
}

// Optional: runner lifecycle checkpoints (used by protocol adapters)
interface RunnerCheckpointRecord {
  id: string
  runnerId: string          // Consumer/runner identity in your runtime
  source: string            // Stream path / queue partition / topic, etc.
  cursor: string            // Opaque offset token, monotonic per source
  updatedAt: string
}
```

**Stream Size Trade-off:**

Configurations backed by a single durable stream work well for most use cases. For very long-running or highly active sessions, the composable layer enables hybrid collection architectures:

```typescript
// Customized agent with hybrid sync (beyond factory defaults)
const messages = createStreamDB(streamUrl).collection('messages')
const summaries = createCollection(queryCollectionOptions({
  queryKey: ['summaries', sessionId],
  queryFn: () => api.getSummaries(sessionId),
  getKey: (s) => s.id,
}))

const researcher = createAgent({
  name: 'researcher',
  instructions: '...',
  adapter: openaiText('gpt-4o'),
  collections: { messages },
  // Use summaries in buildMessages for context windowing
  buildMessages: async (pending, ctx) => {
    const sums = await queryOnce((q) => q.from({ s: summaries }).orderBy(({ s }) => s.createdAt))
    const recent = await queryOnce((q) =>
      q.from({ m: messages })
        .where(({ m }) => or(eq(m.targetAgent, ctx.agentName), eq(m.actorId, ctx.agentName)))
        .orderBy(({ m }) => m.createdAt, 'desc')
        .limit(50)
    )
    return [
      // Summaries prepended as user context; system instructions go in systemPrompts
      ...sums.map(s => ({ role: 'user' as const, content: `[Summary] ${s.content}` })),
      ...recent.reverse().map(m => ({ role: m.role, content: m.content })),
    ]
  },
  generate: async ({ messages, tools, adapter, instructions, signal }) => {
    const abortController = new AbortController()
    signal.addEventListener('abort', () => abortController.abort())
    return chat({
      adapter,
      systemPrompts: [instructions],
      messages,
      tools,
      abortController,
      stream: false,
    })
  },
})
```

#### Chat History Management

Agents include built-in history management with deterministic context derivation:

```typescript
// Summaries stored in dedicated collection
interface SummaryRecord {
  id: string
  agentName: string
  createdAt: string         // When summary was created
  coveringUpTo: string      // Timestamp of last summarized message (deterministic cutoff)
  content: string           // Summary text
}

// Note: Using timestamp-based `coveringUpTo` rather than `coveringMessageIds` enables:
// - Deterministic context derivation across devices (no ordering ambiguity)
// - Efficient range queries (messages WHERE createdAt > coveringUpTo)
// - Progressive summarization without tracking individual message IDs

// Context derivation (same on all devices)
async function getContextMessages(agentName: string, collections, windowSize = 50) {
  const summaries = await collections.summaries
    .query((q) => q
      .where(({ s }) => eq(s.agentName, agentName))
      .orderBy(({ s }) => s.createdAt)
    )
  
  const recentMessages = await collections.messages
    .query((q) => q
      .where(({ m }) => or(
        eq(m.targetAgent, agentName),
        eq(m.actorId, agentName),
      ))
      .orderBy(({ m }) => m.createdAt, 'desc')
      .limit(windowSize)
    )
  
  return [
    // Summaries prepended as user context; system instructions go in systemPrompts
    ...summaries.map(s => ({ role: 'user' as const, content: `[Summary] ${s.content}` })),
    ...recentMessages.reverse(),
  ]
}
```

Summaries are additive—old messages are not deleted. All devices derive identical context from synced data.

**When and how summaries are created:**

Summarization is user-triggered or threshold-driven — not automatic by default. The `durableAgent` factory can include an optional auto-summarization threshold:

```typescript
// Option 1: Manual summarization (user calls when needed)
async function summarizeOldMessages(agentName: string, collections, cutoff: number = 100) {
  const messageCount = await collections.messages.count(
    (q) => q.where(({ m }) => eq(m.actorId, agentName))
  )
  
  if (messageCount < cutoff) return  // Not enough messages to warrant summarization
  
  // Get messages not yet covered by existing summaries
  const latestSummary = await collections.summaries.query(
    (q) => q
      .where(({ s }) => eq(s.agentName, agentName))
      .orderBy(({ s }) => s.createdAt, 'desc')
      .limit(1)
  )
  
  const unsummarized = await collections.messages.query(
    (q) => q
      .where(({ m }) => and(
        or(eq(m.targetAgent, agentName), eq(m.actorId, agentName)),
        latestSummary[0]
          ? gt(m.createdAt, latestSummary[0].coveringUpTo)
          : undefined,
      ))
      .orderBy(({ m }) => m.createdAt)
      .limit(cutoff - 20)  // Leave a window of recent unsummarized messages
  )
  
  if (unsummarized.length < 20) return  // Not enough to summarize
  
  // Use TanStack AI to generate a summary
  const summary = await chat({
    adapter: openaiText('gpt-4o-mini'),
    messages: [
      ...unsummarized.map(m => ({ role: m.role, content: m.content })),
    ],
  })
  
  await collections.summaries.insert({
    id: crypto.randomUUID(),
    agentName,
    createdAt: new Date().toISOString(),
    coveringUpTo: unsummarized.at(-1)!.createdAt,
    content: summary.content,
  })
}

// Option 2: Auto-summarization in durableAgent (opt-in)
const researcher = createAgent(durableAgent({
  name: 'researcher',
  instructions: '...',
  adapter: openaiText('gpt-4o'),
  streamUrl: '...',
  autoSummarize: {
    threshold: 100,    // Summarize when history exceeds 100 messages
    windowSize: 50,    // Keep last 50 messages unsummarized
    adapter: openaiText('gpt-4o-mini'),  // Use cheaper model for summaries
  },
}))
```

#### UI Integration

Agent collections work with standard TanStack DB hooks. In the collection-based path, `agent.collections.messages` provides direct access. In the query/mutation path, the user queries their own collections.

```typescript
import { useLiveQuery } from '@tanstack/react-db'
import { eq, or } from '@tanstack/db'

// Single-agent view (collection-based path)
function ChatView({ agent }) {
  // Subscribe to all messages for this agent
  const messages = useLiveQuery((q) =>
    q.from({ m: agent.collections.messages })
      .where(({ m }) => or(
        eq(m.targetAgent, agent.name),
        eq(m.actorId, agent.name),
      ))
      .orderBy(({ m }) => m.createdAt)
  )
  
  return (
    <div>
      {messages.map(msg => <Message key={msg.id} message={msg} />)}
      <MessageInput 
        onSend={(content) =>
          agent.collections.messages.insert({
            targetAgent: agent.name,
            role: 'user',
            content,
            actorId: userId,
          })
        }
      />
    </div>
  )
}

// Multi-agent view — shared collection, user selects which agent to address
function MultiAgentChatView({ agents, messagesCollection }) {
  const [targetAgent, setTargetAgent] = useState(agents[0].name)
  
  // Subscribe to all messages in the shared collection
  const messages = useLiveQuery((q) =>
    q.from({ m: messagesCollection })
      .orderBy(({ m }) => m.createdAt)
  )
  
  const agent = agents.find(a => a.name === targetAgent)!
  
  return (
    <div>
      {messages.map(msg => (
        <Message key={msg.id} message={msg} />
      ))}
      <AgentSelector
        agents={agents}
        selected={targetAgent}
        onSelect={setTargetAgent}
      />
      <MessageInput 
        onSend={(content) =>
          messagesCollection.insert({
            targetAgent: agent.name,
            role: 'user',
            content,
            actorId: userId,
          })
        }
      />
    </div>
  )
}
```

### Phase 3: Production Hardening

_Capabilities needed for production-grade deployments. These build on Phases 1 and 2 but are not required for initial development or prototyping._

#### Human-in-the-Loop Approvals

Tool calls requiring approval integrate with TanStack AI's approval workflow:

```typescript
// Tool with approval requirement
const dangerousTool = toolDefinition({
  name: 'deleteAllData',
  needsApproval: true,
  // ...
})

// Durable approval state (append-only for audit trail)
interface ApprovalEvent {
  id: string              // Unique event ID
  toolCallId: string      // Which tool call this applies to
  action: 'requested' | 'approved' | 'denied' | 'expired'
  actorId: string         // Who performed this action
  timestamp: string       // When it happened
  reason?: string         // Optional justification
}

// Approval events collection (immutable - never update, only insert)
const approvalEvents = createCollection<ApprovalEvent>({ /* ... */ })

// Derived approval status (for querying current state)
// Option 1: Materialized view / computed property
// Option 2: Query latest event per toolCallId
async function getApprovalStatus(toolCallId: string) {
  const events = await approvalEvents.query(
    (q) => q
      .where(({ e }) => eq(e.toolCallId, toolCallId))
      .orderBy(({ e }) => e.timestamp, 'desc')
      .limit(1)
  )
  return events[0]?.action === 'approved' ? 'approved' : 
         events[0]?.action === 'denied' ? 'denied' : 'pending'
}

// Tool execution checks approval via derived query over approval events.
// Since approvals are append-only events, derive current status by finding
// tool calls that have an 'approved' event as their latest action.
createToolExecutionEffect({
  query: (q) => q
    .from({ tc: toolCalls })
    .join({ ae: approvalEvents }, ({ tc, ae }) => eq(tc.id, ae.toolCallId))
    .where(({ tc, ae }) => and(
      eq(tc.status, 'pending'),
      eq(tc.$synced, true),       // Only confirmed rows
      eq(ae.action, 'approved')   // Only execute approved tools
    )),
  // ...
})
```

Approvals sync across devices—approve on phone, execute on server.

**Audit Trail Guidance:**

- Approval events are **append-only**—never update or delete
- Each action (request, approve, deny) is a separate event
- Full history is preserved for compliance/audit
- Current status derived from latest event per tool call
- For simpler use cases, a mutable `ApprovalState` record is acceptable but loses history

#### Resumability & Recovery

On startup, detect and recover orphaned operations:

```typescript
async function recoverOrphanedOperations() {
  // 1. Find generations stuck in 'generating' status
  const orphanedGens = await generations.query(
    (q) => q.where(({ g }) => eq(g.status, 'generating'))
  )
  
  for (const gen of orphanedGens) {
    const age = Date.now() - new Date(gen.updatedAt).getTime()
    
    if (age > RECOVERY_TIMEOUT) {
      // Mark as failed and eligible for retry
      generations.update(gen.id, (draft) => {
        draft.status = 'failed'
        draft.error = 'Recovered from orphaned state'
      })
    }
  }
  
  // 2. Find tool calls stuck in 'executing' status
  const orphanedTools = await toolCalls.query(
    (q) => q.where(({ tc }) => eq(tc.status, 'executing'))
  )
  
  for (const tool of orphanedTools) {
    const age = Date.now() - new Date(tool.updatedAt).getTime()
    
    if (age > RECOVERY_TIMEOUT) {
      // Reset to pending for retry (respects attempt count for dead-letter)
      toolCalls.update(tool.id, (draft) => {
        draft.status = 'pending'
        draft.attempt = (tool.attempt ?? 0) + 1
      })
    }
  }
}
```

**Tool Chain Recovery:**

When a generation crashes mid-tool-chain, the chain can be resumed:

```typescript
async function resumeToolChain(generationId: string) {
  // Find completed tool calls for this generation
  const completedTools = await toolCalls.query(
    (q) => q
      .where(({ tc }) => and(
        eq(tc.generationId, generationId),
        eq(tc.status, 'completed')
      ))
      .orderBy(({ tc }) => tc.createdAt)
  )
  
  // Find pending/failed tool calls
  const pendingTools = await toolCalls.query(
    (q) => q
      .where(({ tc }) => and(
        eq(tc.generationId, generationId),
        or(eq(tc.status, 'pending'), eq(tc.status, 'failed'))
      ))
  )
  
  if (pendingTools.length > 0) {
    // Reset generation to continue from last checkpoint
    generations.update(generationId, (draft) => {
      draft.status = 'pending'  // Will re-enter effect
      draft.resumeFromToolIndex = completedTools.length
    })
  }
}
```

**Chunk-Based Stream Recovery:**

For interrupted streams, recovery uses persisted chunks:

```typescript
async function getLastPersistedChunkIndex(generationId: string): Promise<number> {
  const lastChunk = await chunks.query(
    (q) => q
      .where(({ c }) => eq(c.generationId, generationId))
      .orderBy(({ c }) => c.index, 'desc')
      .limit(1)
  )
  
  return lastChunk[0]?.index ?? -1
}

// Note: Most LLM APIs don't support resuming mid-stream.
// Recovery typically means:
// - Display persisted chunks to user (partial response visible)
// - Mark generation as failed with partial content
// - User/agent can request continuation or retry
```

**State Classification:**

| State | Resumable? | Recovery Action |
|-------|------------|-----------------|
| Generation `pending` | Yes | Will be picked up by effect |
| Generation `generating` (orphaned) | Maybe | Reset to `pending` or `failed` based on timeout |
| Tool call `pending` | Yes | Will be picked up by effect |
| Tool call `executing` (orphaned) | Maybe | Reset to `pending` with incremented attempt |
| Tool call `completed` | N/A | Already done |
| Partial chunks | Display only | Show what's persisted, mark gen as failed |

### Phase 4: Advanced Patterns (Future)

_Deferred to future work._

- **Distributed Tool Execution**: Coordination providers for multi-executor environments (claiming, lease management, duplicate prevention). For v1, tool execution assumes a single consumer per environment — applications needing distributed coordination should implement it at the application or sync-backend layer.
- **Multi-Agent Orchestration**: Standard patterns for agent teams, parallel execution, lifecycle management, status observability
- **Job/Task Management**: Long-running async operation patterns, progress reporting, job cancellation and notification

These patterns build on Phases 1-3 and will be specified once the foundational layers are validated.

### Complexity Check

**Is this the simplest approach?**

For Phase 1 (composable primitives): Yes — we compose with existing systems rather than replacing them:
- **TanStack AI's `chat()` loop is unchanged** — we wrap tools, not the loop
- **Reactive effects** handle the watching/triggering
- **Collections** serve as the communication layer between environments
- **Runner lifecycle primitives** are protocol-agnostic (wake/claim/checkpoint/complete)
- **Durable Streams** is an optional adapter layer, not a core requirement

The key insight is that `makeDurableTool()` provides an async `execute()` function that:
1. Inserts a pending row
2. Waits for completion via collection subscription
3. Returns the result — TanStack AI's loop handles the rest

Phase 2 (agent abstractions) adds complexity by introducing a generation loop driven by reactive effects. This is intentional: `createAgent` builds on Phase 1 primitives (`makeDurableTools`, `durableChat`, `createEffect`) to provide a higher-level abstraction. Users who don't need the agent abstraction can use Phase 1 directly. Option factories like `durableAgent()` minimize the cognitive cost of Phase 2 — users provide name, instructions, adapter (with model baked in), tools, and a stream URL; runtime lifecycle adapters are optional and only needed in serverless wake/ack environments.

**What could we cut?**

If we had half the time:
- Phase 3 (production hardening) - defer approvals and recovery
- `durableChat()` convenience wrapper - users combine primitives manually
- `createGenerationEffect()` - users write their own effect using `createEffect()`
- Default schemas - just document patterns, users define their own schemas

**What's the 90/10 solution?**

1. `makeDurableTool()` / `makeDurableTools()` - wrap tools for persistence + waiting
2. `createToolExecutionEffect()` - execute pending tool calls
3. `waitForToolResult()` - subscribe to collection for result
4. Documentation showing how to combine with `chat()` and `streamToCollection()`

That's it—the rest is convenience. Users can build everything else from these primitives.

### API Summary

```typescript
// ============================================
// Composable Primitives (Phase 1)
// ============================================

// Make tools durable - persist calls, wait for results via collection
function makeDurableTool<
  T extends ToolDefinition,
  TRow extends ToolCallContract,
>(
  tool: T,
  collection: Collection<TRow>,
  options: {
    transform: (
      toolCall: { id: string; name: T['name']; args: InferToolInput<T> },
      generationId?: string
    ) => TRow
    isComplete: (row: TRow) => boolean
    getResult: (row: TRow) => InferToolOutput<T>  // Typed to tool output!
    timeout?: number
  }
): DurableTool<T>

// Convenience: wrap multiple tools (shared options)
function makeDurableTools<
  TTools extends readonly ToolDefinition[],
  TRow extends ToolCallContract,
>(
  tools: TTools,
  collection: Collection<TRow>,
  options: {
    transform: (
      toolCall: { id: string; name: string; args: unknown },
      generationId?: string
    ) => TRow
    isComplete: (row: TRow) => boolean
    getResult: (row: TRow) => unknown  // Union of outputs, discriminate by name
    timeout?: number
  }
): DurableTools<TTools>

// Make a tool async (fire-and-forget, returns immediately)
function makeAsyncTool<T extends Tool, TRow extends ToolCallContract>(
  tool: T,
  collection: Collection<TRow>,
  options: {
    transform: (toolCall: ToolCallData, generationId?: string) => TRow
    getImmediateResult: (row: TRow) => unknown  // What to return immediately
  }
): T

// Wait for a tool result in a collection (used internally by makeDurableTool)
function waitForToolResult<TRow, TResult>(
  collection: Collection<TRow>,
  id: string,
  isComplete: (row: TRow) => boolean,
  getResult: (row: TRow) => TResult,
  options?: { timeout?: number; signal?: AbortSignal }
): Promise<TResult>

// Constraint types for collection contracts
type ToolCallContract = {
  id: string
  name: string
  status: string
  args: unknown
}

type GenerationContract = {
  id: string
  status: string
}

type ChunkContract = {
  id: string
  generationId: string
  index: number
}

// Watch for pending tool calls and execute them
// Type-safe version - see "Type-Safe Tool APIs" section
function createToolExecutionEffect<
  TTools extends readonly Tool[],
  TRow extends ToolCallContract,
>(options: {
  query: EffectQueryInput<any>           // Same as createEffect query
  tools: TTools
  implementations: {
    [T in TTools[number] as T['name']]: (
      args: InferToolInput<T>,
      ctx: { signal: AbortSignal }
    ) => Promise<InferToolOutput<T>>
  }
  onExecuting?: (row: TRow) => Promise<void>
  onComplete?: (row: TRow, result: InferToolOutput<TTools[number]>) => Promise<void>
  onError?: (row: TRow, error: Error) => Promise<void>
}): Effect

// Watch for generation requests and run chat() (optional convenience — defer if no unique semantics)
function createGenerationEffect<TRow extends GenerationContract>(options: {
  query: EffectQueryInput<any>
  generate: (row: TRow, ctx: EffectContext) => Promise<string>
  onComplete?: (row: TRow, result: string) => Promise<void>
  onCancelled?: (row: TRow) => Promise<void>
  onError?: (row: TRow, error: Error) => Promise<void>
}): Effect

// --------------------------------------------
// Runner lifecycle primitives (protocol-agnostic)
// --------------------------------------------

type CheckpointContract = {
  source: string
  cursor: string
}

interface RunnerLifecycleAdapter<TWake = unknown> {
  claimWake(
    wake: TWake,
    ctx: { signal: AbortSignal }
  ): Promise<{ fenceToken?: string }>
  heartbeat?(
    state: { wake: TWake; fenceToken?: string }
  ): Promise<void>
  checkpoint?(
    checkpoints: CheckpointContract[],
    state: { wake: TWake; fenceToken?: string }
  ): Promise<void>
  complete?(
    state: { wake: TWake; fenceToken?: string },
    result: { done: boolean }
  ): Promise<void>
  fail?(
    state: { wake: TWake; fenceToken?: string },
    error: Error
  ): Promise<void>
}

interface RunnerSession<TWake = unknown> {
  wake: TWake
  fenceToken?: string
  signal: AbortSignal
  heartbeat(): Promise<void>
  checkpoint(checkpoints: CheckpointContract[]): Promise<void>
  complete(result: { done: boolean }): Promise<void>
  fail(error: Error): Promise<void>
}

function runWithLifecycle<TWake, TResult>(
  wake: TWake,
  adapter: RunnerLifecycleAdapter<TWake>,
  handler: (session: RunnerSession<TWake>) => Promise<TResult>,
  options?: { signal?: AbortSignal }
): Promise<TResult>

function drainUntilIdle(options: {
  hasPendingWork: () => Promise<boolean>
  runCycle: () => Promise<void>
  maxIterations?: number
  maxDurationMs?: number
  lifecycle?: {
    heartbeat?: () => Promise<void>
    checkpoint?: (checkpoints: CheckpointContract[]) => Promise<void>
  }
  buildCheckpoint?: () => Promise<CheckpointContract[]>
}): Promise<{ completed: boolean; cycles: number }>

// Optional Durable Streams helper (adapter built on generic lifecycle primitives)
type DurableStreamsWakePayload = {
  consumer_id: string
  epoch: number
  wake_id: string
  callback: string
  token: string
  streams: Array<{ path: string; offset: string }>
}

type WebhookExecutionMode =
  | { type: 'request-bound'; maxRequestMs?: number }
  | { type: 'ack-immediate'; status?: 200 | 202 }

function durableStreamsWebhookAdapter(options: {
  verifySignature: (req: Request) => Promise<void>
  mode: WebhookExecutionMode
  postCallback: (
    wake: DurableStreamsWakePayload,
    body: unknown,
    token: string
  ) => Promise<{ token: string }>
  // Optional keepalive policy for long runs (heartbeat callback cadence)
  heartbeatIntervalMs?: number
}): RunnerLifecycleAdapter<DurableStreamsWakePayload>

function handleDurableStreamsWake(options: {
  request: Request
  adapter: RunnerLifecycleAdapter<DurableStreamsWakePayload>
  mode: WebhookExecutionMode
  run: (wake: DurableStreamsWakePayload) => Promise<void>
}): Promise<Response>

// Stream AG-UI chunks to a collection
import type { StreamChunk } from '@tanstack/ai'

function streamToCollection<TRow extends ChunkContract>(
  stream: AsyncIterable<StreamChunk>,
  options: {
    collection: Collection<TRow>
    generationId: string
    transform: (chunk: StreamChunk, index: number, genId: string) => TRow
    filter?: (chunk: StreamChunk) => boolean  // Optional: filter chunk types
  }
): Promise<{ content: string }>

// Convenience: chat() + durable tools + chunk streaming (optional — defer if no unique semantics)
async function durableChat<TToolRow extends object, TChunkRow extends object>(options: {
  // Standard chat() options (model baked into adapter)
  adapter: AnyTextAdapter
  messages: ModelMessage[]
  systemPrompts?: string[]
  tools?: Tool[]
  abortController?: AbortController
  // Durable tool options
  toolCalls?: {
    collection: Collection<TToolRow>
    transform: (tc: ToolCallData, genId?: string) => TToolRow
    isComplete: (row: TToolRow) => boolean
    getResult: (row: TToolRow) => unknown
    timeout?: number
  }
  // Chunk streaming options
  chunks?: {
    collection: Collection<TChunkRow>
    generationId: string
    transform: (chunk: StreamChunk, index: number, genId: string) => TChunkRow
  }
}): Promise<{ content: string }>

// ============================================
// Agent Abstractions (Phase 2)
// ============================================

// Persistent reactive agent — composition pattern
// createAgent accepts AgentConfig (produced by factories or manually)
// Two data overloads: collection-based or query/mutation-based
function createAgent(options: AgentConfig): Agent

// AgentConfig — discriminated by presence of `collections`
type AgentConfig = CollectionAgentConfig | QueryAgentConfig

type AgentGenerate<TRow extends object> = (input: {
  pending: TRow[]
  messages: ModelMessage[]
  adapter: AnyTextAdapter
  tools: Tool[]
  instructions: string
  signal: AbortSignal
  context: AgentContext
}) => Promise<string>

interface CollectionAgentConfig {
  name: string
  description?: string
  instructions: string
  adapter: AnyTextAdapter               // Model baked into adapter: openaiText('gpt-4o')
  tools?: Tool[]                        // External tools (optionally durable)
  agents?: AgentReference[]             // Agent collaborators (coordination via messages)
  collections: { messages: Collection<AgentMessage> }
  generate: AgentGenerate<AgentMessage> // Required in raw createAgent(); provided by durableAgent()
  pendingWork?: EffectQueryInput<any>  // Optional override
  buildMessages?: (pending: AgentMessage[], ctx: AgentContext) => Promise<ModelMessage[]>
  onResponse?: (response: string, pending: AgentMessage[], ctx: AgentContext) => Promise<void>
  onError?: (error: Error, pending: AgentMessage[], ctx: AgentContext) => Promise<void>
}

interface QueryAgentConfig<TRow extends object = Record<string, unknown>> {
  name: string
  description?: string
  instructions: string
  adapter: AnyTextAdapter               // Model baked into adapter
  tools?: Tool[]
  agents?: AgentReference[]
  // No collections — read/write via queries + mutations
  pendingWork: EffectQueryInput<any>  // Required
  buildMessages: (pending: TRow[], ctx: AgentContext) => Promise<ModelMessage[]>  // Required
  generate: AgentGenerate<TRow>  // Required
  onResponse: (response: string, pending: TRow[], ctx: AgentContext) => Promise<void>  // Required
  watchForResponse?: (requestId: string, opts: { timeout: number; callerName: string }) => Promise<{ content: string }>
  onError?: (error: Error, pending: TRow[], ctx: AgentContext) => Promise<void>
}

interface Agent {
  name: string
  collections?: { messages: Collection<AgentMessage> }  // Only in collection path
  hasPendingWork(): Promise<boolean>
  runGenerationCycle(): Promise<void>
  drainUntilIdle(options?: {
    maxIterations?: number
    maxDurationMs?: number
    lifecycle?: {
      heartbeat?: () => Promise<void>
      checkpoint?: (checkpoints: CheckpointContract[]) => Promise<void>
    }
    buildCheckpoint?: () => Promise<CheckpointContract[]>
  }): Promise<{ completed: boolean; cycles: number }>
  watchForResponse(requestId: string, opts: { timeout: number; callerName: string }): Promise<{ content: string }>
  dispose(): Promise<void>  // Resolves when in-flight handlers complete (matches Effect.dispose)
}

// Agent reference — for agent-to-agent composition (coordination via messages)
interface AgentReference {
  agent: Agent
  description: string
  inputSchema?: SchemaInput
  outputSchema?: SchemaInput
  timeout?: number            // Max wait for response (default: 120_000ms)
  insertMessage?: (message: {
    content: string
    actorId: string
    requestId?: string
    inReplyTo?: string
  }) => Promise<void>
}

interface AgentContext {
  agentName: string
  collections?: { messages: Collection<AgentMessage> }
  signal: AbortSignal
}

// chat({ stream: false }) returns Promise<string>
// Response is passed directly to onResponse as a string

// Option factory — creates AgentConfig with Durable Streams sync
function durableAgent(options: {
  name: string
  instructions: string
  adapter: AnyTextAdapter               // Model baked into adapter
  tools?: Tool[]
  agents?: AgentReference[]
  streamUrl: string
  description?: string
  buildMessages?: (pending: AgentMessage[], ctx: AgentContext) => Promise<ModelMessage[]>
  generate?: AgentGenerate<AgentMessage>  // Optional override of factory default
  onResponse?: (response: string, pending: AgentMessage[], ctx: AgentContext) => Promise<void>
  runtime?: {
    wakeAdapter?: RunnerLifecycleAdapter<any>   // Optional protocol adapter (webhooks/queue/alarm)
    drain?: { maxIterations?: number; maxDurationMs?: number }
  }
  autoSummarize?: { threshold: number; windowSize: number; adapter: AnyTextAdapter }
}): CollectionAgentConfig

// AgentMessage — canonical message shape for collection-based path
interface AgentMessage { id: string; role: 'user' | 'assistant' | 'system'; actorId: string; targetAgent: string; content: string; createdAt: string; processed: boolean; generationId?: string; requestId?: string; inReplyTo?: string }

// Ephemeral worker agent — task-scoped, used as a tool, no memory
function createWorkerAgent<TInput, TOutput>(options: {
  name: string
  description: string
  instructions: string
  adapter: AnyTextAdapter               // Model baked into adapter
  tools?: Tool[]
  inputSchema: SchemaInput
  outputSchema: SchemaInput
  buildMessages: (input: TInput) => ModelMessage[]
  durable?: {
    toolCalls: Collection
    chunks?: Collection
  }
}): WorkerAgent<TInput, TOutput>

// WorkerAgent satisfies the Tool interface AND supports direct invocation
interface WorkerAgent<TInput, TOutput> {
  // Tool interface (for use in another agent's tool list)
  name: string
  description: string
  inputSchema: SchemaInput
  outputSchema: SchemaInput
  execute(args: TInput, ctx?: { signal?: AbortSignal; generationId?: string }): Promise<TOutput>
  // Direct invocation (for use from application code — no parent agent needed)
  run(input: TInput, options?: { signal?: AbortSignal }): Promise<TOutput>
}

// Composable schemas (Phase 1 — NOT part of AgentConfig)
interface ToolCallRecord { id: string; generationId: string; name: string; args: unknown; status: 'pending' | 'executing' | 'completed' | 'failed' | 'cancelled'; result?: unknown; error?: string; createdAt: string; updatedAt: string }
interface ChunkRecord { id: string; generationId: string; index: number; type: 'text' | 'tool-call-start' | 'tool-call-args' | 'tool-call-end' | 'thinking'; content: string }
interface GenerationRecord { id: string; agentName: string; status: 'pending' | 'generating' | 'completed' | 'failed' | 'cancelled'; model: string; createdAt: string; updatedAt: string; completedAt?: string; error?: string }
interface SummaryRecord { id: string; agentName: string; createdAt: string; coveringUpTo: string; content: string }

// ============================================
// Production Hardening (Phase 3)
// ============================================

// Human-in-the-Loop approvals
// Resumability & Recovery

// ============================================
// Distributed Execution — deferred to Phase 4
// ============================================
// Coordination providers, distributed claiming, and multi-executor
// tool execution are deferred to future work. For v1, tool execution
// assumes a single consumer per environment. Applications needing
// distributed coordination should implement it at the application
// or sync-backend layer.
```

## Implementation Invariants

These invariants define the behavioral guarantees that all implementations of `@tanstack/ai-db` must uphold:

1. **No duplicate tool execution.** A tool call row that enters the `createToolExecutionEffect` query result set is executed exactly once. Once the effect transitions the row's status from `'pending'` to `'executing'`, the row exits the effect's query and will not be re-processed. The v1 model assumes a single consumer per tool execution effect; applications needing multi-consumer coordination should implement it at the application or sync-backend layer.

2. **Deterministic chunk ordering.** Chunks written by `streamToCollection` are assigned monotonically increasing `index` values within a generation. If chunks are replayed or re-synced, the collection must reconstruct the same order. Consumers use `orderBy(index)` to assemble content.

3. **Cancellation propagation.** When `effect.dispose()` is called or the effect's `ctx.signal` is aborted, any in-flight `chat()` call must be cancelled via its `AbortController`. The sequence is: `ctx.signal` aborted → `abortController.abort()` → `chat()` stream terminates. In-flight handler promises are awaited during disposal.

4. **Late-result policy.** If a tool call result arrives after the parent generation has been cancelled, the default behavior is to **discard** the result (mark the tool call as `'cancelled'`). The generation's status determines whether a result is actionable. This is configurable via the `onComplete` callback.

5. **Agent-call correlation.** Every agent-to-agent message carries a `requestId` (set by the caller) or `inReplyTo` (set by the responder). The correlation chain is: caller generates `requestId` → writes message row with `requestId` → target agent processes and responds with `inReplyTo: requestId` → caller matches response via `watchForResponse`. Unmatched responses (no `inReplyTo`) are treated as spontaneous messages.

6. **Single-runner guarantee.** In v1, each `(session, agent)` pair has at most one active generation loop. The effect system ensures that only one instance processes pending work at a time. Multi-runner deployments should implement coordination at the application or sync-backend layer — this is deferred to future work (Phase 4).

7. **Lifecycle fencing is adapter-enforced.** `runWithLifecycle()` requires `claimWake()` before work begins. If the adapter reports stale/already-claimed wake state, the run is aborted and no generation cycle is executed.

8. **Checkpoint monotonicity.** Checkpoints emitted through `session.checkpoint()` must be monotonic per `source`. Adapters that reject non-monotonic checkpoints should surface a deterministic failure.

9. **Done semantics are explicit.** `drainUntilIdle()` returns `completed: true` only when `hasPendingWork()` is false at loop end. Adapters receive this via `complete({ done })`, preventing false-idle acknowledgements.

10. **Keepalive responsibility is explicit.** When runtime mode is `ack-immediate`, the runner must send periodic `heartbeat()` callbacks while work is active; missing keepalives must be treated as liveness loss and retried wake by the transport.

## Type-Safe Tool APIs (Design Rationale)

This section documents the design rationale for the type-safe API. The APIs throughout this RFC use **Approach 2** (tool array with inferred implementation map) as the primary pattern.

### The Problem We Solved

Without type inference, tool implementations would be untyped:

```typescript
// Tool defined with typed schemas
const searchTool = toolDefinition({
  name: 'searchDatabase',
  inputSchema: z.object({ query: z.string() }),
  outputSchema: z.object({ results: z.array(z.string()) }),
})

// Without our type system: args is `unknown`, return not checked
createToolExecutionEffect({
  tools: { searchDatabase: async (args) => ({ results: [] }) },
})
```

**Solution:** Pass tool definitions array, TypeScript infers implementation requirements.

### Approach 1: Use `.server()` Directly

Leverage TanStack AI's existing `.server()` method which already provides full type inference:

```typescript
createToolExecutionEffect({
  query: pendingToolCallsQuery,
  tools: [
    searchTool.server(async (args) => {
      // args: { query: string } - inferred from inputSchema
      return { results: await db.search(args.query) }
      // return type checked against outputSchema
    }),
    analysisTool.server(async (args) => {
      // args: { document: string } - inferred
      return { summary: await analyze(args.document) }
    }),
  ],
  onComplete: async (row, result) => {
    toolCalls.update(row.id, (draft) => {
      draft.status = 'completed'
      draft.result = result
    })
  },
})
```

**Pros:**
- Uses existing TanStack AI types
- Full input/output type safety
- Familiar pattern for TanStack AI users

**Cons:**
- Tool name dispatch must be handled internally (match `row.name` to tool)
- Array of tools less explicit than name-keyed record

### Approach 2: Tool Array with Inferred Implementation Map

Pass tool definitions, infer the required implementation record type:

```typescript
// Type helper: extract tool names and map to input/output types
type ToolImplementations<TTools extends readonly Tool[]> = {
  [T in TTools[number] as T['name']]: (
    args: InferToolInput<T>,
    ctx: { signal: AbortSignal }
  ) => Promise<InferToolOutput<T>>
}

// Usage
createToolExecutionEffect({
  query: pendingToolCallsQuery,
  tools: [searchTool, analysisTool] as const,  // Tool definitions
  implementations: {
    // TypeScript enforces: must implement all tools with correct types
    searchDatabase: async (args) => {
      // args: { query: string }
      return { results: await db.search(args.query) }
    },
    analyzeDocument: async (args) => {
      // args: { document: string }
      return { summary: await analyze(args.document) }
    },
    // Error: missing 'analyzeDocument' if omitted
    // Error: wrong arg/return type if mismatched
  },
  onComplete: /* ... */,
})
```

**Type Implementation:**

```typescript
// Matches the canonical signature in the API summary
function createToolExecutionEffect<
  TTools extends readonly Tool[],
  TRow extends ToolCallContract,
>(options: {
  query: EffectQueryInput<any>
  tools: TTools
  implementations: ToolImplementations<TTools>
  onExecuting?: (row: TRow) => Promise<void>
  onComplete?: (row: TRow, result: InferToolOutput<TTools[number]>) => Promise<void>
  onError?: (row: TRow, error: Error) => Promise<void>
}): Effect
```

**Pros:**
- Explicit separation of definitions and implementations
- TypeScript ensures all tools are implemented
- Type errors point to specific missing/wrong implementations

**Cons:**
- Slightly more verbose
- Requires `as const` for tuple inference

### Approach 3: Builder Pattern

Chain tool implementations for incremental type checking:

```typescript
createToolExecutionEffect({
  query: pendingToolCallsQuery,
  onComplete: /* ... */,
})
  .tool(searchTool, async (args) => {
    // args typed from searchTool.inputSchema
    return { results: await db.search(args.query) }
  })
  .tool(analysisTool, async (args) => {
    // args typed from analysisTool.inputSchema
    return { summary: await analyze(args.document) }
  })
  .build()
```

**Pros:**
- Each `.tool()` call is independently type-checked
- Natural for incremental composition
- IDE autocomplete works per-tool

**Cons:**
- Doesn't enforce completeness (missing tools not caught)
- Different API style from rest of package

### Chosen Approach

**Approach 2 (Tool Array with Inferred Implementation Map)** is used throughout this RFC because it provides:

1. **Type-safe**: Full inference of args and return types
2. **Complete**: TypeScript enforces all tools are implemented
3. **Explicit**: Clear separation of definitions and implementations
4. **Familiar**: Similar to typed event handlers pattern

For multi-environment setups where different tools run in different environments (server vs. client), each environment creates its own `createToolExecutionEffect` with only the tools it handles. The tool call collection serves as the shared communication layer — the generation environment writes pending tool calls, and each execution environment's effect picks up the ones it knows how to handle:

```typescript
// Server environment — handles server-only tools
createToolExecutionEffect({
  query: (q) => q
    .from({ tc: toolCalls })
    .where(({ tc }) => and(
      eq(tc.status, 'pending'),
      eq(tc.$synced, true),
      inArray(tc.name, ['searchDatabase', 'analyzeDocument'])
    )),
  tools: [searchTool, analysisTool] as const,
  implementations: {
    searchDatabase: async (args) => db.search(args.query),
    analyzeDocument: async (args) => analyze(args.document),
  },
})

// Client environment — handles client-only tools
createToolExecutionEffect({
  query: (q) => q
    .from({ tc: toolCalls })
    .where(({ tc }) => and(
      eq(tc.status, 'pending'),
      eq(tc.$synced, true),
      eq(tc.name, 'captureScreenshot')
    )),
  tools: [browserTool] as const,
  implementations: {
    captureScreenshot: async () => captureScreen(),
  },
})
```

This assumes a **single consumer per tool** — each tool name is handled by exactly one environment. If you need multiple consumers competing for the same tool, implement coordination at the application or sync-backend layer.

### Connection to makeDurableTool

For full type safety across the generation/execution boundary:

```typescript
// Shared tools module (imported by both environments)
export const tools = [searchTool, analysisTool] as const
export type ToolNames = typeof tools[number]['name']

// Generation environment
const durableTools = makeDurableTools(tools, toolCallsCollection, {
  transform: (tc) => ({ ...tc, status: 'pending' }),
  // ...
})

// Execution environment - TypeScript ensures implementations match
createToolExecutionEffect({
  query: pendingQuery,
  tools,
  implementations: {
    searchDatabase: async (args) => db.search(args.query),  // args typed!
    analyzeDocument: async (args) => analyze(args.document),
  },
})
```

## Open Questions

| Question | Options | Resolution Path |
|----------|---------|-----------------|
| **waitForToolResult implementation** | `subscribeChanges()` vs polling | Subscription preferred; verify reactive effects support |
| **Chunk aggregation for final result** | Client-side query vs helper | Prototype both, see what's ergonomic |
| **Generation context passing** | Explicit `context` param vs closure | TanStack AI may need enhancement for generationId |
| **Tool timeout behavior** | Error vs undefined result | Error with clear message; user can catch |
| **Agent resumption** | Explicit wake vs auto-resume | Prototype with sleep/wake lifecycle |
| **Late result reconciliation** | Discard vs store-with-flag | Default discard; configurable |
| **Approval audit trail** | Same collection vs separate | Separate collection for immutability |
| **Recovery timeout duration** | Fixed vs configurable | Configurable with sensible default (5 min) |
| **Lifecycle adapter packaging** | Built into core vs optional helper export | Keep core protocol-agnostic; ship `durableStreamsWebhookAdapter` as helper |
| **Webhook execution mode default** | request-bound vs ack-immediate | Default to ack-immediate for edge/serverless safety; allow request-bound for long-lived runtimes |
| **Type-safe tool implementations** | Approach 1-3 above | Prototype Approach 2 |
| **Persistent agent pending work batching** | Batch all pending into one generation vs process sequentially | Batch preferred (one generation sees all pending); validate with prototyping |
| **Persistent agent data interface** | Collection-based (AgentMessage) vs query/mutation-based (custom schema) | Both supported via AgentConfig overloads; query/mutation path for shared collections |
| **Worker agent streaming output** | Stream chunks to parent vs final result only | Final result only initially; streaming adds complexity |
| **Worker agent nesting depth** | Unlimited vs configurable max depth | Configurable with sensible default (5); prevent runaway recursion |
| **createAgent lifecycle** | Live from creation vs explicit `.start()` | Live from creation (matches createEffect behavior) |
| **Factory extensibility** | Fixed AgentMessage schema vs user-extensible fields | AgentMessage is fixed in factories; query/mutation path for custom schemas |
| **Agent wake mechanism** | Framework-provided vs platform-specific | Platform-specific (webhooks, alarms, queue triggers); document patterns |

## Definition of Success

### Primary Hypothesis

> We believe that implementing **effect-based AI state management** will enable developers to build **durable, multi-user, multi-agent AI applications** without custom infrastructure.
>
> We'll know we're right if:
> - Developers can persist AI conversations that survive page refresh
> - Multiple browser tabs show the same conversation in sync
> - Streaming responses appear in real-time across all subscribers
> - Tool execution works across different environments (client/server)
>
> We'll know we're wrong if:
> - The abstraction is too leaky (users constantly fight the system)
> - Performance degrades with many chunks/effects
> - Multi-agent patterns don't fit the model

### Functional Requirements

| Requirement | Acceptance Criteria |
|-------------|---------------------|
| Generation effects | Effect fires on query match, calls user's generate function |
| Chunk streaming | Chunks persist with ordering guarantees, deterministic reassembly |
| Tool execution effects | Effect fires on query match, executes tool, writes result |
| Runner lifecycle primitives | `runWithLifecycle()` + `drainUntilIdle()` provide protocol-agnostic wake/heartbeat/checkpoint/complete composition |
| Webhook runtime modes | Durable Streams helper supports both request-bound drain and immediate-ack wake modes |
| Persistent agents | `createAgent` creates live reactive entity; watches inbox, generates, loops until idle |
| Worker agents | `createWorkerAgent` creates tool with internal agent loop; fresh context each call |
| Agent composition | `agents` config property enables agent-to-agent coordination via messages; separate from `tools` to prevent double-wrapping |
| Multi-agent sessions | Multiple persistent agents coexist, each with own loop watching shared (or separate) collections |
| Agent persistence | Agent state persists to collections via sync backend, resumes on wake |
| Multi-tab sync | Changes in one tab appear in all tabs via sync |
| Tool execution model | Single consumer per environment; distributed coordination deferred to Phase 4 |
| Cancellation | Abort propagates, late results handled per policy |
| Idempotency | Atomic status transitions prevent duplicate execution |
| Approvals | Durable approval state, sync across devices |
| Recovery | Orphaned operations detected and recoverable on startup |
| Option factories | `durableAgent()` and future factories enable minimal-config agent creation; progressively customizable |
| Durable Streams webhook integration | Implemented via `durableAgent().runtime.wakeAdapter` composition (not core `createAgent` coupling), including callback claim/heartbeat/checkpoint/done |
| Agent sleep/wake | Persistent agents can be suspended and resumed; state rehydrated from collections |

### Learning Goals

1. Is chunk-based streaming ergonomic, or do users want progressive updates despite the anti-pattern?
2. Do users graduate from default schemas to custom composition, or do they want richer agent features?
3. What's the performance impact of many concurrent effects?
4. How do users want to handle generation cancellation?
5. Is `useLiveQuery` sufficient for UI, or do users want `useDurableChat`?

## Alternatives Considered

### Alternative 1: Action-Based Triggering

**Description:** Instead of effects watching queries, users call actions that write to collections AND trigger generation.

```typescript
const sendMessage = createAIAction({
  collection: messages,
  async execute(content) {
    await messages.insert({ role: 'user', content })
    const response = await chat({ adapter, messages: [...] })
    await messages.insert({ role: 'assistant', content: response })
  }
})
```

**Why not:** Less flexible for multi-agent scenarios. Effects allow any subscriber to react to state changes, enabling decoupled communication. Actions centralize control flow.

### Alternative 2: Progressive Update Streaming

**Description:** Update a single generation row as content streams, rather than appending chunks.

```typescript
// Row updated repeatedly as content streams
{ id: 'gen-1', content: 'Hello' }
{ id: 'gen-1', content: 'Hello world' }
{ id: 'gen-1', content: 'Hello world!' }
```

**Why not:** Write amplification—many updates to the same row. Doesn't align with Durable Streams' append-only model. Chunks are more efficient and enable replay.

### Alternative 3: Built-in Schema in Composable Layer

**Description:** Provide predefined schemas (`messageSchema`, `generationSchema`) in the composable layer.

**Why not:** Limits flexibility. Users have different requirements—threading, custom fields, different naming. Schema-agnostic approach lets users bring their own design. Predefined schemas only appear in the Phase 2 agent abstractions as default schemas.

### Alternative 4: Build Our Own Agent Loop

**Description:** Instead of composing with TanStack AI's `chat()` loop, build a custom `durableChat()` that manages its own agent loop using `adapter.chatStream()` directly.

```typescript
// Custom loop approach (NOT what we're doing)
async function* durableChat(options) {
  let messages = [...options.messages]
  while (true) {
    const stream = chat({ adapter, messages, tools })
    for await (const chunk of stream) {
      if (chunk.type === 'TOOL_CALL_END') {
        // Persist tool call, wait for result
        const result = await waitForToolResult(...)
        messages.push({ role: 'tool', content: result })
        continue  // Custom loop logic
      }
      yield chunk
    }
    if (!hasToolCalls) break  // Custom termination logic
  }
}
```

**Why not:** TanStack AI's `chat()` already has a robust agent loop with:
- Proper `agentLoopStrategy` configuration
- Error handling and retry logic
- Streaming chunk management
- Tool call accumulation

By providing an async `execute()` function via `makeDurableTool()`, we compose with the existing loop rather than reimplementing it. This is simpler and stays aligned with TanStack AI improvements.

### Alternative 5: Replace Tools Instead of Wrap

**Description:** Package provides its own `chat()` that takes standard tools and internally handles durable execution.

**Why not:** Adds complexity, hides control flow. Users may want to use `chat()` differently in different contexts. `makeDurableTool()` is explicit—users see exactly what's happening and can choose which tools to make durable.

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-02-01 | samwillis | Initial version. Composable primitives (`makeDurableTool`, `createToolExecutionEffect`, `streamToCollection`), shape contracts, chunk ordering, cancellation/late-result handling, idempotency, human-in-the-loop approvals, resumability, backend capability matrix, type-safe tool APIs (Approach 2). |
| 1.5 | 2026-02-01 | samwillis | Full type safety pass. Proper generics and type annotations throughout all examples. Added constraint types (`ToolCallContract`, etc.) to API summary. |
| 2.0 | 2026-02-08 | samwillis | Major revision. Added agent abstractions: `createAgent(durableAgent({...}))` composition pattern with collection-based and query/mutation-based data interfaces, `createWorkerAgent` for ephemeral task agents, agent-to-agent correlation via `requestId`/`inReplyTo`. Reorganised into phases: 1 (Composable Primitives), 2 (Agent Abstractions), 3 (Production Hardening), 4 (Advanced Patterns/Future). Aligned all examples with current TanStack DB effect API (`createEffect({ query, on, handler }}`) and TanStack AI `chat()` API (adapter-based model, `abortController`, `systemPrompts`, AG-UI chunk events). Removed distributed tool execution (deferred to Phase 4) — v1 assumes single-consumer per tool execution effect. Added implementation invariants. |
| 2.1 | 2026-02-08 | samwillis | Added protocol-agnostic runner lifecycle primitives (`runWithLifecycle`, `drainUntilIdle`, `RunnerLifecycleAdapter`, `CheckpointContract`) to support serverless wake/ack/checkpoint flows without coupling core agents to any transport. Clarified that `createAgent` remains backend-agnostic and `durableAgent` composes optional runtime adapters (including Durable Streams webhook lifecycle behavior) from Phase 1 primitives. Added lifecycle invariants and updated functional requirements/open questions accordingly. |
| 2.2 | 2026-02-08 | samwillis | Clarified Durable Streams webhook runtime behavior with two explicit modes: request-bound drain and immediate-ack wake. Added mode types/API surface (`WebhookExecutionMode`, `handleDurableStreamsWake`), callback sequencing requirements (claim, token rotation, heartbeat, checkpoint, done), and requirement/invariant updates for keepalive and callback-driven completion semantics. |
| 2.3 | 2026-02-08 | samwillis | Removed `agent.send(...)` as a user-facing interaction pattern. Updated examples and API summary so user messaging is modeled as direct writes to message streams/collections. Updated agent collaboration wiring to write inbox rows directly (or via `AgentReference.insertMessage` for custom-schema/query-mutation targets). |
| 2.4 | 2026-02-08 | samwillis | Updated `createAgent` contract so raw configs require an explicit `generate` function, while `durableAgent` provides a default chat-based generator. Added agent-instance loop APIs (`hasPendingWork`, `runGenerationCycle`, `drainUntilIdle`) and updated webhook integration examples to use these methods directly (removing external helper stubs). |

---

## RFC Quality Checklist

Before submitting for review, verify:

**Alignment**
- [x] RFC implements what the PRD specifies (not more, not less)
- [x] API naming follows TanStack conventions (camelCase functions)
- [x] Success criteria link back to PRD hypothesis

**Calibration for Level 1-2 PMF**
- [x] This is the simplest approach that validates the hypothesis
- [x] Non-goals explicitly defer Level 3-4 concerns
- [x] Complexity Check section is filled out honestly
- [x] An engineer could start implementing tomorrow

**Completeness**
- [x] Happy path is clear
- [x] Critical failure modes are addressed (not all possible failures)
- [x] Open questions are acknowledged, not glossed over
