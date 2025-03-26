Below you'll find a structured approach to building out the Sync Library in a methodical, test-driven manner. We'll start with a high-level blueprint, then refine it into progressively smaller steps, and finally provide a series of prompts (in code blocks) that you could feed into a code-generation LLM to implement those steps. Each prompt includes test scaffolding/best practices to ensure minimal breakage between steps.

1. High-Level Blueprint
   Core Data Structures & Storage

Set up basic interfaces: Transaction, Mutation, SyncConfig, etc.
Implement persistent storage using IndexedDB (or fallback) to store transactions and states.
Provide a useTransactions() or similar hook to access the transaction state.
Mutation/Transaction Lifecycle

Implement the flow for starting a transaction, persisting it, retrying, and finalizing.
Provide separate logic for “ordered” vs. “parallel” transactions.
Implement the optimistic update application and rolling it back upon failure.
Sync and API Integration

Expose a useCollection hook that internally manages:
Initial fetch (via setup in SyncConfig).
Mutation calls (update, insert, delete, withMutation).
Retry logic.
Lock management for ordered transactions.
Handle parallel transaction merges using a configurable merge strategy.
Testing Utilities

Provide a test harness that can simulate or mock a backend.
Expose capabilities to inject network delays, fail next persist call, track state transitions, etc.
Extensions & Diagnostics

Expose events or logs for transaction states.
Allow advanced error classification (NonRetriableError, custom retry strategies, etc.).
Refinement & Cleanup

Final integration tests ensuring that useCollection ties together:
Persistent transaction state.
Retry flows.
Sync merges.
Confirm that no orphan code remains untested or unexposed. 2. First Iteration of Chunks (Broad Steps)
Below is an initial breakdown of the blueprint into several implementable chunks. Each chunk is big enough to introduce a complete feature, but small enough to be tested thoroughly before moving on.

Initialize Repo & Basic Types

Create a starter TypeScript project.
Define core Transaction, SyncConfig, MutationStrategy, and related types.
Provide stubs for future classes/functions (e.g. NonRetriableError, getLockedObjects, etc.).
Transaction Storage with IndexedDB

Implement a small utility class (e.g., TransactionStore) with get, put, delete methods.
Write tests ensuring it can store and retrieve transaction objects reliably.
Transaction Management Core

Implement creation, updating, and lifecycle states of a Transaction.
Write test cases verifying transitions between states (queued, pending, persisting, etc.).
Handle exponential backoff scheduling (with a simple default for now).
Ordered vs. Parallel Mutation Flow (Skeleton)

Create the logic outline for how a transaction flows in “ordered” mode vs. “parallel” mode.
No real network or persist calls yet, just the skeleton:
For “ordered,” ensure transaction is queued if a prior one is still persisting.
For “parallel,” create and mark it pending immediately.
Test that state transitions match expectations in each mode.
Core useCollection Hook (Without Real Networking)

Provide a simple hook that:
Accepts a SyncConfig and a mutationFn (both can be placeholders initially).
Manages an internal store of “data” plus “optimistic updates.”
Offers stubs for update, insert, delete, withMutation.
Verify in tests that calling these stubs properly creates or updates transaction states in memory.
Optimistic Updates & Basic Conflict Handling

Implement logic for how local data is updated optimistically once a mutation is submitted.
For parallel mode, set up a simple, default merge that overrides local data with new data on sync.
Write tests ensuring that local data reflects optimistic changes immediately, rolling back if needed.
Persist to Backend (Mocked)

Fill in the persist portion of mutationFn with a mock or test harness.
Simulate success/failure, check that transaction states move from persisting -> completed or failed.
For “ordered,” verify that subsequent transactions only proceed when the previous completes.
Full Integration: useCollection with Realistic Sync

Wire up the “setup” call in SyncConfig to retrieve initial data.
Update persist calls to communicate with a real or simulated server.
Ensure that locked objects are respected in “ordered” mode, and parallel merges are tested.
Cleanup, Diagnostics, & Final Testing

Add advanced error handling with NonRetriableError.
Provide event hooks or logs for transaction lifecycle.
Review for orphan code or untested flows, fill coverage gaps. 3. Second Iteration of Chunks (More Detailed)
We’ll now break the above steps into even smaller, iterative sub-steps. Each sub-step is just enough to add one new piece of functionality with minimal changes in code or tests.

Project Setup 1.1. Initialize a TypeScript/Node project.
1.2. Configure linting, formatting, and test tooling (e.g., Jest or Vitest).
1.3. Create empty src/ folder with a placeholder test.

Core Types & Structures 2.1. Define TransactionState, Transaction, PendingMutation, Attempt.
2.2. Define SyncConfig, MutationFn, MutationStrategy.
2.3. Export stubs for NonRetriableError and getLockedObjects.
2.4. Write a test that just checks type existence and shape validations if needed.

IndexedDB Persistence 3.1. Install an IndexedDB wrapper or write a minimal utility.
3.2. Implement TransactionStore with simple getTransactions(), putTransaction(), and deleteTransaction() methods.
3.3. Test read/write operations.

Transaction Lifecycle 4.1. Write a TransactionManager class that can create new transactions (in state pending).
4.2. Add an update flow that can mark a transaction as persisting, completed, or failed.
4.3. Implement exponential backoff scheduling logic.
4.4. Thoroughly test transitions and scheduling.

Ordered vs. Parallel Skeleton 5.1. Add an enum or union type for the transaction mode (ordered, parallel).
5.2. In the TransactionManager, add a method for enqueuing transactions if ordered.
5.3. Provide a parallel branch that runs transactions immediately.
5.4. Test concurrency: create multiple transactions in each mode, verify states.

UseCollection Hook (Skeleton) 6.1. Create a new file useCollection.ts.
6.2. Implement a minimal React hook that returns data and mutation stubs.
6.3. Connect the hook to the TransactionManager for creation of transactions (still no actual network).
6.4. Write a simple test that simulates a React component calling update or insert and verifies the transaction is created.

Optimistic Updates 7.1. Introduce an internal “in-memory data store” for the hook.
7.2. When a transaction is created, immediately apply changes to data.
7.3. Add a rollback path if the transaction fails.
7.4. Write tests ensuring that data is updated optimistically and reverts on error.

Mock Persist & Retry 8.1. Implement a default persist method in MutationFn that fakes an API call (set a short timeout, then resolve or reject).
8.2. Handle success by marking the transaction persisted_awaiting_sync or completed.
8.3. Handle errors by scheduling a retry or marking as failed.
8.4. Write tests verifying successful & failed persists, including the number of retry attempts.

Sync Merges & Lock Management 9.1. For “ordered” transactions, ensure subsequent transactions wait for the lock to clear.
9.2. Implement a no-op merge function for parallel transactions by default.
9.3. Provide the extension point to pass a custom merge function.
9.4. Test concurrency scenarios in parallel mode to confirm merges happen.

Realistic setup and Integration 10.1. Wire up a real setup in the SyncConfig to load initial data from an API or test fixture.
10.2. Integrate the actual or test-based server calls for the persist method.
10.3. Ensure the final transaction states are correct with real data.
10.4. Write an integration test that uses all features in synergy.

Advanced Error Handling & Final Polish 11.1. Introduce NonRetriableError logic.
11.2. Add advanced logging or event hooks for transaction states.
11.3. Thoroughly verify no orphan code or untested paths.
11.4. Ship final library with complete usage examples.

4. Third Iteration of Chunks (Right-Sized Steps)
   Let’s refine again. Each step below should be small enough to implement in a single coding session (ideally < 1–2 hours) with clear acceptance criteria. The prompts we generate in the next section will map to these steps.

Project Initialization

Step 1A: Create & configure TS project with testing.
Step 1B: Add linting, formatting, a single “hello world” test.
Types & Basic Helpers

Step 2A: Define TransactionState, Transaction, Attempt, PendingMutation.
Step 2B: Define SyncConfig, MutationFn, MutationStrategy, plus the NonRetriableError class.
Step 2C: Implement the getLockedObjects placeholder.
IndexedDB Storage

Step 3A: Implement TransactionStore with getTransactions(), putTransaction(), deleteTransaction().
Step 3B: Unit-test TransactionStore thoroughly.
TransactionManager & Lifecycle

Step 4A: Create TransactionManager with a createTransaction method.
Step 4B: Add methods to update transaction state (persisting, completed, failed).
Step 4C: Implement exponential backoff logic in a small function.
Step 4D: Add tests verifying each state change plus scheduling.
Modes: Ordered & Parallel

Step 5A: Add a mode to the TransactionManager, store it in each transaction.
Step 5B: Implement enqueuing logic for ordered.
Step 5C: For parallel, run immediately.
Step 5D: Test concurrency in both modes.
Basic useCollection Hook

Step 6A: Create useCollection.ts with a stub that returns [data, {update, insert, delete, withMutation}].
Step 6B: Connect it to TransactionManager to create transactions on each call.
Step 6C: Test that a React component can use the hook and transactions are recorded.
Optimistic Updates

Step 7A: Implement local data storage in the hook.
Step 7B: Immediately apply changes to data when transaction is created.
Step 7C: Revert changes if transaction fails.
Step 7D: Test success and failure paths.
Mock Persist & Retry

Step 8A: Add a mock persist function that randomly succeeds or fails after a short delay.
Step 8B: On failure, schedule a retry using the backoff logic.
Step 8C: Test that transactions eventually succeed or fail after max attempts.
Sync Merges & Lock Management

Step 9A: For ordered mode, block subsequent transactions until lock is released.
Step 9B: Provide a minimal or no-op merge function for parallel updates.
Step 9C: Expose a way for users to supply a custom merge.
Step 9D: Test concurrency with multiple parallel transactions to confirm merges.
Real setup + Integration

Step 10A: Implement a real or test-based version of setup.
Step 10B: Modify the mock persist into a real network call or a better test harness.
Step 10C: Validate final states in an integration test that steps through typical usage.
Advanced Errors, Logging, & Final Check
Step 11A: Add NonRetriableError usage to skip retries.
Step 11B: Integrate optional logging or event callbacks.
Step 11C: Final coverage check: remove or unify any code that is orphaned.
Step 11D: Conclude with a final release. 5. Prompts for a Code Generation LLM (Step-by-Step)
Below is a series of prompts to feed into a code-generation LLM. Each prompt corresponds to one or more of the steps listed above, in the order you’d implement them. Remember: these prompts assume a fresh environment each time you run them, so each code snippet should be self-contained or reference files from previous steps.

Each prompt is enclosed in triple backticks with the language set to text. You can copy these directly into your code-gen environment, or adapt them as needed.

Prompt 1: Project Initialization
text
Copy
You are creating a new TypeScript project called “sync-lib”. Set up the project skeleton with:

1. A minimal `package.json`.
2. TypeScript configuration (`tsconfig.json`).
3. A default test runner (Jest or Vitest) configuration.
4. A single “hello.test.ts” that just ensures the test runner works.

Output the folder structure and contents of each file. Once complete, summarize what you created.
Prompt 2: Types & Basic Helpers
text
Copy
Continue in the “sync-lib” project. Implement the basic types and helpers:

1. In a file `src/types.ts`, define the following:
   - `TransactionState` (string union of 'queued' | 'pending' | 'persisting' | 'persisted_awaiting_sync' | 'completed' | 'failed')
   - `Attempt` interface with `id`, `started_at`, `completed_at?`, `error?`, `retry_scheduled_for?`
   - `PendingMutation` interface with `mutationId`, `original`, `modified`, `changes`, `metadata`, `created_at`, `updated_at`, `state`
   - `Transaction` interface with `id`, `state`, `created_at`, `updated_at`, `mutations`, `attempts`, `current_attempt`, `queued_behind?`, `error?`
2. In the same file, define `SyncConfig`, `MutationFn`, and `MutationStrategy`.
3. Create a `NonRetriableError` class in `src/errors.ts`.
4. Create a `getLockedObjects` stub in `src/utils.ts` that returns an empty Set for now.
5. Provide tests in `tests/types.test.ts` or similar. Just verify correct import and instantiation of these structures.

Output all relevant files and tests.
Prompt 3: IndexedDB Storage
text
Copy
Now create a file `src/TransactionStore.ts` that handles storing and retrieving transactions in IndexedDB:

1. Use an existing IndexedDB wrapper or a minimal approach.
2. Implement methods:
   - `getTransactions(): Promise<Transaction[]>`
   - `putTransaction(tx: Transaction): Promise<void>`
   - `deleteTransaction(id: string): Promise<void>`
3. In `tests/TransactionStore.test.ts`, write tests to confirm that transactions can be created, fetched, updated, and deleted.
4. Provide the code for these files and show the passing test results.
   Prompt 4: TransactionManager & Lifecycle
   text
   Copy
   Add a class `TransactionManager` in `src/TransactionManager.ts`:

5. It should have:
   - A constructor that takes a reference to `TransactionStore`.
   - `createTransaction(mutations: PendingMutation[], strategy: MutationStrategy): Promise<Transaction>`.
   - `updateTransactionState(id: string, newState: TransactionState): Promise<void>`.
   - Exponential backoff scheduling in a function `scheduleRetry(id: string, attemptNumber: number): Promise<void>`.
6. Test it in `tests/TransactionManager.test.ts`, covering:
   - Creating a transaction in `pending` state.
   - Updating states to `persisting`, `completed`, `failed`.
   - Scheduling retries (just store the time we’d retry, no actual timer yet).
7. Output the new files and tests with passing results.
   Prompt 5: Ordered vs. Parallel Logic
   text
   Copy
   Enhance `TransactionManager` with separate flows for ordered and parallel modes:

8. Extend `createTransaction` to accept a `type` field from `MutationStrategy` which is either 'ordered' or 'parallel'.
9. If 'ordered', new transactions should have a `queued_behind` if the previous transaction isn't done.
10. If 'parallel', run immediately without queueing.
11. In `tests/TransactionManager.test.ts`, add concurrency tests:
    - Create multiple transactions in ordered mode, ensure only one runs at a time.
    - Create multiple transactions in parallel mode, ensure none queue behind each other.

Provide updated code and test results.
Prompt 6: Basic useCollection Hook
text
Copy
Create a new file `src/useCollection.ts`:

1. Export a React hook `useCollection(config: { sync: SyncConfig; mutationFn?: MutationFn })`.
2. It should return an object `{ data, update, insert, delete: deleteFn, withMutation }`.
3. Internally, it should:
   - Maintain some local `data` state (can be an empty object for now).
   - On `update` (etc.), create a transaction via `TransactionManager`.
   - Currently, do nothing else (no real network calls).
4. Write a new test file `tests/useCollection.test.ts` using React Testing Library or similar.
   - Render a component that calls `useCollection`.
   - Ensure that `update` or `insert` triggers transaction creation.
   - Verify that `data` is unchanged for now since we haven't implemented optimism.

Show me the code with passing tests.
Prompt 7: Optimistic Updates
text
Copy
Extend `useCollection` for optimistic updates:

1. When creating a transaction, immediately apply changes to local `data`.
2. If the transaction eventually fails, revert to pre-transaction state.
3. If the transaction succeeds, keep the updated state.
4. Write new tests in `tests/useCollection.test.ts`:
   - Simulate a successful transaction, confirm data remains updated.
   - Simulate a failed transaction, confirm data reverts.

Output your updated code and passing tests.
Prompt 8: Mock Persist & Retry
text
Copy
Update `mutationFn` to include a mock `persist` method:

1. `persist`: Wait a short random time (like 100-500ms), succeed half the time, fail half the time.
2. On failure, ensure `TransactionManager` triggers a retry (up to 4 retries).
3. Add tests to confirm that:
   - If it fails, the transaction eventually either succeeds (within 4 retries) or ends up in `failed`.
   - The local state reverts if it fails after all retries, remains if it eventually succeeds.

Show the updated `mutationFn` logic, any new code in `TransactionManager`, and the test results.
Prompt 9: Sync Merges & Lock Management
text
Copy
Add final details for parallel merges and lock management:

1. For ordered mode, if a transaction is `persisting`, the next transaction should wait.
2. After `persisting` finishes, remove the lock, let the next proceed.
3. For parallel mode, if a custom merge function is provided, call it on each sync update to combine pending changes.
4. Write concurrency tests in `tests/TransactionManager.test.ts` or a new file:
   - Show that locks prevent multiple ordered transactions from persisting simultaneously.
   - Demonstrate a parallel custom merge function scenario.

Provide updated code and test results.
Prompt 10: Real Setup & Integration
text
Copy
Integrate a real `setup` call and demonstrate an end-to-end flow:

1. In `SyncConfig`, implement `setup` to fetch initial data from a mock REST endpoint or a local fixture.
2. In `mutationFn.persist`, replace the random success/fail with actual fetch calls to a local mock server or an in-memory array.
3. Write an integration test `tests/integration.test.ts` that:
   - Renders a component using `useCollection`.
   - Waits for initial data to load.
   - Calls `update`, triggers a successful persist, verifies updated data.
   - Calls `update`, triggers a fail, verifies revert or retry.
4. Show all relevant code and passing test results.
   Prompt 11: Advanced Errors, Logging, & Cleanup
   text
   Copy
   Complete the library with advanced features and a final pass:

5. Use `NonRetriableError` if a certain API status indicates a permanent failure (e.g., 400).
6. Add optional logging or event hooks in `TransactionManager` to track state transitions.
7. Confirm no orphan code is left, unify any duplicated logic, finalize all type exports in `src/index.ts`.
8. Provide the final code layout with a short README explaining usage.
9. Show the final test coverage or evidence of complete testing.

Summarize final library structure and usage.
Final Notes
All code from each step should be integrated and built upon, ensuring no orphan references or leftover stubs.
Test coverage is key for each step; each chunk includes tests that ensure minimal breakage.
Refactoring is encouraged if new insights emerge while implementing.
This approach is incremental, with each step building on the previous set of functionalities and tests.
With these prompts, you can guide a code-generation LLM to systematically implement and test your Sync Library. This methodical process reduces risk, ensures correctness, and leaves room for extension and performance improvements in the future.
