---
title: "@tanstack/ai-db: Durable State for AI Agents"
version: "2.0"
status: draft
owner: samwillis
contributors:
  - samwillis
created: 2026-02-01
last_updated: 2026-02-08
rfcs:
  - ./ai-db-rfc.md
---

# @tanstack/ai-db: Durable State for AI Agents

## Summary

A layered package providing composable primitives for persisting AI operations to TanStack DB collections, agent abstractions for multi-user, multi-agent, multi-device AI applications, and optional default schemas for rapid prototyping—all backed by Durable Streams or any TanStack DB sync backend.

## Introduction

This PRD defines requirements for `@tanstack/ai-db`, a package that bridges TanStack AI and TanStack DB to enable durable, collaborative AI experiences. The package is progressively layered:

1. **Composable Primitives**: Schema-agnostic building blocks for connecting AI generation and tool execution to DB collections—working with any sync backend
2. **Agent Abstractions**: Persistent agents (long-lived reactive entities) and worker agents (ephemeral one-shot tasks), with default schemas and built-in history management for rapid setup
3. **Production Hardening**: Approval workflows, crash recovery, and resumability
4. **Advanced Patterns** (future): Multi-agent orchestration, job management, distributed coordination

The primary goals are:
1. Enable AI state that survives page refreshes, device switches, and reconnections
2. Support multi-user and multi-agent collaboration within shared sessions
3. Provide a path from simple `useChat`-style experiences to sophisticated agent orchestration
4. Leverage TanStack DB's reactive effects for event-driven AI workflows
5. Support persistent agents and worker agents as first-class abstractions
6. Support async tool execution across environments via persisted tool calls

## Background

### The Shift Toward Agentic AI

The AI ecosystem is evolving from simple request-response chat patterns toward:

- **Interactive + Background Composition**: Users interact with AI while background agents perform long-running tasks
- **Agent Swarms and Teams**: Multiple specialized agents collaborating on complex problems
- **Agent Composition**: Agents that call other agents—persistent agents communicating via shared collections, and worker agents invoked as tools for one-shot tasks
- **Cross-Environment Tools**: Tool calls persisted and picked up by a different environment (browser, server, edge)
- **Durable Workflows**: AI operations that survive crashes, restarts, and network interruptions
- **Async Tool Patterns**: Tools that start background processes and report status asynchronously rather than blocking the agent loop

Current solutions like `useChat` manage ephemeral client state. When users refresh, switch devices, or lose connection, context is lost. Multi-agent collaboration requires custom infrastructure.

### Emerging Patterns

**Persistent Agents**: Long-lived agent entities with ongoing identity, history, and reactive generation loops. Multiple persistent agents can coexist in a shared session, each watching for work addressed to them, building their own context from shared collections, and autonomously generating responses. They naturally handle messages that arrive mid-generation by looping when their inbox has pending work. This pattern is seen in frameworks like OpenAI's Agents SDK (agents with context/sessions), LangGraph (stateful agent nodes), and Cloudflare's Durable Objects.

**Worker Agents**: An ephemeral agent invoked for a one-shot task—either directly from application code (API endpoint, script, cron job) or as a tool within another agent. A fact-checker, summarizer, or code reviewer runs a complete agent loop with its own reasoning, tool calls, and output, then returns structured results. Unlike persistent agents, worker agents are stateless—fresh context each invocation, no memory between calls. This enables hierarchical agent composition without state leakage. This pattern maps to OpenAI's "agents as tools" pattern and is also useful as a standalone one-shot agent invoked directly from application code.

**Async Tools**: Not all tools should block the agent loop. A tool might start a long-running backend process (image generation, database migration, CI pipeline) and return immediately with a job ID. The agent can continue conversing while periodically checking status or being notified of completion.

### TanStack DB + Reactive Effects

TanStack DB provides:
- **Collections**: Typed, reactive data stores with optimistic updates
- **Live Queries**: Incrementally maintained query results with delta streams
- **Reactive Effects**: Handlers that fire when rows enter/exit/update query results (proposed in sibling RFC)
- **Sync Backends**: Electric SQL, PowerSync, Durable Streams, and more

Reactive effects enable a natural pattern: when a "generation request" row enters a collection with `status: 'pending'`, an effect triggers LLM generation and writes the result back.

### TanStack AI

TanStack AI provides:
- **Adapters**: Tree-shakeable adapters for OpenAI, Anthropic, Gemini, Ollama
- **`chat()` Function**: Streaming generation with tool calling and agent loops
- **`toolDefinition()`**: Isomorphic tool definitions with server/client implementations
- **Framework Hooks**: `useChat` for React, Solid, Vue, Svelte

`@tanstack/ai-db` complements TanStack AI by providing persistence and reactive triggering, not replacing its generation capabilities.

### Durable Streams State Protocol

The [Durable Streams State Protocol](https://github.com/durable-streams/durable-streams/blob/main/packages/state/STATE-PROTOCOL.md) defines:
- **Change Events**: `insert`, `update`, `delete` operations with type/key/value
- **Multi-type Streams**: Different entity types coexist in one stream
- **Append-only Semantics**: Natural fit for streaming AI responses as chunks

`@durable-streams/state` provides `StreamDB`, which creates TanStack DB collections backed by durable streams.

## Problem

### Core Problem Statement

Developers building AI applications face a gap between simple chat UIs and production-ready systems:

1. **State is ephemeral**: `useChat` manages in-memory state that's lost on refresh/disconnect
2. **No multi-device sync**: Users can't continue conversations across devices or tabs
3. **Multi-agent collaboration is DIY**: No standard patterns for multiple agents sharing state
4. **Tool execution is environment-locked**: Tools run in one context; no way to persist calls for another environment to pick up
5. **Streaming isn't durable**: If generation crashes mid-stream, partial work is lost
6. **No agent abstractions**: No standard patterns for persistent agents (long-lived reactive entities) or worker agents (ephemeral one-shot tasks) that collaborate via shared state
7. **All tools block**: No standard pattern for async tools that start background work and report later
8. **Context window management is manual**: No built-in patterns for conversation compaction, summarization, or history filtering as context grows
9. **No recovery from interruption**: Crashed or restarted servers leave orphaned state with no standard recovery
10. **Duplicate execution risks**: Effects can fire multiple times without idempotency guarantees
11. **Approval workflows are ephemeral**: Human-in-the-loop approvals don't persist across devices/sessions

### Why This Problem Matters Now

1. **Agent swarms are emerging**: LangChain, AutoGen, CrewAI, and others are popularizing multi-agent patterns—but collaboration infrastructure lags behind
2. **Agent composition is the next wave**: Complex tasks need hierarchical composition—persistent agents leading teams, worker agents handling specialist tasks
3. **Local-first AI is desirable**: Users want AI that works offline and syncs when connected
4. **AI is becoming infrastructure**: Applications need AI as a durable, observable system—not an ephemeral API call
5. **TanStack ecosystem alignment**: TanStack DB + TanStack AI users need a bridge

## Personas

### Persona 1: AI App Developer (Upgrading from useChat)

**Who:** Developer currently using `useChat` from Vercel AI SDK or TanStack AI, building chat-based AI applications

**Their problem:** They want durability (state survives page refresh, device switches) and multi-tab sync without building custom infrastructure. Currently, they rebuild conversation state on every reconnect and lose context when users switch devices.

**Example scenarios:**
- User refreshes page mid-conversation and wants to continue
- User starts conversation on phone, continues on laptop
- Multiple browser tabs showing the same conversation in sync

### Persona 2: Multi-Agent System Builder

**Who:** Developer building systems where multiple AI agents collaborate—coding assistants with planner/coder/reviewer agents, research systems with specialized domain agents

**Their problem:** They need shared state visible to all agents, with tool calls that can be persisted and picked up by different environments (local browser, backend servers, edge workers). Currently, they build custom message-passing infrastructure. They need both persistent agents (long-lived entities with ongoing identity and history) and ephemeral worker agents (task-scoped specialists called as tools).

**Example scenarios:**
- Persistent planner agent watches for tasks, collaborates with persistent researcher and writer agents via shared collections
- Worker agent (fact-checker) is called as a tool by a persistent research agent—fresh context each call, returns structured output
- Multiple persistent agents observe the same conversation and contribute, each with their own context window and generation loop
- A user sends a message to a persistent agent while it's mid-generation; the agent picks it up automatically in its next loop iteration
- Tool calls routed to appropriate execution context (client vs server)

### Persona 3: Local-First AI Developer

**Who:** Developer building offline-capable AI applications for mobile or desktop

**Their problem:** They want optimistic UI with eventual sync, conflict resolution for concurrent edits, and AI operations that queue when offline and execute when connected.

**Example scenarios:**
- User sends messages offline, they sync when reconnected
- Optimistic UI shows "sending..." while awaiting confirmation
- Conflicts between devices resolved gracefully

## Requirements and Phases

### Phase 1: Composable Primitives

_Schema-agnostic building blocks for connecting AI generation and tool execution to user-defined collections. These primitives are independently useful without agent abstractions—users can wire them together manually with their own schemas and sync backends._

#### Architectural Principle: Collection as Communication Layer

The composable primitives communicate through collections, not direct wiring. This enables:

- Generation running in one environment (e.g., server)
- Tool execution in another (e.g., client, worker, different server)
- Single-consumer model per environment — each tool execution effect assumes it is the sole consumer of matching rows
- All communication via synced collections

#### Requirement 1.1: Durable Tool Wrappers

Wrappers that make TanStack AI tools "durable" by persisting calls to a collection and waiting for results via sync.

**Acceptance Criteria:**

- [ ] A wrapper can make any TanStack AI tool definition durable
- [ ] When the LLM calls a durable tool, a pending row is inserted into the user's collection
- [ ] The wrapper waits for the row to be marked complete (via collection sync)
- [ ] Returns result to TanStack AI's agent loop—composing with existing loop, not replacing
- [ ] User provides transform functions for their schema (no fixed field names)
- [ ] User provides completion detection logic (e.g., `row.status === 'completed'`)
- [ ] Configurable timeout for waiting

**Considerations:**

- How to pass generation ID for correlating tool calls with their parent generation?
- What happens when timeout expires—error or undefined?
- Should there be abort signal integration?

#### Requirement 1.2: Tool Execution Effects

Effects that watch for pending tool calls and execute them.

**Acceptance Criteria:**

- [ ] A tool execution effect accepts a user-defined query for pending tool calls
- [ ] The effect looks up tool implementation by name and executes it
- [ ] User provides callbacks for writing results back (their schema, their fields)
- [ ] Tools are defined in the environment where they execute
- [ ] The effect and durable tool wrapper are decoupled—they communicate via the collection

**Considerations:**

- Should tool implementations receive context (session info, actor info)?
- How to handle tool execution timeouts?
- Should there be a way to register tools globally vs per-effect?

#### Requirement 1.3: Generation Effect Helpers

Helpers to create effects that trigger LLM generation based on user-provided queries.

**Acceptance Criteria:**

- [ ] A generation effect accepts a user-defined query that returns pending generation requests
- [ ] The user's query determines what triggers generation (their schema, their fields)
- [ ] The effect calls a user-provided generation function (e.g., TanStack AI's `chat()` with durable tools)
- [ ] User provides callbacks for writing results back
- [ ] Recommended to use `$synced = true` filtering to avoid triggering on optimistic state

**Considerations:**

- How to handle cancellation when a request is deleted mid-generation?
- Should there be built-in retry logic, or leave to userland?

#### Requirement 1.4: Chunk-Based Streaming Persistence

Support for persisting streaming AI responses as append-only chunks to user-defined collections.

**Acceptance Criteria:**

- [ ] A streaming persistence helper writes chunks as they stream from `chat()` response
- [ ] User provides their own chunks collection (must satisfy Chunk Ordering Shape contract)
- [ ] User provides transform function for their chunk schema
- [ ] Clients can subscribe to chunks and materialize full response via query
- [ ] Support for final-only persistence for simpler use cases
- [ ] Durable tools work seamlessly with streaming—tool calls pause the stream, wait for results, then continue

**Ordering & Identity Guarantees:**

- [ ] Each chunk has a unique ID within the stream
- [ ] Each chunk has a `generationId` linking to parent generation
- [ ] Each chunk has an `index` (sequence number) for deterministic ordering
- [ ] Final chunk is identifiable (via `isFinal` flag or generation status change)
- [ ] Reassembly query: `ORDER BY index` produces correct text reconstruction
- [ ] Concurrent generations produce non-interleaved chunks (each has distinct `generationId`)

**Chunk Materialization:**

For UI rendering, chunks will typically be materialized as part of a hierarchical query. This will leverage the [Joins with hierarchical projection (includes)](https://github.com/TanStack/db/issues/288) feature proposed for TanStack DB, allowing subqueries in `select` clauses:

```typescript
// Future: hierarchical projection for generations with their chunks
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

Until this feature is available, clients can use separate queries or join in application code.

**Considerations:**

- How to handle tool calls that appear mid-stream? (Tool call chunks have different type)
- What chunk types are needed? (`text`, `tool-call-start`, `tool-call-args`, `tool-result`, `thinking`)

**Anti-pattern Note:** Progressive update persistence (updating a single row repeatedly as content streams) is intentionally not supported due to write amplification. Chunk-based is the recommended approach.

#### Requirement 1.5: Async (Fire-and-Forget) Tool Calls

Tools that start background processes and report status asynchronously rather than blocking the agent loop.

**Acceptance Criteria:**

- [ ] Async tools return immediately with a job/task ID
- [ ] Tool execution effect starts the background work
- [ ] Agent loop continues without blocking
- [ ] Status updates can be pushed to the conversation at appropriate moments
- [ ] User defines how status is reported (new message, tool result update, etc.)
- [ ] Pattern supports both polling (agent checks status) and push (status appears in conversation)

**Considerations:**

- How does the agent know when to check status vs. continue?
- Should there be a standard "job status" tool pattern?
- How to handle long-running jobs that outlive the conversation session?

#### Requirement 1.6: Cancellation & Cleanup

Support for cancelling in-progress operations and cleaning up partial state.

**Acceptance Criteria:**

- [ ] Generation can be cancelled via abort signal
- [ ] Cancellation propagates to in-flight tool calls
- [ ] Partial chunks are handled gracefully (either kept with "cancelled" marker or cleaned up)
- [ ] Pending tool calls for cancelled generations can be marked as cancelled
- [ ] User controls cleanup behavior (keep partial state vs delete)
- [ ] No orphaned state after cancellation

**Late-Arriving Results Policy:**

When a tool call completes after its parent generation was cancelled:

- [ ] Tool execution effect checks generation status before writing result
- [ ] If generation is cancelled, tool result is either:
  - **Discarded**: Result not written, tool call marked as `cancelled` (default)
  - **Stored but ignored**: Result written with flag indicating parent was cancelled
- [ ] User configures policy via option (discard vs store)
- [ ] Late results do NOT resume cancelled generations

**Cancellation States:**

- `cancelled-by-user`: Explicit user cancellation
- `cancelled-by-timeout`: Generation/tool exceeded time limit
- `cancelled-by-error`: Cascading cancellation due to upstream failure

**Considerations:**

- Should cancellation be "soft" (mark as cancelled) or "hard" (delete)?
- How to handle tool calls that have already started executing but not completed?

#### Requirement 1.7: Idempotency & Duplicate Prevention

Prevent duplicate execution when effects fire multiple times for the same request.

**Acceptance Criteria:**

- [ ] Generation effects don't trigger twice for the same pending row
- [ ] Tool execution effects don't execute the same tool call twice
- [ ] Status transitions are atomic (pending → running prevents duplicate runs)
- [ ] `$synced` filtering prevents optimistic duplicates
- [ ] Race conditions between multiple effect instances are handled
- [ ] Clear guidance on achieving at-least-once vs exactly-once semantics

**Considerations:**

- How to handle the case where status update fails after execution starts?
- Should there be a generation/tool call ID that's checked before execution?
- Optimistic locking patterns for status transitions

#### Requirement 1.8: Schema-Agnostic with Shape Contracts

The composable layer does not define fixed schemas, but specifies **minimal shape contracts** that user schemas must satisfy for idempotency and ordering guarantees.

**Acceptance Criteria:**

- [ ] All helpers accept user-defined queries, not fixed collection types
- [ ] Users have full control over field naming and additional fields
- [ ] Helpers document **required shape contracts** for rows
- [ ] Optional helper schemas provided for users who want safe defaults

**Shape Contracts:**

The following minimal shapes are **required** for execution guarantees:

**Tool Call Shape:**
```
{
  id: string           // Unique tool call identifier
  status: string       // Must support at least: pending → executing → completed|failed|cancelled
  name: string         // Tool name for dispatch
  args: unknown        // Tool arguments
}
```

**Generation Request Shape:**
```
{
  id: string           // Unique generation identifier  
  status: string       // Must support at least: pending → generating → completed|failed|cancelled
}
```

**Chunk Ordering Shape:**
```
{
  id: string           // Unique chunk identifier
  generationId: string // Parent generation for grouping
  index: number        // Sequence number for ordering (0, 1, 2...)
  isFinal?: boolean    // Optional: marks last chunk in stream
}
```

Users can add any additional fields. Field names are examples—users provide their own names via transform functions, but must map to these semantic roles.

**Design Note:** Pre-defined default schemas with these contracts are provided in Phase 2. Advanced users can define their own schemas that satisfy the contracts.

#### Requirement 1.9: Sync Backend Agnostic

Composable layer works with any TanStack DB sync backend.

**Acceptance Criteria:**

- [ ] Works with TanStack Query
- [ ] Works with Durable Streams sync
- [ ] Works with Electric SQL sync
- [ ] Works with local-only (no sync) for development/testing
- [ ] No hard dependency on any specific sync backend

**Backend Capability Matrix:**

| Capability | Durable Streams | Electric SQL | TanStack Query | Local-only |
|------------|-----------------|--------------|----------------|------------|
| `$synced` virtual prop | ✅ | ✅ | ❌ | ❌ |
| Multi-device sync | ✅ | ✅ | ✅ (via server) | ❌ |
| Optimistic updates | ✅ | ✅ | ✅ | N/A |
| Cross-environment tools | ✅ | ✅ | ⚠️ (single server) | ❌ |

**Alternative Patterns for Backends Without `$synced`:**

For backends that don't support `$synced` (TanStack Query, local-only):

- **Server-side effects only**: Run generation/tool effects on server where data is authoritative
- **Explicit confirmation field**: User adds a `confirmed` boolean set by server
- **Timestamp-based**: Filter by `createdAt < (now - debounce)` to avoid immediate triggers

Documentation should provide backend-specific guidance for each pattern.

### Phase 2: Agent Abstractions

_Persistent agents and worker agents that compose Phase 1 primitives into higher-level patterns, with default schemas for rapid setup and built-in history management. Agents use the composable primitives under the hood but provide a significantly simpler developer experience._

#### Requirement 2.1: Persistent Agents

A persistent, long-lived agent entity with its own identity, history, and reactive generation loop. The agent watches for pending work in its collections and autonomously generates responses, looping until its inbox is empty.

**Motivation:**

In multi-user, multi-agent chat sessions, each agent is a distinct entity with its own conversation history, tool call history, context window, and generation loop. A persistent agent:

- Accumulates history across many interactions
- Picks up new messages automatically—even those sent while it is mid-generation
- Only pauses when there is no pending work, then restarts as soon as new work arrives
- Can be addressed by users and other agents via the shared collections

**Acceptance Criteria:**

- [ ] A persistent agent is a named entity with its own instructions, model configuration, and tool set
- [ ] The agent reactively watches for pending work via a user-defined query over its collections
- [ ] When pending work appears (e.g., new unprocessed messages), the agent builds its LLM context and runs a generation cycle
- [ ] When generation completes, the agent re-checks for pending work—if new work arrived during generation, it loops immediately without going idle
- [ ] The agent goes idle only when there is no pending work, and wakes automatically when new work arrives
- [ ] The agent accumulates conversation history across generation cycles—it has persistent memory
- [ ] The user controls how the agent builds its LLM context from collection state (context window management)
- [ ] The user controls how the agent writes its output back to collections
- [ ] Users and other agents can send messages to a persistent agent, triggering its generation loop
- [ ] A persistent agent can be exposed as a tool for other agents—the calling agent sends a message to the persistent agent's inbox and waits for its response (durable tool semantics)
- [ ] A persistent agent can be exposed as an async/fire-and-forget tool—sends a message and returns immediately with a reference
- [ ] Multiple persistent agents can coexist in the same session, each with their own reactive loop watching the same or different collections
- [ ] The agent's generation loop is built on reactive effects under the hood
- [ ] The agent can be disposed/cleaned up when no longer needed

**Execution Context:**

Persistent agents are environment-agnostic and can run in any JavaScript context:

- **Browser main thread**: For client-side agents that interact with the UI
- **Web Workers**: For background processing without blocking the UI thread
- **Server (Node.js, Deno, Bun)**: For backend agents with access to server resources
- **Edge Workers (Cloudflare Workers, Vercel Edge)**: For low-latency, globally distributed agents
- **Durable Objects**: For agents that need strong consistency and single-instance guarantees

Because all communication happens via synced collections, different agents in the same session can run in entirely different environments.

**Sleep/Wake Lifecycle:**

Persistent agents must support a sleep/wake lifecycle for resource-efficient deployment:

- [ ] When a persistent agent has no pending work, it can be suspended (go to sleep), releasing compute resources
- [ ] When new work arrives in its collections (e.g., a new message), the agent can be woken and resume processing
- [ ] The wake mechanism is environment-specific—platforms can use webhooks, Durable Object alarms, queue triggers, or any event source to wake an agent
- [ ] On wake, the agent rehydrates its state from collections (since all state is persisted in the sync layer)
- [ ] The sleep/wake cycle is transparent to callers—sending a message to a sleeping agent's inbox triggers a wake
- [ ] This enables cost-efficient deployment where agents only consume compute when there is work to do

**Example:** An agent running in a Cloudflare Durable Object sleeps when idle. A webhook from an external system inserts a message into the agent's collection, which triggers the Durable Object to wake, rehydrate, and process the message.

**Communication via Collections:**

The persistent agent model uses collections as the communication layer:
- Users and other agents communicate with the agent by inserting messages into collections
- The agent's pending work query determines what triggers generation
- The agent writes its responses back to the same collections
- All state is observable via live queries

**Considerations:**

- Should the agent be live immediately upon creation, or require an explicit start?
- How to handle multiple pending messages—batch into one generation or process sequentially?
- How does the agent's context window management interact with its persistent history?
- What is the minimum state an agent needs to persist for efficient rehydration on wake?
- How to handle the transition from "sleeping" to "awake" atomically to prevent duplicate wake-ups?

#### Requirement 2.2: Worker Agents

An ephemeral, stateless agent that runs a one-shot task with a fresh context each invocation. A worker agent does not require a parent agent—it can be invoked directly from application code (API endpoint, script, cron job, etc.) or used as a tool within another agent.

**Motivation:**

Many AI tasks don't need persistent identity or history. A fact-checker, summarizer, code reviewer, or translator is called with input, does its work (possibly using its own tools), and returns structured output. Each call is independent—no memory of previous invocations. This is fundamentally different from a persistent agent. Worker agents are useful both as tools composed into larger agent systems AND as standalone one-shot agents invoked directly from application code.

**Acceptance Criteria:**

- [ ] A worker agent is a named entity with instructions, model configuration, tool set, and typed input/output schemas
- [ ] Each invocation creates a fresh generation context—no history or memory from previous calls
- [ ] The worker agent builds its LLM messages from the provided input (user-controlled)
- [ ] The worker agent can use its own tools internally (including other worker agents or durable tools)
- [ ] The worker agent returns structured output matching its output schema
- [ ] The worker agent can be invoked directly from application code without a parent agent (e.g., from an API handler, script, effect, or cron job)
- [ ] The worker agent can also be used as a tool within another agent's tool list (satisfies the tool interface)
- [ ] The worker agent's internal work (tool calls, chunks) can optionally be persisted to collections for observability and crash recovery
- [ ] When used as a tool within another agent, the worker agent's internal state is scoped and correlated with the parent generation
- [ ] The worker agent integrates with standard cancellation and timeout mechanisms

**Relationship to Async Tools:** A worker agent can be exposed as either a blocking tool (caller waits for result) or an async tool (caller gets a reference and continues). See Phase 1, Req 1.5.

**Key Differences from Persistent Agents:**

| Aspect | Persistent Agent | Worker Agent |
|--------|-----------------|--------------|
| Lifecycle | Long-lived, accumulates history | Fresh instance per invocation |
| Identity | Singleton entity with ongoing state | No identity between calls |
| Trigger | Reactive (watches collections for pending work) | Invoked directly or called as a tool |
| Context | Full conversation history | Only the input provided for this call |
| Memory | Remembers past interactions | Stateless between calls |
| Crash recovery | Resumes where it left off | Re-run from start (idempotent) |

**Considerations:**

- Should worker agents support streaming their output, or only final results?
- How to correlate worker agent activity with the calling context for debugging?
- Should there be a nesting depth limit for worker agents calling other worker agents?
- How to handle worker agent errors—propagate to caller or handle independently?

#### Requirement 2.3: Default Schemas

Default collection schemas that satisfy all Phase 1 shape contracts, so users can create agents with minimal configuration.

**Acceptance Criteria:**

- [ ] Default schemas provided for messages, generations, tool calls, and chunks collections
- [ ] Default schemas satisfy all shape contracts (Tool Call, Generation Request, Chunk Ordering shapes)
- [ ] Default message schema includes `role`, `actorId` (for multi-user/agent attribution), `content`, and `createdAt` for ordering
- [ ] Default schemas are usable directly with persistent and worker agents
- [ ] Users can extend default schemas with additional fields without breaking shape contracts
- [ ] Default schemas are not required—advanced users can define fully custom schemas that satisfy the shape contracts
- [ ] A persistent agent can be created with minimal configuration (name, adapter, model, instructions) when using default schemas
- [ ] Collections and effects are automatically set up when using default schemas
- [ ] Users can progressively customize: start with defaults, then override individual schemas, context building, or output handling as needs grow
- [ ] Clear migration path from default schemas to fully custom schemas

**Design Note:** Default schemas are an on-ramp for new users. They should feel like the "obvious" starting point and cover common use cases (chat, multi-agent collaboration, tool execution). The agent implementation and default schemas are co-developed—the transforms and projections that agents need internally define the schema shape.

#### Requirement 2.4: Built-in Durable Streams Integration

Default schemas work out of the box with Durable Streams for persistence.

**Acceptance Criteria:**

- [ ] Default schemas are backed by Durable Streams via StreamDB
- [ ] Automatic preloading of state on creation
- [ ] Chunk-based streaming persistence using State Protocol events
- [ ] Transaction IDs for confirming writes

**Stream Size Consideration:**

Default configurations backed by a single durable stream work well for most use cases. For very long-running or highly active sessions where the stream grows large:

- Use Durable Streams for recent/active data (real-time sync)
- Use Electric SQL or TanStack Query for historical data (query-driven sync)
- TanStack DB's on-demand collections enable hybrid sync where only the portions of history needed for the current view are synced

Users who outgrow the default configuration should customize their collections using Phase 1 primitives.

#### Requirement 2.5: Chat History Management

Patterns and built-in support for managing conversation history as context grows.

**Acceptance Criteria:**

- [ ] User can filter/transform messages before passing to generation
- [ ] Support for message compaction (summarizing older messages)
- [ ] Integration with TanStack AI's `summarize()` activity for context summarization
- [ ] Support for stripping tool call details from history (keep results, drop verbose args)
- [ ] Support for sliding window patterns (keep last N messages + summary)
- [ ] User controls what goes into context—not automatic
- [ ] Default schemas include built-in history management with configurable message window
- [ ] Optional auto-summarization of older messages using TanStack AI's `summarize()`

**Summary Storage & Sync:**

- [ ] Summaries stored in dedicated `summaries` collection (not inline in messages)
- [ ] Summary record includes: `id`, `createdAt`, `coveringUpTo` (timestamp of last summarized message), `content`
- [ ] Summaries sync to all devices like any other collection
- [ ] Context assembly: `[summaries covering old messages] + [recent messages within window]`
- [ ] Multiple summaries can exist (progressive summarization as conversation grows)
- [ ] Old messages are NOT deleted—summaries are additive

**Context Derivation (same on all devices):**

```
contextMessages = 
  summaries.filter(s => s.createdAt < cutoffTime)
  + messages.filter(m => m.createdAt >= cutoffTime)
  ORDER BY createdAt
```

This ensures all devices derive identical context from the same synced data.

**Considerations:**

- Should compaction happen automatically or on-demand?
- How to preserve important context while reducing token usage?
- Should there be standard message selectors (e.g., "last N messages", "messages since summary")?
- How to handle multi-turn tool calls in compacted history?

### Phase 3: Production Hardening

_Capabilities needed for production-grade deployments—approval workflows, crash recovery, and resumability. These build on Phases 1 and 2 but are not required for initial development or prototyping._

#### Requirement 3.1: Human-in-the-Loop Approvals

Integration with TanStack AI's tool approval workflow for durable state.

**Acceptance Criteria:**

- [ ] Tool calls requiring approval are persisted with approval state
- [ ] Approval can happen from any device (approve on phone, execute on server)
- [ ] Approval state syncs across all connected clients
- [ ] Approved tools resume execution automatically
- [ ] Denied tools are marked and reported back to the agent
- [ ] Timeout for pending approvals (configurable)

**Authorization & Security:**

- [ ] Approval records include `approvedBy` actor ID for attribution
- [ ] Approval records are append-only/immutable for audit trail
- [ ] API layer validates approver identity before accepting approval
- [ ] Tool execution verifies approval was granted by authorized actor
- [ ] Sync backend ACLs should restrict who can write approval state

**Important:** Authorization enforcement is a shared responsibility:
- **Sync backend**: Controls who can read/write collections (ACLs)
- **API layer**: Validates actor identity on approval submissions
- **Effect layer**: Verifies approval before execution

This PRD defines the data contracts; access control configuration is sync-backend-specific.

**Considerations:**

- How to display approval requests in UI (via live query)?
- Multi-approver patterns (require N approvals)?
- Should denied approvals be retryable or permanent?

#### Requirement 3.2: Resumability & Recovery

Support for resuming interrupted operations after crashes or restarts.

**Acceptance Criteria:**

- [ ] In-progress generations can be detected on startup
- [ ] Orphaned "generating" state can be recovered (retry or mark failed)
- [ ] Partial tool call chains can be resumed
- [ ] Streaming can resume from last persisted chunk (if possible)
- [ ] Clear distinction between resumable and non-resumable states
- [ ] Configurable recovery behavior (auto-retry vs manual intervention)

**Considerations:**

- How long after a crash should auto-recovery be attempted?
- What state is needed to resume a generation mid-stream?
- Should there be explicit checkpoint support for long-running agents?

### Phase 4: Advanced Patterns (Future)

_Patterns that build on top of Phases 1-3. Distributed tool execution coordination (claiming, lease management, multi-executor deduplication) is also deferred here — for v1, tool execution assumes a single consumer per environment._

#### Requirement 4.1: Multi-Agent Orchestration

Higher-level patterns for composing persistent agents and worker agents.

**Acceptance Criteria:**

- [ ] Standard patterns for persistent agent teams (multiple agents watching shared collections)
- [ ] Patterns for agent-to-agent communication via collections (one agent's output triggering another)
- [ ] Worker agent composition (worker agents using other worker agents as tools)
- [ ] Parallel agent execution patterns (multiple persistent agents running concurrently)
- [ ] Agent lifecycle management (creating, pausing, resuming, disposing agents)
- [ ] Agent status observability via live queries (is it generating? idle? errored?)

#### Requirement 4.2: Job/Task Management

Patterns for long-running async operations.

**Acceptance Criteria:**

- [ ] Job status tool pattern documentation
- [ ] Progress reporting patterns
- [ ] Job cancellation support
- [ ] Job result notification patterns

### Non-Functional Requirements

#### Performance Expectations

| Metric | Target | Notes |
|--------|--------|-------|
| Chunk write latency | < 50ms p95 | Per-chunk insert to collection |
| Effect trigger latency | < 100ms p95 | Time from row insert to effect firing |
| Tool result round-trip | < 500ms p95 | Excluding tool execution time |
| Max concurrent generations | 10+ per session | Depends on sync backend |

#### Storage Guidelines

| Item | Recommendation |
|------|----------------|
| Max chunk size | 4KB (text content) |
| Max chunks per generation | 10,000 |
| Message retention | User-configurable; default unlimited |
| Summary frequency | Every 50-100 messages |

#### Reliability

- Effects should be **at-least-once** by default (idempotent handlers recommended)
- **Exactly-once** achievable via shape contracts + status transitions (single-consumer model)
- Target availability aligned with sync backend SLA

### Deferred Considerations

The following are explicitly out of scope for initial phases but noted for future consideration:

- **Framework-specific hooks**: `useDurableChat` for React—evaluate whether standard DB hooks (`useLiveQuery`) are sufficient
- **Threaded/branching messages**: Advanced conversation structures—use composable layer
- **Progressive update streaming**: Updating single rows as content streams—anti-pattern due to write amplification
- **Automatic context window management**: Auto-compaction when approaching token limits—requires token counting
- **Agent memory/retrieval**: Long-term memory patterns beyond conversation history (RAG, vector stores)—separate concern
- **Agent supervision and monitoring dashboards**: Real-time dashboards for agent fleet management—observability layer
- **Multimodal content storage**: Images, audio, video handling—binary storage is a separate concern
- **Cost/token tracking**: Usage metrics and budget management—observability layer
- **Rate limiting**: Preventing runaway effects or agent loops—infrastructure concern
- **Multi-tenant access control**: Permission systems—handled at sync backend level
- **Agent-to-agent authentication**: Verifying agent identity across environments—security concern
- **Distributed tool coordination**: Claiming, lease management, and multi-executor deduplication for tool calls—implement at application or sync-backend layer for now

## User Research

### Ecosystem Observation (Hypothesis-Driven)

This PRD is based on observation of emerging patterns in the AI ecosystem rather than direct user interviews. The following hypotheses should be validated:

**Hypothesis 1: Durability Gap**
> Developers using `useChat`-style APIs want their AI state to be durable (survive refresh, sync across devices) but current solutions require significant custom infrastructure.

**Validation approach:** Survey TanStack AI users about pain points; track feature requests related to persistence.

**Hypothesis 2: Multi-Agent Collaboration Need**
> As "agent swarms" and multi-agent systems become more common (LangChain, AutoGen, CrewAI), developers need standard patterns for shared state and cross-environment tool execution.

**Validation approach:** Analyze GitHub discussions and Discord questions about multi-agent patterns; prototype with early adopters.

**Hypothesis 3: Composition Over Frameworks**
> Advanced users prefer composable primitives over opinionated frameworks, but beginners need an on-ramp.

**Validation approach:** Observe adoption patterns—do users start with sessions and graduate to composition, or skip sessions entirely?

**Hypothesis 4: Agent Composition Is Emerging**
> Complex tasks require both persistent agents (long-lived reactive entities leading teams) and worker agents (ephemeral one-shot specialists), with the ability to compose them hierarchically.

**Validation approach:** Monitor adoption of multi-agent patterns in OpenAI Agents SDK, LangGraph, AutoGen, CrewAI, and similar frameworks. Track demand for both long-lived agent identities and one-shot specialist agents.

**Hypothesis 5: Async Tools Are Needed**
> Not all tool calls should block the agent loop—some should start background work and report later.

**Validation approach:** Identify use cases where blocking tool execution is limiting (image generation, CI pipelines, long-running analysis).

### Ecosystem Trends

| Trend | Evidence | Implication |
|-------|----------|-------------|
| Persistent agents | OpenAI Agents SDK sessions, Cloudflare Durable Objects, LangGraph stateful nodes | Long-lived agent entities need identity, history, and reactive loops |
| Agent composition | OpenAI agents-as-tools, LangGraph hierarchical agents, CrewAI crews | Agents calling agents—both persistent (collaboration) and ephemeral (specialist tasks) |
| Agent swarms | LangChain, AutoGen, CrewAI adoption | Need for collaboration infrastructure via shared state |
| Sleep/wake agents | Cloudflare Agents SDK hibernate, Durable Object alarms, serverless functions | Agents must be suspendable and resumable for cost-efficient deployment |
| Durable execution | Cloudflare Agents SDK, Temporal | AI operations need persistence and crash recovery |
| Local-first AI | On-device models, offline apps | State must sync across contexts |
| Tool calling | Every major LLM supports tools | Tool execution is a core pattern |
| Async patterns | Background jobs, progress updates | Not all work is synchronous |

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-02-01 | samwillis | Initial version. Composable primitives, shape contracts, idempotency, cancellation, backend capability matrix. |
| 2.0 | 2026-02-08 | samwillis | Major revision. Added agent abstractions: persistent agents (long-lived reactive entities with sleep/wake lifecycle) and worker agents (ephemeral one-shot tasks). Reorganised into phases: 1 (Composable Primitives), 2 (Agent Abstractions + Default Schemas), 3 (Production Hardening), 4 (Advanced Patterns/Future). Removed distributed tool execution — v1 assumes single-consumer per tool execution effect; distributed coordination deferred to Phase 4. Renamed "coordination contracts" → "shape contracts". |
