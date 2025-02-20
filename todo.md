# TODO: Sync Library Implementation

## 1. Project Initialization
- [ ] **1A**: Create & configure a new TypeScript project
    - [ ] Initialize `package.json`
    - [ ] Add `tsconfig.json` with standard TS settings
    - [ ] Set up Jest or Vitest test runner
- [ ] **1B**: Linting & Formatting
        - [ ] Install ESLint / Prettier (or similar)
        - [ ] Add minimal lint/format config
        - [ ] Create a "hello world" test in `tests/hello.test.ts` to verify everything works

## 2. Types & Basic Helpers
- [ ] **2A**: Define **core interfaces** in `src/types.ts`
        - [ ] `TransactionState`
        - [ ] `Attempt`
        - [ ] `PendingMutation`
        - [ ] `Transaction`
- [ ] **2B**: Define **Sync-related types** in `src/types.ts`
        - [ ] `SyncConfig`
        - [ ] `MutationFn`
        - [ ] `MutationStrategy`
- [ ] **2C**: Create `NonRetriableError` in `src/errors.ts`
- [ ] **2D**: Create a placeholder `getLockedObjects` in `src/utils.ts` (return empty `Set` for now)
- [ ] **2E**: Unit tests in `tests/types.test.ts`
        - [ ] Confirm each interface/type is defined correctly
        - [ ] Verify basic usage or shape checking

## 3. IndexedDB Storage
- [ ] **3A**: Implement `TransactionStore` in `src/TransactionStore.ts`
        - [ ] `getTransactions(): Promise<Transaction[]>`
        - [ ] `putTransaction(tx: Transaction): Promise<void>`
        - [ ] `deleteTransaction(id: string): Promise<void>`
        - [ ] Internally use IndexedDB or an equivalent library
- [ ] **3B**: Write tests in `tests/TransactionStore.test.ts`
        - [ ] Confirm create/update/delete flow
        - [ ] Verify correct reading of stored transactions

## 4. TransactionManager & Lifecycle
- [ ] **4A**: Create `TransactionManager` in `src/TransactionManager.ts`
        - [ ] Constructor accepts `TransactionStore`
        - [ ] `createTransaction(mutations: PendingMutation[], strategy: MutationStrategy): Promise<Transaction>`
- [ ] **4B**: Add lifecycle state management
        - [ ] `updateTransactionState(id: string, newState: TransactionState): Promise<void>`
        - [ ] Transitions: `pending`, `persisting`, `completed`, `failed`, etc.
- [ ] **4C**: Implement exponential backoff in `scheduleRetry(id: string, attemptNumber: number)`
- [ ] **4D**: Write tests in `tests/TransactionManager.test.ts`
        - [ ] Creating a new transaction
        - [ ] Changing transaction states & verifying correctness
        - [ ] Checking scheduled retry times (no actual timer needed, just stored times)

## 5. Modes: Ordered vs. Parallel
- [ ] **5A**: Extend `TransactionManager` to handle a `type` field in `MutationStrategy` (either `'ordered'` or `'parallel'`)
- [ ] **5B**: Ordered logic
        - [ ] Enqueue new transactions if an existing one is still `persisting` or `queued`
- [ ] **5C**: Parallel logic
        - [ ] Immediately mark transactions `pending` or `persisting`
        - [ ] No explicit queue
- [ ] **5D**: Concurrency tests in `tests/TransactionManager.test.ts`
        - [ ] Multiple transactions in ordered mode (should not persist in parallel)
        - [ ] Multiple transactions in parallel mode (should run immediately)

## 6. Basic `useCollection` Hook
- [ ] **6A**: Create `src/useCollection.ts`
        - [ ] Export `useCollection(config: { sync: SyncConfig; mutationFn?: MutationFn })`
        - [ ] Return `{ data, update, insert, delete: deleteFn, withMutation }`
- [ ] **6B**: Connect to `TransactionManager`
        - [ ] On `update/insert/delete`, call `createTransaction()`
- [ ] **6C**: Basic test in `tests/useCollection.test.ts`
        - [ ] Render a React component using the hook
        - [ ] Call `update()` or `insert()`
        - [ ] Confirm that a transaction is created (verify some state in manager or a mock function)
        - [ ] `data` can be empty or unchanged for now

## 7. Optimistic Updates
- [ ] **7A**: Implement local data state inside `useCollection`
- [ ] **7B**: On transaction creation, immediately apply changes to `data`
- [ ] **7C**: On transaction failure, revert changes
- [ ] **7D**: Write new tests in `tests/useCollection.test.ts`
        - [ ] Simulate success -> `data` remains updated
        - [ ] Simulate failure -> `data` reverts

## 8. Mock Persist & Retry
- [ ] **8A**: Add a **mock** `persist` method in `mutationFn`
        - [ ] Wait ~100–500ms
        - [ ] 50% chance success, 50% chance fail
- [ ] **8B**: On failure, trigger retries in `TransactionManager`
        - [ ] Up to 4 retries
- [ ] **8C**: Unit tests for retry behavior
        - [ ] Verify final transaction state after repeated failures -> `failed`
        - [ ] Verify success after a retry -> `completed`
        - [ ] Check local data for revert vs. final updates

## 9. Sync Merges & Lock Management
- [ ] **9A**: For ordered mode, block subsequent transactions while one is `persisting`
        - [ ] Release lock after `persisting` transaction completes
- [ ] **9B**: Provide a **minimal or no-op** merge function for parallel mode
        - [ ] Reapply optimistic updates on new sync data
- [ ] **9C**: Allow a custom merge function to be passed in
- [ ] **9D**: Add concurrency tests
        - [ ] Locking logic in ordered mode
        - [ ] Parallel concurrency with merges

## 10. Real `setup` & Integration
- [ ] **10A**: Implement a real or mock `setup` in `SyncConfig`
        - [ ] Fetch initial data from an endpoint or test fixture
- [ ] **10B**: Evolve the mock `persist` into a more realistic approach
        - [ ] Possibly call a local in-memory server or a test-based REST endpoint
- [ ] **10C**: Write integration test in `tests/integration.test.ts`
        - [ ] Confirm initial data is loaded
        - [ ] Perform a successful update -> data updates
        - [ ] Perform a failing update -> confirm revert or eventual success with retry
        - [ ] Ensure everything ties together end-to-end

## 11. Advanced Errors, Logging & Cleanup
- [ ] **11A**: Utilize `NonRetriableError`
        - [ ] E.g., if API returns 400, throw `NonRetriableError` and skip retries
- [ ] **11B**: Optional logging / event hooks in `TransactionManager`
        - [ ] Provide ways to track or debug transaction states
- [ ] **11C**: Final code cleanup
        - [ ] Remove stubs/orphan code
        - [ ] Ensure everything is exported from `src/index.ts` or a root file
- [ ] **11D**: Final coverage check / polish
        - [ ] Ensure tests cover all key flows
        - [ ] Document usage in a short README or doc

