import { withArrayChangeTracking, withChangeTracking } from "./proxy";
import { createTransaction, getActiveTransaction } from "./transactions";
import { SortedMap } from "./SortedMap";
import { createSingleRowRefProxy, toExpression, } from "./query/builder/ref-proxy";
import { compileSingleRowExpression } from "./query/compiler/evaluators.js";
import { OrderedIndex } from "./indexes/ordered-index.js";
import { IndexProxy, LazyIndexWrapper } from "./indexes/lazy-index.js";
import { optimizeQuery, } from "./utils/query-optimization.js";
// Store collections in memory
export const collectionsStore = new Map();
/**
 * Creates a new Collection instance with the given configuration
 *
 * @template TExplicit - The explicit type of items in the collection (highest priority)
 * @template TKey - The type of the key for the collection
 * @template TUtils - The utilities record type
 * @template TSchema - The schema type for validation and type inference (second priority)
 * @template TFallback - The fallback type if no explicit or schema type is provided
 * @param options - Collection options with optional utilities
 * @returns A new Collection with utilities exposed both at top level and under .utils
 *
 * @example
 * // Pattern 1: With operation handlers (direct collection calls)
 * const todos = createCollection({
 *   id: "todos",
 *   getKey: (todo) => todo.id,
 *   schema,
 *   onInsert: async ({ transaction, collection }) => {
 *     // Send to API
 *     await api.createTodo(transaction.mutations[0].modified)
 *   },
 *   onUpdate: async ({ transaction, collection }) => {
 *     await api.updateTodo(transaction.mutations[0].modified)
 *   },
 *   onDelete: async ({ transaction, collection }) => {
 *     await api.deleteTodo(transaction.mutations[0].key)
 *   },
 *   sync: { sync: () => {} }
 * })
 *
 * // Direct usage (handlers manage transactions)
 * const tx = todos.insert({ id: "1", text: "Buy milk", completed: false })
 * await tx.isPersisted.promise
 *
 * @example
 * // Pattern 2: Manual transaction management
 * const todos = createCollection({
 *   getKey: (todo) => todo.id,
 *   schema: todoSchema,
 *   sync: { sync: () => {} }
 * })
 *
 * // Explicit transaction usage
 * const tx = createTransaction({
 *   mutationFn: async ({ transaction }) => {
 *     // Handle all mutations in transaction
 *     await api.saveChanges(transaction.mutations)
 *   }
 * })
 *
 * tx.mutate(() => {
 *   todos.insert({ id: "1", text: "Buy milk" })
 *   todos.update("2", draft => { draft.completed = true })
 * })
 *
 * await tx.isPersisted.promise
 *
 * @example
 * // Using schema for type inference (preferred as it also gives you client side validation)
 * const todoSchema = z.object({
 *   id: z.string(),
 *   title: z.string(),
 *   completed: z.boolean()
 * })
 *
 * const todos = createCollection({
 *   schema: todoSchema,
 *   getKey: (todo) => todo.id,
 *   sync: { sync: () => {} }
 * })
 *
 * // Note: You must provide either an explicit type or a schema, but not both.
 */
export function createCollection(options) {
    const collection = new CollectionImpl(options);
    // Copy utils to both top level and .utils namespace
    if (options.utils) {
        collection.utils = { ...options.utils };
    }
    else {
        collection.utils = {};
    }
    return collection;
}
/**
 * Custom error class for schema validation errors
 */
export class SchemaValidationError extends Error {
    constructor(type, issues, message) {
        const defaultMessage = `${type === `insert` ? `Insert` : `Update`} validation failed: ${issues
            .map((issue) => `\n- ${issue.message} - path: ${issue.path}`)
            .join(``)}`;
        super(message || defaultMessage);
        this.name = `SchemaValidationError`;
        this.type = type;
        this.issues = issues;
    }
}
export class CollectionImpl {
    /**
     * Register a callback to be executed on the next commit
     * Useful for preloading collections
     * @param callback Function to call after the next commit
     * @example
     * collection.onFirstCommit(() => {
     *   console.log('Collection has received first data')
     *   // Safe to access collection.state now
     * })
     */
    onFirstCommit(callback) {
        this.onFirstCommitCallbacks.push(callback);
    }
    /**
     * Gets the current status of the collection
     */
    get status() {
        return this._status;
    }
    /**
     * Validates that the collection is in a usable state for data operations
     * @private
     */
    validateCollectionUsable(operation) {
        switch (this._status) {
            case `error`:
                throw new Error(`Cannot perform ${operation} on collection "${this.id}" - collection is in error state. ` +
                    `Try calling cleanup() and restarting the collection.`);
            case `cleaned-up`:
                throw new Error(`Cannot perform ${operation} on collection "${this.id}" - collection has been cleaned up. ` +
                    `The collection will automatically restart on next access.`);
        }
    }
    /**
     * Validates state transitions to prevent invalid status changes
     * @private
     */
    validateStatusTransition(from, to) {
        if (from === to) {
            // Allow same state transitions
            return;
        }
        const validTransitions = {
            idle: [`loading`, `error`, `cleaned-up`],
            loading: [`initialCommit`, `error`, `cleaned-up`],
            initialCommit: [`ready`, `error`, `cleaned-up`],
            ready: [`cleaned-up`, `error`],
            error: [`cleaned-up`, `idle`],
            "cleaned-up": [`loading`, `error`],
        };
        if (!validTransitions[from].includes(to)) {
            throw new Error(`Invalid collection status transition from "${from}" to "${to}" for collection "${this.id}"`);
        }
    }
    /**
     * Safely update the collection status with validation
     * @private
     */
    setStatus(newStatus) {
        this.validateStatusTransition(this._status, newStatus);
        this._status = newStatus;
        // Resolve indexes when collection becomes ready
        if (newStatus === 'ready' && !this.isIndexesResolved) {
            // Resolve indexes asynchronously without blocking
            this.resolveAllIndexes().catch((error) => {
                console.warn('Failed to resolve indexes:', error);
            });
        }
    }
    /**
     * Creates a new Collection instance
     *
     * @param config - Configuration object for the collection
     * @throws Error if sync config is missing
     */
    constructor(config) {
        this.pendingSyncedTransactions = [];
        this.syncedMetadata = new Map();
        // Optimistic state tracking - make public for testing
        this.optimisticUpserts = new Map();
        this.optimisticDeletes = new Set();
        // Cached size for performance
        this._size = 0;
        // Index storage
        this.lazyIndexes = new Map();
        this.resolvedIndexes = new Map();
        this.isIndexesResolved = false;
        this.indexCounter = 0;
        // Event system
        this.changeListeners = new Set();
        this.changeKeyListeners = new Map();
        // Utilities namespace
        // This is populated by createCollection
        this.utils = {};
        // State used for computing the change events
        this.syncedKeys = new Set();
        this.preSyncVisibleState = new Map();
        this.recentlySyncedKeys = new Set();
        this.hasReceivedFirstCommit = false;
        this.isCommittingSyncTransactions = false;
        // Array to store one-time commit listeners
        this.onFirstCommitCallbacks = [];
        // Event batching for preventing duplicate emissions during transaction flows
        this.batchedEvents = [];
        this.shouldBatchEvents = false;
        // Lifecycle management
        this._status = `idle`;
        this.activeSubscribersCount = 0;
        this.gcTimeoutId = null;
        this.preloadPromise = null;
        this.syncCleanupFn = null;
        this.id = ``;
        /**
         * Attempts to commit pending synced transactions if there are no active transactions
         * This method processes operations from pending transactions and applies them to the synced data
         */
        this.commitPendingTransactions = () => {
            // Check if there are any persisting transaction
            let hasPersistingTransaction = false;
            for (const transaction of this.transactions.values()) {
                if (transaction.state === `persisting`) {
                    hasPersistingTransaction = true;
                    break;
                }
            }
            if (!hasPersistingTransaction) {
                // Set flag to prevent redundant optimistic state recalculations
                this.isCommittingSyncTransactions = true;
                // First collect all keys that will be affected by sync operations
                const changedKeys = new Set();
                for (const transaction of this.pendingSyncedTransactions) {
                    for (const operation of transaction.operations) {
                        changedKeys.add(operation.key);
                    }
                }
                // Use pre-captured state if available (from optimistic scenarios),
                // otherwise capture current state (for pure sync scenarios)
                let currentVisibleState = this.preSyncVisibleState;
                if (currentVisibleState.size === 0) {
                    // No pre-captured state, capture it now for pure sync operations
                    currentVisibleState = new Map();
                    for (const key of changedKeys) {
                        const currentValue = this.get(key);
                        if (currentValue !== undefined) {
                            currentVisibleState.set(key, currentValue);
                        }
                    }
                }
                const events = [];
                const rowUpdateMode = this.config.sync.rowUpdateMode || `partial`;
                for (const transaction of this.pendingSyncedTransactions) {
                    for (const operation of transaction.operations) {
                        const key = operation.key;
                        this.syncedKeys.add(key);
                        // Update metadata
                        switch (operation.type) {
                            case `insert`:
                                this.syncedMetadata.set(key, operation.metadata);
                                break;
                            case `update`:
                                this.syncedMetadata.set(key, Object.assign({}, this.syncedMetadata.get(key), operation.metadata));
                                break;
                            case `delete`:
                                this.syncedMetadata.delete(key);
                                break;
                        }
                        // Update synced data
                        switch (operation.type) {
                            case `insert`:
                                this.syncedData.set(key, operation.value);
                                break;
                            case `update`: {
                                if (rowUpdateMode === `partial`) {
                                    const updatedValue = Object.assign({}, this.syncedData.get(key), operation.value);
                                    this.syncedData.set(key, updatedValue);
                                }
                                else {
                                    this.syncedData.set(key, operation.value);
                                }
                                break;
                            }
                            case `delete`:
                                this.syncedData.delete(key);
                                break;
                        }
                    }
                }
                // Clear optimistic state since sync operations will now provide the authoritative data
                this.optimisticUpserts.clear();
                this.optimisticDeletes.clear();
                // Reset flag and recompute optimistic state for any remaining active transactions
                this.isCommittingSyncTransactions = false;
                for (const transaction of this.transactions.values()) {
                    if (![`completed`, `failed`].includes(transaction.state)) {
                        for (const mutation of transaction.mutations) {
                            if (mutation.collection === this && mutation.optimistic) {
                                switch (mutation.type) {
                                    case `insert`:
                                    case `update`:
                                        this.optimisticUpserts.set(mutation.key, mutation.modified);
                                        this.optimisticDeletes.delete(mutation.key);
                                        break;
                                    case `delete`:
                                        this.optimisticUpserts.delete(mutation.key);
                                        this.optimisticDeletes.add(mutation.key);
                                        break;
                                }
                            }
                        }
                    }
                }
                // Check for redundant sync operations that match completed optimistic operations
                const completedOptimisticOps = new Map();
                for (const transaction of this.transactions.values()) {
                    if (transaction.state === `completed`) {
                        for (const mutation of transaction.mutations) {
                            if (mutation.collection === this && changedKeys.has(mutation.key)) {
                                completedOptimisticOps.set(mutation.key, {
                                    type: mutation.type,
                                    value: mutation.modified,
                                });
                            }
                        }
                    }
                }
                // Now check what actually changed in the final visible state
                for (const key of changedKeys) {
                    const previousVisibleValue = currentVisibleState.get(key);
                    const newVisibleValue = this.get(key); // This returns the new derived state
                    // Check if this sync operation is redundant with a completed optimistic operation
                    const completedOp = completedOptimisticOps.get(key);
                    const isRedundantSync = completedOp &&
                        newVisibleValue !== undefined &&
                        this.deepEqual(completedOp.value, newVisibleValue);
                    if (!isRedundantSync) {
                        if (previousVisibleValue === undefined &&
                            newVisibleValue !== undefined) {
                            events.push({
                                type: `insert`,
                                key,
                                value: newVisibleValue,
                            });
                        }
                        else if (previousVisibleValue !== undefined &&
                            newVisibleValue === undefined) {
                            events.push({
                                type: `delete`,
                                key,
                                value: previousVisibleValue,
                            });
                        }
                        else if (previousVisibleValue !== undefined &&
                            newVisibleValue !== undefined &&
                            !this.deepEqual(previousVisibleValue, newVisibleValue)) {
                            events.push({
                                type: `update`,
                                key,
                                value: newVisibleValue,
                                previousValue: previousVisibleValue,
                            });
                        }
                    }
                }
                // Update cached size after synced data changes
                this._size = this.calculateSize();
                // Update indexes for all events before emitting
                if (events.length > 0) {
                    this.updateIndexes(events);
                }
                // End batching and emit all events (combines any batched events with sync events)
                this.emitEvents(events, true);
                this.pendingSyncedTransactions = [];
                // Clear the pre-sync state since sync operations are complete
                this.preSyncVisibleState.clear();
                // Clear recently synced keys after a microtask to allow recomputeOptimisticState to see them
                Promise.resolve().then(() => {
                    this.recentlySyncedKeys.clear();
                });
                // Call any registered one-time commit listeners
                if (!this.hasReceivedFirstCommit) {
                    this.hasReceivedFirstCommit = true;
                    const callbacks = [...this.onFirstCommitCallbacks];
                    this.onFirstCommitCallbacks = [];
                    callbacks.forEach((callback) => callback());
                }
            }
        };
        /**
         * Inserts one or more items into the collection
         * @param items - Single item or array of items to insert
         * @param config - Optional configuration including metadata
         * @returns A Transaction object representing the insert operation(s)
         * @throws {SchemaValidationError} If the data fails schema validation
         * @example
         * // Insert a single todo (requires onInsert handler)
         * const tx = collection.insert({ id: "1", text: "Buy milk", completed: false })
         * await tx.isPersisted.promise
         *
         * @example
         * // Insert multiple todos at once
         * const tx = collection.insert([
         *   { id: "1", text: "Buy milk", completed: false },
         *   { id: "2", text: "Walk dog", completed: true }
         * ])
         * await tx.isPersisted.promise
         *
         * @example
         * // Insert with metadata
         * const tx = collection.insert({ id: "1", text: "Buy groceries" },
         *   { metadata: { source: "mobile-app" } }
         * )
         * await tx.isPersisted.promise
         *
         * @example
         * // Handle errors
         * try {
         *   const tx = collection.insert({ id: "1", text: "New item" })
         *   await tx.isPersisted.promise
         *   console.log('Insert successful')
         * } catch (error) {
         *   console.log('Insert failed:', error)
         * }
         */
        this.insert = (data, config) => {
            this.validateCollectionUsable(`insert`);
            const ambientTransaction = getActiveTransaction();
            // If no ambient transaction exists, check for an onInsert handler early
            if (!ambientTransaction && !this.config.onInsert) {
                throw new Error(`Collection.insert called directly (not within an explicit transaction) but no 'onInsert' handler is configured.`);
            }
            const items = Array.isArray(data) ? data : [data];
            const mutations = [];
            // Create mutations for each item
            items.forEach((item) => {
                // Validate the data against the schema if one exists
                const validatedData = this.validateData(item, `insert`);
                // Check if an item with this ID already exists in the collection
                const key = this.getKeyFromItem(validatedData);
                if (this.has(key)) {
                    throw `Cannot insert document with ID "${key}" because it already exists in the collection`;
                }
                const globalKey = this.generateGlobalKey(key, item);
                const mutation = {
                    mutationId: crypto.randomUUID(),
                    original: {},
                    modified: validatedData,
                    // Pick the values from validatedData based on what's passed in - this is for cases
                    // where a schema has default values. The validated data has the extra default
                    // values but for changes, we just want to show the data that was actually passed in.
                    changes: Object.fromEntries(Object.keys(item).map((k) => [
                        k,
                        validatedData[k],
                    ])),
                    globalKey,
                    key,
                    metadata: config?.metadata,
                    syncMetadata: this.config.sync.getSyncMetadata?.() || {},
                    optimistic: config?.optimistic ?? true,
                    type: `insert`,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    collection: this,
                };
                mutations.push(mutation);
            });
            // If an ambient transaction exists, use it
            if (ambientTransaction) {
                ambientTransaction.applyMutations(mutations);
                this.transactions.set(ambientTransaction.id, ambientTransaction);
                this.recomputeOptimisticState();
                return ambientTransaction;
            }
            else {
                // Create a new transaction with a mutation function that calls the onInsert handler
                const directOpTransaction = createTransaction({
                    mutationFn: async (params) => {
                        // Call the onInsert handler with the transaction and collection
                        return await this.config.onInsert({
                            transaction: params.transaction,
                            collection: this,
                        });
                    },
                });
                // Apply mutations to the new transaction
                directOpTransaction.applyMutations(mutations);
                directOpTransaction.commit();
                // Add the transaction to the collection's transactions store
                this.transactions.set(directOpTransaction.id, directOpTransaction);
                this.recomputeOptimisticState();
                return directOpTransaction;
            }
        };
        /**
         * Deletes one or more items from the collection
         * @param keys - Single key or array of keys to delete
         * @param config - Optional configuration including metadata
         * @returns A Transaction object representing the delete operation(s)
         * @example
         * // Delete a single item
         * const tx = collection.delete("todo-1")
         * await tx.isPersisted.promise
         *
         * @example
         * // Delete multiple items
         * const tx = collection.delete(["todo-1", "todo-2"])
         * await tx.isPersisted.promise
         *
         * @example
         * // Delete with metadata
         * const tx = collection.delete("todo-1", { metadata: { reason: "completed" } })
         * await tx.isPersisted.promise
         *
         * @example
         * // Handle errors
         * try {
         *   const tx = collection.delete("item-1")
         *   await tx.isPersisted.promise
         *   console.log('Delete successful')
         * } catch (error) {
         *   console.log('Delete failed:', error)
         * }
         */
        this.delete = (keys, config) => {
            this.validateCollectionUsable(`delete`);
            const ambientTransaction = getActiveTransaction();
            // If no ambient transaction exists, check for an onDelete handler early
            if (!ambientTransaction && !this.config.onDelete) {
                throw new Error(`Collection.delete called directly (not within an explicit transaction) but no 'onDelete' handler is configured.`);
            }
            if (Array.isArray(keys) && keys.length === 0) {
                throw new Error(`No keys were passed to delete`);
            }
            const keysArray = Array.isArray(keys) ? keys : [keys];
            const mutations = [];
            for (const key of keysArray) {
                if (!this.has(key)) {
                    throw new Error(`Collection.delete was called with key '${key}' but there is no item in the collection with this key`);
                }
                const globalKey = this.generateGlobalKey(key, this.get(key));
                const mutation = {
                    mutationId: crypto.randomUUID(),
                    original: this.get(key),
                    modified: this.get(key),
                    changes: this.get(key),
                    globalKey,
                    key,
                    metadata: config?.metadata,
                    syncMetadata: (this.syncedMetadata.get(key) || {}),
                    optimistic: config?.optimistic ?? true,
                    type: `delete`,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    collection: this,
                };
                mutations.push(mutation);
            }
            // If an ambient transaction exists, use it
            if (ambientTransaction) {
                ambientTransaction.applyMutations(mutations);
                this.transactions.set(ambientTransaction.id, ambientTransaction);
                this.recomputeOptimisticState();
                return ambientTransaction;
            }
            // Create a new transaction with a mutation function that calls the onDelete handler
            const directOpTransaction = createTransaction({
                autoCommit: true,
                mutationFn: async (params) => {
                    // Call the onDelete handler with the transaction and collection
                    return this.config.onDelete({
                        transaction: params.transaction,
                        collection: this,
                    });
                },
            });
            // Apply mutations to the new transaction
            directOpTransaction.applyMutations(mutations);
            directOpTransaction.commit();
            this.transactions.set(directOpTransaction.id, directOpTransaction);
            this.recomputeOptimisticState();
            return directOpTransaction;
        };
        // eslint-disable-next-line
        if (!config) {
            throw new Error(`Collection requires a config`);
        }
        if (config.id) {
            this.id = config.id;
        }
        else {
            this.id = crypto.randomUUID();
        }
        // eslint-disable-next-line
        if (!config.sync) {
            throw new Error(`Collection requires a sync config`);
        }
        this.transactions = new SortedMap((a, b) => a.compareCreatedAt(b));
        this.config = config;
        // Store in global collections store
        collectionsStore.set(this.id, this);
        // Set up data storage with optional comparison function
        if (this.config.compare) {
            this.syncedData = new SortedMap(this.config.compare);
        }
        else {
            this.syncedData = new Map();
        }
        // Only start sync immediately if explicitly enabled
        if (config.startSync === true) {
            this.startSync();
        }
    }
    /**
     * Start sync immediately - internal method for compiled queries
     * This bypasses lazy loading for special cases like live query results
     */
    startSyncImmediate() {
        this.startSync();
    }
    /**
     * Start the sync process for this collection
     * This is called when the collection is first accessed or preloaded
     */
    startSync() {
        if (this._status !== `idle` && this._status !== `cleaned-up`) {
            return; // Already started or in progress
        }
        this.setStatus(`loading`);
        try {
            const cleanupFn = this.config.sync.sync({
                collection: this,
                begin: () => {
                    this.pendingSyncedTransactions.push({
                        committed: false,
                        operations: [],
                    });
                },
                write: (messageWithoutKey) => {
                    const pendingTransaction = this.pendingSyncedTransactions[this.pendingSyncedTransactions.length - 1];
                    if (!pendingTransaction) {
                        throw new Error(`No pending sync transaction to write to`);
                    }
                    if (pendingTransaction.committed) {
                        throw new Error(`The pending sync transaction is already committed, you can't still write to it.`);
                    }
                    const key = this.getKeyFromItem(messageWithoutKey.value);
                    // Check if an item with this key already exists when inserting
                    if (messageWithoutKey.type === `insert`) {
                        if (this.syncedData.has(key) &&
                            !pendingTransaction.operations.some((op) => op.key === key && op.type === `delete`)) {
                            throw new Error(`Cannot insert document with key "${key}" from sync because it already exists in the collection "${this.id}"`);
                        }
                    }
                    const message = {
                        ...messageWithoutKey,
                        key,
                    };
                    pendingTransaction.operations.push(message);
                },
                commit: () => {
                    const pendingTransaction = this.pendingSyncedTransactions[this.pendingSyncedTransactions.length - 1];
                    if (!pendingTransaction) {
                        throw new Error(`No pending sync transaction to commit`);
                    }
                    if (pendingTransaction.committed) {
                        throw new Error(`The pending sync transaction is already committed, you can't commit it again.`);
                    }
                    pendingTransaction.committed = true;
                    // Update status to initialCommit when transitioning from loading
                    // This indicates we're in the process of committing the first transaction
                    if (this._status === `loading`) {
                        this.setStatus(`initialCommit`);
                    }
                    this.commitPendingTransactions();
                    // Transition from initialCommit to ready after the first commit is complete
                    if (this._status === `initialCommit`) {
                        this.setStatus(`ready`);
                    }
                },
            });
            // Store cleanup function if provided
            this.syncCleanupFn = typeof cleanupFn === `function` ? cleanupFn : null;
        }
        catch (error) {
            this.setStatus(`error`);
            throw error;
        }
    }
    /**
     * Preload the collection data by starting sync if not already started
     * Multiple concurrent calls will share the same promise
     */
    preload() {
        if (this.preloadPromise) {
            return this.preloadPromise;
        }
        this.preloadPromise = new Promise((resolve, reject) => {
            if (this._status === `ready`) {
                resolve();
                return;
            }
            if (this._status === `error`) {
                reject(new Error(`Collection is in error state`));
                return;
            }
            // Register callback BEFORE starting sync to avoid race condition
            this.onFirstCommit(() => {
                resolve();
            });
            // Start sync if collection hasn't started yet or was cleaned up
            if (this._status === `idle` || this._status === `cleaned-up`) {
                try {
                    this.startSync();
                }
                catch (error) {
                    reject(error);
                    return;
                }
            }
        });
        return this.preloadPromise;
    }
    /**
     * Clean up the collection by stopping sync and clearing data
     * This can be called manually or automatically by garbage collection
     */
    async cleanup() {
        // Clear GC timeout
        if (this.gcTimeoutId) {
            clearTimeout(this.gcTimeoutId);
            this.gcTimeoutId = null;
        }
        // Stop sync - wrap in try/catch since it's user-provided code
        try {
            if (this.syncCleanupFn) {
                this.syncCleanupFn();
                this.syncCleanupFn = null;
            }
        }
        catch (error) {
            // Re-throw in a microtask to surface the error after cleanup completes
            queueMicrotask(() => {
                if (error instanceof Error) {
                    // Preserve the original error and stack trace
                    const wrappedError = new Error(`Collection "${this.id}" sync cleanup function threw an error: ${error.message}`);
                    wrappedError.cause = error;
                    wrappedError.stack = error.stack;
                    throw wrappedError;
                }
                else {
                    throw new Error(`Collection "${this.id}" sync cleanup function threw an error: ${String(error)}`);
                }
            });
        }
        // Clear data
        this.syncedData.clear();
        this.syncedMetadata.clear();
        this.optimisticUpserts.clear();
        this.optimisticDeletes.clear();
        this._size = 0;
        this.pendingSyncedTransactions = [];
        this.syncedKeys.clear();
        this.hasReceivedFirstCommit = false;
        this.onFirstCommitCallbacks = [];
        this.preloadPromise = null;
        this.batchedEvents = [];
        this.shouldBatchEvents = false;
        // Update status
        this.setStatus(`cleaned-up`);
        return Promise.resolve();
    }
    /**
     * Start the garbage collection timer
     * Called when the collection becomes inactive (no subscribers)
     */
    startGCTimer() {
        if (this.gcTimeoutId) {
            clearTimeout(this.gcTimeoutId);
        }
        const gcTime = this.config.gcTime ?? 300000; // 5 minutes default
        this.gcTimeoutId = setTimeout(() => {
            if (this.activeSubscribersCount === 0) {
                this.cleanup();
            }
        }, gcTime);
    }
    /**
     * Cancel the garbage collection timer
     * Called when the collection becomes active again
     */
    cancelGCTimer() {
        if (this.gcTimeoutId) {
            clearTimeout(this.gcTimeoutId);
            this.gcTimeoutId = null;
        }
    }
    /**
     * Increment the active subscribers count and start sync if needed
     */
    addSubscriber() {
        this.activeSubscribersCount++;
        this.cancelGCTimer();
        // Start sync if collection was cleaned up
        if (this._status === `cleaned-up` || this._status === `idle`) {
            this.startSync();
        }
    }
    /**
     * Decrement the active subscribers count and start GC timer if needed
     */
    removeSubscriber() {
        this.activeSubscribersCount--;
        if (this.activeSubscribersCount === 0) {
            this.activeSubscribersCount = 0;
            this.startGCTimer();
        }
        else if (this.activeSubscribersCount < 0) {
            throw new Error(`Active subscribers count is negative - this should never happen`);
        }
    }
    /**
     * Recompute optimistic state from active transactions
     */
    recomputeOptimisticState() {
        // Skip redundant recalculations when we're in the middle of committing sync transactions
        if (this.isCommittingSyncTransactions) {
            return;
        }
        const previousState = new Map(this.optimisticUpserts);
        const previousDeletes = new Set(this.optimisticDeletes);
        // Clear current optimistic state
        this.optimisticUpserts.clear();
        this.optimisticDeletes.clear();
        const activeTransactions = [];
        const completedTransactions = [];
        for (const transaction of this.transactions.values()) {
            if (transaction.state === `completed`) {
                completedTransactions.push(transaction);
            }
            else if (![`completed`, `failed`].includes(transaction.state)) {
                activeTransactions.push(transaction);
            }
        }
        // Apply active transactions only (completed transactions are handled by sync operations)
        for (const transaction of activeTransactions) {
            for (const mutation of transaction.mutations) {
                if (mutation.collection === this && mutation.optimistic) {
                    switch (mutation.type) {
                        case `insert`:
                        case `update`:
                            this.optimisticUpserts.set(mutation.key, mutation.modified);
                            this.optimisticDeletes.delete(mutation.key);
                            break;
                        case `delete`:
                            this.optimisticUpserts.delete(mutation.key);
                            this.optimisticDeletes.add(mutation.key);
                            break;
                    }
                }
            }
        }
        // Update cached size
        this._size = this.calculateSize();
        // Collect events for changes
        const events = [];
        this.collectOptimisticChanges(previousState, previousDeletes, events);
        // Filter out events for recently synced keys to prevent duplicates
        const filteredEventsBySyncStatus = events.filter((event) => !this.recentlySyncedKeys.has(event.key));
        // Filter out redundant delete events if there are pending sync transactions
        // that will immediately restore the same data, but only for completed transactions
        if (this.pendingSyncedTransactions.length > 0) {
            const pendingSyncKeys = new Set();
            const completedTransactionMutations = new Set();
            // Collect keys from pending sync operations
            for (const transaction of this.pendingSyncedTransactions) {
                for (const operation of transaction.operations) {
                    pendingSyncKeys.add(operation.key);
                }
            }
            // Collect mutation IDs from completed transactions
            for (const tx of completedTransactions) {
                for (const mutation of tx.mutations) {
                    if (mutation.collection === this) {
                        completedTransactionMutations.add(mutation.mutationId);
                    }
                }
            }
            // Only filter out delete events for keys that:
            // 1. Have pending sync operations AND
            // 2. Are from completed transactions (being cleaned up)
            const filteredEvents = filteredEventsBySyncStatus.filter((event) => {
                if (event.type === `delete` && pendingSyncKeys.has(event.key)) {
                    // Check if this delete is from clearing optimistic state of completed transactions
                    // We can infer this by checking if we have no remaining optimistic mutations for this key
                    const hasActiveOptimisticMutation = activeTransactions.some((tx) => tx.mutations.some((m) => m.collection === this && m.key === event.key));
                    if (!hasActiveOptimisticMutation) {
                        return false; // Skip this delete event as sync will restore the data
                    }
                }
                return true;
            });
            // Update indexes for the filtered events
            if (filteredEvents.length > 0) {
                this.updateIndexes(filteredEvents);
            }
            this.emitEvents(filteredEvents);
        }
        else {
            // Update indexes for all events
            if (filteredEventsBySyncStatus.length > 0) {
                this.updateIndexes(filteredEventsBySyncStatus);
            }
            // Emit all events if no pending sync transactions
            this.emitEvents(filteredEventsBySyncStatus);
        }
    }
    /**
     * Calculate the current size based on synced data and optimistic changes
     */
    calculateSize() {
        const syncedSize = this.syncedData.size;
        const deletesFromSynced = Array.from(this.optimisticDeletes).filter((key) => this.syncedData.has(key) && !this.optimisticUpserts.has(key)).length;
        const upsertsNotInSynced = Array.from(this.optimisticUpserts.keys()).filter((key) => !this.syncedData.has(key)).length;
        return syncedSize - deletesFromSynced + upsertsNotInSynced;
    }
    /**
     * Collect events for optimistic changes
     */
    collectOptimisticChanges(previousUpserts, previousDeletes, events) {
        const allKeys = new Set([
            ...previousUpserts.keys(),
            ...this.optimisticUpserts.keys(),
            ...previousDeletes,
            ...this.optimisticDeletes,
        ]);
        for (const key of allKeys) {
            const currentValue = this.get(key);
            const previousValue = this.getPreviousValue(key, previousUpserts, previousDeletes);
            if (previousValue !== undefined && currentValue === undefined) {
                events.push({ type: `delete`, key, value: previousValue });
            }
            else if (previousValue === undefined && currentValue !== undefined) {
                events.push({ type: `insert`, key, value: currentValue });
            }
            else if (previousValue !== undefined &&
                currentValue !== undefined &&
                previousValue !== currentValue) {
                events.push({
                    type: `update`,
                    key,
                    value: currentValue,
                    previousValue,
                });
            }
        }
    }
    /**
     * Get the previous value for a key given previous optimistic state
     */
    getPreviousValue(key, previousUpserts, previousDeletes) {
        if (previousDeletes.has(key)) {
            return undefined;
        }
        if (previousUpserts.has(key)) {
            return previousUpserts.get(key);
        }
        return this.syncedData.get(key);
    }
    /**
     * Emit events either immediately or batch them for later emission
     */
    emitEvents(changes, endBatching = false) {
        if (this.shouldBatchEvents && !endBatching) {
            // Add events to the batch
            this.batchedEvents.push(...changes);
            return;
        }
        // Either we're not batching, or we're ending the batching cycle
        let eventsToEmit = changes;
        if (endBatching) {
            // End batching: combine any batched events with new events and clean up state
            if (this.batchedEvents.length > 0) {
                eventsToEmit = [...this.batchedEvents, ...changes];
            }
            this.batchedEvents = [];
            this.shouldBatchEvents = false;
        }
        if (eventsToEmit.length === 0)
            return;
        // Emit to all listeners
        for (const listener of this.changeListeners) {
            listener(eventsToEmit);
        }
        // Emit to key-specific listeners
        if (this.changeKeyListeners.size > 0) {
            // Group changes by key, but only for keys that have listeners
            const changesByKey = new Map();
            for (const change of eventsToEmit) {
                if (this.changeKeyListeners.has(change.key)) {
                    if (!changesByKey.has(change.key)) {
                        changesByKey.set(change.key, []);
                    }
                    changesByKey.get(change.key).push(change);
                }
            }
            // Emit batched changes to each key's listeners
            for (const [key, keyChanges] of changesByKey) {
                const keyListeners = this.changeKeyListeners.get(key);
                for (const listener of keyListeners) {
                    listener(keyChanges);
                }
            }
        }
    }
    /**
     * Get the current value for a key (virtual derived state)
     */
    get(key) {
        // Check if optimistically deleted
        if (this.optimisticDeletes.has(key)) {
            return undefined;
        }
        // Check optimistic upserts first
        if (this.optimisticUpserts.has(key)) {
            return this.optimisticUpserts.get(key);
        }
        // Fall back to synced data
        return this.syncedData.get(key);
    }
    /**
     * Check if a key exists in the collection (virtual derived state)
     */
    has(key) {
        // Check if optimistically deleted
        if (this.optimisticDeletes.has(key)) {
            return false;
        }
        // Check optimistic upserts first
        if (this.optimisticUpserts.has(key)) {
            return true;
        }
        // Fall back to synced data
        return this.syncedData.has(key);
    }
    /**
     * Get the current size of the collection (cached)
     */
    get size() {
        return this._size;
    }
    /**
     * Get all keys (virtual derived state)
     */
    *keys() {
        // Yield keys from synced data, skipping any that are deleted.
        for (const key of this.syncedData.keys()) {
            if (!this.optimisticDeletes.has(key)) {
                yield key;
            }
        }
        // Yield keys from upserts that were not already in synced data.
        for (const key of this.optimisticUpserts.keys()) {
            if (!this.syncedData.has(key) && !this.optimisticDeletes.has(key)) {
                // The optimisticDeletes check is technically redundant if inserts/updates always remove from deletes,
                // but it's safer to keep it.
                yield key;
            }
        }
    }
    /**
     * Get all values (virtual derived state)
     */
    *values() {
        for (const key of this.keys()) {
            const value = this.get(key);
            if (value !== undefined) {
                yield value;
            }
        }
    }
    /**
     * Get all entries (virtual derived state)
     */
    *entries() {
        for (const key of this.keys()) {
            const value = this.get(key);
            if (value !== undefined) {
                yield [key, value];
            }
        }
    }
    /**
     * Get all entries (virtual derived state)
     */
    *[Symbol.iterator]() {
        for (const [key, value] of this.entries()) {
            yield [key, value];
        }
    }
    /**
     * Execute a callback for each entry in the collection
     */
    forEach(callbackfn) {
        let index = 0;
        for (const [key, value] of this.entries()) {
            callbackfn(value, key, index++);
        }
    }
    /**
     * Create a new array with the results of calling a function for each entry in the collection
     */
    map(callbackfn) {
        const result = [];
        let index = 0;
        for (const [key, value] of this.entries()) {
            result.push(callbackfn(value, key, index++));
        }
        return result;
    }
    ensureStandardSchema(schema) {
        // If the schema already implements the standard-schema interface, return it
        if (schema && typeof schema === `object` && `~standard` in schema) {
            return schema;
        }
        throw new Error(`Schema must either implement the standard-schema interface or be a Zod schema`);
    }
    getKeyFromItem(item) {
        return this.config.getKey(item);
    }
    generateGlobalKey(key, item) {
        if (typeof key === `undefined`) {
            throw new Error(`An object was created without a defined key: ${JSON.stringify(item)}`);
        }
        return `KEY::${this.id}/${key}`;
    }
    /**
     * Creates an index on a collection for faster queries.
     * Indexes significantly improve query performance by allowing binary search
     * and range queries instead of full scans.
     *
     * @template TResolver - The type of the index resolver (constructor or async loader)
     * @param indexCallback - Function that extracts the indexed value from each item
     * @param config - Configuration including index type and type-specific options
     * @returns An index proxy that provides access to the index when ready
     *
     * @example
     * // Create a default B-tree index
     * const ageIndex = collection.createIndex((row) => row.age)
     *
     * // Create a B-tree index with custom options
     * const ageIndex = collection.createIndex((row) => row.age, {
     *   indexType: OrderedIndex,
     *   options: { compareFn: customComparator },
     *   name: 'age_btree'
     * })
     *
     * // Create an async-loaded index
     * const textIndex = collection.createIndex((row) => row.content, {
     *   indexType: async () => {
     *     const { FullTextIndex } = await import('./indexes/fulltext.js')
     *     return FullTextIndex
     *   },
     *   options: { language: 'en' }
     * })
     */
    createIndex(indexCallback, config = {}) {
        this.validateCollectionUsable(`createIndex`);
        const indexId = `${++this.indexCounter}`;
        const singleRowRefProxy = createSingleRowRefProxy();
        const indexExpression = indexCallback(singleRowRefProxy);
        const expression = toExpression(indexExpression);
        // Default to OrderedIndex if no type specified
        const resolver = config.indexType ?? OrderedIndex;
        // Create lazy wrapper
        const lazyIndex = new LazyIndexWrapper(indexId, expression, config.name, resolver, config.options, this.entries());
        this.lazyIndexes.set(indexId, lazyIndex);
        // For synchronous constructors (classes), resolve immediately
        // For async loaders, wait for collection to be ready
        if (typeof resolver === 'function' && resolver.prototype) {
            // This is a constructor - resolve immediately and synchronously
            try {
                const resolvedIndex = lazyIndex.getResolved(); // This should work since constructor resolved it
                this.resolvedIndexes.set(indexId, resolvedIndex);
            }
            catch (error) {
                // Fallback to async resolution
                this.resolveSingleIndex(indexId, lazyIndex).catch((error) => {
                    console.warn('Failed to resolve single index:', error);
                });
            }
        }
        else if (this.isIndexesResolved) {
            // Async loader but indexes are already resolved - resolve this one
            this.resolveSingleIndex(indexId, lazyIndex).catch((error) => {
                console.warn('Failed to resolve single index:', error);
            });
        }
        return new IndexProxy(indexId, lazyIndex);
    }
    /**
     * Resolve all lazy indexes (called when collection first syncs)
     * @private
     */
    async resolveAllIndexes() {
        if (this.isIndexesResolved)
            return;
        const resolutionPromises = Array.from(this.lazyIndexes.entries()).map(async ([indexId, lazyIndex]) => {
            const resolvedIndex = await lazyIndex.resolve();
            // Build index with current data
            resolvedIndex.build(this.entries());
            this.resolvedIndexes.set(indexId, resolvedIndex);
            return { indexId, resolvedIndex };
        });
        await Promise.all(resolutionPromises);
        this.isIndexesResolved = true;
    }
    /**
     * Resolve a single index immediately
     * @private
     */
    async resolveSingleIndex(indexId, lazyIndex) {
        const resolvedIndex = await lazyIndex.resolve();
        resolvedIndex.build(this.entries());
        this.resolvedIndexes.set(indexId, resolvedIndex);
        return resolvedIndex;
    }
    /**
     * Get resolved indexes for query optimization
     */
    get indexes() {
        return this.resolvedIndexes;
    }
    /**
     * Updates all indexes when the collection changes
     * @private
     */
    updateIndexes(changes) {
        for (const index of this.resolvedIndexes.values()) {
            for (const change of changes) {
                switch (change.type) {
                    case `insert`:
                        index.add(change.key, change.value);
                        break;
                    case `update`:
                        if (change.previousValue) {
                            index.update(change.key, change.previousValue, change.value);
                        }
                        else {
                            index.add(change.key, change.value);
                        }
                        break;
                    case `delete`:
                        index.remove(change.key, change.value);
                        break;
                }
            }
        }
    }
    deepEqual(a, b) {
        if (a === b)
            return true;
        if (a == null || b == null)
            return false;
        if (typeof a !== typeof b)
            return false;
        if (typeof a === `object`) {
            if (Array.isArray(a) !== Array.isArray(b))
                return false;
            const keysA = Object.keys(a);
            const keysB = Object.keys(b);
            if (keysA.length !== keysB.length)
                return false;
            const keysBSet = new Set(keysB);
            for (const key of keysA) {
                if (!keysBSet.has(key))
                    return false;
                if (!this.deepEqual(a[key], b[key]))
                    return false;
            }
            return true;
        }
        return false;
    }
    validateData(data, type, key) {
        if (!this.config.schema)
            return data;
        const standardSchema = this.ensureStandardSchema(this.config.schema);
        // For updates, we need to merge with the existing data before validation
        if (type === `update` && key) {
            // Get the existing data for this key
            const existingData = this.get(key);
            if (existingData &&
                data &&
                typeof data === `object` &&
                typeof existingData === `object`) {
                // Merge the update with the existing data
                const mergedData = Object.assign({}, existingData, data);
                // Validate the merged data
                const result = standardSchema[`~standard`].validate(mergedData);
                // Ensure validation is synchronous
                if (result instanceof Promise) {
                    throw new TypeError(`Schema validation must be synchronous`);
                }
                // If validation fails, throw a SchemaValidationError with the issues
                if (`issues` in result && result.issues) {
                    const typedIssues = result.issues.map((issue) => ({
                        message: issue.message,
                        path: issue.path?.map((p) => String(p)),
                    }));
                    throw new SchemaValidationError(type, typedIssues);
                }
                // Return the original update data, not the merged data
                // We only used the merged data for validation
                return data;
            }
        }
        // For inserts or updates without existing data, validate the data directly
        const result = standardSchema[`~standard`].validate(data);
        // Ensure validation is synchronous
        if (result instanceof Promise) {
            throw new TypeError(`Schema validation must be synchronous`);
        }
        // If validation fails, throw a SchemaValidationError with the issues
        if (`issues` in result && result.issues) {
            const typedIssues = result.issues.map((issue) => ({
                message: issue.message,
                path: issue.path?.map((p) => String(p)),
            }));
            throw new SchemaValidationError(type, typedIssues);
        }
        return result.value;
    }
    update(keys, configOrCallback, maybeCallback) {
        if (typeof keys === `undefined`) {
            throw new Error(`The first argument to update is missing`);
        }
        this.validateCollectionUsable(`update`);
        const ambientTransaction = getActiveTransaction();
        // If no ambient transaction exists, check for an onUpdate handler early
        if (!ambientTransaction && !this.config.onUpdate) {
            throw new Error(`Collection.update called directly (not within an explicit transaction) but no 'onUpdate' handler is configured.`);
        }
        const isArray = Array.isArray(keys);
        const keysArray = isArray ? keys : [keys];
        if (isArray && keysArray.length === 0) {
            throw new Error(`No keys were passed to update`);
        }
        const callback = typeof configOrCallback === `function` ? configOrCallback : maybeCallback;
        const config = typeof configOrCallback === `function` ? {} : configOrCallback;
        // Get the current objects or empty objects if they don't exist
        const currentObjects = keysArray.map((key) => {
            const item = this.get(key);
            if (!item) {
                throw new Error(`The key "${key}" was passed to update but an object for this key was not found in the collection`);
            }
            return item;
        });
        let changesArray;
        if (isArray) {
            // Use the proxy to track changes for all objects
            changesArray = withArrayChangeTracking(currentObjects, callback);
        }
        else {
            const result = withChangeTracking(currentObjects[0], callback);
            changesArray = [result];
        }
        // Create mutations for each object that has changes
        const mutations = keysArray
            .map((key, index) => {
            const itemChanges = changesArray[index]; // User-provided changes for this specific item
            // Skip items with no changes
            if (!itemChanges || Object.keys(itemChanges).length === 0) {
                return null;
            }
            const originalItem = currentObjects[index];
            // Validate the user-provided changes for this item
            const validatedUpdatePayload = this.validateData(itemChanges, `update`, key);
            // Construct the full modified item by applying the validated update payload to the original item
            const modifiedItem = Object.assign({}, originalItem, validatedUpdatePayload);
            // Check if the ID of the item is being changed
            const originalItemId = this.getKeyFromItem(originalItem);
            const modifiedItemId = this.getKeyFromItem(modifiedItem);
            if (originalItemId !== modifiedItemId) {
                throw new Error(`Updating the key of an item is not allowed. Original key: "${originalItemId}", Attempted new key: "${modifiedItemId}". Please delete the old item and create a new one if a key change is necessary.`);
            }
            const globalKey = this.generateGlobalKey(modifiedItemId, modifiedItem);
            return {
                mutationId: crypto.randomUUID(),
                original: originalItem,
                modified: modifiedItem,
                changes: validatedUpdatePayload,
                globalKey,
                key,
                metadata: config.metadata,
                syncMetadata: (this.syncedMetadata.get(key) || {}),
                optimistic: config.optimistic ?? true,
                type: `update`,
                createdAt: new Date(),
                updatedAt: new Date(),
                collection: this,
            };
        })
            .filter(Boolean);
        // If no changes were made, return an empty transaction early
        if (mutations.length === 0) {
            const emptyTransaction = createTransaction({
                mutationFn: async () => { },
            });
            emptyTransaction.commit();
            return emptyTransaction;
        }
        // If an ambient transaction exists, use it
        if (ambientTransaction) {
            ambientTransaction.applyMutations(mutations);
            this.transactions.set(ambientTransaction.id, ambientTransaction);
            this.recomputeOptimisticState();
            return ambientTransaction;
        }
        // No need to check for onUpdate handler here as we've already checked at the beginning
        // Create a new transaction with a mutation function that calls the onUpdate handler
        const directOpTransaction = createTransaction({
            mutationFn: async (params) => {
                // Call the onUpdate handler with the transaction and collection
                return this.config.onUpdate({
                    transaction: params.transaction,
                    collection: this,
                });
            },
        });
        // Apply mutations to the new transaction
        directOpTransaction.applyMutations(mutations);
        directOpTransaction.commit();
        // Add the transaction to the collection's transactions store
        this.transactions.set(directOpTransaction.id, directOpTransaction);
        this.recomputeOptimisticState();
        return directOpTransaction;
    }
    /**
     * Gets the current state of the collection as a Map
     * @returns Map containing all items in the collection, with keys as identifiers
     * @example
     * const itemsMap = collection.state
     * console.log(`Collection has ${itemsMap.size} items`)
     *
     * for (const [key, item] of itemsMap) {
     *   console.log(`${key}: ${item.title}`)
     * }
     *
     * // Check if specific item exists
     * if (itemsMap.has("todo-1")) {
     *   console.log("Todo 1 exists:", itemsMap.get("todo-1"))
     * }
     */
    get state() {
        const result = new Map();
        for (const [key, value] of this.entries()) {
            result.set(key, value);
        }
        return result;
    }
    /**
     * Gets the current state of the collection as a Map, but only resolves when data is available
     * Waits for the first sync commit to complete before resolving
     *
     * @returns Promise that resolves to a Map containing all items in the collection
     */
    stateWhenReady() {
        // If we already have data or there are no loading collections, resolve immediately
        if (this.size > 0 || this.hasReceivedFirstCommit) {
            return Promise.resolve(this.state);
        }
        // Otherwise, wait for the first commit
        return new Promise((resolve) => {
            this.onFirstCommit(() => {
                resolve(this.state);
            });
        });
    }
    /**
     * Gets the current state of the collection as an Array
     *
     * @returns An Array containing all items in the collection
     */
    get toArray() {
        return Array.from(this.values());
    }
    /**
     * Gets the current state of the collection as an Array, but only resolves when data is available
     * Waits for the first sync commit to complete before resolving
     *
     * @returns Promise that resolves to an Array containing all items in the collection
     */
    toArrayWhenReady() {
        // If we already have data or there are no loading collections, resolve immediately
        if (this.size > 0 || this.hasReceivedFirstCommit) {
            return Promise.resolve(this.toArray);
        }
        // Otherwise, wait for the first commit
        return new Promise((resolve) => {
            this.onFirstCommit(() => {
                resolve(this.toArray);
            });
        });
    }
    /**
     * Returns the current state of the collection as an array of changes
     * @param options - Options including optional where filter
     * @returns An array of changes
     * @example
     * // Get all items as changes
     * const allChanges = collection.currentStateAsChanges()
     *
     * // Get only items matching a condition
     * const activeChanges = collection.currentStateAsChanges({
     *   where: (row) => row.status === 'active'
     * })
     */
    currentStateAsChanges(options = {}) {
        if (!options.where) {
            // No filtering, return all items
            const result = [];
            for (const [key, value] of this.entries()) {
                result.push({
                    type: `insert`,
                    key,
                    value,
                });
            }
            return result;
        }
        // There's a where clause, let's see if we can use an index
        const result = [];
        try {
            // Create the single-row refProxy for the callback
            const singleRowRefProxy = createSingleRowRefProxy();
            // Execute the callback to get the expression
            const whereExpression = options.where(singleRowRefProxy);
            // Convert the result to a BasicExpression
            const expression = toExpression(whereExpression);
            // Try to optimize the query using indexes
            const optimizationResult = optimizeQuery(expression, this.indexes);
            if (optimizationResult.canOptimize) {
                // Use index optimization
                for (const key of optimizationResult.matchingKeys) {
                    const value = this.get(key);
                    if (value !== undefined) {
                        result.push({
                            type: `insert`,
                            key,
                            value,
                        });
                    }
                }
            }
            else {
                // No index found or complex expression, fall back to full scan with filter
                const filterFn = this.createFilterFunction(options.where);
                for (const [key, value] of this.entries()) {
                    if (filterFn(value)) {
                        result.push({
                            type: `insert`,
                            key,
                            value,
                        });
                    }
                }
            }
        }
        catch (error) {
            // If anything goes wrong with the where clause, fall back to full scan
            console.warn(`Error processing where clause, falling back to full scan:`, error);
            const filterFn = this.createFilterFunction(options.where);
            for (const [key, value] of this.entries()) {
                if (filterFn(value)) {
                    result.push({
                        type: `insert`,
                        key,
                        value,
                    });
                }
            }
        }
        return result;
    }
    /**
     * Creates a filter function from a where callback
     * @private
     */
    createFilterFunction(whereCallback) {
        return (item) => {
            try {
                // First try the RefProxy approach for query builder functions
                const singleRowRefProxy = createSingleRowRefProxy();
                const whereExpression = whereCallback(singleRowRefProxy);
                const expression = toExpression(whereExpression);
                const evaluator = compileSingleRowExpression(expression);
                const result = evaluator(item);
                // WHERE clauses should always evaluate to boolean predicates (Kevin's feedback)
                return result;
            }
            catch {
                // If RefProxy approach fails (e.g., arithmetic operations), fall back to direct evaluation
                try {
                    // Create a simple proxy that returns actual values for arithmetic operations
                    const simpleProxy = new Proxy(item, {
                        get(target, prop) {
                            return target[prop];
                        },
                    });
                    const result = whereCallback(simpleProxy);
                    return result;
                }
                catch {
                    // If both approaches fail, exclude the item
                    return false;
                }
            }
        };
    }
    /**
     * Subscribe to changes in the collection
     * @param callback - Function called when items change
     * @param options - Subscription options including includeInitialState and where filter
     * @returns Unsubscribe function - Call this to stop listening for changes
     * @example
     * // Basic subscription
     * const unsubscribe = collection.subscribeChanges((changes) => {
     *   changes.forEach(change => {
     *     console.log(`${change.type}: ${change.key}`, change.value)
     *   })
     * })
     *
     * // Later: unsubscribe()
     *
     * @example
     * // Include current state immediately
     * const unsubscribe = collection.subscribeChanges((changes) => {
     *   updateUI(changes)
     * }, { includeInitialState: true })
     *
     * @example
     * // Subscribe only to changes matching a condition
     * const unsubscribe = collection.subscribeChanges((changes) => {
     *   updateUI(changes)
     * }, {
     *   includeInitialState: true,
     *   where: (row) => row.status === 'active'
     * })
     */
    subscribeChanges(callback, options = {}) {
        // Start sync and track subscriber
        this.addSubscriber();
        // Create a filtered callback if where clause is provided
        const filteredCallback = options.where
            ? this.createFilteredCallback(callback, options.where)
            : callback;
        if (options.includeInitialState) {
            // First send the current state as changes (filtered if needed)
            const initialChanges = this.currentStateAsChanges({
                where: options.where,
            });
            filteredCallback(initialChanges);
        }
        // Add to batched listeners
        this.changeListeners.add(filteredCallback);
        return () => {
            this.changeListeners.delete(filteredCallback);
            this.removeSubscriber();
        };
    }
    /**
     * Creates a filtered callback that only calls the original callback with changes that match the where clause
     * @private
     */
    createFilteredCallback(originalCallback, whereCallback) {
        const filterFn = this.createFilterFunction(whereCallback);
        return (changes) => {
            const filteredChanges = [];
            for (const change of changes) {
                // For inserts and updates, check if the new value matches the filter
                if (change.type === `insert` || change.type === `update`) {
                    if (filterFn(change.value)) {
                        filteredChanges.push(change);
                    }
                }
                // For deletes, include if the previous value would have matched
                // (so subscribers know something they were tracking was deleted)
                else {
                    if (filterFn(change.value)) {
                        filteredChanges.push(change);
                    }
                }
            }
            if (filteredChanges.length > 0) {
                originalCallback(filteredChanges);
            }
        };
    }
    /**
     * Subscribe to changes for a specific key
     */
    subscribeChangesKey(key, listener, { includeInitialState = false } = {}) {
        // Start sync and track subscriber
        this.addSubscriber();
        if (!this.changeKeyListeners.has(key)) {
            this.changeKeyListeners.set(key, new Set());
        }
        if (includeInitialState) {
            // First send the current state as changes
            listener([
                {
                    type: `insert`,
                    key,
                    value: this.get(key),
                },
            ]);
        }
        this.changeKeyListeners.get(key).add(listener);
        return () => {
            const listeners = this.changeKeyListeners.get(key);
            if (listeners) {
                listeners.delete(listener);
                if (listeners.size === 0) {
                    this.changeKeyListeners.delete(key);
                }
            }
            this.removeSubscriber();
        };
    }
    /**
     * Capture visible state for keys that will be affected by pending sync operations
     * This must be called BEFORE onTransactionStateChange clears optimistic state
     */
    capturePreSyncVisibleState() {
        if (this.pendingSyncedTransactions.length === 0)
            return;
        // Clear any previous capture
        this.preSyncVisibleState.clear();
        // Get all keys that will be affected by sync operations
        const syncedKeys = new Set();
        for (const transaction of this.pendingSyncedTransactions) {
            for (const operation of transaction.operations) {
                syncedKeys.add(operation.key);
            }
        }
        // Mark keys as about to be synced to suppress intermediate events from recomputeOptimisticState
        for (const key of syncedKeys) {
            this.recentlySyncedKeys.add(key);
        }
        // Only capture current visible state for keys that will be affected by sync operations
        // This is much more efficient than capturing the entire collection state
        for (const key of syncedKeys) {
            const currentValue = this.get(key);
            if (currentValue !== undefined) {
                this.preSyncVisibleState.set(key, currentValue);
            }
        }
    }
    /**
     * Trigger a recomputation when transactions change
     * This method should be called by the Transaction class when state changes
     */
    onTransactionStateChange() {
        // Check if commitPendingTransactions will be called after this
        // by checking if there are pending sync transactions (same logic as in transactions.ts)
        this.shouldBatchEvents = this.pendingSyncedTransactions.length > 0;
        // CRITICAL: Capture visible state BEFORE clearing optimistic state
        this.capturePreSyncVisibleState();
        this.recomputeOptimisticState();
    }
}
