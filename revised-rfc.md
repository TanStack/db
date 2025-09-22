Got it — no “v2.” Here’s a **fresh, cleaned-up PRD** that incorporates the refinements we settled on, while sticking closely to your original draft’s structure and style.

---

# Product Requirements Document: Offline-First Transactions

## Title

**Offline-First Transactions**

## Summary

Enable TanStack DB applications to persist every mutation to a durable **outbox** before dispatch. Outbox items replay automatically when connectivity is restored, with parallelism across distinct keys, serialization per key, exponential backoff with jitter, and developer hooks for squashing/filtering. Optimistic state is restored on restart.

---

## Introduction

TanStack DB currently rolls back and discards failed optimistic mutations. There is no persistence across restarts, automatic retry, or failure discrimination. This feature adds an **offline-first outbox system** so applications can work reliably offline without losing user input. Developers maintain control of their write paths, with optional affordances like generated idempotency keys.

---

## Background

Without offline-first support, developers must either:

1. Accept data loss when users work offline.
2. Write custom retry/persistence logic.
3. Switch to alternative offline-first solutions.

The demand is clear across field service, productivity, mobile, and local-first apps. This PRD delivers a resilient outbox with strong default behavior and escape hatches for advanced use cases.

---

## Problem

**1. Data Loss:** Failed mutations vanish.
**2. No Persistence:** Closing/restarting apps while offline loses all pending writes.
**3. No Failure Discrimination:** All errors are treated the same, leading to wasted retries or premature abandonment.

---

## Personas

Same as original (Field Service Developer, Productivity App Developer, Local-First Developer, Mobile App Developer).

---

## Requirements

### 0) Mutator Registry & Serialization

* Mutations are stored as `{ mutatorName, args }` where `args` is JSON-serializable.
* Apps **register mutators** at init. On replay, the system calls the registered mutator with persisted args.
* No persisted closures.

### 1) Outbox-First Persistence

* **Persist before dispatch.** Outbox item schema:

  ```
  {
    id: string,                    // client-generated
    mutatorName: string,
    args: unknown,                 // JSON-serializable
    key: string | string[] | 'unknown', // scheduling key(s), auto-derived
    idempotencyKey?: string,       // optional affordance
    createdAt: number,
    retryCount: number,
    nextAttemptAt: number,
    lastError?: SerializedError,
    metadata?: Record<string, any>,
    version: 1
  }
  ```
* Async storage adapter (IndexedDB/OPFS default).

### 2) Automatic Replay & Intelligent Execution

* Executor runs at app init and when online.
* **Scheduling:**

  * Same key → sequential (creation order).
  * Different keys → parallel, up to `maxConcurrency` (default 4).
  * Unknown key → serial fallback.
* **Key derivation:** automatic (`args.id`, `args.ids`). Optional `keyExtractor` override.
* **Retry policy:** exponential backoff with jitter (`1,2,4,8,16,32,60s cap`). Respect `Retry-After`.
* **Triggers:** init, online, visibilitychange, focus, any success.

### 3) Failure Discrimination

* **Default:** retry on error.
* **`NonRetriableError`:** drop item immediately.
* (More error classes may come later.)

### 4) Developer Control

* `beforeRetry(items[])` → allows squash/filter/rewrites.
* `removeFromOutbox(id)` → manual drop.
* `peekOutbox()` → diagnostics (optional v1).

### 5) Optional Idempotency

* System can generate an `idempotencyKey` per item and pass it into the mutator.
* Developers decide whether/how to use it in their write path.

### 6) Optimistic State on Restart

* On restart, re-apply outbox items to restore optimistic state immediately.
* Reconcile as network confirmations arrive.

### 7) Multi-Tab Safety

* Only one executor runs per origin.
* Use **Web Locks API** when available.
* Fallback: **BroadcastChannel leader election**.
* Leadership fails over within a bounded time when a tab closes.

### 8) Scope Boundaries

Out of scope for v1: Service Worker/Background Sync, Electric-aware confirmation, extended error taxonomy, Devtools/telemetry.

---

## APIs

### A) Mutator Registration

```ts
registerOfflineMutators({
  addTodo: async ({ args, idempotencyKey }) => { /* write path */ },
  updateTodo: async ({ args, idempotencyKey }) => { /* ... */ },
})
```

### B) Creating offline mutations

```ts
const addTodo = createOfflineTransaction({
  mutatorName: 'addTodo',
  enableIdempotencyKey: true,
})
await addTodo({ id: '123', text: 'Buy milk' })
```

* Resolves when enqueued, not when committed.

### C) Starting executor

```ts
startOfflineExecutor({
  maxConcurrency: 4,
  jitter: true,
  beforeRetry: (items) => items,   // squash/filter/rewrite
  storage: indexedDbAdapter(),
  leaderElection: 'auto',          // weblocks → broadcast-channel fallback
})
```

---

## Acceptance Criteria

* **Outbox:** Every mutation enqueues before any network call.
* **Persistence:** Items survive app restarts with full data intact.
* **Replay:** Distinct keys run in parallel, same key runs sequentially.
* **Backoff:** Retries increase exponentially, capped at 60s, jittered.
* **NonRetriableError:** Items drop immediately and surface error.
* **beforeRetry:** Hook can squash/filter/transform items.
* **Optimism:** After restart, optimistic state reflects enqueued mutations.
* **Multi-tab:** Only one executor runs; failover occurs cleanly.
* **Idempotency (optional):** If enabled, the same key is reused across retries.

---

## Considerations

* **Storage quota & migrations.** Must handle gracefully.
* **Unknown key path.** Safe serial lane is fine.
* **Timeouts.** Default (e.g., 15s) → retry with backoff.
* **Security.** Never persist secrets; only args + metadata.

---

Awesome — here’s a sharp side-by-side you can drop after the PRD. I biased it toward “what matters for implementation and messaging,” not marketing fluff.

# Offline Mutation Systems — Comparison Cheatsheet

| Dimension                     | **TanStack DB (this PRD)**                                              | **TanStack Query (persisted/paused mutations)**                          | **Redux-Offline (Outbox)**                   | **Replicache**                                         |                                                 |
| ----------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------- |
| **Core model**                | Outbox-first (persist before dispatch); replay on init/online           | Persist paused mutations; resume if default `mutationFn` available       | Outbox; queue of actions flushed when online | Local-first DB; named **mutators** + args; server sync |                                                 |
| **Mutation representation**   | `{mutatorName, args}` (JSON) bound by registry; no closures             | Function ref + variables (functions not serializable → needs default fn) | Action object; app reducer handles effects   | `mutatorName` + JSON args; deterministic; re-runnable  |                                                 |
| **Idempotency**               | Optional **idempotencyKey** generated + passed to mutator; not enforced | None built-in; app could implement                                       | Not built-in; app concern                    | Strongly encouraged; assumption in design              |                                                 |
| **Parallelism / ordering**    | **Parallel across keys**, **serial per key**; unknown key → serial lane | Per-mutation; no key-aware scheduler                                     | Serial unless you build custom middleware    | Mutator stream; server-side ordering by version/lsn    |                                                 |
| **Keying**                    | Auto-derived (`args.id/ids`), optional `keyExtractor`                   | N/A (no per-key scheduler)                                               | N/A                                          | Per-doc / per-space keys; CRDT-friendly patterns       |                                                 |
| **Retry policy**              | Infinite, expo backoff + jitter, honors `Retry-After`                   | Retry via Query’s mechanisms; limited backoff control                    | Configurable backoff                         | Client retries; server reconciliation                  |                                                 |
| **Failure taxonomy (v1)**     | Retry by default; `NonRetriableError` drops item                        | App-defined                                                              | App-defined                                  | App-defined conflicts; server wins after push/pull     |                                                 |
| **Optimistic on restart**     | **Yes**: re-apply outbox to restore UI state                            | Partial via cache rehydrate, but no cross-reload optimistic replay       | Usually app-specific; often no               | Yes (local DB is source of truth)                      |                                                 |
| **Multi-tab leader election** | **Yes**: Web Locks → BroadcastChannel fallback                          | No (each tab manages its own)                                            | Usually no (you add it)                      | **Yes** (LeaderElection via broadcast-channel)         |                                                 |
| **Service Worker / BG Sync**  | **Out of scope v1** (can layer later)                                   | N/A                                                                      | Optional community patterns                  | N/A (not required)                                     |                                                 |
| **Storage**                   | IndexedDB/OPFS default adapter; async                                   | Persist Query cache + paused mutations (IndexedDB)                       | Redux store + storage (often IndexedDB)      | IndexedDB (browser) + server                           |                                                 |
| **Dev hooks**                 | `beforeRetry(items[])`, `removeFromOutbox`, optional `peekOutbox()`     | Mutation lifecycle callbacks                                             | Configurable offline/online/commit hooks     | Custom mutators; pull/push hooks                       |                                                 |
| **Conflict handling**         | App-defined (mutator layer + beforeRetry rewrite/squash)                | App-defined per mutation                                                 | App-defined reducers                         | Built-in patterns (server authoritative; app merges)   |                                                 |
| **API shape**                 | `registerOfflineMutators`, \`createOfflineTransaction                   | Action`, `startOfflineExecutor\`                                         | `persistQueryClient` + mutation defaults     | Higher-order store enhancer + config                   | `rep.mutate.<name>(args)`; server sync protocol |
| **Philosophy fit**            | Keep your write path; add durable, minimal outbox semantics             | Online-first; offline is a pause/resume convenience                      | Offline-capable apps with Redux              | Full local-first collaboration model                   |                                                 |

## What this table implies (pragmatic takeaways)

* **You’re landing between Query and Replicache**: more robust than “paused mutations,” lighter than a full local-first DB. That’s exactly the right surface for TanStack DB users who own their write path.
* **Outbox + per-key scheduler** is your core differentiation vs Redux-Offline: you get safe parallelism “for free” (via auto keying) while keeping developer ergonomics high.
* **Named mutators** give you durability across reloads without the “persisted functions” trap in Query.
* **Idempotency is optional but unlocks aggressive reliability**: call it out as an affordance in docs; don’t enforce it.
* **Leader election** is a real quality-of-life win. It prevents duplicate draining and weird race conditions in multi-tab usage — a place Redux-Offline setups often stumble.
* **Out of scope items are cleanly composable later** (SW/Background Sync, richer error taxonomy, DevTools). The PRD won’t paint you into a corner.

If you want, I can append a tiny “Positioning” blurb for docs/README:

> **Positioning:** *TanStack DB Offline-First Transactions* gives you a durable outbox and a per-key scheduler for resilient writes. It doesn’t replace your backend, conflict strategy, or sync engine — it makes your existing write path safe under flakey networks and app restarts, with the least possible API surface.

